# 11 — Data Backup & Recovery

How to protect CRM data against crashes, corruption, accidental deletion, and
catastrophic events — with options to store backups on a personal drive or
cloud storage.

This guide covers **automated backup**, **manual backup**, **cloud sync**, and
**recovery procedures** for every data store in the platform.

All scripts live in the `backup-scripts/` directory. Run `setup.sh` to
bootstrap everything interactively.

---

## Quick start

```bash
cd backup-scripts/

# 1. Run the interactive setup (creates dirs, config, encryption, scheduling)
sudo ./setup.sh

# 2. Test a database backup
./backup-database.sh --logical --sync

# 3. Test a file backup
./backup-files.sh

# 4. Verify everything
./verify-backup.sh

# 5. View logs
tail -f /var/log/crm-backup.log
```

---

## Backup philosophy

1. **Assume failure is inevitable.** Every component will fail; the only
   question is when.
2. **A backup you haven't restored is not a backup.** Test restores regularly.
3. **3-2-1 rule**: keep at least **3 copies** of data, on **2 different media
   types**, with **1 copy offsite** (personal drive, cloud, or cross-region).
4. **Automate everything.** Manual backups are forgotten backups.
5. **Encrypt at rest.** Backups contain production data — treat them with the
   same security as production.

---

## Backup targets overview

| Data store | What to back up | Method | Frequency | Destination |
|---|---|---|---|---|
| **Postgres** | Full DB + WAL stream | `pg_basebackup` + WAL archiving | Continuous WAL, daily full | Object storage, personal drive, cloud |
| **Application config** | `.env`, `settings.yaml`, Helm values | File copy | On every change | Git, personal drive, cloud |
| **User uploads / files** | Attachments, exports, imports | `rclone` sync | Hourly | Personal drive, cloud (S3/GDrive) |
| **Kafka topics** | Critical event streams | Tiered storage / consumer dump | Continuous | Object storage |
| **Redis** | Not backed up (ephemeral) | N/A | N/A | Rebuilt from Postgres |
| **OpenSearch indexes** | Snapshot API | Snapshot to object storage | Every 6 hours | Object storage, cloud |
| **Source code** | Git repositories | `git bundle` | Daily | Personal drive, cloud |
| **Secrets / credentials** | Vault export | Encrypted export | On rotation | Offline encrypted media |

---

## 1. Postgres database backup

### 1a. Automated continuous backup (WAL archiving)

WAL (Write-Ahead Log) archiving captures every change as it happens, enabling
point-in-time recovery to any second within the retention window.

**Script**: `backup-scripts/archive-wal.sh` — called by PostgreSQL on every WAL
segment rotation. Compresses with gzip, optionally syncs to cloud, and cleans up
segments older than `WAL_RETENTION_DAYS`.

```bash
# postgresql.conf — enable WAL archiving
archive_mode = on
archive_command = '/opt/crm/backup-scripts/archive-wal.sh %p %f'
wal_level = replica
```

### 1b. Full database backup (daily)

**Script**: `backup-scripts/backup-database.sh` — handles physical backup,
tarball creation, AES-256 encryption, and optional cloud sync.

```bash
# Physical backup (pg_basebackup) with encryption and cloud sync
./backup-database.sh --sync

# Logical backup (pg_dump) — portable, human-readable
./backup-database.sh --logical --sync
```

### 1c. Restore from backup

**Script**: `backup-scripts/restore-database.sh` — handles decryption, cloud
download, restore, and post-restore verification. Cleans up temp files
automatically.

```bash
# Restore from a local backup
./restore-database.sh --backup=/backups/postgres/logical/crm_20260411.dump

# Restore from Google Drive
./restore-database.sh --from-cloud=gdrive

# Restore from personal drive
./restore-database.sh --from-cloud=personal

# Point-in-time recovery (physical backup)
./restore-database.sh \
  --backup=/backups/postgres/base/crm_base_20260411.tar.gz \
  --target-time="2026-04-11 14:30:00 UTC"

# Skip confirmation prompt (for automation)
./restore-database.sh --from-cloud=s3 --yes
```

---

## 2. Sync backups to personal drive

Use `rclone` to sync backups to any personal drive or cloud storage. It
supports 40+ cloud providers including Google Drive, OneDrive, Dropbox,
AWS S3, and local/USB drives.

### 2a. Initial setup

```bash
# Install rclone
curl https://rclone.org/install.sh | sudo bash

# Configure a remote (interactive wizard)
rclone config

# Example: configure Google Drive
#   Name: gdrive
#   Storage: drive
#   Scope: drive.file
#   (follow OAuth flow)

# Example: configure a local/USB personal drive
#   Name: personal-drive
#   Storage: local
#   (set path to mounted drive, e.g., /mnt/usb-backup)
```

### 2b. Sync backups to Google Drive

```bash
# Sync all backups to Google Drive
rclone sync /backups gdrive:CRM-Backups \
  --progress \
  --transfers=4 \
  --checkers=8 \
  --log-file=/var/log/rclone-backup.log

# Sync only database backups
rclone sync /backups/postgres gdrive:CRM-Backups/postgres \
  --progress
```

### 2c. Sync backups to personal / USB drive

```bash
# Sync to a mounted personal drive
rclone sync /backups /mnt/personal-drive/CRM-Backups \
  --progress \
  --transfers=4

# Sync to a network share (SMB/NFS)
rclone sync /backups smb-share:CRM-Backups \
  --progress
```

### 2d. Sync backups to AWS S3

```bash
# Sync to S3 bucket
rclone sync /backups s3:crm-backups-bucket/$(hostname) \
  --progress \
  --s3-storage-class=STANDARD_IA

# With server-side encryption
rclone sync /backups s3:crm-backups-bucket/$(hostname) \
  --s3-server-side-encryption=aws:kms
```

### 2e. Sync backups to multiple destinations

```bash
# Mirror to both cloud and personal drive for 3-2-1 compliance
rclone sync /backups gdrive:CRM-Backups --progress &
rclone sync /backups /mnt/personal-drive/CRM-Backups --progress &
wait
echo "Backup sync complete to all destinations"
```

---

## 3. Application files & uploads backup

### 3a. User uploads and attachments

```bash
# Sync uploaded files to cloud
rclone sync /data/uploads gdrive:CRM-Backups/uploads \
  --progress \
  --exclude="*.tmp"

# Sync to S3 with versioning
rclone sync /data/uploads s3:crm-backups-bucket/uploads \
  --progress \
  --s3-storage-class=STANDARD_IA
```

### 3b. Application configuration

```bash
# Back up all configuration files
tar czf /backups/config/app-config-$(date +%Y%m%d).tar.gz \
  --exclude="*.secrets" \
  /app/config/ \
  /app/.env.example \
  /app/helm/values-*.yaml

rclone copy /backups/config gdrive:CRM-Backups/config --progress
```

### 3c. Source code bundle

```bash
# Create a portable git bundle (complete repo history)
git bundle create /backups/code/crm-repo-$(date +%Y%m%d).bundle --all

# Sync to personal drive
rclone copy /backups/code /mnt/personal-drive/CRM-Backups/code --progress
```

---

## 4. Automated backup scheduling

The `setup.sh` script installs scheduling automatically. Choose cron, systemd
timers, or both during setup.

### 4a. Cron-based schedule

Installed to `/etc/cron.d/crm-backup` by `setup.sh`:

```bash
# /etc/cron.d/crm-backup

# Database: full backup daily at 2 AM
0 2 * * * root /opt/crm/backup-scripts/backup-database.sh

# Database: logical dump every 6 hours
0 */6 * * * root /opt/crm/backup-scripts/backup-database.sh --logical

# Files: sync uploads every hour
0 * * * * root /opt/crm/backup-scripts/backup-files.sh --uploads-only

# Files: full file backup (uploads + config + code) daily at 3 AM
0 3 * * * root /opt/crm/backup-scripts/backup-files.sh

# Cloud sync: push to personal drive/cloud every 4 hours
0 */4 * * * root /opt/crm/backup-scripts/sync-to-cloud.sh

# Config: back up on every change (via inotifywait)
# Runs as a systemd service: crm-config-watcher.service
# Script: backup-scripts/watch-config.sh

# Cleanup: remove old backups weekly on Sunday at 3 AM
0 3 * * 0 root /opt/crm/backup-scripts/cleanup-old-backups.sh

# Verify: test restore weekly on Saturday at 4 AM
0 4 * * 6 root /opt/crm/backup-scripts/verify-backup.sh
```

### 4b. Systemd timers

Installed by `setup.sh` when systemd is chosen. Includes timers for:

| Timer | Schedule | Script |
|---|---|---|
| `crm-backup-db.timer` | Daily 2 AM | `backup-database.sh --sync` |
| `crm-backup-db-logical.timer` | Every 6 hours | `backup-database.sh --logical` |
| `crm-backup-files.timer` | Hourly | `backup-files.sh` |
| `crm-backup-sync.timer` | Every 4 hours | `sync-to-cloud.sh` |
| `crm-backup-cleanup.timer` | Weekly Sunday 3 AM | `cleanup-old-backups.sh` |
| `crm-backup-verify.timer` | Weekly Saturday 4 AM | `verify-backup.sh` |
| `crm-config-watcher.service` | Continuous | `watch-config.sh` |

```bash
# Check timer status
systemctl list-timers 'crm-*'

# Manually trigger a backup
systemctl start crm-backup-db.service

# View logs
journalctl -u crm-backup-db.service
```

---

## 5. Crash recovery procedures

### 5a. Application crash recovery

When the application crashes unexpectedly:

1. **Check the most recent backup** — verify the latest backup timestamp:
   ```bash
   ls -lt /backups/postgres/base/ | head -5
   rclone ls gdrive:CRM-Backups/postgres/ --max-depth=1 | sort -k2 | tail -5
   ```

2. **Restore the database** from the most recent good backup:
   ```bash
   /opt/crm/backup-scripts/restore-database.sh \
     --backup=/backups/postgres/base/2026-04-11 \
     --target-time="2026-04-11 14:30:00 UTC"
   ```

3. **Restore files** from cloud or personal drive:
   ```bash
   rclone sync gdrive:CRM-Backups/uploads /data/uploads --progress
   ```

4. **Verify data integrity**:
   ```bash
   /opt/crm/backup-scripts/verify-backup.sh --post-restore
   ```

### 5b. Recovery from personal drive

```bash
# Mount your personal drive
mount /dev/sdb1 /mnt/personal-drive

# Restore database (handles decryption, restore, and verification)
./restore-database.sh --from-cloud=personal

# Restore uploads
rclone sync /mnt/personal-drive/CRM-Backups/uploads /data/uploads --progress
```

### 5c. Recovery from cloud (Google Drive / S3)

```bash
# Restore from Google Drive (downloads, decrypts, restores, verifies)
./restore-database.sh --from-cloud=gdrive

# Restore from S3
./restore-database.sh --from-cloud=s3

# Restore uploads from cloud
rclone sync gdrive:CRM-Backups/uploads /data/uploads --progress
```

---

## 6. Backup monitoring & alerting

### 6a. Health checks

Every backup job should report success or failure. A missing report is treated
as a failure.

```bash
# After each backup, report status
if [ $? -eq 0 ]; then
  curl -s https://health-check-service/ping/crm-db-backup
  echo "$(date) [OK] Database backup completed" >> /var/log/crm-backup.log
else
  echo "$(date) [FAIL] Database backup failed" >> /var/log/crm-backup.log
  # Alert on-call
  curl -X POST https://pagerduty-events-api/... \
    -d '{"summary":"CRM database backup failed","severity":"critical"}'
fi
```

### 6b. Backup freshness SLI

| Backup type | Max age before alert |
|---|---|
| Postgres WAL | 5 minutes |
| Postgres full | 26 hours |
| File uploads | 2 hours |
| Cloud sync | 6 hours |
| Config backup | 24 hours |

If any backup exceeds its max age, fire a `backup_stale` alert to the on-call
team.

### 6c. Storage usage monitoring

```bash
# Check local backup disk usage
df -h /backups

# Check cloud storage usage
rclone size gdrive:CRM-Backups
rclone size s3:crm-backups-bucket
```

---

## 7. Backup retention policy

| Location | Retention | Cleanup |
|---|---|---|
| Local disk | 7 days (full), 3 days (WAL) | `cleanup-old-backups.sh` (weekly) |
| Personal drive | 30 days | `cleanup-old-backups.sh` (weekly) |
| Cloud (S3/GDrive) | 90 days (standard), 1 year (archive) | `cleanup-old-backups.sh` + lifecycle policy |
| Cross-region (DR) | 90 days | Lifecycle policy |
| Legal hold | 7 years | Manual release |

Run `cleanup-old-backups.sh --dry-run` to preview what would be deleted.

### Lifecycle rules (S3 example)

```json
{
  "Rules": [
    {
      "ID": "BackupLifecycle",
      "Status": "Enabled",
      "Transitions": [
        { "Days": 30, "StorageClass": "STANDARD_IA" },
        { "Days": 90, "StorageClass": "GLACIER" }
      ],
      "Expiration": { "Days": 365 }
    }
  ]
}
```

---

## 8. Security considerations

- **Encrypt all backups** at rest using GPG or AES-256 before transferring.
- **Use service accounts** with minimal permissions for cloud access (read/write
  to backup bucket only).
- **Rotate cloud credentials** on a schedule (monthly).
- **Never store backup encryption keys alongside the backups** — use a separate
  key management service or offline storage.
- **Audit backup access** — log who downloaded or restored a backup.
- **Network security** — use TLS for all backup transfers; prefer VPN or
  private endpoints for cloud storage.

---

## 9. Restore drill checklist

Run this monthly (automated) and quarterly (manual + verification):

- [ ] Restore yesterday's Postgres backup to a scratch cluster
- [ ] Compare row counts and checksums against production
- [ ] Restore file uploads from cloud to a scratch directory
- [ ] Verify file integrity (checksums match)
- [ ] Restore config files and verify application starts
- [ ] Document restore time (actual RTO vs target RTO)
- [ ] Report results to the team

**If any step fails, treat it as a SEV-3 incident and fix before the next
drill.**

---

## Quick reference: emergency recovery

```
CRASH DETECTED
  │
  ▼
Is the database intact?
  ├─ YES → Restart the app; verify data; done
  │
  ├─ NO, but WAL is available
  │    └─► PITR restore to T-1min before crash
  │        └─► Verify → Promote → Resume
  │
  └─ NO, need full restore
       ├─► Check local backups first (/backups/postgres/)
       ├─► If missing → pull from cloud (gdrive/s3)
       ├─► If missing → pull from personal drive
       └─► Restore → Verify → Resume
```

See [07-disaster-recovery-runbook.md](07-disaster-recovery-runbook.md) for
full incident procedures.

---

## Scripts reference

All scripts are in the `backup-scripts/` directory.

| Script | Purpose | Key flags |
|---|---|---|
| `setup.sh` | Interactive installer: creates dirs, encryption, cloud config, scheduling | Run once with `sudo` |
| `backup-database.sh` | Postgres backup (physical or logical) with encryption | `--logical`, `--sync` |
| `backup-files.sh` | Back up uploads, config, and git repo | `--config-only`, `--uploads-only` |
| `sync-to-cloud.sh` | Sync backups to Google Drive, S3, OneDrive, or personal drive | `--source=<file>`, `--destination=<name>` |
| `restore-database.sh` | Restore DB from local, cloud, or personal drive | `--backup=<path>`, `--from-cloud=<src>`, `--target-time=<ts>` |
| `verify-backup.sh` | Validate freshness, integrity, restore capability, disk space | `--full`, `--post-restore` |
| `archive-wal.sh` | Archive WAL segments (called by PostgreSQL `archive_command`) | `%p %f` (Postgres passes these) |
| `cleanup-old-backups.sh` | Remove old backups per retention policy | `--dry-run` |
| `watch-config.sh` | Watch config dirs for changes, auto-backup on modification | Runs as systemd service |
| `backup.conf` | Shared configuration for all scripts | Edit after `setup.sh` |
