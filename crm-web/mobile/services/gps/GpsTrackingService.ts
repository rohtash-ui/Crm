import {
  GpsCoordinate,
  GpsServiceState,
  GpsTrackingConfig,
  LocationBatch,
  LocationBuffer,
  LocationUpdate,
  TrackingMode,
} from '../../../shared/gps/types';
import { LocationUploadService } from '../../../shared/gps/LocationUploadService';
import { GPS_DEFAULTS } from '../../../shared/gps/config';

type StateListener = (state: GpsServiceState) => void;

/**
 * Core GPS tracking service — owns the full lifecycle of continuous location
 * fetching on the mobile client.
 *
 * Responsibilities:
 *  1. Start/stop the native location provider (foreground + background).
 *  2. Apply scheduling rules (active hours, active days, distance filter).
 *  3. Buffer updates locally (SQLite) for offline resilience.
 *  4. Flush buffered updates to the backend in batches.
 *  5. Expose reactive state so the UI can show tracking status.
 *
 * This service is designed as a singleton initialised at app launch.
 */
export class GpsTrackingService {
  private config: GpsTrackingConfig;
  private state: GpsServiceState;
  private listeners: Set<StateListener> = new Set();

  private watchId: number | null = null;
  private uploadTimerId: ReturnType<typeof setInterval> | null = null;
  private activeHoursTimerId: ReturnType<typeof setInterval> | null = null;

  // Use the LocationBuffer interface so the concrete storage (SQLite, IndexedDB,
  // in-memory) is not coupled to this service.
  private readonly buffer: LocationBuffer;
  private readonly uploader: LocationUploadService;
  private readonly tenantId: string;
  private readonly userId: string;
  private readonly deviceId: string;

  constructor(deps: {
    tenantId: string;
    userId: string;
    deviceId: string;
    buffer: LocationBuffer;
    uploader: LocationUploadService;
    initialConfig?: Partial<GpsTrackingConfig>;
  }) {
    this.tenantId = deps.tenantId;
    this.userId = deps.userId;
    this.deviceId = deps.deviceId;
    this.buffer = deps.buffer;
    this.uploader = deps.uploader;
    this.config = { ...GPS_DEFAULTS, ...deps.initialConfig };

    this.state = {
      isTracking: false,
      lastCoordinate: null,
      pendingUpdates: 0,
      lastUploadAt: null,
      errorMessage: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Start continuous GPS fetching. Idempotent — safe to call multiple times. */
  async start(): Promise<void> {
    if (this.state.isTracking) return;
    if (!this.config.enabled) {
      this.updateState({ errorMessage: 'GPS tracking is disabled by tenant config' });
      return;
    }

    const hasPermission = await this.ensurePermissions();
    if (!hasPermission) {
      this.updateState({ errorMessage: 'Location permission not granted' });
      return;
    }

    this.startWatching();
    this.startBatchUploadTimer();
    this.startActiveHoursEnforcement();
    this.updateState({ isTracking: true, errorMessage: null });
  }

  /** Stop all GPS tracking and flush any remaining buffered updates. */
  async stop(): Promise<void> {
    if (!this.state.isTracking) return;

    this.stopWatching();
    this.stopBatchUploadTimer();
    this.stopActiveHoursEnforcement();

    // Flush whatever is buffered before going quiet.
    await this.flushBuffer();

    this.updateState({ isTracking: false });
  }

  /** Update the tracking config at runtime (e.g. from remote config push). */
  applyConfig(patch: Partial<GpsTrackingConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...patch };

    // React to enable/disable toggle.
    if (wasEnabled && !this.config.enabled) {
      this.stop();
    } else if (!wasEnabled && this.config.enabled) {
      this.start();
    }

    // Use 'in' operator so falsy-but-valid values (e.g. 0) still trigger a restart.
    const watcherAffected =
      'intervalMs' in patch || 'distanceFilterMeters' in patch || 'mode' in patch;
    if (this.state.isTracking && watcherAffected) {
      this.stopWatching();
      this.startWatching();
    }

    if (this.state.isTracking && 'batchUploadIntervalMs' in patch) {
      this.stopBatchUploadTimer();
      this.startBatchUploadTimer();
    }
  }

  /** Get a snapshot of the current service state. */
  getState(): Readonly<GpsServiceState> {
    return { ...this.state };
  }

  /** Get a copy of the current tracking config. Used by BackgroundLocationService. */
  getConfig(): GpsTrackingConfig {
    return { ...this.config };
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Force an immediate flush of buffered updates to the server. */
  async flushBuffer(): Promise<void> {
    const updates = await this.buffer.drain(this.config.maxBatchSize);
    if (updates.length === 0) return;

    const batch: LocationBatch = {
      updates,
      batchId: generateBatchId(),
      sentAt: Date.now(),
    };

    await this.uploader.upload(batch);
    this.updateState({
      lastUploadAt: Date.now(),
      pendingUpdates: await this.buffer.count(),
    });
  }

  /**
   * Public entry point for background-service position updates.
   * Called by the BackgroundLocationService callback so it doesn't need to
   * access private members.
   */
  async handleCoordinate(coordinate: GpsCoordinate): Promise<void> {
    if (!this.state.isTracking || !this.isWithinActiveWindow()) return;

    // Distance filter.
    if (this.state.lastCoordinate && !this.exceedsDistanceFilter(coordinate)) {
      return;
    }

    const update: LocationUpdate = {
      tenantId: this.tenantId,
      userId: this.userId,
      deviceId: this.deviceId,
      coordinate,
      batteryLevel: await getBatteryLevel(),
      networkType: getNetworkType(),
      isMoving: (coordinate.speed ?? 0) > 0.5,
      activityType: classifyActivity(coordinate.speed),
    };

    await this.buffer.push(update);

    this.updateState({
      lastCoordinate: coordinate,
      pendingUpdates: await this.buffer.count(),
      errorMessage: null,
    });

    const pending = await this.buffer.count();
    if (pending >= this.config.maxBatchSize) {
      this.flushBuffer().catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Native location provider
  // ---------------------------------------------------------------------------

  private startWatching(): void {
    const options = this.buildWatchOptions();

    // Use the React Native Geolocation API (or a polyfill like
    // react-native-geolocation-service / expo-location).
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.handleGeolocationPosition(position).catch((err) => {
          this.updateState({ errorMessage: `GPS update error: ${err.message}` });
        });
      },
      (error) => this.onPositionError(error),
      options,
    );
  }

  private stopWatching(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private buildWatchOptions(): PositionOptions {
    const accuracyMap: Record<TrackingMode, boolean> = {
      high_accuracy: true,
      balanced: true,
      low_power: false,
    };
    return {
      enableHighAccuracy: accuracyMap[this.config.mode],
      timeout: 30_000,
      maximumAge: this.config.intervalMs,
    };
  }

  // ---------------------------------------------------------------------------
  // Position callbacks
  // ---------------------------------------------------------------------------

  /** Convert a native GeolocationPosition to GpsCoordinate and delegate. */
  private async handleGeolocationPosition(position: GeolocationPosition): Promise<void> {
    const coordinate: GpsCoordinate = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      altitude: position.coords.altitude,
      accuracy: position.coords.accuracy,
      altitudeAccuracy: position.coords.altitudeAccuracy,
      heading: position.coords.heading,
      speed: position.coords.speed,
      timestamp: position.timestamp,
    };
    await this.handleCoordinate(coordinate);
  }

  private onPositionError(error: GeolocationPositionError): void {
    this.updateState({ errorMessage: `GPS error (${error.code}): ${error.message}` });
  }

  // ---------------------------------------------------------------------------
  // Batch upload timer
  // ---------------------------------------------------------------------------

  private startBatchUploadTimer(): void {
    this.uploadTimerId = setInterval(
      () => this.flushBuffer().catch(() => {}),
      this.config.batchUploadIntervalMs,
    );
  }

  private stopBatchUploadTimer(): void {
    if (this.uploadTimerId !== null) {
      clearInterval(this.uploadTimerId);
      this.uploadTimerId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Active hours enforcement
  // ---------------------------------------------------------------------------

  private startActiveHoursEnforcement(): void {
    // Check every minute whether we're inside the active window.
    this.activeHoursTimerId = setInterval(() => {
      if (!this.isWithinActiveWindow()) {
        this.stopWatching();
      } else if (this.watchId === null && this.state.isTracking) {
        this.startWatching();
      }
    }, 60_000);
  }

  private stopActiveHoursEnforcement(): void {
    if (this.activeHoursTimerId !== null) {
      clearInterval(this.activeHoursTimerId);
      this.activeHoursTimerId = null;
    }
  }

  private isWithinActiveWindow(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    if (this.config.activeHours) {
      const { start, end } = this.config.activeHours;
      if (hour < start || hour >= end) return false;
    }
    if (this.config.activeDays) {
      if (!this.config.activeDays.includes(day)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  private async ensurePermissions(): Promise<boolean> {
    // Delegate to the platform-specific permission API.
    // On React Native this would use PermissionsAndroid / expo-location.
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      if (result.state === 'granted') return true;
      if (result.state === 'prompt') {
        // Trigger the native prompt by requesting a single position.
        return new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            () => resolve(false),
            { timeout: 10_000 },
          );
        });
      }
      return false;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private exceedsDistanceFilter(next: GpsCoordinate): boolean {
    const prev = this.state.lastCoordinate!;
    const distance = haversineMeters(
      prev.latitude,
      prev.longitude,
      next.latitude,
      next.longitude,
    );
    return distance >= this.config.distanceFilterMeters;
  }

  private updateState(patch: Partial<GpsServiceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Never let a bad listener kill the service.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateBatchId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function classifyActivity(speed: number | null): LocationUpdate['activityType'] {
  if (speed === null) return 'unknown';
  if (speed < 0.5) return 'stationary';
  if (speed < 2.0) return 'walking';
  return 'driving';
}

async function getBatteryLevel(): Promise<number | null> {
  try {
    const battery = await (navigator as any).getBattery?.();
    return battery?.level ?? null;
  } catch {
    return null;
  }
}

function getNetworkType(): LocationUpdate['networkType'] {
  const conn = (navigator as any).connection;
  if (!conn) return 'cellular'; // safe fallback for mobile
  if (conn.type === 'wifi') return 'wifi';
  if (conn.type === 'cellular') return 'cellular';
  if (conn.type === 'none') return 'none';
  return 'cellular';
}
