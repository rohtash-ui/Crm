-- Migration: 0001_add_version_columns
--
-- Adds `version` and `deleted_at` columns to all entity tables that support
-- offline sync. These columns enable optimistic locking for conflict detection
-- and soft-delete tracking for sync operations.
--
-- Pattern: expand/contract (phase 1 — expand)
--   - Adds columns with defaults so existing rows are valid
--   - Existing update paths must be updated to increment version (phase 2)
--   - Legacy update paths removed after migration is complete (phase 3)
--
-- Safe for online execution: ALTER TABLE ... ADD COLUMN with DEFAULT is
-- metadata-only in Postgres 11+ and does not rewrite the table.

-- Contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_updated_at ON contacts (tenant_id, updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_version ON contacts (tenant_id, id, version);

-- Deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_updated_at ON deals (tenant_id, updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_version ON deals (tenant_id, id, version);

-- Activities
ALTER TABLE activities ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_updated_at ON activities (tenant_id, updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_version ON activities (tenant_id, id, version);

-- Leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_updated_at ON leads (tenant_id, updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_version ON leads (tenant_id, id, version);

-- Accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_updated_at ON accounts (tenant_id, updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_version ON accounts (tenant_id, id, version);
