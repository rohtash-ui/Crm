package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type outboxRepo struct {
	db *sql.DB
}

func NewOutboxRepo(db *sql.DB) domain.OutboxRepo {
	return &outboxRepo{db: db}
}

func (r *outboxRepo) InsertTx(ctx context.Context, tx *sql.Tx, entry *domain.OutboxEntry) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO meta_outbox (tenant_id, aggregate_id, event_type, payload, partition_key)
		 VALUES ($1, $2, $3, $4, $5)`,
		entry.TenantID, entry.AggregateID, entry.EventType, entry.Payload, entry.PartitionKey,
	)
	if err != nil {
		return fmt.Errorf("insert outbox entry: %w", err)
	}
	return nil
}

func (r *outboxRepo) ListUnpublished(ctx context.Context, limit int) ([]domain.OutboxEntry, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, tenant_id, aggregate_id, event_type, payload, partition_key, created_at, attempts
		 FROM meta_outbox
		 WHERE published_at IS NULL
		 ORDER BY created_at ASC
		 LIMIT $1
		 FOR UPDATE SKIP LOCKED`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list unpublished: %w", err)
	}
	defer rows.Close()

	var entries []domain.OutboxEntry
	for rows.Next() {
		var e domain.OutboxEntry
		if err := rows.Scan(&e.ID, &e.TenantID, &e.AggregateID, &e.EventType,
			&e.Payload, &e.PartitionKey, &e.CreatedAt, &e.Attempts); err != nil {
			return nil, fmt.Errorf("scan outbox entry: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func (r *outboxRepo) MarkPublished(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE meta_outbox SET published_at = now() WHERE id = $1`, id,
	)
	return err
}

func (r *outboxRepo) IncrementAttempts(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE meta_outbox SET attempts = attempts + 1 WHERE id = $1`, id,
	)
	return err
}
