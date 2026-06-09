// Zero-dependency HTTP server: REST API + static dashboard.
// Run: node --experimental-sqlite src/server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initSchema, seed } from './db.js';
import { captureLead, syncCampaigns, generateReport, checkAnomalies } from './automations.js';
import { aiMode } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

initSchema();
seed(); // no-op if already seeded

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', c => b += c); req.on('end', () => resolve(b ? JSON.parse(b) : {})); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // ---------- API ----------
    if (p === '/api/stats') {
      const n = (q) => db.prepare(q).get().n;
      const sums = db.prepare('SELECT COALESCE(SUM(spend),0) s, COALESCE(SUM(revenue),0) r, COALESCE(SUM(conversions),0) c FROM campaigns').get();
      return send(res, 200, {
        aiMode,
        clients: n('SELECT COUNT(*) n FROM clients'),
        contacts: n('SELECT COUNT(*) n FROM contacts'),
        deals: n('SELECT COUNT(*) n FROM deals'),
        campaigns: n('SELECT COUNT(*) n FROM campaigns'),
        spend: sums.s, revenue: sums.r, conversions: sums.c,
        roas: sums.s ? +(sums.r / sums.s).toFixed(2) : 0,
      });
    }
    if (p === '/api/clients' && req.method === 'GET')
      return send(res, 200, db.prepare('SELECT * FROM clients ORDER BY client_id').all());
    if (p === '/api/clients' && req.method === 'POST') {
      const b = await readBody(req);
      const id = db.prepare('INSERT INTO clients (name,brand_color,report_schedule) VALUES (?,?,?)')
        .run(b.name, b.brand_color || '#2E75B6', b.report_schedule || 'monthly').lastInsertRowid;
      return send(res, 201, { client_id: id });
    }
    if (p === '/api/contacts' && req.method === 'GET') {
      const cid = url.searchParams.get('client_id');
      const rows = cid
        ? db.prepare('SELECT * FROM contacts WHERE client_id=? ORDER BY lead_score DESC').all(cid)
        : db.prepare('SELECT * FROM contacts ORDER BY lead_score DESC').all();
      return send(res, 200, rows);
    }
    if (p === '/api/campaigns' && req.method === 'GET') {
      const cid = url.searchParams.get('client_id');
      const rows = cid
        ? db.prepare('SELECT * FROM campaigns WHERE client_id=?').all(cid)
        : db.prepare('SELECT * FROM campaigns').all();
      return send(res, 200, rows);
    }
    // W1: capture a lead (this is your inbound webhook endpoint)
    if (p === '/api/leads' && req.method === 'POST') {
      const result = await captureLead(await readBody(req));
      return send(res, 201, result);
    }
    // W3: trigger a campaign sync
    if (p === '/api/sync' && req.method === 'POST')
      return send(res, 200, syncCampaigns());
    // W4: generate a client report
    if (p.startsWith('/api/reports/') && req.method === 'GET') {
      const id = p.split('/').pop();
      return send(res, 200, await generateReport(id));
    }
    // W5: anomaly alerts
    if (p === '/api/alerts')
      return send(res, 200, checkAnomalies());
    if (p === '/api/activities') {
      const rows = db.prepare('SELECT * FROM activities ORDER BY activity_id DESC LIMIT 25').all();
      return send(res, 200, rows);
    }

    // ---------- static files ----------
    let file = p === '/' ? '/index.html' : p;
    const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (full.startsWith(PUBLIC) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'text/plain' });
      return res.end(fs.readFileSync(full));
    }
    send(res, 404, { error: 'not found', path: p });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Webfluence CRM running → http://localhost:${PORT}`);
  console.log(`  AI mode: ${aiMode}${aiMode === 'heuristic' ? '  (add ANTHROPIC_API_KEY to .env for Claude scoring)' : ''}\n`);
});
