# WebFlow OS — Webfluence Command Web

A single, self-contained, zero-dependency operations dashboard for the digital-marketing
agency **Webfluence** (webfluence.in). All HTML, CSS and vanilla JS live in one `index.html`
— no build step, no frameworks, no external network calls.

## Run it

**No server** — just double-click `index.html` (runs fully offline in any browser).

**Local server (optional):**
```bash
python3 -m http.server 8080   # → http://localhost:8080
```

**Share:** drag `index.html` onto app.netlify.com/drop, or push to GitHub and enable Pages.

## What's inside

13 tabs over real Webfluence data, plus the W1–W5 automation engine:

| Tab | Shows |
|-----|-------|
| Command Web | agency KPIs, ROAS chart, campaigns, pipeline, lead capture, anomalies, activity feed |
| Clients | account cards (result + retainer + health) + brand logo wall |
| Leads & Pipeline | AI-scored inbound enquiries + deal kanban + capture form |
| Performance Ads | per-channel ROAS, campaign table, Sync (W3) |
| Projects | kanban (click a card to advance) |
| Social Calendar | month grid + schedule |
| Reports | AI client report (W4) + health/ROAS table |
| Finance | MRR, collected, outstanding, profit, invoices, expenses |
| Team & Ops | per-operator tasks by designation, click-to-rename |
| AI Studio | one-click AI tools |
| Services / Industries / Studio | capabilities, sectors, story + AI toggle |

### Automations
- **W1 captureLead** — normalize → AI score (0–100) → lifecycle (SQL/MQL/LEAD) → route owner → log → queue nurture → auto-deal if score ≥ 50.
- **W3 syncCampaigns** — simulate a day of ad delivery → recompute CPC/CPL/CPA/ROAS/CTR.
- **W4 generateReport** — gather a client's KPIs → plain-language summary → modal.
- **W5 checkAnomalies** — overspend, ROAS < 1.5×, idle hot leads, overdue invoices.

The AI runs on a transparent **heuristic** by default so it always works offline; the Studio
tab has a conceptual toggle to switch to the **Anthropic Claude API** when a key is configured
(wiring real calls requires a small backend to hold the secret — never expose keys in the client).

## Data
100% real Webfluence accounts (Mavenn Realty, Nambiyar Builder, The Gyn Next Door, Homies,
iChain, Next Footstep) — no invented companies.
