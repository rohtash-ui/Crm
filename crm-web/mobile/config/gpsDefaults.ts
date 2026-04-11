/**
 * Re-export shared GPS config from the shared package.
 * Mobile-specific config (foreground notification, SQLite table) included here.
 */
export {
  GPS_DEFAULTS,
  UPLOAD_RETRY,
  FOREGROUND_NOTIFICATION,
  MOBILE_SQLITE_TABLE as LOCAL_BUFFER_TABLE,
} from '../../shared/gps/config';
