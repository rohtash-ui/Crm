-- 0009_create_member_availability.sql
-- Tracks member availability / leave so round-robin skips people who are away.
-- Managers and team leads can mark members as on_leave with date ranges.

CREATE TYPE availability_status AS ENUM (
    'available',    -- actively receiving leads
    'on_leave',     -- scheduled leave (vacation, sick, etc.)
    'unavailable',  -- temporarily pulled from rotation (training, etc.)
    'offline'       -- end of day / not working today
);

CREATE TYPE leave_type AS ENUM (
    'vacation', 'sick', 'personal', 'training',
    'public_holiday', 'half_day', 'other'
);

CREATE TABLE IF NOT EXISTS member_availability (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID                NOT NULL,
    member_id       UUID                NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    user_id         UUID                NOT NULL,
    status          availability_status NOT NULL DEFAULT 'available',
    leave_type      leave_type,
    start_date      DATE                NOT NULL,
    end_date        DATE                NOT NULL,
    reason          TEXT,
    marked_by       UUID                NOT NULL,  -- who set this availability
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),

    CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_availability_tenant ON member_availability(tenant_id);
CREATE INDEX idx_availability_member ON member_availability(member_id);
CREATE INDEX idx_availability_user ON member_availability(user_id);
CREATE INDEX idx_availability_dates ON member_availability(tenant_id, start_date, end_date);
CREATE INDEX idx_availability_active_today ON member_availability(tenant_id, status, start_date, end_date)
    WHERE status != 'available';

ALTER TABLE member_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY availability_tenant_isolation ON member_availability
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
