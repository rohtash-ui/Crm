// The automation workflows (W1-W5) from the build spec. These are the engine
// that delivers the 95%-automation goal. Each is a plain async function so it
// can be triggered by an HTTP webhook, a cron job, or Claude Code.

import { db, recomputeCampaignMetrics } from './db.js';
import { scoreLead, summarizeReport } from './ai.js';

const TEAM = ['Rohtash', 'Priya', 'Aman'];
let rr = 0;
const nextOwner = () => TEAM[rr++ % TEAM.length];

const logActivity = (contactId, clientId, type, detail) =>
  db.prepare('INSERT INTO activities (contact_id, client_id, type, detail) VALUES (?,?,?,?)')
    .run(contactId, clientId, type, detail);

// --- W1: Lead capture & routing (real-time) ---
export async function captureLead(payload) {
  const { client_id, source = 'form', message = '' } = payload;
  if (!client_id) throw new Error('client_id is required');
  // node:sqlite binds null, not undefined
  const name = payload.name ?? null;
  const email = payload.email ?? null;
  const phone = payload.phone ?? null;

  const { score, reason, source: aiSource } = await scoreLead({ source, email, phone, message });
  const stage = score >= 75 ? 'SQL' : score >= 50 ? 'MQL' : 'nurturing';
  const owner = nextOwner();

  const id = db.prepare(`INSERT INTO contacts
    (client_id,name,email,phone,source,message,lead_score,score_reason,lifecycle_stage,owner)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(client_id, name, email, phone, source, message, score, reason, stage, owner).lastInsertRowid;

  logActivity(id, client_id, 'lead_captured', `via ${source}; scored ${score} (${aiSource})`);
  logActivity(id, client_id, 'assigned', `owner ${owner}`);

  // W2 kickoff: enqueue the first nurture step (logged here; real sends go via email/WhatsApp)
  const firstStep = stage === 'SQL'
    ? 'High-intent: owner alerted + personal outreach scheduled'
    : 'Auto-enrolled in nurture sequence — step 1 email queued';
  logActivity(id, client_id, 'nurture_enqueued', firstStep);

  // Auto-create a deal for qualified leads
  if (score >= 50) {
    db.prepare('INSERT INTO deals (contact_id,client_id,title,stage,probability) VALUES (?,?,?,?,?)')
      .run(id, client_id, `${name || 'Lead'} — opportunity`, 'qualified', Math.min(90, score));
  }

  return { contact_id: id, score, reason, stage, owner, ai: aiSource };
}

// --- W3: Campaign data sync (nightly). Here we simulate an ad-platform pull. ---
export function syncCampaigns() {
  const rows = db.prepare('SELECT * FROM campaigns').all();
  for (const r of rows) {
    // simulate a day's incremental delivery (replace with Meta/Google Ads API calls)
    const dImpr = Math.round(r.impressions * (0.03 + Math.random() * 0.05));
    const dClicks = Math.round(dImpr * (0.008 + Math.random() * 0.01));
    const dConv = Math.round(dClicks * (0.01 + Math.random() * 0.03));
    const dSpend = +(dClicks * (15 + Math.random() * 25)).toFixed(0);
    const dRev = +(dConv * (3000 + Math.random() * 4000)).toFixed(0);
    const updated = {
      ...r,
      impressions: r.impressions + dImpr,
      clicks: r.clicks + dClicks,
      conversions: r.conversions + dConv,
      spend: r.spend + dSpend,
      revenue: r.revenue + dRev,
    };
    db.prepare('UPDATE campaigns SET impressions=?,clicks=?,conversions=?,spend=?,revenue=? WHERE campaign_id=?')
      .run(updated.impressions, updated.clicks, updated.conversions, updated.spend, updated.revenue, r.campaign_id);
    recomputeCampaignMetrics(db.prepare('SELECT * FROM campaigns WHERE campaign_id=?').get(r.campaign_id));
  }
  return { synced: rows.length };
}

// --- W4: Client reporting (scheduled) ---
export async function generateReport(clientId) {
  const client = db.prepare('SELECT * FROM clients WHERE client_id=?').get(clientId);
  if (!client) throw new Error('client not found');
  const campaigns = db.prepare('SELECT * FROM campaigns WHERE client_id=?').all(clientId);
  const summary = await summarizeReport(client, campaigns);
  db.prepare(`INSERT INTO reports (client_id,schedule,status,summary,last_sent)
    VALUES (?,?,?,?,datetime('now'))`).run(clientId, client.report_schedule, 'sent', summary);

  const spend = campaigns.reduce((a, c) => a + c.spend, 0);
  const revenue = campaigns.reduce((a, c) => a + c.revenue, 0);
  const conversions = campaigns.reduce((a, c) => a + c.conversions, 0);
  return {
    client: client.name,
    kpis: { spend, revenue, conversions, roas: spend ? +(revenue / spend).toFixed(2) : 0 },
    summary,
    campaigns,
  };
}

// --- W5: Anomaly & exception alerts (continuous) — the human 5% ---
export function checkAnomalies() {
  const alerts = [];
  for (const c of db.prepare('SELECT * FROM campaigns').all()) {
    if (c.budget && c.spend > c.budget) alerts.push({ level: 'high', type: 'overspend', msg: `${c.name}: spend ₹${c.spend} over budget ₹${c.budget}` });
    if (c.roas && c.roas < 1.5) alerts.push({ level: 'medium', type: 'low_roas', msg: `${c.name}: ROAS ${c.roas}x below 1.5x target` });
  }
  const cold = db.prepare(`SELECT * FROM contacts WHERE lead_score >= 70
    AND julianday('now') - julianday(last_activity_at) > 3`).all();
  for (const l of cold) alerts.push({ level: 'high', type: 'cold_hot_lead', msg: `${l.name || 'Lead'} scored ${l.lead_score} but no activity in 3+ days` });
  return alerts;
}
