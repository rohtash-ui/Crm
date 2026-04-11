#!/usr/bin/env bash
# ============================================================================
# CRM Backup System Setup
# Interactive installer that bootstraps the backup infrastructure.
# Run once to configure directories, encryption, cloud remotes, and scheduling.
#
# Usage: sudo ./setup.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/crm/backup-scripts"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

header() {
  echo ""
  echo -e "${BLUE}============================================${NC}"
  echo -e "${BLUE}  $*${NC}"
  echo -e "${BLUE}============================================${NC}"
  echo ""
}

ask() {
  local prompt="$1"
  local default="${2:-}"
  local result
  if [ -n "$default" ]; then
    read -rp "  ${prompt} [${default}]: " result
    echo "${result:-$default}"
  else
    read -rp "  ${prompt}: " result
    echo "$result"
  fi
}

ask_yn() {
  local prompt="$1"
  local default="${2:-y}"
  local result
  read -rp "  ${prompt} [${default}]: " result
  result="${result:-$default}"
  [[ "$result" =~ ^[Yy] ]]
}

# ============================================================================
header "CRM Backup System Setup"

echo "This script will:"
echo "  1. Create backup directories"
echo "  2. Generate an encryption passphrase"
echo "  3. Install scripts to ${INSTALL_DIR}"
echo "  4. Configure cloud storage (optional)"
echo "  5. Set up automated scheduling (cron or systemd)"
echo ""

# ---- Step 1: Backup directory ----
header "Step 1: Backup Directory"

BACKUP_DIR=$(ask "Backup storage directory" "/backups")
LOG_DIR=$(ask "Log directory" "/var/log")

info "Creating directories..."
mkdir -p "${BACKUP_DIR}/postgres/base"
mkdir -p "${BACKUP_DIR}/postgres/logical"
mkdir -p "${BACKUP_DIR}/postgres/wal"
mkdir -p "${BACKUP_DIR}/uploads"
mkdir -p "${BACKUP_DIR}/config"
mkdir -p "${BACKUP_DIR}/code"
mkdir -p "$LOG_DIR"
ok "Backup directories created at ${BACKUP_DIR}"

# ---- Step 2: Database configuration ----
header "Step 2: Database Configuration"

DB_HOST=$(ask "PostgreSQL host" "localhost")
DB_PORT=$(ask "PostgreSQL port" "5432")
DB_USER=$(ask "PostgreSQL backup user" "replication_user")
DB_NAME=$(ask "Database name" "crm_production")
ok "Database configured: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# ---- Step 3: Application paths ----
header "Step 3: Application Paths"

APP_DIR=$(ask "Application root directory" "/app")
UPLOADS_DIR=$(ask "User uploads directory" "/data/uploads")
CONFIG_DIR=$(ask "Application config directory" "${APP_DIR}/config")
PG_DATA_DIR=$(ask "PostgreSQL data directory" "/var/lib/postgresql")

# ---- Step 4: Encryption ----
header "Step 4: Encryption"

ENCRYPT_BACKUPS="false"
PASSPHRASE_FILE="${INSTALL_DIR}/.backup-passphrase"
GPG_RECIPIENT=""

if ask_yn "Enable backup encryption?" "y"; then
  ENCRYPT_BACKUPS="true"

  if ask_yn "Use asymmetric GPG encryption (requires GPG key)?" "n"; then
    GPG_RECIPIENT=$(ask "GPG recipient (email or key ID)" "")
    ok "Will encrypt with GPG key: ${GPG_RECIPIENT}"
  else
    info "Generating symmetric encryption passphrase..."
    mkdir -p "$(dirname "$PASSPHRASE_FILE")"
    if [ ! -f "$PASSPHRASE_FILE" ]; then
      head -c 32 /dev/urandom | base64 > "$PASSPHRASE_FILE"
      chmod 600 "$PASSPHRASE_FILE"
      ok "Passphrase generated: ${PASSPHRASE_FILE}"
      warn "IMPORTANT: Back up this file separately! Without it, encrypted backups cannot be decrypted."
      echo ""
      echo "  Your passphrase file: ${PASSPHRASE_FILE}"
      echo "  Copy it somewhere safe (password manager, printed, etc.)"
      echo ""
    else
      ok "Passphrase file already exists: ${PASSPHRASE_FILE}"
    fi
  fi
fi

# ---- Step 5: Cloud storage ----
header "Step 5: Cloud Storage"

SYNC_DESTINATIONS=""
GDRIVE_REMOTE="gdrive"
GDRIVE_PATH="CRM-Backups"
S3_REMOTE="s3"
S3_BUCKET="crm-backups-bucket"
S3_STORAGE_CLASS="STANDARD_IA"
ONEDRIVE_REMOTE="onedrive"
ONEDRIVE_PATH="CRM-Backups"
PERSONAL_DRIVE_PATH="/mnt/personal-drive"

SETUP_CLOUD=false
if ask_yn "Configure cloud backup destinations?" "y"; then
  SETUP_CLOUD=true

  # Check for rclone
  if ! command -v rclone &> /dev/null; then
    warn "rclone is not installed."
    if ask_yn "Install rclone now?" "y"; then
      info "Installing rclone..."
      if command -v apt-get &> /dev/null; then
        apt-get update -qq && apt-get install -y -qq rclone
      elif command -v yum &> /dev/null; then
        yum install -y rclone
      elif command -v brew &> /dev/null; then
        brew install rclone
      else
        curl https://rclone.org/install.sh | bash
      fi
      ok "rclone installed"
    else
      warn "Skipping cloud setup — install rclone later and run: rclone config"
      SETUP_CLOUD=false
    fi
  fi
fi

DESTINATIONS=()

if [ "$SETUP_CLOUD" = true ]; then
  echo ""
  echo "  Available destinations:"
  echo "    1. Google Drive"
  echo "    2. AWS S3"
  echo "    3. OneDrive"
  echo "    4. Personal / USB drive"
  echo ""

  if ask_yn "Set up Google Drive?" "y"; then
    GDRIVE_REMOTE=$(ask "rclone remote name for Google Drive" "gdrive")
    GDRIVE_PATH=$(ask "Google Drive folder path" "CRM-Backups")
    DESTINATIONS+=("gdrive")

    if ! rclone listremotes 2>/dev/null | grep -q "^${GDRIVE_REMOTE}:"; then
      info "Google Drive remote '${GDRIVE_REMOTE}' not configured yet."
      if ask_yn "Configure it now? (opens interactive rclone setup)" "y"; then
        rclone config create "$GDRIVE_REMOTE" drive scope drive.file || \
          warn "rclone config failed — configure manually later with: rclone config"
      fi
    else
      ok "Google Drive remote '${GDRIVE_REMOTE}' already configured"
    fi
  fi

  if ask_yn "Set up AWS S3?" "n"; then
    S3_REMOTE=$(ask "rclone remote name for S3" "s3")
    S3_BUCKET=$(ask "S3 bucket name" "crm-backups-bucket")
    S3_STORAGE_CLASS=$(ask "S3 storage class" "STANDARD_IA")
    DESTINATIONS+=("s3")

    if ! rclone listremotes 2>/dev/null | grep -q "^${S3_REMOTE}:"; then
      info "S3 remote '${S3_REMOTE}' not configured yet."
      if ask_yn "Configure it now?" "y"; then
        rclone config create "$S3_REMOTE" s3 provider AWS || \
          warn "rclone config failed — configure manually later with: rclone config"
      fi
    else
      ok "S3 remote '${S3_REMOTE}' already configured"
    fi
  fi

  if ask_yn "Set up OneDrive?" "n"; then
    ONEDRIVE_REMOTE=$(ask "rclone remote name for OneDrive" "onedrive")
    ONEDRIVE_PATH=$(ask "OneDrive folder path" "CRM-Backups")
    DESTINATIONS+=("onedrive")
  fi

  if ask_yn "Set up personal/USB drive?" "y"; then
    PERSONAL_DRIVE_PATH=$(ask "Mount path for personal drive" "/mnt/personal-drive")
    DESTINATIONS+=("personal")
    if [ ! -d "$PERSONAL_DRIVE_PATH" ]; then
      warn "Path ${PERSONAL_DRIVE_PATH} does not exist. Mount your drive there before backups run."
    fi
  fi

  SYNC_DESTINATIONS=$(IFS=','; echo "${DESTINATIONS[*]}")
fi

# ---- Step 6: Install scripts ----
header "Step 6: Installing Scripts"

if [ "$SCRIPT_DIR" != "$INSTALL_DIR" ]; then
  mkdir -p "$INSTALL_DIR"
  info "Copying scripts to ${INSTALL_DIR}..."
  cp "${SCRIPT_DIR}"/*.sh "$INSTALL_DIR/"
  cp "${SCRIPT_DIR}/backup.conf" "$INSTALL_DIR/backup.conf.default"
  chmod +x "${INSTALL_DIR}"/*.sh
  ok "Scripts installed to ${INSTALL_DIR}"
else
  ok "Scripts already in ${INSTALL_DIR}"
fi

# ---- Step 7: Generate config ----
header "Step 7: Generating Configuration"

CONFIG_FILE="${INSTALL_DIR}/backup.conf"
cat > "$CONFIG_FILE" << CONF
# ============================================================================
# CRM Backup Configuration
# Generated by setup.sh on $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================================

# --- General ---
BACKUP_DIR="${BACKUP_DIR}"
LOG_DIR="${LOG_DIR}"
ENCRYPT_BACKUPS="${ENCRYPT_BACKUPS}"
LOCAL_RETENTION_DAYS="7"

# --- Database ---
DB_HOST="${DB_HOST}"
DB_PORT="${DB_PORT}"
DB_USER="${DB_USER}"
DB_NAME="${DB_NAME}"
$([ -n "$GPG_RECIPIENT" ] && echo "GPG_RECIPIENT=\"${GPG_RECIPIENT}\"" || echo "# GPG_RECIPIENT=\"backup@yourcompany.com\"")

# --- Application paths ---
UPLOADS_DIR="${UPLOADS_DIR}"
CONFIG_DIR="${CONFIG_DIR}"
APP_DIR="${APP_DIR}"

# --- Postgres data directory (for physical restore) ---
PG_DATA_DIR="${PG_DATA_DIR}"

# --- Encryption passphrase file ---
BACKUP_PASSPHRASE_FILE="${PASSPHRASE_FILE}"

# --- Sync destinations ---
SYNC_DESTINATIONS="${SYNC_DESTINATIONS}"

# --- Google Drive ---
GDRIVE_REMOTE="${GDRIVE_REMOTE}"
GDRIVE_PATH="${GDRIVE_PATH}"

# --- AWS S3 ---
S3_REMOTE="${S3_REMOTE}"
S3_BUCKET="${S3_BUCKET}"
S3_PREFIX=""
S3_STORAGE_CLASS="${S3_STORAGE_CLASS}"

# --- OneDrive ---
ONEDRIVE_REMOTE="${ONEDRIVE_REMOTE}"
ONEDRIVE_PATH="${ONEDRIVE_PATH}"

# --- Personal / USB drive ---
PERSONAL_DRIVE_PATH="${PERSONAL_DRIVE_PATH}"

# --- WAL archiving ---
WAL_COMPRESS="true"
WAL_RETENTION_DAYS="3"

# --- Cleanup retention ---
CONFIG_KEEP_COUNT="30"
CODE_KEEP_COUNT="7"
CLOUD_RETENTION_DAYS="90"

# --- Config watcher ---
CONFIG_WATCH_DEBOUNCE="10"

# --- Health checks (optional) ---
HEALTH_CHECK_URL=""
HEALTH_CHECK_FAIL_URL=""

# --- Verification ---
VERIFY_DB="crm_verify_scratch"
CONF

chmod 600 "$CONFIG_FILE"
ok "Configuration written to ${CONFIG_FILE}"

# ---- Step 8: Scheduling ----
header "Step 8: Automated Scheduling"

echo "  Choose scheduling method:"
echo "    1. cron (traditional, works everywhere)"
echo "    2. systemd timers (modern, better logging)"
echo "    3. both (belt and suspenders)"
echo "    4. skip (configure manually later)"
echo ""

SCHED_CHOICE=$(ask "Choice" "1")

if [ "$SCHED_CHOICE" = "1" ] || [ "$SCHED_CHOICE" = "3" ]; then
  info "Installing cron jobs..."
  CRON_FILE="/etc/cron.d/crm-backup"
  cat > "$CRON_FILE" << CRON
# CRM Backup System — Automated Schedule
# Generated by setup.sh on $(date '+%Y-%m-%d %H:%M:%S')
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Database: full backup daily at 2 AM
0 2 * * * root ${INSTALL_DIR}/backup-database.sh >> ${LOG_DIR}/crm-backup.log 2>&1

# Database: logical dump every 6 hours
0 */6 * * * root ${INSTALL_DIR}/backup-database.sh --logical >> ${LOG_DIR}/crm-backup.log 2>&1

# Files: sync uploads every hour
0 * * * * root ${INSTALL_DIR}/backup-files.sh --uploads-only >> ${LOG_DIR}/crm-backup.log 2>&1

# Files: full file backup (uploads + config + code) daily at 3 AM
0 3 * * * root ${INSTALL_DIR}/backup-files.sh >> ${LOG_DIR}/crm-backup.log 2>&1

# Cloud sync: push to configured destinations every 4 hours
0 */4 * * * root ${INSTALL_DIR}/sync-to-cloud.sh >> ${LOG_DIR}/crm-backup.log 2>&1

# Cleanup: remove old backups weekly on Sunday at 3 AM
0 3 * * 0 root ${INSTALL_DIR}/cleanup-old-backups.sh >> ${LOG_DIR}/crm-backup.log 2>&1

# Verify: check backup integrity weekly on Saturday at 4 AM
0 4 * * 6 root ${INSTALL_DIR}/verify-backup.sh >> ${LOG_DIR}/crm-backup.log 2>&1
CRON
  chmod 644 "$CRON_FILE"
  ok "Cron jobs installed: ${CRON_FILE}"
fi

if [ "$SCHED_CHOICE" = "2" ] || [ "$SCHED_CHOICE" = "3" ]; then
  info "Installing systemd units..."

  # --- Database backup timer ---
  cat > /etc/systemd/system/crm-backup-db.service << SVC
[Unit]
Description=CRM Database Backup
After=postgresql.service

[Service]
Type=oneshot
ExecStart=${INSTALL_DIR}/backup-database.sh --sync
User=root
StandardOutput=append:${LOG_DIR}/crm-backup.log
StandardError=append:${LOG_DIR}/crm-backup.log
SVC

  cat > /etc/systemd/system/crm-backup-db.timer << TMR
[Unit]
Description=CRM Database Backup Timer (daily 2 AM)

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
TMR

  # --- Logical dump timer ---
  cat > /etc/systemd/system/crm-backup-db-logical.service << SVC
[Unit]
Description=CRM Database Logical Backup
After=postgresql.service

[Service]
Type=oneshot
ExecStart=${INSTALL_DIR}/backup-database.sh --logical
User=root
StandardOutput=append:${LOG_DIR}/crm-backup.log
StandardError=append:${LOG_DIR}/crm-backup.log
SVC

  cat > /etc/systemd/system/crm-backup-db-logical.timer << TMR
[Unit]
Description=CRM Database Logical Backup Timer (every 6 hours)

[Timer]
OnCalendar=*-*-* 00/6:00:00
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
TMR

  # --- File backup timer ---
  cat > /etc/systemd/system/crm-backup-files.service << SVC
[Unit]
Description=CRM File Backup

[Service]
Type=oneshot
ExecStart=${INSTALL_DIR}/backup-files.sh
User=root
StandardOutput=append:${LOG_DIR}/crm-backup.log
StandardError=append:${LOG_DIR}/crm-backup.log
SVC

  cat > /etc/systemd/system/crm-backup-files.timer << TMR
[Unit]
Description=CRM File Backup Timer (hourly uploads, daily full)

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
TMR

  # --- Cloud sync timer ---
  cat > /etc/systemd/system/crm-backup-sync.service << SVC
[Unit]
Description=CRM Backup Cloud Sync

[Service]
Type=oneshot
ExecStart=${INSTALL_DIR}/sync-to-cloud.sh
User=root
StandardOutput=append:${LOG_DIR}/crm-backup.log
StandardError=append:${LOG_DIR}/crm-backup.log
SVC

  cat > /etc/systemd/system/crm-backup-sync.timer << TMR
[Unit]
Description=CRM Backup Cloud Sync Timer (every 4 hours)

[Timer]
OnCalendar=*-*-* 00/4:00:00
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
TMR

  # --- Cleanup timer ---
  cat > /etc/systemd/system/crm-backup-cleanup.service << SVC
[Unit]
Description=CRM Backup Cleanup

[Service]
Type=oneshot
ExecStart=${INSTALL_DIR}/cleanup-old-backups.sh
User=root
StandardOutput=append:${LOG_DIR}/crm-backup.log
StandardError=append:${LOG_DIR}/crm-backup.log
SVC

  cat > /etc/systemd/system/crm-backup-cleanup.timer << TMR
[Unit]
Description=CRM Backup Cleanup Timer (weekly Sunday 3 AM)

[Timer]
OnCalendar=Sun *-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
TMR

  # --- Verify timer ---
  cat > /etc/systemd/system/crm-backup-verify.service << SVC
[Unit]
Description=CRM Backup Verification

[Service]
Type=oneshot
ExecStart=${INSTALL_DIR}/verify-backup.sh
User=root
StandardOutput=append:${LOG_DIR}/crm-backup.log
StandardError=append:${LOG_DIR}/crm-backup.log
SVC

  cat > /etc/systemd/system/crm-backup-verify.timer << TMR
[Unit]
Description=CRM Backup Verification Timer (weekly Saturday 4 AM)

[Timer]
OnCalendar=Sat *-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
TMR

  # --- Config watcher service ---
  cat > /etc/systemd/system/crm-config-watcher.service << SVC
[Unit]
Description=CRM Config File Watcher
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/watch-config.sh
Restart=always
RestartSec=5
User=root
StandardOutput=append:${LOG_DIR}/crm-backup.log
StandardError=append:${LOG_DIR}/crm-backup.log

[Install]
WantedBy=multi-user.target
SVC

  # Enable all timers
  systemctl daemon-reload

  for timer in crm-backup-db crm-backup-db-logical crm-backup-files crm-backup-sync crm-backup-cleanup crm-backup-verify; do
    systemctl enable "${timer}.timer" 2>/dev/null || true
    systemctl start "${timer}.timer" 2>/dev/null || true
  done

  # Enable config watcher if inotify-tools is available
  if command -v inotifywait &> /dev/null; then
    systemctl enable crm-config-watcher.service 2>/dev/null || true
    systemctl start crm-config-watcher.service 2>/dev/null || true
    ok "Config watcher service started"
  else
    warn "inotify-tools not installed — config watcher not started"
    warn "Install with: apt-get install inotify-tools"
  fi

  ok "Systemd timers installed and enabled"
fi

# ---- Summary ----
header "Setup Complete"

echo "  Backup directory : ${BACKUP_DIR}"
echo "  Install location : ${INSTALL_DIR}"
echo "  Configuration    : ${CONFIG_FILE}"
echo "  Log file         : ${LOG_DIR}/crm-backup.log"
if [ "$ENCRYPT_BACKUPS" = true ]; then
  echo "  Encryption       : enabled"
  echo "  Passphrase file  : ${PASSPHRASE_FILE}"
fi
if [ -n "$SYNC_DESTINATIONS" ]; then
  echo "  Cloud sync       : ${SYNC_DESTINATIONS}"
fi
echo ""
echo "  Quick test commands:"
echo "    ${INSTALL_DIR}/backup-database.sh --logical    # Test DB backup"
echo "    ${INSTALL_DIR}/backup-files.sh                 # Test file backup"
echo "    ${INSTALL_DIR}/sync-to-cloud.sh                # Test cloud sync"
echo "    ${INSTALL_DIR}/verify-backup.sh                # Verify everything"
echo ""
echo "  View logs:"
echo "    tail -f ${LOG_DIR}/crm-backup.log"
echo ""
ok "Backup system is ready."
