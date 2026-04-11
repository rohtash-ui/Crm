/**
 * Core domain types for WhatsApp lead notification service.
 *
 * Lead lifecycle events that trigger WhatsApp notifications to assigned agents:
 *   - Lead created (new lead enters the system)
 *   - Lead status changed (qualification, conversion, etc.)
 *   - Lead assigned/reassigned to agent
 *   - Lead score updated (hot/warm/cold threshold crossed)
 *   - Lead activity detected (email opened, link clicked, form submitted)
 */

// ─── Lead Event Types ────────────────────────────────────────────────────────

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

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal_sent'
  | 'negotiation'
  | 'won'
  | 'lost'
  | 'dormant';

export type LeadScoreTier = 'hot' | 'warm' | 'cold';

export interface LeadEvent {
  eventId: string;
  eventType: LeadEventType;
  tenantId: string;
  leadId: string;
  leadName: string;
  leadEmail?: string;
  leadPhone?: string;
  leadSource?: string;
  leadScore?: number;
  leadScoreTier?: LeadScoreTier;
  previousStatus?: LeadStatus;
  currentStatus?: LeadStatus;
  assignedAgentId: string;
  previousAgentId?: string;
  dealValue?: number;
  currency?: string;
  metadata?: Record<string, string>;
  occurredAt: string;  // ISO 8601
}

// ─── Agent / User Types ──────────────────────────────────────────────────────

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  whatsappNumber: string;  // E.164 format: +1234567890
  role: 'admin' | 'manager' | 'agent';
  isActive: boolean;
  notificationPreferences: NotificationPreferences;
}

export interface NotificationPreferences {
  whatsappEnabled: boolean;
  enabledEvents: LeadEventType[];
  quietHoursStart?: string;  // HH:mm format, agent's timezone
  quietHoursEnd?: string;
  timezone: string;           // IANA timezone, e.g., 'Asia/Kolkata'
  minScoreTierForAlert: LeadScoreTier;
}

// ─── WhatsApp Message Types ──────────────────────────────────────────────────

export type MessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export interface WhatsAppMessage {
  id: string;
  tenantId: string;
  agentId: string;
  agentWhatsappNumber: string;
  leadId: string;
  eventType: LeadEventType;
  templateName: string;
  templateParams: Record<string, string>;
  messageBody: string;
  whatsappMessageId?: string;  // ID returned by WhatsApp API
  status: MessageStatus;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
}

// ─── Notification Template ───────────────────────────────────────────────────

export interface NotificationTemplate {
  id: string;
  tenantId: string;
  eventType: LeadEventType;
  templateName: string;        // WhatsApp Business API template name
  language: string;            // e.g., 'en', 'es', 'hi'
  headerText?: string;
  bodyText: string;            // Template with {{placeholders}}
  footerText?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── WhatsApp API Config ─────────────────────────────────────────────────────

export interface WhatsAppConfig {
  tenantId: string;
  businessAccountId: string;
  phoneNumberId: string;
  apiVersion: string;          // e.g., 'v18.0'
  webhookVerifyToken: string;
  isActive: boolean;
}

// ─── Notification Log / Audit ────────────────────────────────────────────────

export interface NotificationLog {
  id: string;
  tenantId: string;
  agentId: string;
  leadId: string;
  eventType: LeadEventType;
  eventId: string;
  messageId: string;
  status: MessageStatus;
  attemptNumber: number;
  responsePayload?: string;
  createdAt: string;
}
