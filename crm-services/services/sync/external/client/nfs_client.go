// Package client provides an HTTP client for fetching data from the legacy
// CRM at nfs.mecntech.com. It supports paginated listing, individual record
// fetching, and incremental sync via modified-since timestamps.
package client

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// NFSConfig holds connection settings for the legacy CRM.
type NFSConfig struct {
	BaseURL     string        // e.g. "https://nfs.mecntech.com"
	APIKey      string        // API key or token for authentication
	Username    string        // Basic auth username (if API key not used)
	Password    string        // Basic auth password
	Timeout     time.Duration // HTTP request timeout
	MaxRetries  int           // Retry count on transient failures
	RateLimitMs int           // Minimum ms between requests to avoid throttling
}

// NFSClient is the HTTP client for the legacy CRM API.
type NFSClient struct {
	config     NFSConfig
	httpClient *http.Client
	lastReqAt  time.Time
}

// NewNFSClient creates a new client for the legacy CRM.
func NewNFSClient(config NFSConfig) *NFSClient {
	if config.Timeout == 0 {
		config.Timeout = 30 * time.Second
	}
	if config.MaxRetries == 0 {
		config.MaxRetries = 3
	}
	if config.RateLimitMs == 0 {
		config.RateLimitMs = 200
	}

	return &NFSClient{
		config: config,
		httpClient: &http.Client{
			Timeout: config.Timeout,
		},
	}
}

// --- Response types from the legacy CRM API ---

// NFSListResponse is the paginated list response from the legacy API.
type NFSListResponse struct {
	Data       []json.RawMessage `json:"data"`
	Pagination NFSPagination     `json:"pagination"`
	Total      int               `json:"total"`
}

// NFSPagination holds pagination metadata.
type NFSPagination struct {
	Page       int    `json:"page"`
	PerPage    int    `json:"per_page"`
	TotalPages int    `json:"total_pages"`
	NextCursor string `json:"next_cursor,omitempty"`
	HasMore    bool   `json:"has_more"`
}

// NFSLead is a lead record from the legacy CRM.
type NFSLead struct {
	ID           string                 `json:"id"`
	FirstName    string                 `json:"first_name"`
	LastName     string                 `json:"last_name"`
	Email        string                 `json:"email"`
	Phone        string                 `json:"phone"`
	Company      string                 `json:"company"`
	Source       string                 `json:"source"`
	Status       string                 `json:"status"`
	Score        int                    `json:"score"`
	AssignedTo   string                 `json:"assigned_to"`
	RegionID     string                 `json:"region_id"`
	ProjectID    string                 `json:"project_id"`
	LocationID   string                 `json:"location_id"`
	Notes        string                 `json:"notes"`
	CustomFields map[string]interface{} `json:"custom_fields"`
	CreatedAt    string                 `json:"created_at"`
	UpdatedAt    string                 `json:"updated_at"`
}

// NFSContact is a contact record from the legacy CRM.
type NFSContact struct {
	ID          string                 `json:"id"`
	FirstName   string                 `json:"first_name"`
	LastName    string                 `json:"last_name"`
	Email       string                 `json:"email"`
	Phone       string                 `json:"phone"`
	Mobile      string                 `json:"mobile"`
	Company     string                 `json:"company"`
	JobTitle    string                 `json:"job_title"`
	Address     string                 `json:"address"`
	City        string                 `json:"city"`
	State       string                 `json:"state"`
	Country     string                 `json:"country"`
	Tags        []string               `json:"tags"`
	CustomFields map[string]interface{} `json:"custom_fields"`
	CreatedAt   string                 `json:"created_at"`
	UpdatedAt   string                 `json:"updated_at"`
}

// NFSDeal is a deal/opportunity record from the legacy CRM.
type NFSDeal struct {
	ID          string                 `json:"id"`
	Title       string                 `json:"title"`
	Value       float64                `json:"value"`
	Currency    string                 `json:"currency"`
	Stage       string                 `json:"stage"`
	Probability int                    `json:"probability"`
	ContactID   string                 `json:"contact_id"`
	AccountID   string                 `json:"account_id"`
	AssignedTo  string                 `json:"assigned_to"`
	ExpectedClose string               `json:"expected_close"`
	CustomFields map[string]interface{} `json:"custom_fields"`
	CreatedAt   string                 `json:"created_at"`
	UpdatedAt   string                 `json:"updated_at"`
}

// NFSAccount is an account/company record from the legacy CRM.
type NFSAccount struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Industry    string                 `json:"industry"`
	Website     string                 `json:"website"`
	Phone       string                 `json:"phone"`
	Address     string                 `json:"address"`
	City        string                 `json:"city"`
	State       string                 `json:"state"`
	Country     string                 `json:"country"`
	OwnerID     string                 `json:"owner_id"`
	CustomFields map[string]interface{} `json:"custom_fields"`
	CreatedAt   string                 `json:"created_at"`
	UpdatedAt   string                 `json:"updated_at"`
}

// NFSActivity is an activity record from the legacy CRM.
type NFSActivity struct {
	ID           string                 `json:"id"`
	Type         string                 `json:"type"` // call, email, meeting, task
	Subject      string                 `json:"subject"`
	Description  string                 `json:"description"`
	EntityType   string                 `json:"entity_type"` // lead, contact, deal
	EntityID     string                 `json:"entity_id"`
	AssignedTo   string                 `json:"assigned_to"`
	DueDate      string                 `json:"due_date"`
	CompletedAt  string                 `json:"completed_at"`
	Status       string                 `json:"status"`
	CustomFields map[string]interface{} `json:"custom_fields"`
	CreatedAt    string                 `json:"created_at"`
	UpdatedAt    string                 `json:"updated_at"`
}

// NFSNote is a note record from the legacy CRM.
type NFSNote struct {
	ID          string `json:"id"`
	EntityType  string `json:"entity_type"` // lead, contact, deal, account
	EntityID    string `json:"entity_id"`
	Content     string `json:"content"`
	NoteType    string `json:"note_type"` // general, call, meeting, email, follow_up
	AuthorID    string `json:"author_id"`
	AuthorName  string `json:"author_name"`
	IsPinned    bool   `json:"is_pinned"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// --- Fetch methods ---

// FetchLeads returns leads from the legacy CRM, optionally filtered by modifiedSince.
func (c *NFSClient) FetchLeads(ctx context.Context, modifiedSince *time.Time, page int) (*NFSListResponse, error) {
	params := url.Values{}
	params.Set("page", fmt.Sprintf("%d", page))
	params.Set("per_page", "100")
	if modifiedSince != nil {
		params.Set("modified_since", modifiedSince.Format(time.RFC3339))
	}
	return c.fetchList(ctx, "/api/v1/leads", params)
}

// FetchContacts returns contacts from the legacy CRM.
func (c *NFSClient) FetchContacts(ctx context.Context, modifiedSince *time.Time, page int) (*NFSListResponse, error) {
	params := url.Values{}
	params.Set("page", fmt.Sprintf("%d", page))
	params.Set("per_page", "100")
	if modifiedSince != nil {
		params.Set("modified_since", modifiedSince.Format(time.RFC3339))
	}
	return c.fetchList(ctx, "/api/v1/contacts", params)
}

// FetchDeals returns deals from the legacy CRM.
func (c *NFSClient) FetchDeals(ctx context.Context, modifiedSince *time.Time, page int) (*NFSListResponse, error) {
	params := url.Values{}
	params.Set("page", fmt.Sprintf("%d", page))
	params.Set("per_page", "100")
	if modifiedSince != nil {
		params.Set("modified_since", modifiedSince.Format(time.RFC3339))
	}
	return c.fetchList(ctx, "/api/v1/deals", params)
}

// FetchAccounts returns accounts from the legacy CRM.
func (c *NFSClient) FetchAccounts(ctx context.Context, modifiedSince *time.Time, page int) (*NFSListResponse, error) {
	params := url.Values{}
	params.Set("page", fmt.Sprintf("%d", page))
	params.Set("per_page", "100")
	if modifiedSince != nil {
		params.Set("modified_since", modifiedSince.Format(time.RFC3339))
	}
	return c.fetchList(ctx, "/api/v1/accounts", params)
}

// FetchActivities returns activities from the legacy CRM.
func (c *NFSClient) FetchActivities(ctx context.Context, modifiedSince *time.Time, page int) (*NFSListResponse, error) {
	params := url.Values{}
	params.Set("page", fmt.Sprintf("%d", page))
	params.Set("per_page", "100")
	if modifiedSince != nil {
		params.Set("modified_since", modifiedSince.Format(time.RFC3339))
	}
	return c.fetchList(ctx, "/api/v1/activities", params)
}

// FetchNotes returns notes from the legacy CRM.
func (c *NFSClient) FetchNotes(ctx context.Context, modifiedSince *time.Time, page int) (*NFSListResponse, error) {
	params := url.Values{}
	params.Set("page", fmt.Sprintf("%d", page))
	params.Set("per_page", "100")
	if modifiedSince != nil {
		params.Set("modified_since", modifiedSince.Format(time.RFC3339))
	}
	return c.fetchList(ctx, "/api/v1/notes", params)
}

// FetchNotesByEntity returns notes attached to a specific entity.
func (c *NFSClient) FetchNotesByEntity(ctx context.Context, entityType, entityID string, page int) (*NFSListResponse, error) {
	params := url.Values{}
	params.Set("page", fmt.Sprintf("%d", page))
	params.Set("per_page", "100")
	params.Set("entity_type", entityType)
	params.Set("entity_id", entityID)
	return c.fetchList(ctx, "/api/v1/notes", params)
}

// HealthCheck verifies connectivity to the legacy CRM.
func (c *NFSClient) HealthCheck(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.config.BaseURL+"/api/v1/health", nil)
	if err != nil {
		return fmt.Errorf("create health check request: %w", err)
	}
	c.setAuthHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("health check request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check returned status %d", resp.StatusCode)
	}
	return nil
}

// --- Internal helpers ---

func (c *NFSClient) fetchList(ctx context.Context, path string, params url.Values) (*NFSListResponse, error) {
	c.rateLimit()

	fullURL := fmt.Sprintf("%s%s?%s", c.config.BaseURL, path, params.Encode())

	var lastErr error
	for attempt := 0; attempt <= c.config.MaxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<uint(attempt-1)) * time.Second
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}
		c.setAuthHeaders(req)
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			continue
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusTooManyRequests {
			lastErr = fmt.Errorf("rate limited (429)")
			continue
		}
		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("server error: %d", resp.StatusCode)
			continue
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
		}
		if err != nil {
			return nil, fmt.Errorf("read response body: %w", err)
		}

		var result NFSListResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}

		c.lastReqAt = time.Now()
		return &result, nil
	}

	return nil, fmt.Errorf("all retries exhausted: %w", lastErr)
}

func (c *NFSClient) setAuthHeaders(req *http.Request) {
	if c.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
		req.Header.Set("X-API-Key", c.config.APIKey)
	} else if c.config.Username != "" {
		req.SetBasicAuth(c.config.Username, c.config.Password)
	}
}

func (c *NFSClient) rateLimit() {
	if c.config.RateLimitMs > 0 {
		elapsed := time.Since(c.lastReqAt)
		minGap := time.Duration(c.config.RateLimitMs) * time.Millisecond
		if elapsed < minGap {
			time.Sleep(minGap - elapsed)
		}
	}
}
