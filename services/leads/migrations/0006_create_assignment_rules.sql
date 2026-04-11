-- 0006_create_assignment_rules.sql
-- Configurable round-robin assignment rules scoped by project and/or location.
-- Each rule defines which team participates and the rotation order.

CREATE TYPE assignment_scope AS ENUM ('project', 'location', 'region', 'global');

CREATE TABLE IF NOT EXISTS lead_assignment_rules (
    id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID             NOT NULL,
    name            VARCHAR(255)     NOT NULL,
    scope           assignment_scope NOT NULL DEFAULT 'global',
    -- Scope filters (at least one should be set unless scope is 'global')
    project_id      UUID             REFERENCES projects(id),
    location_id     UUID             REFERENCES locations(id),
    region_id       UUID             REFERENCES regions(id),
    -- Which team to round-robin across
    team_id         UUID             NOT NULL REFERENCES teams(id),
    -- Behavior
    is_active       BOOLEAN          NOT NULL DEFAULT TRUE,
    respect_capacity BOOLEAN         NOT NULL DEFAULT TRUE,  -- skip users at max_leads
    priority        INT              NOT NULL DEFAULT 0,      -- higher = checked first
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_assignment_rules_tenant ON lead_assignment_rules(tenant_id);
CREATE INDEX idx_assignment_rules_active ON lead_assignment_rules(tenant_id, is_active, priority DESC);
CREATE INDEX idx_assignment_rules_project ON lead_assignment_rules(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_assignment_rules_location ON lead_assignment_rules(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX idx_assignment_rules_region ON lead_assignment_rules(region_id) WHERE region_id IS NOT NULL;

ALTER TABLE lead_assignment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY assignment_rules_tenant_isolation ON lead_assignment_rules
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
