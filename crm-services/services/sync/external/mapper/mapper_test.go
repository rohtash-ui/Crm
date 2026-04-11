package mapper

import (
	"encoding/json"
	"testing"
)

func TestMapLead(t *testing.T) {
	raw := json.RawMessage(`{
		"id": "ext-lead-1",
		"first_name": "John",
		"last_name": "Doe",
		"email": "john@example.com",
		"phone": "+91-9876543210",
		"company": "Acme Corp",
		"source": "website",
		"status": "new",
		"score": 85,
		"notes": "Interested in premium plan",
		"created_at": "2025-01-15T10:00:00Z",
		"updated_at": "2025-04-10T14:30:00Z"
	}`)

	record, err := MapLead(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if record.EntityType != "lead" {
		t.Errorf("expected entity type 'lead', got %q", record.EntityType)
	}
	if record.ExternalID != "ext-lead-1" {
		t.Errorf("expected external ID 'ext-lead-1', got %q", record.ExternalID)
	}
	if record.ExternalSource != ExternalSourceNFS {
		t.Errorf("expected external source %q, got %q", ExternalSourceNFS, record.ExternalSource)
	}
	if record.Data["first_name"] != "John" {
		t.Errorf("expected first_name 'John', got %v", record.Data["first_name"])
	}
	if record.Data["notes"] != "Interested in premium plan" {
		t.Errorf("expected notes content, got %v", record.Data["notes"])
	}
	if record.DataHash == "" {
		t.Error("expected non-empty data hash")
	}
}

func TestMapNote(t *testing.T) {
	raw := json.RawMessage(`{
		"id": "ext-note-1",
		"entity_type": "lead",
		"entity_id": "ext-lead-1",
		"content": "Follow up call scheduled for next week",
		"note_type": "follow_up",
		"author_id": "user-42",
		"author_name": "Jane Smith",
		"is_pinned": true,
		"created_at": "2025-03-01T09:00:00Z",
		"updated_at": "2025-04-10T16:00:00Z"
	}`)

	record, err := MapNote(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if record.EntityType != "note" {
		t.Errorf("expected entity type 'note', got %q", record.EntityType)
	}
	if record.ExternalID != "ext-note-1" {
		t.Errorf("expected external ID 'ext-note-1', got %q", record.ExternalID)
	}
	if record.Data["content"] != "Follow up call scheduled for next week" {
		t.Errorf("expected note content, got %v", record.Data["content"])
	}
	if record.Data["note_type"] != "follow_up" {
		t.Errorf("expected note_type 'follow_up', got %v", record.Data["note_type"])
	}
	if record.Data["is_pinned"] != true {
		t.Errorf("expected is_pinned true, got %v", record.Data["is_pinned"])
	}
}

func TestMapContact(t *testing.T) {
	raw := json.RawMessage(`{
		"id": "ext-contact-1",
		"first_name": "Alice",
		"last_name": "Johnson",
		"email": "alice@corp.com",
		"phone": "+1-555-0100",
		"company": "MegaCorp",
		"city": "New York",
		"country": "US",
		"created_at": "2025-02-01T08:00:00Z",
		"updated_at": "2025-04-09T12:00:00Z"
	}`)

	record, err := MapContact(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if record.EntityType != "contact" {
		t.Errorf("expected entity type 'contact', got %q", record.EntityType)
	}
	if record.Data["city"] != "New York" {
		t.Errorf("expected city 'New York', got %v", record.Data["city"])
	}
}

func TestMapDeal(t *testing.T) {
	raw := json.RawMessage(`{
		"id": "ext-deal-1",
		"title": "Enterprise License",
		"value": 50000,
		"currency": "INR",
		"stage": "proposal",
		"probability": 60,
		"created_at": "2025-03-15T10:00:00Z",
		"updated_at": "2025-04-10T09:00:00Z"
	}`)

	record, err := MapDeal(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if record.EntityType != "deal" {
		t.Errorf("expected entity type 'deal', got %q", record.EntityType)
	}
	if record.Data["title"] != "Enterprise License" {
		t.Errorf("expected title 'Enterprise License', got %v", record.Data["title"])
	}
	if record.Data["value"] != float64(50000) {
		t.Errorf("expected value 50000, got %v", record.Data["value"])
	}
}

func TestMapLead_MissingID(t *testing.T) {
	raw := json.RawMessage(`{"first_name": "No ID Lead"}`)

	_, err := MapLead(raw)
	if err == nil {
		t.Error("expected error for missing ID")
	}
}

func TestHashConsistency(t *testing.T) {
	raw := json.RawMessage(`{
		"id": "ext-note-1",
		"content": "Test note",
		"entity_type": "lead",
		"entity_id": "lead-1"
	}`)

	record1, _ := MapNote(raw)
	record2, _ := MapNote(raw)

	if record1.DataHash != record2.DataHash {
		t.Error("expected consistent hash for same data")
	}
}
