package api

type WebhookEntry struct {
	ID      string          `json:"id"`
	Time    int64           `json:"time"`
	Changes []WebhookChange `json:"changes"`
}

type WebhookChange struct {
	Field string              `json:"field"`
	Value WebhookChangeValue  `json:"value"`
}

type WebhookChangeValue struct {
	FormID       string `json:"form_id"`
	LeadgenID    string `json:"leadgen_id"`
	PageID       string `json:"page_id"`
	CreatedTime  int64  `json:"created_time"`
	AdGroupID    string `json:"adgroup_id,omitempty"`
}

type WebhookPayload struct {
	Object string         `json:"object"`
	Entry  []WebhookEntry `json:"entry"`
}

type CreateConnectionRequest struct {
	TenantID        string `json:"tenant_id"`
	PageID          string `json:"page_id"`
	AppID           string `json:"app_id"`
	PageAccessToken string `json:"page_access_token"`
}

type CreateFormRequest struct {
	TenantID     string `json:"tenant_id"`
	FormID       string `json:"form_id"`
	ConnectionID string `json:"connection_id"`
	FormName     string `json:"form_name"`
}

type TriggerSyncRequest struct {
	TenantID string `json:"tenant_id"`
	FormID   string `json:"form_id"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type SuccessResponse struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}
