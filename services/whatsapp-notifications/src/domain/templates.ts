import { LeadEventType, LeadEvent } from './types';

/**
 * WhatsApp message template definitions for each lead lifecycle event.
 *
 * Templates use {{placeholder}} syntax compatible with WhatsApp Business API.
 * Each template maps to a registered template in Meta Business Manager.
 */

interface TemplateDefinition {
  templateName: string;
  header: string;
  body: string;
  footer: string;
}

export const LEAD_EVENT_TEMPLATES: Record<LeadEventType, TemplateDefinition> = {
  'lead.created': {
    templateName: 'crm_new_lead_alert',
    header: '🔔 New Lead Alert',
    body: [
      'Hi {{agentName}},',
      '',
      'A new lead has entered the system and is assigned to you.',
      '',
      '👤 *{{leadName}}*',
      '📧 {{leadEmail}}',
      '📱 {{leadPhone}}',
      '🏷️ Source: {{leadSource}}',
      '💰 Potential Value: {{dealValue}}',
      '',
      'Please reach out within the next 5 minutes for the best conversion rate.',
    ].join('\n'),
    footer: 'CRM Lead Notifications • Tap to open lead details',
  },

  'lead.status_changed': {
    templateName: 'crm_lead_status_change',
    header: '📋 Lead Status Updated',
    body: [
      'Hi {{agentName}},',
      '',
      'Lead status has changed:',
      '',
      '👤 *{{leadName}}*',
      '📊 {{previousStatus}} → *{{currentStatus}}*',
      '🔥 Score: {{leadScore}} ({{leadScoreTier}})',
      '',
      '{{statusActionMessage}}',
    ].join('\n'),
    footer: 'CRM Lead Notifications',
  },

  'lead.assigned': {
    templateName: 'crm_lead_assigned',
    header: '👋 Lead Assigned to You',
    body: [
      'Hi {{agentName}},',
      '',
      'A lead has been assigned to you:',
      '',
      '👤 *{{leadName}}*',
      '📧 {{leadEmail}}',
      '📱 {{leadPhone}}',
      '📊 Status: {{currentStatus}}',
      '🔥 Score: {{leadScore}} ({{leadScoreTier}})',
      '💰 Potential Value: {{dealValue}}',
      '',
      'Review the lead profile and plan your outreach strategy.',
    ].join('\n'),
    footer: 'CRM Lead Notifications',
  },

  'lead.score_updated': {
    templateName: 'crm_lead_score_alert',
    header: '🔥 Lead Score Alert',
    body: [
      'Hi {{agentName}},',
      '',
      'Lead score has been updated:',
      '',
      '👤 *{{leadName}}*',
      '🔥 New Score: *{{leadScore}}* ({{leadScoreTier}})',
      '📊 Status: {{currentStatus}}',
      '',
      '{{scoreActionMessage}}',
    ].join('\n'),
    footer: 'CRM Lead Notifications',
  },

  'lead.activity_detected': {
    templateName: 'crm_lead_activity',
    header: '👀 Lead Activity Detected',
    body: [
      'Hi {{agentName}},',
      '',
      'Your lead showed activity:',
      '',
      '👤 *{{leadName}}*',
      '⚡ Activity: {{activityType}}',
      '🕐 Time: {{activityTime}}',
      '',
      'This is a great time to follow up while the lead is engaged!',
    ].join('\n'),
    footer: 'CRM Lead Notifications',
  },

  'lead.converted': {
    templateName: 'crm_lead_converted',
    header: '🎉 Lead Converted!',
    body: [
      'Hi {{agentName}},',
      '',
      'Congratulations! A lead has been converted:',
      '',
      '👤 *{{leadName}}*',
      '💰 Deal Value: {{dealValue}} {{currency}}',
      '🏷️ Source: {{leadSource}}',
      '',
      'Great work! The lead has been moved to the deals pipeline.',
    ].join('\n'),
    footer: 'CRM Lead Notifications',
  },

  'lead.lost': {
    templateName: 'crm_lead_lost',
    header: '📉 Lead Marked as Lost',
    body: [
      'Hi {{agentName}},',
      '',
      'A lead has been marked as lost:',
      '',
      '👤 *{{leadName}}*',
      '📊 Previous Status: {{previousStatus}}',
      '💰 Potential Value: {{dealValue}} {{currency}}',
      '',
      'Consider scheduling a follow-up in 30 days for reactivation.',
    ].join('\n'),
    footer: 'CRM Lead Notifications',
  },

  'lead.reactivated': {
    templateName: 'crm_lead_reactivated',
    header: '🔄 Lead Reactivated',
    body: [
      'Hi {{agentName}},',
      '',
      'A previously dormant lead is back:',
      '',
      '👤 *{{leadName}}*',
      '📊 Status: *{{currentStatus}}*',
      '🔥 Score: {{leadScore}} ({{leadScoreTier}})',
      '',
      'The lead is showing renewed interest. Time to re-engage!',
    ].join('\n'),
    footer: 'CRM Lead Notifications',
  },

  'lead.follow_up_due': {
    templateName: 'crm_lead_follow_up',
    header: '⏰ Follow-up Reminder',
    body: [
      'Hi {{agentName}},',
      '',
      'You have a follow-up due:',
      '',
      '👤 *{{leadName}}*',
      '📊 Status: {{currentStatus}}',
      '🔥 Score: {{leadScore}} ({{leadScoreTier}})',
      '📧 {{leadEmail}}',
      '📱 {{leadPhone}}',
      '',
      "Don't let this lead go cold — reach out today!",
    ].join('\n'),
    footer: 'CRM Lead Notifications',
  },
};

/**
 * Build template parameters from a lead event for WhatsApp API submission.
 */
export function buildTemplateParams(
  event: LeadEvent,
  agentName: string,
): Record<string, string> {
  const statusActionMessages: Record<string, string> = {
    contacted: 'The lead has been contacted. Keep the momentum going!',
    qualified: 'Lead is now qualified! Prepare your proposal.',
    proposal_sent: 'Proposal sent. Follow up within 48 hours.',
    negotiation: 'Negotiation phase. Stay responsive to close the deal.',
    won: '🎉 Deal won! Congratulations!',
    lost: 'Lead lost. Document lessons learned.',
    dormant: 'Lead went dormant. Set a reactivation reminder.',
  };

  const scoreActionMessages: Record<string, string> = {
    hot: '🔥 HOT LEAD! Prioritize immediate outreach — this lead is highly engaged.',
    warm: '☀️ Warm lead. Good engagement level — continue nurturing.',
    cold: '❄️ Lead is cooling down. Consider a re-engagement campaign.',
  };

  return {
    agentName,
    leadName: event.leadName,
    leadEmail: event.leadEmail ?? 'N/A',
    leadPhone: event.leadPhone ?? 'N/A',
    leadSource: event.leadSource ?? 'Direct',
    leadScore: String(event.leadScore ?? 0),
    leadScoreTier: event.leadScoreTier ?? 'cold',
    previousStatus: event.previousStatus ?? 'N/A',
    currentStatus: event.currentStatus ?? 'new',
    dealValue: event.dealValue ? event.dealValue.toLocaleString() : 'N/A',
    currency: event.currency ?? 'USD',
    statusActionMessage: statusActionMessages[event.currentStatus ?? ''] ?? '',
    scoreActionMessage: scoreActionMessages[event.leadScoreTier ?? 'cold'] ?? '',
    activityType: event.metadata?.activityType ?? 'General activity',
    activityTime: new Date(event.occurredAt).toLocaleString(),
  };
}

/**
 * Render a message body by replacing {{placeholders}} with actual values.
 */
export function renderMessageBody(
  template: string,
  params: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? '');
}
