# 11 — Meta (Facebook) Lead Ads Integration

## Overview

The Meta Leads service (`services/meta-leads/`) ingests leads from Facebook/Instagram
Lead Ad forms and publishes them as `crm.lead.created.v1` events onto the Kafka backbone.
It supports two ingestion paths:

- **Webhook (push):** Meta sends `leadgen` events to `POST /webhooks/meta` in real-time.
- **Polling (pull):** A background worker polls `/{form_id}/leads` every 5 minutes as a safety net.

Both paths converge on the same ingest pipeline with DB-level deduplication and a
transactional outbox for at-least-once Kafka delivery.

## Architecture

```
Meta Lead Ads  ──POST──►  /webhooks/meta
                            │  HMAC verify (X-Hub-Signature-256)
                            │  dedupe delivery_id
                            ▼
                   Graph API: GET /{leadgen_id}
                            │
                            ▼
Poller (5min) ──GET──►  /{form_id}/leads?since=...
                            │
                            ▼
                   ┌── BEGIN TX ──┐
                   │ raw_lead_repo│  (UNIQUE on tenant_id, leadgen_id)
                   │ outbox_repo  │  (same transaction)
                   └── COMMIT ────┘
                            │
                   Outbox Relay (1s tick)
                            │
                            ▼
                   Kafka: crm.lead.created.v1
```

## Configuration

| Env Var | Description | Default |
|---|---|---|
| `META_APP_ID` | Facebook App ID | (required) |
| `META_APP_SECRET` | Facebook App Secret (P0 secret) | (required) |
| `META_GRAPH_API_VERSION` | Graph API version | `v18.0` |
| `META_WEBHOOK_VERIFY_TOKEN` | Random string for webhook handshake | (required) |
| `DATABASE_URL` | Postgres connection string | (required) |
| `KAFKA_BROKERS` | Comma-separated broker addresses | `localhost:9092` |
| `KMS_KEY_ID` | Key ID for envelope encryption | (required) |
| `POLL_INTERVAL_SECONDS` | How often the poller runs | `300` |
| `POLL_SAFETY_OVERLAP_SECONDS` | How far back to look for safety | `600` |
| `HTTP_PORT` | Server port | `8080` |

## Runbook

### Token expired / revoked (190 OAuthException)

**Symptoms:** Webhook ingestion returns errors, polling stops for affected forms.

**What happens automatically:**
1. Graph API returns error code 190.
2. Service marks `meta_connections.token_status = 'revoked'`.
3. Polling is disabled for all forms linked to that connection.
4. `crm.meta_connection.revoked.v1` event is emitted.

**Manual action:**
1. Tenant must re-authorize the Meta page via the app OAuth flow.
2. Use `POST /api/v1/meta/connections` to store the new page access token.
3. Forms will resume polling automatically once the connection is active.

### Meta rate limits (BUC / per-app)

**Symptoms:** `meta_graph_api_latency_ms` spikes, 429 responses.

**What happens automatically:**
- Circuit breaker opens after 5 consecutive failures (60s recovery).
- Poller continues to retry on next tick.

**Manual action:**
- Check `X-App-Usage` and `X-Business-Use-Case-Usage` response headers.
- If approaching 100% utilization, increase `POLL_INTERVAL_SECONDS` temporarily.
- Contact Meta support if BUC limits are too restrictive.

### Webhook signature verification failures

**Symptoms:** `meta_webhook_verification_failures_total` counter increases.

**Common causes:**
- Wrong `META_APP_SECRET` in environment.
- Meta rotated the app secret (rare, but happens during security incidents).
- Request body tampered by a middlebox or proxy.

**Action:**
1. Verify `META_APP_SECRET` matches the value in Facebook Developer Dashboard > App Settings > Basic.
2. If rotating the secret, deploy with the new value. There is no dual-accept window for HMAC — rotation causes brief webhook failures during rollout.

### Kafka broker outage

**Symptoms:** `meta_outbox` table backlog grows, outbox relay logs errors.

**What happens automatically:**
- Leads continue to be written to `meta_raw_leads` and `meta_outbox`.
- Outbox relay retries every 1 second, incrementing `attempts` counter.
- No leads are lost — they queue in the outbox.

**Manual action:**
- Monitor `SELECT count(*) FROM meta_outbox WHERE published_at IS NULL`.
- Once Kafka recovers, the backlog drains automatically.
- If backlog is very large, consider increasing outbox relay batch size.

### Replay from raw leads

To re-emit events for a range of leads (e.g. after a downstream consumer bug):

```sql
-- Insert replay rows into outbox
INSERT INTO meta_outbox (tenant_id, aggregate_id, event_type, payload, partition_key)
SELECT
    tenant_id,
    'meta:' || page_id || ':' || leadgen_id,
    'crm.lead.created.v1',
    raw_json,  -- note: may need to re-map via the lead mapper
    tenant_id
FROM meta_raw_leads
WHERE tenant_id = '<tenant_id>'
  AND ingested_at BETWEEN '<start>' AND '<end>';
```

The outbox relay will pick these up and publish them to Kafka.

### GDPR right-to-erasure

When a lead requests deletion:

1. Delete from `meta_raw_leads` by `leadgen_id`.
2. Delete from `meta_outbox` by `aggregate_id` (if unpublished).
3. Emit a tombstone event to `crm.lead.deleted.v1` for downstream services.
4. Document the erasure in the audit log.

### Poll lag alert

**Threshold:** `meta_poll_lag_seconds > 2 × POLL_INTERVAL_SECONDS` for any active form.

**Causes:**
- Poller goroutine crashed (check logs).
- Database connection pool exhausted.
- Too many forms for the configured concurrency.

**Action:** Increase `POLL_WORKER_CONCURRENCY` or scale replicas.

## Observability

### Metrics

| Metric | Type | Labels |
|---|---|---|
| `meta_leads_ingested_total` | counter | `path` (webhook/poll), `status` (ok/dup/error) |
| `meta_graph_api_latency_ms` | histogram | `endpoint` (get_lead/list_leads) |
| `meta_webhook_verification_failures_total` | counter | — |
| `meta_poll_lag_seconds` | gauge | `form_id` |
| `meta_outbox_backlog` | gauge | — |

### Key log patterns

```
[INGEST] tenant=<id> leadgen_id=<id> source=webhook|poll
[WEBHOOK] signature verification failed
[WEBHOOK] duplicate delivery <id>, skipping
[POLL] tenant=<id> form=<id> leads_fetched=<n>
[POLL ERROR] tenant=<id> form=<id>: <error>
[REVOKED] tenant=<id> page=<id>
[OUTBOX RELAY ERROR] publish id=<n>: <error>
```

## Database tables

- `meta_connections` — per-tenant Meta page credentials (encrypted tokens)
- `meta_forms` — subscribed Lead Ad forms with polling state
- `meta_raw_leads` — staging table for raw Graph API responses (dedupe key: `tenant_id, leadgen_id`)
- `meta_webhook_deliveries` — upstream retry idempotency guard
- `meta_outbox` — transactional outbox for at-least-once Kafka delivery
