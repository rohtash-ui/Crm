// ============================================================================
// CRM Backup Manager — Popup Controller
// ============================================================================

const DEFAULT_API = 'http://localhost:7500';
let apiBase = DEFAULT_API;

// ---- Initialization ----
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.local.get(['apiEndpoint']);
  apiBase = settings.apiEndpoint || DEFAULT_API;

  loadActivityLog();
  refreshStatus();
  bindActions();
});

// ---- API Helper ----
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${apiBase}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- Refresh Status ----
async function refreshStatus() {
  const refreshBtn = document.getElementById('btn-refresh');
  refreshBtn.disabled = true;

  try {
    const data = await api('/status');
    updateConnection('connected', 'Connected to backup server');
    updateBackupCards(data.backups);
    updateSyncStatus(data.sync);
    updateStorage(data.storage);
    updateOverallStatus(data.overall);
    document.getElementById('last-check-time').textContent = formatTime(new Date());

    // Store last status for background checks
    chrome.storage.local.set({ lastStatus: data, lastCheckTime: Date.now() });
  } catch (err) {
    updateConnection('disconnected', `Cannot reach server: ${apiBase}`);
    document.getElementById('btn-reconnect').style.display = 'inline';
  } finally {
    refreshBtn.disabled = false;
  }
}

// ---- Update UI ----
function updateConnection(state, text) {
  const bar = document.getElementById('connection-bar');
  const textEl = document.getElementById('connection-text');
  bar.className = `connection-bar ${state}`;
  textEl.textContent = text;

  if (state === 'connected') {
    document.getElementById('btn-reconnect').style.display = 'none';
  }
}

function updateOverallStatus(status) {
  const el = document.getElementById('overall-status');
  el.textContent = status || 'Unknown';
  el.className = `status-badge status-${statusClass(status)}`;
}

function updateBackupCards(backups) {
  if (!backups) return;

  const mapping = {
    'db-full':    backups.database_full,
    'db-logical': backups.database_logical,
    'files':      backups.files,
    'config':     backups.config,
  };

  for (const [key, info] of Object.entries(mapping)) {
    if (!info) continue;

    const card = document.getElementById(`card-${key}`);
    const statusEl = document.getElementById(`status-${key}`);
    const detailEl = document.getElementById(`detail-${key}`);

    // Set card border color
    card.className = `card card-${statusClass(info.status)}`;

    // Set status badge
    statusEl.textContent = info.status;
    statusEl.className = `card-status status-${statusClass(info.status)}`;

    // Set detail text
    if (info.last_backup) {
      const age = info.age_hours != null ? `${info.age_hours}h ago` : '';
      const size = info.size || '';
      detailEl.textContent = `Last: ${formatTimestamp(info.last_backup)}${size ? ' · ' + size : ''}`;
    } else {
      detailEl.textContent = 'No backup found';
    }
  }
}

function updateSyncStatus(sync) {
  if (!sync) return;

  for (const [provider, info] of Object.entries(sync)) {
    const statusEl = document.getElementById(`sync-status-${provider}`);
    if (!statusEl) continue;

    if (info.configured) {
      statusEl.textContent = info.status || 'OK';
      statusEl.className = `sync-status status-${statusClass(info.status)}`;
    } else {
      statusEl.textContent = 'Not configured';
      statusEl.className = 'sync-status status-unknown';
    }
  }
}

function updateStorage(storage) {
  if (!storage) return;

  const fill = document.getElementById('storage-fill');
  const usedEl = document.getElementById('storage-used');
  const totalEl = document.getElementById('storage-total');

  const pct = storage.percent_used || 0;
  fill.style.width = `${pct}%`;
  fill.className = 'storage-fill' + (pct > 90 ? ' critical' : pct > 75 ? ' warn' : '');

  usedEl.textContent = `${storage.used || '--'} used`;
  totalEl.textContent = `of ${storage.total || '--'}`;
}

// ---- Actions ----
function bindActions() {
  document.getElementById('btn-refresh').addEventListener('click', refreshStatus);

  document.getElementById('btn-reconnect').addEventListener('click', () => {
    document.getElementById('btn-reconnect').style.display = 'none';
    refreshStatus();
  });

  document.getElementById('btn-backup-db').addEventListener('click', () => {
    runAction('/backup/database', 'Database backup');
  });

  document.getElementById('btn-backup-files').addEventListener('click', () => {
    runAction('/backup/files', 'File backup');
  });

  document.getElementById('btn-sync-cloud').addEventListener('click', () => {
    runAction('/backup/sync', 'Cloud sync');
  });

  document.getElementById('btn-verify').addEventListener('click', () => {
    runAction('/backup/verify', 'Backup verification');
  });

  document.getElementById('btn-clear-log').addEventListener('click', clearActivityLog);

  document.getElementById('btn-settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

async function runAction(endpoint, label) {
  // Disable all action buttons while running
  const buttons = document.querySelectorAll('.actions-grid .btn');
  buttons.forEach(b => b.disabled = true);

  addActivity('info', `${label} started...`);
  showToast('info', `${label} started`);

  try {
    const result = await api(endpoint, 'POST');
    addActivity('success', `${label} completed${result.message ? ': ' + result.message : ''}`);
    showToast('success', `${label} completed`);

    // Notify background for badge update
    chrome.runtime.sendMessage({ type: 'backup_completed', label });

    // Refresh status after action
    setTimeout(refreshStatus, 1000);
  } catch (err) {
    addActivity('error', `${label} failed: ${err.message}`);
    showToast('error', `${label} failed`);
  } finally {
    buttons.forEach(b => b.disabled = false);
  }
}

// ---- Activity Log ----
function addActivity(type, message) {
  const log = document.getElementById('activity-log');

  // Remove "empty" placeholder
  const empty = log.querySelector('.activity-empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'activity-item';
  item.innerHTML = `
    <span class="activity-dot ${type}"></span>
    <span class="activity-text">${escapeHtml(message)}</span>
    <span class="activity-time">${formatTime(new Date())}</span>
  `;

  log.prepend(item);

  // Keep max 50 entries
  const items = log.querySelectorAll('.activity-item');
  if (items.length > 50) {
    items[items.length - 1].remove();
  }

  // Persist
  saveActivityLog();
}

function saveActivityLog() {
  const items = document.querySelectorAll('.activity-item');
  const entries = Array.from(items).slice(0, 20).map(item => ({
    type: item.querySelector('.activity-dot').className.split(' ').pop(),
    text: item.querySelector('.activity-text').textContent,
    time: item.querySelector('.activity-time').textContent,
  }));
  chrome.storage.local.set({ activityLog: entries });
}

function loadActivityLog() {
  chrome.storage.local.get(['activityLog'], (result) => {
    const entries = result.activityLog || [];
    if (entries.length === 0) return;

    const log = document.getElementById('activity-log');
    log.innerHTML = '';

    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'activity-item';
      item.innerHTML = `
        <span class="activity-dot ${entry.type}"></span>
        <span class="activity-text">${escapeHtml(entry.text)}</span>
        <span class="activity-time">${entry.time}</span>
      `;
      log.appendChild(item);
    });
  });
}

function clearActivityLog() {
  const log = document.getElementById('activity-log');
  log.innerHTML = '<div class="activity-empty">No recent activity</div>';
  chrome.storage.local.set({ activityLog: [] });
}

// ---- Toast ----
function showToast(type, message) {
  // Remove existing toast
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// ---- Helpers ----
function statusClass(status) {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s === 'healthy' || s === 'ok' || s === 'synced') return 'healthy';
  if (s === 'warning' || s === 'stale') return 'warning';
  if (s === 'error' || s === 'failed' || s === 'missing') return 'error';
  if (s === 'running' || s === 'syncing') return 'running';
  return 'unknown';
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTimestamp(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `Today ${formatTime(d)}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${formatTime(d)}`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + formatTime(d);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
