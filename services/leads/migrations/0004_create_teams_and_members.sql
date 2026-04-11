-- 0004_create_teams_and_members.sql
-- Teams and membership for lead assignment routing.
-- Supports role-based hierarchy: manager > team_lead > sales_rep.

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'team_lead', 'sales_rep');

CREATE TABLE IF NOT EXISTS teams (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    name        VARCHAR(255) NOT NULL,
    region_id   UUID        REFERENCES regions(id),
    project_id  UUID        REFERENCES projects(id),
    location_id UUID        REFERENCES locations(id),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS team_members (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    team_id         UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL,
    user_email      VARCHAR(255) NOT NULL,
    user_name       VARCHAR(255) NOT NULL,
    role            user_role   NOT NULL DEFAULT 'sales_rep',
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    max_leads       INT         DEFAULT 50,  -- capacity cap for round-robin
    current_lead_count INT      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, team_id, user_id)
);

CREATE INDEX idx_teams_tenant ON teams(tenant_id);
CREATE INDEX idx_teams_region ON teams(region_id) WHERE region_id IS NOT NULL;
CREATE INDEX idx_teams_project ON teams(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_teams_location ON teams(location_id) WHERE location_id IS NOT NULL;

CREATE INDEX idx_team_members_tenant ON team_members(tenant_id);
CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_team_members_role ON team_members(tenant_id, role);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY teams_tenant_isolation ON teams
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_members_tenant_isolation ON team_members
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
