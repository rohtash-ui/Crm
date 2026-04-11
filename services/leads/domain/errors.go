package domain

import "errors"

var (
	ErrLeadNotFound          = errors.New("lead not found")
	ErrRuleNotFound          = errors.New("assignment rule not found")
	ErrTeamNotFound          = errors.New("team not found")
	ErrRegionNotFound        = errors.New("region not found")
	ErrMemberNotFound        = errors.New("team member not found")
	ErrNoEligibleMembers     = errors.New("no eligible team members for round-robin assignment")
	ErrUnauthorized          = errors.New("user does not have permission to perform this action")
	ErrLeadAlreadyAssigned   = errors.New("lead is already assigned to this user")
	ErrInvalidAssignment     = errors.New("invalid assignment parameters")
	ErrNoMatchingRule        = errors.New("no matching assignment rule found for this lead")
	ErrCapacityExceeded      = errors.New("assignee has reached maximum lead capacity")
	ErrInvalidTenant         = errors.New("invalid or missing tenant context")
	ErrMemberOnLeave         = errors.New("member is currently on leave")
	ErrMemberUnavailable     = errors.New("member is currently unavailable")
	ErrAutomationPaused      = errors.New("lead assignment automation is paused for today")
	ErrDailyCapacityExceeded = errors.New("member has reached daily lead capacity")
	ErrConfigNotFound        = errors.New("daily assignment config not found")
	ErrInvalidDateRange      = errors.New("end date must be on or after start date")
	ErrOverlappingLeave      = errors.New("overlapping leave entry already exists for this period")
)
