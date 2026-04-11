package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// RoundRobinStateRepo implements domain.RoundRobinStateRepository.
type RoundRobinStateRepo struct {
	db *sql.DB
}

func NewRoundRobinStateRepo(db *sql.DB) *RoundRobinStateRepo {
	return &RoundRobinStateRepo{db: db}
}

// GetOrCreate returns the current round-robin state for a rule, creating it if absent.
// Uses SELECT ... FOR UPDATE to prevent concurrent rotation conflicts.
func (r *RoundRobinStateRepo) GetOrCreate(ctx context.Context, tenantID, ruleID string) (*domain.RoundRobinState, error) {
	// Try to get existing state with row-level lock
	query := `
		SELECT id, tenant_id, rule_id, last_assigned_member_id, last_assigned_at,
		       rotation_count, created_at, updated_at
		FROM round_robin_state
		WHERE tenant_id = $1 AND rule_id = $2
		FOR UPDATE`

	state := &domain.RoundRobinState{}
	var lastMemberID sql.NullString
	var lastAssignedAt sql.NullTime

	err := r.db.QueryRowContext(ctx, query, tenantID, ruleID).Scan(
		&state.ID, &state.TenantID, &state.RuleID,
		&lastMemberID, &lastAssignedAt,
		&state.RotationCount, &state.CreatedAt, &state.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		// Create initial state
		insertQuery := `
			INSERT INTO round_robin_state (tenant_id, rule_id)
			VALUES ($1, $2)
			RETURNING id, tenant_id, rule_id, last_assigned_member_id, last_assigned_at,
			          rotation_count, created_at, updated_at`

		err = r.db.QueryRowContext(ctx, insertQuery, tenantID, ruleID).Scan(
			&state.ID, &state.TenantID, &state.RuleID,
			&lastMemberID, &lastAssignedAt,
			&state.RotationCount, &state.CreatedAt, &state.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("create rr state: %w", err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("query rr state: %w", err)
	}

	state.LastAssignedMemberID = lastMemberID.String
	if lastAssignedAt.Valid {
		state.LastAssignedAt = &lastAssignedAt.Time
	}

	return state, nil
}

func (r *RoundRobinStateRepo) UpdateLastAssigned(ctx context.Context, state *domain.RoundRobinState) error {
	query := `
		UPDATE round_robin_state
		SET last_assigned_member_id = $1, last_assigned_at = $2,
		    rotation_count = $3, updated_at = $4
		WHERE tenant_id = $5 AND id = $6`

	_, err := r.db.ExecContext(ctx, query,
		nullString(state.LastAssignedMemberID), state.LastAssignedAt,
		state.RotationCount, state.UpdatedAt,
		state.TenantID, state.ID,
	)
	return err
}
