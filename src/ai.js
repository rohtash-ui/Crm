// AI module: Claude scoring/summaries + transparent heuristic fallback.
// All AI calls live here. App never hard-fails when no key is set.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env if present (no dotenv dep)
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

const KEY = process.env.ANTHROPIC_API_KEY;
export const aiMode = KEY ? 'claude' : 'heuristic';

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const j = await res.json();
  return j.content[0].text.trim();
}

// W1 — score a lead 0-100
export async function scoreLead({ source = '', email = '', phone = '', message = '' }) {
  if (KEY) {
    try {
      const prompt = `You are a lead-scoring assistant for a digital-marketing agency (webfluence.in).
Score this inbound lead from 0–100 (higher = more sales-ready). Reply with JSON only: {"score":<int>,"reason":"<one sentence>"}.
source: ${source}
email: ${email}
phone: ${phone}
message: ${message}`;
      const raw = await callClaude(prompt);
      const { score, reason } = JSON.parse(raw.replace(/```json|```/g, '').trim());
      return { score: Math.max(0, Math.min(100, +score)), reason, source: 'claude' };
    } catch (e) {
      console.error('Claude scoreLead failed, falling back:', e.message);
    }
  }
  // Heuristic fallback
  let score = 30;
  const reasons = [];
  const src = source.toLowerCase();
  if (src.includes('referral')) { score += 28; reasons.push('referral'); }
  else if (src.includes('form') || src.includes('website')) { score += 14; reasons.push('website inbound'); }
  else if (src.includes('whatsapp')) { score += 10; reasons.push('WhatsApp enquiry'); }
  if (email) { score += 8; reasons.push('email provided'); }
  if (phone) { score += 8; reasons.push('phone provided'); }
  const msg = message.toLowerCase();
  if (msg.includes('budget') || msg.includes('ready') || msg.includes('demo')) { score += 18; reasons.push('high-intent message'); }
  else if (msg.includes('interested') || msg.includes('want') || msg.includes('need')) { score += 10; reasons.push('interested message'); }
  score = Math.max(0, Math.min(100, score));
  return { score, reason: reasons.join(', ') || 'baseline heuristic', source: 'heuristic' };
}

// W4 — plain-language client report summary
export async function summarizeReport(client, campaigns) {
  const spend    = campaigns.reduce((a, c) => a + c.spend, 0);
  const revenue  = campaigns.reduce((a, c) => a + c.revenue, 0);
  const conv     = campaigns.reduce((a, c) => a + c.conversions, 0);
  const roas     = spend ? +(revenue / spend).toFixed(2) : 0;

  if (KEY) {
    try {
      const prompt = `Write a 3-sentence plain-language performance summary for client "${client.name}".
KPIs: spend=₹${spend}, revenue=₹${revenue}, ROAS=${roas}x, conversions=${conv}, campaigns=${campaigns.length}.
Be concise and actionable. No markdown.`;
      const text = await callClaude(prompt);
      return text;
    } catch (e) {
      console.error('Claude summarizeReport failed, falling back:', e.message);
    }
  }
  // Heuristic fallback
  const verdict = roas >= 3 ? 'strong' : roas >= 1.5 ? 'healthy' : 'below target';
  return `${client.name} delivered ${verdict} performance this period: ₹${Math.round(spend).toLocaleString()} spend produced ₹${Math.round(revenue).toLocaleString()} revenue at ${roas}x blended ROAS with ${conv} conversions across ${campaigns.length} campaigns. ${roas < 1.5 ? 'ROAS is under the 1.5x floor — cap the weakest line and refresh creative.' : 'Scale the top-ROAS line while holding CPL steady.'} Next: lock the budget split in the Friday review. (heuristic)`;
}
