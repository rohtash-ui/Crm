package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type connectionRepo struct {
	db *sql.DB
}

func NewConnectionRepo(db *sql.DB) domain.ConnectionRepo {
	return &connectionRepo{db: db}
}

func (r *connectionRepo) GetByPageID(ctx context.Context, tenantID, pageID string) (*domain.MetaConnection, error) {
	conn := &domain.MetaConnection{}
	err := r.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, page_id, app_id, page_access_token_ciphertext, kms_key_id,
		        token_status, token_expires_at, last_refreshed_at, created_at, updated_at
		 FROM meta_connections
		 WHERE tenant_id = $1 AND page_id = $2`,
		tenantID, pageID,
	).Scan(
		&conn.ID, &conn.TenantID, &conn.PageID, &conn.AppID,
		&conn.PageAccessTokenCiphertext, &conn.KMSKeyID,
		&conn.TokenStatus, &conn.TokenExpiresAt, &conn.LastRefreshedAt,
		&conn.CreatedAt, &conn.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrConnectionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query connection by page_id: %w", err)
	}
	return conn, nil
}

func (r *connectionRepo) GetByID(ctx context.Context, id string) (*domain.MetaConnection, error) {
	conn := &domain.MetaConnection{}
	err := r.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, page_id, app_id, page_access_token_ciphertext, kms_key_id,
		        token_status, token_expires_at, last_refreshed_at, created_at, updated_at
		 FROM meta_connections WHERE id = $1`,
		id,
	).Scan(
		&conn.ID, &conn.TenantID, &conn.PageID, &conn.AppID,
		&conn.PageAccessTokenCiphertext, &conn.KMSKeyID,
		&conn.TokenStatus, &conn.TokenExpiresAt, &conn.LastRefreshedAt,
		&conn.CreatedAt, &conn.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrConnectionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query connection by id: %w", err)
	}
	return conn, nil
}

func (r *connectionRepo) Upsert(ctx context.Context, conn *domain.MetaConnection) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO meta_connections (tenant_id, page_id, app_id, page_access_token_ciphertext, kms_key_id, token_status)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (tenant_id, page_id) DO UPDATE SET
		     page_access_token_ciphertext = EXCLUDED.page_access_token_ciphertext,
		     kms_key_id = EXCLUDED.kms_key_id,
		     token_status = 'active',
		     updated_at = now()`,
		conn.TenantID, conn.PageID, conn.AppID,
		conn.PageAccessTokenCiphertext, conn.KMSKeyID, conn.TokenStatus,
	)
	if err != nil {
		return fmt.Errorf("upsert connection: %w", err)
	}
	return nil
}

func (r *connectionRepo) UpdateTokenStatus(ctx context.Context, id string, status domain.TokenStatus) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE meta_connections SET token_status = $1, updated_at = now() WHERE id = $2`,
		status, id,
	)
	if err != nil {
		return fmt.Errorf("update token status: %w", err)
	}
	return nil
}

func (r *connectionRepo) ListActive(ctx context.Context, tenantID string) ([]domain.MetaConnection, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, tenant_id, page_id, app_id, page_access_token_ciphertext, kms_key_id,
		        token_status, token_expires_at, last_refreshed_at, created_at, updated_at
		 FROM meta_connections
		 WHERE tenant_id = $1 AND token_status = 'active'
		 ORDER BY created_at`,
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("list active connections: %w", err)
	}
	defer rows.Close()

	var conns []domain.MetaConnection
	for rows.Next() {
		var c domain.MetaConnection
		if err := rows.Scan(
			&c.ID, &c.TenantID, &c.PageID, &c.AppID,
			&c.PageAccessTokenCiphertext, &c.KMSKeyID,
			&c.TokenStatus, &c.TokenExpiresAt, &c.LastRefreshedAt,
			&c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan connection: %w", err)
		}
		conns = append(conns, c)
	}
	return conns, rows.Err()
}
