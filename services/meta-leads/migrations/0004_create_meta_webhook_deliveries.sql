-- 0004_create_meta_webhook_deliveries.sql
-- Idempotency guard for upstream Meta webhook retries.

CREATE TABLE IF NOT EXISTS meta_webhook_deliveries (
    delivery_id VARCHAR(128) PRIMARY KEY,
    received_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_meta_webhook_deliveries_cleanup ON meta_webhook_deliveries(received_at);
