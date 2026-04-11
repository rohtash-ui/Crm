package domain

import (
	"context"
	"fmt"
	"time"
)

// AdminService provides full administrative control over lead assignment.
// Team leads and managers use this to manage daily rosters, leave, rules,
// pause/resume automation, view stats, and reset round-robin state.
type AdminService struct {
	teams        TeamRepository
	rules        AssignmentRuleRepository
	rrState      RoundRobinStateRepository
	availability AvailabilityRepository
	dailyConfig  DailyConfigRepository
	dailyCounter DailyCounterRepository
	leads        LeadRepository
	log          AssignmentLogRepository
}

func NewAdminService(
	teams TeamRepository,
	rules AssignmentRuleRepository,
	rrState RoundRobinStateRepository,
	availability AvailabilityRepository,
	dailyConfig DailyConfigRepository,
	dailyCounter DailyCounterRepository,
	leads LeadRepository,
	log AssignmentLogRepository,
) *AdminService {
	return &AdminService{
		teams:        teams,
		rules:        rules,
		rrState:      rrState,
		availability: availability,
		dailyConfig:  dailyConfig,
		dailyCounter: dailyCounter,
		leads:        leads,
		log:          log,
	}
}

// =====================================================================
// LEAVE / AVAILABILITY MANAGEMENT
// =====================================================================

// MarkLeaveRequest sets a member as on-leave for a date range.
type MarkLeaveRequest struct {
	TenantID     string
	MemberID     string
	UserID       string
	LeaveType    LeaveType
	StartDate    string // YYYY-MM-DD
	EndDate      string // YYYY-MM-DD
	Reason       string
	MarkedByID   string
	MarkedByRole UserRole
}

// MarkMemberOnLeave records a leave entry so the member is skipped during assignment.
func (s *AdminService) MarkMemberOnLeave(ctx context.Context, req MarkLeaveRequest) (*MemberAvailability, error) {
	if !req.MarkedByRole.CanAssignLeads() {
		return nil, ErrUnauthorized
	}
	if req.EndDate < req.StartDate {
		return nil, ErrInvalidDateRange
	}

	entry := &MemberAvailability{
		TenantID:  req.TenantID,
		MemberID:  req.MemberID,
		UserID:    req.UserID,
		Status:    StatusOnLeave,
		LeaveType: req.LeaveType,
		StartDate: req.StartDate,
		EndDate:   req.EndDate,
		Reason:    req.Reason,
		MarkedBy:  req.MarkedByID,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	if err := s.availability.Create(ctx, entry); err != nil {
		return nil, fmt.Errorf("create availability entry: %w", err)
	}
	return entry, nil
}

// MarkMemberUnavailable sets a member as temporarily unavailable (not leave, just pulled out).
func (s *AdminService) MarkMemberUnavailable(ctx context.Context, tenantID, memberID, userID, date, reason, markedBy string, role UserRole) (*MemberAvailability, error) {
	if !role.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	entry := &MemberAvailability{
		TenantID:  tenantID,
		MemberID:  memberID,
		UserID:    userID,
		Status:    StatusUnavailable,
		StartDate: date,
		EndDate:   date,
		Reason:    reason,
		MarkedBy:  markedBy,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	if err := s.availability.Create(ctx, entry); err != nil {
		return nil, fmt.Errorf("create unavailable entry: %w", err)
	}
	return entry, nil
}

// CancelLeave removes a leave entry so the member can receive leads again.
func (s *AdminService) CancelLeave(ctx context.Context, tenantID, entryID string, role UserRole) error {
	if !role.CanAssignLeads() {
		return ErrUnauthorized
	}
	return s.availability.Delete(ctx, tenantID, entryID)
}

// GetMemberAvailability returns all availability entries for a member.
func (s *AdminService) GetMemberAvailability(ctx context.Context, tenantID, memberID string) ([]*MemberAvailability, error) {
	return s.availability.ListByMember(ctx, tenantID, memberID)
}

// GetUnavailableToday returns everyone who is unavailable today.
func (s *AdminService) GetUnavailableToday(ctx context.Context, tenantID string) ([]*MemberAvailability, error) {
	today := time.Now().UTC().Format("2006-01-02")
	return s.availability.ListUnavailableOnDate(ctx, tenantID, today)
}

// =====================================================================
// DAILY ASSIGNMENT CONFIG / ROSTER
// =====================================================================

// SetDailyConfigRequest defines the daily roster for a specific date.
type SetDailyConfigRequest struct {
	TenantID           string
	ConfigDate         string        // YYYY-MM-DD
	RuleID             string        // which rule this config applies to (empty = global)
	IsAutomationActive bool          // master on/off switch
	Roster             []RosterEntry // who participates today with per-person caps
	Notes              string
	SetByID            string
	SetByRole          UserRole
}

// SetDailyConfig creates or updates the daily assignment configuration.
// This is how you change the automation on a daily basis.
func (s *AdminService) SetDailyConfig(ctx context.Context, req SetDailyConfigRequest) (*DailyAssignmentConfig, error) {
	if !req.SetByRole.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	config := &DailyAssignmentConfig{
		TenantID:           req.TenantID,
		ConfigDate:         req.ConfigDate,
		RuleID:             req.RuleID,
		IsAutomationActive: req.IsAutomationActive,
		Roster:             req.Roster,
		Notes:              req.Notes,
		CreatedBy:          req.SetByID,
		UpdatedBy:          req.SetByID,
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}

	if err := s.dailyConfig.Upsert(ctx, config); err != nil {
		return nil, fmt.Errorf("upsert daily config: %w", err)
	}
	return config, nil
}

// GetTodaysConfig returns the active daily config for today.
func (s *AdminService) GetTodaysConfig(ctx context.Context, tenantID, ruleID string) (*DailyAssignmentConfig, error) {
	today := time.Now().UTC().Format("2006-01-02")
	return s.dailyConfig.GetByDate(ctx, tenantID, today, ruleID)
}

// GetConfigForDate returns the daily config for a specific date.
func (s *AdminService) GetConfigForDate(ctx context.Context, tenantID, date, ruleID string) (*DailyAssignmentConfig, error) {
	return s.dailyConfig.GetByDate(ctx, tenantID, date, ruleID)
}

// PauseAutomation turns off automatic lead assignment for today.
func (s *AdminService) PauseAutomation(ctx context.Context, tenantID, ruleID, pausedBy string, role UserRole) error {
	if !role.CanAssignLeads() {
		return ErrUnauthorized
	}

	today := time.Now().UTC().Format("2006-01-02")
	existing, _ := s.dailyConfig.GetByDate(ctx, tenantID, today, ruleID)

	if existing != nil {
		existing.IsAutomationActive = false
		existing.UpdatedBy = pausedBy
		existing.UpdatedAt = time.Now().UTC()
		return s.dailyConfig.Upsert(ctx, existing)
	}

	config := &DailyAssignmentConfig{
		TenantID:           tenantID,
		ConfigDate:         today,
		RuleID:             ruleID,
		IsAutomationActive: false,
		Roster:             []RosterEntry{},
		Notes:              "Automation paused",
		CreatedBy:          pausedBy,
		UpdatedBy:          pausedBy,
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}
	return s.dailyConfig.Upsert(ctx, config)
}

// ResumeAutomation turns automatic lead assignment back on for today.
func (s *AdminService) ResumeAutomation(ctx context.Context, tenantID, ruleID, resumedBy string, role UserRole) error {
	if !role.CanAssignLeads() {
		return ErrUnauthorized
	}

	today := time.Now().UTC().Format("2006-01-02")
	existing, _ := s.dailyConfig.GetByDate(ctx, tenantID, today, ruleID)

	if existing != nil {
		existing.IsAutomationActive = true
		existing.UpdatedBy = resumedBy
		existing.UpdatedAt = time.Now().UTC()
		return s.dailyConfig.Upsert(ctx, existing)
	}

	config := &DailyAssignmentConfig{
		TenantID:           tenantID,
		ConfigDate:         today,
		RuleID:             ruleID,
		IsAutomationActive: true,
		Roster:             []RosterEntry{},
		Notes:              "Automation resumed",
		CreatedBy:          resumedBy,
		UpdatedBy:          resumedBy,
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}
	return s.dailyConfig.Upsert(ctx, config)
}

// =====================================================================
// RULE MANAGEMENT
// =====================================================================

// ToggleRule enables or disables an assignment rule.
func (s *AdminService) ToggleRule(ctx context.Context, tenantID, ruleID string, active bool, role UserRole) (*LeadAssignmentRule, error) {
	if !role.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	rule, err := s.rules.GetByID(ctx, tenantID, ruleID)
	if err != nil {
		return nil, err
	}

	rule.IsActive = active
	rule.UpdatedAt = time.Now().UTC()

	if err := s.rules.Update(ctx, rule); err != nil {
		return nil, fmt.Errorf("update rule: %w", err)
	}
	return rule, nil
}

// UpdateRulePriority changes the priority of an assignment rule.
func (s *AdminService) UpdateRulePriority(ctx context.Context, tenantID, ruleID string, priority int, role UserRole) (*LeadAssignmentRule, error) {
	if !role.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	rule, err := s.rules.GetByID(ctx, tenantID, ruleID)
	if err != nil {
		return nil, err
	}

	rule.Priority = priority
	rule.UpdatedAt = time.Now().UTC()

	if err := s.rules.Update(ctx, rule); err != nil {
		return nil, fmt.Errorf("update rule: %w", err)
	}
	return rule, nil
}

// ListRules returns all assignment rules for a tenant.
func (s *AdminService) ListRules(ctx context.Context, tenantID string) ([]*LeadAssignmentRule, error) {
	return s.rules.ListActive(ctx, tenantID)
}

// CreateRule creates a new assignment rule.
func (s *AdminService) CreateRule(ctx context.Context, rule *LeadAssignmentRule, role UserRole) error {
	if !role.CanAssignLeads() {
		return ErrUnauthorized
	}
	return s.rules.Create(ctx, rule)
}

// =====================================================================
// ROUND-ROBIN STATE MANAGEMENT
// =====================================================================

// ResetRoundRobin resets the round-robin rotation for a rule back to the beginning.
func (s *AdminService) ResetRoundRobin(ctx context.Context, tenantID, ruleID string, role UserRole) error {
	if !role.CanAssignLeads() {
		return ErrUnauthorized
	}

	state, err := s.rrState.GetOrCreate(ctx, tenantID, ruleID)
	if err != nil {
		return fmt.Errorf("get rr state: %w", err)
	}

	state.LastAssignedMemberID = ""
	state.LastAssignedAt = nil
	state.RotationCount = 0
	state.UpdatedAt = time.Now().UTC()

	return s.rrState.UpdateLastAssigned(ctx, state)
}

// =====================================================================
// DASHBOARD / STATS
// =====================================================================

// GetTodaysRoster returns the full status of every team member for today,
// including their availability, daily counter, and eligibility.
func (s *AdminService) GetTodaysRoster(ctx context.Context, tenantID, teamID string) ([]MemberDailyStatus, error) {
	today := time.Now().UTC().Format("2006-01-02")

	members, err := s.teams.ListActiveMembers(ctx, tenantID, teamID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}

	// Get all unavailable entries for today
	unavailable, err := s.availability.ListUnavailableOnDate(ctx, tenantID, today)
	if err != nil {
		return nil, fmt.Errorf("list unavailable: %w", err)
	}
	unavailableMap := make(map[string]*MemberAvailability)
	for _, entry := range unavailable {
		unavailableMap[entry.MemberID] = entry
	}

	// Get daily counters for today
	counters, err := s.dailyCounter.GetByDate(ctx, tenantID, today)
	if err != nil {
		return nil, fmt.Errorf("get counters: %w", err)
	}
	counterMap := make(map[string]*DailyLeadCounter)
	for _, c := range counters {
		counterMap[c.MemberID] = c
	}

	var statuses []MemberDailyStatus
	for _, m := range members {
		status := MemberDailyStatus{
			Member:     m,
			IsEligible: true,
		}

		// Check availability
		if avail, ok := unavailableMap[m.ID]; ok {
			status.Availability = avail
			status.IsEligible = false
			status.Reason = fmt.Sprintf("%s: %s", avail.Status, avail.Reason)
		}

		// Check daily counter
		if counter, ok := counterMap[m.ID]; ok {
			status.DailyCounter = counter
			if !counter.HasDailyCapacity() {
				status.IsEligible = false
				status.Reason = fmt.Sprintf("Daily cap reached (%d/%d)", counter.LeadCount, counter.MaxLeads)
			}
		}

		// Check overall capacity
		if !m.HasCapacity() {
			status.IsEligible = false
			status.Reason = fmt.Sprintf("Overall cap reached (%d/%d)", m.CurrentLeadCount, m.MaxLeads)
		}

		statuses = append(statuses, status)
	}

	return statuses, nil
}

// GetAssignmentStats returns a high-level snapshot of the assignment system for today.
func (s *AdminService) GetAssignmentStats(ctx context.Context, tenantID, teamID string) (*AssignmentStats, error) {
	today := time.Now().UTC().Format("2006-01-02")

	roster, err := s.GetTodaysRoster(ctx, tenantID, teamID)
	if err != nil {
		return nil, err
	}

	// Count unassigned leads
	unassigned, err := s.leads.ListUnassigned(ctx, tenantID, UnassignedFilter{Limit: 10000})
	if err != nil {
		return nil, fmt.Errorf("count unassigned: %w", err)
	}

	// Count leads assigned today
	counters, err := s.dailyCounter.GetByDate(ctx, tenantID, today)
	if err != nil {
		return nil, fmt.Errorf("get daily counters: %w", err)
	}
	assignedToday := 0
	for _, c := range counters {
		assignedToday += c.LeadCount
	}

	// Check automation status
	rules, err := s.rules.ListActive(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list rules: %w", err)
	}

	automationActive := true
	if len(rules) > 0 {
		cfg, _ := s.dailyConfig.GetByDate(ctx, tenantID, today, rules[0].ID)
		if cfg != nil {
			automationActive = cfg.IsAutomationActive
		}
	}

	return &AssignmentStats{
		TenantID:         tenantID,
		Date:             today,
		TotalLeadsToday:  assignedToday + len(unassigned),
		AssignedToday:    assignedToday,
		UnassignedCount:  len(unassigned),
		AutomationActive: automationActive,
		ActiveRules:      len(rules),
		MemberStatuses:   roster,
	}, nil
}

// =====================================================================
// MEMBER CAPACITY MANAGEMENT
// =====================================================================

// UpdateMemberDailyCap changes the daily lead cap for a member for today.
func (s *AdminService) UpdateMemberDailyCap(ctx context.Context, tenantID, memberID, userID string, maxLeadsToday int, role UserRole) (*DailyLeadCounter, error) {
	if !role.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	today := time.Now().UTC().Format("2006-01-02")
	counter, err := s.dailyCounter.GetOrCreate(ctx, tenantID, memberID, userID, today, maxLeadsToday)
	if err != nil {
		return nil, fmt.Errorf("get or create counter: %w", err)
	}

	counter.MaxLeads = maxLeadsToday
	counter.UpdatedAt = time.Now().UTC()

	return counter, nil
}
