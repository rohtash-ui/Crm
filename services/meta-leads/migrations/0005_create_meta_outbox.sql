-- 0005_create_meta_outbox.sql
-- Transactional outbox: events are written in the same DB transaction as raw leads,
-- then drained to Kafka by a relay goroutine. Guarantees at-least-once delivery.

CREATE TABLE IF NOT EXISTS meta_outbox (
    id            BIGSERIAL     PRIMARY KEY,
    tenant_id     UUID          NOT NULL,
    aggregate_id  VARCHAR(255)  NOT NULL,
    event_type    VARCHAR(255)  NOT NULL,
    payload       JSONB         NOT NULL,
    partition_key VARCHAR(255)  NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,
    attempts      INT           NOT NULL DEFAULT 0
);

CREATE INDEX idx_meta_outbox_unpublished ON meta_outbox(created_at)
    WHERE published_at IS NULL;
