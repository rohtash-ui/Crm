# 11 — Offline Sync

How the CRM continues working when the user's device loses network
connectivity, and how it reconciles changes when the connection is restored.

## Problem statement

Field sales reps, traveling account managers, and users in low-connectivity
environments need to view and edit CRM data without a reliable network. When
connectivity returns, local changes must merge with the server state without
data loss or silent overwrites.

## Design goals

1. **Transparent to the user.** The CRM feels the same online or offline — the
   user sees a connectivity indicator, not an error wall.
2. **No data loss.** Every local write is durably stored on the device and
   replayed to the server on reconnect.
3. **Conflict-visible.** When the same record was edited both locally and
   remotely, the user is shown both versions and chooses — no silent
   last-write-wins.
4. **Tenant-isolated.** Offline storage is scoped to `tenant_id` + `user_id`.
   A shared device never leaks data across tenants.
5. **Security-first.** Offline data is encrypted at rest on the device. Session
   expiry is enforced even offline — expired sessions force re-auth on
   reconnect.
6. **Bounded storage.** The device stores a configurable working set, not the
   entire database.

## Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│                      Browser / PWA                       │
│                                                          │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │   UI      │──▶│  Data Access  │──▶│  Sync Engine     │ │
│  │  Layer    │   │    Layer      │   │                  │ │
│  └──────────┘   └──────┬───────┘   │  ┌────────────┐  │ │
│                        │           │  │ Conflict    │  │ │
│                        ▼           │  │ Resolver    │  │ │
│                 ┌──────────────┐   │  └────────────┘  │ │
│                 │  IndexedDB   │   │  ┌────────────┐  │ │
│                 │  (encrypted) │◀──│  │ Change     │  │ │
│                 └──────────────┘   │  │ Tracker    │  │ │
│                                    │  └────────────┘  │ │
│  ┌──────────────────┐              └────────┬─────────┘ │
│  │  Service Worker   │                      │           │
│  │  (cache + BGSync) │                      │           │
│  └──────────────────┘                       │           │
│                                             │           │
│  ┌──────────────────┐                       │           │
│  │  Network Monitor  │───────────────────────┘           │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────┬────────────┘
                                              │
                                              ▼
                                 ┌────────────────────────┐
                                 │   BFF / Sync Endpoint  │
                                 │   POST /api/v1/sync    │
                                 └────────────┬───────────┘
                                              │
                                 ┌────────────▼───────────┐
                                 │   Domain Services      │
                                 │   (Contacts, Deals...) │
                                 └────────────┬───────────┘
                                              │
                                 ┌────────────▼───────────┐
                                 │   Postgres (SoR)       │
                                 └────────────────────────┘
```

## Client-side components

### 1. Offline Store (IndexedDB)

The client maintains a local IndexedDB database per tenant+user pair. It
stores a **working set** — not a full replica.

**Object stores:**

| Store | Purpose | Key |
|---|---|---|
| `entities` | Cached server records (contacts, deals, activities, etc.) | `[entityType, entityId]` |
| `outbox` | Pending mutations queued for sync | auto-increment |
| `metadata` | Sync cursors, schema version, storage quotas | `key` |
| `conflicts` | Records needing user resolution | `[entityType, entityId]` |

**Working set rules:**

- On first login, the client pre-fetches the user's **recently accessed**
  records (last 30 days of contacts, open deals, upcoming activities).
- Tenant admin can configure which entity types are available offline.
- Storage is capped per device (default 100 MB). When approaching the cap,
  the oldest untouched records are evicted (LRU). Records with pending
  outbox entries are never evicted.

**Encryption:**

- All IndexedDB values are encrypted with a key derived from the user's
  session token via PBKDF2.
- On session expiry, the derived key is destroyed — local data becomes
  unreadable until re-auth.
- On explicit logout, all offline stores for that user are wiped.

### 2. Network Monitor

Detects connectivity state using multiple signals:

```
navigator.onLine                    (coarse, but fast)
  + periodic heartbeat GET /health  (accurate, but requires a request)
  + fetch error interception        (real-time signal from actual API calls)
```

The monitor emits a `connectivity-change` event with three states:

| State | Meaning |
|---|---|
| `online` | Server reachable, latency acceptable |
| `degraded` | Server reachable but slow (> 5s RTT) or intermittent errors |
| `offline` | Server unreachable |

**State transitions** require confirmation — a single failed request does not
flip to `offline`; 3 consecutive failures within 10 seconds do. Similarly,
`offline → online` requires 2 consecutive successful heartbeats.

### 3. Change Tracker

Every write the user makes (create, update, delete) while offline is captured
as a **change entry** in the outbox:

```typescript
interface ChangeEntry {
  id: number;                  // auto-increment
  entityType: string;          // "contact", "deal", "activity"
  entityId: string;            // UUID of the record
  action: "create" | "update" | "delete";
  payload: Record<string, unknown>;  // the fields changed (partial for updates)
  baseVersion: number;         // server version this change was based on
  timestamp: number;           // client-side ISO timestamp
  tenantId: string;
  userId: string;
  idempotencyKey: string;      // UUID generated per change, for server dedup
  status: "pending" | "syncing" | "synced" | "conflict" | "failed";
  retryCount: number;
  lastError?: string;
}
```

**Ordering guarantee:** changes are replayed to the server in the order they
were made (FIFO per entity). Cross-entity ordering is not guaranteed because
CRM entities are independent aggregates.

### 4. Sync Engine

The sync engine is the core orchestrator. It runs in two modes:

**Online mode (normal):**
- All writes go directly to the server API.
- Successful responses update the local IndexedDB cache.
- If a write fails due to a transient network error, the change is captured
  in the outbox and the engine switches to offline mode.

**Offline mode:**
- All writes go to the outbox in IndexedDB.
- The UI shows data from the local cache.
- When the Network Monitor reports `online`, the engine begins **draining
  the outbox**.

**Outbox drain procedure:**

```
1. Lock the outbox (prevent new entries from interleaving).
2. Read entries in FIFO order, grouped by entity.
3. For each entry:
   a. Set status = "syncing".
   b. POST to /api/v1/sync with the change payload + idempotencyKey.
   c. On 200: set status = "synced", update local cache with server response.
   d. On 409 (conflict): set status = "conflict", store both versions in
      the conflicts store, notify the UI.
   e. On 4xx (validation): set status = "failed", surface error to user.
   f. On 5xx / network error: stop drain, keep remaining entries as
      "pending", schedule retry with exponential backoff (2s, 4s, 8s, 16s,
      cap at 60s).
4. Unlock the outbox.
```

**Background Sync (Service Worker):**

When supported, the service worker registers a `sync` event so that outbox
drain can happen even when the browser tab is in the background:

```javascript
self.addEventListener('sync', (event) => {
  if (event.tag === 'crm-outbox-drain') {
    event.waitUntil(drainOutbox());
  }
});
```

### 5. Conflict Resolver

When the server returns 409 (version mismatch), both versions are stored:

```typescript
interface ConflictRecord {
  entityType: string;
  entityId: string;
  localVersion: Record<string, unknown>;   // what the user changed offline
  serverVersion: Record<string, unknown>;  // current server state
  localTimestamp: number;
  serverTimestamp: number;
  resolvedAt?: number;
  resolution?: "local" | "server" | "merged";
}
```

**Resolution strategies (user-selectable):**

| Strategy | Behavior |
|---|---|
| **Keep mine** | Client version overwrites server (force-push with new version) |
| **Keep theirs** | Discard local change, accept server state |
| **Merge** | Field-level merge UI — user picks which fields to keep from each |

Conflicts are surfaced in the UI with a dedicated "Pending Conflicts" badge.
Unresolved conflicts block further edits to the same record.

### 6. Service Worker

The service worker handles two responsibilities:

**a) Static asset caching (App Shell):**

```
Cache-first for: HTML shell, JS bundles, CSS, icons, fonts.
Network-first for: API responses.
```

This ensures the CRM application itself loads even when fully offline.

**b) API response caching:**

- GET responses for entity lists and details are cached with a
  `stale-while-revalidate` strategy.
- Cache entries are keyed by `tenant_id + user_id + URL` to prevent
  cross-tenant data leaks.
- Cache TTL: 1 hour for lists, 24 hours for individual records.
- On network failure, the service worker serves the cached response with a
  `X-CRM-Offline: true` header so the UI can show the offline indicator.

## Server-side components

### Sync endpoint

A new BFF endpoint handles batch sync operations:

```
POST /api/v1/sync
Authorization: Bearer <token>
X-Tenant-Id: <tenant_id>
X-Idempotency-Key: <batch_key>

{
  "changes": [
    {
      "idempotencyKey": "uuid-1",
      "entityType": "contact",
      "entityId": "uuid-abc",
      "action": "update",
      "payload": { "phone": "+1-555-0123" },
      "baseVersion": 42,
      "clientTimestamp": "2026-04-11T10:30:00Z"
    }
  ],
  "syncCursor": "2026-04-11T09:00:00Z"
}
```

**Response:**

```json
{
  "results": [
    {
      "idempotencyKey": "uuid-1",
      "status": "applied",
      "entityId": "uuid-abc",
      "newVersion": 43,
      "serverTimestamp": "2026-04-11T12:01:00Z"
    }
  ],
  "updatedEntities": [
    {
      "entityType": "contact",
      "entityId": "uuid-def",
      "version": 17,
      "data": { "...": "..." },
      "updatedAt": "2026-04-11T11:45:00Z"
    }
  ],
  "nextSyncCursor": "2026-04-11T12:01:00Z",
  "hasMore": false
}
```

The response includes both the results of applied changes **and** any
server-side updates the client has missed since its last `syncCursor`.

### Version-based conflict detection

Every entity row has a `version` column (monotonically incrementing integer)
and an `updated_at` timestamp:

```sql
ALTER TABLE contacts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE deals ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activities ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
-- (applied via expand/contract migration)
```

On every update:

```sql
UPDATE contacts
SET phone = $1, version = version + 1, updated_at = NOW()
WHERE id = $2 AND tenant_id = $3 AND version = $4
RETURNING version, updated_at;
```

If `RETURNING` yields no rows, the version has changed → **409 Conflict**.

### Idempotency

The sync endpoint leverages the existing `libs/idempotency` library:

- Each `idempotencyKey` is stored in Redis with a TTL of 24 hours.
- If a replayed request matches a stored key, the original response is
  returned without re-executing.
- This is critical for offline sync because the client may retry the same
  batch if it didn't receive the response (e.g., network dropped mid-sync).

### Sync cursor and delta fetch

The `syncCursor` is a server-side timestamp. On each sync request, the server
queries for all entities the user has access to that were modified after the
cursor:

```sql
SELECT * FROM contacts
WHERE tenant_id = $1
  AND updated_at > $2
  AND (owner_id = $3 OR shared_with @> ARRAY[$3])
ORDER BY updated_at ASC
LIMIT 500;
```

If more than 500 records are pending, `hasMore: true` is returned and the
client continues fetching with the new cursor.

### Kafka events

Sync operations emit standard domain events:

```
crm.contact.updated.v1   (with metadata: source = "offline_sync")
crm.deal.created.v1      (with metadata: source = "offline_sync")
```

The `source = "offline_sync"` metadata allows downstream consumers (audit,
analytics) to distinguish offline-originated changes.

## Security considerations

| Concern | Mitigation |
|---|---|
| **Data at rest on device** | IndexedDB values encrypted with session-derived key |
| **Session expiry** | Sync engine checks token expiry before drain; expired → re-auth required |
| **Shared devices** | Offline store scoped to tenant+user; logout wipes all local data |
| **Tampered payloads** | Server re-validates all business rules on sync; offline does not bypass authorization |
| **Replay attacks** | Idempotency keys deduplicate; version checks prevent stale writes |
| **Data exfiltration** | Working set is bounded; sensitive fields (P0/P1) excluded from offline cache by default |
| **Cross-tenant leaks** | Service worker cache keyed by tenant+user; IndexedDB databases are per-origin per-user |

**P0/P1 field exclusion:** fields marked as P0 (secrets) or P1 (PII) in the
data classification registry are **not cached offline** by default. Tenant
admins can explicitly opt in to offline PII caching (e.g., contact names and
phones for field reps) with an acknowledgment of the device security
requirements.

## Observability

New metrics emitted by the offline sync system:

| Metric | Type | Labels |
|---|---|---|
| `offline_sync_outbox_size` | Gauge | tenant_id, user_id |
| `offline_sync_drain_duration_seconds` | Histogram | tenant_id, status |
| `offline_sync_conflicts_total` | Counter | tenant_id, entity_type |
| `offline_sync_changes_applied_total` | Counter | tenant_id, entity_type, action |
| `offline_sync_changes_failed_total` | Counter | tenant_id, entity_type, error_type |
| `offline_sync_storage_bytes` | Gauge | tenant_id, user_id |
| `offline_sync_session_duration_offline_seconds` | Histogram | tenant_id |

**Alerting:**

- Outbox size > 100 for a single user for > 1 hour → SEV-4 ticket (possible
  stuck sync).
- Conflict rate > 10% of sync operations for a tenant → SEV-3 alert (possible
  workflow issue or stale working sets).
- Sync endpoint error rate follows standard RED alerting via the SLO
  framework.

**Client-side RUM:**

The web client reports offline session metrics to the RUM pipeline:

- Time spent offline per session.
- Number of outbox entries created.
- Sync drain duration and success rate.

## Feature flags

| Flag | Default | Purpose |
|---|---|---|
| `offline_sync.enabled` | `false` | Master kill switch for the entire feature |
| `offline_sync.entity_types` | `["contact","deal","activity"]` | Which entity types support offline |
| `offline_sync.max_storage_mb` | `100` | Per-device storage cap |
| `offline_sync.pii_offline` | `false` | Allow P1 fields in offline cache |
| `offline_sync.background_sync` | `true` | Enable service worker background sync |
| `offline_sync.auto_resolve_nonconflicting` | `true` | Auto-apply changes where server version hasn't changed |

All flags have an owner (`@crm/platform-core`) and an expiry date. The master
kill switch (`offline_sync.enabled`) is a permanent operational flag, not a
launch flag.

## Graceful degradation integration

The offline sync feature extends the degradation table from
[05-high-availability.md](05-high-availability.md):

| Subsystem down | Degraded behavior |
|---|---|
| Client network | Offline mode: reads from cache, writes to outbox, sync on reconnect |
| Sync endpoint | Outbox holds; client retries with backoff; UI shows "sync pending" |
| IndexedDB unavailable | Offline disabled; app works online-only with a banner |

## Migration plan

Offline sync requires schema changes (version columns) on core entity tables.
Following the expand/contract pattern from [02-code-organization.md](02-code-organization.md):

1. **Expand**: add `version` column with default 1 to all entity tables.
   Dual-write: existing update paths increment version.
2. **Migrate**: backfill `version = 1` for all existing rows (already the default).
3. **Switch**: sync endpoint reads version; all update paths use optimistic
   locking.
4. **Contract**: remove legacy update paths that don't check version (next release).

## Limitations

- **Not a full offline database.** Only the user's working set is available
  offline. Complex queries, reports, and search are not available offline.
- **Conflict resolution requires user action.** True concurrent edits to the
  same record require manual resolution — there is no automatic merge for
  conflicting field-level changes.
- **Session-bound.** If the session token expires while offline, the user
  must re-authenticate before sync can proceed. Offline session extension is
  not supported for security reasons.
- **Entity types are opt-in.** Only entity types configured in the feature
  flag are available offline. Complex entities with server-side computed
  fields (e.g., deal forecasts) may have stale computed values offline.

## Related docs

- **Data layer** → [04](04-data-layer.md) — system of record, CDC, caching
- **High availability** → [05](05-high-availability.md) — graceful degradation
- **Security** → [10](10-security-compliance.md) — encryption, tenant isolation
- **Code organization** → [02](02-code-organization.md) — expand/contract migrations
