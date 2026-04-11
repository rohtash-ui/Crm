#!/usr/bin/env node
// ============================================================================
// CRM Backup API Server
// Lightweight HTTP server that the Chrome extension calls to trigger backup
// scripts and read status. Runs alongside the backup scripts on the server.
//
// Usage: node backup-api-server.js
// Port:  7500 (default) or set PORT env var
//
// No external dependencies — uses only Node.js built-ins.
// ============================================================================

const http = require('http');
const { execFile, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '7500', 10);
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.resolve(__dirname, '..', 'backup-scripts');
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const LOG_FILE = process.env.LOG_FILE || '/var/log/crm-backup.log';

// ---- CORS headers ----
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function jsonResponse(res, statusCode, data) {
  setCors(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ---- Helpers ----
function findLatestFile(dir, extensions) {
  try {
    if (!fs.existsSync(dir)) return null;

    const files = fs.readdirSync(dir)
      .filter(f => extensions.some(ext => f.endsWith(ext)))
      .map(f => {
        const fullPath = path.join(dir, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, mtime: stat.mtime, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime);

    return files[0] || null;
  } catch {
    return null;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function ageHours(date) {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));
}

function backupStatus(file, maxHours) {
  if (!file) return { status: 'missing', last_backup: null, age_hours: null, size: null };

  const hours = ageHours(file.mtime);
  let status = 'healthy';
  if (hours > maxHours * 2) status = 'error';
  else if (hours > maxHours) status = 'stale';

  return {
    status,
    last_backup: file.mtime.toISOString(),
    age_hours: hours,
    size: formatSize(file.size),
    file: file.name,
  };
}

function getDiskUsage(dir) {
  return new Promise((resolve) => {
    exec(`df -B1 "${dir}" 2>/dev/null | tail -1`, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ used: '--', total: '--', percent_used: 0 });
        return;
      }
      const parts = stdout.trim().split(/\s+/);
      const total = parseInt(parts[1]) || 0;
      const used = parseInt(parts[2]) || 0;
      const pct = parseInt((parts[4] || '0').replace('%', '')) || 0;
      resolve({
        used: formatSize(used),
        total: formatSize(total),
        percent_used: pct,
      });
    });
  });
}

function checkRcloneRemote(remoteName) {
  return new Promise((resolve) => {
    exec(`rclone listremotes 2>/dev/null`, (err, stdout) => {
      if (err || !stdout) {
        resolve({ configured: false, status: 'not configured' });
        return;
      }
      const configured = stdout.split('\n').some(l => l.trim() === `${remoteName}:`);
      resolve({ configured, status: configured ? 'ok' : 'not configured' });
    });
  });
}

// ---- Build full status ----
async function getFullStatus() {
  const dbFullFile = findLatestFile(path.join(BACKUP_DIR, 'postgres', 'base'), ['.tar.gz', '.gpg', '.dump']);
  const dbLogicalFile = findLatestFile(path.join(BACKUP_DIR, 'postgres', 'logical'), ['.dump', '.gpg']);
  const filesFile = findLatestFile(path.join(BACKUP_DIR, 'uploads'), ['.tar.gz', '.gpg', '']);
  const configFile = findLatestFile(path.join(BACKUP_DIR, 'config'), ['.tar.gz']);

  // Check uploads dir directly (rsync mirror, so check dir mtime)
  let uploadStatus = backupStatus(filesFile, 2);
  if (uploadStatus.status === 'missing') {
    const uploadsDir = path.join(BACKUP_DIR, 'uploads');
    try {
      const stat = fs.statSync(uploadsDir);
      const files = fs.readdirSync(uploadsDir);
      if (files.length > 0) {
        uploadStatus = {
          status: ageHours(stat.mtime) > 4 ? 'stale' : 'healthy',
          last_backup: stat.mtime.toISOString(),
          age_hours: ageHours(stat.mtime),
          size: `${files.length} files`,
        };
      }
    } catch {
      // keep missing
    }
  }

  const [storage, gdrive, s3, personal] = await Promise.all([
    getDiskUsage(BACKUP_DIR),
    checkRcloneRemote('gdrive'),
    checkRcloneRemote('s3'),
    new Promise((resolve) => {
      const drivePath = '/mnt/personal-drive';
      const mounted = fs.existsSync(drivePath);
      resolve({
        configured: mounted,
        status: mounted ? 'ok' : 'not mounted',
      });
    }),
  ]);

  const backups = {
    database_full: backupStatus(dbFullFile, 26),
    database_logical: backupStatus(dbLogicalFile, 8),
    files: uploadStatus,
    config: backupStatus(configFile, 48),
  };

  // Determine overall status
  const statuses = Object.values(backups).map(b => b.status);
  let overall = 'Healthy';
  if (statuses.some(s => s === 'error' || s === 'missing')) overall = 'Error';
  else if (statuses.some(s => s === 'stale')) overall = 'Warning';

  return {
    overall,
    backups,
    sync: { gdrive, s3, personal },
    storage,
    server_time: new Date().toISOString(),
  };
}

// ---- Run a backup script ----
function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);

    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`Script not found: ${scriptPath}`));
      return;
    }

    execFile(scriptPath, args, { timeout: 600000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// ---- Routes ----
const routes = {
  'GET /health': async (req, res) => {
    jsonResponse(res, 200, { status: 'ok', server: 'crm-backup-api', uptime: process.uptime() });
  },

  'GET /status': async (req, res) => {
    try {
      const status = await getFullStatus();
      jsonResponse(res, 200, status);
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
  },

  'POST /backup/database': async (req, res) => {
    try {
      const output = await runScript('backup-database.sh', ['--logical', '--sync']);
      jsonResponse(res, 200, { success: true, message: 'Database backup completed', output });
    } catch (err) {
      jsonResponse(res, 500, { success: false, error: err.message });
    }
  },

  'POST /backup/files': async (req, res) => {
    try {
      const output = await runScript('backup-files.sh');
      jsonResponse(res, 200, { success: true, message: 'File backup completed', output });
    } catch (err) {
      jsonResponse(res, 500, { success: false, error: err.message });
    }
  },

  'POST /backup/sync': async (req, res) => {
    try {
      const output = await runScript('sync-to-cloud.sh');
      jsonResponse(res, 200, { success: true, message: 'Cloud sync completed', output });
    } catch (err) {
      jsonResponse(res, 500, { success: false, error: err.message });
    }
  },

  'POST /backup/verify': async (req, res) => {
    try {
      const output = await runScript('verify-backup.sh');
      jsonResponse(res, 200, { success: true, message: 'Verification completed', output });
    } catch (err) {
      jsonResponse(res, 500, { success: false, error: err.message });
    }
  },

  'GET /logs': async (req, res) => {
    try {
      const lines = parseInt(new URL(req.url, `http://localhost`).searchParams.get('lines') || '50');
      const content = fs.existsSync(LOG_FILE)
        ? fs.readFileSync(LOG_FILE, 'utf-8').split('\n').slice(-lines).join('\n')
        : 'No log file found';
      jsonResponse(res, 200, { lines: content.split('\n').length, content });
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
  },
};

// ---- Server ----
const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const routeKey = `${req.method} ${req.url.split('?')[0]}`;
  const handler = routes[routeKey];

  if (handler) {
    try {
      await handler(req, res);
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
  } else {
    jsonResponse(res, 404, { error: 'Not found', available: Object.keys(routes) });
  }
});

server.listen(PORT, () => {
  console.log(`CRM Backup API server running on http://localhost:${PORT}`);
  console.log(`Scripts directory: ${SCRIPTS_DIR}`);
  console.log(`Backup directory: ${BACKUP_DIR}`);
  console.log('');
  console.log('Endpoints:');
  Object.keys(routes).forEach(r => console.log(`  ${r}`));
});
