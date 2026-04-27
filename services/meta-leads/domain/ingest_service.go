package domain

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"
)

type IngestService struct {
	db            TxBeginner
	rawLeadRepo   RawLeadRepo
	outboxRepo    OutboxRepo
	connectionRepo ConnectionRepo
	formRepo      FormRepo
	graphClient   GraphAPIClient
	encryptor     TokenEncryptor
}

func NewIngestService(
	db TxBeginner,
	rawLeadRepo RawLeadRepo,
	outboxRepo OutboxRepo,
	connectionRepo ConnectionRepo,
	formRepo FormRepo,
	graphClient GraphAPIClient,
	encryptor TokenEncryptor,
) *IngestService {
	return &IngestService{
		db:             db,
		rawLeadRepo:    rawLeadRepo,
		outboxRepo:     outboxRepo,
		connectionRepo: connectionRepo,
		formRepo:       formRepo,
		graphClient:    graphClient,
		encryptor:      encryptor,
	}
}

func (s *IngestService) IngestFromWebhook(ctx context.Context, tenantID, pageID, formID, leadgenID string) error {
	conn, err := s.connectionRepo.GetByPageID(ctx, tenantID, pageID)
	if err != nil {
		return fmt.Errorf("get connection: %w", err)
	}
	if conn.TokenStatus != TokenStatusActive {
		return ErrTokenRevoked
	}

	token, err := s.decryptToken(conn)
	if err != nil {
		return fmt.Errorf("decrypt token: %w", err)
	}

	lead, err := s.graphClient.GetLead(ctx, leadgenID, token)
	if err != nil {
		if isOAuthError(err) {
			s.handleTokenRevocation(ctx, conn)
		}
		return fmt.Errorf("fetch lead from graph API: %w", err)
	}
	lead.FormID = formID

	return s.ingest(ctx, tenantID, pageID, formID, leadgenID, lead, SourcePathWebhook)
}

func (s *IngestService) IngestFromPoll(ctx context.Context, tenantID, pageID, formID string, lead *GraphLead) error {
	return s.ingest(ctx, tenantID, pageID, formID, lead.ID, lead, SourcePathPoll)
}

func (s *IngestService) ingest(ctx context.Context, tenantID, pageID, formID, leadgenID string, lead *GraphLead, source SourcePath) error {
	rawJSON, err := json.Marshal(lead)
	if err != nil {
		return fmt.Errorf("marshal raw lead: %w", err)
	}

	event := MapGraphLeadToEvent(tenantID, pageID, lead)
	eventPayload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	rawLead := &MetaRawLead{
		TenantID:   tenantID,
		LeadgenID:  leadgenID,
		FormID:     formID,
		PageID:     pageID,
		RawJSON:    rawJSON,
		SourcePath: source,
		IngestedAt: time.Now().UTC(),
	}
	inserted, err := s.rawLeadRepo.InsertTx(ctx, tx, rawLead)
	if err != nil {
		return fmt.Errorf("insert raw lead: %w", err)
	}

	if !inserted {
		return nil
	}

	outboxEntry := &OutboxEntry{
		TenantID:     tenantID,
		AggregateID:  MakeExternalID(pageID, leadgenID),
		EventType:    EventLeadCreated,
		Payload:      eventPayload,
		PartitionKey: tenantID,
	}
	if err := s.outboxRepo.InsertTx(ctx, tx, outboxEntry); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	log.Printf("[INGEST] tenant=%s leadgen_id=%s source=%s", tenantID, leadgenID, source)
	return nil
}

func (s *IngestService) decryptToken(conn *MetaConnection) (string, error) {
	plaintext, err := s.encryptor.Decrypt(conn.PageAccessTokenCiphertext, conn.KMSKeyID)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func (s *IngestService) handleTokenRevocation(ctx context.Context, conn *MetaConnection) {
	if err := s.connectionRepo.UpdateTokenStatus(ctx, conn.ID, TokenStatusRevoked); err != nil {
		log.Printf("[ERROR] failed to mark connection revoked: %v", err)
	}
	if err := s.formRepo.DisablePollingByConnection(ctx, conn.ID); err != nil {
		log.Printf("[ERROR] failed to disable polling for connection: %v", err)
	}
	log.Printf("[REVOKED] tenant=%s page=%s", conn.TenantID, conn.PageID)
}

func isOAuthError(err error) bool {
	var graphErr *GraphAPIError
	if ok := asGraphAPIError(err, &graphErr); ok {
		return graphErr.Code == 190
	}
	return false
}

type GraphAPIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Type    string `json:"type"`
}

func (e *GraphAPIError) Error() string {
	return fmt.Sprintf("graph API error %d (%s): %s", e.Code, e.Type, e.Message)
}

func asGraphAPIError(err error, target **GraphAPIError) bool {
	type causer interface {
		GraphError() *GraphAPIError
	}
	if c, ok := err.(causer); ok {
		*target = c.GraphError()
		return true
	}
	return false
}

func (s *IngestService) DB() *sql.DB {
	if db, ok := s.db.(*sql.DB); ok {
		return db
	}
	return nil
}
