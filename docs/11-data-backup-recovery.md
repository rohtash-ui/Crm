# 11 — Data Backup & Recovery

How to protect CRM data against crashes, corruption, accidental deletion, and
catastrophic events — with options to store backups on a personal drive or
cloud storage.

This guide covers **automated backup**, **manual backup**, **cloud sync**, and
**recovery procedures** for every data store in the platform.

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

```bash
# postgresql.conf — enable WAL archiving
archive_mode = on
archive_command = 'backup-scripts/archive-wal.sh %p %f'
wal_level = replica
```

### 1b. Full database backup (daily)

```bash
# Run daily via cron or systemd timer
pg_basebackup \
  -h localhost \
  -U replication_user \
  -D /backups/postgres/base/$(date +%Y-%m-%d) \
  --wal-method=stream \
  --checkpoint=fast \
  --compress=gzip \
  --progress

# Encrypt the backup
gpg --symmetric --cipher-algo AES256 \
  --output /backups/postgres/base/$(date +%Y-%m-%d).tar.gz.gpg \
  /backups/postgres/base/$(date +%Y-%m-%d).tar.gz
```

### 1c. Logical backup (portable, human-readable)

```bash
# Full logical dump — useful for migration or smaller databases
pg_dump \
  --format=custom \
  --compress=9 \
  --file=/backups/postgres/logical/crm_$(date +%Y%m%d_%H%M%S).dump \
  crm_production

# Per-tenant backup (for tenant isolation)
pg_dump \
  --format=custom \
  --compress=9 \
  --table="*" \
  --file=/backups/postgres/tenants/tenant_${TENANT_ID}_$(date +%Y%m%d).dump \
  --where="tenant_id='${TENANT_ID}'" \
  crm_production
```

### 1d. Restore from backup

```bash
# PITR restore to a specific point in time
pg_restore \
  --dbname=crm_recovery \
  --jobs=4 \
  /backups/postgres/logical/crm_20260411_020000.dump

# Full cluster restore from base backup
# 1. Stop the server
# 2. Replace data directory with backup
# 3. Configure recovery.conf / recovery.signal
restore_command = 'cp /backups/postgres/wal/%f %p'
recovery_target_time = '2026-04-11 14:30:00 UTC'
# 4. Start the server — it replays WAL to the target time
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

### 4a. Cron-based schedule

```bash
# /etc/cron.d/crm-backup

# Database: full backup daily at 2 AM
0 2 * * * root /opt/crm/backup-scripts/backup-database.sh >> /var/log/crm-backup.log 2>&1

# Database: logical dump every 6 hours
0 */6 * * * root /opt/crm/backup-scripts/backup-database-logical.sh >> /var/log/crm-backup.log 2>&1

# Files: sync uploads every hour
0 * * * * root /opt/crm/backup-scripts/backup-files.sh >> /var/log/crm-backup.log 2>&1

# Cloud sync: push to personal drive/cloud every 4 hours
0 */4 * * * root /opt/crm/backup-scripts/sync-to-cloud.sh >> /var/log/crm-backup.log 2>&1

# Config: back up on every change (via inotifywait)
# Handled by backup-scripts/watch-config.sh (runs as a systemd service)

# Cleanup: remove local backups older than 30 days
0 3 * * 0 root /opt/crm/backup-scripts/cleanup-old-backups.sh >> /var/log/crm-backup.log 2>&1

# Verify: test restore weekly
0 4 * * 6 root /opt/crm/backup-scripts/verify-backup.sh >> /var/log/crm-backup.log 2>&1
```

### 4b. Systemd timer (alternative to cron)

```ini
# /etc/systemd/system/crm-backup.timer
[Unit]
Description=CRM Database Backup Timer

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/crm-backup.service
[Unit]
Description=CRM Database Backup
After=postgresql.service

[Service]
Type=oneshot
ExecStart=/opt/crm/backup-scripts/backup-database.sh
User=backup
Group=backup
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

# Restore database backup
cp /mnt/personal-drive/CRM-Backups/postgres/base/2026-04-11.tar.gz.gpg /tmp/
gpg --decrypt /tmp/2026-04-11.tar.gz.gpg | tar xzf - -C /var/lib/postgresql/data/

# Restore uploads
rclone sync /mnt/personal-drive/CRM-Backups/uploads /data/uploads --progress
```

### 5c. Recovery from cloud (Google Drive / S3)

```bash
# Pull latest backup from Google Drive
rclone copy gdrive:CRM-Backups/postgres/base/ /tmp/restore/ \
  --include="*.dump" \
  --max-age=24h \
  --progress

# Pull from S3
rclone copy s3:crm-backups-bucket/postgres/base/ /tmp/restore/ \
  --include="*.dump" \
  --max-age=24h \
  --progress

# Restore
pg_restore --dbname=crm_production --jobs=4 --clean /tmp/restore/latest.dump
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
| Local disk | 7 days (full), 24h (WAL) | Automated weekly |
| Personal drive | 30 days | Automated monthly |
| Cloud (S3/GDrive) | 90 days (standard), 1 year (archive) | Lifecycle policy |
| Cross-region (DR) | 90 days | Lifecycle policy |
| Legal hold | 7 years | Manual release |

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
