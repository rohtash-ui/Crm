package domain

import (
	"context"
	"database/sql"
	"time"
)

type ConnectionRepo interface {
	GetByPageID(ctx context.Context, tenantID, pageID string) (*MetaConnection, error)
	GetByID(ctx context.Context, id string) (*MetaConnection, error)
	Upsert(ctx context.Context, conn *MetaConnection) error
	UpdateTokenStatus(ctx context.Context, id string, status TokenStatus) error
	ListActive(ctx context.Context, tenantID string) ([]MetaConnection, error)
}

type FormRepo interface {
	GetByFormID(ctx context.Context, tenantID, formID string) (*MetaForm, error)
	Upsert(ctx context.Context, form *MetaForm) error
	ListPollable(ctx context.Context) ([]PollableForm, error)
	UpdateLastPolledAt(ctx context.Context, id string, t time.Time) error
	UpdateLastWebhookAt(ctx context.Context, id string, t time.Time) error
	DisablePollingByConnection(ctx context.Context, connectionID string) error
}

type RawLeadRepo interface {
	InsertTx(ctx context.Context, tx *sql.Tx, lead *MetaRawLead) (inserted bool, err error)
}

type OutboxRepo interface {
	InsertTx(ctx context.Context, tx *sql.Tx, entry *OutboxEntry) error
	ListUnpublished(ctx context.Context, limit int) ([]OutboxEntry, error)
	MarkPublished(ctx context.Context, id int64) error
	IncrementAttempts(ctx context.Context, id int64) error
}

type DeliveryRepo interface {
	MarkDelivered(ctx context.Context, deliveryID string) (isNew bool, err error)
}

type EventPublisher interface {
	Publish(topic string, key string, payload []byte) error
}

type TokenEncryptor interface {
	Encrypt(plaintext []byte, kmsKeyID string) ([]byte, error)
	Decrypt(ciphertext []byte, kmsKeyID string) ([]byte, error)
}

type GraphAPIClient interface {
	GetLead(ctx context.Context, leadgenID string, pageAccessToken string) (*GraphLead, error)
	ListFormLeads(ctx context.Context, formID string, since time.Time, pageAccessToken string) ([]GraphLead, error)
}

type TxBeginner interface {
	BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
}
