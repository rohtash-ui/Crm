-- 0008_create_lead_assignment_log.sql
-- Immutable audit log of all lead assignment changes.

CREATE TABLE IF NOT EXISTS lead_assignment_log (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID            NOT NULL,
    lead_id         UUID            NOT NULL REFERENCES leads(id),
    -- Assignment details
    assigned_from   UUID,                                   -- previous assignee (NULL if first)
    assigned_to     UUID            NOT NULL,                -- new assignee
    assigned_by     UUID            NOT NULL,                -- who triggered it (system user for auto)
    method          assignment_method NOT NULL,
    rule_id         UUID            REFERENCES lead_assignment_rules(id),
    reason          TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignment_log_tenant ON lead_assignment_log(tenant_id);
CREATE INDEX idx_assignment_log_lead ON lead_assignment_log(lead_id);
CREATE INDEX idx_assignment_log_assignee ON lead_assignment_log(assigned_to);
CREATE INDEX idx_assignment_log_time ON lead_assignment_log(tenant_id, created_at DESC);

ALTER TABLE lead_assignment_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY assignment_log_tenant_isolation ON lead_assignment_log
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
