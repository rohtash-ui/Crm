# 08 — Self-Healing Loops

The user asked: *"if a problem arises, is there a fallback methodology in a
loop to get the system running 24/7?"* — this is that document.

The CRM is kept up by **nested control loops** running at every layer. Each
loop independently observes its slice of the world, compares observed to
desired, and takes action to close the gap. Most incidents are fully
recovered by these loops with no human involvement.

## The universal control loop

Every loop follows the same shape:

```
         ┌───────────────┐
         │   observe     │◄──────────────┐
         └──────┬────────┘                │
                ▼                         │
         ┌───────────────┐                │
         │   compare     │                │
         │ (desired vs   │                │
         │  observed)    │                │
         └──────┬────────┘                │
                ▼                         │
         ┌───────────────┐                │
         │    decide     │                │
         └──────┬────────┘                │
                ▼                         │
         ┌───────────────┐                │
         │     act       │                │
         └──────┬────────┘                │
                ▼                         │
         ┌───────────────┐                │
         │    verify     │                │
         └──────┬────────┘                │
                └────────────────────────┘
```

The loops below are instances of this shape at different scopes and time
constants. They compose: a fast loop at the pod level, a slower one at the
cluster level, an even slower one at the region level, so that when a fast
loop cannot resolve the issue, the next one up takes over.

## Loop catalog

| # | Loop | Scope | Period | Owner |
|---|---|---|---|---|
| 1 | Container probes | Pod | 1–10 s | Kubelet |
| 2 | Replica reconciliation | Deployment | < 1 s | Deployment controller |
| 3 | Service mesh circuit breaking | Service-to-service call | 10 s | Mesh proxy (Envoy/Linkerd) |
| 4 | Autoscaling | Deployment / cluster | 15–60 s | HPA / VPA / KEDA / Cluster Autoscaler |
| 5 | GitOps reconciliation | Cluster state | 3 min | ArgoCD |
| 6 | Progressive delivery analysis | Rollout | 30 s–60 min | Argo Rollouts / Flagger |
| 7 | Database health and failover | DB cluster | 1–5 s | Patroni / Stolon |
| 8 | Backup verification | Storage | Daily | Scheduled job |
| 9 | Certificate rotation | Secrets | Daily | cert-manager |
| 10 | Dynamic secret rotation | Secrets | < 1 hour | Vault |
| 11 | Chaos testing | Whole system | Continuous | Chaos controller |
| 12 | Regional traffic shaping | Region | 30 s | Global LB + mesh |
| 13 | Alerting dead-man's switch | Observability | 1 min | Secondary monitor |

## 1. Container probe loop (kubelet)

- **Observes**: liveness, readiness, startup probes per container.
- **Desired state**: all probes healthy.
- **Action on divergence**:
  - Readiness false → remove from service endpoints (stops receiving traffic) — no restart.
  - Liveness false → kill container, let Deployment spec restart it (with backoff).
  - Startup probe prevents liveness from killing during slow start.
- **Fallback loop (if this loop can't heal)**: the Deployment reconciler (loop 2) notices replica count is short and creates a new pod.
- **Key discipline**: probes must be **truthful** and **independent of flaky downstreams**, otherwise restarts cascade.

## 2. Replica reconciliation loop (Deployment controller)

- **Observes**: Deployment `spec.replicas` vs actual healthy pods.
- **Action**: create or delete pods to match; respect PDB during voluntary disruptions.
- **Fallback loop**: the scheduler places the new pods. If scheduling fails (no capacity), loop 4 (cluster autoscaler) wakes up.
- **Rolling updates**: new replicas are created, old drained, with max-surge / max-unavailable budgets.

## 3. Service mesh circuit-breaking loop

- **Observes**: per-upstream error rate, latency, ejection signals.
- **Compares**: against circuit-breaker thresholds.
- **Action**:
  - Open circuit → fail fast to callers with a retryable error; callers may then hit a fallback path (cached data, degraded feature).
  - Outlier detection → eject a specific upstream endpoint for N minutes.
  - Retry budget cap → drop excess retries during failure.
- **Fallback loop**: if all upstreams of a service are unhealthy, loop 12 (regional traffic shaping) can move traffic to another region.
- **Why this matters**: without circuit breaking, a slow dependency causes the caller to queue, run out of goroutines / threads / connections, and crash — cascading failure. The loop stops the cascade.

## 4. Autoscaling loop (HPA / VPA / KEDA / Cluster Autoscaler)

- **Pod-level (HPA)**: every 15 s, read metrics (CPU, custom) → compute desired replicas → adjust.
- **Event-driven (KEDA)**: every 15–30 s, read queue depth / Kafka lag → scale consumer replicas.
- **Node-level (Cluster Autoscaler / Karpenter)**: every 10–60 s, see pending pods → provision nodes.
- **Damping**: scale up eagerly, scale down conservatively. Scale-down stabilization window ≥ 5 minutes to avoid thrash.
- **Fallback loop**: if autoscaling can't catch up (quota / capacity limit), load shedding (see [05](05-high-availability.md)) kicks in and the on-call is paged.

## 5. GitOps reconciliation loop (ArgoCD)

- **Observes**: cluster state vs declared state in git.
- **Action**: apply the diff (auto-sync) or alert (manual sync).
- **Self-heal**: if a manual kubectl change drifts from git, ArgoCD reverts it back to git — so production always matches what's reviewed and committed.
- **Fallback loop**: if ArgoCD itself is down, the mesh/Deployment controllers still keep current state running; no new changes are applied until ArgoCD recovers.
- **Why nested**: the loops beneath (1–4) keep current state healthy; loop 5 keeps the *desired* state correct.

## 6. Progressive delivery analysis loop (Argo Rollouts / Flagger)

During a canary release, every 30 s the analyzer:

- Queries Prometheus for the canary's error rate, latency, and SLO metrics.
- Compares against the stable (pre-rollout) baseline.
- Decides:
  - Within tolerance → advance to next canary step (1% → 10% → 50% → 100%).
  - Outside tolerance → **automatically roll back**.
- **Fallback loop**: the general SLO alerting (loop 13) will still page if the automatic rollback fails for some reason; the on-call can then do a manual `helm rollback`.

## 7. Database health + failover loop (Patroni / Stolon)

- **Observes**: primary health, standby replication lag, quorum state.
- **Action**:
  - If primary fails → elect a new primary from the healthy standby set (the most up-to-date).
  - Fence the old primary to prevent split-brain.
  - Update pooler endpoints to point to the new primary.
- **Fallback loop**: if automatic failover is blocked (e.g., insufficient standbys), alert the DBA on-call and execute the manual promotion from scenario 5 in [07](07-disaster-recovery-runbook.md).
- **Safety**: sync replication (`synchronous_commit=remote_apply`) ensures a promoted standby has not lost committed writes.

## 8. Backup verification loop

- **Daily**:
  1. Restore yesterday's Postgres backup to a scratch cluster.
  2. Run a checksum job on a sample of tables.
  3. Compare against live production (via CDC snapshot at `restore_time`).
  4. Emit a metric: `backup_restore_success{db="..."} 1|0`.
- **Monthly**: full restore, full table count comparison, end-to-end application smoke test against the restored cluster.
- **Fallback loop**: a failed verification pages the data team immediately; the on-call flips the backup strategy to a secondary method (alternate region / alternate tool) until fixed.

## 9. Certificate rotation loop (cert-manager)

- **Observes**: TLS cert expiry across the cluster.
- **Action**: request a new cert at N - 14 days before expiry, install, reload consumers.
- **Fallback loop**: if rotation fails, a ticket opens at N - 7 days and a page at N - 3 days — no cert should ever expire unnoticed.
- **Ingress certs** rotated this way; mTLS certs via mesh-managed CA rotate automatically every few hours.

## 10. Dynamic secret rotation loop (Vault)

- **DB credentials** issued dynamically with TTL ≤ 1 hour; services re-request via External Secrets Operator.
- **Cloud IAM** credentials short-lived via workload identity.
- **Fallback loop**: services cache the current credential and survive a brief Vault outage; if Vault stays down past the TTL of cached creds, affected services move to read-only / cached mode via feature flag.

## 11. Chaos engineering loop

- **Scheduled chaos** (daily/weekly, automated) in staging:
  - Random pod kills.
  - Network latency injection.
  - DNS failures.
  - AZ isolation (block traffic to one AZ for 5 min).
  - Postgres standby failover.
  - Redis node kill.
- **Game days** (quarterly, manual) in staging for bigger scenarios (region failover).
- **Continuous in prod** for battle-tested layers only: pod kills (limited rate), network jitter.
- **Goal**: verify that loops 1–7 actually work and that degraded modes kick in as designed. If chaos breaks user-visible SLOs, that is a bug and gets fixed.

## 12. Regional traffic shaping loop

- **Global LB** observes regional health (synthetic checks, local reported status).
- **Desired**: traffic split matches policy (e.g., 50/50 across two active regions).
- **Action**: on health degradation, shift traffic toward healthy regions within seconds (DNS TTL is short and global LBs use connection-level steering).
- **Fallback loop**: full region failover (see [07](07-disaster-recovery-runbook.md) scenario 4) if the healthy region cannot absorb all traffic.

## 13. Alerting dead-man's switch loop

- A scheduled heartbeat fires every 60 s to a **separate** monitoring pipeline.
- If the heartbeat goes missing for 3 consecutive intervals, a **separate** channel (SMS via secondary vendor) pages SRE.
- This catches the scary case: the primary monitoring system is down, and we silently stop seeing problems.
- "Nothing is alerting" is itself an alert.

## How the loops compose

A failing pod is healed by loop 1. If loop 1 can't, loop 2 replaces it. If
capacity runs out, loop 4 adds nodes. If the service is still slow (e.g., a
slow dependency), loop 3 cuts the bad upstream. If the whole service is sick,
loop 12 shifts traffic to another region. If the rollout that caused this
failed its own health gate, loop 6 already rolled it back. And if any of
those loops break, loop 13 makes sure humans find out.

## Degraded modes are part of the loop

Not every failure is recovered; sometimes the system chooses to *serve a
reduced version* rather than fail. Degraded mode is a first-class output of
the decision step:

```
if dependency.unhealthy for > 30s:
    set feature_flag("reports.live_refresh") = off
    serve cached reports with a "stale since ..." banner
```

The "decide" step has three possible actions: **heal**, **degrade**, or
**escalate to humans**. The loops pick the cheapest action that maintains
user-visible service.

## When loops aren't enough

These loops handle everything that looks like a known failure mode. Novel
failures (new bug, new cloud provider quirk, new adversary behavior) still
require humans. The job of observability (see [06](06-observability.md)) is to
make novel failures visible quickly, and the job of incident response (see
[09](09-incident-response.md)) is to turn that visibility into a fix and then
to feed that fix back into the loops so the next occurrence is handled
automatically.

Every incident postmortem asks: *which loop should have caught this, and
why didn't it?* The answer becomes an action item. Over time, more and
more failures fall into the self-healing envelope.
