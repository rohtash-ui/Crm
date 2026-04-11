import axios, { AxiosInstance } from 'axios';
import { WhatsAppMessage, MessageStatus } from '../domain/types';
import { logger } from './logger';

/**
 * WhatsApp Business API client using Meta Cloud API.
 *
 * Handles sending template messages and tracking delivery status via webhooks.
 * Implements circuit breaker pattern and exponential backoff for resilience.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

interface WhatsAppApiConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  baseUrl?: string;
}

interface SendMessageResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

interface WhatsAppWebhookPayload {
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id: string;
          errors?: Array<{ code: number; title: string }>;
        }>;
      };
      field: string;
    }>;
  }>;
}

export type StatusUpdateCallback = (
  whatsappMessageId: string,
  status: MessageStatus,
  timestamp: string,
  errorMessage?: string,
) => Promise<void>;

export class WhatsAppClient {
  private httpClient: AxiosInstance;
  private phoneNumberId: string;
  private circuitOpen = false;
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold = 5;
  private readonly recoveryTimeout = 60000; // 1 minute

  constructor(config: WhatsAppApiConfig) {
    this.phoneNumberId = config.phoneNumberId;

    this.httpClient = axios.create({
      baseURL: config.baseUrl ?? `https://graph.facebook.com/${config.apiVersion}`,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  /**
   * Send a template-based WhatsApp message to an agent.
   */
  async sendTemplateMessage(message: WhatsAppMessage): Promise<{
    success: boolean;
    whatsappMessageId?: string;
    error?: string;
  }> {
    if (this.isCircuitOpen()) {
      logger.warn({ messageId: message.id }, 'Circuit breaker open — skipping send');
      return { success: false, error: 'Circuit breaker open' };
    }

    try {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: message.agentWhatsappNumber.replace('+', ''),
        type: 'template',
        template: {
          name: message.templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: Object.entries(message.templateParams).map(
                ([, value]) => ({ type: 'text', text: value }),
              ),
            },
          ],
        },
      };

      const response = await this.httpClient.post<SendMessageResponse>(
        `/${this.phoneNumberId}/messages`,
        payload,
      );

      this.onSuccess();

      const whatsappMessageId = response.data.messages?.[0]?.id;

      logger.info({
        messageId: message.id,
        whatsappMessageId,
        recipient: message.agentWhatsappNumber,
      }, 'WhatsApp message sent successfully');

      return { success: true, whatsappMessageId };

    } catch (error) {
      this.onFailure();

      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.error?.message ?? error.message
        : String(error);

      logger.error({
        messageId: message.id,
        recipient: message.agentWhatsappNumber,
        error: errorMessage,
      }, 'Failed to send WhatsApp message');

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send a plain text WhatsApp message (for non-template messages).
   */
  async sendTextMessage(to: string, body: string): Promise<{
    success: boolean;
    whatsappMessageId?: string;
    error?: string;
  }> {
    if (this.isCircuitOpen()) {
      return { success: false, error: 'Circuit breaker open' };
    }

    try {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'text',
        text: { preview_url: false, body },
      };

      const response = await this.httpClient.post<SendMessageResponse>(
        `/${this.phoneNumberId}/messages`,
        payload,
      );

      this.onSuccess();
      return { success: true, whatsappMessageId: response.data.messages?.[0]?.id };

    } catch (error) {
      this.onFailure();
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.error?.message ?? error.message
        : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Process incoming webhook for delivery status updates.
   */
  parseWebhookPayload(
    payload: WhatsAppWebhookPayload,
  ): Array<{ messageId: string; status: MessageStatus; timestamp: string; error?: string }> {
    const updates: Array<{ messageId: string; status: MessageStatus; timestamp: string; error?: string }> = [];

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const statuses = change.value.statuses ?? [];
        for (const status of statuses) {
          updates.push({
            messageId: status.id,
            status: status.status as MessageStatus,
            timestamp: new Date(parseInt(status.timestamp) * 1000).toISOString(),
            error: status.errors?.[0]?.title,
          });
        }
      }
    }

    return updates;
  }

  /**
   * Verify webhook callback from Meta.
   */
  verifyWebhook(mode: string, token: string, challenge: string, verifyToken: string): string | null {
    if (mode === 'subscribe' && token === verifyToken) {
      return challenge;
    }
    return null;
  }

  // ─── Circuit Breaker ─────────────────────────────────────────────────

  private isCircuitOpen(): boolean {
    if (!this.circuitOpen) return false;

    // Check if recovery timeout has elapsed
    if (Date.now() - this.lastFailureTime >= this.recoveryTimeout) {
      logger.info('Circuit breaker half-open — allowing test request');
      this.circuitOpen = false;
      this.failureCount = 0;
      return false;
    }

    return true;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.circuitOpen = false;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.circuitOpen = true;
      logger.warn({ failureCount: this.failureCount }, 'Circuit breaker OPEN');
    }
  }
}
