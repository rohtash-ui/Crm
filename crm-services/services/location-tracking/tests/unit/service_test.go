package unit

import (
	"context"
	"testing"
	"time"

	"crm-services/services/location-tracking/domain"
)

// --- In-memory test doubles ---

type memoryRepo struct {
	points          []domain.LocationPoint
	processedBatch  map[string]bool
	latestLocations map[string]domain.LatestLocation
	config          map[string]*domain.TrackingConfig
}

func newMemoryRepo() *memoryRepo {
	return &memoryRepo{
		processedBatch:  make(map[string]bool),
		latestLocations: make(map[string]domain.LatestLocation),
		config:          make(map[string]*domain.TrackingConfig),
	}
}

func (r *memoryRepo) SaveBatch(_ context.Context, _ string, points []domain.LocationPoint) error {
	r.points = append(r.points, points...)
	return nil
}

func (r *memoryRepo) IsBatchProcessed(_ context.Context, batchID string) (bool, error) {
	return r.processedBatch[batchID], nil
}

func (r *memoryRepo) MarkBatchProcessed(_ context.Context, batchID string) error {
	r.processedBatch[batchID] = true
	return nil
}

func (r *memoryRepo) QueryPoints(_ context.Context, q domain.LocationQuery) ([]domain.LocationPoint, error) {
	var result []domain.LocationPoint
	for _, p := range r.points {
		if p.TenantID == q.TenantID && p.UserID == q.UserID &&
			!p.Timestamp.Before(q.From) && !p.Timestamp.After(q.To) {
			result = append(result, p)
		}
	}
	if len(result) > q.Limit {
		result = result[:q.Limit]
	}
	return result, nil
}

func (r *memoryRepo) GetLatestLocations(_ context.Context, tenantID string) ([]domain.LatestLocation, error) {
	var result []domain.LatestLocation
	for _, l := range r.latestLocations {
		if l.TenantID == tenantID {
			result = append(result, l)
		}
	}
	return result, nil
}

func (r *memoryRepo) UpsertLatestLocation(_ context.Context, loc domain.LatestLocation) error {
	key := loc.TenantID + ":" + loc.UserID
	r.latestLocations[key] = loc
	return nil
}

func (r *memoryRepo) GetTrackingConfig(_ context.Context, tenantID string) (*domain.TrackingConfig, error) {
	return r.config[tenantID], nil
}

func (r *memoryRepo) SaveTrackingConfig(_ context.Context, cfg domain.TrackingConfig) error {
	r.config[cfg.TenantID] = &cfg
	return nil
}

type noopPublisher struct{}

func (p *noopPublisher) Publish(_ context.Context, _ string, _ string, _ []byte) error {
	return nil
}

// --- Tests ---

func TestIngestBatch_SavesPoints(t *testing.T) {
	repo := newMemoryRepo()
	svc := domain.NewLocationService(repo, &noopPublisher{})

	batch := domain.LocationBatch{
		BatchID: "batch-001",
		SentAt:  time.Now(),
		Points: []domain.LocationPoint{
			{TenantID: "t1", UserID: "u1", DeviceID: "d1", Latitude: 37.7749, Longitude: -122.4194, Accuracy: 5, Timestamp: time.Now()},
			{TenantID: "t1", UserID: "u1", DeviceID: "d1", Latitude: 37.7750, Longitude: -122.4195, Accuracy: 8, Timestamp: time.Now()},
		},
	}

	err := svc.IngestBatch(context.Background(), batch)
	if err != nil {
		t.Fatalf("IngestBatch failed: %v", err)
	}

	if len(repo.points) != 2 {
		t.Fatalf("expected 2 points, got %d", len(repo.points))
	}
}

func TestIngestBatch_IsIdempotent(t *testing.T) {
	repo := newMemoryRepo()
	svc := domain.NewLocationService(repo, &noopPublisher{})

	batch := domain.LocationBatch{
		BatchID: "batch-002",
		SentAt:  time.Now(),
		Points: []domain.LocationPoint{
			{TenantID: "t1", UserID: "u1", DeviceID: "d1", Latitude: 37.7749, Longitude: -122.4194, Accuracy: 5, Timestamp: time.Now()},
		},
	}

	_ = svc.IngestBatch(context.Background(), batch)
	_ = svc.IngestBatch(context.Background(), batch) // duplicate

	if len(repo.points) != 1 {
		t.Fatalf("expected 1 point (idempotent), got %d", len(repo.points))
	}
}

func TestIngestBatch_RejectsEmptyBatch(t *testing.T) {
	repo := newMemoryRepo()
	svc := domain.NewLocationService(repo, &noopPublisher{})

	err := svc.IngestBatch(context.Background(), domain.LocationBatch{
		BatchID: "batch-003",
		Points:  nil,
	})
	if err == nil {
		t.Fatal("expected error for empty batch")
	}
}

func TestIngestBatch_RejectsMixedTenants(t *testing.T) {
	repo := newMemoryRepo()
	svc := domain.NewLocationService(repo, &noopPublisher{})

	batch := domain.LocationBatch{
		BatchID: "batch-004",
		SentAt:  time.Now(),
		Points: []domain.LocationPoint{
			{TenantID: "t1", UserID: "u1", Latitude: 37.77, Longitude: -122.41, Accuracy: 5, Timestamp: time.Now()},
			{TenantID: "t2", UserID: "u2", Latitude: 37.78, Longitude: -122.42, Accuracy: 5, Timestamp: time.Now()},
		},
	}

	err := svc.IngestBatch(context.Background(), batch)
	if err == nil {
		t.Fatal("expected error for mixed tenant_ids")
	}
}

func TestIngestBatch_UpdatesLatestLocation(t *testing.T) {
	repo := newMemoryRepo()
	svc := domain.NewLocationService(repo, &noopPublisher{})

	now := time.Now()
	batch := domain.LocationBatch{
		BatchID: "batch-005",
		SentAt:  now,
		Points: []domain.LocationPoint{
			{TenantID: "t1", UserID: "u1", DeviceID: "d1", Latitude: 37.77, Longitude: -122.41, Accuracy: 5, Timestamp: now.Add(-10 * time.Second)},
			{TenantID: "t1", UserID: "u1", DeviceID: "d1", Latitude: 37.78, Longitude: -122.42, Accuracy: 3, Timestamp: now},
		},
	}

	_ = svc.IngestBatch(context.Background(), batch)

	locs, _ := svc.GetLiveLocations(context.Background(), "t1")
	if len(locs) != 1 {
		t.Fatalf("expected 1 latest location, got %d", len(locs))
	}
	if locs[0].Latitude != 37.78 {
		t.Fatalf("expected latest lat 37.78, got %f", locs[0].Latitude)
	}
}

func TestGetConfig_ReturnsDefaults(t *testing.T) {
	repo := newMemoryRepo()
	svc := domain.NewLocationService(repo, &noopPublisher{})

	cfg, err := svc.GetConfig(context.Background(), "new-tenant")
	if err != nil {
		t.Fatalf("GetConfig failed: %v", err)
	}
	if !cfg.Enabled {
		t.Fatal("expected default config to be enabled")
	}
	if !cfg.BackgroundTrackingEnabled {
		t.Fatal("expected background tracking enabled by default")
	}
}
