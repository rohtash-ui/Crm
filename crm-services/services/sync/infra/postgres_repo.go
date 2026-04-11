// Package infra implements the repository interfaces declared in domain/
// using Postgres and Redis.
package infra

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"crm-services/services/sync/domain"
)

// PostgresEntityRepository implements domain.EntityRepository using Postgres.
type PostgresEntityRepository struct {
	db *sql.DB
}

// NewPostgresEntityRepository creates a new Postgres-backed entity repository.
func NewPostgresEntityRepository(db *sql.DB) *PostgresEntityRepository {
	return &PostgresEntityRepository{db: db}
}

// tableForEntityType maps entity type strings to table names.
// This prevents SQL injection by only allowing known table names.
func tableForEntityType(entityType string) (string, error) {
	tables := map[string]string{
		"contact":  "contacts",
		"deal":     "deals",
		"activity": "activities",
		"lead":     "leads",
		"account":  "accounts",
	}
	table, ok := tables[entityType]
	if !ok {
		return "", fmt.Errorf("unknown entity type: %s", entityType)
	}
	return table, nil
}

func (r *PostgresEntityRepository) GetEntity(ctx context.Context, tenantID, entityType, entityID string) (*domain.Entity, error) {
	table, err := tableForEntityType(entityType)
	if err != nil {
		return nil, err
	}

	query := fmt.Sprintf(
		"SELECT id, version, data, updated_at FROM %s WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
		table,
	)

	var id string
	var version int
	var dataJSON []byte
	var updatedAt time.Time

	err = r.db.QueryRowContext(ctx, query, entityID, tenantID).Scan(&id, &version, &dataJSON, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("entity not found: %s/%s", entityType, entityID)
	}
	if err != nil {
		return nil, fmt.Errorf("query entity: %w", err)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(dataJSON, &data); err != nil {
		return nil, fmt.Errorf("unmarshal entity data: %w", err)
	}

	return &domain.Entity{
		EntityType: entityType,
		EntityID:   id,
		Version:    version,
		Data:       data,
		UpdatedAt:  updatedAt,
	}, nil
}

func (r *PostgresEntityRepository) CreateEntity(ctx context.Context, tenantID, entityType, entityID string, data map[string]interface{}) (*domain.Entity, error) {
	table, err := tableForEntityType(entityType)
	if err != nil {
		return nil, err
	}

	dataJSON, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshal entity data: %w", err)
	}

	query := fmt.Sprintf(
		`INSERT INTO %s (id, tenant_id, version, data, created_at, updated_at)
		 VALUES ($1, $2, 1, $3, NOW(), NOW())
		 RETURNING id, version, updated_at`,
		table,
	)

	var id string
	var version int
	var updatedAt time.Time

	err = r.db.QueryRowContext(ctx, query, entityID, tenantID, dataJSON).Scan(&id, &version, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert entity: %w", err)
	}

	return &domain.Entity{
		EntityType: entityType,
		EntityID:   id,
		Version:    version,
		Data:       data,
		UpdatedAt:  updatedAt,
	}, nil
}

func (r *PostgresEntityRepository) UpdateEntity(ctx context.Context, tenantID, entityType, entityID string, data map[string]interface{}, baseVersion int) (*domain.Entity, error) {
	table, err := tableForEntityType(entityType)
	if err != nil {
		return nil, err
	}

	dataJSON, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshal entity data: %w", err)
	}

	// Optimistic locking: only update if version matches baseVersion.
	// Uses jsonb_concat (||) for partial updates — merges new fields into existing data.
	query := fmt.Sprintf(
		`UPDATE %s
		 SET data = data || $1,
		     version = version + 1,
		     updated_at = NOW()
		 WHERE id = $2 AND tenant_id = $3 AND version = $4 AND deleted_at IS NULL
		 RETURNING id, version, data, updated_at`,
		table,
	)

	var id string
	var newVersion int
	var updatedDataJSON []byte
	var updatedAt time.Time

	err = r.db.QueryRowContext(ctx, query, dataJSON, entityID, tenantID, baseVersion).Scan(
		&id, &newVersion, &updatedDataJSON, &updatedAt,
	)
	if err == sql.ErrNoRows {
		// Version mismatch — conflict
		return nil, domain.ErrVersionConflict
	}
	if err != nil {
		return nil, fmt.Errorf("update entity: %w", err)
	}

	var updatedData map[string]interface{}
	if err := json.Unmarshal(updatedDataJSON, &updatedData); err != nil {
		return nil, fmt.Errorf("unmarshal updated data: %w", err)
	}

	return &domain.Entity{
		EntityType: entityType,
		EntityID:   id,
		Version:    newVersion,
		Data:       updatedData,
		UpdatedAt:  updatedAt,
	}, nil
}

func (r *PostgresEntityRepository) DeleteEntity(ctx context.Context, tenantID, entityType, entityID string, baseVersion int) error {
	table, err := tableForEntityType(entityType)
	if err != nil {
		return err
	}

	// Soft delete with optimistic locking
	query := fmt.Sprintf(
		`UPDATE %s
		 SET deleted_at = NOW(),
		     version = version + 1,
		     updated_at = NOW()
		 WHERE id = $1 AND tenant_id = $2 AND version = $3 AND deleted_at IS NULL`,
		table,
	)

	result, err := r.db.ExecContext(ctx, query, entityID, tenantID, baseVersion)
	if err != nil {
		return fmt.Errorf("delete entity: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check rows affected: %w", err)
	}
	if rows == 0 {
		return domain.ErrVersionConflict
	}

	return nil
}

func (r *PostgresEntityRepository) FetchUpdatedSince(ctx context.Context, tenantID, userID string, cursor time.Time, limit int) ([]domain.Entity, error) {
	// Query each syncable entity type and merge the results.
	// The per-table queries use limit as a reasonable upper bound per table;
	// after merging we sort globally and apply the caller's limit exactly,
	// ensuring the cursor returned by the caller always reflects the true
	// latest updated_at across all entity types.
	entityTables := map[string]string{
		"contact":  "contacts",
		"deal":     "deals",
		"activity": "activities",
		"lead":     "leads",
		"account":  "accounts",
	}

	entities := make([]domain.Entity, 0)

	for entityType, table := range entityTables {
		query := fmt.Sprintf(
			`SELECT id, version, data, updated_at FROM %s
			 WHERE tenant_id = $1 AND updated_at > $2
			 ORDER BY updated_at ASC
			 LIMIT $3`,
			table,
		)

		rows, err := r.db.QueryContext(ctx, query, tenantID, cursor, limit)
		if err != nil {
			return nil, fmt.Errorf("fetch updates from %s: %w", table, err)
		}

		for rows.Next() {
			var id string
			var version int
			var dataJSON []byte
			var updatedAt time.Time

			if err := rows.Scan(&id, &version, &dataJSON, &updatedAt); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan row from %s: %w", table, err)
			}

			var data map[string]interface{}
			if err := json.Unmarshal(dataJSON, &data); err != nil {
				rows.Close()
				return nil, fmt.Errorf("unmarshal data from %s: %w", table, err)
			}

			entities = append(entities, domain.Entity{
				EntityType: entityType,
				EntityID:   id,
				Version:    version,
				Data:       data,
				UpdatedAt:  updatedAt,
			})
		}
		rows.Close()

		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("iterate rows from %s: %w", table, err)
		}
	}

	// Sort globally by updated_at ASC so the cursor (last entry's UpdatedAt) is correct
	// and the caller's limit slices a consistent window across all entity types.
	sort.Slice(entities, func(i, j int) bool {
		return entities[i].UpdatedAt.Before(entities[j].UpdatedAt)
	})

	// Apply the global limit after sorting
	if len(entities) > limit {
		entities = entities[:limit]
	}

	return entities, nil
}
