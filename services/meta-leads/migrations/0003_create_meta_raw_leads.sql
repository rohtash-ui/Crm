-- 0003_create_meta_raw_leads.sql
-- Staging table for raw lead data from Meta Graph API. Deduplicated by leadgen_id.

CREATE TABLE IF NOT EXISTS meta_raw_leads (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    leadgen_id  VARCHAR(64) NOT NULL,
    form_id     VARCHAR(64) NOT NULL,
    page_id     VARCHAR(64) NOT NULL,
    raw_json    JSONB       NOT NULL,
    source_path TEXT        NOT NULL CHECK (source_path IN ('webhook', 'poll')),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, leadgen_id)
);

CREATE INDEX idx_meta_raw_leads_tenant ON meta_raw_leads(tenant_id);
CREATE INDEX idx_meta_raw_leads_replay ON meta_raw_leads(tenant_id, ingested_at);

ALTER TABLE meta_raw_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_raw_leads_tenant_isolation ON meta_raw_leads
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
