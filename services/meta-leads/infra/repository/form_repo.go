package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type formRepo struct {
	db *sql.DB
}

func NewFormRepo(db *sql.DB) domain.FormRepo {
	return &formRepo{db: db}
}

func (r *formRepo) GetByFormID(ctx context.Context, tenantID, formID string) (*domain.MetaForm, error) {
	f := &domain.MetaForm{}
	err := r.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, form_id, connection_id, form_name, polling_enabled,
		        last_polled_at, last_webhook_at, created_at, updated_at
		 FROM meta_forms WHERE tenant_id = $1 AND form_id = $2`,
		tenantID, formID,
	).Scan(
		&f.ID, &f.TenantID, &f.FormID, &f.ConnectionID, &f.FormName,
		&f.PollingEnabled, &f.LastPolledAt, &f.LastWebhookAt,
		&f.CreatedAt, &f.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrFormNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query form: %w", err)
	}
	return f, nil
}

func (r *formRepo) Upsert(ctx context.Context, form *domain.MetaForm) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO meta_forms (tenant_id, form_id, connection_id, form_name, polling_enabled)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (tenant_id, form_id) DO UPDATE SET
		     connection_id = EXCLUDED.connection_id,
		     form_name = EXCLUDED.form_name,
		     polling_enabled = EXCLUDED.polling_enabled,
		     updated_at = now()`,
		form.TenantID, form.FormID, form.ConnectionID, form.FormName, form.PollingEnabled,
	)
	if err != nil {
		return fmt.Errorf("upsert form: %w", err)
	}
	return nil
}

func (r *formRepo) ListPollable(ctx context.Context) ([]domain.PollableForm, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT f.id, f.tenant_id, f.form_id, f.connection_id, f.form_name,
		        f.polling_enabled, f.last_polled_at, f.last_webhook_at, f.created_at, f.updated_at,
		        c.id, c.tenant_id, c.page_id, c.app_id, c.page_access_token_ciphertext, c.kms_key_id,
		        c.token_status, c.token_expires_at, c.last_refreshed_at, c.created_at, c.updated_at
		 FROM meta_forms f
		 JOIN meta_connections c ON c.id = f.connection_id
		 WHERE f.polling_enabled = true AND c.token_status = 'active'`,
	)
	if err != nil {
		return nil, fmt.Errorf("list pollable forms: %w", err)
	}
	defer rows.Close()

	var results []domain.PollableForm
	for rows.Next() {
		var pf domain.PollableForm
		if err := rows.Scan(
			&pf.Form.ID, &pf.Form.TenantID, &pf.Form.FormID, &pf.Form.ConnectionID,
			&pf.Form.FormName, &pf.Form.PollingEnabled, &pf.Form.LastPolledAt,
			&pf.Form.LastWebhookAt, &pf.Form.CreatedAt, &pf.Form.UpdatedAt,
			&pf.Connection.ID, &pf.Connection.TenantID, &pf.Connection.PageID,
			&pf.Connection.AppID, &pf.Connection.PageAccessTokenCiphertext, &pf.Connection.KMSKeyID,
			&pf.Connection.TokenStatus, &pf.Connection.TokenExpiresAt,
			&pf.Connection.LastRefreshedAt, &pf.Connection.CreatedAt, &pf.Connection.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan pollable form: %w", err)
		}
		results = append(results, pf)
	}
	return results, rows.Err()
}

func (r *formRepo) UpdateLastPolledAt(ctx context.Context, id string, t time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE meta_forms SET last_polled_at = $1, updated_at = now() WHERE id = $2`,
		t, id,
	)
	return err
}

func (r *formRepo) UpdateLastWebhookAt(ctx context.Context, id string, t time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE meta_forms SET last_webhook_at = $1, updated_at = now() WHERE id = $2`,
		t, id,
	)
	return err
}

func (r *formRepo) DisablePollingByConnection(ctx context.Context, connectionID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE meta_forms SET polling_enabled = false, updated_at = now() WHERE connection_id = $1`,
		connectionID,
	)
	return err
}
