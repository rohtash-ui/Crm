-- 0001_create_regions.sql
-- Regions represent geographic territories for lead routing.
-- Team leads and managers assign leads to these regions.

CREATE TABLE IF NOT EXISTS regions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    name            VARCHAR(255) NOT NULL,
    code            VARCHAR(50)  NOT NULL,
    description     TEXT,
    parent_region_id UUID       REFERENCES regions(id),
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_regions_tenant ON regions(tenant_id);
CREATE INDEX idx_regions_parent ON regions(parent_region_id) WHERE parent_region_id IS NOT NULL;

-- RLS policy
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY regions_tenant_isolation ON regions
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
