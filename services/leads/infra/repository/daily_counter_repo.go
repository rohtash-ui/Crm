package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// DailyCounterRepo implements domain.DailyCounterRepository.
type DailyCounterRepo struct {
	db *sql.DB
}

func NewDailyCounterRepo(db *sql.DB) *DailyCounterRepo {
	return &DailyCounterRepo{db: db}
}

// GetOrCreate returns the daily counter for a member on a given date,
// creating one if it doesn't exist.
func (r *DailyCounterRepo) GetOrCreate(ctx context.Context, tenantID, memberID, userID, date string, maxLeads int) (*domain.DailyLeadCounter, error) {
	now := time.Now().UTC()

	query := `
		INSERT INTO daily_lead_counter (tenant_id, member_id, user_id, counter_date, lead_count, max_leads, created_at, updated_at)
		VALUES ($1, $2, $3, $4::date, 0, $5, $6, $7)
		ON CONFLICT (tenant_id, member_id, counter_date)
		DO UPDATE SET updated_at = $7
		RETURNING id, tenant_id, member_id, user_id, counter_date, lead_count, max_leads, created_at, updated_at`

	counter := &domain.DailyLeadCounter{}
	err := r.db.QueryRowContext(ctx, query,
		tenantID, memberID, userID, date, maxLeads, now, now,
	).Scan(
		&counter.ID, &counter.TenantID, &counter.MemberID, &counter.UserID,
		&counter.CounterDate, &counter.LeadCount, &counter.MaxLeads,
		&counter.CreatedAt, &counter.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get or create counter: %w", err)
	}
	return counter, nil
}

// Increment increases the daily lead count by 1.
func (r *DailyCounterRepo) Increment(ctx context.Context, tenantID, memberID, date string) error {
	query := `
		UPDATE daily_lead_counter
		SET lead_count = lead_count + 1, updated_at = now()
		WHERE tenant_id = $1 AND member_id = $2 AND counter_date = $3::date`

	result, err := r.db.ExecContext(ctx, query, tenantID, memberID, date)
	if err != nil {
		return fmt.Errorf("increment counter: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		// Counter doesn't exist yet, create with count=1
		insertQuery := `
			INSERT INTO daily_lead_counter (tenant_id, member_id, user_id, counter_date, lead_count, max_leads, created_at, updated_at)
			VALUES ($1, $2, $2, $3::date, 1, 50, now(), now())
			ON CONFLICT (tenant_id, member_id, counter_date)
			DO UPDATE SET lead_count = daily_lead_counter.lead_count + 1, updated_at = now()`

		_, err = r.db.ExecContext(ctx, insertQuery, tenantID, memberID, date)
		if err != nil {
			return fmt.Errorf("insert and increment counter: %w", err)
		}
	}
	return nil
}

// GetByDate returns all daily counters for a tenant on a given date.
func (r *DailyCounterRepo) GetByDate(ctx context.Context, tenantID, date string) ([]*domain.DailyLeadCounter, error) {
	query := `
		SELECT id, tenant_id, member_id, user_id, counter_date, lead_count, max_leads, created_at, updated_at
		FROM daily_lead_counter
		WHERE tenant_id = $1 AND counter_date = $2::date
		ORDER BY lead_count DESC`

	rows, err := r.db.QueryContext(ctx, query, tenantID, date)
	if err != nil {
		return nil, fmt.Errorf("query counters: %w", err)
	}
	defer rows.Close()

	var counters []*domain.DailyLeadCounter
	for rows.Next() {
		c := &domain.DailyLeadCounter{}
		if err := rows.Scan(
			&c.ID, &c.TenantID, &c.MemberID, &c.UserID,
			&c.CounterDate, &c.LeadCount, &c.MaxLeads,
			&c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan counter: %w", err)
		}
		counters = append(counters, c)
	}
	return counters, rows.Err()
}
