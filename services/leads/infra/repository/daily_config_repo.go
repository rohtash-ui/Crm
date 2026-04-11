package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// DailyConfigRepo implements domain.DailyConfigRepository.
type DailyConfigRepo struct {
	db *sql.DB
}

func NewDailyConfigRepo(db *sql.DB) *DailyConfigRepo {
	return &DailyConfigRepo{db: db}
}

func (r *DailyConfigRepo) GetByDate(ctx context.Context, tenantID, date, ruleID string) (*domain.DailyAssignmentConfig, error) {
	query := `
		SELECT id, tenant_id, config_date, rule_id, is_automation_active,
		       roster, notes, created_by, updated_by, created_at, updated_at
		FROM daily_assignment_config
		WHERE tenant_id = $1 AND config_date = $2::date`

	args := []any{tenantID, date}
	if ruleID != "" {
		query += " AND rule_id = $3"
		args = append(args, ruleID)
	} else {
		query += " AND rule_id IS NULL"
	}

	config := &domain.DailyAssignmentConfig{}
	var ruleIDNull, notes sql.NullString
	var rosterJSON []byte

	err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&config.ID, &config.TenantID, &config.ConfigDate, &ruleIDNull,
		&config.IsAutomationActive, &rosterJSON, &notes,
		&config.CreatedBy, &config.UpdatedBy,
		&config.CreatedAt, &config.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query daily config: %w", err)
	}

	config.RuleID = ruleIDNull.String
	config.Notes = notes.String

	if len(rosterJSON) > 0 {
		_ = json.Unmarshal(rosterJSON, &config.Roster)
	}

	return config, nil
}

func (r *DailyConfigRepo) Upsert(ctx context.Context, config *domain.DailyAssignmentConfig) error {
	if config.CreatedAt.IsZero() {
		config.CreatedAt = time.Now().UTC()
	}
	config.UpdatedAt = time.Now().UTC()

	rosterJSON, err := json.Marshal(config.Roster)
	if err != nil {
		return fmt.Errorf("marshal roster: %w", err)
	}

	query := `
		INSERT INTO daily_assignment_config (
			tenant_id, config_date, rule_id, is_automation_active,
			roster, notes, created_by, updated_by, created_at, updated_at
		) VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (tenant_id, config_date, rule_id)
		DO UPDATE SET
			is_automation_active = EXCLUDED.is_automation_active,
			roster = EXCLUDED.roster,
			notes = EXCLUDED.notes,
			updated_by = EXCLUDED.updated_by,
			updated_at = EXCLUDED.updated_at
		RETURNING id`

	err = r.db.QueryRowContext(ctx, query,
		config.TenantID, config.ConfigDate,
		nullString(config.RuleID), config.IsAutomationActive,
		rosterJSON, nullString(config.Notes),
		config.CreatedBy, config.UpdatedBy,
		config.CreatedAt, config.UpdatedAt,
	).Scan(&config.ID)

	if err != nil {
		return fmt.Errorf("upsert daily config: %w", err)
	}
	return nil
}

func (r *DailyConfigRepo) Delete(ctx context.Context, tenantID, configID string) error {
	query := `DELETE FROM daily_assignment_config WHERE tenant_id = $1 AND id = $2`
	_, err := r.db.ExecContext(ctx, query, tenantID, configID)
	return err
}

func (r *DailyConfigRepo) ListByDateRange(ctx context.Context, tenantID, startDate, endDate string) ([]*domain.DailyAssignmentConfig, error) {
	query := `
		SELECT id, tenant_id, config_date, rule_id, is_automation_active,
		       roster, notes, created_by, updated_by, created_at, updated_at
		FROM daily_assignment_config
		WHERE tenant_id = $1 AND config_date >= $2::date AND config_date <= $3::date
		ORDER BY config_date ASC`

	rows, err := r.db.QueryContext(ctx, query, tenantID, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("query configs: %w", err)
	}
	defer rows.Close()

	var configs []*domain.DailyAssignmentConfig
	for rows.Next() {
		config := &domain.DailyAssignmentConfig{}
		var ruleIDNull, notes sql.NullString
		var rosterJSON []byte

		if err := rows.Scan(
			&config.ID, &config.TenantID, &config.ConfigDate, &ruleIDNull,
			&config.IsAutomationActive, &rosterJSON, &notes,
			&config.CreatedBy, &config.UpdatedBy,
			&config.CreatedAt, &config.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan config row: %w", err)
		}

		config.RuleID = ruleIDNull.String
		config.Notes = notes.String
		if len(rosterJSON) > 0 {
			_ = json.Unmarshal(rosterJSON, &config.Roster)
		}
		configs = append(configs, config)
	}
	return configs, rows.Err()
}
