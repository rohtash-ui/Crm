-- Migration: 0001_create_whatsapp_tables
-- WhatsApp notification service database schema
-- Follows CRM expand/contract migration pattern

-- ─── WhatsApp configuration per tenant ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS whatsapp_config (
    tenant_id         TEXT        PRIMARY KEY,
    business_account_id TEXT      NOT NULL,
    phone_number_id   TEXT        NOT NULL,
    api_version       TEXT        NOT NULL DEFAULT 'v18.0',
    webhook_verify_token TEXT     NOT NULL,
    is_active         BOOLEAN     NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Agent notification preferences (extends identity.agents) ─────────────────

ALTER TABLE agents ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS notification_preferences JSONB
    DEFAULT '{
        "whatsappEnabled": false,
        "enabledEvents": [],
        "timezone": "UTC",
        "minScoreTierForAlert": "cold"
    }'::jsonb;

CREATE INDEX IF NOT EXISTS idx_agents_tenant_active
    ON agents (tenant_id, is_active)
    WHERE is_active = true;

-- ─── WhatsApp messages (outbox + delivery tracking) ───────────────────────────

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id                    UUID        PRIMARY KEY,
    tenant_id             TEXT        NOT NULL,
    agent_id              TEXT        NOT NULL,
    agent_whatsapp_number TEXT        NOT NULL,
    lead_id               TEXT        NOT NULL,
    event_type            TEXT        NOT NULL,
    template_name         TEXT        NOT NULL,
    template_params       JSONB       NOT NULL DEFAULT '{}',
    message_body          TEXT        NOT NULL,
    whatsapp_message_id   TEXT,
    status                TEXT        NOT NULL DEFAULT 'queued',
    error_message         TEXT,
    retry_count           INTEGER     NOT NULL DEFAULT 0,
    max_retries           INTEGER     NOT NULL DEFAULT 3,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at               TIMESTAMPTZ,
    delivered_at          TIMESTAMPTZ,
    read_at               TIMESTAMPTZ,

    CONSTRAINT chk_status CHECK (status IN ('queued','sent','delivered','read','failed'))
);

-- Query patterns: by tenant+lead, by tenant+agent, by status for retries
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_lead
    ON whatsapp_messages (tenant_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_agent
    ON whatsapp_messages (tenant_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_retry
    ON whatsapp_messages (status, retry_count, created_at)
    WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_wa_id
    ON whatsapp_messages (whatsapp_message_id)
    WHERE whatsapp_message_id IS NOT NULL;

-- ─── Notification audit log ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_logs (
    id              UUID        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    agent_id        TEXT        NOT NULL,
    lead_id         TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    event_id        TEXT        NOT NULL,
    message_id      UUID        NOT NULL REFERENCES whatsapp_messages(id),
    status          TEXT        NOT NULL,
    attempt_number  INTEGER     NOT NULL DEFAULT 1,
    response_payload TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant
    ON notification_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_logs_filters
    ON notification_logs (tenant_id, agent_id, lead_id, event_type);

-- ─── Notification templates ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_templates (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     TEXT        NOT NULL,
    event_type    TEXT        NOT NULL,
    template_name TEXT        NOT NULL,
    language      TEXT        NOT NULL DEFAULT 'en',
    header_text   TEXT,
    body_text     TEXT        NOT NULL,
    footer_text   TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, event_type, language)
);

-- ─── Row-Level Security (belt-and-braces tenant isolation) ────────────────────

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;

-- Policy: service role can access rows matching session tenant_id
CREATE POLICY tenant_isolation_messages ON whatsapp_messages
    USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_logs ON notification_logs
    USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_templates ON notification_templates
    USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_config ON whatsapp_config
    USING (tenant_id = current_setting('app.current_tenant_id', true));
