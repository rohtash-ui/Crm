package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/rohtash-ui/crm/services/meta-leads/api"
	"github.com/rohtash-ui/crm/services/meta-leads/domain"
	"github.com/rohtash-ui/crm/services/meta-leads/infra/clients"
	"github.com/rohtash-ui/crm/services/meta-leads/infra/crypto"
	"github.com/rohtash-ui/crm/services/meta-leads/infra/events"
	"github.com/rohtash-ui/crm/services/meta-leads/infra/repository"
	"github.com/rohtash-ui/crm/services/meta-leads/infra/scheduler"

	_ "github.com/lib/pq"
)

func main() {
	dbURL := envOrDefault("DATABASE_URL", "postgres://localhost:5432/crm_meta_leads?sslmode=disable")
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	connRepo := repository.NewConnectionRepo(db)
	formRepo := repository.NewFormRepo(db)
	rawLeadRepo := repository.NewRawLeadRepo(db)
	outboxRepo := repository.NewOutboxRepo(db)
	deliveryRepo := repository.NewDeliveryRepo(db)

	kafkaBrokers := envOrDefault("KAFKA_BROKERS", "localhost:9092")
	publisher := events.NewKafkaPublisher([]string{kafkaBrokers}, domain.EventLeadCreated)

	kmsKeyID := envOrDefault("KMS_KEY_ID", "default-dev-key")
	appSecret := envOrDefault("META_APP_SECRET", "")
	encryptor := crypto.NewAESTokenEncryptor(appSecret)

	graphClient := clients.NewGraphAPIClient(clients.GraphAPIClientConfig{
		APIVersion: envOrDefault("META_GRAPH_API_VERSION", "v18.0"),
		Timeout:    10 * time.Second,
	})

	ingestSvc := domain.NewIngestService(db, rawLeadRepo, outboxRepo, connRepo, formRepo, graphClient, encryptor)

	safetyOverlap := parseDuration("POLL_SAFETY_OVERLAP_SECONDS", 600)
	pollerSvc := domain.NewPollerService(formRepo, graphClient, ingestSvc, encryptor, safetyOverlap)
	tokenSvc := domain.NewTokenService(connRepo, encryptor, kmsKeyID)

	verifyToken := envOrDefault("META_WEBHOOK_VERIFY_TOKEN", "")
	webhookHandler := api.NewWebhookHandler(ingestSvc, deliveryRepo, formRepo, appSecret, verifyToken)
	adminHandler := api.NewAdminHandler(tokenSvc, formRepo, connRepo, pollerSvc)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, webhookHandler, adminHandler)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	outboxRelay := events.NewOutboxRelay(outboxRepo, publisher, 1*time.Second, 100)
	go outboxRelay.Run(ctx)

	pollInterval := parseDuration("POLL_INTERVAL_SECONDS", 300)
	pollScheduler := scheduler.NewPollScheduler(pollerSvc, pollInterval)
	go pollScheduler.Run(ctx)

	port := envOrDefault("HTTP_PORT", "8080")
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		cancel()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()
		server.Shutdown(shutdownCtx)
	}()

	log.Printf("Meta Leads Service starting on :%s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}
}

func envOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func parseDuration(envKey string, defaultSeconds int) time.Duration {
	val := envOrDefault(envKey, strconv.Itoa(defaultSeconds))
	secs, err := strconv.Atoi(val)
	if err != nil {
		return time.Duration(defaultSeconds) * time.Second
	}
	return time.Duration(secs) * time.Second
}
