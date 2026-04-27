package clients

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type GraphAPIClientConfig struct {
	APIVersion string
	BaseURL    string
	Timeout    time.Duration
}

type graphAPIClient struct {
	httpClient *http.Client
	baseURL    string
	apiVersion string

	mu              sync.Mutex
	circuitOpen     bool
	failureCount    int
	lastFailureTime time.Time
	failureThreshold int
	recoveryTimeout  time.Duration
}

func NewGraphAPIClient(cfg GraphAPIClientConfig) domain.GraphAPIClient {
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://graph.facebook.com"
	}
	if cfg.APIVersion == "" {
		cfg.APIVersion = "v18.0"
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 10 * time.Second
	}

	return &graphAPIClient{
		httpClient: &http.Client{Timeout: cfg.Timeout},
		baseURL:    cfg.BaseURL,
		apiVersion: cfg.APIVersion,
		failureThreshold: 5,
		recoveryTimeout:  60 * time.Second,
	}
}

func (c *graphAPIClient) GetLead(ctx context.Context, leadgenID string, pageAccessToken string) (*domain.GraphLead, error) {
	if err := c.checkCircuit(); err != nil {
		return nil, err
	}

	u := fmt.Sprintf("%s/%s/%s", c.baseURL, c.apiVersion, leadgenID)
	params := url.Values{
		"access_token": {pageAccessToken},
		"fields":       {"id,created_time,ad_id,form_id,field_data"},
	}

	resp, err := c.doGet(ctx, u+"?"+params.Encode())
	if err != nil {
		c.recordFailure()
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		c.recordFailure()
		return nil, parseGraphError(body, resp.StatusCode)
	}

	c.recordSuccess()

	var lead domain.GraphLead
	if err := json.Unmarshal(body, &lead); err != nil {
		return nil, fmt.Errorf("unmarshal lead: %w", err)
	}

	return &lead, nil
}

func (c *graphAPIClient) ListFormLeads(ctx context.Context, formID string, since time.Time, pageAccessToken string) ([]domain.GraphLead, error) {
	if err := c.checkCircuit(); err != nil {
		return nil, err
	}

	var allLeads []domain.GraphLead
	u := fmt.Sprintf("%s/%s/%s/leads", c.baseURL, c.apiVersion, formID)
	params := url.Values{
		"access_token": {pageAccessToken},
		"fields":       {"id,created_time,ad_id,form_id,field_data"},
		"filtering":    {fmt.Sprintf(`[{"field":"time_created","operator":"GREATER_THAN","value":%d}]`, since.Unix())},
		"limit":        {strconv.Itoa(100)},
	}

	nextURL := u + "?" + params.Encode()

	for nextURL != "" {
		resp, err := c.doGet(ctx, nextURL)
		if err != nil {
			c.recordFailure()
			return allLeads, err
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			c.recordFailure()
			return allLeads, parseGraphError(body, resp.StatusCode)
		}

		c.recordSuccess()

		var page domain.GraphLeadsPage
		if err := json.Unmarshal(body, &page); err != nil {
			return allLeads, fmt.Errorf("unmarshal leads page: %w", err)
		}

		allLeads = append(allLeads, page.Data...)

		nextURL = ""
		if page.Paging != nil && page.Paging.Next != "" {
			nextURL = page.Paging.Next
		}
	}

	return allLeads, nil
}

func (c *graphAPIClient) doGet(ctx context.Context, rawURL string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	return c.httpClient.Do(req)
}

func (c *graphAPIClient) checkCircuit() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.circuitOpen {
		return nil
	}

	if time.Since(c.lastFailureTime) > c.recoveryTimeout {
		c.circuitOpen = false
		c.failureCount = 0
		return nil
	}

	return fmt.Errorf("circuit breaker open for Meta Graph API: %w", domain.ErrRateLimited)
}

func (c *graphAPIClient) recordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failureCount++
	c.lastFailureTime = time.Now()
	if c.failureCount >= c.failureThreshold {
		c.circuitOpen = true
	}
}

func (c *graphAPIClient) recordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failureCount = 0
	c.circuitOpen = false
}

type graphErrorResponse struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    int    `json:"code"`
	} `json:"error"`
}

type graphAPIErrorWrapper struct {
	err *domain.GraphAPIError
}

func (e *graphAPIErrorWrapper) Error() string {
	return e.err.Error()
}

func (e *graphAPIErrorWrapper) GraphError() *domain.GraphAPIError {
	return e.err
}

func parseGraphError(body []byte, statusCode int) error {
	var errResp graphErrorResponse
	if err := json.Unmarshal(body, &errResp); err == nil && errResp.Error.Code != 0 {
		return &graphAPIErrorWrapper{
			err: &domain.GraphAPIError{
				Code:    errResp.Error.Code,
				Message: errResp.Error.Message,
				Type:    errResp.Error.Type,
			},
		}
	}
	return fmt.Errorf("graph API HTTP %d: %s", statusCode, string(body))
}
