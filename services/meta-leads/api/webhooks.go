package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type WebhookHandler struct {
	ingestSvc    *domain.IngestService
	deliveryRepo domain.DeliveryRepo
	formRepo     domain.FormRepo
	appSecret    string
	verifyToken  string
}

func NewWebhookHandler(
	ingestSvc *domain.IngestService,
	deliveryRepo domain.DeliveryRepo,
	formRepo domain.FormRepo,
	appSecret string,
	verifyToken string,
) *WebhookHandler {
	return &WebhookHandler{
		ingestSvc:    ingestSvc,
		deliveryRepo: deliveryRepo,
		formRepo:     formRepo,
		appSecret:    appSecret,
		verifyToken:  verifyToken,
	}
}

func (h *WebhookHandler) HandleVerification(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("hub.mode")
	token := r.URL.Query().Get("hub.verify_token")
	challenge := r.URL.Query().Get("hub.challenge")

	if mode != "subscribe" {
		http.Error(w, "invalid mode", http.StatusBadRequest)
		return
	}

	if err := domain.VerifyHubChallenge(token, h.verifyToken); err != nil {
		log.Printf("[WEBHOOK VERIFY] invalid verify token")
		http.Error(w, "invalid verify token", http.StatusForbidden)
		return
	}

	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, challenge)
	log.Printf("[WEBHOOK VERIFY] subscription confirmed")
}

func (h *WebhookHandler) HandleLeadgen(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	signature := r.Header.Get("X-Hub-Signature-256")
	if err := domain.VerifyWebhookSignature(body, signature, h.appSecret); err != nil {
		log.Printf("[WEBHOOK] signature verification failed")
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}

	var payload WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	if payload.Object != "page" {
		w.WriteHeader(http.StatusOK)
		return
	}

	for _, entry := range payload.Entry {
		deliveryID := fmt.Sprintf("%s-%d", entry.ID, entry.Time)
		isNew, err := h.deliveryRepo.MarkDelivered(r.Context(), deliveryID)
		if err != nil {
			log.Printf("[WEBHOOK ERROR] mark delivery: %v", err)
			continue
		}
		if !isNew {
			log.Printf("[WEBHOOK] duplicate delivery %s, skipping", deliveryID)
			continue
		}

		for _, change := range entry.Changes {
			if change.Field != "leadgen" {
				continue
			}

			tenantID := h.resolveTenantID(r.Context(), change.Value.PageID)
			if tenantID == "" {
				log.Printf("[WEBHOOK] no tenant found for page %s", change.Value.PageID)
				continue
			}

			if err := h.ingestSvc.IngestFromWebhook(
				r.Context(),
				tenantID,
				change.Value.PageID,
				change.Value.FormID,
				change.Value.LeadgenID,
			); err != nil {
				log.Printf("[WEBHOOK ERROR] ingest leadgen=%s: %v", change.Value.LeadgenID, err)
			}

			now := time.Now().UTC()
			form, fErr := h.formRepo.GetByFormID(r.Context(), tenantID, change.Value.FormID)
			if fErr == nil {
				h.formRepo.UpdateLastWebhookAt(r.Context(), form.ID, now)
			}
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(SuccessResponse{Status: "ok"})
}

func (h *WebhookHandler) resolveTenantID(ctx interface{ Value(any) any }, pageID string) string {
	db := h.ingestSvc.DB()
	if db == nil {
		return ""
	}
	var tenantID string
	err := db.QueryRow(
		`SELECT tenant_id FROM meta_connections WHERE page_id = $1 AND token_status = 'active' LIMIT 1`,
		pageID,
	).Scan(&tenantID)
	if err != nil {
		return ""
	}
	return tenantID
}
