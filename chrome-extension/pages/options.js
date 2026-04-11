// ============================================================================
// CRM Backup Manager — Options Page Controller
// ============================================================================

const DEFAULTS = {
  apiEndpoint: 'http://localhost:7500',
  checkInterval: 15,
  notificationsEnabled: true,
  thresholds: {
    dbFull: 26,
    dbLogical: 8,
    files: 2,
    config: 48,
  },
};

// ---- Load settings ----
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.local.get([
    'apiEndpoint',
    'checkInterval',
    'notificationsEnabled',
    'thresholds',
  ]);

  const thresholds = settings.thresholds || DEFAULTS.thresholds;

  document.getElementById('api-endpoint').value = settings.apiEndpoint || DEFAULTS.apiEndpoint;
  document.getElementById('check-interval').value = settings.checkInterval || DEFAULTS.checkInterval;
  document.getElementById('notifications-enabled').checked =
    settings.notificationsEnabled !== undefined ? settings.notificationsEnabled : DEFAULTS.notificationsEnabled;
  document.getElementById('threshold-db-full').value = thresholds.dbFull || DEFAULTS.thresholds.dbFull;
  document.getElementById('threshold-db-logical').value = thresholds.dbLogical || DEFAULTS.thresholds.dbLogical;
  document.getElementById('threshold-files').value = thresholds.files || DEFAULTS.thresholds.files;
  document.getElementById('threshold-config').value = thresholds.config || DEFAULTS.thresholds.config;

  bindActions();
});

function bindActions() {
  document.getElementById('btn-save').addEventListener('click', saveSettings);
  document.getElementById('btn-reset').addEventListener('click', resetDefaults);
  document.getElementById('btn-test').addEventListener('click', testConnection);
  document.getElementById('btn-clear-data').addEventListener('click', clearAllData);
}

async function saveSettings() {
  const settings = {
    apiEndpoint: document.getElementById('api-endpoint').value.replace(/\/+$/, ''),
    checkInterval: parseInt(document.getElementById('check-interval').value) || DEFAULTS.checkInterval,
    notificationsEnabled: document.getElementById('notifications-enabled').checked,
    thresholds: {
      dbFull: parseInt(document.getElementById('threshold-db-full').value) || DEFAULTS.thresholds.dbFull,
      dbLogical: parseInt(document.getElementById('threshold-db-logical').value) || DEFAULTS.thresholds.dbLogical,
      files: parseInt(document.getElementById('threshold-files').value) || DEFAULTS.thresholds.files,
      config: parseInt(document.getElementById('threshold-config').value) || DEFAULTS.thresholds.config,
    },
  };

  await chrome.storage.local.set(settings);

  // Update background alarm interval
  chrome.runtime.sendMessage({
    type: 'update_interval',
    minutes: settings.checkInterval,
  });

  showToast('Settings saved');
}

function resetDefaults() {
  document.getElementById('api-endpoint').value = DEFAULTS.apiEndpoint;
  document.getElementById('check-interval').value = DEFAULTS.checkInterval;
  document.getElementById('notifications-enabled').checked = DEFAULTS.notificationsEnabled;
  document.getElementById('threshold-db-full').value = DEFAULTS.thresholds.dbFull;
  document.getElementById('threshold-db-logical').value = DEFAULTS.thresholds.dbLogical;
  document.getElementById('threshold-files').value = DEFAULTS.thresholds.files;
  document.getElementById('threshold-config').value = DEFAULTS.thresholds.config;
  showToast('Defaults restored — click Save to apply');
}

async function testConnection() {
  const endpoint = document.getElementById('api-endpoint').value.replace(/\/+$/, '');
  const resultEl = document.getElementById('test-result');

  resultEl.textContent = 'Testing...';
  resultEl.className = '';

  try {
    const res = await fetch(`${endpoint}/health`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      resultEl.textContent = 'Connected';
      resultEl.className = 'test-result success';
    } else {
      resultEl.textContent = `Error: HTTP ${res.status}`;
      resultEl.className = 'test-result fail';
    }
  } catch (err) {
    resultEl.textContent = 'Cannot connect';
    resultEl.className = 'test-result fail';
  }
}

async function clearAllData() {
  if (confirm('Clear all extension data? This resets settings, activity log, and cached status.')) {
    await chrome.storage.local.clear();
    showToast('All data cleared');
    setTimeout(() => location.reload(), 1000);
  }
}

function showToast(message) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
