package unit

import (
	"context"
	"testing"
	"time"

	"github.com/rohtash-ui/crm/services/leads/domain"
	"github.com/rohtash-ui/crm/services/leads/infra/events"
)

// --- In-memory mocks for testing ---

type mockLeadRepo struct {
	leads map[string]*domain.Lead
}

func newMockLeadRepo() *mockLeadRepo {
	return &mockLeadRepo{leads: make(map[string]*domain.Lead)}
}

func (m *mockLeadRepo) GetByID(_ context.Context, tenantID, leadID string) (*domain.Lead, error) {
	lead, ok := m.leads[leadID]
	if !ok || lead.TenantID != tenantID {
		return nil, domain.ErrLeadNotFound
	}
	return lead, nil
}

func (m *mockLeadRepo) ListUnassigned(_ context.Context, tenantID string, filter domain.UnassignedFilter) ([]*domain.Lead, error) {
	var result []*domain.Lead
	for _, lead := range m.leads {
		if lead.TenantID != tenantID || lead.AssignedTo != "" || lead.Status != domain.LeadStatusNew {
			continue
		}
		if filter.ProjectID != "" && lead.ProjectID != filter.ProjectID {
			continue
		}
		if filter.LocationID != "" && lead.LocationID != filter.LocationID {
			continue
		}
		if filter.RegionID != "" && lead.RegionID != filter.RegionID {
			continue
		}
		result = append(result, lead)
		if filter.Limit > 0 && len(result) >= filter.Limit {
			break
		}
	}
	return result, nil
}

func (m *mockLeadRepo) UpdateAssignment(_ context.Context, lead *domain.Lead) error {
	m.leads[lead.ID] = lead
	return nil
}

func (m *mockLeadRepo) Create(_ context.Context, lead *domain.Lead) error {
	m.leads[lead.ID] = lead
	return nil
}

type mockRuleRepo struct {
	rules []*domain.LeadAssignmentRule
}

func newMockRuleRepo() *mockRuleRepo {
	return &mockRuleRepo{}
}

func (m *mockRuleRepo) GetByID(_ context.Context, tenantID, ruleID string) (*domain.LeadAssignmentRule, error) {
	for _, r := range m.rules {
		if r.ID == ruleID && r.TenantID == tenantID {
			return r, nil
		}
	}
	return nil, domain.ErrRuleNotFound
}

func (m *mockRuleRepo) FindMatchingRule(_ context.Context, tenantID, projectID, locationID, regionID string) (*domain.LeadAssignmentRule, error) {
	for _, r := range m.rules {
		if r.TenantID != tenantID || !r.IsActive {
			continue
		}
		// Simple matching: project > location > region > global
		if r.ProjectID == projectID && projectID != "" {
			return r, nil
		}
		if r.LocationID == locationID && locationID != "" {
			return r, nil
		}
		if r.RegionID == regionID && regionID != "" {
			return r, nil
		}
		if r.Scope == domain.ScopeGlobal {
			return r, nil
		}
	}
	return nil, nil
}

func (m *mockRuleRepo) ListActive(_ context.Context, tenantID string) ([]*domain.LeadAssignmentRule, error) {
	var result []*domain.LeadAssignmentRule
	for _, r := range m.rules {
		if r.TenantID == tenantID && r.IsActive {
			result = append(result, r)
		}
	}
	return result, nil
}

func (m *mockRuleRepo) Create(_ context.Context, rule *domain.LeadAssignmentRule) error {
	m.rules = append(m.rules, rule)
	return nil
}

func (m *mockRuleRepo) Update(_ context.Context, rule *domain.LeadAssignmentRule) error {
	for i, r := range m.rules {
		if r.ID == rule.ID {
			m.rules[i] = rule
			return nil
		}
	}
	return domain.ErrRuleNotFound
}

type mockTeamRepo struct {
	members []*domain.TeamMember
}

func newMockTeamRepo() *mockTeamRepo {
	return &mockTeamRepo{}
}

func (m *mockTeamRepo) GetTeamByID(_ context.Context, tenantID, teamID string) (*domain.Team, error) {
	return &domain.Team{ID: teamID, TenantID: tenantID}, nil
}

func (m *mockTeamRepo) ListActiveMembers(_ context.Context, tenantID, teamID string) ([]*domain.TeamMember, error) {
	var result []*domain.TeamMember
	for _, member := range m.members {
		if member.TenantID == tenantID && member.TeamID == teamID && member.IsActive {
			result = append(result, member)
		}
	}
	return result, nil
}

func (m *mockTeamRepo) GetMemberByUserID(_ context.Context, tenantID, teamID, userID string) (*domain.TeamMember, error) {
	for _, member := range m.members {
		if member.TenantID == tenantID && member.TeamID == teamID && member.UserID == userID {
			return member, nil
		}
	}
	return nil, domain.ErrMemberNotFound
}

func (m *mockTeamRepo) IncrementLeadCount(_ context.Context, tenantID, memberID string) error {
	for _, member := range m.members {
		if member.TenantID == tenantID && member.ID == memberID {
			member.CurrentLeadCount++
			return nil
		}
	}
	return nil
}

func (m *mockTeamRepo) DecrementLeadCount(_ context.Context, tenantID, memberID string) error {
	for _, member := range m.members {
		if member.TenantID == tenantID && member.ID == memberID {
			if member.CurrentLeadCount > 0 {
				member.CurrentLeadCount--
			}
			return nil
		}
	}
	return nil
}

type mockRRStateRepo struct {
	states map[string]*domain.RoundRobinState
}

func newMockRRStateRepo() *mockRRStateRepo {
	return &mockRRStateRepo{states: make(map[string]*domain.RoundRobinState)}
}

func (m *mockRRStateRepo) GetOrCreate(_ context.Context, tenantID, ruleID string) (*domain.RoundRobinState, error) {
	key := tenantID + ":" + ruleID
	if state, ok := m.states[key]; ok {
		return state, nil
	}
	state := &domain.RoundRobinState{
		ID:       "rr-state-" + ruleID,
		TenantID: tenantID,
		RuleID:   ruleID,
	}
	m.states[key] = state
	return state, nil
}

func (m *mockRRStateRepo) UpdateLastAssigned(_ context.Context, state *domain.RoundRobinState) error {
	key := state.TenantID + ":" + state.RuleID
	m.states[key] = state
	return nil
}

type mockLogRepo struct {
	logs []*domain.LeadAssignmentLog
}

func newMockLogRepo() *mockLogRepo {
	return &mockLogRepo{}
}

func (m *mockLogRepo) Create(_ context.Context, logEntry *domain.LeadAssignmentLog) error {
	logEntry.ID = "log-" + logEntry.LeadID
	m.logs = append(m.logs, logEntry)
	return nil
}

func (m *mockLogRepo) ListByLead(_ context.Context, tenantID, leadID string) ([]*domain.LeadAssignmentLog, error) {
	var result []*domain.LeadAssignmentLog
	for _, l := range m.logs {
		if l.TenantID == tenantID && l.LeadID == leadID {
			result = append(result, l)
		}
	}
	return result, nil
}

// --- Test fixtures ---

const testTenantID = "tenant-001"
const testTeamID = "team-001"

func createTestService() (*domain.AssignmentService, *mockLeadRepo, *mockRuleRepo, *mockTeamRepo, *mockRRStateRepo, *mockLogRepo, *events.NoopPublisher) {
	leadRepo := newMockLeadRepo()
	ruleRepo := newMockRuleRepo()
	teamRepo := newMockTeamRepo()
	rrStateRepo := newMockRRStateRepo()
	logRepo := newMockLogRepo()
	publisher := events.NewNoopPublisher()

	svc := domain.NewAssignmentService(leadRepo, ruleRepo, teamRepo, rrStateRepo, logRepo, publisher)
	return svc, leadRepo, ruleRepo, teamRepo, rrStateRepo, logRepo, publisher
}

func seedMembers(teamRepo *mockTeamRepo, count int) []*domain.TeamMember {
	members := make([]*domain.TeamMember, count)
	for i := 0; i < count; i++ {
		m := &domain.TeamMember{
			ID:               memberID(i),
			TenantID:         testTenantID,
			TeamID:           testTeamID,
			UserID:           userID(i),
			UserEmail:        userEmail(i),
			UserName:         userName(i),
			Role:             domain.RoleSalesRep,
			IsActive:         true,
			MaxLeads:         50,
			CurrentLeadCount: 0,
		}
		members[i] = m
		teamRepo.members = append(teamRepo.members, m)
	}
	return members
}

func memberID(i int) string  { return "member-" + itoa(i) }
func userID(i int) string    { return "user-" + itoa(i) }
func userEmail(i int) string { return "user" + itoa(i) + "@example.com" }
func userName(i int) string  { return "User " + itoa(i) }

func itoa(i int) string {
	return string(rune('0'+i%10)) // simple for tests with <10 members
}

func seedLead(leadRepo *mockLeadRepo, id string, projectID string, locationID string) *domain.Lead {
	lead := &domain.Lead{
		ID:        id,
		TenantID:  testTenantID,
		FirstName: "Test",
		LastName:  "Lead",
		Email:     id + "@example.com",
		Source:    domain.LeadSourceWebsite,
		Status:    domain.LeadStatusNew,
		ProjectID: projectID,
		LocationID: locationID,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	leadRepo.leads[id] = lead
	return lead
}

func seedRule(ruleRepo *mockRuleRepo, id string, scope domain.AssignmentScope, projectID, locationID, regionID string) *domain.LeadAssignmentRule {
	rule := &domain.LeadAssignmentRule{
		ID:              id,
		TenantID:        testTenantID,
		Name:            "Rule " + id,
		Scope:           scope,
		ProjectID:       projectID,
		LocationID:      locationID,
		RegionID:        regionID,
		TeamID:          testTeamID,
		IsActive:        true,
		RespectCapacity: true,
		Priority:        0,
	}
	ruleRepo.rules = append(ruleRepo.rules, rule)
	return rule
}

// --- Tests ---

func TestRoundRobinAssign_Basic(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, logRepo, publisher := createTestService()
	ctx := context.Background()

	seedMembers(teamRepo, 3)
	seedLead(leadRepo, "lead-1", "project-1", "")
	seedRule(ruleRepo, "rule-1", domain.ScopeProject, "project-1", "", "")

	lead, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if lead.AssignedTo == "" {
		t.Fatal("lead should be assigned")
	}
	if lead.Status != domain.LeadStatusAssigned {
		t.Errorf("expected status %q, got %q", domain.LeadStatusAssigned, lead.Status)
	}
	if lead.AssignmentMethod != domain.AssignmentRoundRobin {
		t.Errorf("expected method %q, got %q", domain.AssignmentRoundRobin, lead.AssignmentMethod)
	}
	if len(logRepo.logs) != 1 {
		t.Errorf("expected 1 log entry, got %d", len(logRepo.logs))
	}
	if len(publisher.Published) != 1 {
		t.Errorf("expected 1 event, got %d", len(publisher.Published))
	}
	if publisher.Published[0].Type != domain.EventLeadAssigned {
		t.Errorf("expected event type %q, got %q", domain.EventLeadAssigned, publisher.Published[0].Type)
	}
}

func TestRoundRobinAssign_RotatesMembers(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 3)
	seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	// Assign 3 leads, should rotate through all members
	assignedUsers := make([]string, 3)
	for i := 0; i < 3; i++ {
		leadID := "lead-" + itoa(i)
		seedLead(leadRepo, leadID, "", "")

		lead, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
			TenantID: testTenantID,
			LeadID:   leadID,
		})
		if err != nil {
			t.Fatalf("assignment %d failed: %v", i, err)
		}
		assignedUsers[i] = lead.AssignedTo
	}

	// Each member should get exactly one lead
	seen := make(map[string]bool)
	for _, userID := range assignedUsers {
		if seen[userID] {
			t.Errorf("user %s was assigned more than once before rotation completed", userID)
		}
		seen[userID] = true
	}

	if len(seen) != len(members) {
		t.Errorf("expected %d unique assignees, got %d", len(members), len(seen))
	}
}

func TestRoundRobinAssign_SkipsAtCapacity(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 3)
	// Set first member to max capacity
	members[0].CurrentLeadCount = 50
	members[0].MaxLeads = 50

	seedLead(leadRepo, "lead-1", "", "")
	seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	lead, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should skip member[0] since at capacity
	if lead.AssignedTo == members[0].UserID {
		t.Error("should not assign to member at max capacity")
	}
}

func TestRoundRobinAssign_NoEligibleMembers(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 2)
	// Set all members at capacity
	for _, m := range members {
		m.CurrentLeadCount = 50
		m.MaxLeads = 50
	}

	seedLead(leadRepo, "lead-1", "", "")
	seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	_, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != domain.ErrNoEligibleMembers {
		t.Errorf("expected ErrNoEligibleMembers, got %v", err)
	}
}

func TestRoundRobinAssign_NoMatchingRule(t *testing.T) {
	svc, leadRepo, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	seedLead(leadRepo, "lead-1", "unknown-project", "")

	_, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != domain.ErrNoMatchingRule {
		t.Errorf("expected ErrNoMatchingRule, got %v", err)
	}
}

func TestManualAssign_Success(t *testing.T) {
	svc, leadRepo, _, _, _, logRepo, publisher := createTestService()
	ctx := context.Background()

	seedLead(leadRepo, "lead-1", "", "")

	lead, err := svc.AssignManually(ctx, domain.ManualAssignRequest{
		TenantID:     testTenantID,
		LeadID:       "lead-1",
		AssignToID:   "sales-rep-1",
		AssignByID:   "manager-1",
		AssignByRole: domain.RoleManager,
		Reason:       "Strategic account",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if lead.AssignedTo != "sales-rep-1" {
		t.Errorf("expected assigned_to 'sales-rep-1', got %q", lead.AssignedTo)
	}
	if lead.AssignedBy != "manager-1" {
		t.Errorf("expected assigned_by 'manager-1', got %q", lead.AssignedBy)
	}
	if lead.AssignmentMethod != domain.AssignmentManual {
		t.Errorf("expected method manual, got %q", lead.AssignmentMethod)
	}
	if len(logRepo.logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(logRepo.logs))
	}
	if logRepo.logs[0].Reason != "Strategic account" {
		t.Errorf("expected reason 'Strategic account', got %q", logRepo.logs[0].Reason)
	}
	if len(publisher.Published) != 1 {
		t.Errorf("expected 1 event, got %d", len(publisher.Published))
	}
}

func TestManualAssign_TeamLeadAllowed(t *testing.T) {
	svc, leadRepo, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	seedLead(leadRepo, "lead-1", "", "")

	_, err := svc.AssignManually(ctx, domain.ManualAssignRequest{
		TenantID:     testTenantID,
		LeadID:       "lead-1",
		AssignToID:   "sales-rep-1",
		AssignByID:   "team-lead-1",
		AssignByRole: domain.RoleTeamLead,
	})
	if err != nil {
		t.Fatalf("team lead should be able to assign: %v", err)
	}
}

func TestManualAssign_SalesRepDenied(t *testing.T) {
	svc, leadRepo, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	seedLead(leadRepo, "lead-1", "", "")

	_, err := svc.AssignManually(ctx, domain.ManualAssignRequest{
		TenantID:     testTenantID,
		LeadID:       "lead-1",
		AssignToID:   "sales-rep-1",
		AssignByID:   "sales-rep-2",
		AssignByRole: domain.RoleSalesRep,
	})
	if err != domain.ErrUnauthorized {
		t.Errorf("expected ErrUnauthorized, got %v", err)
	}
}

func TestManualAssign_AlreadyAssignedSameUser(t *testing.T) {
	svc, leadRepo, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	lead := seedLead(leadRepo, "lead-1", "", "")
	lead.AssignedTo = "sales-rep-1"

	_, err := svc.AssignManually(ctx, domain.ManualAssignRequest{
		TenantID:     testTenantID,
		LeadID:       "lead-1",
		AssignToID:   "sales-rep-1",
		AssignByID:   "manager-1",
		AssignByRole: domain.RoleManager,
	})
	if err != domain.ErrLeadAlreadyAssigned {
		t.Errorf("expected ErrLeadAlreadyAssigned, got %v", err)
	}
}

func TestManualAssign_ReassignPublishesReassignEvent(t *testing.T) {
	svc, leadRepo, _, _, _, _, publisher := createTestService()
	ctx := context.Background()

	lead := seedLead(leadRepo, "lead-1", "", "")
	lead.AssignedTo = "sales-rep-1"
	lead.Status = domain.LeadStatusAssigned

	_, err := svc.AssignManually(ctx, domain.ManualAssignRequest{
		TenantID:     testTenantID,
		LeadID:       "lead-1",
		AssignToID:   "sales-rep-2",
		AssignByID:   "manager-1",
		AssignByRole: domain.RoleManager,
		Reason:       "Reassignment",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(publisher.Published) != 1 {
		t.Fatalf("expected 1 event, got %d", len(publisher.Published))
	}
	if publisher.Published[0].Type != domain.EventLeadReassigned {
		t.Errorf("expected %q event, got %q", domain.EventLeadReassigned, publisher.Published[0].Type)
	}
}

func TestManualAssign_InvalidTenant(t *testing.T) {
	svc, _, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	_, err := svc.AssignManually(ctx, domain.ManualAssignRequest{
		TenantID:     "",
		LeadID:       "lead-1",
		AssignToID:   "sales-rep-1",
		AssignByID:   "manager-1",
		AssignByRole: domain.RoleManager,
	})
	if err != domain.ErrInvalidTenant {
		t.Errorf("expected ErrInvalidTenant, got %v", err)
	}
}

func TestBulkAssignToRegion_WithSpecificUser(t *testing.T) {
	svc, leadRepo, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	seedLead(leadRepo, "lead-1", "", "")
	seedLead(leadRepo, "lead-2", "", "")
	seedLead(leadRepo, "lead-3", "", "")

	count, err := svc.BulkAssignToRegion(ctx, domain.BulkManualAssignRequest{
		TenantID:     testTenantID,
		LeadIDs:      []string{"lead-1", "lead-2", "lead-3"},
		RegionID:     "region-1",
		AssignToID:   "sales-rep-1",
		AssignByID:   "manager-1",
		AssignByRole: domain.RoleManager,
		Reason:       "Region reassignment",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if count != 3 {
		t.Errorf("expected 3 assigned, got %d", count)
	}

	// Verify all assigned to the same user
	for _, id := range []string{"lead-1", "lead-2", "lead-3"} {
		lead := leadRepo.leads[id]
		if lead.AssignedTo != "sales-rep-1" {
			t.Errorf("lead %s: expected assigned_to 'sales-rep-1', got %q", id, lead.AssignedTo)
		}
	}
}

func TestBulkAssignToRegion_SalesRepDenied(t *testing.T) {
	svc, leadRepo, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	seedLead(leadRepo, "lead-1", "", "")

	_, err := svc.BulkAssignToRegion(ctx, domain.BulkManualAssignRequest{
		TenantID:     testTenantID,
		LeadIDs:      []string{"lead-1"},
		RegionID:     "region-1",
		AssignToID:   "sales-rep-1",
		AssignByID:   "sales-rep-2",
		AssignByRole: domain.RoleSalesRep,
	})
	if err != domain.ErrUnauthorized {
		t.Errorf("expected ErrUnauthorized, got %v", err)
	}
}

func TestUserRole_CanAssignLeads(t *testing.T) {
	tests := []struct {
		role     domain.UserRole
		expected bool
	}{
		{domain.RoleAdmin, true},
		{domain.RoleManager, true},
		{domain.RoleTeamLead, true},
		{domain.RoleSalesRep, false},
	}

	for _, tt := range tests {
		if got := tt.role.CanAssignLeads(); got != tt.expected {
			t.Errorf("role %q: expected CanAssignLeads=%v, got %v", tt.role, tt.expected, got)
		}
	}
}

func TestTeamMember_HasCapacity(t *testing.T) {
	tests := []struct {
		name     string
		member   domain.TeamMember
		expected bool
	}{
		{"active with capacity", domain.TeamMember{IsActive: true, MaxLeads: 50, CurrentLeadCount: 10}, true},
		{"active at capacity", domain.TeamMember{IsActive: true, MaxLeads: 50, CurrentLeadCount: 50}, false},
		{"inactive", domain.TeamMember{IsActive: false, MaxLeads: 50, CurrentLeadCount: 0}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.member.HasCapacity(); got != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, got)
			}
		})
	}
}
