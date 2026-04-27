package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type deliveryRepo struct {
	db *sql.DB
}

func NewDeliveryRepo(db *sql.DB) domain.DeliveryRepo {
	return &deliveryRepo{db: db}
}

func (r *deliveryRepo) MarkDelivered(ctx context.Context, deliveryID string) (bool, error) {
	result, err := r.db.ExecContext(ctx,
		`INSERT INTO meta_webhook_deliveries (delivery_id)
		 VALUES ($1)
		 ON CONFLICT (delivery_id) DO NOTHING`,
		deliveryID,
	)
	if err != nil {
		return false, fmt.Errorf("mark delivered: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("rows affected: %w", err)
	}

	return rows > 0, nil
}
