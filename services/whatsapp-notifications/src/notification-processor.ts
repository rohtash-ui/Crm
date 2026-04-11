import { LeadEvent } from './domain/types';
import { evaluateNotification, shouldRetry, getRetryDelay } from './domain/notification-engine';
import { NotificationDatabase } from './infra/database';
import { WhatsAppClient } from './infra/whatsapp-client';
import { logger } from './infra/logger';

/**
 * Notification processor — orchestrates the flow from event to WhatsApp message.
 *
 * Flow:
 *   1. Kafka event arrives → processLeadEvent()
 *   2. Look up assigned agent from DB
 *   3. Evaluate notification rules (domain logic)
 *   4. If approved, send via WhatsApp client
 *   5. Record message and audit log in DB
 *   6. Handle retries for failed sends
 */

export class NotificationProcessor {
  constructor(
    private db: NotificationDatabase,
    private whatsappClient: WhatsAppClient,
  ) {}

  /**
   * Main entry point — called by Kafka consumer for each lead event.
   */
  async processLeadEvent(event: LeadEvent): Promise<void> {
    const agent = await this.db.getAgentById(event.tenantId, event.assignedAgentId);

    if (!agent) {
      logger.warn({
        tenantId: event.tenantId,
        agentId: event.assignedAgentId,
        leadId: event.leadId,
      }, 'Agent not found — skipping notification');
      return;
    }

    const decision = evaluateNotification(event, agent);

    logger.info({
      eventType: event.eventType,
      leadId: event.leadId,
      agentId: agent.id,
      shouldSend: decision.shouldSend,
      reason: decision.reason,
    }, 'Notification decision made');

    if (!decision.shouldSend || !decision.message || !decision.log) {
      return;
    }

    // Persist the message first (outbox pattern)
    await this.db.saveMessage(decision.message);
    await this.db.saveNotificationLog(decision.log);

    // Send via WhatsApp
    const result = await this.whatsappClient.sendTemplateMessage(decision.message);

    if (result.success) {
      await this.db.updateMessageStatus(decision.message.id, 'sent', {
        whatsappMessageId: result.whatsappMessageId,
        sentAt: new Date().toISOString(),
      });

      logger.info({
        messageId: decision.message.id,
        whatsappMessageId: result.whatsappMessageId,
        agentName: agent.name,
        eventType: event.eventType,
      }, 'WhatsApp notification sent to agent');
    } else {
      await this.db.updateMessageStatus(decision.message.id, 'failed', {
        errorMessage: result.error,
      });

      logger.error({
        messageId: decision.message.id,
        error: result.error,
      }, 'Failed to send WhatsApp notification');
    }

    // If lead was reassigned, also notify the previous agent
    if (event.eventType === 'lead.assigned' && event.previousAgentId) {
      await this.notifyPreviousAgent(event);
    }
  }

  /**
   * Notify the previous agent when a lead is reassigned.
   */
  private async notifyPreviousAgent(event: LeadEvent): Promise<void> {
    if (!event.previousAgentId) return;

    const previousAgent = await this.db.getAgentById(event.tenantId, event.previousAgentId);
    if (!previousAgent?.whatsappNumber || !previousAgent.notificationPreferences.whatsappEnabled) {
      return;
    }

    const message = [
      '*📋 Lead Reassigned*',
      '',
      `Hi ${previousAgent.name},`,
      '',
      `Lead *${event.leadName}* has been reassigned to another agent.`,
      '',
      '_CRM Lead Notifications_',
    ].join('\n');

    const result = await this.whatsappClient.sendTextMessage(
      previousAgent.whatsappNumber,
      message,
    );

    if (result.success) {
      logger.info({
        previousAgentId: event.previousAgentId,
        leadId: event.leadId,
      }, 'Previous agent notified of lead reassignment');
    }
  }

  /**
   * Retry failed messages — called by scheduled job.
   */
  async retryFailedMessages(): Promise<{ retried: number; succeeded: number }> {
    const failedMessages = await this.db.getPendingRetryMessages();
    let retried = 0;
    let succeeded = 0;

    for (const message of failedMessages) {
      if (!shouldRetry(message)) continue;

      const delay = getRetryDelay(message.retryCount);
      await new Promise((resolve) => setTimeout(resolve, delay));

      retried++;
      const result = await this.whatsappClient.sendTemplateMessage(message);

      if (result.success) {
        succeeded++;
        await this.db.updateMessageStatus(message.id, 'sent', {
          whatsappMessageId: result.whatsappMessageId,
          sentAt: new Date().toISOString(),
          retryCount: message.retryCount + 1,
        });
      } else {
        await this.db.updateMessageStatus(message.id, 'failed', {
          errorMessage: result.error,
          retryCount: message.retryCount + 1,
        });
      }
    }

    logger.info({ retried, succeeded }, 'Retry cycle completed');
    return { retried, succeeded };
  }
}
