package domain

import "time"

// Event types published to Kafka topic crm.lead.*
const (
	EventLeadCreated    = "crm.lead.created.v1"
	EventLeadAssigned   = "crm.lead.assigned.v1"
	EventLeadReassigned = "crm.lead.reassigned.v1"
)

// LeadEvent is published to the event backbone when a lead changes.
type LeadEvent struct {
	Type      string    `json:"type"`
	TenantID  string    `json:"tenant_id"`
	LeadID    string    `json:"lead_id"`
	Payload   any       `json:"payload"`
	Timestamp time.Time `json:"timestamp"`
}

// LeadAssignedPayload carries assignment details in the event.
type LeadAssignedPayload struct {
	AssignedTo       string           `json:"assigned_to"`
	AssignedBy       string           `json:"assigned_by"`
	AssignedFrom     string           `json:"assigned_from,omitempty"`
	AssignmentMethod AssignmentMethod `json:"assignment_method"`
	RuleID           string           `json:"rule_id,omitempty"`
	ProjectID        string           `json:"project_id,omitempty"`
	LocationID       string           `json:"location_id,omitempty"`
	RegionID         string           `json:"region_id,omitempty"`
}

// EventPublisher sends domain events to the event backbone.
type EventPublisher interface {
	Publish(event LeadEvent) error
}
