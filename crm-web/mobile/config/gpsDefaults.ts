import { GpsTrackingConfig } from '../services/gps/types';

/**
 * Default GPS tracking configuration.
 *
 * These defaults can be overridden per-tenant via the remote config endpoint
 * (GET /api/v1/location-tracking/config). The mobile client fetches the
 * config on startup and merges it over these defaults.
 */
export const GPS_DEFAULTS: Readonly<GpsTrackingConfig> = {
  enabled: true,
  mode: 'balanced',
  intervalMs: 10_000, // 10 seconds
  distanceFilterMeters: 10,
  batchUploadIntervalMs: 60_000, // 1 minute
  maxBatchSize: 100,
  backgroundTrackingEnabled: true,
  activeHours: { start: 6, end: 22 }, // 6 AM - 10 PM
  activeDays: [1, 2, 3, 4, 5], // Mon-Fri
};

/** Android foreground service notification config. */
export const FOREGROUND_NOTIFICATION = {
  channelId: 'crm-location-tracking',
  channelName: 'Location Tracking',
  title: 'CRM Location Tracking',
  body: 'Tracking your location for field activity logging.',
  smallIcon: 'ic_location_on',
  priority: 'low' as const,
};

/** Retry policy for batch uploads that fail due to network errors. */
export const UPLOAD_RETRY = {
  maxRetries: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
};

/** SQLite table used for offline location buffering. */
export const LOCAL_BUFFER_TABLE = 'pending_location_updates';
