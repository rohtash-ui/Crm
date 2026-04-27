-- 0002_create_meta_forms.sql
-- Tracks which Meta Lead Ad forms are subscribed per tenant + connection.

CREATE TABLE IF NOT EXISTS meta_forms (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    form_id         VARCHAR(64)   NOT NULL,
    connection_id   UUID          NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
    form_name       VARCHAR(255),
    polling_enabled BOOLEAN       NOT NULL DEFAULT true,
    last_polled_at  TIMESTAMPTZ,
    last_webhook_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, form_id)
);

CREATE INDEX idx_meta_forms_tenant ON meta_forms(tenant_id);
CREATE INDEX idx_meta_forms_polling ON meta_forms(tenant_id, polling_enabled)
    WHERE polling_enabled = true;

ALTER TABLE meta_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_forms_tenant_isolation ON meta_forms
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
