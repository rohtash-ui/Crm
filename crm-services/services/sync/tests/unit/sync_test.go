// Package unit contains unit tests for the sync domain logic.
package unit

import (
	"context"
	"fmt"
	"testing"
	"time"

	"crm-services/services/sync/domain"
)

// --- In-memory fakes ---

type fakeRepo struct {
	entities map[string]*domain.Entity // key: "type:id"
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{entities: make(map[string]*domain.Entity)}
}

func (r *fakeRepo) key(entityType, entityID string) string {
	return entityType + ":" + entityID
}

func (r *fakeRepo) GetEntity(_ context.Context, tenantID, entityType, entityID string) (*domain.Entity, error) {
	e, ok := r.entities[r.key(entityType, entityID)]
	if !ok {
		return nil, fmt.Errorf("not found")
	}
	return e, nil
}

func (r *fakeRepo) CreateEntity(_ context.Context, tenantID, entityType, entityID string, data map[string]interface{}) (*domain.Entity, error) {
	k := r.key(entityType, entityID)
	if _, exists := r.entities[k]; exists {
		return nil, fmt.Errorf("already exists")
	}
	e := &domain.Entity{
		EntityType: entityType,
		EntityID:   entityID,
		Version:    1,
		Data:       data,
		UpdatedAt:  time.Now().UTC(),
	}
	r.entities[k] = e
	return e, nil
}

func (r *fakeRepo) UpdateEntity(_ context.Context, tenantID, entityType, entityID string, data map[string]interface{}, baseVersion int) (*domain.Entity, error) {
	k := r.key(entityType, entityID)
	e, ok := r.entities[k]
	if !ok {
		return nil, fmt.Errorf("not found")
	}
	if e.Version != baseVersion {
		return nil, domain.ErrVersionConflict
	}
	for key, val := range data {
		e.Data[key] = val
	}
	e.Version++
	e.UpdatedAt = time.Now().UTC()
	return e, nil
}

func (r *fakeRepo) DeleteEntity(_ context.Context, tenantID, entityType, entityID string, baseVersion int) error {
	k := r.key(entityType, entityID)
	e, ok := r.entities[k]
	if !ok {
		return fmt.Errorf("not found")
	}
	if e.Version != baseVersion {
		return domain.ErrVersionConflict
	}
	delete(r.entities, k)
	return nil
}

func (r *fakeRepo) FetchUpdatedSince(_ context.Context, tenantID, userID string, cursor time.Time, limit int) ([]domain.Entity, error) {
	var result []domain.Entity
	for _, e := range r.entities {
		if e.UpdatedAt.After(cursor) {
			result = append(result, *e)
		}
	}
	if len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

type fakeIdempotency struct {
	store map[string]*domain.ChangeResult
}

func newFakeIdempotency() *fakeIdempotency {
	return &fakeIdempotency{store: make(map[string]*domain.ChangeResult)}
}

func (s *fakeIdempotency) Check(_ context.Context, key string) (*domain.ChangeResult, error) {
	r, ok := s.store[key]
	if !ok {
		return nil, nil
	}
	return r, nil
}

func (s *fakeIdempotency) Store(_ context.Context, key string, result *domain.ChangeResult) error {
	s.store[key] = result
	return nil
}

type fakeEvents struct {
	published []domain.Event
}

func newFakeEvents() *fakeEvents {
	return &fakeEvents{}
}

func (e *fakeEvents) Publish(_ context.Context, tenantID string, event domain.Event) error {
	e.published = append(e.published, event)
	return nil
}

// --- Tests ---

func TestProcessSync_CreateEntity(t *testing.T) {
	repo := newFakeRepo()
	svc := domain.NewSyncService(repo, newFakeIdempotency(), newFakeEvents())

	result, err := svc.ProcessSync(context.Background(), domain.SyncInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Changes: []domain.Change{
			{
				IdempotencyKey: "key-1",
				EntityType:     "contact",
				EntityID:       "contact-1",
				Action:         domain.ActionCreate,
				Payload:        map[string]interface{}{"name": "Alice", "email": "alice@example.com"},
				BaseVersion:    0,
				ClientTimestamp: time.Now(),
			},
		},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(result.Results))
	}

	if result.Results[0].Status != domain.StatusApplied {
		t.Errorf("expected status Applied, got %s", result.Results[0].Status)
	}

	if result.Results[0].NewVersion != 1 {
		t.Errorf("expected version 1, got %d", result.Results[0].NewVersion)
	}
}

func TestProcessSync_UpdateEntity(t *testing.T) {
	repo := newFakeRepo()
	svc := domain.NewSyncService(repo, newFakeIdempotency(), newFakeEvents())

	// Create first
	repo.entities["contact:contact-1"] = &domain.Entity{
		EntityType: "contact",
		EntityID:   "contact-1",
		Version:    1,
		Data:       map[string]interface{}{"name": "Alice", "email": "alice@example.com"},
		UpdatedAt:  time.Now().UTC(),
	}

	result, err := svc.ProcessSync(context.Background(), domain.SyncInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Changes: []domain.Change{
			{
				IdempotencyKey: "key-2",
				EntityType:     "contact",
				EntityID:       "contact-1",
				Action:         domain.ActionUpdate,
				Payload:        map[string]interface{}{"phone": "+1-555-0123"},
				BaseVersion:    1,
				ClientTimestamp: time.Now(),
			},
		},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Results[0].Status != domain.StatusApplied {
		t.Errorf("expected status Applied, got %s", result.Results[0].Status)
	}

	if result.Results[0].NewVersion != 2 {
		t.Errorf("expected version 2, got %d", result.Results[0].NewVersion)
	}
}

func TestProcessSync_VersionConflict(t *testing.T) {
	repo := newFakeRepo()
	svc := domain.NewSyncService(repo, newFakeIdempotency(), newFakeEvents())

	// Entity at version 3 on the server
	repo.entities["contact:contact-1"] = &domain.Entity{
		EntityType: "contact",
		EntityID:   "contact-1",
		Version:    3,
		Data:       map[string]interface{}{"name": "Alice Updated", "email": "alice@example.com"},
		UpdatedAt:  time.Now().UTC(),
	}

	// Client sends update based on version 1 (stale)
	result, err := svc.ProcessSync(context.Background(), domain.SyncInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Changes: []domain.Change{
			{
				IdempotencyKey: "key-3",
				EntityType:     "contact",
				EntityID:       "contact-1",
				Action:         domain.ActionUpdate,
				Payload:        map[string]interface{}{"phone": "+1-555-9999"},
				BaseVersion:    1, // stale — server is at 3
				ClientTimestamp: time.Now(),
			},
		},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Results[0].Status != domain.StatusConflict {
		t.Errorf("expected status Conflict, got %s", result.Results[0].Status)
	}

	// Server data should be included for conflict resolution
	if result.Results[0].ServerData == nil {
		t.Error("expected server data in conflict result")
	}
}

func TestProcessSync_DeleteEntity(t *testing.T) {
	repo := newFakeRepo()
	svc := domain.NewSyncService(repo, newFakeIdempotency(), newFakeEvents())

	repo.entities["contact:contact-1"] = &domain.Entity{
		EntityType: "contact",
		EntityID:   "contact-1",
		Version:    1,
		Data:       map[string]interface{}{"name": "Alice"},
		UpdatedAt:  time.Now().UTC(),
	}

	result, err := svc.ProcessSync(context.Background(), domain.SyncInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Changes: []domain.Change{
			{
				IdempotencyKey: "key-4",
				EntityType:     "contact",
				EntityID:       "contact-1",
				Action:         domain.ActionDelete,
				BaseVersion:    1,
				ClientTimestamp: time.Now(),
			},
		},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Results[0].Status != domain.StatusApplied {
		t.Errorf("expected status Applied, got %s", result.Results[0].Status)
	}
}

func TestProcessSync_IdempotencyDedup(t *testing.T) {
	repo := newFakeRepo()
	idempotency := newFakeIdempotency()
	svc := domain.NewSyncService(repo, idempotency, newFakeEvents())

	change := domain.Change{
		IdempotencyKey: "key-dedup",
		EntityType:     "contact",
		EntityID:       "contact-1",
		Action:         domain.ActionCreate,
		Payload:        map[string]interface{}{"name": "Alice"},
		BaseVersion:    0,
		ClientTimestamp: time.Now(),
	}

	// First call
	result1, _ := svc.ProcessSync(context.Background(), domain.SyncInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Changes:  []domain.Change{change},
	})

	// Second call with same idempotency key
	result2, _ := svc.ProcessSync(context.Background(), domain.SyncInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Changes:  []domain.Change{change},
	})

	if result1.Results[0].Status != domain.StatusApplied {
		t.Errorf("first call: expected Applied, got %s", result1.Results[0].Status)
	}

	if result2.Results[0].Status != domain.StatusApplied {
		t.Errorf("second call: expected Applied (dedup), got %s", result2.Results[0].Status)
	}
}

func TestProcessSync_UnsupportedEntityType(t *testing.T) {
	repo := newFakeRepo()
	svc := domain.NewSyncService(repo, newFakeIdempotency(), newFakeEvents())

	result, err := svc.ProcessSync(context.Background(), domain.SyncInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Changes: []domain.Change{
			{
				IdempotencyKey: "key-bad",
				EntityType:     "invoice",
				EntityID:       "inv-1",
				Action:         domain.ActionCreate,
				Payload:        map[string]interface{}{"amount": 100},
				BaseVersion:    0,
				ClientTimestamp: time.Now(),
			},
		},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Results[0].Status != domain.StatusRejected {
		t.Errorf("expected status Rejected for unsupported entity type, got %s", result.Results[0].Status)
	}
}

func TestProcessSync_EmitsEvents(t *testing.T) {
	repo := newFakeRepo()
	events := newFakeEvents()
	svc := domain.NewSyncService(repo, newFakeIdempotency(), events)

	_, err := svc.ProcessSync(context.Background(), domain.SyncInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Changes: []domain.Change{
			{
				IdempotencyKey: "key-event",
				EntityType:     "contact",
				EntityID:       "contact-1",
				Action:         domain.ActionCreate,
				Payload:        map[string]interface{}{"name": "Bob"},
				BaseVersion:    0,
				ClientTimestamp: time.Now(),
			},
		},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(events.published) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events.published))
	}

	if events.published[0].Source != "offline_sync" {
		t.Errorf("expected event source 'offline_sync', got %q", events.published[0].Source)
	}

	if events.published[0].Type != "contact.created" {
		t.Errorf("expected event type 'contact.created', got %q", events.published[0].Type)
	}
}

func TestProcessSync_CreateNote(t *testing.T) {
	repo := newFakeRepo()
	svc := domain.NewSyncService(repo, newFakeIdempotency(), newFakeEvents())

	result, err := svc.ProcessSync(context.Background(), domain.SyncInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Changes: []domain.Change{
			{
				IdempotencyKey: "key-note-1",
				EntityType:     "note",
				EntityID:       "note-1",
				Action:         domain.ActionCreate,
				Payload: map[string]interface{}{
					"entity_type":     "lead",
					"entity_id":       "lead-1",
					"content":         "Spoke with the client about pricing",
					"note_type":       "call",
					"author_name":     "John Doe",
					"external_id":     "nfs-note-123",
					"external_source": "nfs_mecntech",
				},
				BaseVersion:    0,
				ClientTimestamp: time.Now(),
			},
		},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(result.Results))
	}

	if result.Results[0].Status != domain.StatusApplied {
		t.Errorf("expected status Applied, got %s", result.Results[0].Status)
	}

	if result.Results[0].NewVersion != 1 {
		t.Errorf("expected version 1, got %d", result.Results[0].NewVersion)
	}

	// Verify the note was stored
	entity, err := repo.GetEntity(context.Background(), "tenant-1", "note", "note-1")
	if err != nil {
		t.Fatalf("failed to get note: %v", err)
	}

	if entity.Data["content"] != "Spoke with the client about pricing" {
		t.Errorf("expected note content, got %v", entity.Data["content"])
	}

	if entity.Data["external_source"] != "nfs_mecntech" {
		t.Errorf("expected external_source nfs_mecntech, got %v", entity.Data["external_source"])
	}
}

func TestProcessSync_NoteEntityTypeAllowed(t *testing.T) {
	if !domain.AllowedEntityTypes["note"] {
		t.Error("'note' entity type should be in AllowedEntityTypes")
	}
}

func TestFetchUpdates(t *testing.T) {
	repo := newFakeRepo()
	svc := domain.NewSyncService(repo, newFakeIdempotency(), newFakeEvents())

	past := time.Now().Add(-1 * time.Hour).UTC()
	repo.entities["contact:c1"] = &domain.Entity{
		EntityType: "contact",
		EntityID:   "c1",
		Version:    2,
		Data:       map[string]interface{}{"name": "Recent"},
		UpdatedAt:  time.Now().UTC(),
	}

	result, err := svc.FetchUpdates(context.Background(), domain.FetchInput{
		TenantID: "tenant-1",
		UserID:   "user-1",
		Cursor:   past,
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.UpdatedEntities) != 1 {
		t.Errorf("expected 1 updated entity, got %d", len(result.UpdatedEntities))
	}
}
