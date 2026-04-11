/**
 * API client for WhatsApp notification service endpoints.
 *
 * Integrates with the CRM's standard API client pattern.
 * Tenant ID is injected via request interceptor from auth context.
 */

import {
  NotificationPreferences,
  NotificationMessage,
  NotificationLog,
  NotificationStats,
  AgentWhatsAppStatus,
  WhatsAppConfig,
  LeadEventType,
} from '../types/whatsapp';

const API_BASE = '/api/v1';

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error ?? `HTTP ${response.status}`);
  }

  return response.json();
}

// ─── Agent Preferences ────────────────────────────────────────────────────────

export async function getAgentPreferences(agentId: string): Promise<{
  agentId: string;
  whatsappNumber: string;
  preferences: NotificationPreferences;
}> {
  return apiRequest(`/agents/${agentId}/whatsapp-preferences`);
}

export async function updateAgentPreferences(
  agentId: string,
  preferences: NotificationPreferences,
): Promise<{ success: boolean }> {
  return apiRequest(`/agents/${agentId}/whatsapp-preferences`, {
    method: 'PUT',
    body: JSON.stringify(preferences),
  });
}

export async function updateAgentWhatsAppNumber(
  agentId: string,
  whatsappNumber: string,
): Promise<{ success: boolean }> {
  return apiRequest(`/agents/${agentId}/whatsapp-number`, {
    method: 'PUT',
    body: JSON.stringify({ whatsappNumber }),
  });
}

// ─── Notification History ─────────────────────────────────────────────────────

export async function getNotificationHistory(filters: {
  agentId?: string;
  leadId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: NotificationLog[]; total: number }> {
  const params = new URLSearchParams();
  if (filters.agentId) params.set('agentId', filters.agentId);
  if (filters.leadId) params.set('leadId', filters.leadId);
  if (filters.eventType) params.set('eventType', filters.eventType);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));

  return apiRequest(`/notifications/history?${params}`);
}

export async function getLeadNotifications(leadId: string): Promise<{
  leadId: string;
  totalMessages: number;
  messages: NotificationMessage[];
}> {
  return apiRequest(`/notifications/lead/${leadId}`);
}

export async function getAgentNotifications(agentId: string): Promise<{
  agentId: string;
  totalMessages: number;
  messages: NotificationMessage[];
}> {
  return apiRequest(`/notifications/agent/${agentId}`);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getNotificationStats(days?: number): Promise<NotificationStats> {
  const params = days ? `?days=${days}` : '';
  return apiRequest(`/notifications/stats${params}`);
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export async function getAgents(): Promise<{ agents: AgentWhatsAppStatus[] }> {
  return apiRequest('/agents');
}

// ─── WhatsApp Config ──────────────────────────────────────────────────────────

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  return apiRequest('/whatsapp/config');
}

export async function updateWhatsAppConfig(
  config: Omit<WhatsAppConfig, 'isActive'> & { isActive?: boolean },
): Promise<{ success: boolean }> {
  return apiRequest('/whatsapp/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// ─── Templates ────────────────────────────────────────────────────────────────

export async function getNotificationTemplates(): Promise<{
  templates: Array<{
    id: string;
    eventType: LeadEventType;
    templateName: string;
    language: string;
    bodyText: string;
    isActive: boolean;
  }>;
}> {
  return apiRequest('/whatsapp/templates');
}
