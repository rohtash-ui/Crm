# Enterprise CRM Architecture Handbook

How a CRM platform serving **50,000+ users** keeps its code, infrastructure,
and operations running **24/7** — with automated fallback loops that recover
from failure without human intervention whenever possible.

This handbook is the single source of truth a platform engineer, SRE, or
on-call responder should open to understand how the system stays up.

## Reading order

| # | File | Read if you are... |
|---|---|---|
| 01 | [architecture-overview.md](01-architecture-overview.md) | New to the system |
| 02 | [code-organization.md](02-code-organization.md) | A developer shipping features |
| 03 | [infrastructure.md](03-infrastructure.md) | A platform / DevOps engineer |
| 04 | [data-layer.md](04-data-layer.md) | Working on databases, cache, events |
| 05 | [high-availability.md](05-high-availability.md) | Designing for SLOs and resilience |
| 06 | [observability.md](06-observability.md) | Debugging production or building dashboards |
| 07 | [disaster-recovery-runbook.md](07-disaster-recovery-runbook.md) | On-call during an incident |
| 08 | [self-healing-loops.md](08-self-healing-loops.md) | Curious how the system auto-recovers |
| 09 | [incident-response.md](09-incident-response.md) | Running or joining an incident |
| 10 | [security-compliance.md](10-security-compliance.md) | Working on auth, data protection, audits |
| 11 | [whatsapp-lead-notifications.md](11-whatsapp-lead-notifications.md) | Building or debugging WhatsApp lead notification automation |

## Audience-based entry points

- **New engineer**: 01 → 02 → 03 → 06
- **SRE / on-call**: 05 → 07 → 08 → 09 → 06
- **Security / compliance**: 10 → 04 → 03
- **Engineering leadership**: 01 → 05 → 09

## System at a glance

- **Users**: 50,000+ named seats, ~5,000 concurrent peak.
- **Tenants**: multi-tenant SaaS, tenant-isolated data and quotas.
- **Traffic**: ~2,000 RPS steady, ~10,000 RPS peak.
- **Data**: ~500 GB hot OLTP, ~50 TB warm/analytics, ~PB-scale object storage.
- **Regions**: 2 active-active primary + 1 warm DR.
- **SLO**: 99.95% availability (≈ 22 minutes/month error budget).
- **Deployment**: Kubernetes + GitOps, trunk-based development, canary rollouts.

## Glossary

| Term | Meaning |
|---|---|
| **RTO** | Recovery Time Objective — max time to restore service after an outage. |
| **RPO** | Recovery Point Objective — max acceptable data loss measured in time. |
| **SLO** | Service Level Objective — numerical reliability target (e.g., 99.95%). |
| **SLI** | Service Level Indicator — the measured metric feeding an SLO. |
| **Error budget** | 100% − SLO; the allowable unreliability over a window. |
| **Blast radius** | Scope of damage if a component fails (one pod? one tenant? one region?). |
| **Quorum** | Minimum replicas that must agree for a stateful system to make progress. |
| **AZ** | Availability Zone — a physically isolated failure domain within a region. |
| **Bulkhead** | Isolation boundary that prevents one workload from starving another. |
| **Circuit breaker** | Fast-fail mechanism that stops calls to a failing dependency. |
| **PITR** | Point-In-Time Recovery — restore a database to any moment in a retention window. |
| **CDC** | Change Data Capture — stream row-level DB changes to downstream systems. |
| **GitOps** | Desired state in git, reconciler continuously applies it to the cluster. |
| **Canary** | Rolling a new version to a small % of traffic before full rollout. |
| **Blameless postmortem** | Incident review focused on systems, not individuals. |

## How to use this handbook

1. If the system is on fire, open [07-disaster-recovery-runbook.md](07-disaster-recovery-runbook.md).
2. If an alert fired but you have time to think, open [06-observability.md](06-observability.md) and [09-incident-response.md](09-incident-response.md).
3. If you are building something new, start with [01-architecture-overview.md](01-architecture-overview.md) and [05-high-availability.md](05-high-availability.md).
4. If you are wondering "how does it recover itself?", read [08-self-healing-loops.md](08-self-healing-loops.md).
