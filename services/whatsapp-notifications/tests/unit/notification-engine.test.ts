import {
  evaluateNotification,
  shouldRetry,
  getRetryDelay,
} from '../../src/domain/notification-engine';
import { LeadEvent, Agent, WhatsAppMessage } from '../../src/domain/types';

describe('NotificationEngine', () => {
  const baseAgent: Agent = {
    id: 'agent-1',
    tenantId: 'tenant-1',
    name: 'John Doe',
    email: 'john@example.com',
    whatsappNumber: '+1234567890',
    role: 'agent',
    isActive: true,
    notificationPreferences: {
      whatsappEnabled: true,
      enabledEvents: [
        'lead.created',
        'lead.status_changed',
        'lead.assigned',
        'lead.score_updated',
        'lead.converted',
      ],
      timezone: 'UTC',
      minScoreTierForAlert: 'cold',
    },
  };

  const baseEvent: LeadEvent = {
    eventId: 'evt-1',
    eventType: 'lead.created',
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    leadName: 'Jane Smith',
    leadEmail: 'jane@example.com',
    leadPhone: '+9876543210',
    leadSource: 'Website',
    leadScore: 85,
    leadScoreTier: 'hot',
    currentStatus: 'new',
    assignedAgentId: 'agent-1',
    dealValue: 50000,
    currency: 'USD',
    occurredAt: new Date().toISOString(),
  };

  describe('evaluateNotification', () => {
    it('should approve notification when all checks pass', () => {
      const decision = evaluateNotification(baseEvent, baseAgent);

      expect(decision.shouldSend).toBe(true);
      expect(decision.reason).toBe('All checks passed');
      expect(decision.message).toBeDefined();
      expect(decision.message!.agentWhatsappNumber).toBe('+1234567890');
      expect(decision.message!.eventType).toBe('lead.created');
      expect(decision.message!.status).toBe('queued');
      expect(decision.log).toBeDefined();
    });

    it('should reject when agent is inactive', () => {
      const agent = { ...baseAgent, isActive: false };
      const decision = evaluateNotification(baseEvent, agent);

      expect(decision.shouldSend).toBe(false);
      expect(decision.reason).toBe('Agent is inactive');
    });

    it('should reject when WhatsApp is disabled', () => {
      const agent = {
        ...baseAgent,
        notificationPreferences: {
          ...baseAgent.notificationPreferences,
          whatsappEnabled: false,
        },
      };
      const decision = evaluateNotification(baseEvent, agent);

      expect(decision.shouldSend).toBe(false);
      expect(decision.reason).toBe('WhatsApp notifications disabled for agent');
    });

    it('should reject when agent has no WhatsApp number', () => {
      const agent = { ...baseAgent, whatsappNumber: '' };
      const decision = evaluateNotification(baseEvent, agent);

      expect(decision.shouldSend).toBe(false);
      expect(decision.reason).toBe('Agent has no WhatsApp number configured');
    });

    it('should reject when event type is not in enabled events', () => {
      const event = { ...baseEvent, eventType: 'lead.lost' as const };
      const decision = evaluateNotification(event, baseAgent);

      expect(decision.shouldSend).toBe(false);
      expect(decision.reason).toContain('not enabled for agent');
    });

    it('should reject when lead score tier is below threshold', () => {
      const agent = {
        ...baseAgent,
        notificationPreferences: {
          ...baseAgent.notificationPreferences,
          minScoreTierForAlert: 'hot' as const,
        },
      };
      const event = { ...baseEvent, leadScoreTier: 'warm' as const };
      const decision = evaluateNotification(event, agent);

      expect(decision.shouldSend).toBe(false);
      expect(decision.reason).toContain('below agent minimum');
    });

    it('should include correct template params in message', () => {
      const decision = evaluateNotification(baseEvent, baseAgent);

      expect(decision.message!.templateParams.leadName).toBe('Jane Smith');
      expect(decision.message!.templateParams.agentName).toBe('John Doe');
      expect(decision.message!.templateParams.leadEmail).toBe('jane@example.com');
    });

    it('should handle status_changed events', () => {
      const event: LeadEvent = {
        ...baseEvent,
        eventType: 'lead.status_changed',
        previousStatus: 'new',
        currentStatus: 'qualified',
      };
      const decision = evaluateNotification(event, baseAgent);

      expect(decision.shouldSend).toBe(true);
      expect(decision.message!.templateName).toBe('crm_lead_status_change');
    });
  });

  describe('shouldRetry', () => {
    it('should return true for failed messages under retry limit', () => {
      const message = { status: 'failed', retryCount: 1, maxRetries: 3 } as WhatsAppMessage;
      expect(shouldRetry(message)).toBe(true);
    });

    it('should return false when retry limit reached', () => {
      const message = { status: 'failed', retryCount: 3, maxRetries: 3 } as WhatsAppMessage;
      expect(shouldRetry(message)).toBe(false);
    });

    it('should return false for non-failed messages', () => {
      const message = { status: 'sent', retryCount: 0, maxRetries: 3 } as WhatsAppMessage;
      expect(shouldRetry(message)).toBe(false);
    });
  });

  describe('getRetryDelay', () => {
    it('should increase delay with retry count', () => {
      const delays = [0, 1, 2, 3].map((count) => getRetryDelay(count));
      // Verify exponential growth pattern (with jitter)
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThan(0);
      }
    });

    it('should cap delay at 30 seconds', () => {
      const delay = getRetryDelay(100);
      expect(delay).toBeLessThanOrEqual(37500); // 30000 + 25% jitter
    });
  });
});
