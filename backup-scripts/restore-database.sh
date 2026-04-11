#!/usr/bin/env bash
# ============================================================================
# CRM Database Restore Script
# Restores a Postgres database from a backup file (local, cloud, or drive).
# Usage: ./restore-database.sh --backup=<path> [--target-time=<timestamp>]
#        ./restore-database.sh --from-cloud=<gdrive|s3|personal>
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/backup.conf"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-crm_production}"
RESTORE_DB="${RESTORE_DB:-crm_recovery}"
LOG_FILE="${LOG_DIR:-/var/log}/crm-backup.log"

BACKUP_PATH=""
TARGET_TIME=""
FROM_CLOUD=""
SKIP_CONFIRM=false

for arg in "$@"; do
  case $arg in
    --backup=*)      BACKUP_PATH="${arg#*=}" ;;
    --target-time=*) TARGET_TIME="${arg#*=}" ;;
    --from-cloud=*)  FROM_CLOUD="${arg#*=}" ;;
    --yes)           SKIP_CONFIRM=true ;;
    *)               echo "Usage: $0 --backup=<path> [--target-time=<ts>] [--from-cloud=<gdrive|s3|personal>] [--yes]"; exit 1 ;;
  esac
done

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [RESTORE] $*" | tee -a "$LOG_FILE"
}

# ---- Pull backup from cloud if needed ----
if [ -n "$FROM_CLOUD" ]; then
  DOWNLOAD_DIR="/tmp/crm-restore-$(date +%s)"
  mkdir -p "$DOWNLOAD_DIR"

  case "$FROM_CLOUD" in
    gdrive)
      log "Downloading latest backup from Google Drive..."
      rclone copy "${GDRIVE_REMOTE:-gdrive}:${GDRIVE_PATH:-CRM-Backups}/postgres/" \
        "$DOWNLOAD_DIR" \
        --include="*.dump" --include="*.tar.gz" --include="*.gpg" \
        --max-age=48h \
        --progress
      ;;
    s3)
      log "Downloading latest backup from S3..."
      rclone copy "${S3_REMOTE:-s3}:${S3_BUCKET:-crm-backups-bucket}/${S3_PREFIX:-$(hostname)}/postgres/" \
        "$DOWNLOAD_DIR" \
        --include="*.dump" --include="*.tar.gz" --include="*.gpg" \
        --max-age=48h \
        --progress
      ;;
    personal)
      DRIVE_PATH="${PERSONAL_DRIVE_PATH:-/mnt/personal-drive}/CRM-Backups/postgres"
      if [ ! -d "$DRIVE_PATH" ]; then
        log "ERROR: Personal drive not found at ${DRIVE_PATH}"
        log "Mount your drive first: mount /dev/sdX /mnt/personal-drive"
        exit 1
      fi
      log "Copying latest backup from personal drive..."
      cp "$DRIVE_PATH"/*.dump "$DOWNLOAD_DIR/" 2>/dev/null || \
      cp "$DRIVE_PATH"/*.tar.gz "$DOWNLOAD_DIR/" 2>/dev/null || \
      cp "$DRIVE_PATH"/*.gpg "$DOWNLOAD_DIR/" 2>/dev/null || \
        { log "ERROR: No backup files found on personal drive"; exit 1; }
      ;;
    *)
      log "ERROR: Unknown cloud source: ${FROM_CLOUD}. Use: gdrive, s3, personal"
      exit 1
      ;;
  esac

  BACKUP_PATH=$(ls -t "$DOWNLOAD_DIR"/* 2>/dev/null | head -1)
  if [ -z "$BACKUP_PATH" ]; then
    log "ERROR: No backup files downloaded"
    exit 1
  fi
  log "Using backup: ${BACKUP_PATH}"
fi

if [ -z "$BACKUP_PATH" ]; then
  echo "ERROR: No backup specified. Use --backup=<path> or --from-cloud=<source>"
  exit 1
fi

if [ ! -f "$BACKUP_PATH" ]; then
  echo "ERROR: Backup file not found: ${BACKUP_PATH}"
  exit 1
fi

# ---- Decrypt if encrypted ----
RESTORE_FILE="$BACKUP_PATH"
if [[ "$BACKUP_PATH" == *.gpg ]]; then
  log "Decrypting backup..."
  DECRYPTED="${BACKUP_PATH%.gpg}"
  if [ -n "${GPG_RECIPIENT:-}" ]; then
    gpg --decrypt --output "$DECRYPTED" "$BACKUP_PATH"
  else
    gpg --batch --yes --decrypt \
      --passphrase-file "${SCRIPT_DIR}/.backup-passphrase" \
      --output "$DECRYPTED" "$BACKUP_PATH"
  fi
  RESTORE_FILE="$DECRYPTED"
  log "Decrypted to: ${RESTORE_FILE}"
fi

# ---- Confirm before proceeding ----
log ""
log "============================================"
log "  RESTORE PLAN"
log "============================================"
log "  Backup file : ${RESTORE_FILE}"
log "  Target DB   : ${RESTORE_DB}"
log "  DB Host     : ${DB_HOST}:${DB_PORT}"
if [ -n "$TARGET_TIME" ]; then
  log "  PITR target : ${TARGET_TIME}"
fi
log "============================================"
log ""

if [ "$SKIP_CONFIRM" = false ]; then
  read -rp "Proceed with restore? (yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    log "Restore cancelled by user"
    exit 0
  fi
fi

# ---- Perform restore ----
if [[ "$RESTORE_FILE" == *.dump ]]; then
  # Logical restore (pg_dump custom format)
  log "Creating restore database: ${RESTORE_DB}"
  dropdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
    --if-exists "$RESTORE_DB" 2>/dev/null || true
  createdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
    "$RESTORE_DB"

  log "Restoring from logical backup..."
  pg_restore \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$RESTORE_DB" \
    --jobs=4 \
    --no-owner \
    --verbose \
    "$RESTORE_FILE" 2>&1 | tee -a "$LOG_FILE"

  log "Logical restore complete to database: ${RESTORE_DB}"

elif [[ "$RESTORE_FILE" == *.tar.gz ]]; then
  # Physical restore (base backup)
  RESTORE_DIR="/var/lib/postgresql/restore-${RESTORE_DB}"
  log "Extracting base backup to ${RESTORE_DIR}"
  mkdir -p "$RESTORE_DIR"
  tar xzf "$RESTORE_FILE" -C "$RESTORE_DIR"

  if [ -n "$TARGET_TIME" ]; then
    log "Configuring PITR to: ${TARGET_TIME}"
    cat > "${RESTORE_DIR}/recovery.signal" <<EOF
# Point-in-time recovery
EOF
    cat >> "${RESTORE_DIR}/postgresql.auto.conf" <<EOF
restore_command = 'cp ${BACKUP_DIR}/postgres/wal/%f %p'
recovery_target_time = '${TARGET_TIME}'
recovery_target_action = 'promote'
EOF
  fi

  log "Physical restore prepared at: ${RESTORE_DIR}"
  log "To complete: stop Postgres, swap data directory, start Postgres"
else
  log "ERROR: Unrecognized backup format: ${RESTORE_FILE}"
  exit 1
fi

# ---- Post-restore verification ----
if [[ "$RESTORE_FILE" == *.dump ]]; then
  log "Running post-restore verification..."

  TABLE_COUNT=$(psql -t -A \
    --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
    -d "$RESTORE_DB" \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0")

  log "Restored database has ${TABLE_COUNT} tables"

  if [ "$TABLE_COUNT" -gt 0 ]; then
    log "PASS: Restore verification succeeded"
  else
    log "WARNING: Restored database appears empty — manual verification recommended"
  fi
fi

log ""
log "============================================"
log "  RESTORE COMPLETE"
log "============================================"
log "  Database '${RESTORE_DB}' is ready."
log "  To swap with production:"
log "    1. Put app in maintenance mode"
log "    2. Rename: ${DB_NAME} -> ${DB_NAME}_old"
log "    3. Rename: ${RESTORE_DB} -> ${DB_NAME}"
log "    4. Restart app, verify, remove maintenance mode"
log "============================================"
