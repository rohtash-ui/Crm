# CRM Backup Manager — Chrome Extension

A Chrome extension that monitors, triggers, and manages CRM data backups directly from your browser.

## Features

- **Dashboard** — See backup status at a glance (database, files, config, cloud sync)
- **One-click backups** — Trigger database, file, or cloud sync backups instantly
- **Health monitoring** — Background checks every 15 minutes with desktop notifications
- **Cloud sync status** — Google Drive, AWS S3, and personal drive indicators
- **Storage monitoring** — Disk usage with visual progress bar
- **Activity log** — Track all backup operations with timestamps
- **Configurable alerts** — Set freshness thresholds per backup type

## Installation

### 1. Start the backup API server

The extension communicates with a lightweight Node.js API server that runs alongside your backup scripts.

```bash
# From the project root
node chrome-extension/backup-api-server.js

# Or with custom settings
PORT=7500 SCRIPTS_DIR=/opt/crm/backup-scripts BACKUP_DIR=/backups \
  node chrome-extension/backup-api-server.js
```

The server runs on `http://localhost:7500` by default.

### 2. Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `chrome-extension/` directory
5. The CRM Backup icon appears in your toolbar

### 3. Configure (optional)

Click the extension icon, then **Settings** to:
- Change the API endpoint (if the server runs on a different host/port)
- Adjust health check interval
- Set backup freshness alert thresholds
- Enable/disable desktop notifications

## API Server Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server health check |
| `GET` | `/status` | Full backup status (backups, sync, storage) |
| `POST` | `/backup/database` | Trigger database backup |
| `POST` | `/backup/files` | Trigger file backup |
| `POST` | `/backup/sync` | Trigger cloud sync |
| `POST` | `/backup/verify` | Run backup verification |
| `GET` | `/logs?lines=50` | Tail backup log file |

## Architecture

```
Chrome Extension                    Server
┌─────────────────┐           ┌──────────────────┐
│  popup.html/js  │──HTTP────▶│ backup-api-server │
│  background.js  │◀──JSON───│   (Node.js)       │
│  options page   │           │                   │
└─────────────────┘           │  Calls scripts:   │
                              │  ├─ backup-database│
       Notifications          │  ├─ backup-files   │
       Badge updates          │  ├─ sync-to-cloud  │
       Activity log           │  └─ verify-backup  │
                              └──────────────────┘
```

## Regenerate Icons

```bash
node generate-icons.js
```

## Development

- **Manifest V3** — Uses service workers, no persistent background page
- **No build step** — Pure HTML/CSS/JS, no bundler needed
- **No external deps** — Both extension and API server use only built-ins
