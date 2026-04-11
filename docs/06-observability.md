# 06 — Observability

You cannot keep a 50K-user CRM up if you cannot see inside it. Observability
answers three questions under pressure:

1. **Is something wrong?** (alerting on symptoms)
2. **Where is it wrong?** (scoping the blast radius)
3. **Why is it wrong?** (root cause)

## Three pillars

| Pillar | Tool | Purpose |
|---|---|---|
| **Metrics** | Prometheus + Thanos / Mimir | Numerical time series, SLO burn, dashboards, alerting |
| **Logs** | Loki or OpenSearch/ELK | Full event detail, post-hoc debugging, audit |
| **Traces** | OpenTelemetry → Tempo / Jaeger | End-to-end request flow, latency breakdown |

Plus:

- **Events** (deploys, config changes, incidents) correlated on dashboards.
- **Profiles** (Pyroscope / Parca) for continuous CPU/heap profiling of prod workloads.
- **Synthetics** (Grafana Synthetic / custom) for outside-in probing.
- **Real User Monitoring (RUM)** for the web client.

## Instrumentation standard

Every service uses the `libs/obs` shared library. Out of the box it emits:

- **HTTP metrics**: request count, latency histogram, status code, path (cardinality-controlled), tenant tier.
- **DB metrics**: query count, latency histogram, error rate, pool saturation.
- **Cache metrics**: hits, misses, evictions.
- **Queue metrics**: messages in, out, retries, DLQ, consumer lag.
- **Business metrics**: domain-specific counters (deals created, leads imported, etc.).
- **Traces**: every HTTP handler and every outbound call are spans. `trace_id` propagated over HTTP, gRPC, and Kafka headers.
- **Structured logs**: JSON with `timestamp`, `level`, `service`, `trace_id`, `span_id`, `tenant_id`, `user_id`, `request_id`, `message`, context fields. Never log PII unless classified as P3.

## Golden signals (per service)

Every service dashboard shows, at minimum:

1. **Traffic** (RPS).
2. **Error rate** (% of non-2xx / non-expected).
3. **Latency** (p50, p95, p99).
4. **Saturation** (CPU, memory, pool utilization, queue depth, DB connections).

Templated dashboards are generated from a service's `obs-config.yaml` so
every service looks the same. On-call opens one dashboard, knows where to
find everything.

## RED and USE dashboards

| Framework | Applies to | Signals |
|---|---|---|
| **RED** (Requests, Errors, Duration) | Request-driven services | RPS, error rate, latency |
| **USE** (Utilization, Saturation, Errors) | Resources | CPU/mem/disk utilization, queue saturation, errors |

## Cardinality control

Observability costs explode on cardinality. Rules:

- Label sets per metric are capped (e.g., ≤ 10,000 series per metric per service).
- High-cardinality fields (`user_id`, `deal_id`, `trace_id`) live in **logs and traces**, not metrics.
- `path` is templated (`/deals/:id`, not `/deals/12345`).
- A lint check on the Prometheus config rejects new metrics with unbounded labels.

## Alerting philosophy

- **Alert on symptoms, not causes.** "p95 latency breached SLO" — not "CPU > 80%".
- **Multi-window, multi-burn-rate** alerts for SLOs:
  - Fast-burn: 2% budget in 1 hour → PAGE.
  - Slow-burn: 10% budget in 6 hours → PAGE.
  - Very slow-burn: 10% budget in 3 days → TICKET.
- **No non-actionable alerts.** If there is nothing on-call can do, it's a dashboard, not an alert.
- **Every page has a runbook link** in the alert annotation.
- **Flapping alerts** get auto-silenced and flagged for tuning; silenced alerts must have an owner and an expiry.

## Alert routing

```
Alertmanager
  ├─ SEV-1 → PagerDuty → primary on-call (phone)
  ├─ SEV-2 → PagerDuty → primary on-call (push)
  ├─ SEV-3 → Slack channel + on-call (low-urgency)
  └─ SEV-4 → Ticket queue
```

On-call schedules in PagerDuty; one primary + one secondary per service, with
a manager-on-call and an incident commander (IC) pool for SEV-1/2.

## Synthetic monitoring

Outside-in probing from ≥ 5 geographic regions, every 30 seconds, for every
critical user journey:

1. Health endpoint.
2. Login.
3. Fetch own user.
4. List contacts.
5. Create contact.
6. List deals.
7. Create deal.
8. Fetch dashboard.
9. Run a saved report (tier-1).

Synthetic failures page before most real users notice. They also form the
"is the front door open?" signal during an incident.

## Real user monitoring

- Web client reports Core Web Vitals, JS errors, failed API calls, session-level timings.
- Every reported error is linked to a release and a deploy event, so a bad
  frontend release lights up immediately.
- Privacy: sampled, anonymized, never records input fields.

## Log pipeline

- App → stdout (JSON) → node agent → regional aggregator → durable store.
- Backpressure-safe: if the store is unavailable, agent buffers to disk up to N minutes, then drops oldest.
- **Retention**: 14 days hot, 90 days warm, 7 years cold (compressed, in object storage) for compliance-relevant streams.
- **PII redaction** at the aggregator layer via pattern rules.

## Tracing

- OpenTelemetry instrumentation in every service.
- **Head-based sampling** at 1% for normal traffic.
- **Tail-based sampling** keeps 100% of errored traces and all slow outliers.
- Trace IDs appear in logs, in error tickets, and in every user-facing error UI as a small support code.

## Continuous profiling

- Pyroscope / Parca scrapes prod services at low overhead.
- On-call can ask "what was this pod doing 30 minutes ago?" and see a flamegraph.
- Profiles are tied to deploys so regressions are spotted immediately.

## Dashboards

- **Global Exec Dashboard**: one row per tier, one column per region. Green, yellow, red. No numbers.
- **SLO dashboard**: every SLO, current status, burn rate, time to exhaustion, error budget remaining.
- **Per-service dashboard**: golden signals + dependency health.
- **Per-tenant dashboard**: traffic, error rate, and resource use for a single tenant (used to investigate "tenant X reports slowness").
- **Capacity dashboard**: saturation vs. tested ceiling, time-to-capacity-exhaustion projection.

## On-call runbook template

Every service has `docs/runbooks/<service>.md`:

```
# <Service> Runbook

## What this service does (1 paragraph)

## Dependencies
- Postgres cluster X
- Kafka topics Y
- Downstream services Z

## Dashboards
- Golden signals: <link>
- SLO: <link>

## Common alerts → first actions
- High error rate → 1. Check recent deploy. 2. Check downstream.
- Latency spike → 1. Check DB dashboard. 2. Check GC / CPU.

## Escalation
- Primary on-call: @team-handle
- Secondary: @team-handle-secondary
- Subject expert: @name

## Known failure modes
- ...
```

This is the first thing the on-call responder opens after the runbook link
in the alert.

## Observability of observability

- The monitoring stack has its own monitoring stack in a different failure domain.
- Alertmanager itself is watched by a dead-man's switch: a scheduled heartbeat
  must arrive every minute; if it doesn't, a different channel (SMS via a
  secondary provider) pages the SRE on-call. "Nothing is alerting" is an
  alert.

## Data retention and cost

| Stream | Hot | Warm | Cold |
|---|---|---|---|
| Metrics (high-res) | 15 days | — | — |
| Metrics (downsampled 5m) | — | 13 months | — |
| Metrics (downsampled 1h) | — | — | 5 years |
| Logs (app) | 14 days | 90 days | 7 years (compliance only) |
| Traces | 7 days | 30 days | — |
| Profiles | 7 days | — | — |
| Audit logs | 14 days | — | 7 years immutable |

## Observability budget

Observability costs can rival compute costs. Governance:

- Each team has a monthly observability budget.
- Cardinality / volume anomalies are surfaced weekly.
- Unused dashboards and alerts are flagged quarterly for cleanup.
