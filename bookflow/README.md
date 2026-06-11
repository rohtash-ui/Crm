# BookFlow — Calendly-style Scheduling with PayPal Payments

A full-stack SaaS booking platform built with **Next.js 16**, **Prisma 7**, **NextAuth v4**, **PayPal Orders API**, and **Google Calendar API**.

## Features

- 🔐 **Google OAuth** login (NextAuth v4)
- 📋 **Event Types** — create bookable services with custom duration, price, currency, color, and location
- 🕐 **Availability** — set per-day working hours, used to generate time slots
- 🔗 **Public Booking Pages** — `/book/:username` and `/book/:username/:slug`
- 🗓️ **Multi-step booking flow** — date → time slot → guest details → payment → confirmation
- 💳 **PayPal Payments** — sandbox + live mode, server-side order creation and capture
- 🔔 **PayPal Webhooks** — `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, with signature verification
- 📅 **Google Calendar** — auto-creates events with Google Meet links after confirmed payment
- 📊 **Google FreeBusy** — checks Google Calendar for conflicts when generating slots
- ✉️ **Emails** — booking confirmation, host notification, cancellation, and reschedule emails
- ❌ **Cancel & Reschedule** — with calendar sync and guest email notifications
- 🌍 **Timezone support** — host and guest timezones stored and used in calendar events
- 🛡️ **Security** — all mutations verify ownership; payments confirmed server-side only

---

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL (Prisma 7 + PrismaPg adapter) |
| Auth | NextAuth.js v4 (Google OAuth) |
| Payments | PayPal Orders API v2 |
| Calendar | Google Calendar API v3 |
| Email | Nodemailer (SMTP) |
| Styling | Tailwind CSS v4 |
| Deployment | Vercel + Supabase/Neon |

---

## Local Setup

### 1. Clone and install

```bash
cd bookflow
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials (see detailed guide below).

### 3. Set up the database

```bash
npx prisma migrate dev --name init
```

### 4. Start the dev server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000).

---

## Environment Variables Guide

### Database (PostgreSQL)

Use [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Railway](https://railway.app):

```env
DATABASE_URL="postgresql://user:password@host:5432/bookflow?sslmode=require"
```

### NextAuth

```env
NEXTAUTH_URL="http://localhost:3000"           # Full URL of your app
NEXTAUTH_SECRET="long-random-secret"          # openssl rand -base64 32
```

### Google OAuth + Calendar

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Google Calendar API** and **Google People API**
4. Go to **APIs & Services → Credentials → Create OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
7. Add the **OAuth consent screen** scopes:
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/calendar`
8. Copy the client ID and secret:

```env
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
```

### PayPal

#### Sandbox (testing)

1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications)
2. Create a **Sandbox** application
3. Copy the **Client ID** and **Secret**:

```env
PAYPAL_CLIENT_ID="your-sandbox-client-id"
PAYPAL_CLIENT_SECRET="your-sandbox-client-secret"
PAYPAL_MODE="sandbox"
NEXT_PUBLIC_PAYPAL_CLIENT_ID="your-sandbox-client-id"
NEXT_PUBLIC_PAYPAL_MODE="sandbox"
```

Test with PayPal sandbox buyer accounts from the [sandbox accounts dashboard](https://developer.paypal.com/dashboard/accounts).

#### Live (production)

1. Create a **Live** application in the PayPal Developer Dashboard
2. Switch to **Live** in the top menu
3. Update your environment variables:

```env
PAYPAL_MODE="live"
NEXT_PUBLIC_PAYPAL_MODE="live"
PAYPAL_CLIENT_ID="your-live-client-id"
PAYPAL_CLIENT_SECRET="your-live-client-secret"
NEXT_PUBLIC_PAYPAL_CLIENT_ID="your-live-client-id"
```

#### PayPal Webhooks (optional but recommended)

Webhooks provide a fallback for confirming payments when the client-side flow fails.

1. Go to [PayPal Webhooks Dashboard](https://developer.paypal.com/dashboard/webhooks)
2. Create a webhook pointing to: `https://yourdomain.com/api/payments/webhook`
3. Subscribe to these events:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.DENIED`
   - `CHECKOUT.ORDER.APPROVED`
4. Copy the **Webhook ID**:

```env
PAYPAL_WEBHOOK_ID="your-webhook-id"
```

### Email (SMTP)

Using Gmail (recommended for getting started):

1. Enable 2-factor authentication on your Google account
2. Go to [App Passwords](https://myaccount.google.com/apppasswords)
3. Create an app password for "Mail"

```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-16-char-app-password"
SMTP_FROM="BookFlow <noreply@yourdomain.com>"
```

> Email is optional — if SMTP is not configured, emails are skipped with a warning log.

---

## Deploying to Vercel

### Prerequisites

- [Vercel account](https://vercel.com)
- A PostgreSQL database (Neon is free and easy)

### Steps

1. Push your code to GitHub
2. Import the repo in Vercel, set **Root Directory** to `bookflow`
3. Add all environment variables in **Project Settings → Environment Variables**
4. For `NEXTAUTH_URL`, set it to your production domain: `https://yourdomain.vercel.app`
5. Add your production domain as an authorized redirect URI in Google Cloud Console
6. Deploy

### Post-deploy

Run the database migration:

```bash
# Using Vercel CLI
vercel env pull .env.production.local
DATABASE_URL=$(grep DATABASE_URL .env.production.local | cut -d= -f2) npx prisma migrate deploy
```

Or run `npx prisma migrate deploy` in a Vercel build step.

---

## Project Structure

```
bookflow/
├── app/
│   ├── (dashboard)/          # Auth-protected dashboard
│   │   ├── layout.tsx        # Checks session, renders sidebar
│   │   └── dashboard/
│   │       ├── page.tsx      # Overview: stats + recent bookings
│   │       ├── event-types/  # CRUD event types
│   │       ├── availability/ # Set weekly schedule
│   │       ├── bookings/     # View, cancel, reschedule bookings
│   │       └── settings/     # Username, timezone, integrations
│   ├── api/
│   │   ├── auth/[...nextauth]/   # NextAuth handler
│   │   ├── event-types/          # GET list, POST create
│   │   ├── event-types/[id]/     # PATCH update, DELETE
│   │   ├── availability/         # GET, POST (replaces all)
│   │   ├── bookings/             # GET bookings (host)
│   │   ├── bookings/public/      # GET slots, POST create booking
│   │   ├── bookings/[id]/        # PATCH cancel/reschedule
│   │   ├── payments/create-order/  # POST: create PayPal order
│   │   ├── payments/capture/       # POST: capture payment + confirm
│   │   ├── payments/webhook/       # POST: PayPal webhook handler
│   │   ├── calendar/connect/       # GET status, POST save tokens
│   │   └── user/username/          # GET/PATCH username + timezone
│   ├── book/[username]/      # Public host page
│   └── book/[username]/[slug]/  # Booking flow
├── components/
│   ├── booking/
│   │   ├── BookingFlow.tsx   # Multi-step booking UI
│   │   └── PayPalButton.tsx  # PayPal JS SDK wrapper
│   └── dashboard/
│       └── Sidebar.tsx       # Dashboard navigation
├── lib/
│   ├── auth.ts               # NextAuth config + auth() helper
│   ├── email.ts              # All email templates
│   ├── env.ts                # Env validation helpers
│   ├── google-calendar.ts    # Calendar CRUD + FreeBusy
│   ├── paypal.ts             # PayPal API: create, capture, webhook verify
│   ├── prisma.ts             # PrismaClient singleton
│   └── slots.ts              # Time slot generation
├── prisma/
│   └── schema.prisma         # Full database schema
├── types/
│   └── next-auth.d.ts        # Session type augmentation
└── .env.example              # All required environment variables
```

---

## Payment Security

- **Client side never confirms a booking.** The booking status only changes to `CONFIRMED` after the server calls `capturePayPalOrder()` and gets back `status: "COMPLETED"`.
- **Order ID is verified before capture.** The server checks the order ID matches the booking's stored `paypalOrderId`.
- **Webhook fallback.** If the client-side capture flow fails (network drop, browser close), PayPal webhooks re-confirm the payment server-side.
- **Webhook signature verification.** When `PAYPAL_WEBHOOK_ID` is set, every webhook event is verified against PayPal's certificates before processing.
- **Idempotent.** Both the capture route and the webhook handler check if a payment is already `COMPLETED` before processing again.

---

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/event-types` | ✅ Session | List own event types |
| `POST` | `/api/event-types` | ✅ Session | Create event type |
| `PATCH` | `/api/event-types/:id` | ✅ Session + Owner | Update event type |
| `DELETE` | `/api/event-types/:id` | ✅ Session + Owner | Delete event type |
| `GET` | `/api/availability` | ✅ Session | Get own availability |
| `POST` | `/api/availability` | ✅ Session | Save availability |
| `GET` | `/api/bookings` | ✅ Session | List own bookings |
| `PATCH` | `/api/bookings/:id` | ✅ Session + Owner | Cancel / Reschedule |
| `GET` | `/api/bookings/public` | Public | Get available slots |
| `POST` | `/api/bookings/public` | Public | Create booking |
| `POST` | `/api/payments/create-order` | Public | Create PayPal order |
| `POST` | `/api/payments/capture` | Public | Capture payment |
| `POST` | `/api/payments/webhook` | Public (PayPal) | PayPal webhook |
| `GET` | `/api/calendar/connect` | ✅ Session | Calendar connection status |
| `GET` | `/api/user/username` | ✅ Session | Get username + timezone |
| `PATCH` | `/api/user/username` | ✅ Session | Update username + timezone |
