package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// AssignmentRuleRepo implements domain.AssignmentRuleRepository.
type AssignmentRuleRepo struct {
	db *sql.DB
}

func NewAssignmentRuleRepo(db *sql.DB) *AssignmentRuleRepo {
	return &AssignmentRuleRepo{db: db}
}

func (r *AssignmentRuleRepo) GetByID(ctx context.Context, tenantID, ruleID string) (*domain.LeadAssignmentRule, error) {
	query := `
		SELECT id, tenant_id, name, scope, project_id, location_id, region_id,
		       team_id, is_active, respect_capacity, priority, created_at, updated_at
		FROM lead_assignment_rules
		WHERE tenant_id = $1 AND id = $2`

	return r.scanOne(r.db.QueryRowContext(ctx, query, tenantID, ruleID))
}

// FindMatchingRule returns the highest-priority active rule matching the given scope.
// Match priority: exact project+location > project only > location only > region > global.
func (r *AssignmentRuleRepo) FindMatchingRule(ctx context.Context, tenantID, projectID, locationID, regionID string) (*domain.LeadAssignmentRule, error) {
	query := `
		SELECT id, tenant_id, name, scope, project_id, location_id, region_id,
		       team_id, is_active, respect_capacity, priority, created_at, updated_at
		FROM lead_assignment_rules
		WHERE tenant_id = $1
		  AND is_active = TRUE
		  AND (
		      (project_id = $2 AND location_id = $3)
		      OR (project_id = $2 AND location_id IS NULL)
		      OR (location_id = $3 AND project_id IS NULL)
		      OR (region_id = $4 AND project_id IS NULL AND location_id IS NULL)
		      OR (scope = 'global' AND project_id IS NULL AND location_id IS NULL AND region_id IS NULL)
		  )
		ORDER BY
		    CASE
		        WHEN project_id = $2 AND location_id = $3 THEN 0
		        WHEN project_id = $2 THEN 1
		        WHEN location_id = $3 THEN 2
		        WHEN region_id = $4 THEN 3
		        ELSE 4
		    END,
		    priority DESC
		LIMIT 1`

	rule, err := r.scanOne(r.db.QueryRowContext(ctx, query,
		tenantID,
		nullString(projectID),
		nullString(locationID),
		nullString(regionID),
	))
	if err == domain.ErrRuleNotFound {
		return nil, nil // no match is not an error
	}
	return rule, err
}

func (r *AssignmentRuleRepo) ListActive(ctx context.Context, tenantID string) ([]*domain.LeadAssignmentRule, error) {
	query := `
		SELECT id, tenant_id, name, scope, project_id, location_id, region_id,
		       team_id, is_active, respect_capacity, priority, created_at, updated_at
		FROM lead_assignment_rules
		WHERE tenant_id = $1 AND is_active = TRUE
		ORDER BY priority DESC, created_at ASC`

	rows, err := r.db.QueryContext(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("query rules: %w", err)
	}
	defer rows.Close()

	var rules []*domain.LeadAssignmentRule
	for rows.Next() {
		rule, err := r.scanRow(rows)
		if err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, rows.Err()
}

func (r *AssignmentRuleRepo) Create(ctx context.Context, rule *domain.LeadAssignmentRule) error {
	if rule.CreatedAt.IsZero() {
		rule.CreatedAt = time.Now().UTC()
	}
	rule.UpdatedAt = rule.CreatedAt

	query := `
		INSERT INTO lead_assignment_rules (
			id, tenant_id, name, scope, project_id, location_id, region_id,
			team_id, is_active, respect_capacity, priority, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`

	_, err := r.db.ExecContext(ctx, query,
		rule.ID, rule.TenantID, rule.Name, rule.Scope,
		nullString(rule.ProjectID), nullString(rule.LocationID), nullString(rule.RegionID),
		rule.TeamID, rule.IsActive, rule.RespectCapacity, rule.Priority,
		rule.CreatedAt, rule.UpdatedAt,
	)
	return err
}

func (r *AssignmentRuleRepo) Update(ctx context.Context, rule *domain.LeadAssignmentRule) error {
	rule.UpdatedAt = time.Now().UTC()

	query := `
		UPDATE lead_assignment_rules
		SET name = $1, scope = $2, project_id = $3, location_id = $4, region_id = $5,
		    team_id = $6, is_active = $7, respect_capacity = $8, priority = $9, updated_at = $10
		WHERE tenant_id = $11 AND id = $12`

	_, err := r.db.ExecContext(ctx, query,
		rule.Name, rule.Scope,
		nullString(rule.ProjectID), nullString(rule.LocationID), nullString(rule.RegionID),
		rule.TeamID, rule.IsActive, rule.RespectCapacity, rule.Priority, rule.UpdatedAt,
		rule.TenantID, rule.ID,
	)
	return err
}

func (r *AssignmentRuleRepo) scanOne(row *sql.Row) (*domain.LeadAssignmentRule, error) {
	rule := &domain.LeadAssignmentRule{}
	var projectID, locationID, regionID sql.NullString

	err := row.Scan(
		&rule.ID, &rule.TenantID, &rule.Name, &rule.Scope,
		&projectID, &locationID, &regionID,
		&rule.TeamID, &rule.IsActive, &rule.RespectCapacity, &rule.Priority,
		&rule.CreatedAt, &rule.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrRuleNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan rule: %w", err)
	}

	rule.ProjectID = projectID.String
	rule.LocationID = locationID.String
	rule.RegionID = regionID.String
	return rule, nil
}

func (r *AssignmentRuleRepo) scanRow(rows *sql.Rows) (*domain.LeadAssignmentRule, error) {
	rule := &domain.LeadAssignmentRule{}
	var projectID, locationID, regionID sql.NullString

	err := rows.Scan(
		&rule.ID, &rule.TenantID, &rule.Name, &rule.Scope,
		&projectID, &locationID, &regionID,
		&rule.TeamID, &rule.IsActive, &rule.RespectCapacity, &rule.Priority,
		&rule.CreatedAt, &rule.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("scan rule row: %w", err)
	}

	rule.ProjectID = projectID.String
	rule.LocationID = locationID.String
	rule.RegionID = regionID.String
	return rule, nil
}
