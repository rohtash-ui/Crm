import { GpsTrackingConfig } from './types';

/**
 * Default GPS tracking configuration.
 *
 * These defaults can be overridden per-tenant via the remote config endpoint
 * (GET /api/v1/location-tracking/config). Both web and mobile clients fetch
 * the config on startup and merge it over these defaults.
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

/** Retry policy for batch uploads that fail due to network errors. */
export const UPLOAD_RETRY = {
  maxRetries: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
};

/** IndexedDB database name for web GPS buffer. */
export const WEB_IDB_NAME = 'crm-location-buffer';
export const WEB_IDB_STORE = 'pending_updates';

/** SQLite table used for mobile offline location buffering. */
export const MOBILE_SQLITE_TABLE = 'pending_location_updates';

/** Android foreground service notification config (mobile-only). */
export const FOREGROUND_NOTIFICATION = {
  channelId: 'crm-location-tracking',
  channelName: 'Location Tracking',
  title: 'CRM Location Tracking',
  body: 'Tracking your location for field activity logging.',
  smallIcon: 'ic_location_on',
  priority: 'low' as const,
};
