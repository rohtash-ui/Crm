# 04 — Data Layer

Where CRM data lives, how it's replicated, cached, searched, analyzed, and
backed up. The data layer is the hardest part to keep up 24/7 because state
can't be shrugged off like a crashed stateless pod.

## Storage responsibilities

| Store | Purpose | Consistency | Durability |
|---|---|---|---|
| **Postgres** | System of record (OLTP) | Strong within shard | Sync replica + async DR |
| **Redis Cluster** | Cache, sessions, rate-limit counters | Eventual | Ephemeral (rebuildable) |
| **Kafka** | Event backbone, CDC pipe | Ordered within partition | RF=3, min-ISR=2 |
| **OpenSearch / Elasticsearch** | Full-text + faceted search | Near-real-time | Rebuildable from CDC |
| **Object storage (S3-compatible)** | Files, exports, backups | Read-after-write | 11-nines, cross-region replication |
| **ClickHouse / Snowflake** | Analytics, reports at scale | Eventual (minutes) | Rebuildable from Kafka |
| **Vector DB (pgvector / Qdrant)** | Semantic search, AI recall | Eventual | Rebuildable |

Rule: a store is either the **system of record** or **rebuildable**. Everything
rebuildable must have a documented rebuild procedure that is tested on a
schedule.

## Postgres — the system of record

### Topology per region

```
     ┌───────────────────────┐
     │  Writer (primary)     │
     │  ───────────────────  │
     │  synchronous_commit = │
     │  remote_apply         │
     └──────────┬────────────┘
                │ streaming replication
     ┌──────────┴────────────┐
     │                       │
 ┌───▼────┐             ┌────▼─────┐
 │ Sync   │             │  Async   │
 │standby │             │ read     │
 │(same AZ│             │ replicas │
 │diff AZ)│             │ (N)      │
 └────────┘             └──────────┘
     │
     │ async to DR region
 ┌───▼────┐
 │ Region │
 │ C      │
 │standby │
 └────────┘
```

- **Sync standby** in a different AZ → RPO = 0 for AZ failure.
- **Async read replicas** for heavy read workloads (reports, list views).
- **Cross-region async replica** in Region C for regional DR (RPO ≤ 30s typical).

### Sharding

- Tenants are **hash-sharded** on `tenant_id`.
- Start with a small number of logical shards per physical instance (e.g., 32 logical shards, 4 physical instances).
- Add physical instances by re-mapping logical shards → physical via a config map. No data movement without a scheduled rebalance.
- Shard key is in every table's primary key. Cross-tenant queries are forbidden at the application layer.

### Connection management

- **Connection poolers** (PgBouncer / pgcat) sit in front of every Postgres cluster. Application services never connect directly.
- Transaction-mode pooling where possible; session-mode only for specific features.
- Per-service connection budgets, enforced by the pooler. One runaway service cannot eat the whole connection pool.

### Schema evolution

- Expand / contract migrations (see [02](02-code-organization.md)).
- Online schema change tools (`pg_repack`, `pgroll`) for rewrites.
- Every migration is:
  1. Reviewed by platform DB team.
  2. Run on staging against a production-sized clone.
  3. Runtime-gated behind a feature flag until backfill completes.

### PITR and backups

- **WAL archiving** to object storage continuously.
- **Base backups** daily.
- **PITR retention**: 30 days in primary region, 90 days cross-region, 7 years for legal hold tenants.
- **Restore drills**: once a month, automated restore of yesterday's backup to a scratch cluster; a checksum job compares a random sample of tables against production. Any drift pages the data team.

### Corruption containment

- `data_checksums=on` at cluster init.
- Hourly `amcheck` runs in the background.
- Any detected corruption triggers: isolate shard → promote standby → take snapshot for forensics → file post-incident.

## Redis — cache and ephemeral state

- **Cluster mode** with 3+ shards, each with 1 primary + 1 replica in a different AZ.
- Uses:
  - Cache-aside for hot entities (with short TTL + version key for invalidation).
  - Write-through for session data (short TTL, signed).
  - Rate-limit counters (with persistence disabled on these keys to keep it fast).
  - Distributed locks (with lease + fencing token — Redis alone is NOT enough for critical locks; Postgres advisory locks are used when correctness matters).
- **Failure policy**: any Redis failure must degrade to direct DB reads, not error. Caching is a performance optimization, not a correctness dependency.

## Kafka — event backbone

- **Replication factor = 3**, `min.insync.replicas = 2`, `acks = all` on producers.
- **Idempotent producers** and **exactly-once semantics** for consumer groups that update state.
- Topic naming: `<domain>.<entity>.<event>.v<schemaMajor>` (e.g., `crm.deal.created.v1`).
- **Schema registry** (Avro / Protobuf). Breaking schema changes require a new major version and a dual-publish window.
- **Retention**:
  - Operational topics: 7 days.
  - Audit / compliance topics: 90 days hot + archived to object storage forever.
- **Dead-letter topics** for every consumer group. A poison message is isolated, not retried forever.
- **Consumer lag SLO**: p95 lag < 5s for tier-0 topics, < 60s for tier-1.

### CDC (Change Data Capture)

- **Debezium** connectors stream Postgres WAL → Kafka.
- Downstream consumers:
  - Search indexer → OpenSearch.
  - Analytics ETL → warehouse.
  - Audit logger → compliance store.
  - Cache invalidator → Redis.

This means a single Postgres commit is the source of truth, and every derived
view is eventually consistent from the same WAL. Rebuilding a derived store
= replay from Kafka.

## OpenSearch / Elasticsearch

- **3 master nodes** (dedicated), **6+ data nodes** across 3 AZs.
- **Primary + 1 replica** per shard minimum.
- **Index-per-tenant** for top tenants (isolation), **shared index with routing key** for the long tail.
- **Rebuild procedure**: spin up empty cluster, replay CDC from Kafka from T − 24h, swap alias. Tested quarterly.

## Object storage

- S3-compatible, multi-AZ by default.
- **Cross-region replication** for files, exports, backups.
- **Object lock** (WORM) for compliance-critical data (audit logs, legal hold).
- **Lifecycle policies**: hot → warm → cold → archive per data class.
- **Signed URLs** for direct client up/download — services never proxy file bytes.
- **Virus scanning** on upload before making an object visible to other users.

## Analytics / Warehouse

- **ClickHouse** in front (for sub-second dashboard queries on pre-aggregated data) or **Snowflake** / **BigQuery** for ad-hoc SQL at scale.
- Fed by **Kafka → streaming ETL (Flink / Spark Structured Streaming)**.
- Never queried by the OLTP path. Reports hit the warehouse; the live app hits Postgres.

## Data classification & handling

| Class | Examples | Rules |
|---|---|---|
| **P0 — Secrets** | API keys, session tokens | Never logged; KMS-encrypted; short TTL |
| **P1 — PII** | Names, emails, phones | Encrypted at rest + in transit; access audited |
| **P2 — Business** | Deal amounts, notes | Encrypted at rest; access logged |
| **P3 — Public / derived** | Aggregate analytics | Standard controls |

Data classification is a field on every table and logged with every access.

## Multi-tenant isolation

- **Row-level** by default: `WHERE tenant_id = $1` enforced at the data access layer.
- **Postgres RLS** (row-level security) as a belt-and-braces second layer.
- **Schema-per-tenant** for enterprise customers that require it (paid option).
- **DB-per-tenant** for regulated customers (highest isolation, highest cost).
- **Query middleware** tags every query with `tenant_id` for attribution and runaway-query detection.

## Tenant noisy neighbor protection

- Per-tenant connection budget in the pooler.
- Per-tenant query timeout (`statement_timeout`).
- Per-tenant rate limit at the gateway.
- Top 1% of tenants by usage are moved to dedicated shards automatically.
- Long-running queries are killed by a watchdog after their deadline.

## Backup strategy summary

| Store | Method | RPO | Tested |
|---|---|---|---|
| Postgres | WAL + base, cross-region | ≤ 30 s | Monthly restore drill |
| Redis | Not backed up (ephemeral) | N/A | Rebuild from source of truth |
| Kafka | Tiered storage → object storage | ≤ 1 min | Quarterly rebuild test |
| OpenSearch | Snapshot to object storage + CDC replay | ≤ 5 min | Quarterly rebuild test |
| Object storage | Cross-region replication + versioning | ≤ 1 min | Monthly integrity check |
| Warehouse | Snapshot + CDC replay | ≤ 15 min | Quarterly |

**A backup you haven't tested restoring is not a backup.** Restore drills are on the calendar and their success is an SLI.

## Deletion & retention

- **Soft delete** by default (tombstone row); hard delete runs as a scheduled job after retention.
- **Right-to-be-forgotten (GDPR)** requests execute a documented erasure pipeline across Postgres + search + warehouse + object storage + backups (by encryption-key destruction for the retention window) — see [10](10-security-compliance.md).
