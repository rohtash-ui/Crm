import { LocationBatch, LocationUpdate } from './types';
import { UPLOAD_RETRY } from '../../config/gpsDefaults';

/**
 * Handles uploading location batches to the backend location-tracking service.
 *
 * Features:
 *  - Exponential backoff with jitter on transient failures.
 *  - Idempotent uploads via batch ID (server deduplicates).
 *  - Re-enqueues failed batches back into the buffer for later retry.
 *  - Respects server back-pressure (429 / 503 → delay next attempt).
 */
export class LocationUploadService {
  private readonly apiBaseUrl: string;
  private readonly getAuthToken: () => Promise<string>;
  private readonly reEnqueue: (updates: LocationUpdate[]) => Promise<void>;

  private inflightBatchIds: Set<string> = new Set();

  constructor(deps: {
    apiBaseUrl: string;
    getAuthToken: () => Promise<string>;
    reEnqueue: (updates: LocationUpdate[]) => Promise<void>;
  }) {
    this.apiBaseUrl = deps.apiBaseUrl;
    this.getAuthToken = deps.getAuthToken;
    this.reEnqueue = deps.reEnqueue;
  }

  /**
   * Upload a batch of location updates to the server.
   * Retries with exponential backoff on transient failures.
   * Re-enqueues the updates if all retries are exhausted.
   */
  async upload(batch: LocationBatch): Promise<void> {
    // Deduplicate in-flight uploads for the same batch.
    if (this.inflightBatchIds.has(batch.batchId)) return;
    this.inflightBatchIds.add(batch.batchId);

    try {
      await this.uploadWithRetry(batch);
    } catch (error) {
      // All retries exhausted — put updates back in the buffer for next cycle.
      await this.reEnqueue(batch.updates);
    } finally {
      this.inflightBatchIds.delete(batch.batchId);
    }
  }

  private async uploadWithRetry(batch: LocationBatch): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= UPLOAD_RETRY.maxRetries; attempt++) {
      try {
        await this.doUpload(batch);
        return; // success
      } catch (error: any) {
        lastError = error;

        if (!isTransient(error)) {
          throw error; // non-retryable (e.g. 400 Bad Request)
        }

        if (attempt < UPLOAD_RETRY.maxRetries) {
          const delay = Math.min(
            UPLOAD_RETRY.baseDelayMs * UPLOAD_RETRY.backoffMultiplier ** attempt,
            UPLOAD_RETRY.maxDelayMs,
          );
          // Add jitter: 50%-150% of calculated delay.
          const jitteredDelay = delay * (0.5 + Math.random());
          await sleep(jitteredDelay);
        }
      }
    }

    throw lastError ?? new Error('Upload failed after retries');
  }

  private async doUpload(batch: LocationBatch): Promise<void> {
    const token = await this.getAuthToken();

    const response = await fetch(`${this.apiBaseUrl}/api/v1/location-tracking/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': batch.batchId,
      },
      body: JSON.stringify({
        batch_id: batch.batchId,
        sent_at: batch.sentAt,
        updates: batch.updates.map((u) => ({
          tenant_id: u.tenantId,
          user_id: u.userId,
          device_id: u.deviceId,
          latitude: u.coordinate.latitude,
          longitude: u.coordinate.longitude,
          altitude: u.coordinate.altitude,
          accuracy: u.coordinate.accuracy,
          heading: u.coordinate.heading,
          speed: u.coordinate.speed,
          timestamp: u.coordinate.timestamp,
          battery_level: u.batteryLevel,
          network_type: u.networkType,
          is_moving: u.isMoving,
          activity_type: u.activityType,
        })),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error: any = new Error(
        `Upload failed: ${response.status} ${response.statusText} — ${body}`,
      );
      error.status = response.status;
      throw error;
    }
  }
}

function isTransient(error: any): boolean {
  // Network errors (no status) are transient.
  if (!error.status) return true;
  // Server errors and rate limiting are transient.
  return error.status >= 500 || error.status === 429;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
