-- 0005_create_leads.sql
-- Core leads table with assignment tracking fields.

CREATE TYPE lead_status AS ENUM (
    'new', 'assigned', 'contacted', 'qualified',
    'unqualified', 'converted', 'lost'
);

CREATE TYPE lead_source AS ENUM (
    'website', 'referral', 'campaign', 'leadsquare',
    'import', 'manual', 'api', 'social_media', 'other'
);

CREATE TYPE assignment_method AS ENUM (
    'round_robin', 'manual', 'leadsquare_sync', 'rule_based'
);

CREATE TABLE IF NOT EXISTS leads (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID          NOT NULL,
    -- Lead identity
    first_name          VARCHAR(255),
    last_name           VARCHAR(255),
    email               VARCHAR(255),
    phone               VARCHAR(50),
    company             VARCHAR(255),
    -- Classification
    source              lead_source   NOT NULL DEFAULT 'manual',
    status              lead_status   NOT NULL DEFAULT 'new',
    score               INT           DEFAULT 0,
    -- Assignment
    assigned_to         UUID,                           -- user_id of assigned sales rep
    assigned_by         UUID,                           -- user_id who made the assignment
    assigned_at         TIMESTAMPTZ,
    assignment_method   assignment_method,
    -- Scoping
    region_id           UUID          REFERENCES regions(id),
    project_id          UUID          REFERENCES projects(id),
    location_id         UUID          REFERENCES locations(id),
    -- External references
    external_id         VARCHAR(255),                   -- ID from LeadSquare or other source
    external_source     VARCHAR(100),
    -- Metadata
    notes               TEXT,
    custom_fields       JSONB         DEFAULT '{}',
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, external_id, external_source)
);

CREATE INDEX idx_leads_tenant ON leads(tenant_id);
CREATE INDEX idx_leads_status ON leads(tenant_id, status);
CREATE INDEX idx_leads_assigned_to ON leads(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_leads_region ON leads(region_id) WHERE region_id IS NOT NULL;
CREATE INDEX idx_leads_project ON leads(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_leads_location ON leads(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX idx_leads_source ON leads(tenant_id, source);
CREATE INDEX idx_leads_unassigned ON leads(tenant_id, status, created_at)
    WHERE assigned_to IS NULL AND status = 'new';
CREATE INDEX idx_leads_external ON leads(tenant_id, external_id, external_source)
    WHERE external_id IS NOT NULL;

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_tenant_isolation ON leads
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
