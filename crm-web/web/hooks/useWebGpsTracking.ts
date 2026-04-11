import { useEffect, useRef, useState, useCallback } from 'react';
import { WebGpsTrackingService } from '../services/gps/WebGpsTrackingService';
import { IndexedDbBufferService } from '../services/gps/IndexedDbBufferService';
import { LocationUploadService } from '../../shared/gps/LocationUploadService';
import { GpsServiceState, GpsTrackingConfig } from '../../shared/gps/types';

interface UseWebGpsTrackingOptions {
  tenantId: string;
  userId: string;
  apiBaseUrl: string;
  getAuthToken: () => Promise<string>;
  configOverrides?: Partial<GpsTrackingConfig>;
  /** Start tracking immediately on mount. Defaults to true. */
  autoStart?: boolean;
}

/**
 * React hook that wires up continuous GPS tracking for the web CRM.
 *
 * Drop this into your root App or authenticated layout component so that
 * location is tracked for the entire browser session, across page navigations
 * (in an SPA), and survives tab hide/show cycles.
 *
 * Usage in Chrome or Safari:
 *
 *   function App() {
 *     const { state, start, stop } = useWebGpsTracking({
 *       tenantId: session.tenantId,
 *       userId: session.userId,
 *       apiBaseUrl: config.API_BASE_URL,
 *       getAuthToken: () => authService.getAccessToken(),
 *     });
 *
 *     return (
 *       <div>
 *         {state.isTracking && <LocationIndicator coords={state.lastCoordinate} />}
 *         <CrmRoutes />
 *       </div>
 *     );
 *   }
 *
 * What this hook does:
 *  1. Generates a stable browser-session device ID (persisted in sessionStorage).
 *  2. Initialises IndexedDB buffer + upload service + GPS tracking service.
 *  3. Starts tracking automatically (unless autoStart=false).
 *  4. Flushes pending updates when the tab becomes hidden (visibilitychange).
 *  5. Sends a best-effort beacon on page unload (beforeunload + sendBeacon).
 *  6. Drains any leftover updates from a previous session on startup.
 *  7. Cleans up everything on unmount.
 */
export function useWebGpsTracking(options: UseWebGpsTrackingOptions) {
  const {
    tenantId,
    userId,
    apiBaseUrl,
    getAuthToken,
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

  const serviceRef = useRef<WebGpsTrackingService | null>(null);
  const bufferRef = useRef<IndexedDbBufferService | null>(null);

  useEffect(() => {
    const deviceId = getOrCreateDeviceId();

    // --- Build the service graph ---
    const buffer = new IndexedDbBufferService();
    const uploader = new LocationUploadService({
      apiBaseUrl,
      getAuthToken,
      reEnqueue: (updates) => buffer.pushMany(updates),
    });

    const service = new WebGpsTrackingService({
      tenantId,
      userId,
      deviceId,
      buffer,
      uploader,
      getAuthToken,
      initialConfig: configOverrides,
    });

    serviceRef.current = service;
    bufferRef.current = buffer;

    // --- Subscribe to state changes ---
    const unsubscribe = service.subscribe(setState);

    // --- Initialise and start ---
    let mounted = true;

    async function init() {
      await buffer.initialize();

      // Drain any stale updates from a previous session (IndexedDB persists
      // across page reloads). Updates older than 24h are pruned.
      await buffer.pruneOlderThan(24 * 60 * 60 * 1000);

      // Report any leftover count from previous session.
      const leftover = await buffer.count();
      if (leftover > 0) {
        setState((prev) => ({ ...prev, pendingUpdates: leftover }));
      }

      if (mounted && autoStart) {
        await service.start();

        // If there were leftovers from a previous session, flush them now.
        if (leftover > 0 && service.getState().isTracking) {
          await service.flushBuffer();
        }
      }
    }

    init().catch((err) =>
      setState((prev) => ({
        ...prev,
        errorMessage: `Init failed: ${err.message}`,
      })),
    );

    // --- Cleanup on unmount ---
    return () => {
      mounted = false;
      unsubscribe();
      service.stop().catch(() => {});
      buffer.close();
      serviceRef.current = null;
      bufferRef.current = null;
    };
  }, [tenantId, userId, apiBaseUrl]); // re-init if identity changes

  const start = useCallback(() => serviceRef.current?.start(), []);
  const stop = useCallback(() => serviceRef.current?.stop(), []);
  const flush = useCallback(() => serviceRef.current?.flushBuffer(), []);
  const applyConfig = useCallback(
    (patch: Partial<GpsTrackingConfig>) => serviceRef.current?.applyConfig(patch),
    [],
  );

  return { state, start, stop, flush, applyConfig };
}

// ---------------------------------------------------------------------------
// Device ID management
// ---------------------------------------------------------------------------

const DEVICE_ID_KEY = 'crm-gps-device-id';

/**
 * Get or create a stable device ID for this browser session.
 *
 * Uses sessionStorage so the ID persists across page navigations within the
 * same tab, but a new ID is generated for each new tab/window. This matches
 * the semantic of "one tracking session per browser tab".
 *
 * For cross-session persistence (same browser, different days), use
 * localStorage instead — but sessionStorage is safer for privacy.
 */
function getOrCreateDeviceId(): string {
  let deviceId = sessionStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}
