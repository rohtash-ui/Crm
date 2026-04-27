package domain

import "time"

const (
	EventLeadCreated        = "crm.lead.created.v1"
	EventConnectionRevoked  = "crm.meta_connection.revoked.v1"
)

type LeadCreatedEvent struct {
	Type           string            `json:"type"`
	TenantID       string            `json:"tenant_id"`
	LeadID         string            `json:"lead_id"`
	Source         string            `json:"source"`
	ExternalSource string            `json:"external_source"`
	ExternalID     string            `json:"external_id"`
	FirstName      string            `json:"first_name,omitempty"`
	LastName       string            `json:"last_name,omitempty"`
	Email          string            `json:"email,omitempty"`
	Phone          string            `json:"phone,omitempty"`
	Company        string            `json:"company,omitempty"`
	CustomFields   map[string]string `json:"custom_fields,omitempty"`
	Meta           LeadMetaInfo      `json:"meta"`
	IngestedAt     time.Time         `json:"ingested_at"`
}

type LeadMetaInfo struct {
	PageID      string `json:"page_id"`
	FormID      string `json:"form_id"`
	AdID        string `json:"ad_id,omitempty"`
	CreatedTime string `json:"created_time,omitempty"`
}

type ConnectionRevokedEvent struct {
	Type     string `json:"type"`
	TenantID string `json:"tenant_id"`
	PageID   string `json:"page_id"`
	Reason   string `json:"reason"`
}

func MakeExternalID(pageID, leadgenID string) string {
	return "meta:" + pageID + ":" + leadgenID
}
