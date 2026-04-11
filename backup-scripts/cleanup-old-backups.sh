#!/usr/bin/env bash
# ============================================================================
# CRM Backup Cleanup Script
# Removes old local backups based on retention policy.
# Also cleans up cloud storage if lifecycle policies aren't set.
# Usage: ./cleanup-old-backups.sh [--dry-run]
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/backup.conf"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
LOG_FILE="${LOG_DIR:-/var/log}/crm-backup.log"
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    *)         echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [CLEANUP] $*" | tee -a "$LOG_FILE"
}

remove_file() {
  if [ "$DRY_RUN" = true ]; then
    log "DRY-RUN: would delete $1"
  else
    rm -f "$1"
    log "Deleted: $1"
  fi
}

FREED_BYTES=0
DELETED_COUNT=0

log "========================================="
log "Starting backup cleanup (dry_run=${DRY_RUN})"
log "========================================="

# --- Retention periods ---
DB_FULL_RETENTION="${LOCAL_RETENTION_DAYS:-7}"         # days
DB_LOGICAL_RETENTION="${LOCAL_RETENTION_DAYS:-7}"      # days
WAL_RETENTION="${WAL_RETENTION_DAYS:-3}"               # days
CONFIG_KEEP_COUNT="${CONFIG_KEEP_COUNT:-30}"            # number of archives
CODE_KEEP_COUNT="${CODE_KEEP_COUNT:-7}"                 # number of bundles
UPLOAD_BACKUP_RETENTION="${UPLOAD_BACKUP_RETENTION:-30}" # days
VERIFY_REPORT_RETENTION="${VERIFY_REPORT_RETENTION:-30}" # days
CLOUD_RETENTION_DAYS="${CLOUD_RETENTION_DAYS:-90}"     # days

# --- 1. Clean old Postgres full backups ---
log ""
log "--- Postgres Full Backups (retention: ${DB_FULL_RETENTION} days) ---"
while IFS= read -r -d '' f; do
  SIZE=$(du -b "$f" 2>/dev/null | cut -f1 || echo 0)
  FREED_BYTES=$((FREED_BYTES + SIZE))
  DELETED_COUNT=$((DELETED_COUNT + 1))
  remove_file "$f"
done < <(find "${BACKUP_DIR}/postgres/base" -type f \
  \( -name "*.tar.gz" -o -name "*.gpg" -o -name "*.dump" \) \
  -mtime "+${DB_FULL_RETENTION}" -print0 2>/dev/null || true)

# --- 2. Clean old Postgres logical backups ---
log ""
log "--- Postgres Logical Backups (retention: ${DB_LOGICAL_RETENTION} days) ---"
while IFS= read -r -d '' f; do
  SIZE=$(du -b "$f" 2>/dev/null | cut -f1 || echo 0)
  FREED_BYTES=$((FREED_BYTES + SIZE))
  DELETED_COUNT=$((DELETED_COUNT + 1))
  remove_file "$f"
done < <(find "${BACKUP_DIR}/postgres/logical" -type f \
  \( -name "*.dump" -o -name "*.gpg" \) \
  -mtime "+${DB_LOGICAL_RETENTION}" -print0 2>/dev/null || true)

# --- 3. Clean old WAL segments ---
log ""
log "--- WAL Segments (retention: ${WAL_RETENTION} days) ---"
while IFS= read -r -d '' f; do
  SIZE=$(du -b "$f" 2>/dev/null | cut -f1 || echo 0)
  FREED_BYTES=$((FREED_BYTES + SIZE))
  DELETED_COUNT=$((DELETED_COUNT + 1))
  remove_file "$f"
done < <(find "${BACKUP_DIR}/postgres/wal" -type f \
  -mtime "+${WAL_RETENTION}" -print0 2>/dev/null || true)

# --- 4. Clean old config backups (keep last N) ---
log ""
log "--- Config Archives (keep last ${CONFIG_KEEP_COUNT}) ---"
CONFIG_LIST=$(ls -t "${BACKUP_DIR}/config/app-config-"*.tar.gz 2>/dev/null || true)
COUNT=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -gt "$CONFIG_KEEP_COUNT" ]; then
    SIZE=$(du -b "$f" 2>/dev/null | cut -f1 || echo 0)
    FREED_BYTES=$((FREED_BYTES + SIZE))
    DELETED_COUNT=$((DELETED_COUNT + 1))
    remove_file "$f"
  fi
done <<< "$CONFIG_LIST"

# --- 5. Clean old code bundles (keep last N) ---
log ""
log "--- Code Bundles (keep last ${CODE_KEEP_COUNT}) ---"
BUNDLE_LIST=$(ls -t "${BACKUP_DIR}/code/crm-repo-"*.bundle 2>/dev/null || true)
COUNT=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -gt "$CODE_KEEP_COUNT" ]; then
    SIZE=$(du -b "$f" 2>/dev/null | cut -f1 || echo 0)
    FREED_BYTES=$((FREED_BYTES + SIZE))
    DELETED_COUNT=$((DELETED_COUNT + 1))
    remove_file "$f"
  fi
done <<< "$BUNDLE_LIST"

# --- 6. Clean old verification reports ---
log ""
log "--- Verify Reports (retention: ${VERIFY_REPORT_RETENTION} days) ---"
while IFS= read -r -d '' f; do
  SIZE=$(du -b "$f" 2>/dev/null | cut -f1 || echo 0)
  FREED_BYTES=$((FREED_BYTES + SIZE))
  DELETED_COUNT=$((DELETED_COUNT + 1))
  remove_file "$f"
done < <(find "${BACKUP_DIR}" -maxdepth 1 -name "verify-report-*.txt" \
  -mtime "+${VERIFY_REPORT_RETENTION}" -print0 2>/dev/null || true)

# --- 7. Clean old cloud backups (if rclone supports it) ---
if command -v rclone &> /dev/null && [ "$DRY_RUN" = false ]; then
  log ""
  log "--- Cloud Cleanup (retention: ${CLOUD_RETENTION_DAYS} days) ---"

  for remote_name in "${GDRIVE_REMOTE:-gdrive}" "${S3_REMOTE:-s3}" "${ONEDRIVE_REMOTE:-onedrive}"; do
    if rclone listremotes 2>/dev/null | grep -q "^${remote_name}:"; then
      log "Cleaning ${remote_name}: files older than ${CLOUD_RETENTION_DAYS} days"
      rclone delete "${remote_name}:CRM-Backups" \
        --min-age="${CLOUD_RETENTION_DAYS}d" \
        --rmdirs \
        --quiet 2>/dev/null || log "WARNING: Cloud cleanup for ${remote_name} had errors"
    fi
  done
fi

# --- Summary ---
FREED_MB=$((FREED_BYTES / 1024 / 1024))
log ""
log "========================================="
log "Cleanup complete"
log "  Files deleted: ${DELETED_COUNT}"
log "  Space freed: ~${FREED_MB} MB"
if [ "$DRY_RUN" = true ]; then
  log "  (DRY RUN — no files were actually deleted)"
fi
log "========================================="

# Report disk usage after cleanup
if [ -d "$BACKUP_DIR" ]; then
  USAGE=$(df -h "$BACKUP_DIR" | tail -1)
  log "Disk usage: ${USAGE}"
fi
