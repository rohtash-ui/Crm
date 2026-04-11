# 11 — WhatsApp Lead Notification Automation

## Purpose

Automate real-time WhatsApp notifications to CRM agents throughout the lead
lifecycle. When a lead enters the system, changes status, gets reassigned, or
shows engagement activity, the assigned agent receives an instant WhatsApp
message — reducing response time and improving conversion rates.

## Lead journey notification flow

```
Lead enters CRM          Agent gets WhatsApp:
  (website form,    ───►  "New Lead Alert — Jane Smith
   import, API)           from LinkedIn, score: 85 (hot)"
       │
       ▼
Lead status changes       Agent gets WhatsApp:
  (new → qualified)  ───► "Lead Status Updated —
       │                   new → qualified"
       ▼
Lead score crosses        Agent gets WhatsApp:
  tier threshold     ───► "Lead Score Alert —
  (warm → hot)             Score: 92 (HOT LEAD)"
       │
       ▼
Lead shows activity       Agent gets WhatsApp:
  (email opened,     ───► "Lead Activity Detected —
   link clicked)           Email opened 2 min ago"
       │
       ▼
Lead converted            Agent gets WhatsApp:
  (becomes a deal)   ───► "Lead Converted!
       │                   Deal Value: $75,000"
       ▼
Follow-up due             Agent gets WhatsApp:
  (scheduled reminder)───► "Follow-up Reminder —
                            Don't let this lead go cold!"
```

## Architecture

```
┌────────────────────┐     ┌─────────────────────────┐
│    Leads Service   │     │   Contacts / Deals /    │
│                    │     │   Activities Services   │
└────────┬───────────┘     └────────────┬────────────┘
         │                              │
         │  lead.created                │  lead.status_changed
         │  lead.assigned               │  lead.score_updated
         │  lead.converted              │  lead.activity_detected
         │                              │
         └──────────────┬───────────────┘
                        │
              ┌─────────▼──────────┐
              │   Kafka Backbone   │
              │  (event topics)    │
              └─────────┬──────────┘
                        │
         ┌──────────────▼───────────────┐
         │  WhatsApp Notification Svc   │
         │                              │
         │  1. Kafka consumer           │
         │  2. Notification engine      │
         │     (rules, preferences,     │
         │      quiet hours, scoring)   │
         │  3. Template renderer        │
         │  4. WhatsApp API client      │
         │  5. Delivery tracking        │
         │  6. Retry with backoff       │
         └──────────┬───────────────────┘
                    │
         ┌──────────▼──────────┐
         │  Meta Cloud API     │
         │  (WhatsApp Business)│
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │  Agent's WhatsApp   │
         │  (mobile device)    │
         └─────────────────────┘
```

## Event-driven automation

The service subscribes to 9 Kafka topics covering the complete lead lifecycle:

| Kafka Topic | Trigger | Agent Notification |
|---|---|---|
| `crm.lead.created.v1` | New lead enters system | "New Lead Alert" with lead details |
| `crm.lead.status_changed.v1` | Status transition | "Lead Status Updated" with old → new |
| `crm.lead.assigned.v1` | Lead assigned/reassigned | "Lead Assigned to You" |
| `crm.lead.score_updated.v1` | Score tier changes | "Lead Score Alert" with tier |
| `crm.lead.activity_detected.v1` | Engagement activity | "Lead Activity Detected" |
| `crm.lead.converted.v1` | Lead becomes a deal | "Lead Converted!" |
| `crm.lead.lost.v1` | Lead marked lost | "Lead Marked as Lost" |
| `crm.lead.reactivated.v1` | Dormant lead returns | "Lead Reactivated" |
| `crm.lead.follow_up_due.v1` | Scheduled reminder | "Follow-up Reminder" |

## Notification decision engine

Before sending, every event passes through the notification engine:

```
Event arrives
  │
  ├─ Is agent active?                   → No  → Skip
  ├─ Is WhatsApp enabled for agent?     → No  → Skip
  ├─ Does agent have WhatsApp number?   → No  → Skip
  ├─ Is this event type enabled?        → No  → Skip
  ├─ Does lead score meet threshold?    → No  → Skip
  ├─ Is agent in quiet hours?           → Yes → Queue for later
  │
  └─ All checks pass → Build message → Send via WhatsApp API
```

Agent preferences are configurable per-agent:
- **Enable/disable** WhatsApp notifications entirely
- **Select events**: Choose which lead lifecycle events trigger notifications
- **Score threshold**: Only alert for hot, warm+hot, or all leads
- **Quiet hours**: Pause notifications during off-hours (timezone-aware)

## WhatsApp Business API integration

Uses Meta Cloud API for sending template-based messages:

- **Template messages** registered in Meta Business Manager
- **Circuit breaker** prevents cascade failures (5 failures → open for 60s)
- **Exponential backoff** with jitter for retries (2s, 4s, 8s, max 30s)
- **Webhook integration** for delivery status tracking (sent → delivered → read)
- **Outbox pattern**: Messages persisted to DB before sending, ensuring no lost notifications

## Service structure

```
services/whatsapp-notifications/
├── src/
│   ├── api/
│   │   └── routes.ts            # REST API endpoints
│   ├── domain/
│   │   ├── types.ts             # Core type definitions
│   │   ├── templates.ts         # Message templates per event type
│   │   └── notification-engine.ts # Decision logic (pure, no I/O)
│   ├── infra/
│   │   ├── kafka-consumer.ts    # Lead event consumer
│   │   ├── whatsapp-client.ts   # Meta Cloud API client
│   │   ├── database.ts          # Postgres adapter
│   │   └── logger.ts            # Structured logging
│   ├── notification-processor.ts # Orchestrator
│   └── server.ts                # Entry point
├── migrations/
│   └── 0001_create_whatsapp_tables.sql
├── tests/
│   ├── unit/
│   │   ├── notification-engine.test.ts
│   │   └── templates.test.ts
│   └── integration/
├── openapi.yaml                 # REST API contract
├── asyncapi.yaml                # Event contract
├── Dockerfile
├── helm/
│   ├── Chart.yaml
│   └── values.yaml
└── package.json
```

## Web frontend

### Components

| Component | Location | Usage |
|---|---|---|
| `NotificationDashboard` | Admin panel | Stats, event breakdown, agent status, history |
| `WhatsAppNotificationSettings` | Agent settings | Enable/disable, event selection, quiet hours |
| `LeadNotificationTimeline` | Lead detail page | Chronological journey of all notifications |
| `WhatsAppNotificationBell` | Top nav bar | Badge + dropdown with recent notifications |
| `WhatsAppSettingsPage` | Settings section | Tabs: Dashboard / My Notifications / Config |

### Integration points

```tsx
// Lead detail page — add to existing timeline
import { LeadNotificationTimeline } from '@components/whatsapp';
<LeadNotificationTimeline leadId={lead.id} />

// Top navigation — alongside existing notification bell
import { WhatsAppNotificationBell } from '@components/whatsapp';
<WhatsAppNotificationBell agentId={currentUser.id} />

// Settings page — new route
import { WhatsAppSettingsPage } from '@pages/whatsapp/WhatsAppSettingsPage';
<Route path="/settings/whatsapp-notifications" component={WhatsAppSettingsPage} />
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/agents/:id/whatsapp-preferences` | Get agent notification settings |
| `PUT` | `/api/v1/agents/:id/whatsapp-preferences` | Update agent notification settings |
| `PUT` | `/api/v1/agents/:id/whatsapp-number` | Update agent WhatsApp number |
| `GET` | `/api/v1/notifications/history` | Filtered notification history |
| `GET` | `/api/v1/notifications/lead/:leadId` | Lead notification journey |
| `GET` | `/api/v1/notifications/agent/:agentId` | Agent notification inbox |
| `GET` | `/api/v1/notifications/stats` | Dashboard statistics |
| `GET` | `/api/v1/whatsapp/config` | Tenant WhatsApp configuration |
| `PUT` | `/api/v1/whatsapp/config` | Update WhatsApp configuration |
| `GET` | `/api/v1/whatsapp/templates` | List notification templates |
| `GET` | `/webhook/whatsapp` | Meta webhook verification |
| `POST` | `/webhook/whatsapp` | Delivery status callbacks |

## Database schema

Four tables, all with tenant isolation via RLS:

- **`whatsapp_config`** — Per-tenant WhatsApp Business API credentials
- **`whatsapp_messages`** — Message outbox with delivery tracking
- **`notification_logs`** — Immutable audit trail of all notification decisions
- **`notification_templates`** — Customizable message templates per event type

## Resilience

| Failure | Mitigation |
|---|---|
| WhatsApp API down | Circuit breaker opens → messages queued → retry every 5 min |
| Kafka consumer lag | Auto-scaling via KEDA + partition rebalancing |
| Database unreachable | Connection pool retry + health check fails → pod restart |
| Invalid event payload | Dead letter queue → manual inspection |
| Agent has no number | Logged and skipped — no notification sent |
| Rate limit hit | Exponential backoff with jitter, respects Meta rate limits |

## Deployment

- Runs as a Kubernetes Deployment (2–8 replicas via HPA)
- Secrets injected via External Secrets Operator from Vault
- Network policy: only allows traffic from BFF/gateway + outbound to Kafka/Postgres/Meta API
- Progressive rollout via Argo Rollouts with SLO-based promotion

## Observability

- **Metrics**: notification_sent_total, notification_failed_total, notification_latency_seconds (by event type, status)
- **Logs**: Structured JSON via pino, PII redacted (phone numbers, access tokens)
- **Alerts**: SLO burn rate on delivery success, circuit breaker state changes
- **Dashboard**: Grafana board showing send/deliver/read rates, latency percentiles, failure reasons
