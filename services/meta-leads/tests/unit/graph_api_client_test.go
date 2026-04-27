package unit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
	"github.com/rohtash-ui/crm/services/meta-leads/infra/clients"
)

func TestGetLead_Success(t *testing.T) {
	lead := domain.GraphLead{
		ID:          "999888777",
		CreatedTime: "2024-01-15T10:30:00+0000",
		AdID:        "ad_123",
		FormID:      "form_456",
		FieldData: []domain.GraphLeadField{
			{Name: "email", Values: []string{"test@example.com"}},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(lead)
	}))
	defer server.Close()

	client := clients.NewGraphAPIClient(clients.GraphAPIClientConfig{
		BaseURL: server.URL,
	})

	result, err := client.GetLead(context.Background(), "999888777", "test_token")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if result.ID != "999888777" {
		t.Errorf("expected lead ID 999888777, got %s", result.ID)
	}
	if len(result.FieldData) != 1 {
		t.Errorf("expected 1 field, got %d", len(result.FieldData))
	}
}

func TestGetLead_OAuthError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": map[string]interface{}{
				"message": "Invalid OAuth access token",
				"type":    "OAuthException",
				"code":    190,
			},
		})
	}))
	defer server.Close()

	client := clients.NewGraphAPIClient(clients.GraphAPIClientConfig{
		BaseURL: server.URL,
	})

	_, err := client.GetLead(context.Background(), "123", "bad_token")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestListFormLeads_Pagination(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if callCount == 1 {
			resp := domain.GraphLeadsPage{
				Data: []domain.GraphLead{
					{ID: "lead1", FieldData: []domain.GraphLeadField{{Name: "email", Values: []string{"a@b.com"}}}},
				},
				Paging: &domain.GraphPaging{
					Next: r.URL.Scheme + "://" + r.Host + "/next-page",
				},
			}
			json.NewEncoder(w).Encode(resp)
		} else {
			resp := domain.GraphLeadsPage{
				Data: []domain.GraphLead{
					{ID: "lead2", FieldData: []domain.GraphLeadField{{Name: "email", Values: []string{"c@d.com"}}}},
				},
			}
			json.NewEncoder(w).Encode(resp)
		}
	}))
	defer server.Close()

	client := clients.NewGraphAPIClient(clients.GraphAPIClientConfig{
		BaseURL: server.URL,
	})

	leads, err := client.ListFormLeads(context.Background(), "form123", time.Now().Add(-1*time.Hour), "token")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if len(leads) != 2 {
		t.Errorf("expected 2 leads from pagination, got %d", len(leads))
	}
	if callCount != 2 {
		t.Errorf("expected 2 HTTP calls (pagination), got %d", callCount)
	}
}

func TestGetLead_CircuitBreaker(t *testing.T) {
	failCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		failCount++
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":{"message":"server error","type":"ServerError","code":1}}`))
	}))
	defer server.Close()

	client := clients.NewGraphAPIClient(clients.GraphAPIClientConfig{
		BaseURL: server.URL,
	})

	for i := 0; i < 6; i++ {
		client.GetLead(context.Background(), "123", "token")
	}

	_, err := client.GetLead(context.Background(), "123", "token")
	if err == nil {
		t.Fatal("expected circuit breaker error after multiple failures")
	}
}
