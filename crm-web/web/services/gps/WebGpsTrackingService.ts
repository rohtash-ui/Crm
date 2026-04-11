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
 * Web-specific GPS tracking service for Chrome and Safari.
 *
 * Uses the W3C Geolocation API (navigator.geolocation.watchPosition) which is
 * supported by all modern browsers. This service is the browser counterpart of
 * the mobile GpsTrackingService.
 *
 * Key differences from mobile:
 *  - Buffer uses IndexedDB instead of SQLite.
 *  - No true background tracking: the browser suspends JS when the tab is hidden
 *    in some cases. We use visibilitychange to detect this and flush eagerly.
 *  - Uses navigator.sendBeacon() as a last-resort flush on page unload.
 *  - Generates a browser-session device ID instead of a native device ID.
 *  - No foreground service or native background watcher.
 *
 * Browser support:
 *  - Chrome 50+  (Geolocation + IndexedDB + sendBeacon)
 *  - Safari 11+  (Geolocation + IndexedDB + sendBeacon)
 *  - Firefox 44+ (Geolocation + IndexedDB + sendBeacon)
 *  - Edge 14+    (Geolocation + IndexedDB + sendBeacon)
 *
 * Note: Geolocation requires HTTPS in all modern browsers (except localhost).
 */
export class WebGpsTrackingService {
  private config: GpsTrackingConfig;
  private state: GpsServiceState;
  private listeners: Set<StateListener> = new Set();

  private watchId: number | null = null;
  private uploadTimerId: ReturnType<typeof setInterval> | null = null;
  private activeHoursTimerId: ReturnType<typeof setInterval> | null = null;

  private readonly buffer: LocationBuffer;
  private readonly uploader: LocationUploadService;
  private readonly tenantId: string;
  private readonly userId: string;
  private readonly deviceId: string;

  // Cached auth token for sendBeacon (can't do async in beforeunload).
  private lastAuthToken: string | null = null;
  private readonly getAuthToken: () => Promise<string>;

  // Bound event handlers (so we can remove them later).
  private readonly handleVisibilityChange: () => void;
  private readonly handleBeforeUnload: () => void;
  private readonly handleOnline: () => void;

  constructor(deps: {
    tenantId: string;
    userId: string;
    deviceId: string;
    buffer: LocationBuffer;
    uploader: LocationUploadService;
    getAuthToken: () => Promise<string>;
    initialConfig?: Partial<GpsTrackingConfig>;
  }) {
    this.tenantId = deps.tenantId;
    this.userId = deps.userId;
    this.deviceId = deps.deviceId;
    this.buffer = deps.buffer;
    this.uploader = deps.uploader;
    this.getAuthToken = deps.getAuthToken;
    this.config = { ...GPS_DEFAULTS, ...deps.initialConfig };

    this.state = {
      isTracking: false,
      lastCoordinate: null,
      pendingUpdates: 0,
      lastUploadAt: null,
      errorMessage: null,
    };

    // Bind lifecycle handlers.
    this.handleVisibilityChange = this.onVisibilityChange.bind(this);
    this.handleBeforeUnload = this.onBeforeUnload.bind(this);
    this.handleOnline = this.onOnline.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Start continuous GPS fetching. Idempotent. */
  async start(): Promise<void> {
    if (this.state.isTracking) return;
    if (!this.config.enabled) {
      this.updateState({ errorMessage: 'GPS tracking is disabled by tenant config' });
      return;
    }

    if (!this.isBrowserSupported()) {
      this.updateState({ errorMessage: 'Geolocation API not available in this browser' });
      return;
    }

    const hasPermission = await this.ensurePermissions();
    if (!hasPermission) {
      this.updateState({ errorMessage: 'Location permission not granted' });
      return;
    }

    // Pre-fetch auth token so sendBeacon has one ready.
    this.refreshAuthToken();

    this.startWatching();
    this.startBatchUploadTimer();
    this.startActiveHoursEnforcement();
    this.registerBrowserLifecycleListeners();
    this.updateState({ isTracking: true, errorMessage: null });
  }

  /** Stop all GPS tracking and flush remaining buffered updates. */
  async stop(): Promise<void> {
    if (!this.state.isTracking) return;

    this.stopWatching();
    this.stopBatchUploadTimer();
    this.stopActiveHoursEnforcement();
    this.unregisterBrowserLifecycleListeners();

    await this.flushBuffer();

    this.updateState({ isTracking: false });
  }

  /** Update tracking config at runtime (e.g. from remote config push). */
  applyConfig(patch: Partial<GpsTrackingConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...patch };

    if (wasEnabled && !this.config.enabled) {
      this.stop();
    } else if (!wasEnabled && this.config.enabled) {
      this.start();
    }

    if (this.state.isTracking && (patch.intervalMs || patch.distanceFilterMeters || patch.mode)) {
      this.stopWatching();
      this.startWatching();
    }

    if (this.state.isTracking && patch.batchUploadIntervalMs) {
      this.stopBatchUploadTimer();
      this.startBatchUploadTimer();
    }
  }

  /** Get a snapshot of the current service state. */
  getState(): Readonly<GpsServiceState> {
    return { ...this.state };
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

  // ---------------------------------------------------------------------------
  // Browser Geolocation API
  // ---------------------------------------------------------------------------

  private startWatching(): void {
    const options = this.buildWatchOptions();

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.onPositionUpdate(position),
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

  private async onPositionUpdate(position: GeolocationPosition): Promise<void> {
    if (!this.isWithinActiveWindow()) return;

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

    // Eagerly flush if buffer is full.
    const pending = await this.buffer.count();
    if (pending >= this.config.maxBatchSize) {
      this.flushBuffer().catch(() => {});
    }
  }

  private onPositionError(error: GeolocationPositionError): void {
    const messages: Record<number, string> = {
      1: 'Location permission denied by user',
      2: 'Position unavailable (GPS/network error)',
      3: 'Location request timed out',
    };
    this.updateState({
      errorMessage: messages[error.code] ?? `GPS error (${error.code}): ${error.message}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Browser lifecycle: visibility, unload, online/offline
  // ---------------------------------------------------------------------------

  private registerBrowserLifecycleListeners(): void {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    window.addEventListener('online', this.handleOnline);
  }

  private unregisterBrowserLifecycleListeners(): void {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    window.removeEventListener('online', this.handleOnline);
  }

  /**
   * Handle tab visibility changes.
   *
   * When the tab goes hidden (user switches tabs or minimizes):
   *  - Flush the buffer immediately, since Chrome/Safari may throttle
   *    timers to 1/min or suspend JS entirely for background tabs.
   *
   * When the tab becomes visible again:
   *  - Restart the watcher if it was paused by active-hours enforcement.
   *  - Refresh the auth token.
   */
  private onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.flushBuffer().catch(() => {});
    } else if (document.visibilityState === 'visible') {
      this.refreshAuthToken();
      // Restart watcher if it was stopped by active-hours and we're back in window.
      if (this.watchId === null && this.state.isTracking && this.isWithinActiveWindow()) {
        this.startWatching();
      }
    }
  }

  /**
   * Handle page unload (tab close, navigation away, browser close).
   *
   * Uses navigator.sendBeacon() for a best-effort flush. sendBeacon is
   * fire-and-forget and works even as the page is being torn down — the
   * browser guarantees delivery attempt after the JS context is gone.
   *
   * This is critical because regular fetch() calls are cancelled on unload.
   */
  private onBeforeUnload(): void {
    // Synchronously read whatever we can from the buffer.
    // IndexedDB is async, so we can only send what we've already drained.
    // The upload timer should have flushed recently. For any remaining
    // updates still in IndexedDB, they'll survive the page reload (IndexedDB
    // persists) and be picked up on the next session start.
    if (this.lastAuthToken && this.state.lastCoordinate) {
      // Send the last known position as a single-point beacon.
      const lastUpdate: LocationUpdate = {
        tenantId: this.tenantId,
        userId: this.userId,
        deviceId: this.deviceId,
        coordinate: this.state.lastCoordinate,
        batteryLevel: null,
        networkType: getNetworkType(),
        isMoving: false,
        activityType: 'unknown',
      };

      const batch: LocationBatch = {
        updates: [lastUpdate],
        batchId: `beacon-${Date.now()}`,
        sentAt: Date.now(),
      };

      this.uploader.sendBeacon(batch, this.lastAuthToken);
    }
  }

  /**
   * Handle coming back online after being offline.
   * Trigger an immediate flush to upload any buffered updates.
   */
  private onOnline(): void {
    if (this.state.isTracking) {
      this.flushBuffer().catch(() => {});
    }
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

  /**
   * Ensure geolocation permission is granted.
   *
   * Chrome: navigator.permissions.query() works, then watchPosition triggers
   *         the prompt if state is 'prompt'.
   * Safari: navigator.permissions is not fully supported in older versions,
   *         so we fall back to a getCurrentPosition() call which triggers
   *         the native permission dialog.
   */
  private async ensurePermissions(): Promise<boolean> {
    try {
      // Try the Permissions API first (Chrome, Firefox, Edge).
      if (navigator.permissions) {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        if (result.state === 'granted') return true;
        if (result.state === 'denied') return false;
        // 'prompt' — fall through to trigger the dialog.
      }
    } catch {
      // Safari may throw on permissions.query — fall through.
    }

    // Trigger the browser's permission dialog via getCurrentPosition.
    return new Promise<boolean>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        (err) => resolve(err.code !== 1), // code 1 = PERMISSION_DENIED
        { timeout: 15_000, enableHighAccuracy: false },
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isBrowserSupported(): boolean {
    return 'geolocation' in navigator && typeof indexedDB !== 'undefined';
  }

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

  private refreshAuthToken(): void {
    this.getAuthToken()
      .then((token) => { this.lastAuthToken = token; })
      .catch(() => {});
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
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateBatchId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function classifyActivity(speed: number | null): LocationUpdate['activityType'] {
  if (speed === null) return 'unknown';
  if (speed < 0.5) return 'stationary';
  if (speed < 2.0) return 'walking';
  if (speed >= 2.0) return 'driving';
  return 'unknown';
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
  if (!conn) return 'wifi'; // safe default for desktop browsers
  if (conn.type === 'wifi') return 'wifi';
  if (conn.type === 'cellular') return 'cellular';
  if (conn.type === 'none') return 'none';
  return 'wifi';
}
