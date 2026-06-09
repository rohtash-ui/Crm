# Webfluence CRM — Production Development Blueprint

> Multi-tenant CRM platform for **Webfluence** (digital + performance marketing agency).
> Produced by a multi-agent design pass: CRM Architect → Lead → Sales Pipeline → Campaign →
> Reporting → Nurture → Alert → QA/Security, then consolidated into one buildable plan.

**Stack:** Next.js 15 (App Router, TS, Tailwind, ShadCN) · NestJS API · PostgreSQL · Prisma ·
Auth.js · Redis + BullMQ · AWS S3 · Claude/OpenAI · Docker on AWS.

There is already a **working zero-dependency reference build** in this repo (`src/`, `public/`,
`index.html`) proving the W1–W5 automation contracts end-to-end. This blueprint is the path from
that prototype to the production platform. **Keep the data contracts; the tools are swappable.**

---

## 0. Table of contents
1. System architecture
2. Multi-tenancy & data isolation
3. Roles & permissions matrix
4. Full database schema (Prisma)
5. Module-by-module agent outputs (APIs, workflows, UI, automations, tests)
6. API architecture & conventions
7. Folder structure (monorepo)
8. AI Copilot architecture
9. Integration plan
10. Development roadmap (MVP → Phase 2 → Phase 3)
11. Production deployment guide
12. Consolidated QA / Security checklist

---

## 1. System architecture

```
                         ┌───────────────────────────────────────────┐
                         │                Clients / Users             │
                         │  Admin · Sales · Marketing · Ops · Finance │
                         │              · Client Portal               │
                         └───────────────────┬───────────────────────┘
                                             │ HTTPS
                              ┌──────────────▼──────────────┐
                              │   Next.js 15 (Vercel/ECS)    │  SSR + RSC + ShadCN UI
                              │   Auth.js session @ edge     │
                              └──────────────┬──────────────┘
                                             │ REST/JSON (+ tenant header)
                              ┌──────────────▼──────────────┐
                              │      NestJS API (ECS)        │  Guards: Auth, Tenant, RBAC
                              │  Modules ↔ database_tables   │  Zod/class-validator DTOs
                              └───┬───────────┬──────────┬───┘
                ┌─────────────────┘           │          └───────────────┐
        ┌───────▼────────┐         ┌──────────▼────────┐        ┌─────────▼─────────┐
        │  PostgreSQL    │         │   Redis + BullMQ  │        │   AWS S3          │
        │  (RLS / tenant)│         │  queues + cache   │        │  reports/uploads  │
        │  Prisma client │         │                   │        │  (signed URLs)    │
        └────────────────┘         └─────────┬─────────┘        └───────────────────┘
                                             │ workers
              ┌──────────────────────────────┼──────────────────────────────┐
        ┌─────▼─────┐  ┌─────▼─────┐  ┌──────▼──────┐  ┌──────▼──────┐  ┌────▼────┐
        │ Meta Ads  │  │ Google Ads│  │ GA4 / GSC   │  │ Claude/GPT  │  │ Brevo / │
        │ Marketing │  │   API     │  │             │  │  AI jobs    │  │ WA/SMS  │
        └───────────┘  └───────────┘  └─────────────┘  └─────────────┘  └─────────┘
```

**Request lifecycle:** Next.js obtains an Auth.js JWT → forwards `Authorization` + resolved
`tenantId` to NestJS → `AuthGuard` validates JWT → `TenantGuard` pins `tenantId` from the token
(never from the body) → `RbacGuard` checks the permission for the route → service layer runs all
queries through a **tenant-scoped Prisma client** (every `where` carries `tenantId`). Long-running
work (ad sync, report render, AI summary, message sends) is **enqueued to BullMQ**, never run inline.

---

## 2. Multi-tenancy & data isolation

**Model: shared database, shared schema, row-level `tenantId`** (best cost/ops balance for an
agency with tens–hundreds of clients). Upgrade path to schema-per-tenant only if a large client
demands physical isolation.

- Every tenant-owned table carries a non-null `tenantId` (FK → `tenants`).
- **Defense in depth:**
  1. **App layer** — a `PrismaTenantService` injects `tenantId` into every query via Prisma
     `$extends` (client extension) so a developer *cannot* forget it.
  2. **DB layer** — PostgreSQL **Row-Level Security (RLS)** policies on every tenant table using
     `current_setting('app.tenant_id')`, set per-connection in a transaction. A bug in app code
     still cannot leak cross-tenant rows.
- **Client portal isolation:** portal users have `role=CLIENT` and an additional `clientId` scope;
  their token grants read access only to rows where `clientId = token.clientId`.
- Tenant context is **derived from the authenticated token**, never from a request header/body that
  the client can spoof.

```ts
// prisma tenant extension (app-layer guard)
export const tenantClient = (tenantId: string) =>
  prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query, model }) {
          if (TENANT_MODELS.has(model)) {
            args.where = { ...(args.where ?? {}), tenantId };
            if (args.data) args.data = { ...args.data, tenantId };
          }
          return query(args);
        },
      },
    },
  });
```

---

## 3. Roles & permissions matrix

Roles: `ADMIN` (Founder), `SALES`, `ACCOUNT_MANAGER`, `MEDIA_BUYER`, `SEO`, `DESIGNER`,
`CONTENT`, `DEVELOPER`, `FINANCE`, `CLIENT`. Permissions are stored (RBAC), evaluated as
`resource:action` (e.g. `lead:assign`, `campaign:read`, `invoice:write`), and grouped into roles.

| Resource \ Role        | ADMIN | SALES | ACCT_MGR | MEDIA_BUYER | SEO/DESIGN/CONTENT/DEV | FINANCE | CLIENT |
|------------------------|:-----:|:-----:|:--------:|:-----------:|:----------------------:|:-------:|:------:|
| leads                  | CRUD  | CRUD  | RU       | R           | –                      | –       | –      |
| deals / pipeline       | CRUD  | CRUD  | RU       | R           | –                      | R       | –      |
| campaigns              | CRUD  | R     | RU       | CRUD        | R (own discipline)     | R       | R(own) |
| reports                | CRUD  | R     | CRUD     | R           | R                      | R       | R(own) |
| tasks                  | CRUD  | CRU   | CRUD     | CRU         | RU (assigned)          | –       | R(own) |
| invoices / payments    | CRUD  | –     | R        | –           | –                      | CRUD    | R(own) |
| clients                | CRUD  | R     | RU       | R           | R                      | R       | R(self)|
| users / roles          | CRUD  | –     | –        | –           | –                      | –       | –      |
| integrations / keys    | CRUD  | –     | –        | R           | –                      | –       | –      |
| audit_logs             | R     | –     | –        | –           | –                      | –       | –      |
| ai copilot             | ALL   | sales | account  | campaign    | own discipline         | finance | –      |

`CRUD`=create/read/update/delete · `RU`=read/update · `R`=read · `(own)`=scoped to assigned/owned rows.

---

## 4. Full database schema (Prisma)

```prisma
// schema.prisma — PostgreSQL. Money stored as Decimal(14,2). Every tenant table has tenantId.
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model Tenant {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  plan      String   @default("pro")
  createdAt DateTime @default(now())
  users     User[]
  clients   Client[]
}

enum Role { ADMIN SALES ACCOUNT_MANAGER MEDIA_BUYER SEO DESIGNER CONTENT DEVELOPER FINANCE CLIENT }

model User {
  id          String   @id @default(cuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  email       String
  name        String
  passwordHash String?
  role        Role     @default(SALES)
  clientId    String?  // set only for CLIENT portal users
  departmentId String?
  isActive    Boolean  @default(true)
  lastLoginAt DateTime?
  createdAt   DateTime @default(now())
  permissions Permission[] @relation("UserPermissions")
  assignedLeads Lead[]   @relation("LeadOwner")
  assignedTasks Task[]   @relation("TaskAssignee")
  @@unique([tenantId, email])
  @@index([tenantId, role])
}

model Permission {
  id    String @id @default(cuid())
  key   String // "lead:assign"
  users User[] @relation("UserPermissions")
  @@unique([key])
}

model Department {
  id       String @id @default(cuid())
  tenantId String
  name     String // Strategy, Performance Media, Creative, Content/SEO, Web, Analytics, Finance
  code     String // ST PM CR CW WB AN FN
}

model Team {
  id       String @id @default(cuid())
  tenantId String
  name     String
  leadId   String?
}

model Client {
  id            String   @id @default(cuid())
  tenantId      String
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  name          String
  industry      String?
  brandColor    String   @default("#f5b50c")
  contactName   String?
  contactEmail  String?
  retainer      Decimal  @default(0) @db.Decimal(14,2)
  reportSchedule String  @default("monthly")
  healthScore   Int      @default(80)
  status        String   @default("active")
  createdAt     DateTime @default(now())
  projects   Project[]
  campaigns  Campaign[]
  leads      Lead[]
  deals      Deal[]
  invoices   Invoice[]
  @@index([tenantId])
}

model Project {
  id        String   @id @default(cuid())
  tenantId  String
  clientId  String
  client    Client   @relation(fields: [clientId], references: [id])
  name      String
  service   String   // Performance, SEO, Web, Branding…
  status    String   @default("active")
  startDate DateTime?
  tasks     Task[]
  @@index([tenantId, clientId])
}

enum LeadSource { META GOOGLE WEBSITE MANUAL CSV REFERRAL WHATSAPP LINKEDIN }
enum Lifecycle  { LEAD MQL SQL CUSTOMER LOST }

model Lead {
  id            String     @id @default(cuid())
  tenantId      String
  clientId      String?
  client        Client?    @relation(fields: [clientId], references: [id])
  name          String?
  email         String?
  phone         String?
  source        LeadSource @default(WEBSITE)
  sourceMeta    Json?      // raw payload from Meta/Google form
  message       String?
  sector        String?
  budgetBand    String?
  score         Int        @default(0)
  scoreReason   String?
  lifecycle     Lifecycle  @default(LEAD)
  ownerId       String?
  owner         User?      @relation("LeadOwner", fields: [ownerId], references: [id])
  dedupeKey     String?    // normalized email|phone for duplicate detection
  engagement    Int        @default(0)
  lastActivityAt DateTime  @default(now())
  createdAt     DateTime   @default(now())
  deal          Deal?
  activities    Activity[]
  @@unique([tenantId, dedupeKey])
  @@index([tenantId, lifecycle, score])
}

model Deal {
  id          String   @id @default(cuid())
  tenantId    String
  clientId    String?
  leadId      String?  @unique
  lead        Lead?    @relation(fields: [leadId], references: [id])
  title       String
  stage       String   @default("NEW")   // NEW CONTACTED PROPOSAL NEGOTIATION WON LOST
  value       Decimal  @default(0) @db.Decimal(14,2)
  probability Int      @default(50)
  ownerId     String?
  stageEnteredAt DateTime @default(now())
  closedAt    DateTime?
  createdAt   DateTime @default(now())
  @@index([tenantId, stage])
}

enum Channel { META GOOGLE LINKEDIN YOUTUBE SEO }

model Campaign {
  id          String   @id @default(cuid())
  tenantId    String
  clientId    String
  client      Client   @relation(fields: [clientId], references: [id])
  externalId  String?  // Meta/Google campaign id
  name        String
  channel     Channel  @default(META)
  budget      Decimal  @default(0) @db.Decimal(14,2)
  spend       Decimal  @default(0) @db.Decimal(14,2)
  impressions Int      @default(0)
  clicks      Int      @default(0)
  conversions Int      @default(0)
  revenue     Decimal  @default(0) @db.Decimal(14,2)
  cpc  Float @default(0)
  cpl  Float @default(0)
  cpa  Float @default(0)
  roas Float @default(0)
  ctr  Float @default(0)
  healthScore Int     @default(80)
  updatedAt   DateTime @updatedAt
  metricsDaily CampaignMetricDaily[]
  @@index([tenantId, clientId, channel])
}

model CampaignMetricDaily {
  id         String   @id @default(cuid())
  tenantId   String
  campaignId String
  campaign   Campaign @relation(fields: [campaignId], references: [id])
  date       DateTime @db.Date
  spend      Decimal  @db.Decimal(14,2)
  impressions Int
  clicks     Int
  conversions Int
  revenue    Decimal  @db.Decimal(14,2)
  @@unique([campaignId, date])
}

model Task {
  id         String   @id @default(cuid())
  tenantId   String
  projectId  String?
  project    Project? @relation(fields: [projectId], references: [id])
  clientId   String?
  title      String
  disciplineCode String? // ST PM CR CW WB AN — used for auto-assignment
  assigneeId String?
  assignee   User?    @relation("TaskAssignee", fields: [assigneeId], references: [id])
  priority   String   @default("MEDIUM")
  status     String   @default("PENDING") // PENDING IN_PROGRESS REVIEW APPROVED
  dueDate    DateTime?
  createdAt  DateTime @default(now())
  comments   Comment[]
  @@index([tenantId, status])
}

model Comment {
  id        String   @id @default(cuid())
  tenantId  String
  taskId    String
  task      Task     @relation(fields: [taskId], references: [id])
  authorId  String
  body      String
  createdAt DateTime @default(now())
}

model Activity {
  id        String   @id @default(cuid())
  tenantId  String
  leadId    String?
  lead      Lead?    @relation(fields: [leadId], references: [id])
  clientId  String?
  type      String   // lead_captured, assigned, nurture_enqueued, deal_created, campaigns_synced…
  detail    String?
  meta      Json?
  createdAt DateTime @default(now())
  @@index([tenantId, createdAt])
}

model Notification {
  id        String   @id @default(cuid())
  tenantId  String
  userId    String?
  level     String   @default("info") // info warning high
  type      String
  message   String
  readAt    DateTime?
  createdAt DateTime @default(now())
  @@index([tenantId, userId, readAt])
}

model Report {
  id         String   @id @default(cuid())
  tenantId   String
  clientId   String
  schedule   String   @default("monthly")
  status     String   @default("draft") // draft sent
  summary    String?
  kpis       Json?
  fileUrl    String?  // S3 PDF
  lastSent   DateTime?
  createdAt  DateTime @default(now())
  @@index([tenantId, clientId])
}

model Invoice {
  id        String   @id @default(cuid())
  tenantId  String
  clientId  String
  client    Client   @relation(fields: [clientId], references: [id])
  number    String
  amount    Decimal  @db.Decimal(14,2)
  status    String   @default("DRAFT") // DRAFT SENT PAID OVERDUE
  dueDate   DateTime?
  paidAt    DateTime?
  createdAt DateTime @default(now())
  payments  Payment[]
  @@unique([tenantId, number])
}

model Payment {
  id        String   @id @default(cuid())
  tenantId  String
  invoiceId String
  invoice   Invoice  @relation(fields: [invoiceId], references: [id])
  amount    Decimal  @db.Decimal(14,2)
  method    String
  ref       String?
  createdAt DateTime @default(now())
}

model Expense {
  id        String   @id @default(cuid())
  tenantId  String
  category  String
  amount    Decimal  @db.Decimal(14,2)
  month     DateTime @db.Date
}

model Integration {
  id         String   @id @default(cuid())
  tenantId   String
  provider   String   // meta_ads google_ads ga4 gsc linkedin brevo whatsapp
  status     String   @default("disconnected")
  // secrets are NOT stored here in plaintext — see §11. This holds references/metadata only.
  externalAccountId String?
  scopes     String[]
  connectedAt DateTime?
  @@unique([tenantId, provider])
}

model AuditLog {
  id        String   @id @default(cuid())
  tenantId  String
  actorId   String?
  action    String   // user.login, lead.assign, invoice.update…
  resource  String
  resourceId String?
  ip        String?
  before    Json?
  after     Json?
  createdAt DateTime @default(now())
  @@index([tenantId, createdAt])
}
```

---

## 5. Module-by-module agent outputs

### 5.1 CRM Architect Agent
- **Owns:** tenancy, schema, RBAC, folder structure, API conventions (§2–4, §6–7).
- **Workflows:** tenant provisioning, user invite + role assignment, seed of departments/disciplines.
- **UI:** Admin → Settings (Org, Users & Roles, Departments, Integrations, Audit Log).
- **Tests:** tenant isolation (cross-tenant read denied at app *and* RLS layer); permission matrix
  enforced; RLS policy present on every tenant table; migration up/down clean.

### 5.2 Lead Agent (W1)
- **Tables:** `Lead`, `Activity`. **Sources:** Meta/Google webhook, website form, manual, CSV.
- **Workflow:** ingest → normalize → **dedupe** (`dedupeKey = lower(email)||digits(phone)`, unique
  per tenant; merge on collision) → **AI score 0–100** → lifecycle (`≥75 SQL / ≥50 MQL / else LEAD`)
  → **round-robin / discipline-based owner assignment** → write `Activity` → enqueue nurture step →
  auto-create `Deal` when `score ≥ 50`.
- **APIs:**
  `POST /leads` (inbound webhook) · `POST /leads/csv` · `GET /leads?lifecycle=&owner=&q=` ·
  `PATCH /leads/:id/assign` · `POST /leads/:id/score` (re-score) · `POST /leads/merge`.
- **UI:** Lead inbox (filter/search), lead detail drawer (score + reason + timeline), CSV importer
  with column mapping + dedupe preview.
- **Tests:** referral high-intent lead → score ≥ 75 & stage SQL; duplicate upload merges not dupes;
  assignment is fair round-robin; auto-deal only at score ≥ 50.

### 5.3 Sales Pipeline Agent
- **Tables:** `Deal`. Stages: NEW→CONTACTED→PROPOSAL→NEGOTIATION→WON/LOST.
- **Workflow:** drag to advance (writes `stageEnteredAt`); **stale detection** (no movement N days
  by stage → flag + task); **win-probability** model (stage base × recency × engagement);
  **next-best-action** suggestion via AI Copilot; forecast = Σ(value × probability) per period.
- **APIs:** `GET /deals?stage=` · `POST /deals` · `PATCH /deals/:id/stage` · `GET /pipeline/forecast`
  · `GET /deals/stale`.
- **UI:** Kanban board (columns = stages, cards show value + owner + age), forecast widget.
- **Tests:** stage transitions audited; stale deals surfaced; forecast math; WON closes deal + flips
  lead lifecycle to CUSTOMER.

### 5.4 Campaign Agent (W3)
- **Tables:** `Campaign`, `CampaignMetricDaily`, `Integration`.
- **Workflow:** nightly BullMQ job pulls **Meta Marketing / Google Ads / LinkedIn / GA4 / GSC** →
  upsert daily metrics → recompute `cpc/cpl/cpa/roas/ctr` → **campaign health score** (ROAS vs target,
  pacing vs budget, CPL trend) → emit anomalies to Alert Agent. Simulated provider exists today; swap
  per-provider adapter behind a `CampaignProvider` interface.
- **APIs:** `POST /campaigns/sync` (manual) · `GET /campaigns?clientId=&channel=` ·
  `GET /campaigns/:id/metrics?range=` · `POST /integrations/:provider/connect` (OAuth start).
- **UI:** Performance dashboard (per-channel ROAS cards, spend-vs-budget, campaign table, trend chart).
- **Tests:** metric recompute correctness; overspend seed flags; OAuth token refresh; provider
  adapter contract test against fixture payloads.

### 5.5 Reporting Agent (W4)
- **Tables:** `Report`. **Workflow:** gather client KPIs → **AI plain-language summary** →
  render **white-label PDF** (client `brandColor`/logo) via headless renderer in a worker → store to
  **S3** → email signed link → mark `sent`. Scheduler honors each client's `reportSchedule`.
- **APIs:** `POST /reports/:clientId/generate` · `GET /reports?clientId=` · `GET /reports/:id/pdf`
  (signed URL) · `POST /reports/schedule`.
- **UI:** Reports list, report preview modal (KPIs + AI summary), schedule manager.
- **Tests:** PDF renders with correct branding; scheduled job fires per cadence; client portal user
  sees only own reports; AI summary falls back to heuristic without a key.

### 5.6 Nurture Agent (W2)
- **Tables:** `Sequence`, `SequenceStep`, `MessageLog` (add to schema in Phase 2), `Activity`.
- **Workflow:** on capture enroll lead in a **sequence** (email via Brevo/Resend, **WhatsApp Cloud
  API**, SMS); step scheduler in BullMQ; **AI-drafted replies** (human-approve for cold start);
  appointment + renewal reminders. Each send writes `Activity` + `MessageLog`.
- **APIs:** `GET/POST /sequences` · `POST /sequences/:id/enroll` · `POST /messages/send` ·
  `POST /webhooks/whatsapp` (inbound).
- **UI:** Sequence builder (steps, delays, channel), communication inbox/timeline, template library.
- **Tests:** step timing; opt-out honored; provider failure retries with backoff; no double-send.

### 5.7 Alert Agent (W5)
- **Tables:** `Notification`. **Rules:** overspend (spend>budget), low ROAS (<1.5×), high CPL
  (>target×1.5), delayed lead response (SLA breach), **cold hot-lead** (score≥70 idle 3+ days),
  overdue task, **overdue invoice**.
- **Workflow:** evaluator runs on schedule + on relevant events → create `Notification` → fan out to
  **in-app center, email, WhatsApp/Slack** by severity.
- **APIs:** `GET /alerts` · `GET /notifications?unread=1` · `PATCH /notifications/:id/read` ·
  `POST /alerts/rules` (configurable thresholds per tenant).
- **UI:** Notification center (bell + drawer), dashboard "Needs attention (the 5%)" panel.
- **Tests:** each rule fires on seed; thresholds configurable per tenant; no alert storms (dedupe +
  cooldown); severity routing.

### 5.8 QA / Security Agent
See consolidated checklist in §12.

---

## 6. API architecture & conventions
- **Style:** REST, resource-oriented, versioned `/api/v1/*`. JSON only. Cursor pagination
  (`?cursor=&limit=`). Consistent envelope `{ data, meta, error }`.
- **Validation:** every endpoint has a DTO (class-validator/Zod); reject unknown fields.
- **Guards (order):** `AuthGuard` → `TenantGuard` → `RbacGuard(permission)` → `RateLimitGuard`.
- **Idempotency:** webhooks accept an idempotency key; ad-sync upserts by `(externalId)`/`(campaignId,date)`.
- **Errors:** RFC-7807-style problem JSON; never leak stack traces in prod.
- **Async:** mutations that touch third parties return `202 + jobId`; client polls `GET /jobs/:id` or
  subscribes via SSE/websocket for the notification.
- **Audit:** mutating routes write an `AuditLog` row via an interceptor.

**Endpoint map (v1):** `/auth` · `/tenants` · `/users` · `/roles` · `/clients` · `/projects` ·
`/leads` · `/deals` · `/pipeline` · `/campaigns` · `/integrations` · `/reports` · `/sequences` ·
`/messages` · `/tasks` · `/invoices` · `/payments` · `/expenses` · `/alerts` · `/notifications` ·
`/audit-logs` · `/ai` · `/stats`.

---

## 7. Folder structure (Turborepo monorepo)

```
webfluence-crm/
├─ apps/
│  ├─ web/                      # Next.js 15 (App Router)
│  │  ├─ app/
│  │  │  ├─ (auth)/login/
│  │  │  ├─ (dashboard)/
│  │  │  │  ├─ admin/  sales/  marketing/  ops/  finance/
│  │  │  │  ├─ leads/  pipeline/  campaigns/  reports/
│  │  │  │  ├─ tasks/  team/  finance/  ai/  notifications/
│  │  │  └─ (portal)/client/    # white-label client portal
│  │  ├─ components/ui/         # ShadCN
│  │  ├─ lib/ (api-client, auth, hooks, formatters)
│  │  └─ middleware.ts          # Auth.js session @ edge
│  └─ api/                      # NestJS
│     ├─ src/
│     │  ├─ modules/{auth,tenants,users,leads,deals,campaigns,reports,
│     │  │            nurture,alerts,finance,tasks,ai,integrations,audit}/
│     │  │     └─ *.{controller,service,module,dto}.ts
│     │  ├─ common/{guards,interceptors,decorators,filters}/
│     │  ├─ prisma/ (prisma.service.ts, tenant.extension.ts)
│     │  ├─ queue/ (processors: ad-sync, report, nurture, alerts)
│     │  └─ main.ts
│     └─ test/ (e2e)
├─ packages/
│  ├─ db/        # prisma schema + migrations + seed
│  ├─ types/     # shared TS types / zod schemas
│  ├─ ai/        # Claude/OpenAI clients + heuristic fallback (scoreLead, summarize)
│  └─ config/    # eslint, tsconfig, tailwind preset
├─ infra/        # Docker, docker-compose, terraform/ (ECS, RDS, ElastiCache, S3)
├─ legacy-node-prototype/   # the current zero-dep src/ + public/ (reference, do not edit)
└─ turbo.json
```

---

## 8. AI Copilot architecture
- **All AI calls live in `packages/ai`** with a `scoreLead()` / `summarizeReport()` /
  `nextBestAction()` / `draftReply()` surface. **Heuristic fallback always present** → app never
  hard-fails without a key (proven in the current prototype).
- **Provider routing:** Claude primary (`claude-haiku-4-5` for scoring/short, `claude-sonnet` for
  long-form reports), OpenAI as configurable fallback.
- **Guardrails:** strict JSON schema for scoring; timeouts + retries in workers; PII minimization in
  prompts; per-tenant token budgets + cost logging.
- **Copilot surfaces:** lead scorer, cross-client performance summary, deal next-best-action, delay
  prediction, meeting notes, anomaly explanation, report narrative.

---

## 9. Integration plan
| Module | Integration | Use |
|--------|-------------|-----|
| Campaigns | Meta Marketing API, Google Ads API, LinkedIn Campaign Mgr, GA4, GSC | live spend/ROAS/leads, sessions, search |
| Leads | Meta Lead Ads webhook, Google Lead Form, website form, CSV | inbound capture |
| Nurture | Brevo/Resend (email), WhatsApp Cloud API, SMS (MSG91/Twilio) | sequences, reminders |
| Finance | Razorpay/Stripe, Zoho Books/QuickBooks | auto-mark PAID, real invoices |
| Ops | Slack webhooks, Google Calendar, Jira/Linear | alerts to #ops, schedules, task sync |
| AI | Anthropic Claude, OpenAI | narratives, scoring |
| Storage | AWS S3 | report PDFs, uploads (signed URLs) |

**Secrets** live in AWS Secrets Manager / SSM, fetched by the API at runtime — **never in the client,
never plaintext in `Integration`**. OAuth refresh tokens encrypted at rest (KMS).

---

## 10. Development roadmap

**MVP (Weeks 1–6) — "data in, pipeline working"**
1. Monorepo + Prisma schema + migrations + seed; Auth.js login; tenancy + RBAC guards + RLS.
2. Lead Management (capture, dedupe, AI score, assign) + Activity log.
3. Sales Pipeline (Kanban, stages, forecast).
4. Campaign tracking with **simulated** sync + recompute + Performance dashboard.
5. Reporting (KPIs + AI summary + PDF to S3).
6. Alert center (W5 rules) + Notification center. Admin dashboard. **Acceptance = the 5 criteria
   from the prototype, now multi-tenant + persisted.**

**Phase 2 (Weeks 7–12) — "CRM & finance & real data"**
- Real Meta + Google Ads + GA4 adapters (OAuth, nightly BullMQ sync).
- Nurture engine (sequences, Brevo + WhatsApp Cloud API, `Sequence`/`MessageLog` models).
- Finance module (invoices, payments, expenses, Razorpay auto-reconcile).
- Task/Team management with discipline auto-assignment. Client portal (white-label, read-only).
- Slack alerts, scheduled reports.

**Phase 3 (Month 4+) — "scale & intelligence"**
- LinkedIn + GSC, Looker embeds; advanced forecasting; AI next-best-action everywhere.
- Per-client SLA automation; usage-based AI budgets; SOC2-readiness; schema-per-tenant option for
  enterprise clients; horizontal worker scaling.

---

## 11. Production deployment guide
- **Containers:** `apps/web` and `apps/api` Dockerized; workers run the same API image with a
  `WORKER=1` entrypoint. Compose for local; **ECS Fargate** services in prod (web, api, worker).
- **Data:** **RDS PostgreSQL** (Multi-AZ, automated backups, PITR) with RLS enabled;
  **ElastiCache Redis** for cache + BullMQ; **S3** for files (private, signed URLs, lifecycle rules).
- **Networking:** ALB → web/api; private subnets for RDS/Redis; WAF + rate limiting at the edge.
- **Secrets:** AWS Secrets Manager / SSM; KMS-encrypted; rotated. No secrets in env files in prod.
- **CI/CD:** GitHub Actions → lint+typecheck+test → build images → push ECR →
  `prisma migrate deploy` → ECS rolling deploy (blue/green). Preview envs per PR.
- **Observability:** OpenTelemetry traces, structured JSON logs → CloudWatch; Sentry for errors;
  health checks `/healthz` + queue depth alarms.
- **Backups/DR:** nightly RDS snapshots, S3 versioning, documented restore runbook; RPO ≤ 24h.
- **Env vars:** `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `S3_BUCKET`, `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `META_*`, `GOOGLE_ADS_*`, `BREVO_API_KEY`, `WHATSAPP_*`, `RAZORPAY_*`.

---

## 12. Consolidated QA / Security checklist
**Security**
- [ ] Cross-tenant read/write denied at **app layer AND RLS**; automated isolation tests in CI.
- [ ] RBAC enforced server-side per route (never UI-only); permission matrix has e2e coverage.
- [ ] Client portal users limited to own `clientId`; no enumeration via IDOR (test sequential IDs).
- [ ] All secrets in Secrets Manager/KMS; none in client bundle, repo, or `Integration` plaintext.
- [ ] OAuth tokens encrypted at rest; refresh handled; least-scope requested.
- [ ] Input validation on every DTO; output encoding; CSP + security headers; CSRF on cookie auth.
- [ ] Rate limiting per IP + per tenant; webhook signature verification (Meta/WhatsApp/Razorpay).
- [ ] Audit log on every mutation; immutable; admin-only read.
- [ ] Dependency + container scanning; secret scanning in CI; quarterly pen-test.

**Functional QA**
- [ ] W1: referral high-intent lead → score ≥ 75, stage SQL, owner assigned, deal auto-created.
- [ ] Dedupe merges duplicate leads, never creates twins.
- [ ] W3: sync recomputes CPC/CPL/CPA/ROAS/CTR; overspend campaign flags.
- [ ] W4: report renders branded PDF, AI summary present, heuristic fallback without key.
- [ ] W5: each alert rule fires on seed; thresholds configurable; severity routing works.
- [ ] Pipeline: stage transitions audited; stale deals flagged; forecast math correct.
- [ ] Finance: invoice OVERDUE flagged; payment marks PAID; profit = MRR − expenses.
- [ ] AI works with no key (heuristic) and with key (Claude) — both paths green.
- [ ] Background jobs idempotent; retries with backoff; no double-sends in nurture.
- [ ] Accessibility (keyboard, contrast) and responsive layouts on all dashboards.

---

### How this maps to what already exists
The repo's `src/` (Node zero-dep) + `public/` and the single-file `index.html` already implement the
**W1–W5 contracts, seed data, REST surface, and dashboards** end-to-end with the heuristic AI
fallback. They are the executable spec. Production work = port these contracts into the NestJS +
Prisma + Postgres structure above, add tenancy/RBAC/RLS, swap simulated providers for real adapters,
and follow the roadmap. Keep the data contracts stable; everything else is swappable.
