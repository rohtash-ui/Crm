import {
  LEAD_EVENT_TEMPLATES,
  buildTemplateParams,
  renderMessageBody,
} from '../../src/domain/templates';
import { LeadEvent } from '../../src/domain/types';

describe('Templates', () => {
  const sampleEvent: LeadEvent = {
    eventId: 'evt-1',
    eventType: 'lead.created',
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    leadName: 'Alice Johnson',
    leadEmail: 'alice@example.com',
    leadPhone: '+1555123456',
    leadSource: 'LinkedIn',
    leadScore: 92,
    leadScoreTier: 'hot',
    currentStatus: 'new',
    assignedAgentId: 'agent-1',
    dealValue: 75000,
    currency: 'USD',
    occurredAt: '2026-04-11T10:30:00Z',
  };

  describe('LEAD_EVENT_TEMPLATES', () => {
    it('should have templates for all event types', () => {
      const expectedEvents = [
        'lead.created',
        'lead.status_changed',
        'lead.assigned',
        'lead.score_updated',
        'lead.activity_detected',
        'lead.converted',
        'lead.lost',
        'lead.reactivated',
        'lead.follow_up_due',
      ];

      for (const event of expectedEvents) {
        expect(LEAD_EVENT_TEMPLATES[event as keyof typeof LEAD_EVENT_TEMPLATES]).toBeDefined();
      }
    });

    it('should have a valid template name for each event', () => {
      for (const [, template] of Object.entries(LEAD_EVENT_TEMPLATES)) {
        expect(template.templateName).toMatch(/^crm_/);
        expect(template.body.length).toBeGreaterThan(0);
        expect(template.header.length).toBeGreaterThan(0);
      }
    });
  });

  describe('buildTemplateParams', () => {
    it('should populate all required params', () => {
      const params = buildTemplateParams(sampleEvent, 'Agent Bob');

      expect(params.agentName).toBe('Agent Bob');
      expect(params.leadName).toBe('Alice Johnson');
      expect(params.leadEmail).toBe('alice@example.com');
      expect(params.leadPhone).toBe('+1555123456');
      expect(params.leadSource).toBe('LinkedIn');
      expect(params.leadScoreTier).toBe('hot');
      expect(params.currency).toBe('USD');
    });

    it('should handle missing optional fields', () => {
      const event: LeadEvent = {
        ...sampleEvent,
        leadEmail: undefined,
        leadPhone: undefined,
        leadSource: undefined,
        dealValue: undefined,
      };
      const params = buildTemplateParams(event, 'Agent');

      expect(params.leadEmail).toBe('N/A');
      expect(params.leadPhone).toBe('N/A');
      expect(params.leadSource).toBe('Direct');
      expect(params.dealValue).toBe('N/A');
    });

    it('should include score action messages for hot leads', () => {
      const params = buildTemplateParams(sampleEvent, 'Agent');
      expect(params.scoreActionMessage).toContain('HOT LEAD');
    });
  });

  describe('renderMessageBody', () => {
    it('should replace all placeholders', () => {
      const template = 'Hello {{agentName}}, lead {{leadName}} ({{leadEmail}})';
      const params = { agentName: 'Bob', leadName: 'Alice', leadEmail: 'a@b.com' };

      const result = renderMessageBody(template, params);
      expect(result).toBe('Hello Bob, lead Alice (a@b.com)');
    });

    it('should handle missing params gracefully', () => {
      const template = 'Hello {{agentName}}, score: {{missing}}';
      const params = { agentName: 'Bob' };

      const result = renderMessageBody(template, params);
      expect(result).toBe('Hello Bob, score: ');
    });
  });
});
