#!/usr/bin/env bash
# ============================================================================
# CRM Backup Verification Script
# Validates backup integrity and tests restore capability.
# Usage: ./verify-backup.sh [--post-restore] [--full]
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/backup.conf"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
LOG_FILE="${LOG_DIR:-/var/log}/crm-backup.log"
VERIFY_DB="${VERIFY_DB:-crm_verify_scratch}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
REPORT_FILE="${BACKUP_DIR}/verify-report-${TIMESTAMP}.txt"

POST_RESTORE=false
FULL_CHECK=false
ERRORS=0

for arg in "$@"; do
  case $arg in
    --post-restore) POST_RESTORE=true ;;
    --full)         FULL_CHECK=true ;;
    *)              echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [VERIFY] $*" | tee -a "$LOG_FILE" >> "$REPORT_FILE"
}

pass() { log "PASS: $*"; }
fail() { log "FAIL: $*"; ERRORS=$((ERRORS + 1)); }

log "========================================="
log "Backup Verification Report"
log "========================================="

# ---- 1. Check backup freshness ----
log ""
log "--- Backup Freshness ---"

check_freshness() {
  local dir="$1"
  local label="$2"
  local max_hours="$3"

  if [ ! -d "$dir" ]; then
    fail "${label}: directory ${dir} does not exist"
    return
  fi

  local latest
  latest=$(find "$dir" -type f -name "*.dump" -o -name "*.tar.gz" -o -name "*.gpg" -o -name "*.bundle" 2>/dev/null | xargs ls -t 2>/dev/null | head -1)

  if [ -z "$latest" ]; then
    fail "${label}: no backup files found in ${dir}"
    return
  fi

  local age_seconds
  age_seconds=$(( $(date +%s) - $(stat -c %Y "$latest" 2>/dev/null || stat -f %m "$latest" 2>/dev/null) ))
  local age_hours=$(( age_seconds / 3600 ))

  if [ "$age_hours" -gt "$max_hours" ]; then
    fail "${label}: latest backup is ${age_hours}h old (max: ${max_hours}h) — ${latest}"
  else
    pass "${label}: latest backup is ${age_hours}h old — ${latest}"
  fi
}

check_freshness "${BACKUP_DIR}/postgres/base" "Postgres full backup" 26
check_freshness "${BACKUP_DIR}/postgres/logical" "Postgres logical backup" 8
check_freshness "${BACKUP_DIR}/config" "Config backup" 48
check_freshness "${BACKUP_DIR}/code" "Code bundle" 48

# ---- 2. Check backup file integrity ----
log ""
log "--- File Integrity ---"

for f in "${BACKUP_DIR}/postgres/base/"*.tar.gz 2>/dev/null; do
  [ -f "$f" ] || continue
  if gzip -t "$f" 2>/dev/null; then
    pass "Archive OK: $(basename "$f")"
  else
    fail "Corrupt archive: $(basename "$f")"
  fi
done

for f in "${BACKUP_DIR}/postgres/base/"*.gpg "${BACKUP_DIR}/postgres/logical/"*.gpg 2>/dev/null; do
  [ -f "$f" ] || continue
  if gpg --list-packets "$f" > /dev/null 2>&1; then
    pass "Encrypted file OK: $(basename "$f")"
  else
    fail "Corrupt encrypted file: $(basename "$f")"
  fi
done

for f in "${BACKUP_DIR}/code/"*.bundle 2>/dev/null; do
  [ -f "$f" ] || continue
  if git bundle verify "$f" > /dev/null 2>&1; then
    pass "Git bundle OK: $(basename "$f")"
  else
    fail "Corrupt git bundle: $(basename "$f")"
  fi
done

# ---- 3. Test restore (if --full) ----
if [ "$FULL_CHECK" = true ]; then
  log ""
  log "--- Restore Test ---"

  LATEST_DUMP=$(find "${BACKUP_DIR}/postgres/logical" -name "*.dump" -type f 2>/dev/null | xargs ls -t 2>/dev/null | head -1)

  if [ -n "$LATEST_DUMP" ]; then
    log "Testing restore of ${LATEST_DUMP} to scratch database ${VERIFY_DB}"

    # Create scratch database
    dropdb --if-exists "$VERIFY_DB" 2>/dev/null || true
    createdb "$VERIFY_DB" 2>/dev/null || { fail "Could not create scratch DB"; }

    if pg_restore --dbname="$VERIFY_DB" --jobs=4 --no-owner "$LATEST_DUMP" 2>/dev/null; then
      pass "Restore to scratch DB succeeded"

      # Count tables and rows
      TABLE_COUNT=$(psql -t -A -d "$VERIFY_DB" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0")
      log "Scratch DB has ${TABLE_COUNT} tables"

      if [ "$TABLE_COUNT" -gt 0 ]; then
        pass "Scratch DB contains data (${TABLE_COUNT} tables)"
      else
        fail "Scratch DB appears empty"
      fi
    else
      fail "Restore to scratch DB failed"
    fi

    # Cleanup scratch database
    dropdb --if-exists "$VERIFY_DB" 2>/dev/null || true
  else
    log "SKIP: No logical dump found for restore test"
  fi
fi

# ---- 4. Check cloud sync status ----
log ""
log "--- Cloud Sync Status ---"

if command -v rclone &> /dev/null; then
  for remote_name in "${GDRIVE_REMOTE:-gdrive}" "${S3_REMOTE:-s3}" "${ONEDRIVE_REMOTE:-onedrive}"; do
    if rclone listremotes 2>/dev/null | grep -q "^${remote_name}:"; then
      SIZE=$(rclone size "${remote_name}:CRM-Backups" --json 2>/dev/null | grep -o '"bytes":[0-9]*' | cut -d: -f2 || echo "unknown")
      if [ "$SIZE" != "unknown" ] && [ "$SIZE" -gt 0 ] 2>/dev/null; then
        pass "${remote_name}: cloud backup exists (${SIZE} bytes)"
      else
        fail "${remote_name}: cloud backup empty or inaccessible"
      fi
    fi
  done
else
  log "SKIP: rclone not installed, cannot verify cloud backups"
fi

# ---- 5. Check disk space ----
log ""
log "--- Storage Health ---"

if [ -d "$BACKUP_DIR" ]; then
  USAGE=$(df -h "$BACKUP_DIR" | tail -1 | awk '{print $5}' | tr -d '%')
  if [ "$USAGE" -gt 90 ]; then
    fail "Backup disk is ${USAGE}% full — cleanup needed"
  elif [ "$USAGE" -gt 75 ]; then
    log "WARNING: Backup disk is ${USAGE}% full"
    pass "Backup disk usage acceptable (${USAGE}%)"
  else
    pass "Backup disk usage healthy (${USAGE}%)"
  fi
fi

# ---- Summary ----
log ""
log "========================================="
if [ "$ERRORS" -eq 0 ]; then
  log "RESULT: ALL CHECKS PASSED"
else
  log "RESULT: ${ERRORS} CHECK(S) FAILED"
fi
log "Report saved to: ${REPORT_FILE}"
log "========================================="

exit "$ERRORS"
