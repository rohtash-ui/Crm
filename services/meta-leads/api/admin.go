package api

import (
	"encoding/json"
	"net/http"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type AdminHandler struct {
	tokenSvc   *domain.TokenService
	formRepo   domain.FormRepo
	connRepo   domain.ConnectionRepo
	pollerSvc  *domain.PollerService
}

func NewAdminHandler(
	tokenSvc *domain.TokenService,
	formRepo domain.FormRepo,
	connRepo domain.ConnectionRepo,
	pollerSvc *domain.PollerService,
) *AdminHandler {
	return &AdminHandler{
		tokenSvc:  tokenSvc,
		formRepo:  formRepo,
		connRepo:  connRepo,
		pollerSvc: pollerSvc,
	}
}

func (h *AdminHandler) HandleCreateConnection(w http.ResponseWriter, r *http.Request) {
	var req CreateConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	if req.TenantID == "" || req.PageID == "" || req.PageAccessToken == "" {
		writeError(w, http.StatusBadRequest, "tenant_id, page_id, and page_access_token are required")
		return
	}

	if err := h.tokenSvc.StoreConnection(r.Context(), req.TenantID, req.PageID, req.AppID, req.PageAccessToken); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store connection")
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(SuccessResponse{Status: "created", Message: "Meta connection stored"})
}

func (h *AdminHandler) HandleListConnections(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "X-Tenant-ID header is required")
		return
	}

	conns, err := h.connRepo.ListActive(r.Context(), tenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list connections")
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(conns)
}

func (h *AdminHandler) HandleCreateForm(w http.ResponseWriter, r *http.Request) {
	var req CreateFormRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	if req.TenantID == "" || req.FormID == "" || req.ConnectionID == "" {
		writeError(w, http.StatusBadRequest, "tenant_id, form_id, and connection_id are required")
		return
	}

	form := &domain.MetaForm{
		TenantID:       req.TenantID,
		FormID:         req.FormID,
		ConnectionID:   req.ConnectionID,
		FormName:       req.FormName,
		PollingEnabled: true,
	}

	if err := h.formRepo.Upsert(r.Context(), form); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store form")
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(SuccessResponse{Status: "created", Message: "Meta form registered"})
}

func (h *AdminHandler) HandleTriggerSync(w http.ResponseWriter, r *http.Request) {
	if err := h.pollerSvc.PollAll(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "poll failed: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(SuccessResponse{Status: "ok", Message: "manual sync completed"})
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(ErrorResponse{Error: msg})
}
