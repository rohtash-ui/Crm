package domain

import (
	"context"
	"fmt"
	"log"
	"time"
)

type PollerService struct {
	formRepo    FormRepo
	graphClient GraphAPIClient
	ingestSvc   *IngestService
	encryptor   TokenEncryptor
	safetyOverlap time.Duration
}

func NewPollerService(
	formRepo FormRepo,
	graphClient GraphAPIClient,
	ingestSvc *IngestService,
	encryptor TokenEncryptor,
	safetyOverlap time.Duration,
) *PollerService {
	return &PollerService{
		formRepo:      formRepo,
		graphClient:   graphClient,
		ingestSvc:     ingestSvc,
		encryptor:     encryptor,
		safetyOverlap: safetyOverlap,
	}
}

func (s *PollerService) PollAll(ctx context.Context) error {
	forms, err := s.formRepo.ListPollable(ctx)
	if err != nil {
		return fmt.Errorf("list pollable forms: %w", err)
	}

	var lastErr error
	for _, pf := range forms {
		if err := s.pollForm(ctx, pf); err != nil {
			log.Printf("[POLL ERROR] tenant=%s form=%s: %v", pf.Form.TenantID, pf.Form.FormID, err)
			lastErr = err
		}
	}
	return lastErr
}

func (s *PollerService) pollForm(ctx context.Context, pf PollableForm) error {
	if pf.Connection.TokenStatus != TokenStatusActive {
		log.Printf("[POLL SKIP] tenant=%s form=%s: token not active", pf.Form.TenantID, pf.Form.FormID)
		return nil
	}

	token, err := s.encryptor.Decrypt(pf.Connection.PageAccessTokenCiphertext, pf.Connection.KMSKeyID)
	if err != nil {
		return fmt.Errorf("decrypt token: %w", err)
	}

	since := time.Now().UTC().Add(-s.safetyOverlap)
	if pf.Form.LastPolledAt != nil {
		since = pf.Form.LastPolledAt.Add(-s.safetyOverlap)
	}

	leads, err := s.graphClient.ListFormLeads(ctx, pf.Form.FormID, since, string(token))
	if err != nil {
		if isOAuthError(err) {
			s.ingestSvc.handleTokenRevocation(ctx, &pf.Connection)
		}
		return fmt.Errorf("list form leads: %w", err)
	}

	for i := range leads {
		leads[i].FormID = pf.Form.FormID
		if err := s.ingestSvc.IngestFromPoll(ctx, pf.Form.TenantID, pf.Connection.PageID, pf.Form.FormID, &leads[i]); err != nil {
			log.Printf("[POLL INGEST ERROR] tenant=%s leadgen=%s: %v", pf.Form.TenantID, leads[i].ID, err)
		}
	}

	now := time.Now().UTC()
	if err := s.formRepo.UpdateLastPolledAt(ctx, pf.Form.ID, now); err != nil {
		return fmt.Errorf("update last_polled_at: %w", err)
	}

	log.Printf("[POLL] tenant=%s form=%s leads_fetched=%d", pf.Form.TenantID, pf.Form.FormID, len(leads))
	return nil
}
