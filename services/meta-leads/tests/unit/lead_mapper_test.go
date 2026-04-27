package unit

import (
	"testing"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

func TestMapGraphLeadToEvent_FullFields(t *testing.T) {
	lead := &domain.GraphLead{
		ID:          "999888777",
		CreatedTime: "2024-01-15T10:30:00+0000",
		AdID:        "ad_12345",
		FormID:      "555666777",
		FieldData: []domain.GraphLeadField{
			{Name: "first_name", Values: []string{"John"}},
			{Name: "last_name", Values: []string{"Doe"}},
			{Name: "email", Values: []string{"john@example.com"}},
			{Name: "phone_number", Values: []string{"+919876543210"}},
			{Name: "company_name", Values: []string{"Acme Corp"}},
			{Name: "budget", Values: []string{"50L"}},
		},
	}

	event := domain.MapGraphLeadToEvent("tenant-1", "page-111", lead)

	assertEqual(t, "FirstName", event.FirstName, "John")
	assertEqual(t, "LastName", event.LastName, "Doe")
	assertEqual(t, "Email", event.Email, "john@example.com")
	assertEqual(t, "Phone", event.Phone, "+919876543210")
	assertEqual(t, "Company", event.Company, "Acme Corp")
	assertEqual(t, "Source", event.Source, "social_media")
	assertEqual(t, "ExternalSource", event.ExternalSource, "meta")
	assertEqual(t, "ExternalID", event.ExternalID, "meta:page-111:999888777")
	assertEqual(t, "Type", event.Type, domain.EventLeadCreated)

	if val, ok := event.CustomFields["budget"]; !ok || val != "50L" {
		t.Errorf("expected custom field budget=50L, got %v", event.CustomFields)
	}
}

func TestMapGraphLeadToEvent_FullName(t *testing.T) {
	lead := &domain.GraphLead{
		ID:     "123",
		FormID: "form1",
		FieldData: []domain.GraphLeadField{
			{Name: "full_name", Values: []string{"Jane Smith"}},
			{Name: "email", Values: []string{"jane@example.com"}},
		},
	}

	event := domain.MapGraphLeadToEvent("tenant-1", "page-111", lead)

	assertEqual(t, "FirstName from full_name", event.FirstName, "Jane")
	assertEqual(t, "LastName from full_name", event.LastName, "Smith")
	assertEqual(t, "Email", event.Email, "jane@example.com")
}

func TestMapGraphLeadToEvent_SingleName(t *testing.T) {
	lead := &domain.GraphLead{
		ID:     "456",
		FormID: "form1",
		FieldData: []domain.GraphLeadField{
			{Name: "full_name", Values: []string{"Madonna"}},
		},
	}

	event := domain.MapGraphLeadToEvent("tenant-1", "page-111", lead)

	assertEqual(t, "FirstName single name", event.FirstName, "Madonna")
	assertEqual(t, "LastName single name", event.LastName, "")
}

func TestMapGraphLeadToEvent_EmptyFields(t *testing.T) {
	lead := &domain.GraphLead{
		ID:     "789",
		FormID: "form1",
		FieldData: []domain.GraphLeadField{
			{Name: "email", Values: []string{}},
			{Name: "phone", Values: []string{""}},
		},
	}

	event := domain.MapGraphLeadToEvent("tenant-1", "page-111", lead)

	assertEqual(t, "Email should be empty", event.Email, "")
	assertEqual(t, "Phone should be empty", event.Phone, "")
}

func TestMapGraphLeadToEvent_MixedCaseFieldNames(t *testing.T) {
	lead := &domain.GraphLead{
		ID:     "101",
		FormID: "form1",
		FieldData: []domain.GraphLeadField{
			{Name: "  Email  ", Values: []string{"upper@example.com"}},
			{Name: "PHONE", Values: []string{"+1234567890"}},
		},
	}

	event := domain.MapGraphLeadToEvent("tenant-1", "page-111", lead)

	assertEqual(t, "Email mixed case", event.Email, "upper@example.com")
	assertEqual(t, "Phone mixed case", event.Phone, "+1234567890")
}

func TestMakeExternalID(t *testing.T) {
	id := domain.MakeExternalID("page123", "lead456")
	assertEqual(t, "ExternalID format", id, "meta:page123:lead456")
}

func assertEqual(t *testing.T, name, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %q, want %q", name, got, want)
	}
}
