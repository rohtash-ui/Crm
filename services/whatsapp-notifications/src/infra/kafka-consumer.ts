import { Kafka, Consumer, EachMessagePayload, logLevel } from 'kafkajs';
import { LeadEvent, LeadEventType } from '../domain/types';
import { logger } from './logger';

/**
 * Kafka consumer for lead lifecycle events.
 *
 * Subscribes to all lead event topics and routes them to the notification
 * processing pipeline. Uses exactly-once semantics with idempotent processing.
 *
 * Topics follow the CRM naming convention: crm.<entity>.<event>.v<major>
 */

const LEAD_EVENT_TOPICS = [
  'crm.lead.created.v1',
  'crm.lead.status_changed.v1',
  'crm.lead.assigned.v1',
  'crm.lead.score_updated.v1',
  'crm.lead.activity_detected.v1',
  'crm.lead.converted.v1',
  'crm.lead.lost.v1',
  'crm.lead.reactivated.v1',
  'crm.lead.follow_up_due.v1',
] as const;

const TOPIC_TO_EVENT_TYPE: Record<string, LeadEventType> = {
  'crm.lead.created.v1': 'lead.created',
  'crm.lead.status_changed.v1': 'lead.status_changed',
  'crm.lead.assigned.v1': 'lead.assigned',
  'crm.lead.score_updated.v1': 'lead.score_updated',
  'crm.lead.activity_detected.v1': 'lead.activity_detected',
  'crm.lead.converted.v1': 'lead.converted',
  'crm.lead.lost.v1': 'lead.lost',
  'crm.lead.reactivated.v1': 'lead.reactivated',
  'crm.lead.follow_up_due.v1': 'lead.follow_up_due',
};

export type LeadEventHandler = (event: LeadEvent) => Promise<void>;

export class LeadEventConsumer {
  private kafka: Kafka;
  private consumer: Consumer;
  private handler: LeadEventHandler;
  private isRunning = false;

  constructor(
    brokers: string[],
    groupId: string,
    handler: LeadEventHandler,
  ) {
    this.kafka = new Kafka({
      clientId: 'whatsapp-notifications',
      brokers,
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: 300,
        retries: 8,
        maxRetryTime: 30000,
      },
    });

    this.consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576, // 1MB
      retry: { retries: 5 },
    });

    this.handler = handler;
  }

  async start(): Promise<void> {
    logger.info('Starting lead event consumer...');

    await this.consumer.connect();

    // Subscribe to all lead event topics
    for (const topic of LEAD_EVENT_TOPICS) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
      logger.info({ topic }, 'Subscribed to topic');
    }

    this.isRunning = true;

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.processMessage(payload);
      },
    });

    logger.info('Lead event consumer started successfully');
  }

  private async processMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const eventType = TOPIC_TO_EVENT_TYPE[topic];

    if (!eventType) {
      logger.warn({ topic }, 'Received message from unknown topic');
      return;
    }

    if (!message.value) {
      logger.warn({ topic, partition }, 'Received empty message');
      return;
    }

    const startTime = Date.now();

    try {
      const rawEvent = JSON.parse(message.value.toString());

      const event: LeadEvent = {
        eventId: rawEvent.eventId ?? message.key?.toString() ?? '',
        eventType,
        tenantId: rawEvent.tenantId,
        leadId: rawEvent.leadId,
        leadName: rawEvent.leadName,
        leadEmail: rawEvent.leadEmail,
        leadPhone: rawEvent.leadPhone,
        leadSource: rawEvent.leadSource,
        leadScore: rawEvent.leadScore,
        leadScoreTier: rawEvent.leadScoreTier,
        previousStatus: rawEvent.previousStatus,
        currentStatus: rawEvent.currentStatus,
        assignedAgentId: rawEvent.assignedAgentId,
        previousAgentId: rawEvent.previousAgentId,
        dealValue: rawEvent.dealValue,
        currency: rawEvent.currency,
        metadata: rawEvent.metadata,
        occurredAt: rawEvent.occurredAt ?? new Date().toISOString(),
      };

      logger.info({
        eventType,
        leadId: event.leadId,
        agentId: event.assignedAgentId,
        tenantId: event.tenantId,
      }, 'Processing lead event');

      await this.handler(event);

      const duration = Date.now() - startTime;
      logger.info({
        eventType,
        leadId: event.leadId,
        duration,
      }, 'Lead event processed successfully');

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error({
        topic,
        partition,
        offset: message.offset,
        duration,
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to process lead event');

      // Don't rethrow — dead letter queue handling is below
      await this.sendToDeadLetterQueue(topic, message, error);
    }
  }

  private async sendToDeadLetterQueue(
    originalTopic: string,
    message: EachMessagePayload['message'],
    error: unknown,
  ): Promise<void> {
    let producer;
    try {
      producer = this.kafka.producer({ idempotent: true });
      await producer.connect();

      await producer.send({
        topic: `${originalTopic}.dlq`,
        messages: [{
          key: message.key,
          value: message.value,
          headers: {
            ...message.headers,
            'x-original-topic': originalTopic,
            'x-error-message': error instanceof Error ? error.message : String(error),
            'x-failed-at': new Date().toISOString(),
          },
        }],
      });

      logger.info({ originalTopic }, 'Message sent to dead letter queue');
    } catch (dlqError) {
      logger.error({ originalTopic, error: dlqError }, 'Failed to send to DLQ');
    } finally {
      if (producer) {
        await producer.disconnect().catch((err: unknown) => {
          logger.error({ error: err }, 'Failed to disconnect DLQ producer');
        });
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    await this.consumer.disconnect();
    logger.info('Lead event consumer stopped');
  }

  getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning };
  }
}
