package domain

import (
	"context"
	"fmt"
	"time"
)

// Repository is the interface the domain expects from the persistence layer.
type Repository interface {
	// SaveBatch inserts a batch of location points atomically.
	SaveBatch(ctx context.Context, tenantID string, points []LocationPoint) error

	// IsBatchProcessed returns true if the batch ID has already been ingested (idempotency).
	IsBatchProcessed(ctx context.Context, batchID string) (bool, error)

	// MarkBatchProcessed records a batch ID so duplicate uploads are skipped.
	MarkBatchProcessed(ctx context.Context, batchID string) error

	// QueryPoints returns historical location points matching the filter.
	QueryPoints(ctx context.Context, q LocationQuery) ([]LocationPoint, error)

	// GetLatestLocations returns the most recent known position for each user
	// in the given tenant.
	GetLatestLocations(ctx context.Context, tenantID string) ([]LatestLocation, error)

	// UpsertLatestLocation updates the cached "current position" for a user.
	UpsertLatestLocation(ctx context.Context, loc LatestLocation) error

	// GetTrackingConfig returns the GPS tracking config for a tenant.
	GetTrackingConfig(ctx context.Context, tenantID string) (*TrackingConfig, error)

	// SaveTrackingConfig creates or updates the tenant's tracking config.
	SaveTrackingConfig(ctx context.Context, cfg TrackingConfig) error
}

// EventPublisher emits domain events to the event backbone (Kafka).
type EventPublisher interface {
	Publish(ctx context.Context, topic string, key string, payload []byte) error
}

// LocationService is the core business-logic orchestrator.
type LocationService struct {
	repo      Repository
	publisher EventPublisher
}

// NewLocationService creates a LocationService with the given dependencies.
func NewLocationService(repo Repository, pub EventPublisher) *LocationService {
	return &LocationService{repo: repo, publisher: pub}
}

// IngestBatch validates and stores a batch of location points from a device.
// It is idempotent: re-uploading the same batch_id is a no-op.
func (s *LocationService) IngestBatch(ctx context.Context, batch LocationBatch) error {
	if len(batch.Points) == 0 {
		return fmt.Errorf("batch contains no points")
	}
	if batch.BatchID == "" {
		return fmt.Errorf("batch_id is required")
	}

	// Idempotency check.
	processed, err := s.repo.IsBatchProcessed(ctx, batch.BatchID)
	if err != nil {
		return fmt.Errorf("idempotency check: %w", err)
	}
	if processed {
		return nil // already ingested — skip silently
	}

	tenantID := batch.Points[0].TenantID

	// Validate all points belong to the same tenant.
	for i, p := range batch.Points {
		if p.TenantID != tenantID {
			return fmt.Errorf("point %d has tenant_id %q, expected %q", i, p.TenantID, tenantID)
		}
	}

	// Persist.
	if err := s.repo.SaveBatch(ctx, tenantID, batch.Points); err != nil {
		return fmt.Errorf("save batch: %w", err)
	}

	if err := s.repo.MarkBatchProcessed(ctx, batch.BatchID); err != nil {
		return fmt.Errorf("mark batch processed: %w", err)
	}

	// Update the "latest location" cache for each user in the batch.
	latestByUser := latestPerUser(batch.Points)
	for _, loc := range latestByUser {
		if err := s.repo.UpsertLatestLocation(ctx, loc); err != nil {
			// Non-fatal: the cache can be rebuilt. Log and continue.
			continue
		}
	}

	// Emit events for downstream consumers (Activities, Analytics, etc.).
	for _, p := range batch.Points {
		_ = s.publishLocationEvent(ctx, p)
	}

	return nil
}

// GetHistory returns historical GPS points for a user within a time range.
func (s *LocationService) GetHistory(ctx context.Context, q LocationQuery) ([]LocationPoint, error) {
	if q.Limit <= 0 || q.Limit > 1000 {
		q.Limit = 100
	}
	return s.repo.QueryPoints(ctx, q)
}

// GetLiveLocations returns the most recent position for all tracked users
// in a tenant. Used by the "field team map" dashboard.
func (s *LocationService) GetLiveLocations(ctx context.Context, tenantID string) ([]LatestLocation, error) {
	return s.repo.GetLatestLocations(ctx, tenantID)
}

// GetConfig returns the tracking config for a tenant, or sensible defaults.
func (s *LocationService) GetConfig(ctx context.Context, tenantID string) (*TrackingConfig, error) {
	cfg, err := s.repo.GetTrackingConfig(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	if cfg == nil {
		return defaultConfig(tenantID), nil
	}
	return cfg, nil
}

// UpdateConfig updates the tracking config for a tenant.
func (s *LocationService) UpdateConfig(ctx context.Context, cfg TrackingConfig) error {
	return s.repo.SaveTrackingConfig(ctx, cfg)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func latestPerUser(points []LocationPoint) []LatestLocation {
	byUser := make(map[string]LocationPoint)
	for _, p := range points {
		existing, ok := byUser[p.UserID]
		if !ok || p.Timestamp.After(existing.Timestamp) {
			byUser[p.UserID] = p
		}
	}

	result := make([]LatestLocation, 0, len(byUser))
	for _, p := range byUser {
		result = append(result, LatestLocation{
			TenantID:  p.TenantID,
			UserID:    p.UserID,
			Latitude:  p.Latitude,
			Longitude: p.Longitude,
			Accuracy:  p.Accuracy,
			IsMoving:  p.IsMoving,
			UpdatedAt: p.Timestamp,
		})
	}
	return result
}

func (s *LocationService) publishLocationEvent(ctx context.Context, p LocationPoint) error {
	payload := fmt.Appendf(nil,
		`{"event":"location.recorded","tenant_id":%q,"user_id":%q,"lat":%f,"lng":%f,"ts":%q}`,
		p.TenantID, p.UserID, p.Latitude, p.Longitude, p.Timestamp.Format(time.RFC3339),
	)
	return s.publisher.Publish(ctx, "location.events", p.TenantID, payload)
}

func defaultConfig(tenantID string) *TrackingConfig {
	start, end := 6, 22
	return &TrackingConfig{
		TenantID:                  tenantID,
		Enabled:                   true,
		Mode:                      "balanced",
		IntervalMs:                10_000,
		DistanceFilterMeters:      10,
		BatchUploadIntervalMs:     60_000,
		MaxBatchSize:              100,
		BackgroundTrackingEnabled: true,
		ActiveHoursStart:          &start,
		ActiveHoursEnd:            &end,
		ActiveDays:                []int{1, 2, 3, 4, 5},
	}
}
