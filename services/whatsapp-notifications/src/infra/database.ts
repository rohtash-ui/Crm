import { Pool, PoolConfig } from 'pg';
import {
  Agent,
  WhatsAppMessage,
  NotificationLog,
  NotificationTemplate,
  MessageStatus,
  WhatsAppConfig,
} from '../domain/types';
import { logger } from './logger';

/**
 * Database adapter for WhatsApp notification service.
 *
 * All queries include tenant_id for row-level isolation.
 * Connection pooling via pg-pool for optimal resource usage.
 */

export class NotificationDatabase {
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool({
      ...config,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      logger.error({ error: err.message }, 'Unexpected database pool error');
    });
  }

  // ─── Agent Queries ──────────────────────────────────────────────────

  async getAgentById(tenantId: string, agentId: string): Promise<Agent | null> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, name, email, whatsapp_number, role, is_active,
              notification_preferences
       FROM agents
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, agentId],
    );

    if (result.rows.length === 0) return null;
    return this.mapAgent(result.rows[0]);
  }

  async getAgentsByTenant(tenantId: string): Promise<Agent[]> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, name, email, whatsapp_number, role, is_active,
              notification_preferences
       FROM agents
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY name`,
      [tenantId],
    );

    return result.rows.map((row) => this.mapAgent(row));
  }

  async updateAgentNotificationPreferences(
    tenantId: string,
    agentId: string,
    preferences: Agent['notificationPreferences'],
  ): Promise<void> {
    await this.pool.query(
      `UPDATE agents
       SET notification_preferences = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, agentId, JSON.stringify(preferences)],
    );
  }

  async updateAgentWhatsappNumber(
    tenantId: string,
    agentId: string,
    whatsappNumber: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE agents
       SET whatsapp_number = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, agentId, whatsappNumber],
    );
  }

  // ─── Message Queries ────────────────────────────────────────────────

  async saveMessage(message: WhatsAppMessage): Promise<void> {
    await this.pool.query(
      `INSERT INTO whatsapp_messages
       (id, tenant_id, agent_id, agent_whatsapp_number, lead_id, event_type,
        template_name, template_params, message_body, whatsapp_message_id,
        status, error_message, retry_count, max_retries, created_at, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        message.id, message.tenantId, message.agentId, message.agentWhatsappNumber,
        message.leadId, message.eventType, message.templateName,
        JSON.stringify(message.templateParams), message.messageBody,
        message.whatsappMessageId ?? null, message.status, message.errorMessage ?? null,
        message.retryCount, message.maxRetries, message.createdAt, message.sentAt ?? null,
      ],
    );
  }

  async updateMessageStatus(
    messageId: string,
    status: MessageStatus,
    updates: Partial<Pick<WhatsAppMessage, 'whatsappMessageId' | 'sentAt' | 'deliveredAt' | 'readAt' | 'errorMessage' | 'retryCount'>>,
  ): Promise<void> {
    const setClauses: string[] = ['status = $2'];
    const values: unknown[] = [messageId, status];
    let paramIndex = 3;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const columnName = key.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
        setClauses.push(`${columnName} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    await this.pool.query(
      `UPDATE whatsapp_messages SET ${setClauses.join(', ')} WHERE id = $1`,
      values,
    );
  }

  async getMessagesByLead(tenantId: string, leadId: string, limit = 50): Promise<WhatsAppMessage[]> {
    const result = await this.pool.query(
      `SELECT * FROM whatsapp_messages
       WHERE tenant_id = $1 AND lead_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantId, leadId, limit],
    );

    return result.rows.map((row) => this.mapMessage(row));
  }

  async getMessagesByAgent(tenantId: string, agentId: string, limit = 50): Promise<WhatsAppMessage[]> {
    const result = await this.pool.query(
      `SELECT * FROM whatsapp_messages
       WHERE tenant_id = $1 AND agent_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantId, agentId, limit],
    );

    return result.rows.map((row) => this.mapMessage(row));
  }

  async getPendingRetryMessages(): Promise<WhatsAppMessage[]> {
    const result = await this.pool.query(
      `SELECT * FROM whatsapp_messages
       WHERE status = 'failed' AND retry_count < max_retries
       ORDER BY created_at ASC
       LIMIT 100`,
    );

    return result.rows.map((row) => this.mapMessage(row));
  }

  // ─── Notification Log Queries ───────────────────────────────────────

  async saveNotificationLog(log: NotificationLog): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_logs
       (id, tenant_id, agent_id, lead_id, event_type, event_id,
        message_id, status, attempt_number, response_payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        log.id, log.tenantId, log.agentId, log.leadId, log.eventType,
        log.eventId, log.messageId, log.status, log.attemptNumber,
        log.responsePayload ?? null, log.createdAt,
      ],
    );
  }

  async getNotificationHistory(
    tenantId: string,
    filters: { agentId?: string; leadId?: string; eventType?: string },
    limit = 100,
    offset = 0,
  ): Promise<{ logs: NotificationLog[]; total: number }> {
    const conditions = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let paramIndex = 2;

    if (filters.agentId) {
      conditions.push(`agent_id = $${paramIndex++}`);
      values.push(filters.agentId);
    }
    if (filters.leadId) {
      conditions.push(`lead_id = $${paramIndex++}`);
      values.push(filters.leadId);
    }
    if (filters.eventType) {
      conditions.push(`event_type = $${paramIndex++}`);
      values.push(filters.eventType);
    }

    const where = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        `SELECT * FROM notification_logs WHERE ${where}
         ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset],
      ),
      this.pool.query(
        `SELECT COUNT(*) as total FROM notification_logs WHERE ${where}`,
        values,
      ),
    ]);

    return {
      logs: dataResult.rows.map((row) => this.mapNotificationLog(row)),
      total: parseInt(countResult.rows[0].total),
    };
  }

  // ─── Template Queries ───────────────────────────────────────────────

  async getTemplates(tenantId: string): Promise<NotificationTemplate[]> {
    const result = await this.pool.query(
      `SELECT * FROM notification_templates
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY event_type`,
      [tenantId],
    );

    return result.rows.map((row) => this.mapTemplate(row));
  }

  // ─── WhatsApp Config ───────────────────────────────────────────────

  async getWhatsAppConfig(tenantId: string): Promise<WhatsAppConfig | null> {
    const result = await this.pool.query(
      `SELECT * FROM whatsapp_config WHERE tenant_id = $1`,
      [tenantId],
    );

    if (result.rows.length === 0) return null;
    return this.mapWhatsAppConfig(result.rows[0]);
  }

  async upsertWhatsAppConfig(config: WhatsAppConfig): Promise<void> {
    await this.pool.query(
      `INSERT INTO whatsapp_config
       (tenant_id, business_account_id, phone_number_id, api_version,
        webhook_verify_token, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id) DO UPDATE SET
        business_account_id = $2, phone_number_id = $3, api_version = $4,
        webhook_verify_token = $5, is_active = $6, updated_at = NOW()`,
      [
        config.tenantId, config.businessAccountId, config.phoneNumberId,
        config.apiVersion, config.webhookVerifyToken, config.isActive,
      ],
    );
  }

  // ─── Stats ──────────────────────────────────────────────────────────

  async getNotificationStats(tenantId: string, days = 30): Promise<{
    totalSent: number;
    delivered: number;
    read: number;
    failed: number;
    byEventType: Record<string, number>;
  }> {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    const [statusResult, eventResult] = await Promise.all([
      this.pool.query(
        `SELECT status, COUNT(*) as count FROM whatsapp_messages
         WHERE tenant_id = $1 AND created_at >= $2
         GROUP BY status`,
        [tenantId, cutoff],
      ),
      this.pool.query(
        `SELECT event_type, COUNT(*) as count FROM whatsapp_messages
         WHERE tenant_id = $1 AND created_at >= $2
         GROUP BY event_type`,
        [tenantId, cutoff],
      ),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of statusResult.rows) {
      statusCounts[row.status] = parseInt(row.count);
    }

    const byEventType: Record<string, number> = {};
    for (const row of eventResult.rows) {
      byEventType[row.event_type] = parseInt(row.count);
    }

    return {
      totalSent: (statusCounts['sent'] ?? 0) + (statusCounts['delivered'] ?? 0) + (statusCounts['read'] ?? 0),
      delivered: statusCounts['delivered'] ?? 0,
      read: statusCounts['read'] ?? 0,
      failed: statusCounts['failed'] ?? 0,
      byEventType,
    };
  }

  // ─── Mappers ────────────────────────────────────────────────────────

  private mapAgent(row: Record<string, unknown>): Agent {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      name: row.name as string,
      email: row.email as string,
      whatsappNumber: row.whatsapp_number as string | undefined,
      role: row.role as Agent['role'],
      isActive: row.is_active as boolean,
      notificationPreferences: typeof row.notification_preferences === 'string'
        ? JSON.parse(row.notification_preferences)
        : row.notification_preferences as Agent['notificationPreferences'],
    };
  }

  private mapMessage(row: Record<string, unknown>): WhatsAppMessage {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      agentId: row.agent_id as string,
      agentWhatsappNumber: row.agent_whatsapp_number as string,
      leadId: row.lead_id as string,
      eventType: row.event_type as WhatsAppMessage['eventType'],
      templateName: row.template_name as string,
      templateParams: typeof row.template_params === 'string'
        ? JSON.parse(row.template_params)
        : row.template_params as Record<string, string>,
      messageBody: row.message_body as string,
      whatsappMessageId: row.whatsapp_message_id as string | undefined,
      status: row.status as MessageStatus,
      errorMessage: row.error_message as string | undefined,
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
      createdAt: row.created_at as string,
      sentAt: row.sent_at as string | undefined,
      deliveredAt: row.delivered_at as string | undefined,
      readAt: row.read_at as string | undefined,
    };
  }

  private mapNotificationLog(row: Record<string, unknown>): NotificationLog {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      agentId: row.agent_id as string,
      leadId: row.lead_id as string,
      eventType: row.event_type as NotificationLog['eventType'],
      eventId: row.event_id as string,
      messageId: row.message_id as string,
      status: row.status as MessageStatus,
      attemptNumber: row.attempt_number as number,
      responsePayload: row.response_payload as string | undefined,
      createdAt: row.created_at as string,
    };
  }

  private mapTemplate(row: Record<string, unknown>): NotificationTemplate {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      eventType: row.event_type as NotificationTemplate['eventType'],
      templateName: row.template_name as string,
      language: row.language as string,
      headerText: row.header_text as string | undefined,
      bodyText: row.body_text as string,
      footerText: row.footer_text as string | undefined,
      isActive: row.is_active as boolean,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private mapWhatsAppConfig(row: Record<string, unknown>): WhatsAppConfig {
    return {
      tenantId: row.tenant_id as string,
      businessAccountId: row.business_account_id as string,
      phoneNumberId: row.phone_number_id as string,
      apiVersion: row.api_version as string,
      webhookVerifyToken: row.webhook_verify_token as string,
      isActive: row.is_active as boolean,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
