import React, { useState, useEffect, useRef } from 'react';
import {
  NotificationMessage,
  EVENT_TYPE_LABELS,
  STATUS_COLORS,
} from '../../types/whatsapp';
import * as api from '../../services/whatsapp-api';

/**
 * WhatsApp notification bell icon for the top navigation bar.
 *
 * Shows a badge with unread notification count and a dropdown
 * with recent WhatsApp notifications sent to the current agent.
 */

interface Props {
  agentId: string;
}

export const WhatsAppNotificationBell: React.FC<Props> = ({ agentId }) => {
  const [notifications, setNotifications] = useState<NotificationMessage[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch recent notifications
  useEffect(() => {
    if (!agentId) return;

    const fetchNotifications = async () => {
      try {
        const data = await api.getAgentNotifications(agentId);
        setNotifications(data.messages.slice(0, 10)); // Latest 10
        setUnreadCount(
          data.messages.filter(
            (m) => m.status === 'sent' || m.status === 'delivered',
          ).length,
        );
      } catch {
        // Silently fail — bell is non-critical UI
      }
    };

    fetchNotifications();
    // Poll every 30 seconds for new notifications
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [agentId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="wa-bell-container" ref={dropdownRef}>
      <button
        className="wa-bell-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`WhatsApp notifications${unreadCount > 0 ? ` (${unreadCount} new)` : ''}`}
      >
        <WhatsAppIcon />
        {unreadCount > 0 && (
          <span className="wa-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="wa-bell-dropdown">
          <div className="wa-bell-dropdown-header">
            <h4>WhatsApp Notifications</h4>
          </div>

          {notifications.length === 0 ? (
            <div className="wa-bell-empty">No recent notifications</div>
          ) : (
            <div className="wa-bell-list">
              {notifications.map((n) => (
                <div key={n.id} className="wa-bell-item">
                  <div className="wa-bell-item-header">
                    <span className="wa-bell-event">
                      {EVENT_TYPE_LABELS[n.eventType]}
                    </span>
                    <span
                      className="wa-bell-status"
                      style={{ color: STATUS_COLORS[n.status] }}
                    >
                      {n.status}
                    </span>
                  </div>
                  <div className="wa-bell-item-time">
                    {formatRelativeTime(n.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <a className="wa-bell-view-all" href="/settings/whatsapp-notifications">
            View all notifications
          </a>
        </div>
      )}
    </div>
  );
};

const WhatsAppIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default WhatsAppNotificationBell;
