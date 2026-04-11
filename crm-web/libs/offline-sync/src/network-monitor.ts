/**
 * Network Monitor — detects connectivity state using multiple signals.
 *
 * Combines navigator.onLine, periodic heartbeat, and fetch error interception
 * to determine whether the server is reachable.
 *
 * Emits three states: online, degraded, offline.
 * State transitions require confirmation to avoid flapping.
 */

export type ConnectivityState = 'online' | 'degraded' | 'offline';

export interface NetworkMonitorOptions {
  /** URL to ping for heartbeat checks. */
  healthEndpoint: string;
  /** Interval between heartbeat pings in ms. Default: 30000 (30s). */
  heartbeatIntervalMs?: number;
  /** RTT threshold above which state is "degraded" in ms. Default: 5000. */
  degradedThresholdMs?: number;
  /** Consecutive failures required to transition to offline. Default: 3. */
  failuresToOffline?: number;
  /** Consecutive successes required to transition to online. Default: 2. */
  successesToOnline?: number;
}

type Listener = (state: ConnectivityState) => void;

export class NetworkMonitor {
  private state: ConnectivityState = 'online';
  private listeners: Set<Listener> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;

  private readonly healthEndpoint: string;
  private readonly heartbeatIntervalMs: number;
  private readonly degradedThresholdMs: number;
  private readonly failuresToOffline: number;
  private readonly successesToOnline: number;

  private boundOnOnline: () => void;
  private boundOnOffline: () => void;

  constructor(options: NetworkMonitorOptions) {
    this.healthEndpoint = options.healthEndpoint;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.degradedThresholdMs = options.degradedThresholdMs ?? 5_000;
    this.failuresToOffline = options.failuresToOffline ?? 3;
    this.successesToOnline = options.successesToOnline ?? 2;

    this.boundOnOnline = () => this.onBrowserOnline();
    this.boundOnOffline = () => this.onBrowserOffline();
  }

  getState(): ConnectivityState {
    return this.state;
  }

  isOnline(): boolean {
    return this.state === 'online';
  }

  isOffline(): boolean {
    return this.state === 'offline';
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    // Listen to browser online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.boundOnOnline);
      window.addEventListener('offline', this.boundOnOffline);
    }

    // Initial state from navigator
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.transition('offline');
    }

    // Start periodic heartbeat
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);

    // Run an immediate heartbeat
    this.heartbeat();
  }

  stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.boundOnOnline);
      window.removeEventListener('offline', this.boundOnOffline);
    }

    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Called by the application layer when a fetch request fails due to a
   * network error. This provides real-time signal from actual API calls.
   */
  reportFetchError(): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.failuresToOffline) {
      this.transition('offline');
    }
  }

  /**
   * Called by the application layer when a fetch request succeeds.
   */
  reportFetchSuccess(rttMs: number): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;

    if (this.state === 'offline' && this.consecutiveSuccesses >= this.successesToOnline) {
      this.transition(rttMs > this.degradedThresholdMs ? 'degraded' : 'online');
    } else if (this.state === 'online' && rttMs > this.degradedThresholdMs) {
      this.transition('degraded');
    } else if (this.state === 'degraded' && rttMs <= this.degradedThresholdMs) {
      this.transition('online');
    }
  }

  private async heartbeat(): Promise<void> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(this.healthEndpoint, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const rttMs = Date.now() - start;

      if (response.ok) {
        this.reportFetchSuccess(rttMs);
      } else {
        this.reportFetchError();
      }
    } catch {
      this.reportFetchError();
    }
  }

  private onBrowserOnline(): void {
    // Browser says we're online — run an immediate heartbeat to confirm
    this.heartbeat();
  }

  private onBrowserOffline(): void {
    // Browser says we're offline — transition immediately
    this.consecutiveFailures = this.failuresToOffline;
    this.consecutiveSuccesses = 0;
    this.transition('offline');
  }

  private transition(newState: ConnectivityState): void {
    if (newState === this.state) return;

    const previousState = this.state;
    this.state = newState;

    for (const listener of this.listeners) {
      try {
        listener(newState);
      } catch (err) {
        console.error('[NetworkMonitor] Listener error during transition', previousState, '->', newState, err);
      }
    }
  }
}
