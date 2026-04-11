import { v4 as uuidv4 } from 'uuid';
import {
  LeadEvent,
  Agent,
  WhatsAppMessage,
  NotificationLog,
  LeadScoreTier,
} from './types';
import {
  LEAD_EVENT_TEMPLATES,
  buildTemplateParams,
  renderMessageBody,
} from './templates';

/**
 * Core notification engine — pure business logic, no I/O.
 *
 * Decides whether to send a notification and builds the message payload.
 * Actual sending is handled by the infra layer (WhatsApp API client).
 */

const SCORE_TIER_PRIORITY: Record<LeadScoreTier, number> = {
  hot: 3,
  warm: 2,
  cold: 1,
};

export interface NotificationDecision {
  shouldSend: boolean;
  reason: string;
  message?: WhatsAppMessage;
  log?: NotificationLog;
}

export function evaluateNotification(
  event: LeadEvent,
  agent: Agent,
): NotificationDecision {
  // Agent must be active
  if (!agent.isActive) {
    return { shouldSend: false, reason: 'Agent is inactive' };
  }

  // WhatsApp must be enabled for this agent
  if (!agent.notificationPreferences.whatsappEnabled) {
    return { shouldSend: false, reason: 'WhatsApp notifications disabled for agent' };
  }

  // Agent must have a WhatsApp number
  if (!agent.whatsappNumber) {
    return { shouldSend: false, reason: 'Agent has no WhatsApp number configured' };
  }

  // Check if this event type is in the agent's enabled events
  if (!agent.notificationPreferences.enabledEvents.includes(event.eventType)) {
    return { shouldSend: false, reason: `Event type ${event.eventType} not enabled for agent` };
  }

  // Check lead score tier threshold
  if (event.leadScoreTier) {
    const eventPriority = SCORE_TIER_PRIORITY[event.leadScoreTier];
    const minPriority = SCORE_TIER_PRIORITY[agent.notificationPreferences.minScoreTierForAlert];
    if (eventPriority < minPriority) {
      return {
        shouldSend: false,
        reason: `Lead score tier ${event.leadScoreTier} below agent minimum ${agent.notificationPreferences.minScoreTierForAlert}`,
      };
    }
  }

  // Check quiet hours
  if (isInQuietHours(agent.notificationPreferences)) {
    return { shouldSend: false, reason: 'Agent is in quiet hours — message will be queued' };
  }

  // Build the notification message
  const template = LEAD_EVENT_TEMPLATES[event.eventType];
  if (!template) {
    return { shouldSend: false, reason: `No template found for event type ${event.eventType}` };
  }

  const params = buildTemplateParams(event, agent.name);
  const messageBody = renderMessageBody(template.body, params);
  const messageId = uuidv4();
  const now = new Date().toISOString();

  const message: WhatsAppMessage = {
    id: messageId,
    tenantId: event.tenantId,
    agentId: agent.id,
    agentWhatsappNumber: agent.whatsappNumber,
    leadId: event.leadId,
    eventType: event.eventType,
    templateName: template.templateName,
    templateParams: params,
    messageBody: `*${template.header}*\n\n${messageBody}\n\n_${template.footer}_`,
    status: 'queued',
    retryCount: 0,
    maxRetries: 3,
    createdAt: now,
  };

  const log: NotificationLog = {
    id: uuidv4(),
    tenantId: event.tenantId,
    agentId: agent.id,
    leadId: event.leadId,
    eventType: event.eventType,
    eventId: event.eventId,
    messageId,
    status: 'queued',
    attemptNumber: 1,
    createdAt: now,
  };

  return {
    shouldSend: true,
    reason: 'All checks passed',
    message,
    log,
  };
}

/**
 * Check if the current time falls within the agent's quiet hours.
 */
function isInQuietHours(prefs: Agent['notificationPreferences']): boolean {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) {
    return false;
  }

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: prefs.timezone,
  });

  const currentTime = formatter.format(now);
  const [currentHour, currentMinute] = currentTime.split(':').map(Number);
  const currentMinutes = currentHour * 60 + currentMinute;

  const [startHour, startMinute] = prefs.quietHoursStart.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;

  const [endHour, endMinute] = prefs.quietHoursEnd.split(':').map(Number);
  const endMinutes = endHour * 60 + endMinute;

  // Handle overnight quiet hours (e.g., 22:00 to 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Determine if a failed message should be retried.
 */
export function shouldRetry(message: WhatsAppMessage): boolean {
  return message.retryCount < message.maxRetries && message.status === 'failed';
}

/**
 * Calculate exponential backoff delay for retries (in ms).
 */
export function getRetryDelay(retryCount: number): number {
  const baseDelay = 2000; // 2 seconds
  const maxDelay = 30000; // 30 seconds
  const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  // Add jitter: ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}
