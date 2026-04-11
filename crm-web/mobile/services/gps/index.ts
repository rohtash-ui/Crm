export { GpsTrackingService } from './GpsTrackingService';
export { LocationBufferService } from './LocationBufferService';
export { BackgroundLocationService } from './BackgroundLocationService';

// Shared — re-exported here for convenience so callers import from one place.
export { LocationUploadService } from '../../../shared/gps/LocationUploadService';
export type {
  GpsCoordinate,
  GpsServiceState,
  GpsTrackingConfig,
  LocationBatch,
  LocationBuffer,
  LocationUpdate,
  TrackingMode,
} from '../../../shared/gps/types';
