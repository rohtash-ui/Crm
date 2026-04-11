#!/usr/bin/env bash
# ============================================================================
# CRM Database Backup Script
# Performs a full Postgres backup with encryption and optional cloud sync.
# Usage: ./backup-database.sh [--logical] [--sync]
# ============================================================================
set -euo pipefail

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/backup.conf"

# Defaults (overridden by backup.conf)
BACKUP_DIR="${BACKUP_DIR:-/backups/postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-replication_user}"
DB_NAME="${DB_NAME:-crm_production}"
ENCRYPT="${ENCRYPT_BACKUPS:-true}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"
RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="${LOG_DIR:-/var/log}/crm-backup.log"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [BACKUP] $*" | tee -a "$LOG_FILE"
}

error_exit() {
  log "ERROR: $1"
  if [ -n "${HEALTH_CHECK_FAIL_URL:-}" ]; then
    curl -sf "$HEALTH_CHECK_FAIL_URL" > /dev/null 2>&1 || true
  fi
  exit 1
}

success_ping() {
  if [ -n "${HEALTH_CHECK_URL:-}" ]; then
    curl -sf "$HEALTH_CHECK_URL" > /dev/null 2>&1 || true
  fi
}

# Parse arguments
LOGICAL=false
SYNC=false
for arg in "$@"; do
  case $arg in
    --logical) LOGICAL=true ;;
    --sync)    SYNC=true ;;
    *)         echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

mkdir -p "${BACKUP_DIR}/base" "${BACKUP_DIR}/logical" "${BACKUP_DIR}/wal"

if [ "$LOGICAL" = true ]; then
  # --- Logical backup (pg_dump) ---
  BACKUP_FILE="${BACKUP_DIR}/logical/crm_${TIMESTAMP}.dump"
  log "Starting logical backup to ${BACKUP_FILE}"

  pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --format=custom \
    --compress=9 \
    --file="$BACKUP_FILE" \
    "$DB_NAME" || error_exit "pg_dump failed"

  FINAL_FILE="$BACKUP_FILE"
else
  # --- Physical backup (pg_basebackup) ---
  BACKUP_PATH="${BACKUP_DIR}/base/${TIMESTAMP}"
  log "Starting physical backup to ${BACKUP_PATH}"

  pg_basebackup \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --pgdata="$BACKUP_PATH" \
    --wal-method=stream \
    --checkpoint=fast \
    --compress=gzip \
    --progress 2>&1 | tee -a "$LOG_FILE" || error_exit "pg_basebackup failed"

  # Archive as tarball
  TARBALL="${BACKUP_DIR}/base/crm_base_${TIMESTAMP}.tar.gz"
  tar czf "$TARBALL" -C "${BACKUP_DIR}/base" "$TIMESTAMP"
  rm -rf "$BACKUP_PATH"
  FINAL_FILE="$TARBALL"
fi

# Encrypt if enabled
if [ "$ENCRYPT" = true ] && [ -n "$GPG_RECIPIENT" ]; then
  log "Encrypting backup with GPG"
  gpg --encrypt --recipient "$GPG_RECIPIENT" --output "${FINAL_FILE}.gpg" "$FINAL_FILE"
  rm -f "$FINAL_FILE"
  FINAL_FILE="${FINAL_FILE}.gpg"
elif [ "$ENCRYPT" = true ]; then
  log "Encrypting backup with symmetric AES-256"
  gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase-file "${SCRIPT_DIR}/.backup-passphrase" \
    --output "${FINAL_FILE}.gpg" "$FINAL_FILE"
  rm -f "$FINAL_FILE"
  FINAL_FILE="${FINAL_FILE}.gpg"
fi

BACKUP_SIZE=$(du -sh "$FINAL_FILE" | cut -f1)
log "Backup complete: ${FINAL_FILE} (${BACKUP_SIZE})"

# Sync to cloud if requested
if [ "$SYNC" = true ]; then
  log "Syncing to cloud destinations..."
  "${SCRIPT_DIR}/sync-to-cloud.sh" --source="$FINAL_FILE"
fi

# Cleanup old local backups
log "Cleaning up backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}/base" -type f -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
find "${BACKUP_DIR}/logical" -type f -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true

success_ping
log "Database backup pipeline complete"
