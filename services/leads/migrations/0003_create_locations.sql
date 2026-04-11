-- 0003_create_locations.sql
-- Locations represent physical office or branch locations.
-- Round-robin assignment can be scoped per location.

CREATE TABLE IF NOT EXISTS locations (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    name        VARCHAR(255) NOT NULL,
    code        VARCHAR(50)  NOT NULL,
    address     TEXT,
    city        VARCHAR(100),
    state       VARCHAR(100),
    country     VARCHAR(100),
    region_id   UUID        REFERENCES regions(id),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_locations_tenant ON locations(tenant_id);
CREATE INDEX idx_locations_region ON locations(region_id) WHERE region_id IS NOT NULL;

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_tenant_isolation ON locations
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
