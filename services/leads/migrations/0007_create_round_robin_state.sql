-- 0007_create_round_robin_state.sql
-- Tracks the current position in the round-robin rotation per assignment rule.
-- Uses SELECT ... FOR UPDATE SKIP LOCKED for concurrent-safe rotation.

CREATE TABLE IF NOT EXISTS round_robin_state (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    rule_id         UUID        NOT NULL REFERENCES lead_assignment_rules(id) ON DELETE CASCADE,
    -- Current position: index into the ordered team_members list
    last_assigned_member_id UUID,
    last_assigned_at        TIMESTAMPTZ,
    rotation_count          BIGINT  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, rule_id)
);

CREATE INDEX idx_rr_state_tenant ON round_robin_state(tenant_id);
CREATE INDEX idx_rr_state_rule ON round_robin_state(rule_id);

ALTER TABLE round_robin_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY rr_state_tenant_isolation ON round_robin_state
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
