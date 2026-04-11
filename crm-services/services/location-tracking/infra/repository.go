// Package infra implements the persistence layer for location tracking.
package infra

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"crm-services/services/location-tracking/domain"
)

// PostgresRepository implements domain.Repository using PostgreSQL.
type PostgresRepository struct {
	db *sql.DB
}

// NewPostgresRepository creates a repository backed by the given Postgres pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) SaveBatch(ctx context.Context, tenantID string, points []domain.LocationPoint) error {
	if len(points) == 0 {
		return nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// Build a multi-row INSERT for efficiency.
	const cols = "(tenant_id, user_id, device_id, latitude, longitude, altitude, accuracy, heading, speed, recorded_at, battery_level, network_type, is_moving, activity_type)"
	valueStrings := make([]string, len(points))
	valueArgs := make([]any, 0, len(points)*14)

	for i, p := range points {
		base := i * 14
		valueStrings[i] = fmt.Sprintf(
			"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
			base+1, base+2, base+3, base+4, base+5, base+6, base+7,
			base+8, base+9, base+10, base+11, base+12, base+13, base+14,
		)
		valueArgs = append(valueArgs,
			p.TenantID, p.UserID, p.DeviceID,
			p.Latitude, p.Longitude, p.Altitude, p.Accuracy,
			p.Heading, p.Speed, p.Timestamp,
			p.BatteryLevel, p.NetworkType, p.IsMoving, string(p.ActivityType),
		)
	}

	query := fmt.Sprintf(
		"INSERT INTO location_points %s VALUES %s",
		cols, strings.Join(valueStrings, ","),
	)

	if _, err := tx.ExecContext(ctx, query, valueArgs...); err != nil {
		return fmt.Errorf("insert points: %w", err)
	}

	return tx.Commit()
}

func (r *PostgresRepository) IsBatchProcessed(ctx context.Context, batchID string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM processed_batches WHERE batch_id = $1)",
		batchID,
	).Scan(&exists)
	return exists, err
}

func (r *PostgresRepository) MarkBatchProcessed(ctx context.Context, batchID string) error {
	_, err := r.db.ExecContext(ctx,
		"INSERT INTO processed_batches (batch_id, processed_at) VALUES ($1, $2) ON CONFLICT DO NOTHING",
		batchID, time.Now(),
	)
	return err
}

func (r *PostgresRepository) QueryPoints(ctx context.Context, q domain.LocationQuery) ([]domain.LocationPoint, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT tenant_id, user_id, device_id,
		       latitude, longitude, altitude, accuracy, heading, speed,
		       recorded_at, battery_level, network_type, is_moving, activity_type, created_at
		FROM location_points
		WHERE tenant_id = $1 AND user_id = $2
		  AND recorded_at >= $3 AND recorded_at <= $4
		ORDER BY recorded_at DESC
		LIMIT $5 OFFSET $6`,
		q.TenantID, q.UserID, q.From, q.To, q.Limit, q.Offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var points []domain.LocationPoint
	for rows.Next() {
		var p domain.LocationPoint
		if err := rows.Scan(
			&p.TenantID, &p.UserID, &p.DeviceID,
			&p.Latitude, &p.Longitude, &p.Altitude, &p.Accuracy, &p.Heading, &p.Speed,
			&p.Timestamp, &p.BatteryLevel, &p.NetworkType, &p.IsMoving, &p.ActivityType, &p.CreatedAt,
		); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

func (r *PostgresRepository) GetLatestLocations(ctx context.Context, tenantID string) ([]domain.LatestLocation, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT tenant_id, user_id, latitude, longitude, accuracy, is_moving, updated_at
		FROM latest_locations
		WHERE tenant_id = $1
		ORDER BY updated_at DESC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var locs []domain.LatestLocation
	for rows.Next() {
		var l domain.LatestLocation
		if err := rows.Scan(&l.TenantID, &l.UserID, &l.Latitude, &l.Longitude, &l.Accuracy, &l.IsMoving, &l.UpdatedAt); err != nil {
			return nil, err
		}
		locs = append(locs, l)
	}
	return locs, rows.Err()
}

func (r *PostgresRepository) UpsertLatestLocation(ctx context.Context, loc domain.LatestLocation) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO latest_locations (tenant_id, user_id, latitude, longitude, accuracy, is_moving, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (tenant_id, user_id) DO UPDATE SET
			latitude   = EXCLUDED.latitude,
			longitude  = EXCLUDED.longitude,
			accuracy   = EXCLUDED.accuracy,
			is_moving  = EXCLUDED.is_moving,
			updated_at = EXCLUDED.updated_at
		WHERE EXCLUDED.updated_at > latest_locations.updated_at`,
		loc.TenantID, loc.UserID, loc.Latitude, loc.Longitude, loc.Accuracy, loc.IsMoving, loc.UpdatedAt,
	)
	return err
}

func (r *PostgresRepository) GetTrackingConfig(ctx context.Context, tenantID string) (*domain.TrackingConfig, error) {
	var cfg domain.TrackingConfig
	err := r.db.QueryRowContext(ctx, `
		SELECT tenant_id, enabled, mode, interval_ms, distance_filter_meters,
		       batch_upload_interval_ms, max_batch_size, background_tracking_enabled,
		       active_hours_start, active_hours_end
		FROM tracking_config
		WHERE tenant_id = $1`,
		tenantID,
	).Scan(
		&cfg.TenantID, &cfg.Enabled, &cfg.Mode, &cfg.IntervalMs, &cfg.DistanceFilterMeters,
		&cfg.BatchUploadIntervalMs, &cfg.MaxBatchSize, &cfg.BackgroundTrackingEnabled,
		&cfg.ActiveHoursStart, &cfg.ActiveHoursEnd,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &cfg, err
}

func (r *PostgresRepository) SaveTrackingConfig(ctx context.Context, cfg domain.TrackingConfig) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO tracking_config
			(tenant_id, enabled, mode, interval_ms, distance_filter_meters,
			 batch_upload_interval_ms, max_batch_size, background_tracking_enabled,
			 active_hours_start, active_hours_end)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (tenant_id) DO UPDATE SET
			enabled                   = EXCLUDED.enabled,
			mode                      = EXCLUDED.mode,
			interval_ms               = EXCLUDED.interval_ms,
			distance_filter_meters    = EXCLUDED.distance_filter_meters,
			batch_upload_interval_ms  = EXCLUDED.batch_upload_interval_ms,
			max_batch_size            = EXCLUDED.max_batch_size,
			background_tracking_enabled = EXCLUDED.background_tracking_enabled,
			active_hours_start        = EXCLUDED.active_hours_start,
			active_hours_end          = EXCLUDED.active_hours_end`,
		cfg.TenantID, cfg.Enabled, cfg.Mode, cfg.IntervalMs, cfg.DistanceFilterMeters,
		cfg.BatchUploadIntervalMs, cfg.MaxBatchSize, cfg.BackgroundTrackingEnabled,
		cfg.ActiveHoursStart, cfg.ActiveHoursEnd,
	)
	return err
}
