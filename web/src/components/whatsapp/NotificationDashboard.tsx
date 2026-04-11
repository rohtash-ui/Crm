import React, { useState } from 'react';
import {
  useNotificationStats,
  useNotificationHistory,
  useAgentList,
} from '../../hooks/useWhatsAppNotifications';
import {
  EVENT_TYPE_LABELS,
  STATUS_COLORS,
  LeadEventType,
} from '../../types/whatsapp';

/**
 * WhatsApp Notification Dashboard.
 *
 * Admin/Manager overview showing:
 *   - Key metrics (sent, delivered, read, failed rates)
 *   - Breakdown by event type
 *   - Agent notification status overview
 *   - Recent notification history log
 */

export const NotificationDashboard: React.FC = () => {
  const [statsDays, setStatsDays] = useState(30);
  const { stats, loading: statsLoading } = useNotificationStats(statsDays);
  const { agents, loading: agentsLoading } = useAgentList();
  const [historyFilter, setHistoryFilter] = useState<{
    agentId?: string;
    eventType?: string;
  }>({});
  const {
    logs,
    total,
    page,
    totalPages,
    loading: historyLoading,
    nextPage,
    prevPage,
  } = useNotificationHistory(historyFilter);

  return (
    <div className="wa-dashboard">
      <div className="wa-dashboard-header">
        <h1>WhatsApp Notifications</h1>
        <p className="wa-dashboard-subtitle">
          Automated lead lifecycle notifications to agents via WhatsApp
        </p>
        <div className="wa-period-selector">
          {[7, 14, 30, 90].map((days) => (
            <button
              key={days}
              className={`wa-period-btn ${statsDays === days ? 'active' : ''}`}
              onClick={() => setStatsDays(days)}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      {statsLoading ? (
        <div className="wa-stats-loading">Loading statistics...</div>
      ) : stats ? (
        <>
          <div className="wa-stats-grid">
            <StatCard
              label="Total Sent"
              value={stats.totalSent}
              color="#3B82F6"
            />
            <StatCard
              label="Delivered"
              value={stats.delivered}
              color="#10B981"
              subtext={stats.totalSent > 0
                ? `${Math.round((stats.delivered / stats.totalSent) * 100)}% rate`
                : undefined}
            />
            <StatCard
              label="Read"
              value={stats.read}
              color="#8B5CF6"
              subtext={stats.totalSent > 0
                ? `${Math.round((stats.read / stats.totalSent) * 100)}% rate`
                : undefined}
            />
            <StatCard
              label="Failed"
              value={stats.failed}
              color="#EF4444"
            />
          </div>

          {/* Event Type Breakdown */}
          <section className="wa-dashboard-section">
            <h2>Notifications by Event Type</h2>
            <div className="wa-event-breakdown">
              {Object.entries(stats.byEventType)
                .sort(([, a], [, b]) => b - a)
                .map(([eventType, count]) => {
                  const total = Object.values(stats.byEventType).reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={eventType} className="wa-event-bar-row">
                      <span className="wa-event-bar-label">
                        {EVENT_TYPE_LABELS[eventType as LeadEventType] ?? eventType}
                      </span>
                      <div className="wa-event-bar-track">
                        <div
                          className="wa-event-bar-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="wa-event-bar-count">{count}</span>
                    </div>
                  );
                })}
            </div>
          </section>
        </>
      ) : null}

      {/* Agent Status */}
      <section className="wa-dashboard-section">
        <h2>Agent WhatsApp Status</h2>
        {agentsLoading ? (
          <div>Loading agents...</div>
        ) : (
          <div className="wa-agent-table">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Role</th>
                  <th>WhatsApp</th>
                  <th>Status</th>
                  <th>Events Enabled</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <div className="wa-agent-name">{agent.name}</div>
                      <div className="wa-agent-email">{agent.email}</div>
                    </td>
                    <td>
                      <span className={`wa-role-badge ${agent.role}`}>
                        {agent.role}
                      </span>
                    </td>
                    <td>{agent.whatsappNumber ?? 'Not configured'}</td>
                    <td>
                      <span className={`wa-status-indicator ${agent.whatsappEnabled ? 'active' : 'inactive'}`}>
                        {agent.whatsappEnabled ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{agent.enabledEventsCount} / 9</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Notification History */}
      <section className="wa-dashboard-section">
        <div className="wa-section-header">
          <h2>Notification History</h2>
          <div className="wa-history-filters">
            <select
              value={historyFilter.eventType ?? ''}
              onChange={(e) => setHistoryFilter((prev) => ({
                ...prev,
                eventType: e.target.value || undefined,
              }))}
            >
              <option value="">All Events</option>
              {Object.entries(EVENT_TYPE_LABELS).map(([type, label]) => (
                <option key={type} value={type}>{label}</option>
              ))}
            </select>
            <select
              value={historyFilter.agentId ?? ''}
              onChange={(e) => setHistoryFilter((prev) => ({
                ...prev,
                agentId: e.target.value || undefined,
              }))}
            >
              <option value="">All Agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        {historyLoading ? (
          <div>Loading history...</div>
        ) : (
          <>
            <div className="wa-history-table">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Lead</th>
                    <th>Agent</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="wa-history-time">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td>{EVENT_TYPE_LABELS[log.eventType] ?? log.eventType}</td>
                      <td className="wa-history-lead">{log.leadId}</td>
                      <td>{log.agentId}</td>
                      <td>
                        <span
                          className="wa-history-status"
                          style={{ color: STATUS_COLORS[log.status] }}
                        >
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="wa-pagination">
              <button onClick={prevPage} disabled={page === 0}>Previous</button>
              <span>Page {page + 1} of {totalPages} ({total} total)</span>
              <button onClick={nextPage} disabled={page >= totalPages - 1}>Next</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

interface StatCardProps {
  label: string;
  value: number;
  color: string;
  subtext?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, color, subtext }) => (
  <div className="wa-stat-card" style={{ borderTopColor: color }}>
    <div className="wa-stat-value" style={{ color }}>{value.toLocaleString()}</div>
    <div className="wa-stat-label">{label}</div>
    {subtext && <div className="wa-stat-subtext">{subtext}</div>}
  </div>
);

export default NotificationDashboard;
