import { useState, useEffect, useCallback } from 'react';
import {
  NotificationPreferences,
  NotificationMessage,
  NotificationStats,
  AgentWhatsAppStatus,
  NotificationLog,
} from '../types/whatsapp';
import * as api from '../services/whatsapp-api';

/**
 * Hook for managing agent WhatsApp notification preferences.
 */
export function useAgentPreferences(agentId: string) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [whatsappNumber, setWhatsappNumber] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;

    setLoading(true);
    api.getAgentPreferences(agentId)
      .then((data) => {
        setPreferences(data.preferences);
        setWhatsappNumber(data.whatsappNumber);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [agentId]);

  const updatePreferences = useCallback(async (updated: NotificationPreferences) => {
    setSaving(true);
    setError(null);
    try {
      await api.updateAgentPreferences(agentId, updated);
      setPreferences(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [agentId]);

  const updateNumber = useCallback(async (number: string) => {
    setSaving(true);
    setError(null);
    try {
      await api.updateAgentWhatsAppNumber(agentId, number);
      setWhatsappNumber(number);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [agentId]);

  return {
    preferences,
    whatsappNumber,
    loading,
    saving,
    error,
    updatePreferences,
    updateNumber,
  };
}

/**
 * Hook for the lead notification journey timeline.
 */
export function useLeadNotificationJourney(leadId: string) {
  const [messages, setMessages] = useState<NotificationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) return;

    setLoading(true);
    api.getLeadNotifications(leadId)
      .then((data) => setMessages(data.messages))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [leadId]);

  return { messages, loading, error };
}

/**
 * Hook for notification statistics dashboard.
 */
export function useNotificationStats(days = 30) {
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getNotificationStats(days)
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  return { stats, loading, error };
}

/**
 * Hook for notification history with pagination and filtering.
 */
export function useNotificationHistory(filters: {
  agentId?: string;
  leadId?: string;
  eventType?: string;
}) {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  // Stabilize filter values to avoid stale closures
  const { agentId, leadId, eventType } = filters;

  const fetchPage = useCallback(async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getNotificationHistory({
        agentId,
        leadId,
        eventType,
        limit: pageSize,
        offset: pageNum * pageSize,
      });
      setLogs(result.logs);
      setTotal(result.total);
      setPage(pageNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [agentId, leadId, eventType, pageSize]);

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage]);

  return {
    logs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    loading,
    error,
    goToPage: fetchPage,
    nextPage: () => fetchPage(page + 1),
    prevPage: () => fetchPage(Math.max(0, page - 1)),
  };
}

/**
 * Hook for agent list with WhatsApp status.
 */
export function useAgentList() {
  const [agents, setAgents] = useState<AgentWhatsAppStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(() => {
    setLoading(true);
    api.getAgents()
      .then((data) => setAgents(data.agents))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, error, refresh: fetchAgents };
}
