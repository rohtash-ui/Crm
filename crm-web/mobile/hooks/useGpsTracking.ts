import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { GpsTrackingService } from '../services/gps/GpsTrackingService';
import { LocationBufferService } from '../services/gps/LocationBufferService';
import { LocationUploadService } from '../services/gps/LocationUploadService';
import { BackgroundLocationService } from '../services/gps/BackgroundLocationService';
import { GpsServiceState, GpsTrackingConfig } from '../services/gps/types';

interface UseGpsTrackingOptions {
  tenantId: string;
  userId: string;
  deviceId: string;
  apiBaseUrl: string;
  getAuthToken: () => Promise<string>;
  db: any; // SQLite database handle
  configOverrides?: Partial<GpsTrackingConfig>;
  /** Start tracking immediately on mount. Defaults to true. */
  autoStart?: boolean;
}

/**
 * React hook that wires up continuous GPS tracking for the lifetime of the
 * component that mounts it (typically the root App component).
 *
 * Usage:
 *
 *   const { state, start, stop } = useGpsTracking({
 *     tenantId: session.tenantId,
 *     userId: session.userId,
 *     deviceId: device.id,
 *     apiBaseUrl: config.API_BASE_URL,
 *     getAuthToken: () => authService.getAccessToken(),
 *     db: sqliteDb,
 *   });
 *
 * The hook:
 *  1. Initialises the GPS service singleton on first mount.
 *  2. Starts tracking automatically (unless autoStart=false).
 *  3. Pauses/resumes gracefully on app background/foreground transitions.
 *  4. Flushes pending updates when the app goes to background.
 *  5. Cleans up on unmount.
 */
export function useGpsTracking(options: UseGpsTrackingOptions) {
  const {
    tenantId,
    userId,
    deviceId,
    apiBaseUrl,
    getAuthToken,
    db,
    configOverrides,
    autoStart = true,
  } = options;

  const [state, setState] = useState<GpsServiceState>({
    isTracking: false,
    lastCoordinate: null,
    pendingUpdates: 0,
    lastUploadAt: null,
    errorMessage: null,
  });

  const serviceRef = useRef<GpsTrackingService | null>(null);
  const backgroundServiceRef = useRef<BackgroundLocationService | null>(null);

  useEffect(() => {
    // --- Build the service graph ---
    const buffer = new LocationBufferService(db);
    const uploader = new LocationUploadService({
      apiBaseUrl,
      getAuthToken,
      reEnqueue: (updates) => buffer.pushMany(updates),
    });

    const service = new GpsTrackingService({
      tenantId,
      userId,
      deviceId,
      buffer,
      uploader,
      initialConfig: configOverrides,
    });

    const backgroundService = new BackgroundLocationService();

    serviceRef.current = service;
    backgroundServiceRef.current = backgroundService;

    // --- Subscribe to state changes ---
    const unsubscribe = service.subscribe(setState);

    // --- Initialise and start ---
    let mounted = true;

    async function init() {
      await buffer.initialize();

      // Prune stale updates older than 24 hours.
      await buffer.pruneOlderThan(24 * 60 * 60 * 1000);

      if (mounted && autoStart) {
        await service.start();

        // Also start the background service so tracking continues
        // when the app is backgrounded.
        if (service.getState().isTracking) {
          await backgroundService.start(
            { ...service['config'] },
            (coord) => service['onPositionUpdate']({
              coords: coord as any,
              timestamp: coord.timestamp,
            } as any),
          );
        }
      }
    }

    init().catch((err) =>
      setState((prev) => ({
        ...prev,
        errorMessage: `Init failed: ${err.message}`,
      })),
    );

    // --- App state listener: flush on background, resume on foreground ---
    function handleAppState(nextState: AppStateStatus) {
      if (!serviceRef.current) return;

      if (nextState === 'background' || nextState === 'inactive') {
        // Flush pending updates before the OS may suspend us.
        serviceRef.current.flushBuffer().catch(() => {});
      }
      // Foreground resume is handled automatically by the watch — no action needed.
    }

    const appStateSubscription = AppState.addEventListener('change', handleAppState);

    // --- Cleanup ---
    return () => {
      mounted = false;
      unsubscribe();
      service.stop().catch(() => {});
      backgroundService.stop().catch(() => {});
      appStateSubscription.remove();
      serviceRef.current = null;
      backgroundServiceRef.current = null;
    };
  }, [tenantId, userId, deviceId, apiBaseUrl]); // re-init if identity changes

  return {
    state,
    start: () => serviceRef.current?.start(),
    stop: () => serviceRef.current?.stop(),
    flush: () => serviceRef.current?.flushBuffer(),
    applyConfig: (patch: Partial<GpsTrackingConfig>) =>
      serviceRef.current?.applyConfig(patch),
  };
}
