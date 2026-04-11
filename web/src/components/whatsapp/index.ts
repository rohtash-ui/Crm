/**
 * WhatsApp notification components — barrel export.
 *
 * Usage in CRM web app:
 *
 *   // Lead detail page — show notification journey timeline
 *   import { LeadNotificationTimeline } from '@components/whatsapp';
 *   <LeadNotificationTimeline leadId={lead.id} />
 *
 *   // Settings page — agent notification preferences
 *   import { WhatsAppNotificationSettings } from '@components/whatsapp';
 *   <WhatsAppNotificationSettings agentId={currentUser.id} />
 *
 *   // Admin dashboard — notification overview
 *   import { NotificationDashboard } from '@components/whatsapp';
 *   <NotificationDashboard />
 *
 *   // Top nav bar — notification bell
 *   import { WhatsAppNotificationBell } from '@components/whatsapp';
 *   <WhatsAppNotificationBell agentId={currentUser.id} />
 */

export { WhatsAppNotificationSettings } from './WhatsAppNotificationSettings';
export { LeadNotificationTimeline } from './LeadNotificationTimeline';
export { NotificationDashboard } from './NotificationDashboard';
export { WhatsAppNotificationBell } from './WhatsAppNotificationBell';
