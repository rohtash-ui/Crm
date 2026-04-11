package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// LeadRepo implements domain.LeadRepository backed by PostgreSQL.
type LeadRepo struct {
	db *sql.DB
}

func NewLeadRepo(db *sql.DB) *LeadRepo {
	return &LeadRepo{db: db}
}

func (r *LeadRepo) GetByID(ctx context.Context, tenantID, leadID string) (*domain.Lead, error) {
	query := `
		SELECT id, tenant_id, first_name, last_name, email, phone, company,
		       source, status, score, assigned_to, assigned_by, assigned_at,
		       assignment_method, region_id, project_id, location_id,
		       external_id, external_source, notes, custom_fields,
		       created_at, updated_at
		FROM leads
		WHERE tenant_id = $1 AND id = $2`

	lead := &domain.Lead{}
	var (
		assignedTo, assignedBy, assignmentMethod           sql.NullString
		regionID, projectID, locationID                    sql.NullString
		externalID, externalSource, notes                  sql.NullString
		firstName, lastName, email, phone, company         sql.NullString
		assignedAt                                         sql.NullTime
		customFields                                       []byte
	)

	err := r.db.QueryRowContext(ctx, query, tenantID, leadID).Scan(
		&lead.ID, &lead.TenantID, &firstName, &lastName, &email, &phone, &company,
		&lead.Source, &lead.Status, &lead.Score, &assignedTo, &assignedBy, &assignedAt,
		&assignmentMethod, &regionID, &projectID, &locationID,
		&externalID, &externalSource, &notes, &customFields,
		&lead.CreatedAt, &lead.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrLeadNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query lead: %w", err)
	}

	lead.FirstName = firstName.String
	lead.LastName = lastName.String
	lead.Email = email.String
	lead.Phone = phone.String
	lead.Company = company.String
	lead.AssignedTo = assignedTo.String
	lead.AssignedBy = assignedBy.String
	lead.AssignmentMethod = domain.AssignmentMethod(assignmentMethod.String)
	lead.RegionID = regionID.String
	lead.ProjectID = projectID.String
	lead.LocationID = locationID.String
	lead.ExternalID = externalID.String
	lead.ExternalSource = externalSource.String
	lead.Notes = notes.String

	if assignedAt.Valid {
		lead.AssignedAt = &assignedAt.Time
	}

	if len(customFields) > 0 {
		_ = json.Unmarshal(customFields, &lead.CustomFields)
	}

	return lead, nil
}

func (r *LeadRepo) ListUnassigned(ctx context.Context, tenantID string, filter domain.UnassignedFilter) ([]*domain.Lead, error) {
	query := `
		SELECT id, tenant_id, first_name, last_name, email, phone, company,
		       source, status, score, region_id, project_id, location_id,
		       external_id, external_source, created_at, updated_at
		FROM leads
		WHERE tenant_id = $1 AND assigned_to IS NULL AND status = 'new'`

	args := []any{tenantID}
	argIdx := 2

	if filter.ProjectID != "" {
		query += fmt.Sprintf(" AND project_id = $%d", argIdx)
		args = append(args, filter.ProjectID)
		argIdx++
	}
	if filter.LocationID != "" {
		query += fmt.Sprintf(" AND location_id = $%d", argIdx)
		args = append(args, filter.LocationID)
		argIdx++
	}
	if filter.RegionID != "" {
		query += fmt.Sprintf(" AND region_id = $%d", argIdx)
		args = append(args, filter.RegionID)
		argIdx++
	}

	query += " ORDER BY created_at ASC"

	limit := filter.Limit
	if limit <= 0 {
		limit = 100
	}
	query += fmt.Sprintf(" LIMIT $%d", argIdx)
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query unassigned leads: %w", err)
	}
	defer rows.Close()

	var leads []*domain.Lead
	for rows.Next() {
		lead := &domain.Lead{}
		var (
			firstName, lastName, email, phone, company sql.NullString
			regionID, projectID, locationID            sql.NullString
			externalID, externalSource                 sql.NullString
		)

		if err := rows.Scan(
			&lead.ID, &lead.TenantID, &firstName, &lastName, &email, &phone, &company,
			&lead.Source, &lead.Status, &lead.Score, &regionID, &projectID, &locationID,
			&externalID, &externalSource, &lead.CreatedAt, &lead.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan lead row: %w", err)
		}

		lead.FirstName = firstName.String
		lead.LastName = lastName.String
		lead.Email = email.String
		lead.Phone = phone.String
		lead.Company = company.String
		lead.RegionID = regionID.String
		lead.ProjectID = projectID.String
		lead.LocationID = locationID.String
		lead.ExternalID = externalID.String
		lead.ExternalSource = externalSource.String

		leads = append(leads, lead)
	}

	return leads, rows.Err()
}

func (r *LeadRepo) UpdateAssignment(ctx context.Context, lead *domain.Lead) error {
	query := `
		UPDATE leads
		SET assigned_to = $1, assigned_by = $2, assigned_at = $3,
		    assignment_method = $4, status = $5, updated_at = $6
		WHERE tenant_id = $7 AND id = $8`

	_, err := r.db.ExecContext(ctx, query,
		nullString(lead.AssignedTo), nullString(lead.AssignedBy), lead.AssignedAt,
		nullString(string(lead.AssignmentMethod)), lead.Status, lead.UpdatedAt,
		lead.TenantID, lead.ID,
	)
	if err != nil {
		return fmt.Errorf("update lead assignment: %w", err)
	}
	return nil
}

func (r *LeadRepo) Create(ctx context.Context, lead *domain.Lead) error {
	if lead.CreatedAt.IsZero() {
		lead.CreatedAt = time.Now().UTC()
	}
	lead.UpdatedAt = lead.CreatedAt

	customFields, _ := json.Marshal(lead.CustomFields)

	query := `
		INSERT INTO leads (
			id, tenant_id, first_name, last_name, email, phone, company,
			source, status, score, region_id, project_id, location_id,
			external_id, external_source, notes, custom_fields, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7,
			$8, $9, $10, $11, $12, $13,
			$14, $15, $16, $17, $18, $19
		)`

	_, err := r.db.ExecContext(ctx, query,
		lead.ID, lead.TenantID,
		nullString(lead.FirstName), nullString(lead.LastName),
		nullString(lead.Email), nullString(lead.Phone), nullString(lead.Company),
		lead.Source, lead.Status, lead.Score,
		nullString(lead.RegionID), nullString(lead.ProjectID), nullString(lead.LocationID),
		nullString(lead.ExternalID), nullString(lead.ExternalSource),
		nullString(lead.Notes), customFields,
		lead.CreatedAt, lead.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert lead: %w", err)
	}
	return nil
}

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
