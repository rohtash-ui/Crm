package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type rawLeadRepo struct {
	db *sql.DB
}

func NewRawLeadRepo(db *sql.DB) domain.RawLeadRepo {
	return &rawLeadRepo{db: db}
}

func (r *rawLeadRepo) InsertTx(ctx context.Context, tx *sql.Tx, lead *domain.MetaRawLead) (bool, error) {
	result, err := tx.ExecContext(ctx,
		`INSERT INTO meta_raw_leads (tenant_id, leadgen_id, form_id, page_id, raw_json, source_path, ingested_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (tenant_id, leadgen_id) DO NOTHING`,
		lead.TenantID, lead.LeadgenID, lead.FormID, lead.PageID,
		lead.RawJSON, lead.SourcePath, lead.IngestedAt,
	)
	if err != nil {
		return false, fmt.Errorf("insert raw lead: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("rows affected: %w", err)
	}

	return rows > 0, nil
}
