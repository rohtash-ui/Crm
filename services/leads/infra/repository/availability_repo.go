package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// AvailabilityRepo implements domain.AvailabilityRepository.
type AvailabilityRepo struct {
	db *sql.DB
}

func NewAvailabilityRepo(db *sql.DB) *AvailabilityRepo {
	return &AvailabilityRepo{db: db}
}

func (r *AvailabilityRepo) Create(ctx context.Context, entry *domain.MemberAvailability) error {
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = time.Now().UTC()
	}
	entry.UpdatedAt = entry.CreatedAt

	query := `
		INSERT INTO member_availability (
			tenant_id, member_id, user_id, status, leave_type,
			start_date, end_date, reason, marked_by, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id`

	err := r.db.QueryRowContext(ctx, query,
		entry.TenantID, entry.MemberID, entry.UserID,
		entry.Status, nullString(string(entry.LeaveType)),
		entry.StartDate, entry.EndDate,
		nullString(entry.Reason), entry.MarkedBy,
		entry.CreatedAt, entry.UpdatedAt,
	).Scan(&entry.ID)

	if err != nil {
		return fmt.Errorf("insert availability: %w", err)
	}
	return nil
}

func (r *AvailabilityRepo) Update(ctx context.Context, entry *domain.MemberAvailability) error {
	entry.UpdatedAt = time.Now().UTC()

	query := `
		UPDATE member_availability
		SET status = $1, leave_type = $2, start_date = $3, end_date = $4,
		    reason = $5, updated_at = $6
		WHERE tenant_id = $7 AND id = $8`

	_, err := r.db.ExecContext(ctx, query,
		entry.Status, nullString(string(entry.LeaveType)),
		entry.StartDate, entry.EndDate,
		nullString(entry.Reason), entry.UpdatedAt,
		entry.TenantID, entry.ID,
	)
	return err
}

func (r *AvailabilityRepo) Delete(ctx context.Context, tenantID, entryID string) error {
	query := `DELETE FROM member_availability WHERE tenant_id = $1 AND id = $2`
	_, err := r.db.ExecContext(ctx, query, tenantID, entryID)
	return err
}

func (r *AvailabilityRepo) GetByID(ctx context.Context, tenantID, entryID string) (*domain.MemberAvailability, error) {
	query := `
		SELECT id, tenant_id, member_id, user_id, status, leave_type,
		       start_date, end_date, reason, marked_by, created_at, updated_at
		FROM member_availability
		WHERE tenant_id = $1 AND id = $2`

	return r.scanOne(r.db.QueryRowContext(ctx, query, tenantID, entryID))
}

func (r *AvailabilityRepo) ListByMember(ctx context.Context, tenantID, memberID string) ([]*domain.MemberAvailability, error) {
	query := `
		SELECT id, tenant_id, member_id, user_id, status, leave_type,
		       start_date, end_date, reason, marked_by, created_at, updated_at
		FROM member_availability
		WHERE tenant_id = $1 AND member_id = $2
		ORDER BY start_date DESC`

	rows, err := r.db.QueryContext(ctx, query, tenantID, memberID)
	if err != nil {
		return nil, fmt.Errorf("query availability: %w", err)
	}
	defer rows.Close()

	return r.scanRows(rows)
}

// ListUnavailableOnDate returns all non-available entries covering the given date.
func (r *AvailabilityRepo) ListUnavailableOnDate(ctx context.Context, tenantID, date string) ([]*domain.MemberAvailability, error) {
	query := `
		SELECT id, tenant_id, member_id, user_id, status, leave_type,
		       start_date, end_date, reason, marked_by, created_at, updated_at
		FROM member_availability
		WHERE tenant_id = $1
		  AND status != 'available'
		  AND start_date <= $2::date
		  AND end_date >= $2::date`

	rows, err := r.db.QueryContext(ctx, query, tenantID, date)
	if err != nil {
		return nil, fmt.Errorf("query unavailable on date: %w", err)
	}
	defer rows.Close()

	return r.scanRows(rows)
}

func (r *AvailabilityRepo) IsAvailable(ctx context.Context, tenantID, memberID, date string) (bool, error) {
	query := `
		SELECT COUNT(*) FROM member_availability
		WHERE tenant_id = $1 AND member_id = $2
		  AND status != 'available'
		  AND start_date <= $3::date AND end_date >= $3::date`

	var count int
	err := r.db.QueryRowContext(ctx, query, tenantID, memberID, date).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check availability: %w", err)
	}
	return count == 0, nil
}

func (r *AvailabilityRepo) scanOne(row *sql.Row) (*domain.MemberAvailability, error) {
	entry := &domain.MemberAvailability{}
	var leaveType, reason sql.NullString

	err := row.Scan(
		&entry.ID, &entry.TenantID, &entry.MemberID, &entry.UserID,
		&entry.Status, &leaveType,
		&entry.StartDate, &entry.EndDate,
		&reason, &entry.MarkedBy,
		&entry.CreatedAt, &entry.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrMemberNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan availability: %w", err)
	}

	entry.LeaveType = domain.LeaveType(leaveType.String)
	entry.Reason = reason.String
	return entry, nil
}

func (r *AvailabilityRepo) scanRows(rows *sql.Rows) ([]*domain.MemberAvailability, error) {
	var entries []*domain.MemberAvailability
	for rows.Next() {
		entry := &domain.MemberAvailability{}
		var leaveType, reason sql.NullString

		if err := rows.Scan(
			&entry.ID, &entry.TenantID, &entry.MemberID, &entry.UserID,
			&entry.Status, &leaveType,
			&entry.StartDate, &entry.EndDate,
			&reason, &entry.MarkedBy,
			&entry.CreatedAt, &entry.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan availability row: %w", err)
		}

		entry.LeaveType = domain.LeaveType(leaveType.String)
		entry.Reason = reason.String
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}
