-- Migration: 0003_create_external_sync_state
--
-- Tracks the state of external CRM sync jobs. Stores the last successful
-- sync cursor/timestamp per entity type so incremental fetches only pull
-- new or updated records from the legacy CRM.

CREATE TABLE IF NOT EXISTS external_sync_state (
    id              TEXT        NOT NULL,
    tenant_id       TEXT        NOT NULL,
    source          TEXT        NOT NULL,   -- e.g. 'nfs_mecntech'
    entity_type     TEXT        NOT NULL,   -- lead, contact, deal, account, note, activity
    last_sync_at    TIMESTAMPTZ,            -- timestamp of last successful sync
    last_cursor     TEXT,                   -- opaque cursor from external API (page token, offset, etc.)
    records_synced  BIGINT      NOT NULL DEFAULT 0,
    last_error      TEXT,
    error_count     INTEGER     NOT NULL DEFAULT 0,
    status          TEXT        NOT NULL DEFAULT 'idle',  -- idle, running, failed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_external_sync_state_lookup
    ON external_sync_state (tenant_id, source, entity_type);

-- Tracks individual record mappings between external and internal IDs
CREATE TABLE IF NOT EXISTS external_record_map (
    tenant_id       TEXT        NOT NULL,
    source          TEXT        NOT NULL,
    entity_type     TEXT        NOT NULL,
    external_id     TEXT        NOT NULL,
    internal_id     TEXT        NOT NULL,
    external_hash   TEXT,                   -- hash of external data for change detection
    last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, source, entity_type, external_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_external_record_map_internal
    ON external_record_map (tenant_id, entity_type, internal_id);
