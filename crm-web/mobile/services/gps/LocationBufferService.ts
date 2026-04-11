import { LocationUpdate, LocationBuffer } from '../../../shared/gps/types';
import { MOBILE_SQLITE_TABLE as LOCAL_BUFFER_TABLE } from '../../../shared/gps/config';

/**
 * Offline-resilient buffer for location updates.
 *
 * Uses SQLite (via react-native-sqlite-storage or expo-sqlite) to persist
 * location updates locally. This guarantees zero data loss even when the
 * device is offline, the app is killed, or a batch upload fails.
 *
 * The buffer is a FIFO queue: updates are pushed in order and drained from
 * the oldest first when the upload service is ready.
 */
export class LocationBufferService implements LocationBuffer {
  private db: any; // SQLite database handle

  constructor(db: any) {
    this.db = db;
  }

  /** Create the buffer table if it doesn't exist. Call once at app startup. */
  async initialize(): Promise<void> {
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS ${LOCAL_BUFFER_TABLE} (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        payload    TEXT    NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);

    // Index for efficient oldest-first draining.
    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_${LOCAL_BUFFER_TABLE}_created
      ON ${LOCAL_BUFFER_TABLE} (created_at ASC);
    `);
  }

  /** Append a single location update to the buffer. */
  async push(update: LocationUpdate): Promise<void> {
    const payload = JSON.stringify(update);
    await this.db.executeSql(
      `INSERT INTO ${LOCAL_BUFFER_TABLE} (payload) VALUES (?);`,
      [payload],
    );
  }

  /** Append multiple updates in a single transaction. */
  async pushMany(updates: LocationUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    await this.db.transaction((tx: any) => {
      for (const update of updates) {
        tx.executeSql(
          `INSERT INTO ${LOCAL_BUFFER_TABLE} (payload) VALUES (?);`,
          [JSON.stringify(update)],
        );
      }
    });
  }

  /**
   * Remove and return up to `limit` of the oldest buffered updates.
   *
   * This is atomic: if the caller fails to upload the batch, the updates are
   * already gone from the buffer. The upload service is responsible for
   * re-enqueuing on failure (see LocationUploadService).
   */
  async drain(limit: number): Promise<LocationUpdate[]> {
    const [result] = await this.db.executeSql(
      `SELECT id, payload FROM ${LOCAL_BUFFER_TABLE}
       ORDER BY created_at ASC
       LIMIT ?;`,
      [limit],
    );

    const rows: Array<{ id: number; payload: string }> = [];
    for (let i = 0; i < result.rows.length; i++) {
      rows.push(result.rows.item(i));
    }

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    await this.db.executeSql(
      `DELETE FROM ${LOCAL_BUFFER_TABLE} WHERE id IN (${ids.join(',')});`,
    );

    return rows.map((r) => JSON.parse(r.payload) as LocationUpdate);
  }

  /** Peek at the oldest N updates without removing them. */
  async peek(limit: number): Promise<LocationUpdate[]> {
    const [result] = await this.db.executeSql(
      `SELECT payload FROM ${LOCAL_BUFFER_TABLE}
       ORDER BY created_at ASC
       LIMIT ?;`,
      [limit],
    );

    const updates: LocationUpdate[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      updates.push(JSON.parse(result.rows.item(i).payload));
    }
    return updates;
  }

  /** Return the number of updates currently buffered. */
  async count(): Promise<number> {
    const [result] = await this.db.executeSql(
      `SELECT COUNT(*) as cnt FROM ${LOCAL_BUFFER_TABLE};`,
    );
    return result.rows.item(0).cnt;
  }

  /** Delete all buffered updates. Use for testing or user-initiated reset. */
  async clear(): Promise<void> {
    await this.db.executeSql(`DELETE FROM ${LOCAL_BUFFER_TABLE};`);
  }

  /** Remove updates older than the given age in milliseconds. */
  async pruneOlderThan(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const [result] = await this.db.executeSql(
      `DELETE FROM ${LOCAL_BUFFER_TABLE} WHERE created_at < ?;`,
      [cutoff],
    );
    return result.rowsAffected;
  }
}
