import React, { useState, useEffect } from 'react';
import { useAgentPreferences } from '../../hooks/useWhatsAppNotifications';
import {
  NotificationPreferences,
  LeadEventType,
  EVENT_TYPE_LABELS,
  LeadScoreTier,
} from '../../types/whatsapp';

/**
 * WhatsApp notification settings panel for an agent.
 *
 * Allows agents to:
 *   - Enable/disable WhatsApp notifications
 *   - Configure their WhatsApp phone number
 *   - Select which lead events trigger notifications
 *   - Set quiet hours and minimum score tier threshold
 */

interface Props {
  agentId: string;
  onSaved?: () => void;
}

const ALL_EVENTS: LeadEventType[] = [
  'lead.created',
  'lead.status_changed',
  'lead.assigned',
  'lead.score_updated',
  'lead.activity_detected',
  'lead.converted',
  'lead.lost',
  'lead.reactivated',
  'lead.follow_up_due',
];

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export const WhatsAppNotificationSettings: React.FC<Props> = ({ agentId, onSaved }) => {
  const {
    preferences,
    whatsappNumber,
    loading,
    saving,
    error,
    updatePreferences,
    updateNumber,
  } = useAgentPreferences(agentId);

  const [form, setForm] = useState<NotificationPreferences>({
    whatsappEnabled: false,
    enabledEvents: [],
    timezone: 'UTC',
    minScoreTierForAlert: 'cold',
  });
  const [phoneNumber, setPhoneNumber] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (preferences) {
      setForm(preferences);
    }
    if (whatsappNumber) {
      setPhoneNumber(whatsappNumber);
    }
  }, [preferences, whatsappNumber]);

  const handleEventToggle = (eventType: LeadEventType) => {
    setForm((prev) => ({
      ...prev,
      enabledEvents: prev.enabledEvents.includes(eventType)
        ? prev.enabledEvents.filter((e) => e !== eventType)
        : [...prev.enabledEvents, eventType],
    }));
  };

  const handleSelectAllEvents = () => {
    setForm((prev) => ({
      ...prev,
      enabledEvents: prev.enabledEvents.length === ALL_EVENTS.length ? [] : [...ALL_EVENTS],
    }));
  };

  const handleSave = async () => {
    try {
      if (phoneNumber !== whatsappNumber) {
        await updateNumber(phoneNumber);
      }
      await updatePreferences(form);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      onSaved?.();
    } catch {
      // Error is already set in the hook
    }
  };

  if (loading) {
    return <div className="wa-settings-loading">Loading notification settings...</div>;
  }

  return (
    <div className="wa-notification-settings">
      <div className="wa-settings-header">
        <h2>WhatsApp Notification Settings</h2>
        <p className="wa-settings-subtitle">
          Configure automated WhatsApp notifications for lead lifecycle events.
          Get notified instantly when leads enter the system, change status, or need follow-up.
        </p>
      </div>

      {error && <div className="wa-error-banner">{error}</div>}
      {saveSuccess && <div className="wa-success-banner">Settings saved successfully!</div>}

      {/* Master Toggle */}
      <section className="wa-settings-section">
        <div className="wa-toggle-row">
          <label className="wa-toggle-label">
            <span className="wa-toggle-title">Enable WhatsApp Notifications</span>
            <span className="wa-toggle-desc">
              Receive lead updates directly on WhatsApp
            </span>
          </label>
          <button
            className={`wa-toggle-switch ${form.whatsappEnabled ? 'active' : ''}`}
            onClick={() => setForm((prev) => ({ ...prev, whatsappEnabled: !prev.whatsappEnabled }))}
            role="switch"
            aria-checked={form.whatsappEnabled}
            aria-label="Enable WhatsApp Notifications"
          >
            <span className="wa-toggle-thumb" />
          </button>
        </div>
      </section>

      {form.whatsappEnabled && (
        <>
          {/* Phone Number */}
          <section className="wa-settings-section">
            <h3>WhatsApp Phone Number</h3>
            <p className="wa-field-desc">Enter your number in international format (e.g., +1234567890)</p>
            <input
              type="tel"
              className="wa-phone-input"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1234567890"
              pattern="^\+\d{10,15}$"
            />
          </section>

          {/* Event Selection */}
          <section className="wa-settings-section">
            <div className="wa-section-header">
              <h3>Lead Events</h3>
              <button className="wa-select-all-btn" onClick={handleSelectAllEvents}>
                {form.enabledEvents.length === ALL_EVENTS.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <p className="wa-field-desc">Choose which lead events trigger a WhatsApp notification</p>

            <div className="wa-event-grid">
              {ALL_EVENTS.map((eventType) => (
                <label key={eventType} className="wa-event-checkbox">
                  <input
                    type="checkbox"
                    checked={form.enabledEvents.includes(eventType)}
                    onChange={() => handleEventToggle(eventType)}
                  />
                  <span className="wa-event-label">
                    <span className="wa-event-icon">{getEventIcon(eventType)}</span>
                    <span>{EVENT_TYPE_LABELS[eventType]}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* Score Tier Threshold */}
          <section className="wa-settings-section">
            <h3>Minimum Lead Score for Alerts</h3>
            <p className="wa-field-desc">
              Only receive notifications for leads at or above this engagement level
            </p>
            <div className="wa-tier-selector">
              {(['cold', 'warm', 'hot'] as LeadScoreTier[]).map((tier) => (
                <button
                  key={tier}
                  className={`wa-tier-btn ${tier} ${form.minScoreTierForAlert === tier ? 'selected' : ''}`}
                  onClick={() => setForm((prev) => ({ ...prev, minScoreTierForAlert: tier }))}
                >
                  <span className="wa-tier-icon">{getTierIcon(tier)}</span>
                  <span className="wa-tier-label">{tier.charAt(0).toUpperCase() + tier.slice(1)}</span>
                  <span className="wa-tier-desc">{getTierDescription(tier)}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Quiet Hours */}
          <section className="wa-settings-section">
            <h3>Quiet Hours</h3>
            <p className="wa-field-desc">
              Pause notifications during off-hours. Messages will be queued and sent when quiet hours end.
            </p>
            <div className="wa-quiet-hours-row">
              <div className="wa-time-field">
                <label>Start</label>
                <input
                  type="time"
                  value={form.quietHoursStart ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, quietHoursStart: e.target.value || undefined }))}
                />
              </div>
              <span className="wa-time-separator">to</span>
              <div className="wa-time-field">
                <label>End</label>
                <input
                  type="time"
                  value={form.quietHoursEnd ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, quietHoursEnd: e.target.value || undefined }))}
                />
              </div>
            </div>

            <div className="wa-timezone-field">
              <label>Timezone</label>
              <select
                value={form.timezone}
                onChange={(e) => setForm((prev) => ({ ...prev, timezone: e.target.value }))}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </section>
        </>
      )}

      {/* Save Button */}
      <div className="wa-settings-actions">
        <button
          className="wa-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

function getEventIcon(eventType: LeadEventType): string {
  const icons: Record<LeadEventType, string> = {
    'lead.created': '\u{1F514}',
    'lead.status_changed': '\u{1F4CB}',
    'lead.assigned': '\u{1F44B}',
    'lead.score_updated': '\u{1F525}',
    'lead.activity_detected': '\u{1F440}',
    'lead.converted': '\u{1F389}',
    'lead.lost': '\u{1F4C9}',
    'lead.reactivated': '\u{1F504}',
    'lead.follow_up_due': '\u{23F0}',
  };
  return icons[eventType] ?? '\u{1F4E8}';
}

function getTierIcon(tier: LeadScoreTier): string {
  const icons: Record<LeadScoreTier, string> = {
    hot: '\u{1F525}',
    warm: '\u{2600}\u{FE0F}',
    cold: '\u{2744}\u{FE0F}',
  };
  return icons[tier];
}

function getTierDescription(tier: LeadScoreTier): string {
  const descriptions: Record<LeadScoreTier, string> = {
    cold: 'All leads',
    warm: 'Warm & hot leads only',
    hot: 'Hot leads only',
  };
  return descriptions[tier];
}

export default WhatsAppNotificationSettings;
