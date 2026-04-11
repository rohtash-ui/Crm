/**
 * Re-export shared GPS types from the shared package.
 * Mobile-specific type extensions can be added here.
 */
export type {
  GpsCoordinate,
  GpsServiceState,
  GpsTrackingConfig,
  LocationBatch,
  LocationBuffer,
  LocationUpdate,
  TrackingMode,
} from '../../../shared/gps/types';
