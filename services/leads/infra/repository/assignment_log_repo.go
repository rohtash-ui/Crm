package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// AssignmentLogRepo implements domain.AssignmentLogRepository.
type AssignmentLogRepo struct {
	db *sql.DB
}

func NewAssignmentLogRepo(db *sql.DB) *AssignmentLogRepo {
	return &AssignmentLogRepo{db: db}
}

func (r *AssignmentLogRepo) Create(ctx context.Context, logEntry *domain.LeadAssignmentLog) error {
	if logEntry.CreatedAt.IsZero() {
		logEntry.CreatedAt = time.Now().UTC()
	}

	query := `
		INSERT INTO lead_assignment_log (
			tenant_id, lead_id, assigned_from, assigned_to, assigned_by,
			method, rule_id, reason, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id`

	err := r.db.QueryRowContext(ctx, query,
		logEntry.TenantID, logEntry.LeadID,
		nullString(logEntry.AssignedFrom), logEntry.AssignedTo, logEntry.AssignedBy,
		logEntry.Method, nullString(logEntry.RuleID), nullString(logEntry.Reason),
		logEntry.CreatedAt,
	).Scan(&logEntry.ID)

	if err != nil {
		return fmt.Errorf("insert assignment log: %w", err)
	}
	return nil
}

func (r *AssignmentLogRepo) ListByAssignee(ctx context.Context, tenantID, userID string, limit int) ([]*domain.LeadAssignmentLog, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT id, tenant_id, lead_id, assigned_from, assigned_to, assigned_by,
		       method, rule_id, reason, created_at
		FROM lead_assignment_log
		WHERE tenant_id = $1 AND assigned_to = $2
		ORDER BY created_at DESC
		LIMIT $3`

	rows, err := r.db.QueryContext(ctx, query, tenantID, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("query assignee log: %w", err)
	}
	defer rows.Close()

	var logs []*domain.LeadAssignmentLog
	for rows.Next() {
		entry := &domain.LeadAssignmentLog{}
		var assignedFrom, ruleID, reason sql.NullString
		if err := rows.Scan(
			&entry.ID, &entry.TenantID, &entry.LeadID,
			&assignedFrom, &entry.AssignedTo, &entry.AssignedBy,
			&entry.Method, &ruleID, &reason, &entry.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan log: %w", err)
		}
		entry.AssignedFrom = assignedFrom.String
		entry.RuleID = ruleID.String
		entry.Reason = reason.String
		logs = append(logs, entry)
	}
	return logs, rows.Err()
}

func (r *AssignmentLogRepo) ListByLead(ctx context.Context, tenantID, leadID string) ([]*domain.LeadAssignmentLog, error) {
	query := `
		SELECT id, tenant_id, lead_id, assigned_from, assigned_to, assigned_by,
		       method, rule_id, reason, created_at
		FROM lead_assignment_log
		WHERE tenant_id = $1 AND lead_id = $2
		ORDER BY created_at DESC`

	rows, err := r.db.QueryContext(ctx, query, tenantID, leadID)
	if err != nil {
		return nil, fmt.Errorf("query assignment log: %w", err)
	}
	defer rows.Close()

	var logs []*domain.LeadAssignmentLog
	for rows.Next() {
		entry := &domain.LeadAssignmentLog{}
		var assignedFrom, ruleID, reason sql.NullString

		if err := rows.Scan(
			&entry.ID, &entry.TenantID, &entry.LeadID,
			&assignedFrom, &entry.AssignedTo, &entry.AssignedBy,
			&entry.Method, &ruleID, &reason, &entry.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan log row: %w", err)
		}

		entry.AssignedFrom = assignedFrom.String
		entry.RuleID = ruleID.String
		entry.Reason = reason.String
		logs = append(logs, entry)
	}
	return logs, rows.Err()
}
