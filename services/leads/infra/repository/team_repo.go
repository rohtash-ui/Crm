package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// TeamRepo implements domain.TeamRepository.
type TeamRepo struct {
	db *sql.DB
}

func NewTeamRepo(db *sql.DB) *TeamRepo {
	return &TeamRepo{db: db}
}

func (r *TeamRepo) GetTeamByID(ctx context.Context, tenantID, teamID string) (*domain.Team, error) {
	query := `
		SELECT id, tenant_id, name, region_id, project_id, location_id,
		       is_active, created_at, updated_at
		FROM teams
		WHERE tenant_id = $1 AND id = $2`

	team := &domain.Team{}
	var regionID, projectID, locationID sql.NullString

	err := r.db.QueryRowContext(ctx, query, tenantID, teamID).Scan(
		&team.ID, &team.TenantID, &team.Name,
		&regionID, &projectID, &locationID,
		&team.IsActive, &team.CreatedAt, &team.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrTeamNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query team: %w", err)
	}

	team.RegionID = regionID.String
	team.ProjectID = projectID.String
	team.LocationID = locationID.String
	return team, nil
}

func (r *TeamRepo) ListActiveMembers(ctx context.Context, tenantID, teamID string) ([]*domain.TeamMember, error) {
	query := `
		SELECT id, tenant_id, team_id, user_id, user_email, user_name,
		       role, is_active, max_leads, current_lead_count, created_at, updated_at
		FROM team_members
		WHERE tenant_id = $1 AND team_id = $2 AND is_active = TRUE
		ORDER BY id ASC`

	rows, err := r.db.QueryContext(ctx, query, tenantID, teamID)
	if err != nil {
		return nil, fmt.Errorf("query team members: %w", err)
	}
	defer rows.Close()

	var members []*domain.TeamMember
	for rows.Next() {
		m := &domain.TeamMember{}
		if err := rows.Scan(
			&m.ID, &m.TenantID, &m.TeamID, &m.UserID, &m.UserEmail, &m.UserName,
			&m.Role, &m.IsActive, &m.MaxLeads, &m.CurrentLeadCount,
			&m.CreatedAt, &m.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan member: %w", err)
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

func (r *TeamRepo) GetMemberByUserID(ctx context.Context, tenantID, teamID, userID string) (*domain.TeamMember, error) {
	query := `
		SELECT id, tenant_id, team_id, user_id, user_email, user_name,
		       role, is_active, max_leads, current_lead_count, created_at, updated_at
		FROM team_members
		WHERE tenant_id = $1 AND team_id = $2 AND user_id = $3`

	m := &domain.TeamMember{}
	err := r.db.QueryRowContext(ctx, query, tenantID, teamID, userID).Scan(
		&m.ID, &m.TenantID, &m.TeamID, &m.UserID, &m.UserEmail, &m.UserName,
		&m.Role, &m.IsActive, &m.MaxLeads, &m.CurrentLeadCount,
		&m.CreatedAt, &m.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrMemberNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query member: %w", err)
	}
	return m, nil
}

func (r *TeamRepo) IncrementLeadCount(ctx context.Context, tenantID, memberID string) error {
	query := `
		UPDATE team_members
		SET current_lead_count = current_lead_count + 1, updated_at = now()
		WHERE tenant_id = $1 AND id = $2`

	_, err := r.db.ExecContext(ctx, query, tenantID, memberID)
	return err
}

func (r *TeamRepo) DecrementLeadCount(ctx context.Context, tenantID, memberID string) error {
	query := `
		UPDATE team_members
		SET current_lead_count = GREATEST(current_lead_count - 1, 0), updated_at = now()
		WHERE tenant_id = $1 AND id = $2`

	_, err := r.db.ExecContext(ctx, query, tenantID, memberID)
	return err
}
