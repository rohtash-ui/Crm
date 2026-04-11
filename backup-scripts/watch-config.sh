#!/usr/bin/env bash
# ============================================================================
# CRM Config Watcher
# Watches application config directories for changes and triggers a backup
# automatically when files are modified. Runs as a long-lived process
# (intended for systemd or supervisor).
#
# Requires: inotifywait (from inotify-tools package)
# Usage: ./watch-config.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/backup.conf"

CONFIG_DIR="${CONFIG_DIR:-/app/config}"
APP_DIR="${APP_DIR:-/app}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
LOG_FILE="${LOG_DIR:-/var/log}/crm-backup.log"
DEBOUNCE_SECONDS="${CONFIG_WATCH_DEBOUNCE:-10}"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCH] $*" | tee -a "$LOG_FILE"
}

# Check for inotifywait
if ! command -v inotifywait &> /dev/null; then
  log "ERROR: inotifywait not found. Install inotify-tools:"
  log "  Debian/Ubuntu: apt-get install inotify-tools"
  log "  RHEL/CentOS:   yum install inotify-tools"
  log "  Alpine:        apk add inotify-tools"
  exit 1
fi

# Build list of directories to watch
WATCH_DIRS=()
for dir in "$CONFIG_DIR" "${APP_DIR}/helm" "${APP_DIR}"; do
  if [ -d "$dir" ]; then
    WATCH_DIRS+=("$dir")
  fi
done

if [ ${#WATCH_DIRS[@]} -eq 0 ]; then
  log "ERROR: No config directories found to watch"
  log "  Checked: ${CONFIG_DIR}, ${APP_DIR}/helm, ${APP_DIR}"
  exit 1
fi

log "Starting config watcher on: ${WATCH_DIRS[*]}"
log "Debounce: ${DEBOUNCE_SECONDS}s (changes within this window are batched)"

mkdir -p "${BACKUP_DIR}/config"

LAST_BACKUP=0

do_backup() {
  local now
  now=$(date +%s)
  local elapsed=$((now - LAST_BACKUP))

  # Debounce: skip if we just backed up
  if [ "$elapsed" -lt "$DEBOUNCE_SECONDS" ]; then
    return 0
  fi

  LAST_BACKUP=$now
  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  local archive="${BACKUP_DIR}/config/app-config-${timestamp}.tar.gz"

  log "Config change detected — creating backup: ${archive}"

  tar czf "$archive" \
    --exclude="*.secrets" \
    --exclude="*.key" \
    --exclude=".env" \
    "${WATCH_DIRS[@]}" 2>/dev/null || {
    log "WARNING: Config backup had errors (some files may have been skipped)"
  }

  local size
  size=$(du -sh "$archive" 2>/dev/null | cut -f1 || echo "unknown")
  log "Config backup complete: ${archive} (${size})"

  # Keep last 30 config backups
  ls -t "${BACKUP_DIR}/config/app-config-"*.tar.gz 2>/dev/null \
    | tail -n +31 \
    | xargs rm -f 2>/dev/null || true
}

# Handle graceful shutdown
cleanup() {
  log "Config watcher shutting down"
  exit 0
}
trap cleanup SIGTERM SIGINT SIGHUP

# Watch for file changes
while true; do
  inotifywait \
    --recursive \
    --event modify,create,delete,move \
    --exclude '(\.(swp|tmp|bak)$|__pycache__|\.git)' \
    --timeout 3600 \
    --quiet \
    "${WATCH_DIRS[@]}" 2>/dev/null && do_backup || true
done
