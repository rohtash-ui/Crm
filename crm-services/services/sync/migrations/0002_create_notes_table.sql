-- Migration: 0002_create_notes_table
--
-- Creates the `notes` table for storing CRM notes attached to any entity
-- (leads, contacts, deals, accounts, activities). Notes are synced from
-- the legacy CRM (nfs.mecntech.com) and support offline sync.

CREATE TABLE IF NOT EXISTS notes (
    id              TEXT        NOT NULL,
    tenant_id       TEXT        NOT NULL,
    entity_type     TEXT        NOT NULL,   -- parent entity type: lead, contact, deal, account, activity
    entity_id       TEXT        NOT NULL,   -- parent entity ID
    author_id       TEXT,                   -- user who created the note
    author_name     TEXT,                   -- denormalized author display name
    content         TEXT        NOT NULL DEFAULT '',
    note_type       TEXT        NOT NULL DEFAULT 'general',  -- general, call, meeting, email, follow_up
    is_pinned       BOOLEAN     NOT NULL DEFAULT FALSE,
    external_id     TEXT,                   -- ID from legacy CRM for dedup
    external_source TEXT,                   -- e.g. 'nfs_mecntech'
    data            JSONB       NOT NULL DEFAULT '{}',
    version         INTEGER     NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY (id, tenant_id)
);

-- Index for looking up notes by parent entity
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_entity
    ON notes (tenant_id, entity_type, entity_id)
    WHERE deleted_at IS NULL;

-- Index for sync delta queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_updated_at
    ON notes (tenant_id, updated_at);

-- Index for optimistic locking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_version
    ON notes (tenant_id, id, version);

-- Index for deduplication of legacy CRM records
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_external_id
    ON notes (tenant_id, external_source, external_id)
    WHERE external_id IS NOT NULL AND deleted_at IS NULL;
