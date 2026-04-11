package domain

import (
	"context"
	"fmt"
	"sort"
	"time"
)

// AssignmentService orchestrates both round-robin and manual lead assignment.
type AssignmentService struct {
	leads      LeadRepository
	rules      AssignmentRuleRepository
	teams      TeamRepository
	rrState    RoundRobinStateRepository
	log        AssignmentLogRepository
	events     EventPublisher
}

// NewAssignmentService creates a new assignment service with all required dependencies.
func NewAssignmentService(
	leads LeadRepository,
	rules AssignmentRuleRepository,
	teams TeamRepository,
	rrState RoundRobinStateRepository,
	log AssignmentLogRepository,
	events EventPublisher,
) *AssignmentService {
	return &AssignmentService{
		leads:  leads,
		rules:  rules,
		teams:  teams,
		rrState: rrState,
		log:    log,
		events: events,
	}
}

// --- Round-Robin Assignment ---

// RoundRobinAssignRequest specifies which lead to auto-assign and optional scope filters.
type RoundRobinAssignRequest struct {
	TenantID   string
	LeadID     string
	ProjectID  string // optional: scope to a specific project
	LocationID string // optional: scope to a specific location
	RegionID   string // optional: scope to a specific region
}

// AssignRoundRobin finds the matching rule for the lead's project/location/region,
// picks the next eligible team member in rotation, and assigns the lead.
func (s *AssignmentService) AssignRoundRobin(ctx context.Context, req RoundRobinAssignRequest) (*Lead, error) {
	if req.TenantID == "" {
		return nil, ErrInvalidTenant
	}

	// 1. Fetch the lead
	lead, err := s.leads.GetByID(ctx, req.TenantID, req.LeadID)
	if err != nil {
		return nil, fmt.Errorf("fetch lead: %w", err)
	}

	// Use lead's own scope if request doesn't override
	projectID := coalesce(req.ProjectID, lead.ProjectID)
	locationID := coalesce(req.LocationID, lead.LocationID)
	regionID := coalesce(req.RegionID, lead.RegionID)

	// 2. Find the matching assignment rule (highest priority first)
	rule, err := s.rules.FindMatchingRule(ctx, req.TenantID, projectID, locationID, regionID)
	if err != nil {
		return nil, fmt.Errorf("find rule: %w", err)
	}
	if rule == nil {
		return nil, ErrNoMatchingRule
	}

	// 3. Get active team members for this rule's team
	members, err := s.teams.ListActiveMembers(ctx, req.TenantID, rule.TeamID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}

	// 4. Filter to eligible members (active, within capacity)
	eligible := filterEligible(members, rule.RespectCapacity)
	if len(eligible) == 0 {
		return nil, ErrNoEligibleMembers
	}

	// 5. Get round-robin state and pick next member
	state, err := s.rrState.GetOrCreate(ctx, req.TenantID, rule.ID)
	if err != nil {
		return nil, fmt.Errorf("get rr state: %w", err)
	}

	nextMember := pickNextMember(eligible, state.LastAssignedMemberID)

	// 6. Assign the lead
	now := time.Now().UTC()
	previousAssignee := lead.AssignedTo

	lead.AssignedTo = nextMember.UserID
	lead.AssignedBy = "system" // automated assignment
	lead.AssignedAt = &now
	lead.AssignmentMethod = AssignmentRoundRobin
	lead.Status = LeadStatusAssigned
	lead.UpdatedAt = now

	if err := s.leads.UpdateAssignment(ctx, lead); err != nil {
		return nil, fmt.Errorf("update lead assignment: %w", err)
	}

	// 7. Update round-robin state
	state.LastAssignedMemberID = nextMember.ID
	state.LastAssignedAt = &now
	state.RotationCount++
	state.UpdatedAt = now
	if err := s.rrState.UpdateLastAssigned(ctx, state); err != nil {
		return nil, fmt.Errorf("update rr state: %w", err)
	}

	// 8. Increment lead count for the member
	if err := s.teams.IncrementLeadCount(ctx, req.TenantID, nextMember.ID); err != nil {
		return nil, fmt.Errorf("increment lead count: %w", err)
	}

	// 9. Log the assignment
	logEntry := &LeadAssignmentLog{
		TenantID:     req.TenantID,
		LeadID:       lead.ID,
		AssignedFrom: previousAssignee,
		AssignedTo:   nextMember.UserID,
		AssignedBy:   "system",
		Method:       AssignmentRoundRobin,
		RuleID:       rule.ID,
		Reason:       fmt.Sprintf("Round-robin via rule %q (rotation #%d)", rule.Name, state.RotationCount),
		CreatedAt:    now,
	}
	if err := s.log.Create(ctx, logEntry); err != nil {
		return nil, fmt.Errorf("create assignment log: %w", err)
	}

	// 10. Publish event
	eventType := EventLeadAssigned
	if previousAssignee != "" {
		eventType = EventLeadReassigned
	}
	s.events.Publish(LeadEvent{
		Type:      eventType,
		TenantID:  req.TenantID,
		LeadID:    lead.ID,
		Timestamp: now,
		Payload: LeadAssignedPayload{
			AssignedTo:       nextMember.UserID,
			AssignedBy:       "system",
			AssignedFrom:     previousAssignee,
			AssignmentMethod: AssignmentRoundRobin,
			RuleID:           rule.ID,
			ProjectID:        projectID,
			LocationID:       locationID,
			RegionID:         regionID,
		},
	})

	return lead, nil
}

// BulkRoundRobinAssign assigns all unassigned leads matching the filter using round-robin.
// Returns the number of leads successfully assigned.
func (s *AssignmentService) BulkRoundRobinAssign(ctx context.Context, tenantID string, filter UnassignedFilter) (int, error) {
	if tenantID == "" {
		return 0, ErrInvalidTenant
	}

	leads, err := s.leads.ListUnassigned(ctx, tenantID, filter)
	if err != nil {
		return 0, fmt.Errorf("list unassigned: %w", err)
	}

	assigned := 0
	for _, lead := range leads {
		_, err := s.AssignRoundRobin(ctx, RoundRobinAssignRequest{
			TenantID:   tenantID,
			LeadID:     lead.ID,
			ProjectID:  lead.ProjectID,
			LocationID: lead.LocationID,
			RegionID:   lead.RegionID,
		})
		if err != nil {
			// Log but continue - don't fail the batch for one lead
			continue
		}
		assigned++
	}

	return assigned, nil
}

// --- Manual Assignment (Team Leads & Managers) ---

// ManualAssignRequest specifies a manual lead assignment by an authorized user.
type ManualAssignRequest struct {
	TenantID    string
	LeadID      string
	AssignToID  string   // user_id to assign the lead to
	AssignByID  string   // user_id of the person making the assignment
	AssignByRole UserRole // role of the person making the assignment
	Reason      string
}

// AssignManually allows team leads and managers to manually assign a lead.
// Validates that the caller has the required role.
func (s *AssignmentService) AssignManually(ctx context.Context, req ManualAssignRequest) (*Lead, error) {
	if req.TenantID == "" {
		return nil, ErrInvalidTenant
	}

	// 1. Authorize: only admin, manager, or team_lead can assign
	if !req.AssignByRole.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	// 2. Fetch the lead
	lead, err := s.leads.GetByID(ctx, req.TenantID, req.LeadID)
	if err != nil {
		return nil, fmt.Errorf("fetch lead: %w", err)
	}

	// 3. Prevent no-op assignment
	if lead.AssignedTo == req.AssignToID {
		return nil, ErrLeadAlreadyAssigned
	}

	// 4. Assign the lead
	now := time.Now().UTC()
	previousAssignee := lead.AssignedTo

	lead.AssignedTo = req.AssignToID
	lead.AssignedBy = req.AssignByID
	lead.AssignedAt = &now
	lead.AssignmentMethod = AssignmentManual
	lead.Status = LeadStatusAssigned
	lead.UpdatedAt = now

	if err := s.leads.UpdateAssignment(ctx, lead); err != nil {
		return nil, fmt.Errorf("update lead assignment: %w", err)
	}

	// 5. Log the assignment
	logEntry := &LeadAssignmentLog{
		TenantID:     req.TenantID,
		LeadID:       lead.ID,
		AssignedFrom: previousAssignee,
		AssignedTo:   req.AssignToID,
		AssignedBy:   req.AssignByID,
		Method:       AssignmentManual,
		Reason:       req.Reason,
		CreatedAt:    now,
	}
	if err := s.log.Create(ctx, logEntry); err != nil {
		return nil, fmt.Errorf("create assignment log: %w", err)
	}

	// 6. Publish event
	eventType := EventLeadAssigned
	if previousAssignee != "" {
		eventType = EventLeadReassigned
	}
	s.events.Publish(LeadEvent{
		Type:      eventType,
		TenantID:  req.TenantID,
		LeadID:    lead.ID,
		Timestamp: now,
		Payload: LeadAssignedPayload{
			AssignedTo:       req.AssignToID,
			AssignedBy:       req.AssignByID,
			AssignedFrom:     previousAssignee,
			AssignmentMethod: AssignmentManual,
			ProjectID:        lead.ProjectID,
			LocationID:       lead.LocationID,
			RegionID:         lead.RegionID,
		},
	})

	return lead, nil
}

// BulkManualAssignRequest assigns multiple leads to a region's team members.
type BulkManualAssignRequest struct {
	TenantID     string
	LeadIDs      []string
	RegionID     string   // target region
	AssignToID   string   // specific user, or empty for round-robin within region
	AssignByID   string
	AssignByRole UserRole
	Reason       string
}

// BulkAssignToRegion assigns a batch of leads to a region.
// If AssignToID is set, all leads go to that user.
// If empty, leads are distributed round-robin across the region's team members.
func (s *AssignmentService) BulkAssignToRegion(ctx context.Context, req BulkManualAssignRequest) (int, error) {
	if req.TenantID == "" {
		return 0, ErrInvalidTenant
	}
	if !req.AssignByRole.CanAssignLeads() {
		return 0, ErrUnauthorized
	}

	assigned := 0
	for _, leadID := range req.LeadIDs {
		if req.AssignToID != "" {
			// Direct assignment to a specific user
			_, err := s.AssignManually(ctx, ManualAssignRequest{
				TenantID:     req.TenantID,
				LeadID:       leadID,
				AssignToID:   req.AssignToID,
				AssignByID:   req.AssignByID,
				AssignByRole: req.AssignByRole,
				Reason:       req.Reason,
			})
			if err != nil {
				continue
			}
		} else {
			// Round-robin within the region
			_, err := s.AssignRoundRobin(ctx, RoundRobinAssignRequest{
				TenantID: req.TenantID,
				LeadID:   leadID,
				RegionID: req.RegionID,
			})
			if err != nil {
				continue
			}
		}
		assigned++
	}

	return assigned, nil
}

// --- Helpers ---

// filterEligible returns only active members with available capacity.
func filterEligible(members []*TeamMember, respectCapacity bool) []*TeamMember {
	// Sort by ID for deterministic ordering
	sort.Slice(members, func(i, j int) bool {
		return members[i].ID < members[j].ID
	})

	var eligible []*TeamMember
	for _, m := range members {
		if !m.IsActive {
			continue
		}
		if respectCapacity && !m.HasCapacity() {
			continue
		}
		eligible = append(eligible, m)
	}
	return eligible
}

// pickNextMember selects the next team member after the last assigned one.
func pickNextMember(eligible []*TeamMember, lastAssignedMemberID string) *TeamMember {
	if len(eligible) == 0 {
		return nil
	}
	if lastAssignedMemberID == "" {
		return eligible[0]
	}

	// Find the position of the last assigned member
	lastIdx := -1
	for i, m := range eligible {
		if m.ID == lastAssignedMemberID {
			lastIdx = i
			break
		}
	}

	// Pick next in rotation (wrap around)
	nextIdx := (lastIdx + 1) % len(eligible)
	return eligible[nextIdx]
}

func coalesce(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
