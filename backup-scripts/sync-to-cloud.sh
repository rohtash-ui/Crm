#!/usr/bin/env bash
# ============================================================================
# CRM Cloud Sync Script
# Syncs local backups to cloud storage (Google Drive, S3, personal drive).
# Supports multiple destinations simultaneously for 3-2-1 backup compliance.
# Usage: ./sync-to-cloud.sh [--source=<path>] [--destination=<name>]
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/backup.conf"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
LOG_FILE="${LOG_DIR:-/var/log}/crm-backup.log"
RCLONE_FLAGS="--progress --transfers=4 --checkers=8 --retries=3 --low-level-retries=10"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [SYNC] $*" | tee -a "$LOG_FILE"
}

# Parse arguments
SOURCE=""
DESTINATION=""
for arg in "$@"; do
  case $arg in
    --source=*)      SOURCE="${arg#*=}" ;;
    --destination=*) DESTINATION="${arg#*=}" ;;
    *)               echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# If a specific file was passed, sync just that file
SOURCE_DIR=""
SOURCE_FILE=""
if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
  SOURCE_DIR="$(dirname "$SOURCE")"
  SOURCE_FILE="$(basename "$SOURCE")"
elif [ -n "$SOURCE" ] && [ ! -f "$SOURCE" ]; then
  log "WARNING: --source=${SOURCE} is not a file, syncing full backup directory instead"
  SOURCE=""
fi

# ---- Sync to Google Drive ----
sync_gdrive() {
  if ! rclone listremotes 2>/dev/null | grep -q "^${GDRIVE_REMOTE:-gdrive}:"; then
    log "Google Drive remote '${GDRIVE_REMOTE:-gdrive}' not configured, skipping"
    return 0
  fi

  local remote="${GDRIVE_REMOTE:-gdrive}"
  local dest_path="${GDRIVE_PATH:-CRM-Backups}"

  if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
    log "Uploading ${SOURCE_FILE} to ${remote}:${dest_path}/"
    rclone copy "$SOURCE" "${remote}:${dest_path}/" $RCLONE_FLAGS \
      --log-file="$LOG_FILE" 2>&1 || { log "ERROR: Google Drive sync failed"; return 1; }
  else
    log "Syncing ${BACKUP_DIR} to ${remote}:${dest_path}/"
    rclone sync "$BACKUP_DIR" "${remote}:${dest_path}/" $RCLONE_FLAGS \
      --log-file="$LOG_FILE" 2>&1 || { log "ERROR: Google Drive sync failed"; return 1; }
  fi
  log "Google Drive sync complete"
}

# ---- Sync to AWS S3 ----
sync_s3() {
  if ! rclone listremotes 2>/dev/null | grep -q "^${S3_REMOTE:-s3}:"; then
    log "S3 remote '${S3_REMOTE:-s3}' not configured, skipping"
    return 0
  fi

  local remote="${S3_REMOTE:-s3}"
  local bucket="${S3_BUCKET:-crm-backups-bucket}"
  local prefix="${S3_PREFIX:-$(hostname)}"

  if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
    log "Uploading ${SOURCE_FILE} to ${remote}:${bucket}/${prefix}/"
    rclone copy "$SOURCE" "${remote}:${bucket}/${prefix}/" $RCLONE_FLAGS \
      --s3-storage-class="${S3_STORAGE_CLASS:-STANDARD_IA}" \
      --log-file="$LOG_FILE" 2>&1 || { log "ERROR: S3 sync failed"; return 1; }
  else
    log "Syncing ${BACKUP_DIR} to ${remote}:${bucket}/${prefix}/"
    rclone sync "$BACKUP_DIR" "${remote}:${bucket}/${prefix}/" $RCLONE_FLAGS \
      --s3-storage-class="${S3_STORAGE_CLASS:-STANDARD_IA}" \
      --log-file="$LOG_FILE" 2>&1 || { log "ERROR: S3 sync failed"; return 1; }
  fi
  log "S3 sync complete"
}

# ---- Sync to personal / USB drive ----
sync_personal_drive() {
  local mount_path="${PERSONAL_DRIVE_PATH:-/mnt/personal-drive}"
  local dest_path="${mount_path}/CRM-Backups"

  if [ ! -d "$mount_path" ]; then
    log "Personal drive not mounted at ${mount_path}, skipping"
    return 0
  fi

  mkdir -p "$dest_path"

  if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
    log "Copying ${SOURCE_FILE} to ${dest_path}/"
    cp "$SOURCE" "${dest_path}/" || { log "ERROR: Personal drive copy failed"; return 1; }
  else
    log "Syncing ${BACKUP_DIR} to ${dest_path}/"
    rsync -az --delete "$BACKUP_DIR/" "$dest_path/" \
      || { log "ERROR: Personal drive sync failed"; return 1; }
  fi
  log "Personal drive sync complete"
}

# ---- Sync to OneDrive ----
sync_onedrive() {
  if ! rclone listremotes 2>/dev/null | grep -q "^${ONEDRIVE_REMOTE:-onedrive}:"; then
    log "OneDrive remote '${ONEDRIVE_REMOTE:-onedrive}' not configured, skipping"
    return 0
  fi

  local remote="${ONEDRIVE_REMOTE:-onedrive}"
  local dest_path="${ONEDRIVE_PATH:-CRM-Backups}"

  if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
    log "Uploading ${SOURCE_FILE} to ${remote}:${dest_path}/"
    rclone copy "$SOURCE" "${remote}:${dest_path}/" $RCLONE_FLAGS \
      --log-file="$LOG_FILE" 2>&1 || { log "ERROR: OneDrive sync failed"; return 1; }
  else
    log "Syncing ${BACKUP_DIR} to ${remote}:${dest_path}/"
    rclone sync "$BACKUP_DIR" "${remote}:${dest_path}/" $RCLONE_FLAGS \
      --log-file="$LOG_FILE" 2>&1 || { log "ERROR: OneDrive sync failed"; return 1; }
  fi
  log "OneDrive sync complete"
}

# ---- Execute sync to configured destinations ----
log "Starting cloud sync..."

# Run syncs based on configuration or --destination flag
SYNC_TARGETS="${DESTINATION:-${SYNC_DESTINATIONS:-gdrive,personal}}"
SYNC_FAILED=0

IFS=',' read -ra TARGETS <<< "$SYNC_TARGETS"
for target in "${TARGETS[@]}"; do
  target="$(echo "$target" | xargs)"  # trim whitespace
  case "$target" in
    gdrive)   sync_gdrive   || SYNC_FAILED=$((SYNC_FAILED + 1)) ;;
    s3)       sync_s3       || SYNC_FAILED=$((SYNC_FAILED + 1)) ;;
    personal) sync_personal_drive || SYNC_FAILED=$((SYNC_FAILED + 1)) ;;
    onedrive) sync_onedrive || SYNC_FAILED=$((SYNC_FAILED + 1)) ;;
    *)        log "Unknown sync target: $target" ;;
  esac
done

if [ "$SYNC_FAILED" -gt 0 ]; then
  log "WARNING: ${SYNC_FAILED} sync target(s) failed"
  exit 1
fi

log "All cloud syncs complete"
