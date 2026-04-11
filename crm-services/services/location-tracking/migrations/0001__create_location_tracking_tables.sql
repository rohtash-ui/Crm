-- Migration 0001: Create location tracking tables.
--
-- This migration creates the core tables for the location-tracking service:
--   1. location_points     — high-volume GPS fix storage, partitioned by month.
--   2. latest_locations    — real-time "where is everyone now" cache.
--   3. processed_batches   — idempotency guard for batch uploads.
--   4. tracking_config     — per-tenant GPS tracking configuration.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. location_points — partitioned by month for efficient time-range queries
--    and painless data retention (DROP old partitions).
-- ---------------------------------------------------------------------------
CREATE TABLE location_points (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id          TEXT        NOT NULL,
    user_id            TEXT        NOT NULL,
    device_id          TEXT        NOT NULL,
    latitude           DOUBLE PRECISION NOT NULL,
    longitude          DOUBLE PRECISION NOT NULL,
    altitude           DOUBLE PRECISION,
    accuracy           DOUBLE PRECISION NOT NULL,
    heading            DOUBLE PRECISION,
    speed              DOUBLE PRECISION,
    recorded_at        TIMESTAMPTZ NOT NULL,
    battery_level      DOUBLE PRECISION,
    network_type       TEXT        NOT NULL DEFAULT 'unknown',
    is_moving          BOOLEAN     NOT NULL DEFAULT FALSE,
    activity_type      TEXT        NOT NULL DEFAULT 'unknown',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Create partitions for the next 3 months (a cron job creates future ones).
CREATE TABLE location_points_2026_04 PARTITION OF location_points
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE location_points_2026_05 PARTITION OF location_points
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE location_points_2026_06 PARTITION OF location_points
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Index for the primary query pattern: "user X's points in time range".
CREATE INDEX idx_location_points_tenant_user_time
    ON location_points (tenant_id, user_id, recorded_at DESC);

-- Index for spatial queries (e.g. "who was near this account?").
-- Uses the PostGIS extension if available; otherwise a B-tree on lat/lng.
CREATE INDEX idx_location_points_coords
    ON location_points (tenant_id, latitude, longitude);

-- ---------------------------------------------------------------------------
-- 2. latest_locations — denormalized "current position" per user.
--    Updated on every batch ingest. Queried by the live map dashboard.
-- ---------------------------------------------------------------------------
CREATE TABLE latest_locations (
    tenant_id   TEXT        NOT NULL,
    user_id     TEXT        NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    accuracy    DOUBLE PRECISION NOT NULL,
    is_moving   BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (tenant_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 3. processed_batches — idempotency: track which batch IDs we've ingested.
-- ---------------------------------------------------------------------------
CREATE TABLE processed_batches (
    batch_id     TEXT        PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-clean old entries after 7 days (no need to keep them forever).
-- A pg_cron job or application-level cleanup handles this.
CREATE INDEX idx_processed_batches_age ON processed_batches (processed_at);

-- ---------------------------------------------------------------------------
-- 4. tracking_config — per-tenant GPS tracking settings.
-- ---------------------------------------------------------------------------
CREATE TABLE tracking_config (
    tenant_id                   TEXT PRIMARY KEY,
    enabled                     BOOLEAN NOT NULL DEFAULT TRUE,
    mode                        TEXT    NOT NULL DEFAULT 'balanced',
    interval_ms                 INT     NOT NULL DEFAULT 10000,
    distance_filter_meters      DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    batch_upload_interval_ms    INT     NOT NULL DEFAULT 60000,
    max_batch_size              INT     NOT NULL DEFAULT 100,
    background_tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    active_hours_start          INT,     -- 0-23, NULL = all hours
    active_hours_end            INT,     -- 0-23, NULL = all hours
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
