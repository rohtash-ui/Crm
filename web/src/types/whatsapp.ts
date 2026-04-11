/**
 * Frontend type definitions for WhatsApp notification feature.
 */

export type LeadEventType =
  | 'lead.created'
  | 'lead.status_changed'
  | 'lead.assigned'
  | 'lead.score_updated'
  | 'lead.activity_detected'
  | 'lead.converted'
  | 'lead.lost'
  | 'lead.reactivated'
  | 'lead.follow_up_due';

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export type LeadScoreTier = 'hot' | 'warm' | 'cold';

export interface NotificationPreferences {
  whatsappEnabled: boolean;
  enabledEvents: LeadEventType[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone: string;
  minScoreTierForAlert: LeadScoreTier;
}

export interface AgentWhatsAppStatus {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string | null;
  whatsappEnabled: boolean;
  enabledEventsCount: number;
  role: string;
}

export interface NotificationMessage {
  id: string;
  eventType: LeadEventType;
  status: MessageStatus;
  agentId: string;
  messageBody: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
}

export interface NotificationLog {
  id: string;
  agentId: string;
  leadId: string;
  eventType: LeadEventType;
  status: MessageStatus;
  createdAt: string;
}

export interface NotificationStats {
  totalSent: number;
  delivered: number;
  read: number;
  failed: number;
  byEventType: Record<string, number>;
}

export interface WhatsAppConfig {
  businessAccountId: string;
  phoneNumberId: string;
  apiVersion: string;
  webhookVerifyToken: string;
  isActive: boolean;
}

// Friendly names for display
export const EVENT_TYPE_LABELS: Record<LeadEventType, string> = {
  'lead.created': 'New Lead Created',
  'lead.status_changed': 'Lead Status Changed',
  'lead.assigned': 'Lead Assigned',
  'lead.score_updated': 'Lead Score Updated',
  'lead.activity_detected': 'Lead Activity Detected',
  'lead.converted': 'Lead Converted',
  'lead.lost': 'Lead Lost',
  'lead.reactivated': 'Lead Reactivated',
  'lead.follow_up_due': 'Follow-up Due',
};

export const STATUS_COLORS: Record<MessageStatus, string> = {
  queued: '#6B7280',
  sent: '#3B82F6',
  delivered: '#10B981',
  read: '#8B5CF6',
  failed: '#EF4444',
};
