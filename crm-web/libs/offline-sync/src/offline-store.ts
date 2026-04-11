/**
 * Offline Store — IndexedDB wrapper for local CRM data persistence.
 *
 * Manages four object stores:
 *   - entities:  cached server records (contacts, deals, activities)
 *   - outbox:    pending mutations queued for sync
 *   - metadata:  sync cursors, schema version, storage quotas
 *   - conflicts: records needing user resolution
 *
 * Each database is scoped to tenant_id + user_id to prevent cross-tenant leaks.
 */

const DB_VERSION = 1;
const DEFAULT_MAX_STORAGE_BYTES = 100 * 1024 * 1024; // 100 MB

export interface EntityRecord {
  entityType: string;
  entityId: string;
  version: number;
  data: Record<string, unknown>;
  updatedAt: string;
  lastAccessedAt: number;
}

export interface ChangeEntry {
  id?: number;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  baseVersion: number;
  timestamp: number;
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  status: 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';
  retryCount: number;
  lastError?: string;
}

export interface ConflictRecord {
  entityType: string;
  entityId: string;
  localVersion: Record<string, unknown>;
  serverVersion: Record<string, unknown>;
  /** The server entity's version number — required for optimistic locking on conflict resolution. */
  serverEntityVersion: number;
  localTimestamp: number;
  serverTimestamp: number;
  resolvedAt?: number;
  resolution?: 'local' | 'server' | 'merged';
}

export interface SyncMetadata {
  key: string;
  value: unknown;
}

function dbName(tenantId: string, userId: string): string {
  return `crm_offline_${tenantId}_${userId}`;
}

export class OfflineStore {
  private db: IDBDatabase | null = null;
  private tenantId: string;
  private userId: string;

  constructor(tenantId: string, userId: string) {
    this.tenantId = tenantId;
    this.userId = userId;
  }

  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName(this.tenantId, this.userId), DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Entities store — cached server records
        if (!db.objectStoreNames.contains('entities')) {
          const entityStore = db.createObjectStore('entities', {
            keyPath: ['entityType', 'entityId'],
          });
          entityStore.createIndex('byType', 'entityType', { unique: false });
          entityStore.createIndex('byLastAccessed', 'lastAccessedAt', { unique: false });
        }

        // Outbox store — pending mutations
        if (!db.objectStoreNames.contains('outbox')) {
          const outboxStore = db.createObjectStore('outbox', {
            keyPath: 'id',
            autoIncrement: true,
          });
          outboxStore.createIndex('byStatus', 'status', { unique: false });
          outboxStore.createIndex('byEntity', ['entityType', 'entityId'], { unique: false });
        }

        // Metadata store — sync cursors, config
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }

        // Conflicts store — records needing user resolution
        if (!db.objectStoreNames.contains('conflicts')) {
          db.createObjectStore('conflicts', {
            keyPath: ['entityType', 'entityId'],
          });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to open offline database: ${request.error?.message}`));
      };
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // --- Entity operations ---

  async getEntity(entityType: string, entityId: string): Promise<EntityRecord | undefined> {
    return this.getFromStore<EntityRecord>('entities', [entityType, entityId]);
  }

  async getEntitiesByType(entityType: string): Promise<EntityRecord[]> {
    return this.getAllByIndex<EntityRecord>('entities', 'byType', entityType);
  }

  async putEntity(record: EntityRecord): Promise<void> {
    record.lastAccessedAt = Date.now();
    return this.putToStore('entities', record);
  }

  async putEntities(records: EntityRecord[]): Promise<void> {
    const now = Date.now();
    records.forEach((r) => (r.lastAccessedAt = now));
    return this.putBatchToStore('entities', records);
  }

  async deleteEntity(entityType: string, entityId: string): Promise<void> {
    return this.deleteFromStore('entities', [entityType, entityId]);
  }

  async touchEntity(entityType: string, entityId: string): Promise<void> {
    const record = await this.getEntity(entityType, entityId);
    if (record) {
      record.lastAccessedAt = Date.now();
      await this.putToStore('entities', record);
    }
  }

  // --- Outbox operations ---

  async addToOutbox(entry: Omit<ChangeEntry, 'id'>): Promise<number> {
    return new Promise((resolve, reject) => {
      this.ensureDb();
      const tx = this.db!.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      const request = store.add(entry);
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(new Error(`Failed to add to outbox: ${request.error?.message}`));
    });
  }

  async getPendingOutboxEntries(): Promise<ChangeEntry[]> {
    return this.getAllByIndex<ChangeEntry>('outbox', 'byStatus', 'pending');
  }

  async getOutboxEntry(id: number): Promise<ChangeEntry | undefined> {
    return this.getFromStore<ChangeEntry>('outbox', id);
  }

  async updateOutboxEntry(entry: ChangeEntry): Promise<void> {
    return this.putToStore('outbox', entry);
  }

  async removeOutboxEntry(id: number): Promise<void> {
    return this.deleteFromStore('outbox', id);
  }

  async getOutboxCount(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.ensureDb();
      const tx = this.db!.transaction('outbox', 'readonly');
      const store = tx.objectStore('outbox');
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to count outbox: ${request.error?.message}`));
    });
  }

  async clearSyncedEntries(): Promise<void> {
    const synced = await this.getAllByIndex<ChangeEntry>('outbox', 'byStatus', 'synced');
    this.ensureDb();
    const tx = this.db!.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    for (const entry of synced) {
      if (entry.id !== undefined) {
        store.delete(entry.id);
      }
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Failed to clear synced entries'));
    });
  }

  // --- Conflict operations ---

  async addConflict(conflict: ConflictRecord): Promise<void> {
    return this.putToStore('conflicts', conflict);
  }

  async getConflicts(): Promise<ConflictRecord[]> {
    return this.getAllFromStore<ConflictRecord>('conflicts');
  }

  async getConflict(entityType: string, entityId: string): Promise<ConflictRecord | undefined> {
    return this.getFromStore<ConflictRecord>('conflicts', [entityType, entityId]);
  }

  async resolveConflict(
    entityType: string,
    entityId: string,
    resolution: 'local' | 'server' | 'merged',
  ): Promise<void> {
    const conflict = await this.getConflict(entityType, entityId);
    if (conflict) {
      conflict.resolvedAt = Date.now();
      conflict.resolution = resolution;
      await this.putToStore('conflicts', conflict);
    }
  }

  async removeConflict(entityType: string, entityId: string): Promise<void> {
    return this.deleteFromStore('conflicts', [entityType, entityId]);
  }

  // --- Metadata operations ---

  async getMeta(key: string): Promise<unknown> {
    const record = await this.getFromStore<SyncMetadata>('metadata', key);
    return record?.value;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    return this.putToStore('metadata', { key, value });
  }

  async getSyncCursor(): Promise<string | null> {
    const cursor = await this.getMeta('syncCursor');
    return (cursor as string) ?? null;
  }

  async setSyncCursor(cursor: string): Promise<void> {
    return this.setMeta('syncCursor', cursor);
  }

  // --- Storage management ---

  async estimateStorageUsage(): Promise<number> {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return estimate.usage ?? 0;
    }
    return 0;
  }

  async evictLRU(targetBytes: number = DEFAULT_MAX_STORAGE_BYTES): Promise<number> {
    let currentUsage = await this.estimateStorageUsage();
    if (currentUsage <= targetBytes) return 0;

    // Get entity IDs that have pending outbox entries — never evict these
    const pendingEntries = await this.getPendingOutboxEntries();
    const pendingEntityKeys = new Set(
      pendingEntries.map((e) => `${e.entityType}:${e.entityId}`),
    );

    // Get all entities sorted by last accessed (oldest first)
    const allEntities = await this.getAllFromStore<EntityRecord>('entities');
    allEntities.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    let evictedCount = 0;
    for (const entity of allEntities) {
      const key = `${entity.entityType}:${entity.entityId}`;
      if (pendingEntityKeys.has(key)) continue; // never evict records with pending changes

      await this.deleteEntity(entity.entityType, entity.entityId);
      evictedCount++;

      // Re-estimate after every 10 evictions to avoid excessive Storage API calls
      if (evictedCount % 10 === 0) {
        currentUsage = await this.estimateStorageUsage();
        if (currentUsage <= targetBytes) break;
      }
    }

    return evictedCount;
  }

  // --- Wipe (logout / session expiry) ---

  async wipe(): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName(this.tenantId, this.userId));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to wipe offline database'));
    });
  }

  // --- Internal helpers ---

  private ensureDb(): void {
    if (!this.db) {
      throw new Error('OfflineStore is not open. Call open() first.');
    }
  }

  private getFromStore<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.ensureDb();
      const tx = this.db!.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(new Error(`Failed to get from ${storeName}: ${request.error?.message}`));
    });
  }

  private getAllFromStore<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.ensureDb();
      const tx = this.db!.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(new Error(`Failed to getAll from ${storeName}: ${request.error?.message}`));
    });
  }

  private getAllByIndex<T>(storeName: string, indexName: string, key: IDBValidKey): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.ensureDb();
      const tx = this.db!.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(key);
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(new Error(`Failed to getAll by index ${indexName}: ${request.error?.message}`));
    });
  }

  private putToStore(storeName: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ensureDb();
      const tx = this.db!.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to put to ${storeName}: ${request.error?.message}`));
    });
  }

  private putBatchToStore(storeName: string, values: unknown[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ensureDb();
      const tx = this.db!.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const value of values) {
        store.put(value);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(`Failed to batch put to ${storeName}: ${tx.error?.message}`));
    });
  }

  private deleteFromStore(storeName: string, key: IDBValidKey): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ensureDb();
      const tx = this.db!.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to delete from ${storeName}: ${request.error?.message}`));
    });
  }
}
