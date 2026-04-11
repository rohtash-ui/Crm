#!/usr/bin/env bash
# ============================================================================
# CRM WAL Archive Script
# Called by PostgreSQL's archive_command to continuously archive WAL segments.
# This enables point-in-time recovery (PITR) to any second within retention.
#
# PostgreSQL config (postgresql.conf):
#   archive_mode = on
#   archive_command = '/opt/crm/backup-scripts/archive-wal.sh %p %f'
#   wal_level = replica
#
# Usage: archive-wal.sh <wal_path> <wal_filename>
#   %p = full path to the WAL file to archive
#   %f = filename only of the WAL file
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/backup.conf" ]; then
  source "${SCRIPT_DIR}/backup.conf"
fi

WAL_SOURCE="$1"       # %p — full path to WAL segment
WAL_FILENAME="$2"     # %f — WAL segment filename

BACKUP_DIR="${BACKUP_DIR:-/backups}"
WAL_ARCHIVE_DIR="${BACKUP_DIR}/postgres/wal"
LOG_FILE="${LOG_DIR:-/var/log}/crm-backup.log"
COMPRESS="${WAL_COMPRESS:-true}"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [WAL] $*" >> "$LOG_FILE"
}

# Validate inputs
if [ -z "$WAL_SOURCE" ] || [ -z "$WAL_FILENAME" ]; then
  echo "Usage: $0 <wal_path> <wal_filename>" >&2
  exit 1
fi

if [ ! -f "$WAL_SOURCE" ]; then
  log "ERROR: WAL source file not found: ${WAL_SOURCE}"
  exit 1
fi

# Create archive directory
mkdir -p "$WAL_ARCHIVE_DIR"

# Check for duplicate (PostgreSQL may retry)
if [ "$COMPRESS" = true ]; then
  DEST="${WAL_ARCHIVE_DIR}/${WAL_FILENAME}.gz"
else
  DEST="${WAL_ARCHIVE_DIR}/${WAL_FILENAME}"
fi

if [ -f "$DEST" ]; then
  log "WARNING: WAL segment already archived, skipping: ${WAL_FILENAME}"
  exit 0
fi

# Archive the WAL segment
if [ "$COMPRESS" = true ]; then
  gzip -c "$WAL_SOURCE" > "${DEST}.tmp"
  mv "${DEST}.tmp" "$DEST"
  log "Archived WAL (compressed): ${WAL_FILENAME} ($(du -sh "$DEST" | cut -f1))"
else
  cp "$WAL_SOURCE" "${DEST}.tmp"
  mv "${DEST}.tmp" "$DEST"
  log "Archived WAL: ${WAL_FILENAME} ($(du -sh "$DEST" | cut -f1))"
fi

# Sync to cloud if rclone is available and configured
if command -v rclone &> /dev/null; then
  GDRIVE_REMOTE="${GDRIVE_REMOTE:-gdrive}"
  GDRIVE_PATH="${GDRIVE_PATH:-CRM-Backups}"

  if rclone listremotes 2>/dev/null | grep -q "^${GDRIVE_REMOTE}:"; then
    rclone copy "$DEST" "${GDRIVE_REMOTE}:${GDRIVE_PATH}/postgres/wal/" \
      --retries=3 --quiet 2>/dev/null &
  fi
fi

# Cleanup old WAL segments (keep last N days based on retention)
WAL_RETENTION_DAYS="${WAL_RETENTION_DAYS:-3}"
find "$WAL_ARCHIVE_DIR" -type f \( -name "*.gz" -o -name "0*" \) \
  -mtime "+${WAL_RETENTION_DAYS}" -delete 2>/dev/null || true

exit 0
