import React, { useState } from 'react';
import { WhatsAppNotificationSettings } from '../../components/whatsapp/WhatsAppNotificationSettings';
import { NotificationDashboard } from '../../components/whatsapp/NotificationDashboard';

/**
 * Main WhatsApp settings page — tabs between dashboard and settings.
 *
 * Route: /settings/whatsapp-notifications
 *
 * Admin view: Dashboard + global config
 * Agent view: Personal notification settings
 */

type Tab = 'dashboard' | 'settings' | 'config';

interface Props {
  currentAgentId: string;
  isAdmin: boolean;
}

export const WhatsAppSettingsPage: React.FC<Props> = ({ currentAgentId, isAdmin }) => {
  const [activeTab, setActiveTab] = useState<Tab>(isAdmin ? 'dashboard' : 'settings');

  const tabs: { id: Tab; label: string; adminOnly: boolean }[] = [
    { id: 'dashboard', label: 'Dashboard', adminOnly: true },
    { id: 'settings', label: 'My Notifications', adminOnly: false },
    { id: 'config', label: 'WhatsApp Config', adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="wa-page">
      <nav className="wa-tabs">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            className={`wa-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="wa-tab-content">
        {activeTab === 'dashboard' && isAdmin && (
          <NotificationDashboard />
        )}

        {activeTab === 'settings' && (
          <WhatsAppNotificationSettings agentId={currentAgentId} />
        )}

        {activeTab === 'config' && isAdmin && (
          <WhatsAppAdminConfig />
        )}
      </div>
    </div>
  );
};

/**
 * Admin configuration panel for WhatsApp Business API credentials.
 */
const WhatsAppAdminConfig: React.FC = () => {
  const [config, setConfig] = useState({
    businessAccountId: '',
    phoneNumberId: '',
    apiVersion: 'v18.0',
    webhookVerifyToken: '',
    isActive: true,
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch('/api/v1/whatsapp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });

      if (!response.ok) throw new Error('Failed to save');
      setStatus({ type: 'success', message: 'Configuration saved successfully' });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save configuration',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wa-admin-config">
      <h2>WhatsApp Business API Configuration</h2>
      <p className="wa-config-desc">
        Connect your WhatsApp Business Account to enable automated lead notifications.
        You'll need credentials from Meta Business Manager.
      </p>

      {status && (
        <div className={`wa-config-status ${status.type}`}>
          {status.message}
        </div>
      )}

      <div className="wa-config-form">
        <div className="wa-config-field">
          <label>Business Account ID</label>
          <input
            type="text"
            value={config.businessAccountId}
            onChange={(e) => setConfig((prev) => ({ ...prev, businessAccountId: e.target.value }))}
            placeholder="Enter your WhatsApp Business Account ID"
          />
        </div>

        <div className="wa-config-field">
          <label>Phone Number ID</label>
          <input
            type="text"
            value={config.phoneNumberId}
            onChange={(e) => setConfig((prev) => ({ ...prev, phoneNumberId: e.target.value }))}
            placeholder="Enter the Phone Number ID from Meta"
          />
        </div>

        <div className="wa-config-field">
          <label>API Version</label>
          <select
            value={config.apiVersion}
            onChange={(e) => setConfig((prev) => ({ ...prev, apiVersion: e.target.value }))}
          >
            <option value="v18.0">v18.0</option>
            <option value="v19.0">v19.0</option>
            <option value="v20.0">v20.0</option>
          </select>
        </div>

        <div className="wa-config-field">
          <label>Webhook Verify Token</label>
          <input
            type="password"
            value={config.webhookVerifyToken}
            onChange={(e) => setConfig((prev) => ({ ...prev, webhookVerifyToken: e.target.value }))}
            placeholder="Minimum 8 characters"
          />
          <span className="wa-field-hint">
            This token is used to verify webhook callbacks from Meta.
          </span>
        </div>

        <div className="wa-toggle-row">
          <label>Active</label>
          <button
            className={`wa-toggle-switch ${config.isActive ? 'active' : ''}`}
            onClick={() => setConfig((prev) => ({ ...prev, isActive: !prev.isActive }))}
            role="switch"
            aria-checked={config.isActive}
          >
            <span className="wa-toggle-thumb" />
          </button>
        </div>

        <button
          className="wa-save-btn"
          onClick={handleSave}
          disabled={saving || !config.businessAccountId || !config.phoneNumberId || config.webhookVerifyToken.length < 8}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      <div className="wa-config-webhook-info">
        <h3>Webhook Setup</h3>
        <p>Configure the following webhook URL in your Meta Business Manager:</p>
        <code className="wa-webhook-url">
          https://your-crm-domain.com/webhook/whatsapp
        </code>
        <p>
          Select "messages" as the subscribed field to receive delivery status updates.
        </p>
      </div>
    </div>
  );
};

export default WhatsAppSettingsPage;
