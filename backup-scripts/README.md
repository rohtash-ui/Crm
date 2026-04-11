# Backup Scripts

Automated backup, cloud sync, and recovery tools for the CRM platform.

## Quick start

```bash
# 1. Configure your environment
cp backup.conf backup.conf.local
vi backup.conf.local

# 2. Set up cloud remotes (interactive)
rclone config

# 3. Make scripts executable
chmod +x *.sh

# 4. Run your first backup
./backup-database.sh --logical --sync
./backup-files.sh
./verify-backup.sh
```

## Scripts

| Script | Purpose |
|---|---|
| `backup-database.sh` | Full or logical Postgres backup with optional encryption and cloud sync |
| `backup-files.sh` | Back up user uploads, app config, and git repo |
| `sync-to-cloud.sh` | Sync local backups to Google Drive, S3, OneDrive, or personal drive |
| `restore-database.sh` | Restore database from local, cloud, or personal drive backup |
| `verify-backup.sh` | Verify backup freshness, integrity, and restore capability |
| `backup.conf` | Shared configuration for all scripts |

## Supported destinations

- **Google Drive** — via rclone (`gdrive`)
- **AWS S3** — via rclone (`s3`)
- **OneDrive** — via rclone (`onedrive`)
- **Personal / USB drive** — direct rsync to mounted path
- **Any rclone remote** — 40+ cloud providers supported

## Recovery

```bash
# From local backup
./restore-database.sh --backup=/backups/postgres/logical/crm_20260411.dump

# From Google Drive
./restore-database.sh --from-cloud=gdrive

# From personal drive
./restore-database.sh --from-cloud=personal

# Point-in-time recovery
./restore-database.sh --backup=/backups/postgres/base/crm_base_20260411.tar.gz \
  --target-time="2026-04-11 14:30:00 UTC"
```

See [docs/11-data-backup-recovery.md](../docs/11-data-backup-recovery.md) for the full guide.
