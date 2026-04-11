package domain

import (
	"context"
	"fmt"
	"time"
)

// MemberWorkload combines a team member's profile with their current lead load
// and availability so a manager can make an informed assignment decision.
type MemberWorkload struct {
	Member           *TeamMember         `json:"member"`
	Availability     *MemberAvailability `json:"availability,omitempty"` // nil = available
	DailyLeadCount   int                 `json:"daily_lead_count"`
	DailyLeadMax     int                 `json:"daily_lead_max"`
	TotalLeadCount   int                 `json:"total_lead_count"`
	TotalLeadMax     int                 `json:"total_lead_max"`
	IsAvailableToday bool                `json:"is_available_today"`
	UnavailableReason string             `json:"unavailable_reason,omitempty"`
}

// ManualAssignmentService provides the browsing and assignment tools that
// managers and team leads use to manually distribute leads.
type ManualAssignmentService struct {
	leads        LeadRepository
	teams        TeamRepository
	log          AssignmentLogRepository
	availability AvailabilityRepository
	dailyCounter DailyCounterRepository
	assignment   *AssignmentService
}

func NewManualAssignmentService(
	leads LeadRepository,
	teams TeamRepository,
	log AssignmentLogRepository,
	availability AvailabilityRepository,
	dailyCounter DailyCounterRepository,
	assignment *AssignmentService,
) *ManualAssignmentService {
	return &ManualAssignmentService{
		leads:        leads,
		teams:        teams,
		log:          log,
		availability: availability,
		dailyCounter: dailyCounter,
		assignment:   assignment,
	}
}

// =====================================================================
// BROWSING: what leads need assigning?
// =====================================================================

// ListLeads returns a paginated, filterable list of leads for the manager view.
// Managers can filter by status, project, location, region, assignee, or free-text search.
func (s *ManualAssignmentService) ListLeads(ctx context.Context, tenantID string, filter LeadFilter, role UserRole) (*LeadPage, error) {
	if tenantID == "" {
		return nil, ErrInvalidTenant
	}
	if !role.CanAssignLeads() {
		return nil, ErrUnauthorized
	}
	return s.leads.List(ctx, tenantID, filter)
}

// GetLead returns a single lead with its full assignment history.
func (s *ManualAssignmentService) GetLead(ctx context.Context, tenantID, leadID string, role UserRole) (*Lead, []*LeadAssignmentLog, error) {
	if tenantID == "" {
		return nil, nil, ErrInvalidTenant
	}
	if !role.CanAssignLeads() {
		return nil, nil, ErrUnauthorized
	}

	lead, err := s.leads.GetByID(ctx, tenantID, leadID)
	if err != nil {
		return nil, nil, err
	}

	history, err := s.log.ListByLead(ctx, tenantID, leadID)
	if err != nil {
		return nil, nil, fmt.Errorf("fetch history: %w", err)
	}

	return lead, history, nil
}

// =====================================================================
// BROWSING: who can I assign to?
// =====================================================================

// ListMemberWorkloads returns every active member of a team with their current
// lead counts, daily counters, and availability — so a manager can decide
// who has capacity before assigning.
func (s *ManualAssignmentService) ListMemberWorkloads(ctx context.Context, tenantID, teamID string, role UserRole) ([]*MemberWorkload, error) {
	if tenantID == "" {
		return nil, ErrInvalidTenant
	}
	if !role.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	members, err := s.teams.ListActiveMembers(ctx, tenantID, teamID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}

	today := time.Now().UTC().Format("2006-01-02")

	// Get all unavailable entries for today in one shot
	unavailable, err := s.availability.ListUnavailableOnDate(ctx, tenantID, today)
	if err != nil {
		return nil, fmt.Errorf("list unavailable: %w", err)
	}
	unavailMap := make(map[string]*MemberAvailability)
	for _, entry := range unavailable {
		unavailMap[entry.MemberID] = entry
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

	workloads := make([]*MemberWorkload, 0, len(members))
	for _, m := range members {
		wl := &MemberWorkload{
			Member:           m,
			TotalLeadCount:   m.CurrentLeadCount,
			TotalLeadMax:     m.MaxLeads,
			IsAvailableToday: true,
		}

		if avail, onLeave := unavailMap[m.ID]; onLeave {
			wl.Availability = avail
			wl.IsAvailableToday = false
			wl.UnavailableReason = fmt.Sprintf("%s until %s", avail.Status, avail.EndDate)
		}

		if counter, ok := counterMap[m.ID]; ok {
			wl.DailyLeadCount = counter.LeadCount
			wl.DailyLeadMax = counter.MaxLeads
		} else {
			wl.DailyLeadMax = m.MaxLeads
		}

		workloads = append(workloads, wl)
	}

	return workloads, nil
}

// GetMemberLeads returns all leads currently assigned to a specific sales rep,
// so a manager can review their workload before reassigning.
func (s *ManualAssignmentService) GetMemberLeads(ctx context.Context, tenantID, assigneeUserID string, role UserRole) (*LeadPage, error) {
	if tenantID == "" {
		return nil, ErrInvalidTenant
	}
	if !role.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	return s.leads.List(ctx, tenantID, LeadFilter{
		AssignedTo: assigneeUserID,
		Status:     []LeadStatus{LeadStatusAssigned, LeadStatusContacted, LeadStatusQualified},
		PageSize:   200,
		Page:       1,
	})
}

// =====================================================================
// ASSIGNING: single lead, bulk leads, reassign
// =====================================================================

// AssignLeadRequest is the unified request for manager/team-lead manual assignment.
type AssignLeadRequest struct {
	TenantID     string
	LeadID       string
	AssignToID   string   // target sales rep user_id
	AssignByID   string   // manager/team lead user_id
	AssignByRole UserRole
	Reason       string
}

// AssignLead lets a manager or team lead assign (or reassign) a single lead.
func (s *ManualAssignmentService) AssignLead(ctx context.Context, req AssignLeadRequest) (*Lead, error) {
	return s.assignment.AssignManually(ctx, ManualAssignRequest{
		TenantID:     req.TenantID,
		LeadID:       req.LeadID,
		AssignToID:   req.AssignToID,
		AssignByID:   req.AssignByID,
		AssignByRole: req.AssignByRole,
		Reason:       req.Reason,
	})
}

// BulkAssignRequest assigns a set of hand-picked leads to a specific person.
type BulkAssignRequest struct {
	TenantID     string
	LeadIDs      []string
	AssignToID   string
	AssignByID   string
	AssignByRole UserRole
	Reason       string
}

// BulkAssignLeads assigns multiple hand-picked leads to a specific sales rep.
// Returns per-lead results so the caller knows which succeeded and which failed.
func (s *ManualAssignmentService) BulkAssignLeads(ctx context.Context, req BulkAssignRequest) (*BulkAssignResult, error) {
	if req.TenantID == "" {
		return nil, ErrInvalidTenant
	}
	if !req.AssignByRole.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	result := &BulkAssignResult{
		Total: len(req.LeadIDs),
	}

	for _, leadID := range req.LeadIDs {
		lead, err := s.assignment.AssignManually(ctx, ManualAssignRequest{
			TenantID:     req.TenantID,
			LeadID:       leadID,
			AssignToID:   req.AssignToID,
			AssignByID:   req.AssignByID,
			AssignByRole: req.AssignByRole,
			Reason:       req.Reason,
		})
		if err != nil {
			result.Failed = append(result.Failed, BulkAssignFailure{
				LeadID: leadID,
				Reason: err.Error(),
			})
		} else {
			result.Succeeded = append(result.Succeeded, lead)
		}
	}

	result.SuccessCount = len(result.Succeeded)
	result.FailCount = len(result.Failed)
	return result, nil
}

// ReassignLeadRequest moves a lead from one rep to another with a reason.
type ReassignLeadRequest struct {
	TenantID      string
	LeadID        string
	FromUserID    string   // current assignee (informational, for logging)
	ToUserID      string   // new assignee
	ReassignedBy  string
	ReassignByRole UserRole
	Reason        string
}

// ReassignLead moves an already-assigned lead to a different sales rep.
func (s *ManualAssignmentService) ReassignLead(ctx context.Context, req ReassignLeadRequest) (*Lead, error) {
	if req.TenantID == "" {
		return nil, ErrInvalidTenant
	}
	if !req.ReassignByRole.CanAssignLeads() {
		return nil, ErrUnauthorized
	}
	if req.FromUserID == req.ToUserID {
		return nil, ErrLeadAlreadyAssigned
	}

	// Reuse AssignManually — it handles all the logging, events, and status updates
	return s.assignment.AssignManually(ctx, ManualAssignRequest{
		TenantID:     req.TenantID,
		LeadID:       req.LeadID,
		AssignToID:   req.ToUserID,
		AssignByID:   req.ReassignedBy,
		AssignByRole: req.ReassignByRole,
		Reason:       fmt.Sprintf("Reassigned from %s. %s", req.FromUserID, req.Reason),
	})
}

// UnassignLead removes the current assignee from a lead, returning it to the
// unassigned pool so automation picks it up again.
type UnassignLeadRequest struct {
	TenantID     string
	LeadID       string
	UnassignedBy string
	ByRole       UserRole
	Reason       string
}

func (s *ManualAssignmentService) UnassignLead(ctx context.Context, req UnassignLeadRequest) (*Lead, error) {
	if req.TenantID == "" {
		return nil, ErrInvalidTenant
	}
	if !req.ByRole.CanAssignLeads() {
		return nil, ErrUnauthorized
	}

	lead, err := s.leads.GetByID(ctx, req.TenantID, req.LeadID)
	if err != nil {
		return nil, err
	}

	previousAssignee := lead.AssignedTo

	now := time.Now().UTC()
	lead.AssignedTo = ""
	lead.AssignedBy = req.UnassignedBy
	lead.AssignedAt = nil
	lead.AssignmentMethod = ""
	lead.Status = LeadStatusNew
	lead.UpdatedAt = now

	if err := s.leads.UpdateAssignment(ctx, lead); err != nil {
		return nil, fmt.Errorf("update lead: %w", err)
	}

	// Log it
	logEntry := &LeadAssignmentLog{
		TenantID:     req.TenantID,
		LeadID:       lead.ID,
		AssignedFrom: previousAssignee,
		AssignedTo:   "unassigned",
		AssignedBy:   req.UnassignedBy,
		Method:       AssignmentManual,
		Reason:       req.Reason,
		CreatedAt:    now,
	}
	_ = s.log.Create(ctx, logEntry)

	return lead, nil
}

// =====================================================================
// Result types
// =====================================================================

// BulkAssignResult holds per-lead outcomes for a bulk assignment.
type BulkAssignResult struct {
	Total        int                `json:"total"`
	SuccessCount int                `json:"success_count"`
	FailCount    int                `json:"fail_count"`
	Succeeded    []*Lead            `json:"succeeded"`
	Failed       []BulkAssignFailure `json:"failed,omitempty"`
}

// BulkAssignFailure records why a specific lead could not be assigned.
type BulkAssignFailure struct {
	LeadID string `json:"lead_id"`
	Reason string `json:"reason"`
}
