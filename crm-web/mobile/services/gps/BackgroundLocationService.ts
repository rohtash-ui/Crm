import { GpsTrackingConfig, GpsCoordinate } from './types';
import { FOREGROUND_NOTIFICATION } from '../../config/gpsDefaults';

/**
 * Platform-specific background location service.
 *
 * This module wraps the native background-location APIs so the
 * GpsTrackingService can continue fetching GPS data when the app is
 * backgrounded or the screen is off.
 *
 * Android: Uses a foreground service with a persistent notification.
 * iOS:     Uses significant-change monitoring + background location mode.
 *
 * Integration:
 *   The GpsTrackingService calls BackgroundLocationService.start() when
 *   tracking begins and .stop() when it ends. The onUpdate callback is
 *   invoked with each new position, regardless of whether the app is in
 *   the foreground or background.
 *
 * Requirements:
 *   - Android: <service android:foregroundServiceType="location" />
 *   - iOS:     UIBackgroundModes = ["location"] in Info.plist
 *   - Both:    "always" location permission for background tracking.
 */

type OnUpdateCallback = (coordinate: GpsCoordinate) => void;

export class BackgroundLocationService {
  private isRunning = false;
  private onUpdate: OnUpdateCallback | null = null;

  /**
   * Start background location tracking.
   *
   * @param config  Current GPS tracking config.
   * @param onUpdate Callback fired for each new GPS fix.
   */
  async start(config: GpsTrackingConfig, onUpdate: OnUpdateCallback): Promise<void> {
    if (this.isRunning) return;

    this.onUpdate = onUpdate;

    // --- Android Foreground Service ---
    // In a real React Native app, this would call a native module:
    //
    //   import BackgroundGeolocation from 'react-native-background-geolocation';
    //
    //   BackgroundGeolocation.ready({
    //     desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
    //     distanceFilter: config.distanceFilterMeters,
    //     locationUpdateInterval: config.intervalMs,
    //     fastestLocationUpdateInterval: config.intervalMs / 2,
    //     stopOnTerminate: false,
    //     startOnBoot: true,
    //     foregroundService: true,
    //     notification: {
    //       channelId: FOREGROUND_NOTIFICATION.channelId,
    //       channelName: FOREGROUND_NOTIFICATION.channelName,
    //       title: FOREGROUND_NOTIFICATION.title,
    //       text: FOREGROUND_NOTIFICATION.body,
    //       smallIcon: FOREGROUND_NOTIFICATION.smallIcon,
    //       priority: BackgroundGeolocation.NOTIFICATION_PRIORITY_LOW,
    //     },
    //     enableHeadless: true,
    //   });
    //
    //   BackgroundGeolocation.onLocation((location) => {
    //     this.handleNativeUpdate(location);
    //   });
    //
    //   BackgroundGeolocation.start();

    // --- Stub for non-native environments (e.g. web preview) ---
    await this.startWebFallback(config);

    this.isRunning = true;
  }

  /** Stop background location tracking and tear down the foreground service. */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    // Native: BackgroundGeolocation.stop();
    // Native: BackgroundGeolocation.removeListeners();

    this.stopWebFallback();

    this.isRunning = false;
    this.onUpdate = null;
  }

  /** Whether the background service is currently active. */
  get running(): boolean {
    return this.isRunning;
  }

  // ---------------------------------------------------------------------------
  // Web fallback (for development / testing outside native shell)
  // ---------------------------------------------------------------------------

  private webWatchId: number | null = null;

  private async startWebFallback(config: GpsTrackingConfig): Promise<void> {
    if (!navigator.geolocation) return;

    this.webWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!this.onUpdate) return;
        this.onUpdate({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitude: pos.coords.altitude,
          accuracy: pos.coords.accuracy,
          altitudeAccuracy: pos.coords.altitudeAccuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
        });
      },
      () => {}, // errors handled by the main service
      {
        enableHighAccuracy: config.mode === 'high_accuracy',
        maximumAge: config.intervalMs,
        timeout: 30_000,
      },
    );
  }

  private stopWebFallback(): void {
    if (this.webWatchId !== null) {
      navigator.geolocation.clearWatch(this.webWatchId);
      this.webWatchId = null;
    }
  }
}
