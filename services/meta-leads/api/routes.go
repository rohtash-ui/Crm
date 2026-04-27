package api

import (
	"net/http"
)

func RegisterRoutes(mux *http.ServeMux, wh *WebhookHandler, admin *AdminHandler) {
	// Meta webhook endpoints
	mux.HandleFunc("GET /webhooks/meta", wh.HandleVerification)
	mux.HandleFunc("POST /webhooks/meta", wh.HandleLeadgen)

	// Admin: connection management
	mux.HandleFunc("POST /api/v1/meta/connections", admin.HandleCreateConnection)
	mux.HandleFunc("GET /api/v1/meta/connections", admin.HandleListConnections)

	// Admin: form management
	mux.HandleFunc("POST /api/v1/meta/forms", admin.HandleCreateForm)

	// Admin: manual sync trigger
	mux.HandleFunc("POST /api/v1/meta/sync", admin.HandleTriggerSync)

	// Health check
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})
}
