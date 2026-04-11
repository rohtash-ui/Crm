// Package api contains HTTP/gRPC handlers for the location-tracking service.
package api

import (
	"encoding/json"
	"net/http"
	"time"

	"crm-services/services/location-tracking/domain"
)

// Handler holds the HTTP handlers for the location-tracking service.
type Handler struct {
	svc *domain.LocationService
}

// NewHandler creates a Handler backed by the given LocationService.
func NewHandler(svc *domain.LocationService) *Handler {
	return &Handler{svc: svc}
}

// IngestBatchRequest is the JSON body for POST /api/v1/location-tracking/batch.
type IngestBatchRequest struct {
	BatchID string              `json:"batch_id"`
	SentAt  int64               `json:"sent_at"` // unix ms
	Updates []LocationPointDTO  `json:"updates"`
}

// LocationPointDTO is the wire format for a single GPS fix.
type LocationPointDTO struct {
	TenantID     string   `json:"tenant_id"`
	UserID       string   `json:"user_id"`
	DeviceID     string   `json:"device_id"`
	Latitude     float64  `json:"latitude"`
	Longitude    float64  `json:"longitude"`
	Altitude     *float64 `json:"altitude,omitempty"`
	Accuracy     float64  `json:"accuracy"`
	Heading      *float64 `json:"heading,omitempty"`
	Speed        *float64 `json:"speed,omitempty"`
	Timestamp    int64    `json:"timestamp"` // unix ms
	BatteryLevel *float64 `json:"battery_level,omitempty"`
	NetworkType  string   `json:"network_type"`
	IsMoving     bool     `json:"is_moving"`
	ActivityType string   `json:"activity_type"`
}

// IngestBatch handles POST /api/v1/location-tracking/batch.
func (h *Handler) IngestBatch(w http.ResponseWriter, r *http.Request) {
	var req IngestBatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.BatchID == "" {
		writeError(w, http.StatusBadRequest, "batch_id is required")
		return
	}
	if len(req.Updates) == 0 {
		writeError(w, http.StatusBadRequest, "updates must not be empty")
		return
	}

	// Map DTOs to domain models.
	points := make([]domain.LocationPoint, len(req.Updates))
	for i, dto := range req.Updates {
		points[i] = domain.LocationPoint{
			TenantID:     dto.TenantID,
			UserID:       dto.UserID,
			DeviceID:     dto.DeviceID,
			Latitude:     dto.Latitude,
			Longitude:    dto.Longitude,
			Altitude:     dto.Altitude,
			Accuracy:     dto.Accuracy,
			Heading:      dto.Heading,
			Speed:        dto.Speed,
			Timestamp:    time.UnixMilli(dto.Timestamp),
			BatteryLevel: dto.BatteryLevel,
			NetworkType:  dto.NetworkType,
			IsMoving:     dto.IsMoving,
			ActivityType: domain.ActivityType(dto.ActivityType),
		}
	}

	batch := domain.LocationBatch{
		BatchID: req.BatchID,
		SentAt:  time.UnixMilli(req.SentAt),
		Points:  points,
	}

	if err := h.svc.IngestBatch(r.Context(), batch); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

// GetHistory handles GET /api/v1/location-tracking/history?user_id=&from=&to=.
func (h *Handler) GetHistory(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "X-Tenant-ID header is required")
		return
	}

	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user_id query param is required")
		return
	}

	from, _ := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
	to, _ := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
	if to.IsZero() {
		to = time.Now()
	}
	if from.IsZero() {
		from = to.Add(-24 * time.Hour)
	}

	points, err := h.svc.GetHistory(r.Context(), domain.LocationQuery{
		TenantID: tenantID,
		UserID:   userID,
		From:     from,
		To:       to,
		Limit:    100,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, points)
}

// GetLiveLocations handles GET /api/v1/location-tracking/live.
func (h *Handler) GetLiveLocations(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "X-Tenant-ID header is required")
		return
	}

	locations, err := h.svc.GetLiveLocations(r.Context(), tenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, locations)
}

// GetConfig handles GET /api/v1/location-tracking/config.
func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "X-Tenant-ID header is required")
		return
	}

	cfg, err := h.svc.GetConfig(r.Context(), tenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, cfg)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
