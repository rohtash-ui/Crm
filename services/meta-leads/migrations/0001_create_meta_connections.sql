-- 0001_create_meta_connections.sql
-- Stores per-tenant Meta (Facebook) page connections with encrypted access tokens.

CREATE TYPE token_status AS ENUM ('active', 'expired', 'revoked');

CREATE TABLE IF NOT EXISTS meta_connections (
    id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID          NOT NULL,
    page_id                     VARCHAR(64)   NOT NULL,
    app_id                      VARCHAR(64)   NOT NULL,
    page_access_token_ciphertext BYTEA        NOT NULL,
    kms_key_id                  VARCHAR(255)  NOT NULL,
    token_status                token_status  NOT NULL DEFAULT 'active',
    token_expires_at            TIMESTAMPTZ,
    last_refreshed_at           TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, page_id)
);

CREATE INDEX idx_meta_connections_tenant ON meta_connections(tenant_id);
CREATE INDEX idx_meta_connections_active ON meta_connections(tenant_id, token_status)
    WHERE token_status = 'active';

ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_connections_tenant_isolation ON meta_connections
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
