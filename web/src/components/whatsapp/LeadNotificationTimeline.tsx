import React from 'react';
import { useLeadNotificationJourney } from '../../hooks/useWhatsAppNotifications';
import {
  NotificationMessage,
  EVENT_TYPE_LABELS,
  STATUS_COLORS,
  MessageStatus,
} from '../../types/whatsapp';

/**
 * Lead Notification Journey Timeline.
 *
 * Shows all WhatsApp notifications sent throughout a lead's lifecycle,
 * displayed as a chronological timeline on the lead detail page.
 * Agents can see every touchpoint and delivery status at a glance.
 */

interface Props {
  leadId: string;
}

export const LeadNotificationTimeline: React.FC<Props> = ({ leadId }) => {
  const { messages, loading, error } = useLeadNotificationJourney(leadId);

  if (loading) {
    return <div className="wa-timeline-loading">Loading notification history...</div>;
  }

  if (error) {
    return <div className="wa-timeline-error">Failed to load notifications: {error}</div>;
  }

  if (messages.length === 0) {
    return (
      <div className="wa-timeline-empty">
        <p>No WhatsApp notifications have been sent for this lead yet.</p>
        <p className="wa-timeline-empty-hint">
          Notifications will appear here as the lead progresses through the pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="wa-notification-timeline">
      <h3 className="wa-timeline-title">WhatsApp Notification Journey</h3>
      <p className="wa-timeline-subtitle">
        {messages.length} notification{messages.length !== 1 ? 's' : ''} sent for this lead
      </p>

      <div className="wa-timeline">
        {messages.map((message, index) => (
          <TimelineItem
            key={message.id}
            message={message}
            isLast={index === messages.length - 1}
          />
        ))}
      </div>
    </div>
  );
};

interface TimelineItemProps {
  message: NotificationMessage;
  isLast: boolean;
}

const TimelineItem: React.FC<TimelineItemProps> = ({ message, isLast }) => {
  const statusColor = STATUS_COLORS[message.status];
  const eventLabel = EVENT_TYPE_LABELS[message.eventType] ?? message.eventType;

  return (
    <div className="wa-timeline-item">
      {/* Connector line */}
      <div className="wa-timeline-connector">
        <div
          className="wa-timeline-dot"
          style={{ backgroundColor: statusColor }}
        />
        {!isLast && <div className="wa-timeline-line" />}
      </div>

      {/* Content */}
      <div className="wa-timeline-content">
        <div className="wa-timeline-header">
          <span className="wa-timeline-event">{eventLabel}</span>
          <StatusBadge status={message.status} />
        </div>

        <div className="wa-timeline-body">
          <pre className="wa-timeline-message">{message.messageBody}</pre>
        </div>

        <div className="wa-timeline-meta">
          <span className="wa-timeline-time">
            {formatTimestamp(message.createdAt)}
          </span>
          {message.sentAt && (
            <span className="wa-timeline-delivery">
              Sent: {formatTimestamp(message.sentAt)}
            </span>
          )}
          {message.deliveredAt && (
            <span className="wa-timeline-delivery">
              Delivered: {formatTimestamp(message.deliveredAt)}
            </span>
          )}
          {message.readAt && (
            <span className="wa-timeline-delivery">
              Read: {formatTimestamp(message.readAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: MessageStatus }> = ({ status }) => {
  const color = STATUS_COLORS[status];
  const labels: Record<MessageStatus, string> = {
    queued: 'Queued',
    sent: 'Sent',
    delivered: 'Delivered',
    read: 'Read',
    failed: 'Failed',
  };

  return (
    <span
      className="wa-status-badge"
      style={{ backgroundColor: `${color}20`, color, borderColor: color }}
    >
      {getStatusIcon(status)} {labels[status]}
    </span>
  );
};

function getStatusIcon(status: MessageStatus): string {
  const icons: Record<MessageStatus, string> = {
    queued: '\u{1F551}',
    sent: '\u{2705}',
    delivered: '\u{2705}\u{2705}',
    read: '\u{1F7E2}',
    failed: '\u{274C}',
  };
  return icons[status];
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default LeadNotificationTimeline;
