package api

import (
	"net/http"
)

// RegisterRoutes wires up the lead assignment API endpoints.
// In production, this would use the shared router (e.g., chi, gorilla/mux, or net/http ServeMux).
func RegisterRoutes(mux *http.ServeMux, h *Handler) {
	// Round-robin assignment
	mux.HandleFunc("POST /api/v1/leads/assign/round-robin", h.HandleRoundRobinAssign)
	mux.HandleFunc("POST /api/v1/leads/assign/round-robin/bulk", h.HandleBulkRoundRobinAssign)

	// Manual assignment (team leads & managers)
	mux.HandleFunc("POST /api/v1/leads/assign/manual", h.HandleManualAssign)

	// Bulk region assignment (managers assign leads to regions)
	mux.HandleFunc("POST /api/v1/leads/assign/region", h.HandleBulkRegionAssign)

	// Health check
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})
}
