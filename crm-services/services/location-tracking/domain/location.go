// Package domain contains the pure business logic for location tracking.
// It has no external dependencies — no DB, no HTTP, no framework imports.
package domain

import "time"

// LocationPoint represents a single GPS fix from a field user's device.
type LocationPoint struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	UserID    string    `json:"user_id"`
	DeviceID  string    `json:"device_id"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	Altitude  *float64  `json:"altitude,omitempty"`
	Accuracy  float64   `json:"accuracy"`
	Heading   *float64  `json:"heading,omitempty"`
	Speed     *float64  `json:"speed,omitempty"`
	Timestamp time.Time `json:"timestamp"`

	BatteryLevel *float64     `json:"battery_level,omitempty"`
	NetworkType  string       `json:"network_type"`
	IsMoving     bool         `json:"is_moving"`
	ActivityType ActivityType `json:"activity_type"`

	CreatedAt time.Time `json:"created_at"`
}

// ActivityType classifies the user's movement at the time of the GPS fix.
type ActivityType string

const (
	ActivityStationary ActivityType = "stationary"
	ActivityWalking    ActivityType = "walking"
	ActivityDriving    ActivityType = "driving"
	ActivityUnknown    ActivityType = "unknown"
)

// LocationBatch is a set of points uploaded by a device in a single request.
type LocationBatch struct {
	BatchID string          `json:"batch_id"`
	SentAt  time.Time       `json:"sent_at"`
	Points  []LocationPoint `json:"updates"`
}

// TrackingConfig holds per-tenant configuration for GPS tracking behaviour.
type TrackingConfig struct {
	TenantID                  string  `json:"tenant_id"`
	Enabled                   bool    `json:"enabled"`
	Mode                      string  `json:"mode"` // high_accuracy | balanced | low_power
	IntervalMs                int     `json:"interval_ms"`
	DistanceFilterMeters      float64 `json:"distance_filter_meters"`
	BatchUploadIntervalMs     int     `json:"batch_upload_interval_ms"`
	MaxBatchSize              int     `json:"max_batch_size"`
	BackgroundTrackingEnabled bool    `json:"background_tracking_enabled"`
	ActiveHoursStart          *int    `json:"active_hours_start,omitempty"`
	ActiveHoursEnd            *int    `json:"active_hours_end,omitempty"`
	ActiveDays                []int   `json:"active_days,omitempty"`
}

// LatestLocation is a lightweight projection: the most recent known position
// for a given user, kept in a Redis-backed cache for real-time queries.
type LatestLocation struct {
	TenantID  string    `json:"tenant_id"`
	UserID    string    `json:"user_id"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	Accuracy  float64   `json:"accuracy"`
	IsMoving  bool      `json:"is_moving"`
	UpdatedAt time.Time `json:"updated_at"`
}

// LocationQuery filters for listing historical location points.
type LocationQuery struct {
	TenantID string
	UserID   string
	From     time.Time
	To       time.Time
	Limit    int
	Offset   int
}
