# 11 — Location Tracking (Continuous GPS)

## Purpose

Field sales and service teams need their location tracked continuously so the
CRM can log visit activity, show live team positions on a map, and feed
movement data into analytics.

This document describes how continuous GPS fetching works end-to-end: from the
mobile device **and web browser** to the backend, through the event backbone,
and into downstream consumers.

## Design goals

1. **Always-on** — GPS is fetched continuously while the app is in foreground
   or background, within configurable active hours. On web, tracking runs
   for the full browser session.
2. **Zero data loss** — Updates are buffered locally (SQLite on mobile,
   IndexedDB on web) and uploaded in batches with retries. No GPS fix is
   ever silently dropped.
3. **Battery-conscious** — Configurable accuracy modes, distance filters, and
   active-hour windows keep drain manageable.
4. **Idempotent ingestion** — Every batch has a unique ID; re-uploading the
   same batch is a no-op.
5. **Tenant-configurable** — Each tenant can enable/disable tracking, choose
   accuracy mode, set hours of operation, and tune batch sizes.

## Architecture

```
┌──────────────────────────────┐  ┌───────────────────────────────────────┐
│     Web Browser              │  │           Mobile Device               │
│     (Chrome / Safari)        │  │                                       │
│                              │  │  ┌───────────────┐  ┌──────────────┐  │
│  ┌──────────────────────┐    │  │  │GpsTracking    │─▶│LocationBuffer│  │
│  │ WebGpsTrackingService│    │  │  │Service        │  │Service       │  │
│  │ (watchPosition)      │    │  │  │(watchPosition/│  │(SQLite)      │  │
│  └──────────┬───────────┘    │  │  │ Background)   │  └──────┬───────┘  │
│             │                │  │  └───────────────┘         │          │
│  ┌──────────▼───────────┐    │  │                            │          │
│  │ IndexedDbBuffer      │    │  │               ┌────────────▼───────┐  │
│  │ Service              │    │  │               │LocationUpload     │  │
│  └──────────┬───────────┘    │  │               │Service (shared)   │  │
│             │                │  │               └────────┬──────────┘  │
│  ┌──────────▼───────────┐    │  └────────────────────────┼─────────────┘
│  │ LocationUploadService│    │                           │
│  │ (shared) + sendBeacon│    │                           │
│  └──────────┬───────────┘    │                           │
└─────────────┼────────────────┘                           │
              │  HTTPS POST                                │ HTTPS POST
              └──────────────────────┬─────────────────────┘
                                     ▼
                          ┌─────────────────────┐
                          │   API Gateway        │
                          │  (authn, rate-limit) │
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  Location-Tracking   │
                          │      Service         │
                          │  (Go microservice)   │
                          └──────────┬──────────┘
                                     │
                   ┌─────────────────┼────────────────┐
                   │                 │                │
            ┌──────▼──────┐  ┌───────▼──────┐  ┌─────▼──────┐
            │  Postgres   │  │    Redis     │  │   Kafka    │
            │ (partitioned│  │ (latest_loc  │  │ (location  │
            │  by month)  │  │  cache)      │  │  .events)  │
            └─────────────┘  └──────────────┘  └─────┬──────┘
                                                     │
                               ┌─────────────────────┼──────────┐
                               │                     │          │
                        ┌──────▼──────┐  ┌───────────▼┐  ┌─────▼──────┐
                        │ Activities  │  │  Analytics  │  │   Search   │
                        │ (timeline)  │  │ (heatmaps) │  │  (index)   │
                        └─────────────┘  └────────────┘  └────────────┘
```

## Shared code

Types, configuration, and the upload service are shared between web and mobile:

```
crm-web/shared/gps/
├── types.ts                  # GpsCoordinate, LocationUpdate, LocationBuffer interface, etc.
├── config.ts                 # GPS_DEFAULTS, UPLOAD_RETRY, IDB/SQLite constants
├── LocationUploadService.ts  # Batch upload with retry + sendBeacon (shared)
└── index.ts                  # Public exports
```

Platform-specific code (buffer storage, lifecycle handling) lives in
`crm-web/mobile/` and `crm-web/web/` respectively.

---

## Web client (Chrome / Safari)

### Continuous fetching strategy

The `WebGpsTrackingService` runs for the entire browser session. It is
initialised once via the `useWebGpsTracking` React hook (mounted in the root
App or authenticated layout component) and manages:

| Concern | How |
|---|---|
| **Foreground tracking** | `navigator.geolocation.watchPosition()` with configurable interval and distance filter. Works identically in Chrome and Safari. |
| **Tab hidden / minimized** | On `visibilitychange → hidden`, the buffer is flushed immediately. Chrome throttles background-tab timers to 1/min, so eager flush prevents data gaps. |
| **Page close / navigation** | On `beforeunload`, the last known position is sent via `navigator.sendBeacon()` — a fire-and-forget API that survives page teardown. |
| **Offline resilience** | Every GPS fix is written to IndexedDB (`crm-location-buffer`) before any network call. IndexedDB persists across page reloads, tab closes, and browser restarts. |
| **Session recovery** | On startup, any updates left in IndexedDB from a previous session (e.g. tab crashed, network was down) are drained and uploaded. |
| **Back online** | Listens for the `online` event and triggers an immediate buffer flush when connectivity is restored. |
| **Batch upload** | A timer (default: every 60s) drains the IndexedDB buffer and POSTs to `POST /api/v1/location-tracking/batch`. |
| **Eager flush** | If the buffer reaches `maxBatchSize` (default: 100), it flushes immediately. |
| **Retry with backoff** | Same as mobile: up to 5 retries with exponential backoff + jitter. |
| **Active hours** | Same enforcement as mobile (default: Mon–Fri, 6 AM – 10 PM). |

### Key files

```
crm-web/web/
├── services/gps/
│   ├── WebGpsTrackingService.ts   # Core orchestrator (browser-specific)
│   ├── IndexedDbBufferService.ts  # IndexedDB offline queue
│   └── index.ts                   # Public exports
└── hooks/
    └── useWebGpsTracking.ts       # React hook for app-level integration
```

### Browser requirements

| Requirement | Detail |
|---|---|
| **HTTPS** | Geolocation API requires a secure context in all modern browsers (localhost is exempt). |
| **User gesture** | Safari requires user interaction before prompting for location permission. The hook handles this via `getCurrentPosition()` which triggers the dialog. |
| **Permission** | User must grant "Allow" on the browser's location permission prompt. No "always allow" concept — permission applies while the page is open. |
| **IndexedDB** | Available in Chrome 24+, Safari 10+, Firefox 16+, Edge 12+. |
| **sendBeacon** | Available in Chrome 39+, Safari 11.1+, Firefox 31+. Falls back gracefully. |

### Browser-specific behavior

| Browser | Behavior when tab is hidden |
|---|---|
| **Chrome** | Timers throttled to max 1/min after 5 min. `watchPosition` continues but callbacks may be delayed. Eager flush on `visibilitychange` handles this. |
| **Safari** | More aggressive throttling. Tabs may be fully suspended after ~3 min in background. Eager flush + `beforeunload` beacon ensure no data loss. |
| **Firefox** | Similar to Chrome. Timers throttled but not suspended. |

### Limitations vs. mobile

| Capability | Mobile | Web |
|---|---|---|
| True background tracking | Yes (foreground service / background mode) | No — only while tab is open and active |
| Tracking after app/tab close | Yes (startOnBoot) | No — stops when tab closes; beacon sends last point |
| Accuracy on battery power | Native GPS always available | Browser may use WiFi/IP geolocation when GPS unavailable |
| Persistent device ID | Native device ID | Session-scoped (new per tab via sessionStorage) |

---

## Mobile client

### Continuous fetching strategy

The `GpsTrackingService` runs for the entire app lifecycle. It is initialised
once at app startup via the `useGpsTracking` React hook and manages:

| Concern | How |
|---|---|
| **Foreground tracking** | `navigator.geolocation.watchPosition()` with configurable interval and distance filter. |
| **Background tracking** | `BackgroundLocationService` wraps `react-native-background-geolocation` — uses an Android foreground service and iOS significant-change monitoring. |
| **Offline resilience** | Every GPS fix is written to a local SQLite table (`pending_location_updates`) before any network call. |
| **Batch upload** | A timer (default: every 60s) drains the SQLite buffer and POSTs to `POST /api/v1/location-tracking/batch`. |
| **Eager flush** | If the buffer reaches `maxBatchSize` (default: 100), it flushes immediately. |
| **App backgrounding** | On `AppState → background`, the buffer is flushed so pending data isn't lost if the OS kills the process. |
| **Retry with backoff** | Failed uploads retry up to 5 times with exponential backoff (2s → 4s → 8s → 16s → 32s) plus jitter. After exhausting retries, updates are re-enqueued for the next cycle. |
| **Active hours** | An enforcement timer checks every minute whether the current time falls within the configured active window (default: Mon–Fri, 6 AM – 10 PM). Outside the window, the native watcher is paused. |

### Key files

```
crm-web/mobile/
├── services/gps/
│   ├── types.ts                   # Re-exports from shared
│   ├── GpsTrackingService.ts      # Core orchestrator (mobile-specific)
│   ├── LocationBufferService.ts   # SQLite offline queue
│   ├── BackgroundLocationService.ts # Native background watcher
│   └── index.ts                   # Public exports
├── hooks/
│   └── useGpsTracking.ts          # React hook for app-level integration
└── config/
    └── gpsDefaults.ts             # Re-exports from shared
```

### Permissions required

| Platform | Permission | Why |
|---|---|---|
| Android | `ACCESS_FINE_LOCATION` | High-accuracy GPS |
| Android | `ACCESS_BACKGROUND_LOCATION` | Continue when app is backgrounded |
| Android | `FOREGROUND_SERVICE_LOCATION` | Foreground service type |
| iOS | `NSLocationWhenInUseUsageDescription` | Foreground tracking |
| iOS | `NSLocationAlwaysAndWhenInUseUsageDescription` | Background tracking |
| iOS | `UIBackgroundModes: [location]` | Background mode capability |

## Backend service

### API endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/location-tracking/batch` | Ingest a batch of GPS points (idempotent via `Idempotency-Key`). |
| `GET` | `/api/v1/location-tracking/history` | Query historical points for a user in a time range. |
| `GET` | `/api/v1/location-tracking/live` | Get latest known position for all users in a tenant. |
| `GET` | `/api/v1/location-tracking/config` | Fetch tenant GPS tracking config (used by web and mobile on startup). |

### Data storage

- **`location_points`** — Main time-series table, partitioned by month via
  PostgreSQL range partitioning. Old partitions can be dropped for retention
  without impacting query performance.
- **`latest_locations`** — Denormalized current-position table, upserted on
  every batch ingest. Powers the live map dashboard.
- **`processed_batches`** — Idempotency guard. Batch IDs are stored here and
  checked before ingestion.
- **`tracking_config`** — Per-tenant configuration. Both web and mobile clients
  fetch this on startup and merge it with local defaults.

### Event flow

Every ingested GPS fix emits a `location.recorded` event to Kafka topic
`location.events`. Downstream consumers:

| Consumer | Action |
|---|---|
| **Activities service** | Logs "User was at (lat, lng)" on the contact/deal timeline. |
| **Analytics service** | Aggregates movement data for heatmaps and visit reports. |
| **Search service** | Indexes locations for "who was near X?" queries. |
| **Notifications service** | (Future) Geofence-triggered alerts. |

## Configuration

All values are configurable per-tenant. Defaults:

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Master toggle. |
| `mode` | `balanced` | `high_accuracy`, `balanced`, or `low_power`. |
| `interval_ms` | `10000` | Minimum time between GPS fixes (10s). |
| `distance_filter_meters` | `10` | Minimum distance to trigger an update. |
| `batch_upload_interval_ms` | `60000` | How often to flush buffer to server (1 min). |
| `max_batch_size` | `100` | Max updates per batch. |
| `background_tracking_enabled` | `true` | Track in background. |
| `active_hours` | `6–22` | Hours of day tracking is active. |
| `active_days` | `Mon–Fri` | Days of week tracking is active. |

## Battery impact

Estimated drain at default settings (balanced mode, 10s interval):

| Scenario | Battery / hour |
|---|---|
| Foreground, moving | ~3–5% |
| Background, moving | ~2–3% |
| Stationary (distance filter skips) | ~0.5–1% |

Tenants can reduce drain by switching to `low_power` mode (GPS off, network
triangulation only) or increasing the interval / distance filter.
