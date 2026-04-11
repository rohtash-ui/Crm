package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// Handler exposes lead assignment HTTP endpoints.
type Handler struct {
	svc *domain.AssignmentService
}

func NewHandler(svc *domain.AssignmentService) *Handler {
	return &Handler{svc: svc}
}

// --- Request/Response DTOs ---

type RoundRobinAssignRequest struct {
	LeadID     string `json:"lead_id"`
	ProjectID  string `json:"project_id,omitempty"`
	LocationID string `json:"location_id,omitempty"`
	RegionID   string `json:"region_id,omitempty"`
}

type BulkRoundRobinRequest struct {
	ProjectID  string `json:"project_id,omitempty"`
	LocationID string `json:"location_id,omitempty"`
	RegionID   string `json:"region_id,omitempty"`
	Limit      int    `json:"limit,omitempty"`
}

type ManualAssignRequest struct {
	LeadID     string `json:"lead_id"`
	AssignToID string `json:"assign_to_id"`
	Reason     string `json:"reason,omitempty"`
}

type BulkRegionAssignRequest struct {
	LeadIDs    []string `json:"lead_ids"`
	RegionID   string   `json:"region_id"`
	AssignToID string   `json:"assign_to_id,omitempty"`
	Reason     string   `json:"reason,omitempty"`
}

type AssignmentResponse struct {
	Lead    *domain.Lead `json:"lead,omitempty"`
	Message string       `json:"message"`
}

type BulkAssignmentResponse struct {
	AssignedCount int    `json:"assigned_count"`
	Message       string `json:"message"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code"`
}

// --- Handlers ---

// HandleRoundRobinAssign assigns a single lead using round-robin.
// POST /api/v1/leads/assign/round-robin
func (h *Handler) HandleRoundRobinAssign(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return
	}

	var req RoundRobinAssignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if req.LeadID == "" {
		writeError(w, http.StatusBadRequest, "missing_lead_id", "lead_id is required")
		return
	}

	lead, err := h.svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID:   tenantID,
		LeadID:     req.LeadID,
		ProjectID:  req.ProjectID,
		LocationID: req.LocationID,
		RegionID:   req.RegionID,
	})
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, AssignmentResponse{
		Lead:    lead,
		Message: "Lead assigned via round-robin",
	})
}

// HandleBulkRoundRobinAssign assigns all unassigned leads matching filters via round-robin.
// POST /api/v1/leads/assign/round-robin/bulk
func (h *Handler) HandleBulkRoundRobinAssign(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return
	}

	var req BulkRoundRobinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	count, err := h.svc.BulkRoundRobinAssign(ctx, tenantID, domain.UnassignedFilter{
		ProjectID:  req.ProjectID,
		LocationID: req.LocationID,
		RegionID:   req.RegionID,
		Limit:      req.Limit,
	})
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, BulkAssignmentResponse{
		AssignedCount: count,
		Message:       "Bulk round-robin assignment complete",
	})
}

// HandleManualAssign lets team leads and managers manually assign a lead.
// POST /api/v1/leads/assign/manual
func (h *Handler) HandleManualAssign(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return
	}

	userID := r.Header.Get("X-User-ID")
	userRole := domain.UserRole(r.Header.Get("X-User-Role"))

	if userID == "" || userRole == "" {
		writeError(w, http.StatusBadRequest, "missing_auth", "X-User-ID and X-User-Role headers are required")
		return
	}

	var req ManualAssignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if req.LeadID == "" || req.AssignToID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "lead_id and assign_to_id are required")
		return
	}

	lead, err := h.svc.AssignManually(ctx, domain.ManualAssignRequest{
		TenantID:     tenantID,
		LeadID:       req.LeadID,
		AssignToID:   req.AssignToID,
		AssignByID:   userID,
		AssignByRole: userRole,
		Reason:       req.Reason,
	})
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, AssignmentResponse{
		Lead:    lead,
		Message: "Lead manually assigned",
	})
}

// HandleBulkRegionAssign lets managers assign multiple leads to a region.
// POST /api/v1/leads/assign/region
func (h *Handler) HandleBulkRegionAssign(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return
	}

	userID := r.Header.Get("X-User-ID")
	userRole := domain.UserRole(r.Header.Get("X-User-Role"))

	if userID == "" || userRole == "" {
		writeError(w, http.StatusBadRequest, "missing_auth", "X-User-ID and X-User-Role headers are required")
		return
	}

	var req BulkRegionAssignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if len(req.LeadIDs) == 0 || req.RegionID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "lead_ids and region_id are required")
		return
	}

	count, err := h.svc.BulkAssignToRegion(ctx, domain.BulkManualAssignRequest{
		TenantID:     tenantID,
		LeadIDs:      req.LeadIDs,
		RegionID:     req.RegionID,
		AssignToID:   req.AssignToID,
		AssignByID:   userID,
		AssignByRole: userRole,
		Reason:       req.Reason,
	})
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, BulkAssignmentResponse{
		AssignedCount: count,
		Message:       "Leads assigned to region",
	})
}

// --- Helpers ---

func handleDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrLeadNotFound):
		writeError(w, http.StatusNotFound, "lead_not_found", err.Error())
	case errors.Is(err, domain.ErrRuleNotFound), errors.Is(err, domain.ErrNoMatchingRule):
		writeError(w, http.StatusNotFound, "rule_not_found", err.Error())
	case errors.Is(err, domain.ErrTeamNotFound):
		writeError(w, http.StatusNotFound, "team_not_found", err.Error())
	case errors.Is(err, domain.ErrUnauthorized):
		writeError(w, http.StatusForbidden, "unauthorized", err.Error())
	case errors.Is(err, domain.ErrNoEligibleMembers):
		writeError(w, http.StatusConflict, "no_eligible_members", err.Error())
	case errors.Is(err, domain.ErrLeadAlreadyAssigned):
		writeError(w, http.StatusConflict, "already_assigned", err.Error())
	case errors.Is(err, domain.ErrCapacityExceeded):
		writeError(w, http.StatusConflict, "capacity_exceeded", err.Error())
	case errors.Is(err, domain.ErrInvalidTenant):
		writeError(w, http.StatusBadRequest, "invalid_tenant", err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "An internal error occurred")
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, ErrorResponse{Error: msg, Code: code})
}
