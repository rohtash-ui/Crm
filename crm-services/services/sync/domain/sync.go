// Package domain contains the pure business logic for offline sync.
//
// This package has no external dependencies (no DB, no HTTP, no cache).
// It defines the sync processing rules, conflict detection, and
// entity resolution logic.
package domain

import (
	"context"
	"fmt"
	"time"
)

// Action represents a CRM mutation type.
type Action string

const (
	ActionCreate Action = "create"
	ActionUpdate Action = "update"
	ActionDelete Action = "delete"
)

// ResultStatus is the outcome of processing a single change.
type ResultStatus string

const (
	StatusApplied  ResultStatus = "applied"
	StatusConflict ResultStatus = "conflict"
	StatusRejected ResultStatus = "rejected"
)

// MaxBatchSize is the maximum number of changes per sync request.
const MaxBatchSize = 100

// MaxDeltaFetchSize is the maximum entities returned per delta fetch.
const MaxDeltaFetchSize = 500

// AllowedEntityTypes defines which entity types support offline sync.
var AllowedEntityTypes = map[string]bool{
	"contact":  true,
	"deal":     true,
	"activity": true,
	"lead":     true,
	"account":  true,
	"note":     true,
}

// --- Input / Output types ---

// Change represents a single offline mutation from the client.
type Change struct {
	IdempotencyKey string
	EntityType     string
	EntityID       string
	Action         Action
	Payload        map[string]interface{}
	BaseVersion    int
	ClientTimestamp time.Time
}

// SyncInput is the input to ProcessSync.
type SyncInput struct {
	TenantID string
	UserID   string
	Changes  []Change
	Cursor   *time.Time
}

// FetchInput is the input to FetchUpdates.
type FetchInput struct {
	TenantID string
	UserID   string
	Cursor   time.Time
}

// ChangeResult is the outcome of processing a single change.
type ChangeResult struct {
	IdempotencyKey string
	Status         ResultStatus
	EntityID       string
	NewVersion     int
	ServerTimestamp time.Time
	ServerData     map[string]interface{}
	Error          string
}

// Entity is a generic CRM entity record.
type Entity struct {
	EntityType string
	EntityID   string
	Version    int
	Data       map[string]interface{}
	UpdatedAt  time.Time
}

// SyncOutput is the output of ProcessSync and FetchUpdates.
type SyncOutput struct {
	Results         []ChangeResult
	UpdatedEntities []Entity
	NextCursor      time.Time
	HasMore         bool
}

// --- Repository interface (implemented in infra/) ---

// EntityRepository provides data access for sync operations.
type EntityRepository interface {
	// GetEntity fetches a single entity by type and ID within a tenant.
	GetEntity(ctx context.Context, tenantID, entityType, entityID string) (*Entity, error)

	// CreateEntity inserts a new entity. Returns the created entity with version=1.
	CreateEntity(ctx context.Context, tenantID, entityType, entityID string, data map[string]interface{}) (*Entity, error)

	// UpdateEntity applies a partial update using optimistic locking.
	// Returns the updated entity if baseVersion matches, or the current entity + ErrVersionConflict if not.
	UpdateEntity(ctx context.Context, tenantID, entityType, entityID string, data map[string]interface{}, baseVersion int) (*Entity, error)

	// DeleteEntity soft-deletes an entity using optimistic locking.
	DeleteEntity(ctx context.Context, tenantID, entityType, entityID string, baseVersion int) error

	// FetchUpdatedSince returns entities updated after the cursor, up to limit.
	FetchUpdatedSince(ctx context.Context, tenantID, userID string, cursor time.Time, limit int) ([]Entity, error)
}

// IdempotencyStore provides deduplication for sync operations.
type IdempotencyStore interface {
	// Check returns a previous result if the key was already processed, or nil.
	Check(ctx context.Context, key string) (*ChangeResult, error)

	// Store saves a result for future deduplication. TTL is 24 hours.
	Store(ctx context.Context, key string, result *ChangeResult) error
}

// EventPublisher emits domain events for sync operations.
type EventPublisher interface {
	Publish(ctx context.Context, tenantID string, event Event) error
}

// Event is a domain event emitted after a sync operation.
type Event struct {
	Type       string                 // e.g., "contact.updated"
	EntityType string
	EntityID   string
	TenantID   string
	UserID     string
	Source     string                 // "offline_sync"
	Data       map[string]interface{}
	Timestamp  time.Time
}

// ErrVersionConflict is returned when optimistic locking fails.
var ErrVersionConflict = fmt.Errorf("version conflict")

// --- Service ---

// SyncService implements the sync business logic.
type SyncService struct {
	repo       EntityRepository
	idempotency IdempotencyStore
	events     EventPublisher
}

// NewSyncService creates a new SyncService.
func NewSyncService(repo EntityRepository, idempotency IdempotencyStore, events EventPublisher) *SyncService {
	return &SyncService{
		repo:       repo,
		idempotency: idempotency,
		events:     events,
	}
}

// ProcessSync applies a batch of offline changes and returns results + server updates.
func (s *SyncService) ProcessSync(ctx context.Context, input SyncInput) (*SyncOutput, error) {
	results := make([]ChangeResult, 0, len(input.Changes))

	for _, change := range input.Changes {
		result := s.processChange(ctx, input.TenantID, input.UserID, change)
		results = append(results, result)
	}

	// Fetch server-side updates the client has missed
	var updatedEntities []Entity
	var nextCursor time.Time
	var hasMore bool

	if input.Cursor != nil {
		var err error
		updatedEntities, err = s.repo.FetchUpdatedSince(ctx, input.TenantID, input.UserID, *input.Cursor, MaxDeltaFetchSize)
		if err != nil {
			return nil, fmt.Errorf("fetch updates: %w", err)
		}
		hasMore = len(updatedEntities) >= MaxDeltaFetchSize
	}

	if len(updatedEntities) > 0 {
		nextCursor = updatedEntities[len(updatedEntities)-1].UpdatedAt
	} else {
		nextCursor = time.Now().UTC()
	}

	return &SyncOutput{
		Results:         results,
		UpdatedEntities: updatedEntities,
		NextCursor:      nextCursor,
		HasMore:         hasMore,
	}, nil
}

// FetchUpdates returns entities updated since the cursor without applying changes.
func (s *SyncService) FetchUpdates(ctx context.Context, input FetchInput) (*SyncOutput, error) {
	entities, err := s.repo.FetchUpdatedSince(ctx, input.TenantID, input.UserID, input.Cursor, MaxDeltaFetchSize)
	if err != nil {
		return nil, fmt.Errorf("fetch updates: %w", err)
	}

	hasMore := len(entities) >= MaxDeltaFetchSize

	var nextCursor time.Time
	if len(entities) > 0 {
		nextCursor = entities[len(entities)-1].UpdatedAt
	} else {
		nextCursor = input.Cursor
	}

	return &SyncOutput{
		Results:         nil,
		UpdatedEntities: entities,
		NextCursor:      nextCursor,
		HasMore:         hasMore,
	}, nil
}

func (s *SyncService) processChange(ctx context.Context, tenantID, userID string, change Change) ChangeResult {
	// Validate entity type
	if !AllowedEntityTypes[change.EntityType] {
		return ChangeResult{
			IdempotencyKey: change.IdempotencyKey,
			Status:         StatusRejected,
			EntityID:       change.EntityID,
			Error:          fmt.Sprintf("entity type %q is not supported for offline sync", change.EntityType),
		}
	}

	// Check idempotency — if already processed, return the stored result
	existing, err := s.idempotency.Check(ctx, change.IdempotencyKey)
	if err == nil && existing != nil {
		return *existing
	}

	var result ChangeResult

	switch change.Action {
	case ActionCreate:
		result = s.applyCreate(ctx, tenantID, userID, change)
	case ActionUpdate:
		result = s.applyUpdate(ctx, tenantID, userID, change)
	case ActionDelete:
		result = s.applyDelete(ctx, tenantID, userID, change)
	default:
		result = ChangeResult{
			IdempotencyKey: change.IdempotencyKey,
			Status:         StatusRejected,
			EntityID:       change.EntityID,
			Error:          fmt.Sprintf("unknown action %q", change.Action),
		}
	}

	// Store for idempotency (best-effort — failure here is not fatal)
	_ = s.idempotency.Store(ctx, change.IdempotencyKey, &result)

	return result
}

func (s *SyncService) applyCreate(ctx context.Context, tenantID, userID string, change Change) ChangeResult {
	entity, err := s.repo.CreateEntity(ctx, tenantID, change.EntityType, change.EntityID, change.Payload)
	if err != nil {
		return ChangeResult{
			IdempotencyKey: change.IdempotencyKey,
			Status:         StatusRejected,
			EntityID:       change.EntityID,
			Error:          fmt.Sprintf("create failed: %v", err),
		}
	}

	// Emit domain event
	_ = s.events.Publish(ctx, tenantID, Event{
		Type:       change.EntityType + ".created",
		EntityType: change.EntityType,
		EntityID:   change.EntityID,
		TenantID:   tenantID,
		UserID:     userID,
		Source:     "offline_sync",
		Data:       change.Payload,
		Timestamp:  time.Now().UTC(),
	})

	return ChangeResult{
		IdempotencyKey: change.IdempotencyKey,
		Status:         StatusApplied,
		EntityID:       entity.EntityID,
		NewVersion:     entity.Version,
		ServerTimestamp: entity.UpdatedAt,
	}
}

func (s *SyncService) applyUpdate(ctx context.Context, tenantID, userID string, change Change) ChangeResult {
	entity, err := s.repo.UpdateEntity(ctx, tenantID, change.EntityType, change.EntityID, change.Payload, change.BaseVersion)
	if err == ErrVersionConflict {
		// Fetch current server state for conflict resolution
		current, fetchErr := s.repo.GetEntity(ctx, tenantID, change.EntityType, change.EntityID)
		if fetchErr != nil {
			return ChangeResult{
				IdempotencyKey: change.IdempotencyKey,
				Status:         StatusConflict,
				EntityID:       change.EntityID,
				Error:          "version conflict; could not fetch current state",
			}
		}
		return ChangeResult{
			IdempotencyKey: change.IdempotencyKey,
			Status:         StatusConflict,
			EntityID:       change.EntityID,
			NewVersion:     current.Version,
			ServerTimestamp: current.UpdatedAt,
			ServerData:     current.Data,
		}
	}
	if err != nil {
		return ChangeResult{
			IdempotencyKey: change.IdempotencyKey,
			Status:         StatusRejected,
			EntityID:       change.EntityID,
			Error:          fmt.Sprintf("update failed: %v", err),
		}
	}

	// Emit domain event
	_ = s.events.Publish(ctx, tenantID, Event{
		Type:       change.EntityType + ".updated",
		EntityType: change.EntityType,
		EntityID:   change.EntityID,
		TenantID:   tenantID,
		UserID:     userID,
		Source:     "offline_sync",
		Data:       change.Payload,
		Timestamp:  time.Now().UTC(),
	})

	return ChangeResult{
		IdempotencyKey: change.IdempotencyKey,
		Status:         StatusApplied,
		EntityID:       entity.EntityID,
		NewVersion:     entity.Version,
		ServerTimestamp: entity.UpdatedAt,
	}
}

func (s *SyncService) applyDelete(ctx context.Context, tenantID, userID string, change Change) ChangeResult {
	err := s.repo.DeleteEntity(ctx, tenantID, change.EntityType, change.EntityID, change.BaseVersion)
	if err == ErrVersionConflict {
		current, fetchErr := s.repo.GetEntity(ctx, tenantID, change.EntityType, change.EntityID)
		if fetchErr != nil {
			return ChangeResult{
				IdempotencyKey: change.IdempotencyKey,
				Status:         StatusConflict,
				EntityID:       change.EntityID,
				Error:          "version conflict on delete; could not fetch current state",
			}
		}
		return ChangeResult{
			IdempotencyKey: change.IdempotencyKey,
			Status:         StatusConflict,
			EntityID:       change.EntityID,
			NewVersion:     current.Version,
			ServerTimestamp: current.UpdatedAt,
			ServerData:     current.Data,
		}
	}
	if err != nil {
		return ChangeResult{
			IdempotencyKey: change.IdempotencyKey,
			Status:         StatusRejected,
			EntityID:       change.EntityID,
			Error:          fmt.Sprintf("delete failed: %v", err),
		}
	}

	// Emit domain event
	_ = s.events.Publish(ctx, tenantID, Event{
		Type:       change.EntityType + ".deleted",
		EntityType: change.EntityType,
		EntityID:   change.EntityID,
		TenantID:   tenantID,
		UserID:     userID,
		Source:     "offline_sync",
		Data:       nil,
		Timestamp:  time.Now().UTC(),
	})

	return ChangeResult{
		IdempotencyKey: change.IdempotencyKey,
		Status:         StatusApplied,
		EntityID:       change.EntityID,
		ServerTimestamp: time.Now().UTC(),
	}
}
