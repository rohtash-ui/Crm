# 05 — High Availability

Why the CRM stays up. The short answer: redundancy at every layer, a budget
for failure at every layer, and the discipline to never rely on any single
component being healthy.

## Targets (SLOs)

| Tier | SLO | Error budget / 30d | p95 latency | p99 latency |
|---|---|---|---|---|
| **Tier-0** — auth, core API (login, list deals, create/update) | 99.95% | 21.6 min | < 300 ms | < 800 ms |
| **Tier-1** — reports, bulk imports | 99.9% | 43 min | < 1 s | < 3 s |
| **Tier-2** — analytics, exports | 99.5% | 3.6 h | < 5 s | < 15 s |

SLOs are written in `slo/<service>.yaml` and automatically generate:

- Prometheus recording rules.
- Multi-window multi-burn-rate alerts.
- A page in the SLO dashboard.
- Error budget burn notifications to the owning team.

## Availability math

The only way to get 99.95% out of components that are each 99.9% is to
eliminate single points of failure. Rule of thumb:

- **Any single component** in the critical path is expected to fail.
- **Two independent components in parallel** multiply failure probabilities: two 99.9% components in parallel = 99.9999%.
- Components count as independent only if they fail independently (different AZ, different host, different power, different software version where possible).

## Redundancy at every layer

| Layer | Redundancy |
|---|---|
| DNS | Multiple authoritative providers, short TTL (30–60s) for failover-critical records |
| Global LB | Anycast across N PoPs |
| Edge / WAF | Multi-region, provider-managed |
| API gateway | ≥ 3 replicas per region across ≥ 3 AZs |
| Stateless services | ≥ 3 replicas per region across ≥ 3 AZs, PodDisruptionBudget ≥ 2 |
| Stateful services | Quorum-based: 3- or 5-member groups with voter minority limit |
| Postgres | Primary + sync standby (diff AZ) + async replicas + cross-region replica |
| Redis | Cluster mode, primary+replica per shard in diff AZ |
| Kafka | RF=3, min-ISR=2, brokers spread across AZs |
| OpenSearch | Primary + 1 replica minimum, nodes across AZs |
| Object storage | Multi-AZ + cross-region replication |
| Observability stack | Separate clusters per region; cross-region aggregation for the global view |

## No-SPOF checklist (run before any prod change)

- [ ] Is there only one of any component on the request path? If yes, fix.
- [ ] Can any single AZ failure take down the service? If yes, fix.
- [ ] Can any single region failure take down the service? If yes, document in DR plan.
- [ ] Can a single bad deploy take down the service? (Canary answers this.)
- [ ] Can a single slow dependency take down the service? (Timeout + circuit breaker.)
- [ ] Can a single slow tenant take down the service? (Bulkheads + quotas.)
- [ ] Can a single slow query take down Postgres? (`statement_timeout` + pooler limits.)
- [ ] Are health checks truthful? (Readiness reflects real readiness; liveness isn't coupled to flaky deps.)

## Load balancing and health checks

- **Layer 4 → Layer 7** load balancing with active health checks every 5s.
- Unhealthy instances ejected within 15s.
- **Readiness probe** checks real downstream dependencies only if the service truly cannot serve without them. Otherwise, readiness is independent so the pod can serve degraded responses.
- **Liveness probe** is conservative: it only returns unhealthy for unrecoverable states (e.g., deadlock). A flaky dependency should NEVER trigger a liveness failure — that causes restart storms.
- **Startup probe** separate from liveness to give slow-starting pods time.

## Autoscaling

| Axis | Tool | Signal |
|---|---|---|
| Pod horizontal (most services) | **HPA** | CPU + custom (RPS, queue depth, p95 latency) |
| Pod vertical (stable workloads) | **VPA** (recommend mode) | Historical usage |
| Event-driven workers | **KEDA** | Kafka lag, queue length |
| Cluster nodes | **Cluster Autoscaler / Karpenter** | Pending pods |
| Pre-warming | Scheduled scale-up | Known peaks (Monday 9am, month-end) |

Autoscale **up** fast, **down** slowly. A too-fast scale-down during a brief
traffic dip guarantees thrash when traffic returns.

## Bulkheads

Bulkheads keep failure contained:

- **Per-tenant**: connection pool slots, rate limits, job concurrency, cache shards.
- **Per-dependency**: separate client pools, separate timeouts, separate circuit breakers so that a slow Salesforce integration cannot exhaust the thread pool used by the Stripe integration.
- **Per-endpoint**: concurrency limits so a slow export endpoint cannot starve fast endpoints.
- **Per-workload-class**: sync user traffic and async batch traffic run in different pod groups with different node pools.

## Timeouts, retries, and retry budgets

- **Every outbound call has a timeout.** No exceptions. The default is 2 seconds; anything longer is deliberate and documented.
- **Retries** only on safe, idempotent operations, with jittered exponential backoff, bounded attempts.
- **Retry budget**: at the mesh, the total retry RPS is capped at 10% of non-retry RPS. Beyond that, retries are dropped — because amplifying retries during a failure is how 1% error rates become outages.
- **Deadline propagation**: when Service A gets a 2s deadline, it passes `deadline=now+1.8s` to Service B, so B can't spend longer than A has left.

## Circuit breakers

At the service mesh and in every client library:

- Open on error rate > 50% over 10s, OR 10 consecutive failures.
- Half-open probe after 30s cool-down.
- Close on 2 consecutive successes.
- Opening triggers a `circuit_breaker_opened` event for observability.

## Graceful degradation

The CRM is designed so that when parts break, the rest still works. Each
feature has a defined degraded mode:

| Subsystem down | Degraded behavior |
|---|---|
| Search | List views still render, full-text search disabled with a banner |
| Reports | Live report refresh disabled, cached last-known shown |
| Notifications | Writes queued, UI shows "send pending" |
| Recommendations (AI) | Hidden; no blocking |
| Integrations | In-app works; external sync shows "reconnect" |
| Write path on a shard | Read-only banner for affected tenants |

Degraded modes are toggled by feature flags and by mesh health signals — no
code deploy needed. See also the self-healing loops in [08](08-self-healing-loops.md).

## Load shedding

Under extreme overload (saturation > threshold), services **shed** traffic
before they collapse:

- Tier-0 traffic always served.
- Tier-1 traffic shed above X% saturation.
- Tier-2 traffic shed above Y% saturation.
- Background jobs paused above Z% saturation.

Shed traffic gets a clear 503 + `Retry-After` so clients can back off
cleanly.

## Queueing and backpressure

- Bounded queues everywhere. An unbounded queue just moves the failure to
  out-of-memory.
- Producers see backpressure when a queue is full and either shed, buffer
  to disk, or apply retry with jitter.
- Kafka consumer groups scale on lag to absorb spikes.

## Release safety

Releases are the #1 cause of outages. Controls:

- **Canary rollouts** per [03](03-infrastructure.md).
- **Progressive delivery** driven by SLO metrics, not just HTTP status.
- **Automatic rollback** on SLO burn-rate alert.
- **Feature flags** let a deploy be decoupled from a feature enable.
- **Database migration safety** via expand / contract — no deploy ever depends on an unfinished migration.
- **No Friday-afternoon prod deploys** unless there is a hotfix (soft rule, enforced by tooling reminder).
- **Change freeze windows** for known peak events.

## Testing HA (we never trust it until we break it)

- **Chaos engineering** is scheduled — see [08](08-self-healing-loops.md).
- **Game days** quarterly against staging, annually against prod (carefully).
- **Restore drills** monthly — a backup that hasn't been restored is not a backup.
- **DR failover drill** — one full region failover annually; partial drills quarterly.

## Error budget policy

| Burn | Action |
|---|---|
| < 25% | Normal operations, ship features. |
| 25–50% | Increased scrutiny on risky changes. |
| 50–75% | Platform team reviews upcoming risky changes. |
| 75–100% | Release freeze on the affected tier. |
| > 100% | Reliability-only work until recovered; service owner presents plan at the next ops review. |

The error budget is a contract between product and engineering: when there is
budget, we ship fast; when there is not, we fix first.
