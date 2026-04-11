package api

import "net/http"

// RegisterRoutes wires up the location-tracking HTTP routes on the given mux.
func RegisterRoutes(mux *http.ServeMux, h *Handler) {
	mux.HandleFunc("POST /api/v1/location-tracking/batch", h.IngestBatch)
	mux.HandleFunc("GET /api/v1/location-tracking/history", h.GetHistory)
	mux.HandleFunc("GET /api/v1/location-tracking/live", h.GetLiveLocations)
	mux.HandleFunc("GET /api/v1/location-tracking/config", h.GetConfig)
}
