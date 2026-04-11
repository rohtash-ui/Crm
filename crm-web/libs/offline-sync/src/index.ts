/**
 * CRM Offline Sync Library
 *
 * Provides offline-first data access for the CRM web client.
 *
 * Usage:
 *   import { OfflineSyncManager } from '@crm/offline-sync';
 *
 *   const manager = new OfflineSyncManager({
 *     tenantId: 'tenant-123',
 *     userId: 'user-456',
 *     apiBaseUrl: '/api/v1',
 *     healthEndpoint: '/api/health',
 *   });
 *
 *   await manager.initialize();
 *
 *   // Write a contact — goes to server if online, outbox if offline
 *   await manager.write('contact', 'uuid-abc', 'update', { phone: '+1-555-0123' }, 42);
 *
 *   // Read from local cache
 *   const contact = await manager.read('contact', 'uuid-abc');
 */

export { OfflineStore } from './offline-store';
export type { EntityRecord, ChangeEntry, ConflictRecord, SyncMetadata } from './offline-store';

export { NetworkMonitor } from './network-monitor';
export type { ConnectivityState, NetworkMonitorOptions } from './network-monitor';

export { SyncEngine } from './sync-engine';
export type {
  SyncApiClient,
  SyncRequest,
  SyncChange,
  SyncResponse,
  SyncResult,
  ServerEntity,
  SyncEngineOptions,
} from './sync-engine';

import { OfflineStore, ConflictRecord, EntityRecord } from './offline-store';
import { NetworkMonitor, ConnectivityState } from './network-monitor';
import { SyncEngine, SyncApiClient, SyncRequest, SyncResponse } from './sync-engine';

export interface OfflineSyncManagerOptions {
  tenantId: string;
  userId: string;
  apiBaseUrl: string;
  healthEndpoint: string;
  /** Called when connectivity state changes. */
  onConnectivityChange?: (state: ConnectivityState) => void;
  /** Called when conflicts are detected. */
  onConflict?: (conflicts: ConflictRecord[]) => void;
  /** Called when the outbox pending count changes. */
  onOutboxChange?: (count: number) => void;
  /** Called when a sync cycle completes. */
  onSyncComplete?: (result: { applied: number; conflicts: number; failed: number }) => void;
}

export class OfflineSyncManager {
  private store: OfflineStore;
  private networkMonitor: NetworkMonitor;
  private syncEngine: SyncEngine;
  private swRegistration: ServiceWorkerRegistration | null = null;

  constructor(options: OfflineSyncManagerOptions) {
    this.store = new OfflineStore(options.tenantId, options.userId);

    this.networkMonitor = new NetworkMonitor({
      healthEndpoint: options.healthEndpoint,
    });

    const apiClient = new HttpSyncApiClient(options.apiBaseUrl);

    this.syncEngine = new SyncEngine({
      store: this.store,
      networkMonitor: this.networkMonitor,
      apiClient,
      tenantId: options.tenantId,
      userId: options.userId,
      onConflict: options.onConflict,
      onOutboxChange: options.onOutboxChange,
      onConnectivityChange: options.onConnectivityChange,
      onSyncComplete: options.onSyncComplete,
    });
  }

  async initialize(): Promise<void> {
    await this.syncEngine.start();
    this.networkMonitor.start();
    await this.registerServiceWorker();
    this.listenForServiceWorkerMessages();
  }

  async destroy(): Promise<void> {
    this.networkMonitor.stop();
    this.syncEngine.stop();
    this.store.close();
  }

  /** Write an entity — routed to server (online) or outbox (offline). */
  async write(
    entityType: string,
    entityId: string,
    action: 'create' | 'update' | 'delete',
    payload: Record<string, unknown>,
    baseVersion: number,
  ): Promise<{ queued: boolean }> {
    return this.syncEngine.write(entityType, entityId, action, payload, baseVersion);
  }

  /** Read an entity from local cache. */
  async read(entityType: string, entityId: string): Promise<EntityRecord | undefined> {
    return this.syncEngine.read(entityType, entityId);
  }

  /** Read all entities of a type from local cache. */
  async readAll(entityType: string): Promise<EntityRecord[]> {
    return this.syncEngine.readAll(entityType);
  }

  /** Get all unresolved conflicts. */
  async getConflicts(): Promise<ConflictRecord[]> {
    return this.syncEngine.getConflicts();
  }

  /** Resolve a conflict. */
  async resolveConflict(
    entityType: string,
    entityId: string,
    resolution: 'local' | 'server' | 'merged',
    mergedData?: Record<string, unknown>,
  ): Promise<void> {
    return this.syncEngine.resolveConflict(entityType, entityId, resolution, mergedData);
  }

  /** Force an immediate sync. */
  async forceSync(): Promise<void> {
    return this.syncEngine.forceSync();
  }

  /** Pull latest updates from server without pushing local changes. */
  async pullUpdates(): Promise<void> {
    return this.syncEngine.pullUpdates();
  }

  /** Get current connectivity state. */
  getConnectivityState(): ConnectivityState {
    return this.networkMonitor.getState();
  }

  /** Get outbox pending count. */
  async getOutboxCount(): Promise<number> {
    return this.store.getOutboxCount();
  }

  /** Wipe all local data (call on logout). */
  async wipeLocalData(): Promise<void> {
    this.syncEngine.stop();
    await this.store.wipe();
    // Clear service worker caches
    this.swRegistration?.active?.postMessage({ type: 'CLEAR_ALL_CACHES' });
  }

  private async registerServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;

    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.warn('[OfflineSyncManager] Service worker registration failed:', err);
    }
  }

  private listenForServiceWorkerMessages(): void {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'TRIGGER_SYNC') {
        this.syncEngine.forceSync();
      }
    });
  }
}

/**
 * HTTP implementation of the SyncApiClient interface.
 */
class HttpSyncApiClient implements SyncApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async postSync(request: SyncRequest): Promise<SyncResponse> {
    const response = await fetch(`${this.baseUrl}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Sync request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async fetchUpdates(syncCursor: string): Promise<SyncResponse> {
    const params = new URLSearchParams({ cursor: syncCursor });
    const response = await fetch(`${this.baseUrl}/sync/updates?${params}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Fetch updates failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}
