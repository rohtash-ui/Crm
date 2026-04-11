export { WebGpsTrackingService } from './WebGpsTrackingService';
export { IndexedDbBufferService } from './IndexedDbBufferService';

// Re-export shared types and services for convenience.
export type {
  GpsCoordinate,
  GpsServiceState,
  GpsTrackingConfig,
  LocationBatch,
  LocationBuffer,
  LocationUpdate,
  TrackingMode,
} from '../../../shared/gps/types';

export { LocationUploadService } from '../../../shared/gps/LocationUploadService';
