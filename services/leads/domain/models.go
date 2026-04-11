package domain

import (
	"time"
)

// --- Enums ---

type LeadStatus string

const (
	LeadStatusNew         LeadStatus = "new"
	LeadStatusAssigned    LeadStatus = "assigned"
	LeadStatusContacted   LeadStatus = "contacted"
	LeadStatusQualified   LeadStatus = "qualified"
	LeadStatusUnqualified LeadStatus = "unqualified"
	LeadStatusConverted   LeadStatus = "converted"
	LeadStatusLost        LeadStatus = "lost"
)

type LeadSource string

const (
	LeadSourceWebsite     LeadSource = "website"
	LeadSourceReferral    LeadSource = "referral"
	LeadSourceCampaign    LeadSource = "campaign"
	LeadSourceLeadSquare  LeadSource = "leadsquare"
	LeadSourceImport      LeadSource = "import"
	LeadSourceManual      LeadSource = "manual"
	LeadSourceAPI         LeadSource = "api"
	LeadSourceSocialMedia LeadSource = "social_media"
	LeadSourceOther       LeadSource = "other"
)

type AssignmentMethod string

const (
	AssignmentRoundRobin     AssignmentMethod = "round_robin"
	AssignmentManual         AssignmentMethod = "manual"
	AssignmentLeadSquareSync AssignmentMethod = "leadsquare_sync"
	AssignmentRuleBased      AssignmentMethod = "rule_based"
)

type AssignmentScope string

const (
	ScopeProject  AssignmentScope = "project"
	ScopeLocation AssignmentScope = "location"
	ScopeRegion   AssignmentScope = "region"
	ScopeGlobal   AssignmentScope = "global"
)

type UserRole string

const (
	RoleAdmin    UserRole = "admin"
	RoleManager  UserRole = "manager"
	RoleTeamLead UserRole = "team_lead"
	RoleSalesRep UserRole = "sales_rep"
)

// CanAssignLeads returns true if the role has permission to manually assign leads.
func (r UserRole) CanAssignLeads() bool {
	return r == RoleAdmin || r == RoleManager || r == RoleTeamLead
}

// --- Core Models ---

type Region struct {
	ID             string    `json:"id"`
	TenantID       string    `json:"tenant_id"`
	Name           string    `json:"name"`
	Code           string    `json:"code"`
	Description    string    `json:"description,omitempty"`
	ParentRegionID string    `json:"parent_region_id,omitempty"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type Project struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	Name      string    `json:"name"`
	Code      string    `json:"code"`
	RegionID  string    `json:"region_id,omitempty"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Location struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	Name      string    `json:"name"`
	Code      string    `json:"code"`
	Address   string    `json:"address,omitempty"`
	City      string    `json:"city,omitempty"`
	State     string    `json:"state,omitempty"`
	Country   string    `json:"country,omitempty"`
	RegionID  string    `json:"region_id,omitempty"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Team struct {
	ID         string    `json:"id"`
	TenantID   string    `json:"tenant_id"`
	Name       string    `json:"name"`
	RegionID   string    `json:"region_id,omitempty"`
	ProjectID  string    `json:"project_id,omitempty"`
	LocationID string    `json:"location_id,omitempty"`
	IsActive   bool      `json:"is_active"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type TeamMember struct {
	ID               string    `json:"id"`
	TenantID         string    `json:"tenant_id"`
	TeamID           string    `json:"team_id"`
	UserID           string    `json:"user_id"`
	UserEmail        string    `json:"user_email"`
	UserName         string    `json:"user_name"`
	Role             UserRole  `json:"role"`
	IsActive         bool      `json:"is_active"`
	MaxLeads         int       `json:"max_leads"`
	CurrentLeadCount int       `json:"current_lead_count"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// HasCapacity returns true if the member can take more leads.
func (m *TeamMember) HasCapacity() bool {
	return m.IsActive && m.CurrentLeadCount < m.MaxLeads
}

type Lead struct {
	ID               string           `json:"id"`
	TenantID         string           `json:"tenant_id"`
	FirstName        string           `json:"first_name,omitempty"`
	LastName         string           `json:"last_name,omitempty"`
	Email            string           `json:"email,omitempty"`
	Phone            string           `json:"phone,omitempty"`
	Company          string           `json:"company,omitempty"`
	Source           LeadSource       `json:"source"`
	Status           LeadStatus       `json:"status"`
	Score            int              `json:"score"`
	AssignedTo       string           `json:"assigned_to,omitempty"`
	AssignedBy       string           `json:"assigned_by,omitempty"`
	AssignedAt       *time.Time       `json:"assigned_at,omitempty"`
	AssignmentMethod AssignmentMethod `json:"assignment_method,omitempty"`
	RegionID         string           `json:"region_id,omitempty"`
	ProjectID        string           `json:"project_id,omitempty"`
	LocationID       string           `json:"location_id,omitempty"`
	ExternalID       string           `json:"external_id,omitempty"`
	ExternalSource   string           `json:"external_source,omitempty"`
	Notes            string           `json:"notes,omitempty"`
	CustomFields     map[string]any   `json:"custom_fields,omitempty"`
	CreatedAt        time.Time        `json:"created_at"`
	UpdatedAt        time.Time        `json:"updated_at"`
}

type LeadAssignmentRule struct {
	ID              string          `json:"id"`
	TenantID        string          `json:"tenant_id"`
	Name            string          `json:"name"`
	Scope           AssignmentScope `json:"scope"`
	ProjectID       string          `json:"project_id,omitempty"`
	LocationID      string          `json:"location_id,omitempty"`
	RegionID        string          `json:"region_id,omitempty"`
	TeamID          string          `json:"team_id"`
	IsActive        bool            `json:"is_active"`
	RespectCapacity bool            `json:"respect_capacity"`
	Priority        int             `json:"priority"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type RoundRobinState struct {
	ID                   string     `json:"id"`
	TenantID             string     `json:"tenant_id"`
	RuleID               string     `json:"rule_id"`
	LastAssignedMemberID string     `json:"last_assigned_member_id,omitempty"`
	LastAssignedAt       *time.Time `json:"last_assigned_at,omitempty"`
	RotationCount        int64      `json:"rotation_count"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

type LeadAssignmentLog struct {
	ID           string           `json:"id"`
	TenantID     string           `json:"tenant_id"`
	LeadID       string           `json:"lead_id"`
	AssignedFrom string           `json:"assigned_from,omitempty"`
	AssignedTo   string           `json:"assigned_to"`
	AssignedBy   string           `json:"assigned_by"`
	Method       AssignmentMethod `json:"method"`
	RuleID       string           `json:"rule_id,omitempty"`
	Reason       string           `json:"reason,omitempty"`
	CreatedAt    time.Time        `json:"created_at"`
}

// --- Availability & Daily Config ---

type AvailabilityStatus string

const (
	StatusAvailable   AvailabilityStatus = "available"
	StatusOnLeave     AvailabilityStatus = "on_leave"
	StatusUnavailable AvailabilityStatus = "unavailable"
	StatusOffline     AvailabilityStatus = "offline"
)

type LeaveType string

const (
	LeaveVacation      LeaveType = "vacation"
	LeaveSick          LeaveType = "sick"
	LeavePersonal      LeaveType = "personal"
	LeaveTraining      LeaveType = "training"
	LeavePublicHoliday LeaveType = "public_holiday"
	LeaveHalfDay       LeaveType = "half_day"
	LeaveOther         LeaveType = "other"
)

// MemberAvailability tracks when a member is on leave or unavailable.
type MemberAvailability struct {
	ID        string             `json:"id"`
	TenantID  string             `json:"tenant_id"`
	MemberID  string             `json:"member_id"`
	UserID    string             `json:"user_id"`
	Status    AvailabilityStatus `json:"status"`
	LeaveType LeaveType          `json:"leave_type,omitempty"`
	StartDate string             `json:"start_date"` // YYYY-MM-DD
	EndDate   string             `json:"end_date"`   // YYYY-MM-DD
	Reason    string             `json:"reason,omitempty"`
	MarkedBy  string             `json:"marked_by"`
	CreatedAt time.Time          `json:"created_at"`
	UpdatedAt time.Time          `json:"updated_at"`
}

// RosterEntry defines one member's participation in a daily config roster.
type RosterEntry struct {
	MemberID     string  `json:"member_id"`
	UserID       string  `json:"user_id"`
	UserName     string  `json:"user_name"`
	MaxLeadsToday int    `json:"max_leads_today"`
	Weight       float64 `json:"weight"` // 1.0 = normal, 2.0 = double share, 0.5 = half
	IsActive     bool    `json:"is_active"`
}

// DailyAssignmentConfig holds the controllable roster for a specific day.
type DailyAssignmentConfig struct {
	ID                 string        `json:"id"`
	TenantID           string        `json:"tenant_id"`
	ConfigDate         string        `json:"config_date"` // YYYY-MM-DD
	RuleID             string        `json:"rule_id,omitempty"`
	IsAutomationActive bool          `json:"is_automation_active"`
	Roster             []RosterEntry `json:"roster"`
	Notes              string        `json:"notes,omitempty"`
	CreatedBy          string        `json:"created_by"`
	UpdatedBy          string        `json:"updated_by"`
	CreatedAt          time.Time     `json:"created_at"`
	UpdatedAt          time.Time     `json:"updated_at"`
}

// DailyLeadCounter tracks per-member, per-day lead counts for daily caps.
type DailyLeadCounter struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenant_id"`
	MemberID    string    `json:"member_id"`
	UserID      string    `json:"user_id"`
	CounterDate string    `json:"counter_date"` // YYYY-MM-DD
	LeadCount   int       `json:"lead_count"`
	MaxLeads    int       `json:"max_leads"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// HasDailyCapacity returns true if the counter hasn't reached its daily max.
func (c *DailyLeadCounter) HasDailyCapacity() bool {
	return c.LeadCount < c.MaxLeads
}

// MemberDailyStatus is a computed view combining member info + availability + daily config.
type MemberDailyStatus struct {
	Member       *TeamMember         `json:"member"`
	Availability *MemberAvailability `json:"availability,omitempty"`
	DailyCounter *DailyLeadCounter   `json:"daily_counter,omitempty"`
	RosterEntry  *RosterEntry        `json:"roster_entry,omitempty"`
	IsEligible   bool                `json:"is_eligible"`
	Reason       string              `json:"reason,omitempty"` // why not eligible
}

// AssignmentStats provides a snapshot of current assignment state.
type AssignmentStats struct {
	TenantID           string              `json:"tenant_id"`
	Date               string              `json:"date"`
	TotalLeadsToday    int                 `json:"total_leads_today"`
	AssignedToday      int                 `json:"assigned_today"`
	UnassignedCount    int                 `json:"unassigned_count"`
	AutomationActive   bool                `json:"automation_active"`
	ActiveRules        int                 `json:"active_rules"`
	MemberStatuses     []MemberDailyStatus `json:"member_statuses"`
}
