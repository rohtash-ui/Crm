package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// ManualAssignHandler exposes the full manager/team-lead lead assignment UI endpoints.
// These give managers the ability to browse leads, see team workloads, and assign.
type ManualAssignHandler struct {
	svc *domain.ManualAssignmentService
}

func NewManualAssignHandler(svc *domain.ManualAssignmentService) *ManualAssignHandler {
	return &ManualAssignHandler{svc: svc}
}

// --- DTOs ---

type AssignLeadRequest struct {
	LeadID     string `json:"lead_id"`
	AssignToID string `json:"assign_to_id"`
	Reason     string `json:"reason,omitempty"`
}

type ReassignLeadRequest struct {
	LeadID     string `json:"lead_id"`
	FromUserID string `json:"from_user_id,omitempty"`
	ToUserID   string `json:"to_user_id"`
	Reason     string `json:"reason,omitempty"`
}

type BulkAssignLeadsRequest struct {
	LeadIDs    []string `json:"lead_ids"`
	AssignToID string   `json:"assign_to_id"`
	Reason     string   `json:"reason,omitempty"`
}

type UnassignLeadRequest struct {
	LeadID string `json:"lead_id"`
	Reason string `json:"reason,omitempty"`
}

// --- Browse: leads ---

// HandleListLeads lists leads for the manager's assignment view with rich filters.
//
// GET /api/v1/manage/leads
//
// Query params:
//   status        comma-separated: new,assigned,contacted,qualified
//   assigned_to   user_id, or "unassigned" to show only unassigned leads
//   project_id    filter by project
//   location_id   filter by location
//   region_id     filter by region
//   search        free text: name, email, phone, company
//   page          page number (default 1)
//   page_size     results per page (default 50, max 200)
func (h *ManualAssignHandler) HandleListLeads(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, _, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	filter := domain.LeadFilter{
		AssignedTo: r.URL.Query().Get("assigned_to"),
		ProjectID:  r.URL.Query().Get("project_id"),
		LocationID: r.URL.Query().Get("location_id"),
		RegionID:   r.URL.Query().Get("region_id"),
		Search:     r.URL.Query().Get("search"),
	}

	if raw := r.URL.Query().Get("status"); raw != "" {
		for _, s := range strings.Split(raw, ",") {
			filter.Status = append(filter.Status, domain.LeadStatus(strings.TrimSpace(s)))
		}
	}

	filter.Page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	if filter.Page < 1 {
		filter.Page = 1
	}
	filter.PageSize, _ = strconv.Atoi(r.URL.Query().Get("page_size"))
	if filter.PageSize < 1 {
		filter.PageSize = 50
	}
	if filter.PageSize > 200 {
		filter.PageSize = 200
	}

	page, err := h.svc.ListLeads(ctx, tenantID, filter, userRole)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, page)
}

// HandleGetLead returns a single lead with its full assignment history.
//
// GET /api/v1/manage/leads/{lead_id}
func (h *ManualAssignHandler) HandleGetLead(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, _, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	leadID := r.PathValue("lead_id")
	if leadID == "" {
		writeError(w, http.StatusBadRequest, "missing_lead_id", "lead_id path param is required")
		return
	}

	lead, history, err := h.svc.GetLead(ctx, tenantID, leadID, userRole)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"lead":    lead,
		"history": history,
	})
}

// --- Browse: team members ---

// HandleListMemberWorkloads shows every team member with their lead counts and availability.
// Managers use this to decide who to assign to.
//
// GET /api/v1/manage/teams/{team_id}/workloads
func (h *ManualAssignHandler) HandleListMemberWorkloads(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, _, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	teamID := r.PathValue("team_id")
	if teamID == "" {
		writeError(w, http.StatusBadRequest, "missing_team_id", "team_id path param is required")
		return
	}

	workloads, err := h.svc.ListMemberWorkloads(ctx, tenantID, teamID, userRole)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"members": workloads})
}

// HandleGetMemberLeads returns all leads currently assigned to a specific rep.
// Managers use this to review someone's workload before reassigning.
//
// GET /api/v1/manage/members/{user_id}/leads
func (h *ManualAssignHandler) HandleGetMemberLeads(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, _, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	assigneeID := r.PathValue("user_id")
	if assigneeID == "" {
		writeError(w, http.StatusBadRequest, "missing_user_id", "user_id path param is required")
		return
	}

	page, err := h.svc.GetMemberLeads(ctx, tenantID, assigneeID, userRole)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, page)
}

// --- Assign ---

// HandleAssignLead assigns a single lead to a specific sales rep.
//
// POST /api/v1/manage/leads/assign
func (h *ManualAssignHandler) HandleAssignLead(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, userID, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req AssignLeadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}
	if req.LeadID == "" || req.AssignToID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "lead_id and assign_to_id are required")
		return
	}

	lead, err := h.svc.AssignLead(ctx, domain.AssignLeadRequest{
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

	writeJSON(w, http.StatusOK, map[string]any{
		"lead":    lead,
		"message": "Lead assigned",
	})
}

// HandleReassignLead moves a lead from one rep to another.
//
// POST /api/v1/manage/leads/reassign
func (h *ManualAssignHandler) HandleReassignLead(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, userID, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req ReassignLeadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}
	if req.LeadID == "" || req.ToUserID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "lead_id and to_user_id are required")
		return
	}

	lead, err := h.svc.ReassignLead(ctx, domain.ReassignLeadRequest{
		TenantID:       tenantID,
		LeadID:         req.LeadID,
		FromUserID:     req.FromUserID,
		ToUserID:       req.ToUserID,
		ReassignedBy:   userID,
		ReassignByRole: userRole,
		Reason:         req.Reason,
	})
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"lead":    lead,
		"message": "Lead reassigned",
	})
}

// HandleBulkAssignLeads assigns multiple hand-picked leads to one sales rep.
// Returns per-lead success/failure detail.
//
// POST /api/v1/manage/leads/bulk-assign
func (h *ManualAssignHandler) HandleBulkAssignLeads(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, userID, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req BulkAssignLeadsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}
	if len(req.LeadIDs) == 0 || req.AssignToID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "lead_ids and assign_to_id are required")
		return
	}
	if len(req.LeadIDs) > 500 {
		writeError(w, http.StatusBadRequest, "too_many_leads", "Maximum 500 leads per bulk assignment")
		return
	}

	result, err := h.svc.BulkAssignLeads(ctx, domain.BulkAssignRequest{
		TenantID:     tenantID,
		LeadIDs:      req.LeadIDs,
		AssignToID:   req.AssignToID,
		AssignByID:   userID,
		AssignByRole: userRole,
		Reason:       req.Reason,
	})
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// HandleUnassignLead removes an assignee from a lead, returning it to the pool.
//
// POST /api/v1/manage/leads/unassign
func (h *ManualAssignHandler) HandleUnassignLead(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, userID, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req UnassignLeadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}
	if req.LeadID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "lead_id is required")
		return
	}

	lead, err := h.svc.UnassignLead(ctx, domain.UnassignLeadRequest{
		TenantID:     tenantID,
		LeadID:       req.LeadID,
		UnassignedBy: userID,
		ByRole:       userRole,
		Reason:       req.Reason,
	})
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"lead":    lead,
		"message": "Lead returned to unassigned pool",
	})
}
