// Package api provides HTTP handlers for the offline sync endpoint.
//
// POST /api/v1/sync  — accept a batch of offline changes and return results + server updates.
// GET  /api/v1/sync/updates — fetch entities updated since a given cursor.
package api

import (
	"encoding/json"
	"net/http"
	"time"

	"crm-services/services/sync/domain"
)

// Handler holds dependencies for sync HTTP handlers.
type Handler struct {
	syncService *domain.SyncService
}

// NewHandler creates a new sync handler.
func NewHandler(syncService *domain.SyncService) *Handler {
	return &Handler{syncService: syncService}
}

// RegisterRoutes registers sync routes on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/sync", h.handleSync)
	mux.HandleFunc("GET /api/v1/sync/updates", h.handleFetchUpdates)
}

// --- Request / Response types ---

// SyncRequest is the JSON body for POST /api/v1/sync.
type SyncRequest struct {
	Changes    []ChangePayload `json:"changes"`
	SyncCursor *string         `json:"syncCursor"`
}

// ChangePayload represents a single offline change from the client.
type ChangePayload struct {
	IdempotencyKey  string                 `json:"idempotencyKey"`
	EntityType      string                 `json:"entityType"`
	EntityID        string                 `json:"entityId"`
	Action          string                 `json:"action"`
	Payload         map[string]interface{} `json:"payload"`
	BaseVersion     int                    `json:"baseVersion"`
	ClientTimestamp  string                `json:"clientTimestamp"`
}

// SyncResponse is the JSON response for POST /api/v1/sync and GET /api/v1/sync/updates.
type SyncResponse struct {
	Results         []ChangeResult  `json:"results"`
	UpdatedEntities []EntityDTO     `json:"updatedEntities"`
	NextSyncCursor  string          `json:"nextSyncCursor"`
	HasMore         bool            `json:"hasMore"`
}

// ChangeResult is the outcome of a single change.
type ChangeResult struct {
	IdempotencyKey string                 `json:"idempotencyKey"`
	Status         string                 `json:"status"` // "applied", "conflict", "rejected"
	EntityID       string                 `json:"entityId"`
	NewVersion     *int                   `json:"newVersion,omitempty"`
	ServerTimestamp *string               `json:"serverTimestamp,omitempty"`
	ServerData     map[string]interface{} `json:"serverData,omitempty"`
	Error          *string                `json:"error,omitempty"`
}

// EntityDTO is a serialized entity returned in the sync response.
type EntityDTO struct {
	EntityType string                 `json:"entityType"`
	EntityID   string                 `json:"entityId"`
	Version    int                    `json:"version"`
	Data       map[string]interface{} `json:"data"`
	UpdatedAt  string                 `json:"updatedAt"`
}

// --- Handlers ---

func (h *Handler) handleSync(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-Id")
	userID := r.Header.Get("X-User-Id")
	if tenantID == "" || userID == "" {
		http.Error(w, `{"error":"missing tenant or user ID"}`, http.StatusBadRequest)
		return
	}

	var req SyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if len(req.Changes) > 100 {
		http.Error(w, `{"error":"batch size exceeds maximum of 100"}`, http.StatusBadRequest)
		return
	}

	// Convert API types to domain types
	domainChanges := make([]domain.Change, len(req.Changes))
	for i, c := range req.Changes {
		clientTS, _ := time.Parse(time.RFC3339, c.ClientTimestamp)
		domainChanges[i] = domain.Change{
			IdempotencyKey: c.IdempotencyKey,
			EntityType:     c.EntityType,
			EntityID:       c.EntityID,
			Action:         domain.Action(c.Action),
			Payload:        c.Payload,
			BaseVersion:    c.BaseVersion,
			ClientTimestamp: clientTS,
		}
	}

	var cursor *time.Time
	if req.SyncCursor != nil {
		t, err := time.Parse(time.RFC3339, *req.SyncCursor)
		if err == nil {
			cursor = &t
		}
	}

	// Execute sync
	result, err := h.syncService.ProcessSync(r.Context(), domain.SyncInput{
		TenantID: tenantID,
		UserID:   userID,
		Changes:  domainChanges,
		Cursor:   cursor,
	})
	if err != nil {
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}

	// Convert domain results to API response
	resp := toSyncResponse(result)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *Handler) handleFetchUpdates(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-Id")
	userID := r.Header.Get("X-User-Id")
	if tenantID == "" || userID == "" {
		http.Error(w, `{"error":"missing tenant or user ID"}`, http.StatusBadRequest)
		return
	}

	cursorStr := r.URL.Query().Get("cursor")
	if cursorStr == "" {
		http.Error(w, `{"error":"missing cursor parameter"}`, http.StatusBadRequest)
		return
	}

	cursor, err := time.Parse(time.RFC3339, cursorStr)
	if err != nil {
		http.Error(w, `{"error":"invalid cursor format, expected RFC3339"}`, http.StatusBadRequest)
		return
	}

	result, err := h.syncService.FetchUpdates(r.Context(), domain.FetchInput{
		TenantID: tenantID,
		UserID:   userID,
		Cursor:   cursor,
	})
	if err != nil {
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}

	resp := toSyncResponse(result)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// --- Conversion helpers ---

func toSyncResponse(result *domain.SyncOutput) SyncResponse {
	results := make([]ChangeResult, len(result.Results))
	for i, r := range result.Results {
		cr := ChangeResult{
			IdempotencyKey: r.IdempotencyKey,
			Status:         string(r.Status),
			EntityID:       r.EntityID,
		}
		if r.NewVersion > 0 {
			v := r.NewVersion
			cr.NewVersion = &v
		}
		if !r.ServerTimestamp.IsZero() {
			ts := r.ServerTimestamp.Format(time.RFC3339)
			cr.ServerTimestamp = &ts
		}
		if r.ServerData != nil {
			cr.ServerData = r.ServerData
		}
		if r.Error != "" {
			e := r.Error
			cr.Error = &e
		}
		results[i] = cr
	}

	entities := make([]EntityDTO, len(result.UpdatedEntities))
	for i, e := range result.UpdatedEntities {
		entities[i] = EntityDTO{
			EntityType: e.EntityType,
			EntityID:   e.EntityID,
			Version:    e.Version,
			Data:       e.Data,
			UpdatedAt:  e.UpdatedAt.Format(time.RFC3339),
		}
	}

	return SyncResponse{
		Results:         results,
		UpdatedEntities: entities,
		NextSyncCursor:  result.NextCursor.Format(time.RFC3339),
		HasMore:         result.HasMore,
	}
}
