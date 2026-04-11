# 10 — Security & Compliance

A CRM stores customer relationships — names, emails, phone numbers, deal
sizes, contract language, notes, call recordings. For 50K users that is
millions of sensitive records. Security is a reliability feature: a breach
is an outage of trust.

## Principles

1. **Zero trust** — no network location or identity grants access implicitly.
2. **Least privilege** — the smallest permission that makes the task possible.
3. **Defense in depth** — multiple layers so one failure is not total.
4. **Assume breach** — design detection, containment, and recovery as if controls will fail.
5. **Auditable by default** — every access to sensitive data is logged.
6. **Security is everyone's job, owned by the security team.**

## Identity and access

### Customer identity (end users of the CRM)

- **SSO via SAML / OIDC** from the tenant's IdP (Okta, Azure AD, Google Workspace).
- **MFA** enforced; tenant can require TOTP, WebAuthn, or hardware keys.
- **Session** as a signed token with short TTL + refresh; sliding window.
- **Per-tenant password policy** when local auth is used (strongly discouraged).
- **Device binding** optional for enterprise tenants.
- **Suspicious login detection**: geovelocity, new device, anomalous time. On hit, step up to re-auth.

### Workforce identity (internal engineers)

- **SSO + hardware MFA** mandatory.
- **Just-in-time access** to prod — engineers request, get approval, access expires in hours.
- **Break-glass** accounts in an offline vault, alert on any use.
- **No shared credentials, ever.**

### Workload identity (services)

- **SPIFFE / cloud workload identity** — services authenticate to each other and to the cloud without long-lived secrets.
- **mTLS** everywhere inside the cluster; CA managed by the mesh.
- **Short-lived, scoped tokens** for access to Vault / KMS / databases.

## Authorization

- Every API call carries an identity and is authorized against a policy.
- **Role-based access control (RBAC)** per tenant for coarse roles (Admin, Manager, User).
- **Attribute-based access control (ABAC)** for fine-grained rules (ownership, team, territory).
- **Policy decision point** via `libs/authz` backed by OPA or a rules engine. Decisions are testable and auditable.
- **Server-side authorization only** — clients never decide authorization.

## Network security

- **VPCs** per region, per environment.
- **No public-facing workloads** except the edge LB / WAF.
- **Egress via allow-listed proxies**; services cannot call the open internet without registering the destination.
- **Micro-segmentation via NetworkPolicy**; services can only call their declared dependencies.
- **East-west mTLS** enforced by the service mesh.

## Data protection

### In transit

- **TLS 1.3** everywhere, externally and internally.
- **HSTS** enforced on web properties.
- **Certificate pinning** considered for mobile clients (with rotation plan).

### At rest

- **Disk encryption** on every node and storage backend (AES-256, KMS-backed).
- **Tenant-scoped encryption keys** for high-tier tenants: a tenant's DEK is wrapped by a tenant-owned KEK held in the tenant's HSM (BYOK — bring your own key).
- **Field-level encryption** for the most sensitive fields (notes, phone numbers, AI prompts). Decrypted only in the narrow code paths that need them; never logged.
- **Searchable encryption** via deterministic encryption or blind indexes for fields needing exact-match search.

### Key management

- **KMS-backed** root keys (cloud KMS or HSM).
- **Rotation**:
  - Data keys: per-object envelope encryption, rotation by re-wrap.
  - Master keys: annual rotation or on demand.
  - Signing keys: rotate on a schedule, overlap old + new for signature verification.
- **Separation of duties**: the team that administers KMS cannot administer the databases using it.

## Secrets management

- **Vault** as the single source.
- **External Secrets Operator** projects secrets into K8s.
- **No secrets in git, CI env vars, or container images.** Enforced by pre-commit scan + CI scan.
- **Dynamic secrets** for databases (TTL ≤ 1 hour) so a leaked credential has a short lifetime.
- **Secret scanning** runs on every commit and across all repos nightly.

## Audit logging

- Every **access to sensitive data** emits an audit event:
  - `who`, `what`, `when`, `where`, `why` (requesting context), `how` (mechanism).
- **Immutable store**: audit events are append-only in an object-lock bucket; compromising the primary DB does not rewrite history.
- **Retention**: 7 years minimum for compliance tenants.
- **Tamper evidence**: hash-chained events, daily Merkle root published to a separate system for integrity checks.
- **Customer-visible audit log** for tenant admins: who accessed what in their account.

## Vulnerability management

| Activity | Cadence | Tool |
|---|---|---|
| SAST | Every PR | Semgrep / CodeQL |
| SCA (deps) | Every PR + nightly | Dependabot / Renovate + Grype |
| Container scan | Every build | Trivy |
| IaC scan | Every PR | tfsec, checkov, kube-linter |
| DAST | Nightly against staging | Burp Suite / ZAP |
| Fuzzing | Continuous | Per-service harness |
| Pen test | Annual + after major change | External firm |
| Red team | Annual | Internal or external |
| Bug bounty | Always on | Public or private |

Patch SLAs:

| Severity | SLA |
|---|---|
| Critical | 24 hours |
| High | 7 days |
| Medium | 30 days |
| Low | 90 days |

## Dependency hygiene

- **Lockfiles** for every language; reproducible builds.
- **Private proxies** in front of public registries so nothing unknown pulls at build time.
- **License scanning** to block copyleft leakage.
- **Typosquatting detection** on added dependencies.
- **SBOM** generated for every release and stored alongside the image.
- **Supply-chain signing** with cosign; verify signature at admission.

## Detection and response

- **SIEM** aggregates audit, auth, network, and workload telemetry.
- **Detections** authored as code in a repo, tested like any other code.
- **Alerting** on anomalies: impossible travel, mass exports, privilege escalation, data exfil patterns.
- **24/7 on-call** for security incidents; parallel path to engineering on-call.
- **Runbooks** for common incident types (account compromise, lost device, credential leak).
- **Playbooks** for major events (mass phishing, insider threat, ransomware).

## Multi-tenant isolation

- **Logical isolation** by default (row-level + application-enforced tenant_id).
- **Schema or DB isolation** for enterprise / regulated tenants.
- **Per-tenant encryption keys** available as a paid feature.
- **Tenancy boundary tests**: a suite of tests specifically tries to access tenant B's data while authenticated as tenant A. CI fails if any succeeds.
- **Data residency**: configurable per tenant where their primary data lives (EU-only, US-only, etc.) — enforced by shard placement and replication policy.

## Privacy and compliance

### Frameworks

- **SOC 2 Type II** — annual audit.
- **ISO 27001** — annual audit.
- **GDPR** — DPIAs, subject access, right to be forgotten.
- **CCPA** — similar controls.
- **HIPAA** — optional add-on for healthcare tenants with a BAA.
- **PCI DSS** — only if the CRM touches cardholder data (generally avoid).

### Subject rights

- **Access**: a tenant admin can export all data about a subject within a defined SLA.
- **Correction**: standard edits, audit-logged.
- **Deletion (RTBF)**:
  1. App-layer delete (soft + hard).
  2. Search index purge.
  3. Warehouse purge (scheduled).
  4. Backups: either re-encrypt past the retention window (crypto-shred approach) or document that the deletion completes on backup expiry within N days.
  5. Certificate of deletion issued to the tenant on request.

### Data processing agreements

- Standard DPA signed with every tenant.
- Sub-processors listed publicly and updated on change.

## Supply chain

- **Internal code**: reviewed, signed.
- **Third-party code**: SBOM tracked, CVEs monitored.
- **Containers**: signed and verified at admission via Sigstore / cosign.
- **Build environment**: ephemeral, hermetic, reproducible. SLSA Level 3 target.
- **No artifact leaves the pipeline unsigned.**

## Physical and provider security

- **Providers**: cloud providers used are SOC 2 / ISO 27001 compliant. Their shared-responsibility model is documented.
- **Data center access**: managed by the provider; we do not run our own facilities.
- **Hardware**: not our problem — ours is the configuration.

## Insider risk

- **No single engineer can push to prod unchallenged.** Code review, CI gates, canary, GitOps sync all stand between code and users.
- **Just-in-time prod access**, audited.
- **Separation of duties** between code owners and deployment approvers for high-risk changes.
- **Exit**: on termination, SSO + Vault + VPN + SSH + cloud IAM all revoked by automation within minutes. Session killing propagated.

## Customer-facing security features

- Customers can:
  - Require SSO and MFA for their tenant.
  - See an audit log of all actions.
  - Configure session timeouts.
  - Export their data at any time.
  - Request data deletion.
  - Manage their own encryption keys (enterprise tier).
  - Whitelist IP ranges for admin access.
  - Receive security notifications (new device, new admin, role changes).

## Security testing is a loop

Like everything in [08](08-self-healing-loops.md), security is a continuous
loop, not a gate:

```
Detect → Alert → Investigate → Contain → Eradicate → Recover → Learn → Improve detection
```

Every security incident ends the same way as any other: a postmortem, action
items, and improvements to the detection and prevention loops — so the next
one is caught earlier or prevented entirely.
