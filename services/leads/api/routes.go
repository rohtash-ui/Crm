package api

import (
	"net/http"
)

// RegisterRoutes wires up the lead assignment API endpoints.
func RegisterRoutes(mux *http.ServeMux, h *Handler, admin *AdminHandler) {
	// --- Lead Assignment ---
	mux.HandleFunc("POST /api/v1/leads/assign/round-robin", h.HandleRoundRobinAssign)
	mux.HandleFunc("POST /api/v1/leads/assign/round-robin/bulk", h.HandleBulkRoundRobinAssign)
	mux.HandleFunc("POST /api/v1/leads/assign/manual", h.HandleManualAssign)
	mux.HandleFunc("POST /api/v1/leads/assign/region", h.HandleBulkRegionAssign)

	// --- Admin: Availability / Leave Management ---
	mux.HandleFunc("POST /api/v1/admin/availability/leave", admin.HandleMarkLeave)
	mux.HandleFunc("POST /api/v1/admin/availability/unavailable", admin.HandleMarkUnavailable)
	mux.HandleFunc("DELETE /api/v1/admin/availability/leave", admin.HandleCancelLeave)
	mux.HandleFunc("GET /api/v1/admin/availability/today", admin.HandleGetUnavailableToday)

	// --- Admin: Daily Assignment Config / Roster ---
	mux.HandleFunc("POST /api/v1/admin/config/daily", admin.HandleSetDailyConfig)
	mux.HandleFunc("GET /api/v1/admin/config/today", admin.HandleGetTodaysConfig)

	// --- Admin: Automation Control ---
	mux.HandleFunc("POST /api/v1/admin/automation/pause", admin.HandlePauseAutomation)
	mux.HandleFunc("POST /api/v1/admin/automation/resume", admin.HandleResumeAutomation)

	// --- Admin: Rule Management ---
	mux.HandleFunc("GET /api/v1/admin/rules", admin.HandleListRules)
	mux.HandleFunc("POST /api/v1/admin/rules/toggle", admin.HandleToggleRule)

	// --- Admin: Round-Robin Control ---
	mux.HandleFunc("POST /api/v1/admin/round-robin/reset", admin.HandleResetRoundRobin)

	// --- Admin: Member Capacity ---
	mux.HandleFunc("POST /api/v1/admin/members/daily-cap", admin.HandleUpdateDailyCap)

	// --- Admin: Dashboard ---
	mux.HandleFunc("GET /api/v1/admin/roster/today", admin.HandleGetTodaysRoster)
	mux.HandleFunc("GET /api/v1/admin/stats", admin.HandleGetStats)

	// --- Health ---
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})
}
