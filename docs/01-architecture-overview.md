# 01 — Architecture Overview

## Mission

Serve a global, multi-tenant CRM to 50,000+ users with 99.95% availability,
sub-300ms p95 API latency, and graceful degradation when things fail.

## High-level system shape

```
                         ┌─────────────────────────────┐
                         │     Global Anycast LB       │
                         │     (DNS + TLS + WAF)       │
                         └───────────────┬─────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
              ┌─────▼─────┐        ┌─────▼─────┐        ┌─────▼─────┐
              │ Region A  │        │ Region B  │        │  Region C │
              │ (active)  │        │ (active)  │        │ (warm DR) │
              └─────┬─────┘        └─────┬─────┘        └───────────┘
                    │                    │
         ┌──────────▼──────────┐         │
         │   Regional Edge     │         │
         │  (CDN + WAF + RL)   │         │
         └──────────┬──────────┘         │
                    │                    │
         ┌──────────▼──────────┐         │
         │    API Gateway      │◄────────┘   (same stack in each region)
         │   (authn, quotas)   │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │      BFF layer      │   (one per client: web, mobile, public API)
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │  Service Mesh       │   mTLS, retries, circuit breakers
         └──────────┬──────────┘
                    │
     ┌──────────────┼──────────────────────────────────┐
     │              │                                  │
 ┌───▼────┐   ┌─────▼──────┐   ┌──────────┐   ┌────────▼────────┐
 │Identity│   │  Contacts  │   │  Deals   │   │  Notifications  │
 │  svc   │   │    svc     │   │   svc    │   │       svc       │
 └───┬────┘   └─────┬──────┘   └────┬─────┘   └────────┬────────┘
     │              │               │                  │
     └──────────────┴───────┬───────┴──────────────────┘
                            │
                ┌───────────▼────────────┐
                │    Event Backbone      │   Kafka (RF=3, min-ISR=2)
                └───────────┬────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
         ┌────▼───┐    ┌────▼────┐   ┌────▼─────┐
         │Postgres│    │  Redis  │   │OpenSearch│
         │(tenant │    │ cluster │   │  (CDC)   │
         │sharded)│    │         │   │          │
         └────────┘    └─────────┘   └──────────┘
                            │
                ┌───────────▼────────────┐
                │   Warehouse (OLAP)     │   ClickHouse / Snowflake
                └────────────────────────┘
```

## Core domains (bounded contexts)

Each domain is an independently deployable service with its own database.

| Domain | Responsibility | Owns |
|---|---|---|
| **Identity** | Auth, SSO, MFA, sessions, permissions | Users, roles, API keys |
| **Tenancy** | Tenants, plans, seats, quotas, billing hooks | Tenants, plans |
| **Accounts** | Company records | Accounts, hierarchies |
| **Contacts** | Individual records | Contacts, relationships |
| **Leads** | Top-of-funnel records, scoring | Leads, sources |
| **Deals / Pipeline** | Opportunities, stages, forecasts | Deals, stages, quotas |
| **Activities** | Calls, emails, meetings, tasks | Activities, timelines |
| **Campaigns** | Segmentation, sequences, outreach | Campaigns, sequences |
| **Reporting** | Dashboards, saved reports | Report definitions |
| **Analytics** | OLAP queries over warehouse | Cubes, materialized views |
| **Integrations** | Email, calendar, Slack, phone, custom webhooks | Connectors, mappings |
| **Notifications** | In-app, email, push, SMS | Notification prefs, delivery logs |
| **Files** | Attachments, exports, imports | Object metadata |
| **Audit** | Immutable activity log for compliance | Audit events |
| **Search** | Full-text and faceted search | Search indexes |
| **Location Tracking** | Continuous GPS, live map, movement history | GPS points, device positions, tracking config |

## Architectural principles

1. **Every service owns its data.** No cross-service DB reads. Communication is via APIs or events.
2. **Async by default for side effects.** User-facing path is fast; heavy work goes to Kafka consumers.
3. **Idempotent everything.** Every write accepts an `Idempotency-Key` and deduplicates.
4. **Tenant-aware everywhere.** Every request, log line, metric, and query is tagged with `tenant_id`.
5. **Degrade, don't fail.** If reports are broken, the pipeline still works. If search is down, list views still render.
6. **Blast radius must be bounded.** One bad tenant, one bad deploy, one bad region cannot take the whole platform down.
7. **Assume failure.** Every dependency can disappear; every call has a timeout, retry budget, and fallback.

## Traffic & capacity assumptions (50K users)

| Metric | Steady | Peak |
|---|---|---|
| Concurrent users | ~5,000 | ~15,000 (month-end, campaign sends) |
| HTTP RPS (user) | ~2,000 | ~10,000 |
| Background jobs/sec | ~1,000 | ~8,000 |
| Kafka events/sec | ~5,000 | ~30,000 |
| Postgres QPS (per shard) | ~3,000 | ~12,000 |
| Hot dataset size | ~500 GB | — |
| Warm/analytic dataset | ~50 TB | — |
| Object storage | multi-PB | — |

Capacity planning reviews run quarterly; every service declares its headroom
(current peak ÷ max-tested) and anything < 2× must be scaled or optimized.

## Request lifecycle (happy path, "create a deal")

1. Browser → global LB → regional edge → CDN (static) / API gateway (dynamic).
2. API gateway validates TLS, rate-limits per tenant, verifies JWT.
3. BFF assembles the page-level request, calls Deals service over mTLS.
4. Deals service writes to its Postgres shard inside a transaction, emits a `deal.created` event to Kafka.
5. Consumers react: Activities logs it, Notifications pings the owner, Search indexes it, Analytics ingests it.
6. Response returns in < 300ms p95; the async fan-out finishes within seconds.

## Failure lifecycle ("Contacts DB is slow")

1. Contacts service sees latency spike → emits RED metric.
2. Prometheus alert: SLO burn rate crosses threshold.
3. Service mesh circuit breaker opens for Contacts; callers fall back to cached list.
4. BFF detects degraded Contacts and hides non-essential widgets.
5. HPA scales replicas; DB reader pool increases.
6. If not recovered in N minutes, on-call is paged and runbook 07 is followed.

## What's in the other docs

- **Code organization** → [02](02-code-organization.md)
- **How the cluster, CI/CD, and environments are laid out** → [03](03-infrastructure.md)
- **How data is stored, replicated, and backed up** → [04](04-data-layer.md)
- **Why the system stays up** → [05](05-high-availability.md)
- **How we see inside** → [06](06-observability.md)
- **What to do when it breaks** → [07](07-disaster-recovery-runbook.md)
- **How it heals itself** → [08](08-self-healing-loops.md)
- **Continuous GPS tracking** → [11](11-location-tracking.md)
