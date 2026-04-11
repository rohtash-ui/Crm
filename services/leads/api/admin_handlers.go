package api

import (
	"encoding/json"
	"net/http"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// AdminHandler exposes the lead assignment control panel endpoints.
type AdminHandler struct {
	admin *domain.AdminService
}

func NewAdminHandler(admin *domain.AdminService) *AdminHandler {
	return &AdminHandler{admin: admin}
}

// --- Request DTOs ---

type MarkLeaveRequest struct {
	MemberID  string `json:"member_id"`
	UserID    string `json:"user_id"`
	LeaveType string `json:"leave_type"`
	StartDate string `json:"start_date"` // YYYY-MM-DD
	EndDate   string `json:"end_date"`   // YYYY-MM-DD
	Reason    string `json:"reason,omitempty"`
}

type MarkUnavailableRequest struct {
	MemberID string `json:"member_id"`
	UserID   string `json:"user_id"`
	Date     string `json:"date"` // YYYY-MM-DD
	Reason   string `json:"reason,omitempty"`
}

type CancelLeaveRequest struct {
	EntryID string `json:"entry_id"`
}

type SetDailyConfigRequest struct {
	ConfigDate         string               `json:"config_date"` // YYYY-MM-DD
	RuleID             string               `json:"rule_id,omitempty"`
	IsAutomationActive bool                 `json:"is_automation_active"`
	Roster             []domain.RosterEntry `json:"roster"`
	Notes              string               `json:"notes,omitempty"`
}

type PauseResumeRequest struct {
	RuleID string `json:"rule_id,omitempty"`
}

type ToggleRuleRequest struct {
	RuleID string `json:"rule_id"`
	Active bool   `json:"active"`
}

type UpdateRulePriorityRequest struct {
	RuleID   string `json:"rule_id"`
	Priority int    `json:"priority"`
}

type ResetRoundRobinRequest struct {
	RuleID string `json:"rule_id"`
}

type UpdateDailyCapRequest struct {
	MemberID      string `json:"member_id"`
	UserID        string `json:"user_id"`
	MaxLeadsToday int    `json:"max_leads_today"`
}

type GetRosterRequest struct {
	TeamID string `json:"team_id"`
}

// --- Handlers ---

// HandleMarkLeave marks a team member as on leave for a date range.
// POST /api/v1/admin/availability/leave
func (h *AdminHandler) HandleMarkLeave(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, userID, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req MarkLeaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if req.MemberID == "" || req.StartDate == "" || req.EndDate == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "member_id, start_date, and end_date are required")
		return
	}

	entry, err := h.admin.MarkMemberOnLeave(ctx, domain.MarkLeaveRequest{
		TenantID:     tenantID,
		MemberID:     req.MemberID,
		UserID:       req.UserID,
		LeaveType:    domain.LeaveType(req.LeaveType),
		StartDate:    req.StartDate,
		EndDate:      req.EndDate,
		Reason:       req.Reason,
		MarkedByID:   userID,
		MarkedByRole: userRole,
	})
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"availability": entry,
		"message":      "Member marked as on leave",
	})
}

// HandleMarkUnavailable marks a member as unavailable for a single day.
// POST /api/v1/admin/availability/unavailable
func (h *AdminHandler) HandleMarkUnavailable(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, userID, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req MarkUnavailableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if req.MemberID == "" || req.Date == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "member_id and date are required")
		return
	}

	entry, err := h.admin.MarkMemberUnavailable(ctx, tenantID, req.MemberID, req.UserID, req.Date, req.Reason, userID, userRole)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"availability": entry,
		"message":      "Member marked as unavailable",
	})
}

// HandleCancelLeave removes a leave entry.
// DELETE /api/v1/admin/availability/leave
func (h *AdminHandler) HandleCancelLeave(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, _, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req CancelLeaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if err := h.admin.CancelLeave(ctx, tenantID, req.EntryID, userRole); err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Leave cancelled"})
}

// HandleGetUnavailableToday lists all members unavailable today.
// GET /api/v1/admin/availability/today
func (h *AdminHandler) HandleGetUnavailableToday(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return
	}

	entries, err := h.admin.GetUnavailableToday(ctx, tenantID)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"unavailable": entries})
}

// HandleSetDailyConfig creates or updates the daily assignment config/roster.
// POST /api/v1/admin/config/daily
func (h *AdminHandler) HandleSetDailyConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, userID, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req SetDailyConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if req.ConfigDate == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "config_date is required")
		return
	}

	config, err := h.admin.SetDailyConfig(ctx, domain.SetDailyConfigRequest{
		TenantID:           tenantID,
		ConfigDate:         req.ConfigDate,
		RuleID:             req.RuleID,
		IsAutomationActive: req.IsAutomationActive,
		Roster:             req.Roster,
		Notes:              req.Notes,
		SetByID:            userID,
		SetByRole:          userRole,
	})
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"config":  config,
		"message": "Daily assignment config saved",
	})
}

// HandleGetTodaysConfig returns the current daily config.
// GET /api/v1/admin/config/today
func (h *AdminHandler) HandleGetTodaysConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return
	}

	ruleID := r.URL.Query().Get("rule_id")
	config, err := h.admin.GetTodaysConfig(ctx, tenantID, ruleID)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"config": config})
}

// HandlePauseAutomation pauses auto-assignment for today.
// POST /api/v1/admin/automation/pause
func (h *AdminHandler) HandlePauseAutomation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, userID, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req PauseResumeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if err := h.admin.PauseAutomation(ctx, tenantID, req.RuleID, userID, userRole); err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Automation paused for today"})
}

// HandleResumeAutomation resumes auto-assignment for today.
// POST /api/v1/admin/automation/resume
func (h *AdminHandler) HandleResumeAutomation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, userID, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req PauseResumeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if err := h.admin.ResumeAutomation(ctx, tenantID, req.RuleID, userID, userRole); err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Automation resumed for today"})
}

// HandleToggleRule enables or disables an assignment rule.
// POST /api/v1/admin/rules/toggle
func (h *AdminHandler) HandleToggleRule(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, _, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req ToggleRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	rule, err := h.admin.ToggleRule(ctx, tenantID, req.RuleID, req.Active, userRole)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"rule":    rule,
		"message": "Rule updated",
	})
}

// HandleListRules returns all active assignment rules.
// GET /api/v1/admin/rules
func (h *AdminHandler) HandleListRules(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return
	}

	rules, err := h.admin.ListRules(ctx, tenantID)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"rules": rules})
}

// HandleResetRoundRobin resets round-robin rotation for a rule.
// POST /api/v1/admin/round-robin/reset
func (h *AdminHandler) HandleResetRoundRobin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, _, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req ResetRoundRobinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if err := h.admin.ResetRoundRobin(ctx, tenantID, req.RuleID, userRole); err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Round-robin rotation reset"})
}

// HandleGetTodaysRoster returns full member status for today.
// GET /api/v1/admin/roster/today?team_id=...
func (h *AdminHandler) HandleGetTodaysRoster(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return
	}

	teamID := r.URL.Query().Get("team_id")
	if teamID == "" {
		writeError(w, http.StatusBadRequest, "missing_team_id", "team_id query param is required")
		return
	}

	roster, err := h.admin.GetTodaysRoster(ctx, tenantID, teamID)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"roster": roster})
}

// HandleGetStats returns assignment statistics dashboard.
// GET /api/v1/admin/stats?team_id=...
func (h *AdminHandler) HandleGetStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return
	}

	teamID := r.URL.Query().Get("team_id")
	if teamID == "" {
		writeError(w, http.StatusBadRequest, "missing_team_id", "team_id query param is required")
		return
	}

	stats, err := h.admin.GetAssignmentStats(ctx, tenantID, teamID)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"stats": stats})
}

// HandleUpdateDailyCap changes a member's daily lead cap.
// POST /api/v1/admin/members/daily-cap
func (h *AdminHandler) HandleUpdateDailyCap(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID, _, userRole, ok := extractAdminAuth(w, r)
	if !ok {
		return
	}

	var req UpdateDailyCapRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if req.MemberID == "" || req.MaxLeadsToday <= 0 {
		writeError(w, http.StatusBadRequest, "missing_fields", "member_id and max_leads_today (>0) are required")
		return
	}

	counter, err := h.admin.UpdateMemberDailyCap(ctx, tenantID, req.MemberID, req.UserID, req.MaxLeadsToday, userRole)
	if err != nil {
		handleDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"counter": counter,
		"message": "Daily cap updated",
	})
}

// --- Auth helper ---

func extractAdminAuth(w http.ResponseWriter, r *http.Request) (tenantID, userID string, role domain.UserRole, ok bool) {
	tenantID = r.Header.Get("X-Tenant-ID")
	userID = r.Header.Get("X-User-ID")
	roleStr := r.Header.Get("X-User-Role")

	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing_tenant", "X-Tenant-ID header is required")
		return "", "", "", false
	}
	if userID == "" || roleStr == "" {
		writeError(w, http.StatusBadRequest, "missing_auth", "X-User-ID and X-User-Role headers are required")
		return "", "", "", false
	}

	return tenantID, userID, domain.UserRole(roleStr), true
}
