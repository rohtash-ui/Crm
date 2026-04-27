package domain

import (
	"time"
)

type TokenStatus string

const (
	TokenStatusActive  TokenStatus = "active"
	TokenStatusExpired TokenStatus = "expired"
	TokenStatusRevoked TokenStatus = "revoked"
)

type SourcePath string

const (
	SourcePathWebhook SourcePath = "webhook"
	SourcePathPoll    SourcePath = "poll"
)

type MetaConnection struct {
	ID                       string      `json:"id"`
	TenantID                 string      `json:"tenant_id"`
	PageID                   string      `json:"page_id"`
	AppID                    string      `json:"app_id"`
	PageAccessTokenCiphertext []byte     `json:"-"`
	KMSKeyID                 string      `json:"-"`
	TokenStatus              TokenStatus `json:"token_status"`
	TokenExpiresAt           *time.Time  `json:"token_expires_at,omitempty"`
	LastRefreshedAt          *time.Time  `json:"last_refreshed_at,omitempty"`
	CreatedAt                time.Time   `json:"created_at"`
	UpdatedAt                time.Time   `json:"updated_at"`
}

type MetaForm struct {
	ID             string     `json:"id"`
	TenantID       string     `json:"tenant_id"`
	FormID         string     `json:"form_id"`
	ConnectionID   string     `json:"connection_id"`
	FormName       string     `json:"form_name,omitempty"`
	PollingEnabled bool       `json:"polling_enabled"`
	LastPolledAt   *time.Time `json:"last_polled_at,omitempty"`
	LastWebhookAt  *time.Time `json:"last_webhook_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type MetaRawLead struct {
	ID         string     `json:"id"`
	TenantID   string     `json:"tenant_id"`
	LeadgenID  string     `json:"leadgen_id"`
	FormID     string     `json:"form_id"`
	PageID     string     `json:"page_id"`
	RawJSON    []byte     `json:"raw_json"`
	SourcePath SourcePath `json:"source_path"`
	IngestedAt time.Time  `json:"ingested_at"`
}

type OutboxEntry struct {
	ID           int64      `json:"id"`
	TenantID     string     `json:"tenant_id"`
	AggregateID  string     `json:"aggregate_id"`
	EventType    string     `json:"event_type"`
	Payload      []byte     `json:"payload"`
	PartitionKey string     `json:"partition_key"`
	CreatedAt    time.Time  `json:"created_at"`
	PublishedAt  *time.Time `json:"published_at,omitempty"`
	Attempts     int        `json:"attempts"`
}

type GraphLead struct {
	ID          string           `json:"id"`
	CreatedTime string           `json:"created_time"`
	AdID        string           `json:"ad_id,omitempty"`
	FormID      string           `json:"form_id,omitempty"`
	FieldData   []GraphLeadField `json:"field_data"`
}

type GraphLeadField struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

type GraphLeadsPage struct {
	Data   []GraphLead    `json:"data"`
	Paging *GraphPaging   `json:"paging,omitempty"`
}

type GraphPaging struct {
	Cursors *GraphCursors `json:"cursors,omitempty"`
	Next    string        `json:"next,omitempty"`
}

type GraphCursors struct {
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
}

type PollableForm struct {
	Form       MetaForm
	Connection MetaConnection
}
