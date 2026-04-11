import express from 'express';
import pinoHttp from 'pino-http';
import * as cron from 'node-cron';
import { createRoutes } from './api/routes';
import { NotificationDatabase } from './infra/database';
import { WhatsAppClient } from './infra/whatsapp-client';
import { LeadEventConsumer } from './infra/kafka-consumer';
import { NotificationProcessor } from './notification-processor';
import { logger } from './infra/logger';

/**
 * WhatsApp Notification Service — Entry Point
 *
 * Boots the HTTP server, Kafka consumer, and retry scheduler.
 * Graceful shutdown on SIGTERM/SIGINT for Kubernetes lifecycle.
 */

async function main(): Promise<void> {
  // ─── Configuration ──────────────────────────────────────────────────
  const config = {
    port: parseInt(process.env.PORT ?? '8080'),
    kafka: {
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
      groupId: process.env.KAFKA_GROUP_ID ?? 'whatsapp-notifications',
    },
    database: {
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432'),
      database: process.env.DB_NAME ?? 'whatsapp_notifications',
      user: process.env.DB_USER ?? 'crm',
      password: process.env.DB_PASSWORD ?? '',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    },
    whatsapp: {
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
      apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v18.0',
    },
  };

  // ─── Initialize Dependencies ────────────────────────────────────────
  const db = new NotificationDatabase(config.database);
  const whatsappClient = new WhatsAppClient(config.whatsapp);
  const processor = new NotificationProcessor(db, whatsappClient);

  // ─── Kafka Consumer ─────────────────────────────────────────────────
  const consumer = new LeadEventConsumer(
    config.kafka.brokers,
    config.kafka.groupId,
    (event) => processor.processLeadEvent(event),
  );

  // ─── Express App ────────────────────────────────────────────────────
  const app = express();

  app.use(express.json());
  app.use(pinoHttp({ logger }));
  app.use(createRoutes(db, whatsappClient));

  // ─── Retry Scheduler (every 5 minutes) ──────────────────────────────
  const retryJob = cron.schedule('*/5 * * * *', async () => {
    try {
      const result = await processor.retryFailedMessages();
      if (result.retried > 0) {
        logger.info(result, 'Retry job completed');
      }
    } catch (error) {
      logger.error({ error }, 'Retry job failed');
    }
  });

  // ─── Start Services ─────────────────────────────────────────────────
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'WhatsApp Notification Service started');
  });

  await consumer.start();
  logger.info('Kafka consumer connected and listening for lead events');

  // ─── Graceful Shutdown ──────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    retryJob.stop();
    server.close();
    await consumer.stop();
    await db.close();

    logger.info('Service shut down gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start service');
  process.exit(1);
});
