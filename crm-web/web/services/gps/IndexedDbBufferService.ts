import { LocationUpdate, LocationBuffer } from '../../../shared/gps/types';
import { WEB_IDB_NAME, WEB_IDB_STORE } from '../../../shared/gps/config';

/**
 * IndexedDB-backed offline buffer for location updates in the web client.
 *
 * This is the browser equivalent of the mobile LocationBufferService (SQLite).
 * IndexedDB is available in all modern browsers (Chrome, Safari, Firefox, Edge)
 * and persists data across page reloads and browser restarts.
 *
 * The buffer is a FIFO queue: updates are pushed in order and drained from
 * the oldest first when the upload service is ready.
 */
export class IndexedDbBufferService implements LocationBuffer {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;
  private readonly storeName: string;

  constructor(dbName = WEB_IDB_NAME, storeName = WEB_IDB_STORE) {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  /** Open the IndexedDB database and create the object store if needed. */
  async initialize(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** Append a single location update to the buffer. */
  async push(update: LocationUpdate): Promise<void> {
    const db = this.ensureDb();
    await this.txWrite(db, (store) => {
      store.add({ payload: update, createdAt: Date.now() });
    });
  }

  /** Append multiple updates in a single transaction. */
  async pushMany(updates: LocationUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const db = this.ensureDb();
    await this.txWrite(db, (store) => {
      for (const update of updates) {
        store.add({ payload: update, createdAt: Date.now() });
      }
    });
  }

  /**
   * Remove and return up to `limit` of the oldest buffered updates.
   *
   * Reads the oldest entries by the createdAt index, collects them,
   * then deletes them in the same transaction.
   */
  async drain(limit: number): Promise<LocationUpdate[]> {
    const db = this.ensureDb();

    return new Promise<LocationUpdate[]>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const index = store.index('createdAt');
      const request = index.openCursor();

      const updates: LocationUpdate[] = [];
      const keysToDelete: IDBValidKey[] = [];
      let collected = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || collected >= limit) {
          // Done reading — delete the collected keys.
          for (const key of keysToDelete) {
            store.delete(key);
          }
          return; // tx.oncomplete will resolve
        }

        updates.push(cursor.value.payload);
        keysToDelete.push(cursor.primaryKey);
        collected++;
        cursor.continue();
      };

      tx.oncomplete = () => resolve(updates);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Return the number of updates currently buffered. */
  async count(): Promise<number> {
    const db = this.ensureDb();
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** Delete all buffered updates. */
  async clear(): Promise<void> {
    const db = this.ensureDb();
    await this.txWrite(db, (store) => {
      store.clear();
    });
  }

  /** Remove updates older than the given age in milliseconds. */
  async pruneOlderThan(maxAgeMs: number): Promise<number> {
    const db = this.ensureDb();
    const cutoff = Date.now() - maxAgeMs;

    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const index = store.index('createdAt');
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);

      let deleted = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return; // tx.oncomplete resolves

        store.delete(cursor.primaryKey);
        deleted++;
        cursor.continue();
      };

      tx.oncomplete = () => resolve(deleted);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private ensureDb(): IDBDatabase {
    if (!this.db) {
      throw new Error('IndexedDbBufferService not initialized — call initialize() first');
    }
    return this.db;
  }

  private txWrite(
    db: IDBDatabase,
    operation: (store: IDBObjectStore) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      operation(store);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
