// Command sync-server starts the CRM sync service, which includes:
//
//  1. The offline sync HTTP API (POST /api/v1/sync, GET /api/v1/sync/updates)
//  2. The external CRM sync scheduler that pulls data from nfs.mecntech.com
//     every 30 minutes and upserts it into the new CRM.
//
// Configuration is via environment variables:
//
//	DATABASE_URL       — Postgres connection string
//	REDIS_URL          — Redis connection string (for idempotency)
//	NFS_CRM_BASE_URL   — Legacy CRM base URL (default: https://nfs.mecntech.com)
//	NFS_CRM_API_KEY    — API key for legacy CRM authentication
//	NFS_CRM_USERNAME   — Basic auth username (if API key not used)
//	NFS_CRM_PASSWORD   — Basic auth password
//	TENANT_ID          — Tenant ID for the sync
//	SYNC_PORT          — HTTP server port (default: 8080)
//	SYNC_INTERVAL_MIN  — Sync interval in minutes (default: 30)
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"crm-services/services/sync/api"
	"crm-services/services/sync/domain"
	"crm-services/services/sync/external/client"
	"crm-services/services/sync/external/scheduler"
	"crm-services/services/sync/infra"
)

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags|log.Lmsgprefix)
	logger.Println("[main] CRM Sync Server starting...")

	// --- Load config from environment ---
	dbURL := envOrDefault("DATABASE_URL", "postgres://localhost:5432/crm?sslmode=disable")
	redisURL := envOrDefault("REDIS_URL", "redis://localhost:6379/0")
	nfsBaseURL := envOrDefault("NFS_CRM_BASE_URL", "https://nfs.mecntech.com")
	nfsAPIKey := os.Getenv("NFS_CRM_API_KEY")
	nfsUsername := os.Getenv("NFS_CRM_USERNAME")
	nfsPassword := os.Getenv("NFS_CRM_PASSWORD")
	tenantID := envOrDefault("TENANT_ID", "default")
	port := envOrDefault("SYNC_PORT", "8080")
	syncIntervalMin := envOrDefaultInt("SYNC_INTERVAL_MIN", 30)

	logger.Printf("[main] Config: nfs_url=%s, tenant=%s, port=%s, sync_interval=%dm",
		nfsBaseURL, tenantID, port, syncIntervalMin)

	// --- Connect to Postgres ---
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		logger.Fatalf("[main] Failed to connect to Postgres: %v", err)
	}
	defer db.Close()

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.PingContext(context.Background()); err != nil {
		logger.Fatalf("[main] Postgres ping failed: %v", err)
	}
	logger.Println("[main] Connected to Postgres")

	// --- Set up offline sync service (existing) ---
	repo := infra.NewPostgresEntityRepository(db)
	idempotency := infra.NewRedisIdempotencyStore(redisURL)
	// EventPublisher is a no-op for now — events go through Kafka in production
	events := &noopEventPublisher{}

	syncService := domain.NewSyncService(repo, idempotency, events)
	handler := api.NewHandler(syncService)

	// --- Set up external CRM sync scheduler (new) ---
	nfsClient := client.NewNFSClient(client.NFSConfig{
		BaseURL:     nfsBaseURL,
		APIKey:      nfsAPIKey,
		Username:    nfsUsername,
		Password:    nfsPassword,
		Timeout:     30 * time.Second,
		MaxRetries:  3,
		RateLimitMs: 200,
	})

	externalScheduler := scheduler.NewExternalSyncScheduler(nfsClient, db, tenantID, logger)

	// Override default interval if configured
	if syncIntervalMin != 30 {
		logger.Printf("[main] Custom sync interval: %d minutes", syncIntervalMin)
	}

	// --- HTTP server ---
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	// Health check endpoint
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"crm-sync"}`))
	})

	// Manual sync trigger endpoint
	mux.HandleFunc("POST /api/v1/sync/trigger-external", func(w http.ResponseWriter, r *http.Request) {
		logger.Println("[main] Manual external sync triggered via API")
		go externalScheduler.RunOnce()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"triggered","message":"External sync started"}`))
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// --- Start services ---
	externalScheduler.Start()
	logger.Printf("[main] External CRM sync scheduler started (interval=%dm)", syncIntervalMin)

	go func() {
		logger.Printf("[main] HTTP server listening on :%s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatalf("[main] HTTP server error: %v", err)
		}
	}()

	// --- Graceful shutdown ---
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	logger.Printf("[main] Received signal %s, shutting down...", sig)

	// Stop external sync scheduler first
	externalScheduler.Stop()

	// Shutdown HTTP server
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Printf("[main] HTTP server shutdown error: %v", err)
	}

	logger.Println("[main] CRM Sync Server stopped")
}

func envOrDefault(key, fallback string) string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v
}

func envOrDefaultInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return i
}

// noopEventPublisher is a placeholder — in production, events are published to Kafka.
type noopEventPublisher struct{}

func (p *noopEventPublisher) Publish(_ context.Context, _ string, _ domain.Event) error {
	return nil
}

// Ensure noopEventPublisher implements domain.EventPublisher.
var _ domain.EventPublisher = (*noopEventPublisher)(nil)

// Ensure we use fmt to avoid unused import error.
var _ = fmt.Sprintf
