package unit

import (
	"context"
	"testing"
	"time"

	"github.com/rohtash-ui/crm/services/leads/domain"
	"github.com/rohtash-ui/crm/services/leads/infra/events"
)

// =====================================================================
// In-memory mocks
// =====================================================================

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

// --- Availability mock ---

type mockAvailabilityRepo struct {
	entries []*domain.MemberAvailability
}

func newMockAvailabilityRepo() *mockAvailabilityRepo {
	return &mockAvailabilityRepo{}
}

func (m *mockAvailabilityRepo) Create(_ context.Context, entry *domain.MemberAvailability) error {
	entry.ID = "avail-" + entry.MemberID
	m.entries = append(m.entries, entry)
	return nil
}

func (m *mockAvailabilityRepo) Update(_ context.Context, entry *domain.MemberAvailability) error {
	for i, e := range m.entries {
		if e.ID == entry.ID {
			m.entries[i] = entry
			return nil
		}
	}
	return nil
}

func (m *mockAvailabilityRepo) Delete(_ context.Context, tenantID, entryID string) error {
	for i, e := range m.entries {
		if e.TenantID == tenantID && e.ID == entryID {
			m.entries = append(m.entries[:i], m.entries[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *mockAvailabilityRepo) GetByID(_ context.Context, tenantID, entryID string) (*domain.MemberAvailability, error) {
	for _, e := range m.entries {
		if e.TenantID == tenantID && e.ID == entryID {
			return e, nil
		}
	}
	return nil, domain.ErrMemberNotFound
}

func (m *mockAvailabilityRepo) ListByMember(_ context.Context, tenantID, memberID string) ([]*domain.MemberAvailability, error) {
	var result []*domain.MemberAvailability
	for _, e := range m.entries {
		if e.TenantID == tenantID && e.MemberID == memberID {
			result = append(result, e)
		}
	}
	return result, nil
}

func (m *mockAvailabilityRepo) ListUnavailableOnDate(_ context.Context, tenantID, date string) ([]*domain.MemberAvailability, error) {
	var result []*domain.MemberAvailability
	for _, e := range m.entries {
		if e.TenantID == tenantID && e.Status != domain.StatusAvailable &&
			e.StartDate <= date && e.EndDate >= date {
			result = append(result, e)
		}
	}
	return result, nil
}

func (m *mockAvailabilityRepo) IsAvailable(_ context.Context, tenantID, memberID, date string) (bool, error) {
	for _, e := range m.entries {
		if e.TenantID == tenantID && e.MemberID == memberID &&
			e.Status != domain.StatusAvailable &&
			e.StartDate <= date && e.EndDate >= date {
			return false, nil
		}
	}
	return true, nil
}

// --- Daily config mock ---

type mockDailyConfigRepo struct {
	configs []*domain.DailyAssignmentConfig
}

func newMockDailyConfigRepo() *mockDailyConfigRepo {
	return &mockDailyConfigRepo{}
}

func (m *mockDailyConfigRepo) GetByDate(_ context.Context, tenantID, date, ruleID string) (*domain.DailyAssignmentConfig, error) {
	for _, c := range m.configs {
		if c.TenantID == tenantID && c.ConfigDate == date && c.RuleID == ruleID {
			return c, nil
		}
	}
	return nil, nil
}

func (m *mockDailyConfigRepo) Upsert(_ context.Context, config *domain.DailyAssignmentConfig) error {
	for i, c := range m.configs {
		if c.TenantID == config.TenantID && c.ConfigDate == config.ConfigDate && c.RuleID == config.RuleID {
			config.ID = c.ID
			m.configs[i] = config
			return nil
		}
	}
	config.ID = "config-" + config.ConfigDate
	m.configs = append(m.configs, config)
	return nil
}

func (m *mockDailyConfigRepo) Delete(_ context.Context, tenantID, configID string) error {
	for i, c := range m.configs {
		if c.TenantID == tenantID && c.ID == configID {
			m.configs = append(m.configs[:i], m.configs[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *mockDailyConfigRepo) ListByDateRange(_ context.Context, tenantID, startDate, endDate string) ([]*domain.DailyAssignmentConfig, error) {
	var result []*domain.DailyAssignmentConfig
	for _, c := range m.configs {
		if c.TenantID == tenantID && c.ConfigDate >= startDate && c.ConfigDate <= endDate {
			result = append(result, c)
		}
	}
	return result, nil
}

// --- Daily counter mock ---

type mockDailyCounterRepo struct {
	counters map[string]*domain.DailyLeadCounter
}

func newMockDailyCounterRepo() *mockDailyCounterRepo {
	return &mockDailyCounterRepo{counters: make(map[string]*domain.DailyLeadCounter)}
}

func (m *mockDailyCounterRepo) GetOrCreate(_ context.Context, tenantID, memberID, userID, date string, maxLeads int) (*domain.DailyLeadCounter, error) {
	key := tenantID + ":" + memberID + ":" + date
	if c, ok := m.counters[key]; ok {
		return c, nil
	}
	c := &domain.DailyLeadCounter{
		ID:          "counter-" + memberID + "-" + date,
		TenantID:    tenantID,
		MemberID:    memberID,
		UserID:      userID,
		CounterDate: date,
		LeadCount:   0,
		MaxLeads:    maxLeads,
	}
	m.counters[key] = c
	return c, nil
}

func (m *mockDailyCounterRepo) Increment(_ context.Context, tenantID, memberID, date string) error {
	key := tenantID + ":" + memberID + ":" + date
	if c, ok := m.counters[key]; ok {
		c.LeadCount++
	}
	return nil
}

func (m *mockDailyCounterRepo) GetByDate(_ context.Context, tenantID, date string) ([]*domain.DailyLeadCounter, error) {
	var result []*domain.DailyLeadCounter
	for _, c := range m.counters {
		if c.TenantID == tenantID && c.CounterDate == date {
			result = append(result, c)
		}
	}
	return result, nil
}

// =====================================================================
// Test fixtures
// =====================================================================

const testTenantID = "tenant-001"
const testTeamID = "team-001"

func createTestService() (
	*domain.AssignmentService,
	*mockLeadRepo,
	*mockRuleRepo,
	*mockTeamRepo,
	*mockRRStateRepo,
	*mockLogRepo,
	*events.NoopPublisher,
	*mockAvailabilityRepo,
	*mockDailyConfigRepo,
	*mockDailyCounterRepo,
) {
	leadRepo := newMockLeadRepo()
	ruleRepo := newMockRuleRepo()
	teamRepo := newMockTeamRepo()
	rrStateRepo := newMockRRStateRepo()
	logRepo := newMockLogRepo()
	publisher := events.NewNoopPublisher()
	availRepo := newMockAvailabilityRepo()
	configRepo := newMockDailyConfigRepo()
	counterRepo := newMockDailyCounterRepo()

	svc := domain.NewAssignmentService(
		leadRepo, ruleRepo, teamRepo, rrStateRepo, logRepo, publisher,
		availRepo, configRepo, counterRepo,
	)
	return svc, leadRepo, ruleRepo, teamRepo, rrStateRepo, logRepo, publisher, availRepo, configRepo, counterRepo
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
	return string(rune('0' + i%10))
}

func seedLead(leadRepo *mockLeadRepo, id string, projectID string, locationID string) *domain.Lead {
	lead := &domain.Lead{
		ID:         id,
		TenantID:   testTenantID,
		FirstName:  "Test",
		LastName:   "Lead",
		Email:      id + "@example.com",
		Source:     domain.LeadSourceWebsite,
		Status:     domain.LeadStatusNew,
		ProjectID:  projectID,
		LocationID: locationID,
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
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

func today() string {
	return time.Now().UTC().Format("2006-01-02")
}

// =====================================================================
// Core assignment tests
// =====================================================================

func TestRoundRobinAssign_Basic(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, logRepo, publisher, _, _, _ := createTestService()
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
}

func TestRoundRobinAssign_RotatesMembers(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 3)
	seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

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

	seen := make(map[string]bool)
	for _, uid := range assignedUsers {
		if seen[uid] {
			t.Errorf("user %s assigned more than once before rotation completed", uid)
		}
		seen[uid] = true
	}

	if len(seen) != len(members) {
		t.Errorf("expected %d unique assignees, got %d", len(members), len(seen))
	}
}

func TestRoundRobinAssign_SkipsAtCapacity(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 3)
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

	if lead.AssignedTo == members[0].UserID {
		t.Error("should not assign to member at max capacity")
	}
}

func TestRoundRobinAssign_NoEligibleMembers(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, _, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 2)
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
	svc, leadRepo, _, _, _, _, _, _, _, _ := createTestService()
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

// =====================================================================
// Availability / Leave tests
// =====================================================================

func TestRoundRobin_SkipsMemberOnLeave(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, availRepo, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 3)
	seedLead(leadRepo, "lead-1", "", "")
	seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	// Put member-0 on leave for today
	availRepo.entries = append(availRepo.entries, &domain.MemberAvailability{
		ID:        "leave-0",
		TenantID:  testTenantID,
		MemberID:  members[0].ID,
		UserID:    members[0].UserID,
		Status:    domain.StatusOnLeave,
		LeaveType: domain.LeaveVacation,
		StartDate: today(),
		EndDate:   today(),
		MarkedBy:  "manager-1",
	})

	lead, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if lead.AssignedTo == members[0].UserID {
		t.Error("should not assign to member on leave")
	}
}

func TestRoundRobin_SkipsUnavailableMember(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, availRepo, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 2)
	seedLead(leadRepo, "lead-1", "", "")
	seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	// Mark member-0 as unavailable today
	availRepo.entries = append(availRepo.entries, &domain.MemberAvailability{
		ID:        "unavail-0",
		TenantID:  testTenantID,
		MemberID:  members[0].ID,
		UserID:    members[0].UserID,
		Status:    domain.StatusUnavailable,
		StartDate: today(),
		EndDate:   today(),
		MarkedBy:  "manager-1",
	})

	lead, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should go to member-1
	if lead.AssignedTo != members[1].UserID {
		t.Errorf("expected assignment to %s (available), got %s", members[1].UserID, lead.AssignedTo)
	}
}

func TestRoundRobin_AllOnLeave_ReturnsNoEligible(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, availRepo, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 2)
	seedLead(leadRepo, "lead-1", "", "")
	seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	// Put everyone on leave
	for _, m := range members {
		availRepo.entries = append(availRepo.entries, &domain.MemberAvailability{
			ID:        "leave-" + m.ID,
			TenantID:  testTenantID,
			MemberID:  m.ID,
			UserID:    m.UserID,
			Status:    domain.StatusOnLeave,
			StartDate: today(),
			EndDate:   today(),
			MarkedBy:  "manager-1",
		})
	}

	_, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != domain.ErrNoEligibleMembers {
		t.Errorf("expected ErrNoEligibleMembers, got %v", err)
	}
}

func TestRoundRobin_LeaveOnDifferentDate_StillAssigns(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, availRepo, _, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 2)
	seedLead(leadRepo, "lead-1", "", "")
	seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	// Leave is for yesterday, not today
	availRepo.entries = append(availRepo.entries, &domain.MemberAvailability{
		ID:        "leave-past",
		TenantID:  testTenantID,
		MemberID:  members[0].ID,
		UserID:    members[0].UserID,
		Status:    domain.StatusOnLeave,
		StartDate: "2020-01-01",
		EndDate:   "2020-01-01",
		MarkedBy:  "manager-1",
	})

	lead, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// member-0 should be eligible since leave was in the past
	if lead.AssignedTo == "" {
		t.Error("lead should be assigned")
	}
}

// =====================================================================
// Automation pause tests
// =====================================================================

func TestRoundRobin_AutomationPaused_ReturnsError(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, _, configRepo, _ := createTestService()
	ctx := context.Background()

	seedMembers(teamRepo, 3)
	seedLead(leadRepo, "lead-1", "", "")
	rule := seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	// Pause automation for today
	configRepo.configs = append(configRepo.configs, &domain.DailyAssignmentConfig{
		ID:                 "config-today",
		TenantID:           testTenantID,
		ConfigDate:         today(),
		RuleID:             rule.ID,
		IsAutomationActive: false,
		Roster:             []domain.RosterEntry{},
	})

	_, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != domain.ErrAutomationPaused {
		t.Errorf("expected ErrAutomationPaused, got %v", err)
	}
}

// =====================================================================
// Daily roster tests
// =====================================================================

func TestRoundRobin_DailyRoster_OnlyAssignsToRosteredMembers(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, _, configRepo, _ := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 3)
	seedLead(leadRepo, "lead-1", "", "")
	rule := seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	// Set daily roster with only member-1 active
	configRepo.configs = append(configRepo.configs, &domain.DailyAssignmentConfig{
		ID:                 "config-today",
		TenantID:           testTenantID,
		ConfigDate:         today(),
		RuleID:             rule.ID,
		IsAutomationActive: true,
		Roster: []domain.RosterEntry{
			{MemberID: members[0].ID, UserID: members[0].UserID, IsActive: false, MaxLeadsToday: 10},
			{MemberID: members[1].ID, UserID: members[1].UserID, IsActive: true, MaxLeadsToday: 10},
			{MemberID: members[2].ID, UserID: members[2].UserID, IsActive: false, MaxLeadsToday: 10},
		},
	})

	lead, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Only member-1 is active in roster
	if lead.AssignedTo != members[1].UserID {
		t.Errorf("expected assignment to %s (only rostered member), got %s", members[1].UserID, lead.AssignedTo)
	}
}

// =====================================================================
// Daily capacity tests
// =====================================================================

func TestRoundRobin_DailyCapExhausted_SkipsMember(t *testing.T) {
	svc, leadRepo, ruleRepo, teamRepo, _, _, _, _, configRepo, counterRepo := createTestService()
	ctx := context.Background()

	members := seedMembers(teamRepo, 2)
	seedLead(leadRepo, "lead-1", "", "")
	rule := seedRule(ruleRepo, "rule-1", domain.ScopeGlobal, "", "", "")

	// Set daily config with low cap for member-0
	configRepo.configs = append(configRepo.configs, &domain.DailyAssignmentConfig{
		ID:                 "config-today",
		TenantID:           testTenantID,
		ConfigDate:         today(),
		RuleID:             rule.ID,
		IsAutomationActive: true,
		Roster: []domain.RosterEntry{
			{MemberID: members[0].ID, UserID: members[0].UserID, IsActive: true, MaxLeadsToday: 5},
			{MemberID: members[1].ID, UserID: members[1].UserID, IsActive: true, MaxLeadsToday: 10},
		},
	})

	// Set member-0's daily counter to max
	key := testTenantID + ":" + members[0].ID + ":" + today()
	counterRepo.counters[key] = &domain.DailyLeadCounter{
		ID:          "counter-0",
		TenantID:    testTenantID,
		MemberID:    members[0].ID,
		UserID:      members[0].UserID,
		CounterDate: today(),
		LeadCount:   5,
		MaxLeads:    5,
	}

	lead, err := svc.AssignRoundRobin(ctx, domain.RoundRobinAssignRequest{
		TenantID: testTenantID,
		LeadID:   "lead-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// member-0 is at daily cap, so lead should go to member-1
	if lead.AssignedTo != members[1].UserID {
		t.Errorf("expected assignment to %s (has daily capacity), got %s", members[1].UserID, lead.AssignedTo)
	}
}

// =====================================================================
// Manual assignment tests
// =====================================================================

func TestManualAssign_Success(t *testing.T) {
	svc, leadRepo, _, _, _, logRepo, publisher, _, _, _ := createTestService()
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
	if len(logRepo.logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(logRepo.logs))
	}
	if len(publisher.Published) != 1 {
		t.Errorf("expected 1 event, got %d", len(publisher.Published))
	}
}

func TestManualAssign_TeamLeadAllowed(t *testing.T) {
	svc, leadRepo, _, _, _, _, _, _, _, _ := createTestService()
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
	svc, leadRepo, _, _, _, _, _, _, _, _ := createTestService()
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
	svc, leadRepo, _, _, _, _, _, _, _, _ := createTestService()
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

func TestManualAssign_InvalidTenant(t *testing.T) {
	svc, _, _, _, _, _, _, _, _, _ := createTestService()
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

func TestBulkAssignToRegion_SalesRepDenied(t *testing.T) {
	svc, leadRepo, _, _, _, _, _, _, _, _ := createTestService()
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

// =====================================================================
// Model helper tests
// =====================================================================

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

func TestDailyLeadCounter_HasDailyCapacity(t *testing.T) {
	tests := []struct {
		name     string
		counter  domain.DailyLeadCounter
		expected bool
	}{
		{"under cap", domain.DailyLeadCounter{LeadCount: 3, MaxLeads: 10}, true},
		{"at cap", domain.DailyLeadCounter{LeadCount: 10, MaxLeads: 10}, false},
		{"over cap", domain.DailyLeadCounter{LeadCount: 15, MaxLeads: 10}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.counter.HasDailyCapacity(); got != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, got)
			}
		})
	}
}
