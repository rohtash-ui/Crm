-- 0010_create_daily_assignment_config.sql
-- Daily assignment configuration: a controllable roster per day.
-- Admins/managers can set who participates, how many leads they get,
-- and override weights for specific people on specific days.

CREATE TABLE IF NOT EXISTS daily_assignment_config (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    config_date         DATE        NOT NULL,       -- the day this config applies to
    rule_id             UUID        REFERENCES lead_assignment_rules(id),
    -- Global toggles for the day
    is_automation_active BOOLEAN    NOT NULL DEFAULT TRUE,   -- master switch: pause all auto-assignment
    -- Member-level roster (JSONB array of participating members + overrides)
    -- Each entry: { "member_id": "...", "user_id": "...", "max_leads_today": 10, "weight": 1.0, "is_active": true }
    roster              JSONB       NOT NULL DEFAULT '[]',
    notes               TEXT,                               -- admin notes for the day
    created_by          UUID        NOT NULL,
    updated_by          UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, config_date, rule_id)
);

CREATE INDEX idx_daily_config_tenant ON daily_assignment_config(tenant_id);
CREATE INDEX idx_daily_config_date ON daily_assignment_config(tenant_id, config_date);
CREATE INDEX idx_daily_config_rule ON daily_assignment_config(rule_id) WHERE rule_id IS NOT NULL;

ALTER TABLE daily_assignment_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_config_tenant_isolation ON daily_assignment_config
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Tracks daily per-member lead counts so daily caps are enforced.
CREATE TABLE IF NOT EXISTS daily_lead_counter (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    member_id   UUID        NOT NULL REFERENCES team_members(id),
    user_id     UUID        NOT NULL,
    counter_date DATE       NOT NULL,
    lead_count  INT         NOT NULL DEFAULT 0,
    max_leads   INT         NOT NULL DEFAULT 50,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, member_id, counter_date)
);

CREATE INDEX idx_daily_counter_tenant ON daily_lead_counter(tenant_id);
CREATE INDEX idx_daily_counter_date ON daily_lead_counter(tenant_id, counter_date);
CREATE INDEX idx_daily_counter_member ON daily_lead_counter(member_id, counter_date);

ALTER TABLE daily_lead_counter ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_counter_tenant_isolation ON daily_lead_counter
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
