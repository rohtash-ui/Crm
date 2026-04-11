#!/usr/bin/env bash
# ============================================================================
# CRM File Backup Script
# Backs up user uploads, attachments, exports, and application config.
# Usage: ./backup-files.sh [--config-only] [--uploads-only]
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/backup.conf"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"
CONFIG_DIR="${CONFIG_DIR:-/app/config}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="${LOG_DIR:-/var/log}/crm-backup.log"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [FILES] $*" | tee -a "$LOG_FILE"
}

# Parse arguments
CONFIG_ONLY=false
UPLOADS_ONLY=false
for arg in "$@"; do
  case $arg in
    --config-only)  CONFIG_ONLY=true ;;
    --uploads-only) UPLOADS_ONLY=true ;;
    *)              echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

mkdir -p "${BACKUP_DIR}/uploads" "${BACKUP_DIR}/config" "${BACKUP_DIR}/code"

# --- Back up user uploads ---
if [ "$CONFIG_ONLY" = false ]; then
  log "Backing up user uploads from ${UPLOADS_DIR}"
  if [ -d "$UPLOADS_DIR" ]; then
    rsync -az --delete \
      --exclude="*.tmp" \
      --exclude=".cache/" \
      "$UPLOADS_DIR/" "${BACKUP_DIR}/uploads/"
    log "Uploads backup complete ($(du -sh "${BACKUP_DIR}/uploads" | cut -f1))"
  else
    log "WARNING: Uploads directory ${UPLOADS_DIR} not found, skipping"
  fi
fi

# --- Back up application config ---
if [ "$UPLOADS_ONLY" = false ]; then
  CONFIG_ARCHIVE="${BACKUP_DIR}/config/app-config-${TIMESTAMP}.tar.gz"
  log "Backing up application config"

  CONFIG_FILES=()
  for path in "$CONFIG_DIR" /app/.env.example /app/helm; do
    if [ -e "$path" ]; then
      CONFIG_FILES+=("$path")
    fi
  done

  if [ ${#CONFIG_FILES[@]} -gt 0 ]; then
    tar czf "$CONFIG_ARCHIVE" \
      --exclude="*.secrets" \
      --exclude="*.key" \
      --exclude=".env" \
      "${CONFIG_FILES[@]}" 2>/dev/null || true
    log "Config backup: ${CONFIG_ARCHIVE} ($(du -sh "$CONFIG_ARCHIVE" | cut -f1))"
  else
    log "WARNING: No config files found to back up"
  fi

  # Clean up old config backups (keep last 30)
  ls -t "${BACKUP_DIR}/config/app-config-"*.tar.gz 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
fi

# --- Back up git repository as a bundle ---
if [ "$CONFIG_ONLY" = false ] && [ "$UPLOADS_ONLY" = false ]; then
  if command -v git &> /dev/null && git rev-parse --git-dir > /dev/null 2>&1; then
    REPO_ROOT="$(git rev-parse --show-toplevel)"
    BUNDLE_FILE="${BACKUP_DIR}/code/crm-repo-${TIMESTAMP}.bundle"
    log "Creating git bundle from ${REPO_ROOT}"
    git -C "$REPO_ROOT" bundle create "$BUNDLE_FILE" --all 2>/dev/null || true
    log "Git bundle: ${BUNDLE_FILE}"

    # Keep last 7 bundles
    ls -t "${BACKUP_DIR}/code/crm-repo-"*.bundle 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null || true
  fi
fi

log "File backup pipeline complete"
