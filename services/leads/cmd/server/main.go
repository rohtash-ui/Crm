package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"

	"github.com/rohtash-ui/crm/services/leads/api"
	"github.com/rohtash-ui/crm/services/leads/domain"
	"github.com/rohtash-ui/crm/services/leads/infra/events"
	"github.com/rohtash-ui/crm/services/leads/infra/repository"

	_ "github.com/lib/pq"
)

func main() {
	// Database connection
	dbURL := envOrDefault("DATABASE_URL", "postgres://localhost:5432/crm_leads?sslmode=disable")
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	// Repositories
	leadRepo := repository.NewLeadRepo(db)
	ruleRepo := repository.NewAssignmentRuleRepo(db)
	teamRepo := repository.NewTeamRepo(db)
	rrStateRepo := repository.NewRoundRobinStateRepo(db)
	logRepo := repository.NewAssignmentLogRepo(db)

	// Event publisher
	kafkaBrokers := envOrDefault("KAFKA_BROKERS", "localhost:9092")
	publisher := events.NewKafkaPublisher(
		[]string{kafkaBrokers},
		"crm.lead",
	)

	// Domain service
	svc := domain.NewAssignmentService(leadRepo, ruleRepo, teamRepo, rrStateRepo, logRepo, publisher)

	// HTTP server
	handler := api.NewHandler(svc)
	mux := http.NewServeMux()
	api.RegisterRoutes(mux, handler)

	port := envOrDefault("PORT", "8080")
	log.Printf("Lead Assignment Service starting on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func envOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}
