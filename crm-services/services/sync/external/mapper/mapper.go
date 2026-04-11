// Package mapper converts records from the legacy CRM (nfs.mecntech.com)
// into the internal CRM data format used by the sync service.
package mapper

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
)

// InternalRecord is a normalized record ready for upsert into the new CRM.
type InternalRecord struct {
	EntityType     string
	ExternalID     string
	ExternalSource string
	Data           map[string]interface{}
	DataHash       string // SHA-256 of the data for change detection
}

const ExternalSourceNFS = "nfs_mecntech"

// MapLead converts a legacy lead JSON into an internal record.
func MapLead(raw json.RawMessage) (*InternalRecord, error) {
	var src map[string]interface{}
	if err := json.Unmarshal(raw, &src); err != nil {
		return nil, fmt.Errorf("unmarshal lead: %w", err)
	}

	externalID := getString(src, "id")
	if externalID == "" {
		return nil, fmt.Errorf("lead missing id")
	}

	data := map[string]interface{}{
		"first_name":      getString(src, "first_name"),
		"last_name":       getString(src, "last_name"),
		"email":           getString(src, "email"),
		"phone":           getString(src, "phone"),
		"company":         getString(src, "company"),
		"source":          getString(src, "source"),
		"status":          getString(src, "status"),
		"score":           getNumber(src, "score"),
		"assigned_to":     getString(src, "assigned_to"),
		"region_id":       getString(src, "region_id"),
		"project_id":      getString(src, "project_id"),
		"location_id":     getString(src, "location_id"),
		"notes":           getString(src, "notes"),
		"external_id":     externalID,
		"external_source": ExternalSourceNFS,
		"custom_fields":   src["custom_fields"],
		"created_at":      getString(src, "created_at"),
		"updated_at":      getString(src, "updated_at"),
	}

	return &InternalRecord{
		EntityType:     "lead",
		ExternalID:     externalID,
		ExternalSource: ExternalSourceNFS,
		Data:           data,
		DataHash:       hashData(data),
	}, nil
}

// MapContact converts a legacy contact JSON into an internal record.
func MapContact(raw json.RawMessage) (*InternalRecord, error) {
	var src map[string]interface{}
	if err := json.Unmarshal(raw, &src); err != nil {
		return nil, fmt.Errorf("unmarshal contact: %w", err)
	}

	externalID := getString(src, "id")
	if externalID == "" {
		return nil, fmt.Errorf("contact missing id")
	}

	data := map[string]interface{}{
		"first_name":      getString(src, "first_name"),
		"last_name":       getString(src, "last_name"),
		"email":           getString(src, "email"),
		"phone":           getString(src, "phone"),
		"mobile":          getString(src, "mobile"),
		"company":         getString(src, "company"),
		"job_title":       getString(src, "job_title"),
		"address":         getString(src, "address"),
		"city":            getString(src, "city"),
		"state":           getString(src, "state"),
		"country":         getString(src, "country"),
		"tags":            src["tags"],
		"external_id":     externalID,
		"external_source": ExternalSourceNFS,
		"custom_fields":   src["custom_fields"],
		"created_at":      getString(src, "created_at"),
		"updated_at":      getString(src, "updated_at"),
	}

	return &InternalRecord{
		EntityType:     "contact",
		ExternalID:     externalID,
		ExternalSource: ExternalSourceNFS,
		Data:           data,
		DataHash:       hashData(data),
	}, nil
}

// MapDeal converts a legacy deal JSON into an internal record.
func MapDeal(raw json.RawMessage) (*InternalRecord, error) {
	var src map[string]interface{}
	if err := json.Unmarshal(raw, &src); err != nil {
		return nil, fmt.Errorf("unmarshal deal: %w", err)
	}

	externalID := getString(src, "id")
	if externalID == "" {
		return nil, fmt.Errorf("deal missing id")
	}

	data := map[string]interface{}{
		"title":           getString(src, "title"),
		"value":           getNumber(src, "value"),
		"currency":        getString(src, "currency"),
		"stage":           getString(src, "stage"),
		"probability":     getNumber(src, "probability"),
		"contact_id":      getString(src, "contact_id"),
		"account_id":      getString(src, "account_id"),
		"assigned_to":     getString(src, "assigned_to"),
		"expected_close":  getString(src, "expected_close"),
		"external_id":     externalID,
		"external_source": ExternalSourceNFS,
		"custom_fields":   src["custom_fields"],
		"created_at":      getString(src, "created_at"),
		"updated_at":      getString(src, "updated_at"),
	}

	return &InternalRecord{
		EntityType:     "deal",
		ExternalID:     externalID,
		ExternalSource: ExternalSourceNFS,
		Data:           data,
		DataHash:       hashData(data),
	}, nil
}

// MapAccount converts a legacy account JSON into an internal record.
func MapAccount(raw json.RawMessage) (*InternalRecord, error) {
	var src map[string]interface{}
	if err := json.Unmarshal(raw, &src); err != nil {
		return nil, fmt.Errorf("unmarshal account: %w", err)
	}

	externalID := getString(src, "id")
	if externalID == "" {
		return nil, fmt.Errorf("account missing id")
	}

	data := map[string]interface{}{
		"name":            getString(src, "name"),
		"industry":        getString(src, "industry"),
		"website":         getString(src, "website"),
		"phone":           getString(src, "phone"),
		"address":         getString(src, "address"),
		"city":            getString(src, "city"),
		"state":           getString(src, "state"),
		"country":         getString(src, "country"),
		"owner_id":        getString(src, "owner_id"),
		"external_id":     externalID,
		"external_source": ExternalSourceNFS,
		"custom_fields":   src["custom_fields"],
		"created_at":      getString(src, "created_at"),
		"updated_at":      getString(src, "updated_at"),
	}

	return &InternalRecord{
		EntityType:     "account",
		ExternalID:     externalID,
		ExternalSource: ExternalSourceNFS,
		Data:           data,
		DataHash:       hashData(data),
	}, nil
}

// MapActivity converts a legacy activity JSON into an internal record.
func MapActivity(raw json.RawMessage) (*InternalRecord, error) {
	var src map[string]interface{}
	if err := json.Unmarshal(raw, &src); err != nil {
		return nil, fmt.Errorf("unmarshal activity: %w", err)
	}

	externalID := getString(src, "id")
	if externalID == "" {
		return nil, fmt.Errorf("activity missing id")
	}

	data := map[string]interface{}{
		"type":            getString(src, "type"),
		"subject":         getString(src, "subject"),
		"description":     getString(src, "description"),
		"entity_type":     getString(src, "entity_type"),
		"entity_id":       getString(src, "entity_id"),
		"assigned_to":     getString(src, "assigned_to"),
		"due_date":        getString(src, "due_date"),
		"completed_at":    getString(src, "completed_at"),
		"status":          getString(src, "status"),
		"external_id":     externalID,
		"external_source": ExternalSourceNFS,
		"custom_fields":   src["custom_fields"],
		"created_at":      getString(src, "created_at"),
		"updated_at":      getString(src, "updated_at"),
	}

	return &InternalRecord{
		EntityType:     "activity",
		ExternalID:     externalID,
		ExternalSource: ExternalSourceNFS,
		Data:           data,
		DataHash:       hashData(data),
	}, nil
}

// MapNote converts a legacy note JSON into an internal record.
func MapNote(raw json.RawMessage) (*InternalRecord, error) {
	var src map[string]interface{}
	if err := json.Unmarshal(raw, &src); err != nil {
		return nil, fmt.Errorf("unmarshal note: %w", err)
	}

	externalID := getString(src, "id")
	if externalID == "" {
		return nil, fmt.Errorf("note missing id")
	}

	data := map[string]interface{}{
		"entity_type":     getString(src, "entity_type"),
		"entity_id":       getString(src, "entity_id"),
		"content":         getString(src, "content"),
		"note_type":       getString(src, "note_type"),
		"author_id":       getString(src, "author_id"),
		"author_name":     getString(src, "author_name"),
		"is_pinned":       getBool(src, "is_pinned"),
		"external_id":     externalID,
		"external_source": ExternalSourceNFS,
		"created_at":      getString(src, "created_at"),
		"updated_at":      getString(src, "updated_at"),
	}

	return &InternalRecord{
		EntityType:     "note",
		ExternalID:     externalID,
		ExternalSource: ExternalSourceNFS,
		Data:           data,
		DataHash:       hashData(data),
	}, nil
}

// --- helpers ---

func getString(m map[string]interface{}, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return fmt.Sprintf("%v", v)
	}
	return s
}

func getNumber(m map[string]interface{}, key string) float64 {
	v, ok := m[key]
	if !ok || v == nil {
		return 0
	}
	f, ok := v.(float64)
	if !ok {
		return 0
	}
	return f
}

func getBool(m map[string]interface{}, key string) bool {
	v, ok := m[key]
	if !ok || v == nil {
		return false
	}
	b, ok := v.(bool)
	if !ok {
		return false
	}
	return b
}

func hashData(data map[string]interface{}) string {
	b, _ := json.Marshal(data)
	h := sha256.Sum256(b)
	return fmt.Sprintf("%x", h)
}
