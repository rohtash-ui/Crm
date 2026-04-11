// ============================================================================
// CRM Backup Manager — Background Service Worker
// Periodically checks backup health and sends notifications for failures.
// ============================================================================

const DEFAULT_API = 'http://localhost:7500';
const CHECK_INTERVAL_MINUTES = 15;
const ALARM_NAME = 'crm-backup-check';

// ---- Setup alarm on install ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: CHECK_INTERVAL_MINUTES,
  });
  chrome.storage.local.set({ checkInterval: CHECK_INTERVAL_MINUTES });
});

// ---- Handle alarms ----
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkBackupHealth();
  }
});

// ---- Handle messages from popup ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'backup_completed') {
    updateBadge('ok');
    setTimeout(() => clearBadge(), 5000);
  }
  if (message.type === 'update_interval') {
    chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: message.minutes,
      periodInMinutes: message.minutes,
    });
  }
});

// ---- Health Check ----
async function checkBackupHealth() {
  const settings = await chrome.storage.local.get(['apiEndpoint', 'notificationsEnabled']);
  const apiBase = settings.apiEndpoint || DEFAULT_API;
  const notify = settings.notificationsEnabled !== false; // default true

  try {
    const res = await fetch(`${apiBase}/status`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    chrome.storage.local.set({ lastStatus: data, lastCheckTime: Date.now() });

    // Check for issues
    const issues = [];

    if (data.backups) {
      for (const [key, info] of Object.entries(data.backups)) {
        if (info && (info.status === 'error' || info.status === 'missing')) {
          issues.push(`${key}: ${info.status}`);
        } else if (info && info.status === 'stale') {
          issues.push(`${key}: backup is stale (${info.age_hours}h old)`);
        }
      }
    }

    if (data.storage && data.storage.percent_used > 90) {
      issues.push(`Disk ${data.storage.percent_used}% full`);
    }

    if (issues.length > 0) {
      updateBadge('warn', issues.length.toString());
      if (notify) {
        sendNotification(
          'Backup Issues Detected',
          issues.join('\n'),
          'warning'
        );
      }
    } else {
      clearBadge();
    }
  } catch (err) {
    updateBadge('error', '!');
    // Only notify once per disconnect (check last state)
    const lastState = await chrome.storage.local.get(['lastConnectionState']);
    if (lastState.lastConnectionState !== 'disconnected') {
      if (notify) {
        sendNotification(
          'Backup Server Unreachable',
          `Cannot connect to ${apiBase}. Backups may not be running.`,
          'error'
        );
      }
    }
    chrome.storage.local.set({ lastConnectionState: 'disconnected' });
    return;
  }

  chrome.storage.local.set({ lastConnectionState: 'connected' });
}

// ---- Badge ----
function updateBadge(state, text = '') {
  const colors = {
    ok: '#4caf50',
    warn: '#ff9800',
    error: '#f44336',
  };
  chrome.action.setBadgeBackgroundColor({ color: colors[state] || '#78909c' });
  chrome.action.setBadgeText({ text: text });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
}

// ---- Notifications ----
function sendNotification(title, message, type = 'info') {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: title,
    message: message,
    priority: type === 'error' ? 2 : 1,
  });
}
