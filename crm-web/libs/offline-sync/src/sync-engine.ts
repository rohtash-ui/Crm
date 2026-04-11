/**
 * Sync Engine — orchestrates offline/online data flow.
 *
 * Online mode:  writes go directly to the server; responses update local cache.
 * Offline mode: writes go to the outbox; reads come from local cache.
 *
 * When connectivity is restored, the engine drains the outbox in FIFO order,
 * handles conflicts, and fetches server-side updates via the sync cursor.
 */

import { OfflineStore, ChangeEntry, EntityRecord, ConflictRecord } from './offline-store';
import { NetworkMonitor, ConnectivityState } from './network-monitor';

export interface SyncApiClient {
  /** Send a batch of changes to the server. */
  postSync(request: SyncRequest): Promise<SyncResponse>;
  /** Fetch entities updated since the given cursor. */
  fetchUpdates(syncCursor: string): Promise<SyncResponse>;
}

export interface SyncRequest {
  changes: SyncChange[];
  syncCursor: string | null;
}

export interface SyncChange {
  idempotencyKey: string;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  baseVersion: number;
  clientTimestamp: string;
}

export interface SyncResponse {
  results: SyncResult[];
  updatedEntities: ServerEntity[];
  nextSyncCursor: string;
  hasMore: boolean;
}

export interface SyncResult {
  idempotencyKey: string;
  status: 'applied' | 'conflict' | 'rejected';
  entityId: string;
  newVersion?: number;
  serverTimestamp?: string;
  serverData?: Record<string, unknown>;
  error?: string;
}

export interface ServerEntity {
  entityType: string;
  entityId: string;
  version: number;
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface SyncEngineOptions {
  store: OfflineStore;
  networkMonitor: NetworkMonitor;
  apiClient: SyncApiClient;
  tenantId: string;
  userId: string;
  /** Max entries to send in a single sync batch. Default: 50. */
  batchSize?: number;
  /** Called when conflicts are detected. */
  onConflict?: (conflicts: ConflictRecord[]) => void;
  /** Called when outbox count changes. */
  onOutboxChange?: (count: number) => void;
  /** Called when connectivity state changes. */
  onConnectivityChange?: (state: ConnectivityState) => void;
  /** Called when sync completes (success or failure). */
  onSyncComplete?: (result: { applied: number; conflicts: number; failed: number }) => void;
}

type SyncEngineState = 'idle' | 'syncing' | 'offline';

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

export class SyncEngine {
  private store: OfflineStore;
  private networkMonitor: NetworkMonitor;
  private apiClient: SyncApiClient;
  private tenantId: string;
  private userId: string;
  private batchSize: number;
  private state: SyncEngineState = 'idle';
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private cleanupFns: Array<() => void> = [];

  private onConflict?: (conflicts: ConflictRecord[]) => void;
  private onOutboxChange?: (count: number) => void;
  private onConnectivityChange?: (state: ConnectivityState) => void;
  private onSyncComplete?: (result: { applied: number; conflicts: number; failed: number }) => void;

  constructor(options: SyncEngineOptions) {
    this.store = options.store;
    this.networkMonitor = options.networkMonitor;
    this.apiClient = options.apiClient;
    this.tenantId = options.tenantId;
    this.userId = options.userId;
    this.batchSize = options.batchSize ?? 50;
    this.onConflict = options.onConflict;
    this.onOutboxChange = options.onOutboxChange;
    this.onConnectivityChange = options.onConnectivityChange;
    this.onSyncComplete = options.onSyncComplete;
  }

  async start(): Promise<void> {
    await this.store.open();

    // React to connectivity changes
    const unsubscribe = this.networkMonitor.onChange((newState) => {
      this.handleConnectivityChange(newState);
    });
    this.cleanupFns.push(unsubscribe);

    // Set initial state based on network
    if (this.networkMonitor.isOffline()) {
      this.state = 'offline';
    }
  }

  stop(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }

  getState(): SyncEngineState {
    return this.state;
  }

  /**
   * Write an entity. If online, sends directly to server. If offline,
   * queues in the outbox.
   */
  async write(
    entityType: string,
    entityId: string,
    action: 'create' | 'update' | 'delete',
    payload: Record<string, unknown>,
    baseVersion: number,
  ): Promise<{ queued: boolean }> {
    const idempotencyKey = crypto.randomUUID();

    if (this.networkMonitor.isOnline()) {
      // Try direct write
      try {
        const response = await this.apiClient.postSync({
          changes: [
            {
              idempotencyKey,
              entityType,
              entityId,
              action,
              payload,
              baseVersion,
              clientTimestamp: new Date().toISOString(),
            },
          ],
          syncCursor: await this.store.getSyncCursor(),
        });

        await this.processSyncResponse(response);
        return { queued: false };
      } catch (err) {
        // Network error — fall through to offline queue
        this.networkMonitor.reportFetchError();
      }
    }

    // Queue in outbox
    await this.store.addToOutbox({
      entityType,
      entityId,
      action,
      payload,
      baseVersion,
      timestamp: Date.now(),
      tenantId: this.tenantId,
      userId: this.userId,
      idempotencyKey,
      status: 'pending',
      retryCount: 0,
    });

    // Also update local cache optimistically
    if (action !== 'delete') {
      const existing = await this.store.getEntity(entityType, entityId);
      await this.store.putEntity({
        entityType,
        entityId,
        version: baseVersion, // local optimistic version
        data: existing ? { ...existing.data, ...payload } : payload,
        updatedAt: new Date().toISOString(),
        lastAccessedAt: Date.now(),
      });
    } else {
      await this.store.deleteEntity(entityType, entityId);
    }

    const count = await this.store.getOutboxCount();
    this.onOutboxChange?.(count);

    return { queued: true };
  }

  /**
   * Read an entity. Returns from local cache if available.
   */
  async read(entityType: string, entityId: string): Promise<EntityRecord | undefined> {
    await this.store.touchEntity(entityType, entityId);
    return this.store.getEntity(entityType, entityId);
  }

  /**
   * Read all entities of a type from local cache.
   */
  async readAll(entityType: string): Promise<EntityRecord[]> {
    return this.store.getEntitiesByType(entityType);
  }

  /**
   * Get all unresolved conflicts.
   */
  async getConflicts(): Promise<ConflictRecord[]> {
    return this.store.getConflicts();
  }

  /**
   * Resolve a conflict with the user's chosen strategy.
   */
  async resolveConflict(
    entityType: string,
    entityId: string,
    resolution: 'local' | 'server' | 'merged',
    mergedData?: Record<string, unknown>,
  ): Promise<void> {
    if (resolution === 'local') {
      const conflict = await this.store.getConflict(entityType, entityId);
      if (conflict) {
        // Re-queue local version using the server's current version as the base so
        // the server's optimistic lock accepts it (overwriting the conflicting edit).
        await this.write(entityType, entityId, 'update', conflict.localVersion, conflict.serverEntityVersion);
      }
    } else if (resolution === 'server') {
      // Accept server version — update local cache with correct server version number
      const conflict = await this.store.getConflict(entityType, entityId);
      if (conflict) {
        await this.store.putEntity({
          entityType,
          entityId,
          version: conflict.serverEntityVersion,
          data: conflict.serverVersion,
          updatedAt: new Date().toISOString(),
          lastAccessedAt: Date.now(),
        });
      }
    } else if (resolution === 'merged' && mergedData) {
      const conflict = await this.store.getConflict(entityType, entityId);
      // User-merged version — send using the server's current version as the base
      await this.write(entityType, entityId, 'update', mergedData, conflict?.serverEntityVersion ?? 0);
    }

    await this.store.resolveConflict(entityType, entityId, resolution);
    await this.store.removeConflict(entityType, entityId);
  }

  /**
   * Force an immediate sync attempt.
   */
  async forceSync(): Promise<void> {
    if (this.state === 'syncing') return;
    await this.drainOutbox();
  }

  /**
   * Fetch server-side updates without pushing local changes.
   */
  async pullUpdates(): Promise<void> {
    if (!this.networkMonitor.isOnline()) return;

    let cursor = await this.store.getSyncCursor();
    let hasMore = true;
    // Safety cap: never fetch more than 20 pages in a single pull cycle.
    // Prevents an infinite loop if the server misbehaves and always returns hasMore: true.
    const MAX_PAGES = 20;
    let pages = 0;

    while (hasMore && pages < MAX_PAGES) {
      const response = await this.apiClient.fetchUpdates(cursor ?? new Date(0).toISOString());
      await this.applyServerUpdates(response.updatedEntities);
      await this.store.setSyncCursor(response.nextSyncCursor);
      cursor = response.nextSyncCursor;
      hasMore = response.hasMore;
      pages++;
    }
  }

  // --- Private ---

  private handleConnectivityChange(newState: ConnectivityState): void {
    this.onConnectivityChange?.(newState);

    if (newState === 'offline') {
      this.state = 'offline';
      if (this.retryTimer !== null) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    } else if (newState === 'online' || newState === 'degraded') {
      if (this.state === 'offline') {
        this.state = 'idle';
        this.retryAttempt = 0;
        // Trigger outbox drain on reconnect
        this.drainOutbox();
      }
    }
  }

  private async drainOutbox(): Promise<void> {
    if (this.state === 'syncing') return;
    this.state = 'syncing';

    let applied = 0;
    let conflicts = 0;
    let failed = 0;

    try {
      const pending = await this.store.getPendingOutboxEntries();
      if (pending.length === 0) {
        // No local changes — just pull updates
        await this.pullUpdates();
        this.state = 'idle';
        this.retryAttempt = 0;
        return;
      }

      // Process in batches
      for (let i = 0; i < pending.length; i += this.batchSize) {
        const batch = pending.slice(i, i + this.batchSize);

        // Mark as syncing
        for (const entry of batch) {
          entry.status = 'syncing';
          await this.store.updateOutboxEntry(entry);
        }

        const syncChanges: SyncChange[] = batch.map((entry) => ({
          idempotencyKey: entry.idempotencyKey,
          entityType: entry.entityType,
          entityId: entry.entityId,
          action: entry.action,
          payload: entry.payload,
          baseVersion: entry.baseVersion,
          clientTimestamp: new Date(entry.timestamp).toISOString(),
        }));

        try {
          const response = await this.apiClient.postSync({
            changes: syncChanges,
            syncCursor: await this.store.getSyncCursor(),
          });

          // Process results
          for (const result of response.results) {
            const entry = batch.find((e) => e.idempotencyKey === result.idempotencyKey);
            if (!entry) continue;

            if (result.status === 'applied') {
              entry.status = 'synced';
              await this.store.updateOutboxEntry(entry);
              applied++;

              // Update local cache with server version
              if (result.newVersion !== undefined) {
                const existing = await this.store.getEntity(entry.entityType, entry.entityId);
                if (existing) {
                  existing.version = result.newVersion;
                  existing.updatedAt = result.serverTimestamp ?? new Date().toISOString();
                  await this.store.putEntity(existing);
                }
              }
            } else if (result.status === 'conflict') {
              entry.status = 'conflict';
              await this.store.updateOutboxEntry(entry);
              conflicts++;

              // Store the conflict for user resolution.
              // serverEntityVersion is required so conflict resolution can use
              // the correct baseVersion when re-sending the local change.
              const conflictRecord: ConflictRecord = {
                entityType: entry.entityType,
                entityId: entry.entityId,
                localVersion: entry.payload,
                serverVersion: result.serverData ?? {},
                serverEntityVersion: result.newVersion ?? 0,
                localTimestamp: entry.timestamp,
                serverTimestamp: Date.now(),
              };
              await this.store.addConflict(conflictRecord);
            } else {
              // rejected
              entry.status = 'failed';
              entry.lastError = result.error ?? 'Server rejected the change';
              await this.store.updateOutboxEntry(entry);
              failed++;
            }
          }

          // Apply server-side updates
          await this.processSyncResponse(response);
          this.networkMonitor.reportFetchSuccess(0);
        } catch (err) {
          // Network error during batch — revert to pending and schedule retry
          for (const entry of batch) {
            if (entry.status === 'syncing') {
              entry.status = 'pending';
              entry.retryCount++;
              await this.store.updateOutboxEntry(entry);
            }
          }

          this.networkMonitor.reportFetchError();
          // Reset state before scheduling retry so forceSync() can re-enter drainOutbox()
          this.state = 'idle';
          this.scheduleRetry();
          return;
        }
      }

      // Clean up synced entries
      await this.store.clearSyncedEntries();

      const outboxCount = await this.store.getOutboxCount();
      this.onOutboxChange?.(outboxCount);

      // Notify about conflicts
      if (conflicts > 0) {
        const allConflicts = await this.store.getConflicts();
        this.onConflict?.(allConflicts);
      }

      this.onSyncComplete?.({ applied, conflicts, failed });
      this.state = 'idle';
      this.retryAttempt = 0;
    } catch (err) {
      console.error('[SyncEngine] Drain failed:', err);
      this.state = 'idle';
      this.scheduleRetry();
    }
  }

  private async processSyncResponse(response: SyncResponse): Promise<void> {
    await this.applyServerUpdates(response.updatedEntities);
    await this.store.setSyncCursor(response.nextSyncCursor);

    // If the server has more updates, keep fetching
    if (response.hasMore) {
      await this.pullUpdates();
    }
  }

  private async applyServerUpdates(entities: ServerEntity[]): Promise<void> {
    const records: EntityRecord[] = entities.map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
      version: e.version,
      data: e.data,
      updatedAt: e.updatedAt,
      lastAccessedAt: Date.now(),
    }));

    if (records.length > 0) {
      await this.store.putEntities(records);
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    if (this.networkMonitor.isOffline()) return;

    const delayMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, this.retryAttempt), BACKOFF_MAX_MS);
    this.retryAttempt++;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.drainOutbox();
    }, delayMs);
  }
}
