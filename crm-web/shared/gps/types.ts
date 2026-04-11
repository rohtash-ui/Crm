/**
 * Location tracking types shared across web and mobile GPS subsystems.
 */

export interface GpsCoordinate {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number; // meters
  altitudeAccuracy: number | null;
  heading: number | null; // degrees from north
  speed: number | null; // m/s
  timestamp: number; // unix ms
}

export interface LocationUpdate {
  tenantId: string;
  userId: string;
  deviceId: string;
  coordinate: GpsCoordinate;
  batteryLevel: number | null;
  networkType: 'wifi' | 'cellular' | 'none';
  isMoving: boolean;
  activityType: 'stationary' | 'walking' | 'driving' | 'unknown';
}

export interface LocationBatch {
  updates: LocationUpdate[];
  batchId: string;
  sentAt: number;
}

export type TrackingMode = 'high_accuracy' | 'balanced' | 'low_power';

export interface GpsTrackingConfig {
  /** Whether tracking is enabled globally for this tenant. */
  enabled: boolean;
  /** Tracking mode controls accuracy vs battery trade-off. */
  mode: TrackingMode;
  /** Minimum interval between location updates in milliseconds. */
  intervalMs: number;
  /** Minimum distance change to trigger an update, in meters. */
  distanceFilterMeters: number;
  /** How often to flush the local buffer to the server, in milliseconds. */
  batchUploadIntervalMs: number;
  /** Maximum number of updates to hold locally before force-flushing. */
  maxBatchSize: number;
  /** Whether to continue tracking when the app is in the background. */
  backgroundTrackingEnabled: boolean;
  /** Hours of the day during which tracking is active [start, end) in 24h. */
  activeHours: { start: number; end: number } | null;
  /** Days of week tracking is active (0=Sun, 6=Sat). null = every day. */
  activeDays: number[] | null;
}

export interface GpsServiceState {
  isTracking: boolean;
  lastCoordinate: GpsCoordinate | null;
  pendingUpdates: number;
  lastUploadAt: number | null;
  errorMessage: string | null;
}

/**
 * Platform-agnostic interface for buffering location updates locally.
 * Mobile implements this with SQLite; web implements it with IndexedDB.
 */
export interface LocationBuffer {
  initialize(): Promise<void>;
  push(update: LocationUpdate): Promise<void>;
  pushMany(updates: LocationUpdate[]): Promise<void>;
  drain(limit: number): Promise<LocationUpdate[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
  pruneOlderThan(maxAgeMs: number): Promise<number>;
}
