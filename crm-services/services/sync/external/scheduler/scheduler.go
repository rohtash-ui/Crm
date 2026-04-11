// Package scheduler runs periodic sync jobs that pull data from the legacy
// CRM at nfs.mecntech.com and upsert it into the new CRM. It runs every
// 30 minutes and supports incremental sync via modified-since timestamps.
package scheduler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"crm-services/services/sync/external/client"
	"crm-services/services/sync/external/mapper"
)

// SyncInterval is how often the external sync job runs.
const SyncInterval = 30 * time.Minute

// entitySyncOrder defines the order in which entity types are synced.
// Dependencies first: accounts → contacts → leads → deals → activities → notes.
var entitySyncOrder = []string{
	"account",
	"contact",
	"lead",
	"deal",
	"activity",
	"note",
}

// ExternalSyncScheduler orchestrates periodic data sync from the legacy CRM.
type ExternalSyncScheduler struct {
	nfsClient *client.NFSClient
	db        *sql.DB
	tenantID  string
	source    string
	stopCh    chan struct{}
	wg        sync.WaitGroup
	logger    *log.Logger
}

// NewExternalSyncScheduler creates a new scheduler.
func NewExternalSyncScheduler(nfsClient *client.NFSClient, db *sql.DB, tenantID string, logger *log.Logger) *ExternalSyncScheduler {
	if logger == nil {
		logger = log.Default()
	}
	return &ExternalSyncScheduler{
		nfsClient: nfsClient,
		db:        db,
		tenantID:  tenantID,
		source:    mapper.ExternalSourceNFS,
		stopCh:    make(chan struct{}),
		logger:    logger,
	}
}

// Start begins the periodic sync loop. It runs an immediate sync on startup,
// then repeats every 30 minutes.
func (s *ExternalSyncScheduler) Start() {
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()

		s.logger.Printf("[ExternalSync] Starting sync scheduler (interval=%s, tenant=%s, source=%s)",
			SyncInterval, s.tenantID, s.source)

		// Run immediately on startup
		s.runFullSync()

		ticker := time.NewTicker(SyncInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				s.runFullSync()
			case <-s.stopCh:
				s.logger.Println("[ExternalSync] Scheduler stopped")
				return
			}
		}
	}()
}

// Stop gracefully stops the scheduler and waits for the current sync to complete.
func (s *ExternalSyncScheduler) Stop() {
	close(s.stopCh)
	s.wg.Wait()
}

// RunOnce triggers a single full sync (useful for testing or manual trigger).
func (s *ExternalSyncScheduler) RunOnce() {
	s.runFullSync()
}

func (s *ExternalSyncScheduler) runFullSync() {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	defer cancel()

	startTime := time.Now()
	s.logger.Printf("[ExternalSync] === Sync cycle starting at %s ===", startTime.Format(time.RFC3339))

	totalSynced := 0
	totalErrors := 0

	for _, entityType := range entitySyncOrder {
		select {
		case <-s.stopCh:
			s.logger.Println("[ExternalSync] Sync cycle interrupted by shutdown")
			return
		default:
		}

		synced, errs := s.syncEntityType(ctx, entityType)
		totalSynced += synced
		totalErrors += errs

		s.logger.Printf("[ExternalSync] %s: synced=%d, errors=%d", entityType, synced, errs)
	}

	elapsed := time.Since(startTime)
	s.logger.Printf("[ExternalSync] === Sync cycle complete: %d records synced, %d errors, took %s ===",
		totalSynced, totalErrors, elapsed.Round(time.Millisecond))
}

func (s *ExternalSyncScheduler) syncEntityType(ctx context.Context, entityType string) (synced int, errors int) {
	// Get last sync timestamp for incremental fetch
	lastSyncAt := s.getLastSyncTime(ctx, entityType)

	// Update sync state to running
	s.updateSyncState(ctx, entityType, "running", nil)

	page := 1
	for {
		select {
		case <-ctx.Done():
			s.updateSyncState(ctx, entityType, "failed", fmt.Errorf("context cancelled"))
			return synced, errors + 1
		default:
		}

		// Fetch page from legacy CRM
		resp, err := s.fetchPage(ctx, entityType, lastSyncAt, page)
		if err != nil {
			s.logger.Printf("[ExternalSync] ERROR fetching %s page %d: %v", entityType, page, err)
			s.updateSyncState(ctx, entityType, "failed", err)
			return synced, errors + 1
		}

		if len(resp.Data) == 0 {
			break
		}

		// Map and upsert each record
		for _, raw := range resp.Data {
			record, err := s.mapRecord(entityType, raw)
			if err != nil {
				s.logger.Printf("[ExternalSync] ERROR mapping %s record: %v", entityType, err)
				errors++
				continue
			}

			if err := s.upsertRecord(ctx, record); err != nil {
				s.logger.Printf("[ExternalSync] ERROR upserting %s (ext_id=%s): %v",
					entityType, record.ExternalID, err)
				errors++
				continue
			}

			synced++
		}

		if !resp.Pagination.HasMore {
			break
		}
		page++
	}

	// Update sync state on success
	s.updateSyncStateSuccess(ctx, entityType, synced)

	return synced, errors
}

func (s *ExternalSyncScheduler) fetchPage(ctx context.Context, entityType string, modifiedSince *time.Time, page int) (*client.NFSListResponse, error) {
	switch entityType {
	case "lead":
		return s.nfsClient.FetchLeads(ctx, modifiedSince, page)
	case "contact":
		return s.nfsClient.FetchContacts(ctx, modifiedSince, page)
	case "deal":
		return s.nfsClient.FetchDeals(ctx, modifiedSince, page)
	case "account":
		return s.nfsClient.FetchAccounts(ctx, modifiedSince, page)
	case "activity":
		return s.nfsClient.FetchActivities(ctx, modifiedSince, page)
	case "note":
		return s.nfsClient.FetchNotes(ctx, modifiedSince, page)
	default:
		return nil, fmt.Errorf("unsupported entity type: %s", entityType)
	}
}

func (s *ExternalSyncScheduler) mapRecord(entityType string, raw json.RawMessage) (*mapper.InternalRecord, error) {
	switch entityType {
	case "lead":
		return mapper.MapLead(raw)
	case "contact":
		return mapper.MapContact(raw)
	case "deal":
		return mapper.MapDeal(raw)
	case "account":
		return mapper.MapAccount(raw)
	case "activity":
		return mapper.MapActivity(raw)
	case "note":
		return mapper.MapNote(raw)
	default:
		return nil, fmt.Errorf("unsupported entity type: %s", entityType)
	}
}

// upsertRecord inserts or updates a record in the new CRM, using the external ID
// for deduplication and a data hash for change detection.
func (s *ExternalSyncScheduler) upsertRecord(ctx context.Context, record *mapper.InternalRecord) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Check if we already have this external record mapped
	var existingInternalID string
	var existingHash string
	err = tx.QueryRowContext(ctx,
		`SELECT internal_id, external_hash FROM external_record_map
		 WHERE tenant_id = $1 AND source = $2 AND entity_type = $3 AND external_id = $4`,
		s.tenantID, record.ExternalSource, record.EntityType, record.ExternalID,
	).Scan(&existingInternalID, &existingHash)

	dataJSON, err2 := json.Marshal(record.Data)
	if err2 != nil {
		return fmt.Errorf("marshal data: %w", err2)
	}

	if err == sql.ErrNoRows {
		// New record — insert
		internalID := fmt.Sprintf("%s-%s-%s", record.ExternalSource, record.EntityType, record.ExternalID)

		tableName, tableErr := entityTable(record.EntityType)
		if tableErr != nil {
			return tableErr
		}

		_, err = tx.ExecContext(ctx, fmt.Sprintf(
			`INSERT INTO %s (id, tenant_id, version, data, created_at, updated_at)
			 VALUES ($1, $2, 1, $3, NOW(), NOW())
			 ON CONFLICT (id, tenant_id) DO UPDATE SET
			     data = %s.data || $3,
			     version = %s.version + 1,
			     updated_at = NOW()`,
			tableName, tableName, tableName),
			internalID, s.tenantID, dataJSON,
		)
		if err != nil {
			return fmt.Errorf("insert %s: %w", record.EntityType, err)
		}

		// Create the mapping
		_, err = tx.ExecContext(ctx,
			`INSERT INTO external_record_map (tenant_id, source, entity_type, external_id, internal_id, external_hash, last_synced_at)
			 VALUES ($1, $2, $3, $4, $5, $6, NOW())
			 ON CONFLICT (tenant_id, source, entity_type, external_id) DO UPDATE SET
			     internal_id = $5, external_hash = $6, last_synced_at = NOW()`,
			s.tenantID, record.ExternalSource, record.EntityType, record.ExternalID,
			internalID, record.DataHash,
		)
		if err != nil {
			return fmt.Errorf("insert record map: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("check existing record: %w", err)
	} else {
		// Record exists — check if data changed
		if existingHash == record.DataHash {
			// No changes — skip
			return nil
		}

		// Data changed — update
		tableName, tableErr := entityTable(record.EntityType)
		if tableErr != nil {
			return tableErr
		}

		_, err = tx.ExecContext(ctx, fmt.Sprintf(
			`UPDATE %s SET
			     data = data || $1,
			     version = version + 1,
			     updated_at = NOW()
			 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
			tableName),
			dataJSON, existingInternalID, s.tenantID,
		)
		if err != nil {
			return fmt.Errorf("update %s: %w", record.EntityType, err)
		}

		// Update the hash
		_, err = tx.ExecContext(ctx,
			`UPDATE external_record_map SET external_hash = $1, last_synced_at = NOW()
			 WHERE tenant_id = $2 AND source = $3 AND entity_type = $4 AND external_id = $5`,
			record.DataHash, s.tenantID, record.ExternalSource, record.EntityType, record.ExternalID,
		)
		if err != nil {
			return fmt.Errorf("update record map: %w", err)
		}
	}

	return tx.Commit()
}

// --- Sync state management ---

func (s *ExternalSyncScheduler) getLastSyncTime(ctx context.Context, entityType string) *time.Time {
	var lastSyncAt sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT last_sync_at FROM external_sync_state
		 WHERE tenant_id = $1 AND source = $2 AND entity_type = $3`,
		s.tenantID, s.source, entityType,
	).Scan(&lastSyncAt)

	if err != nil || !lastSyncAt.Valid {
		return nil // Full sync — no previous timestamp
	}

	t := lastSyncAt.Time
	return &t
}

func (s *ExternalSyncScheduler) updateSyncState(ctx context.Context, entityType, status string, syncErr error) {
	var errMsg *string
	if syncErr != nil {
		e := syncErr.Error()
		errMsg = &e
	}

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO external_sync_state (id, tenant_id, source, entity_type, status, last_error, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW())
		 ON CONFLICT ON CONSTRAINT idx_external_sync_state_lookup
		 DO UPDATE SET status = $5, last_error = $6, updated_at = NOW(),
		     error_count = CASE WHEN $5 = 'failed' THEN external_sync_state.error_count + 1 ELSE 0 END`,
		fmt.Sprintf("%s-%s-%s", s.tenantID, s.source, entityType),
		s.tenantID, s.source, entityType, status, errMsg,
	)
	if err != nil {
		s.logger.Printf("[ExternalSync] WARN: failed to update sync state for %s: %v", entityType, err)
	}
}

func (s *ExternalSyncScheduler) updateSyncStateSuccess(ctx context.Context, entityType string, recordsSynced int) {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO external_sync_state (id, tenant_id, source, entity_type, status, last_sync_at, records_synced, error_count, updated_at)
		 VALUES ($1, $2, $3, $4, 'idle', NOW(), $5, 0, NOW())
		 ON CONFLICT ON CONSTRAINT idx_external_sync_state_lookup
		 DO UPDATE SET status = 'idle', last_sync_at = NOW(),
		     records_synced = external_sync_state.records_synced + $5,
		     error_count = 0, last_error = NULL, updated_at = NOW()`,
		fmt.Sprintf("%s-%s-%s", s.tenantID, s.source, entityType),
		s.tenantID, s.source, entityType, recordsSynced,
	)
	if err != nil {
		s.logger.Printf("[ExternalSync] WARN: failed to update sync success state for %s: %v", entityType, err)
	}
}

// entityTable maps entity types to table names (mirrors postgres_repo.go).
func entityTable(entityType string) (string, error) {
	tables := map[string]string{
		"contact":  "contacts",
		"deal":     "deals",
		"activity": "activities",
		"lead":     "leads",
		"account":  "accounts",
		"note":     "notes",
	}
	table, ok := tables[entityType]
	if !ok {
		return "", fmt.Errorf("unknown entity type: %s", entityType)
	}
	return table, nil
}
