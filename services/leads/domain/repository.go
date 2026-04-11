package domain

import "context"

// LeadRepository defines the data access interface for leads.
type LeadRepository interface {
	GetByID(ctx context.Context, tenantID, leadID string) (*Lead, error)
	ListUnassigned(ctx context.Context, tenantID string, filter UnassignedFilter) ([]*Lead, error)
	UpdateAssignment(ctx context.Context, lead *Lead) error
	Create(ctx context.Context, lead *Lead) error
}

// AssignmentRuleRepository defines access to round-robin rules.
type AssignmentRuleRepository interface {
	GetByID(ctx context.Context, tenantID, ruleID string) (*LeadAssignmentRule, error)
	FindMatchingRule(ctx context.Context, tenantID, projectID, locationID, regionID string) (*LeadAssignmentRule, error)
	ListActive(ctx context.Context, tenantID string) ([]*LeadAssignmentRule, error)
	Create(ctx context.Context, rule *LeadAssignmentRule) error
	Update(ctx context.Context, rule *LeadAssignmentRule) error
}

// TeamRepository defines access to teams and members.
type TeamRepository interface {
	GetTeamByID(ctx context.Context, tenantID, teamID string) (*Team, error)
	ListActiveMembers(ctx context.Context, tenantID, teamID string) ([]*TeamMember, error)
	GetMemberByUserID(ctx context.Context, tenantID, teamID, userID string) (*TeamMember, error)
	IncrementLeadCount(ctx context.Context, tenantID, memberID string) error
	DecrementLeadCount(ctx context.Context, tenantID, memberID string) error
}

// RoundRobinStateRepository tracks rotation position.
type RoundRobinStateRepository interface {
	GetOrCreate(ctx context.Context, tenantID, ruleID string) (*RoundRobinState, error)
	UpdateLastAssigned(ctx context.Context, state *RoundRobinState) error
}

// AssignmentLogRepository records assignment history.
type AssignmentLogRepository interface {
	Create(ctx context.Context, log *LeadAssignmentLog) error
	ListByLead(ctx context.Context, tenantID, leadID string) ([]*LeadAssignmentLog, error)
}

// RegionRepository defines access to regions.
type RegionRepository interface {
	GetByID(ctx context.Context, tenantID, regionID string) (*Region, error)
	List(ctx context.Context, tenantID string) ([]*Region, error)
}

// UnassignedFilter narrows the list of unassigned leads.
type UnassignedFilter struct {
	ProjectID  string
	LocationID string
	RegionID   string
	Limit      int
}
