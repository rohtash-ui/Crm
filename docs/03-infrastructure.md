# 03 — Infrastructure

How the platform is deployed across clusters, regions, and environments, and
how code gets from a developer's laptop into 50K users' hands safely.

## Environments

| Env | Purpose | Data | Traffic |
|---|---|---|---|
| `dev` | Local + shared integration | Synthetic | Internal only |
| `staging` | Pre-prod mirror | Masked clone of prod | Internal + synthetics |
| `canary` | First 1% of prod traffic | Real | Real (subset) |
| `prod` | Full production | Real | Real (100%) |

`dev`, `staging`, and `prod` use the **same Helm charts** — only the
`values-<env>.yaml` differs. This parity is enforced in CI: a PR that changes
`values-prod.yaml` without also updating staging's values file fails review
unless explicitly justified in the PR description.

## Region topology

- **Region A (active, primary writer shards 1..N/2)**
- **Region B (active, primary writer shards N/2+1..N)**
- **Region C (warm DR, standby replicas of all data, minimal compute)**

Traffic policy:

- Users are steered by GeoDNS to the nearest active region.
- Each region handles its own writes for the shards it owns; reads are
  locality-preferred but can cross regions if a shard's primary is elsewhere.
- Region C is NOT a live traffic target in normal operation — it exists as a
  fast failover target. It runs data-plane (Postgres standbys, object
  storage replicas) continuously, but only spins up application pods when
  promoted.

Failover flow is documented in [07-disaster-recovery-runbook.md](07-disaster-recovery-runbook.md).

## Kubernetes layout

- **One cluster per region per environment.** So: `prod-a`, `prod-b`, `prod-c`, `staging-a`, `staging-b`, `dev-shared`.
- **Why not one big multi-region cluster?** Blast radius. A control-plane bug in a multi-region cluster can take the whole platform down. Separate clusters keep the blast radius to one region.
- **Namespaces** per domain, per environment tier: `identity`, `contacts`, `deals`, `platform`, `observability`, `ingress`.
- **Node pools**:
  - `general` — stateless services (Deployments, HPA).
  - `memory` — Redis, caches.
  - `compute` — CPU-heavy services like reporting.
  - `burst` — spot/preemptible for async workers.
  - `dedicated-<tenant>` — optional pools for top-tier tenants who pay for isolation.
- **Node auto-repair & auto-upgrade** enabled; upgrades are rolling with max-unavailable=1 per node pool.

## Ingress & edge

```
User → Global Anycast DNS
     → Global Load Balancer (TLS termination at edge, HTTP/3)
     → WAF (OWASP CRS + custom rules, bot protection)
     → CDN (static, cached API responses with short TTL)
     → Regional API Gateway (rate limit, auth, quotas)
     → Service Mesh (mTLS, retries, circuit breaking, observability)
     → Service pods
```

- **WAF rules** updated via GitOps in `crm-infra/waf/`.
- **Rate limits** per tenant and per endpoint, enforced at the gateway, bypassable only for a small allowlist of internal calls.
- **DDoS protection** at the provider edge + application-layer rate limiting.

## Service mesh

- **Linkerd or Istio** (either works; pick for operational simplicity).
- **mTLS everywhere** — no in-cluster plaintext.
- **Automatic retries** with jittered backoff, capped retry budget (e.g., 10% of total RPS) so retries cannot amplify failure.
- **Circuit breakers** per upstream.
- **Outlier detection**: a pod that returns 5xx at > N% for 30s is ejected for 2 minutes.
- **Traffic splitting** for canary rollouts, enforced by Flagger / Argo Rollouts.

## Infrastructure as Code

Everything is codified, nothing is clicked:

| Layer | Tool | Repo |
|---|---|---|
| Cloud resources (VPCs, IAM, managed DBs) | **Terraform** | `crm-infra/terraform/` |
| Kubernetes workloads | **Helm** charts per service | `crm-services/services/*/helm/` |
| Cluster add-ons (ingress, cert-manager, observability) | **Helmfile / ArgoCD Apps** | `crm-infra/cluster-addons/` |
| Policy | **OPA / Gatekeeper / Kyverno** | `crm-infra/policy/` |
| Secrets | **Vault + External Secrets Operator** | `crm-infra/secrets/` |
| DNS | **external-dns** | Automatic from Ingress |

A human should almost never log into a cloud console. When they do, the
change is ephemeral and must be codified within 24 hours or it will be
reverted by the next drift-detection run.

## GitOps with ArgoCD

- **ArgoCD** watches `crm-infra/argocd-apps/` and syncs every Helm app into its target cluster.
- `auto-sync: true` for non-prod.
- `auto-sync: false` for prod; a promotion pipeline creates the sync PR/commit after a canary passes.
- **Drift detection**: anything that diverges from git is flagged; by default, it auto-heals back to git state.
- **Progressive delivery**: Argo Rollouts drives canary promotion based on SLO metrics.

## CI/CD pipeline

Triggered on every PR and every merge to `main`.

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  Build   │──►│   Test   │──►│   Scan   │──►│   Sign   │──►│ Publish  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └────┬─────┘
                                                                  │
                               ┌──────────────────────────────────┘
                               ▼
                       ┌───────────────┐
                       │  Deploy Dev   │
                       └───────┬───────┘
                               ▼
                       ┌───────────────┐
                       │ Deploy Staging│
                       └───────┬───────┘
                               ▼
                      ┌────────────────┐
                      │ Smoke + E2E    │
                      └───────┬────────┘
                              ▼
                      ┌────────────────┐
                      │  Canary 1%     │────► analyze SLOs
                      └───────┬────────┘       │
                              ▼                │ fail → auto rollback
                      ┌────────────────┐       │
                      │  Canary 10%    │       │
                      └───────┬────────┘       │
                              ▼                │
                      ┌────────────────┐       │
                      │  Canary 50%    │       │
                      └───────┬────────┘       │
                              ▼                │
                      ┌────────────────┐       │
                      │   Prod 100%    │       │
                      └────────────────┘◄──────┘
```

Stages in detail:

1. **Build**: hermetic Bazel build, produces OCI image, SBOM.
2. **Test**: unit + integration + contract in parallel.
3. **Scan**: SAST, dependency scan, container scan, license scan, IaC scan (tfsec, checkov), policy check (OPA).
4. **Sign**: cosign signs the image; attestation (in-toto / SLSA) attached.
5. **Publish**: image pushed to registry; manifest pinned by digest, not tag.
6. **Deploy dev**: ArgoCD auto-sync.
7. **Deploy staging**: same; run full synthetic suite.
8. **Canary**: Flagger / Argo Rollouts shifts 1% → 10% → 50% → 100% over ~30–60 minutes, watching latency, error rate, and SLO burn rate. Any breach → automatic rollback.
9. **Prod 100%**: stable replicas updated; old ones drained gracefully.

## Secrets management

- **Vault** as source of truth, with cloud KMS as the root of trust.
- **External Secrets Operator** projects secrets into K8s as short-lived objects.
- **Workload identity** (SPIFFE / cloud IAM) — no long-lived credentials baked into images.
- **Rotation**:
  - DB passwords: dynamic credentials, TTL ≤ 1 hour.
  - TLS certs: cert-manager, auto-rotated ≥ 14 days before expiry.
  - Signing keys: KMS-backed, rotated on schedule.
- **Break-glass credentials** exist but are:
  - Stored in a sealed offline vault.
  - Alert on any use.
  - Expire within 24 hours.

## Network

- Private VPCs per region.
- Egress through a NAT / egress proxy with allowlist — services cannot reach the open internet without a reason.
- Cross-region communication over private backbone.
- Zero-trust: no network location grants trust; mTLS + policy decides access.

## Policy as code

- **OPA / Gatekeeper** in-cluster: deny privileged pods, deny `:latest` tags, require resource limits, require probes, require NetworkPolicy.
- **Conftest** in CI: lint Helm values against the same policies before they ever hit a cluster.
- **Terraform**: `tfsec`, `checkov`, custom OPA policies on plan output.

## Cost guardrails

- Every namespace has CPU/memory requests limits and a budget.
- FinOps dashboards break down cost per service, per tenant, per environment.
- Spot / preemptible nodes for async / batch workloads.
- Autoscaling down at night for non-customer-facing workloads.

## Environment parity proof

On every PR, a bot runs:

```
diff <(render staging) <(render prod)  # structural diff only
```

and posts the list of meaningful differences. Unexplained divergence blocks
merge to prevent "works on staging, breaks in prod."
