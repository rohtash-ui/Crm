import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { NotificationDatabase } from '../infra/database';
import { WhatsAppClient } from '../infra/whatsapp-client';
import { LeadEventType } from '../domain/types';
import { logger } from '../infra/logger';

/**
 * REST API routes for WhatsApp notification management.
 *
 * All routes are tenant-scoped via X-Tenant-ID header (set by API gateway).
 * Authentication is handled by the gateway — the BFF passes validated JWT claims.
 */

const updatePreferencesSchema = z.object({
  whatsappEnabled: z.boolean(),
  enabledEvents: z.array(z.string()),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string(),
  minScoreTierForAlert: z.enum(['hot', 'warm', 'cold']),
}).refine(
  (data) => (!data.quietHoursStart && !data.quietHoursEnd) || (!!data.quietHoursStart && !!data.quietHoursEnd),
  { message: 'quietHoursStart and quietHoursEnd must both be provided or both be absent' },
);

const whatsappConfigSchema = z.object({
  businessAccountId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  apiVersion: z.string().default('v18.0'),
  webhookVerifyToken: z.string().min(8),
  isActive: z.boolean().default(true),
});

function requireTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'X-Tenant-ID header is required' });
    return null;
  }
  return tenantId;
}

export function createRoutes(db: NotificationDatabase, whatsappClient: WhatsAppClient): Router {
  const router = Router();

  // ─── Health & Readiness ───────────────────────────────────────────

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', service: 'whatsapp-notifications' });
  });

  // ─── Agent Notification Preferences ───────────────────────────────

  /**
   * GET /api/v1/agents/:agentId/whatsapp-preferences
   * Get agent's WhatsApp notification preferences.
   */
  router.get('/api/v1/agents/:agentId/whatsapp-preferences', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const { agentId } = req.params;

      const agent = await db.getAgentById(tenantId, agentId);
      if (!agent) {
        return void res.status(404).json({ error: 'Agent not found' });
      }

      return void res.json({
        agentId: agent.id,
        whatsappNumber: agent.whatsappNumber,
        preferences: agent.notificationPreferences,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get agent preferences');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/v1/agents/:agentId/whatsapp-preferences
   * Update agent's WhatsApp notification preferences.
   */
  router.put('/api/v1/agents/:agentId/whatsapp-preferences', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const { agentId } = req.params;

      const parsed = updatePreferencesSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: 'Invalid preferences', details: parsed.error.issues });
      }

      await db.updateAgentNotificationPreferences(
        tenantId,
        agentId,
        parsed.data as {
          whatsappEnabled: boolean;
          enabledEvents: LeadEventType[];
          quietHoursStart?: string;
          quietHoursEnd?: string;
          timezone: string;
          minScoreTierForAlert: 'hot' | 'warm' | 'cold';
        },
      );

      return void res.json({ success: true, message: 'Preferences updated' });
    } catch (error) {
      logger.error({ error }, 'Failed to update agent preferences');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/v1/agents/:agentId/whatsapp-number
   * Update agent's WhatsApp phone number.
   */
  router.put('/api/v1/agents/:agentId/whatsapp-number', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const { agentId } = req.params;
      const { whatsappNumber } = req.body;

      if (!whatsappNumber || !/^\+\d{10,15}$/.test(whatsappNumber)) {
        return void res.status(400).json({ error: 'Invalid WhatsApp number. Use E.164 format: +1234567890' });
      }

      await db.updateAgentWhatsappNumber(tenantId, agentId, whatsappNumber);
      return void res.json({ success: true, message: 'WhatsApp number updated' });
    } catch (error) {
      logger.error({ error }, 'Failed to update WhatsApp number');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Notification History ─────────────────────────────────────────

  /**
   * GET /api/v1/notifications/history
   * Get notification history with filters.
   */
  router.get('/api/v1/notifications/history', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const { agentId, leadId, eventType } = req.query;
      const limitParam = req.query.limit ? Math.max(1, Math.min(1000, parseInt(req.query.limit as string) || 100)) : 100;
      const offsetParam = req.query.offset ? Math.max(0, parseInt(req.query.offset as string) || 0) : 0;

      const result = await db.getNotificationHistory(
        tenantId,
        {
          agentId: agentId as string,
          leadId: leadId as string,
          eventType: eventType as string,
        },
        limitParam,
        offsetParam,
      );

      return void res.json(result);
    } catch (error) {
      logger.error({ error }, 'Failed to get notification history');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/v1/notifications/lead/:leadId
   * Get all WhatsApp messages sent for a specific lead (lead journey view).
   */
  router.get('/api/v1/notifications/lead/:leadId', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const { leadId } = req.params;

      const messages = await db.getMessagesByLead(tenantId, leadId);

      return void res.json({
        leadId,
        totalMessages: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          eventType: m.eventType,
          status: m.status,
          agentId: m.agentId,
          messageBody: m.messageBody,
          sentAt: m.sentAt,
          deliveredAt: m.deliveredAt,
          readAt: m.readAt,
          createdAt: m.createdAt,
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get lead notifications');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/v1/notifications/agent/:agentId
   * Get all WhatsApp messages sent to a specific agent.
   */
  router.get('/api/v1/notifications/agent/:agentId', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const { agentId } = req.params;

      const messages = await db.getMessagesByAgent(tenantId, agentId);

      return void res.json({
        agentId,
        totalMessages: messages.length,
        messages,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get agent notifications');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Stats & Dashboard ────────────────────────────────────────────

  /**
   * GET /api/v1/notifications/stats
   * Get notification statistics for dashboard.
   */
  router.get('/api/v1/notifications/stats', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const days = req.query.days ? parseInt(req.query.days as string) : 30;

      const stats = await db.getNotificationStats(tenantId, days);
      return void res.json(stats);
    } catch (error) {
      logger.error({ error }, 'Failed to get notification stats');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── WhatsApp Configuration (Admin only) ──────────────────────────

  /**
   * GET /api/v1/whatsapp/config
   * Get tenant's WhatsApp Business API configuration.
   */
  router.get('/api/v1/whatsapp/config', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const config = await db.getWhatsAppConfig(tenantId);

      if (!config) {
        return void res.status(404).json({ error: 'WhatsApp not configured for this tenant' });
      }

      // Redact sensitive fields
      return void res.json({
        ...config,
        webhookVerifyToken: '********',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get WhatsApp config');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/v1/whatsapp/config
   * Update tenant's WhatsApp Business API configuration.
   */
  router.put('/api/v1/whatsapp/config', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const parsed = whatsappConfigSchema.safeParse(req.body);

      if (!parsed.success) {
        return void res.status(400).json({ error: 'Invalid config', details: parsed.error.issues });
      }

      await db.upsertWhatsAppConfig({ tenantId, ...parsed.data });
      return void res.json({ success: true, message: 'WhatsApp configuration updated' });
    } catch (error) {
      logger.error({ error }, 'Failed to update WhatsApp config');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Templates ────────────────────────────────────────────────────

  /**
   * GET /api/v1/whatsapp/templates
   * Get all notification templates.
   */
  router.get('/api/v1/whatsapp/templates', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const templates = await db.getTemplates(tenantId);
      return void res.json({ templates });
    } catch (error) {
      logger.error({ error }, 'Failed to get templates');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── WhatsApp Webhook (Status callbacks from Meta) ────────────────

  /**
   * GET /webhook/whatsapp — Webhook verification
   */
  router.get('/webhook/whatsapp', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'] as string;
    const token = req.query['hub.verify_token'] as string;
    const challenge = req.query['hub.challenge'] as string;

    // In production, verify_token comes from tenant config
    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '';
    const result = whatsappClient.verifyWebhook(mode, token, challenge, verifyToken);

    if (result) {
      return void res.status(200).send(result);
    } else {
      return void res.status(403).json({ error: 'Verification failed' });
    }
  });

  /**
   * POST /webhook/whatsapp — Delivery status updates from Meta
   */
  router.post('/webhook/whatsapp', async (req: Request, res: Response) => {
    try {
      const updates = whatsappClient.parseWebhookPayload(req.body);

      for (const update of updates) {
        await db.updateMessageStatus(update.messageId, update.status, {});
        logger.info({
          whatsappMessageId: update.messageId,
          status: update.status,
        }, 'Message status updated via webhook');
      }

      return void res.status(200).json({ received: true });
    } catch (error) {
      logger.error({ error }, 'Failed to process webhook');
      return void res.status(200).json({ received: true }); // Always 200 to avoid retries from Meta
    }
  });

  // ─── Agent List (for admin panel) ─────────────────────────────────

  /**
   * GET /api/v1/agents
   * Get all agents with their WhatsApp notification status.
   */
  router.get('/api/v1/agents', async (req: Request, res: Response) => {
    try {
      const tenantId = requireTenantId(req, res);
      if (!tenantId) return;
      const agents = await db.getAgentsByTenant(tenantId);

      return void res.json({
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          whatsappNumber: a.whatsappNumber ? `****${a.whatsappNumber.slice(-4)}` : null,
          whatsappEnabled: a.notificationPreferences.whatsappEnabled,
          enabledEventsCount: a.notificationPreferences.enabledEvents.length,
          role: a.role,
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get agents');
      return void res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
