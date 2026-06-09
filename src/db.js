import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'webfluence.db');

export const db = new DatabaseSync(DB_PATH);

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      client_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      brand_color  TEXT DEFAULT '#2E75B6',
      report_schedule TEXT DEFAULT 'monthly',
      status       TEXT DEFAULT 'active',
      health_score INTEGER DEFAULT 80,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contacts (
      contact_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      name             TEXT,
      email            TEXT,
      phone            TEXT,
      source           TEXT DEFAULT 'form',
      message          TEXT,
      lead_score       INTEGER DEFAULT 0,
      score_reason     TEXT,
      lifecycle_stage  TEXT DEFAULT 'nurturing',
      owner            TEXT,
      engagement_score INTEGER DEFAULT 0,
      last_activity_at TEXT DEFAULT (datetime('now')),
      created_at       TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(client_id)
    );
    CREATE TABLE IF NOT EXISTS deals (
      deal_id         INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id      INTEGER,
      client_id       INTEGER NOT NULL,
      title           TEXT NOT NULL,
      stage           TEXT DEFAULT 'qualified',
      value           REAL DEFAULT 0,
      probability     INTEGER DEFAULT 50,
      status          TEXT DEFAULT 'open',
      stage_entered_at TEXT DEFAULT (datetime('now')),
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(client_id)
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      campaign_id  INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id    INTEGER NOT NULL,
      name         TEXT NOT NULL,
      channel      TEXT DEFAULT 'META',
      budget       REAL DEFAULT 0,
      spend        REAL DEFAULT 0,
      impressions  INTEGER DEFAULT 0,
      clicks       INTEGER DEFAULT 0,
      conversions  INTEGER DEFAULT 0,
      revenue      REAL DEFAULT 0,
      cpc          REAL DEFAULT 0,
      cpl          REAL DEFAULT 0,
      cpa          REAL DEFAULT 0,
      roas         REAL DEFAULT 0,
      updated_at   TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(client_id)
    );
    CREATE TABLE IF NOT EXISTS activities (
      activity_id  INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id   INTEGER,
      client_id    INTEGER,
      type         TEXT NOT NULL,
      detail       TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reports (
      report_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id   INTEGER NOT NULL,
      schedule    TEXT DEFAULT 'monthly',
      status      TEXT DEFAULT 'draft',
      summary     TEXT,
      last_sent   TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(client_id)
    );
    CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
  `);
}

export function recomputeCampaignMetrics(row) {
  if (!row) return;
  const cpc  = row.clicks      ? +(row.spend / row.clicks).toFixed(2)      : 0;
  const cpl  = row.conversions ? +(row.spend / row.conversions).toFixed(2) : 0;
  const cpa  = row.conversions ? +(row.spend / row.conversions).toFixed(2) : 0;
  const roas = row.spend       ? +(row.revenue / row.spend).toFixed(2)     : 0;
  db.prepare(
    'UPDATE campaigns SET cpc=?,cpl=?,cpa=?,roas=?,updated_at=datetime(\'now\') WHERE campaign_id=?'
  ).run(cpc, cpl, cpa, roas, row.campaign_id);
}

export function seed() {
  const done = db.prepare("SELECT value FROM _meta WHERE key='seeded'").get();
  if (done) return;

  // 3 demo clients
  const c1 = db.prepare("INSERT INTO clients (name,brand_color,report_schedule,health_score) VALUES (?,?,?,?)")
    .run('Mavenn Realty', '#ff5a1f', 'monthly', 88).lastInsertRowid;
  const c2 = db.prepare("INSERT INTO clients (name,brand_color,report_schedule,health_score) VALUES (?,?,?,?)")
    .run('Nambiyar Builder', '#f97316', 'weekly', 91).lastInsertRowid;
  const c3 = db.prepare("INSERT INTO clients (name,brand_color,report_schedule,health_score) VALUES (?,?,?,?)")
    .run('The Gyn Next Door', '#27c08a', 'monthly', 84).lastInsertRowid;

  // 5 campaigns — one intentionally overspent (Nambiyar Meta) so W5 flags it
  const camps = [
    [c2, 'Flagship Launch · Meta Lead Gen', 'META',   220000, 248000, 3100000, 58000, 1200, 290],
    [c2, 'Project Search · Google',          'GOOGLE', 150000, 131000, 1900000, 42000,  980, 210],
    [c1, 'Site-Visit Drive · Meta',           'META',   140000, 121000, 2200000, 38500,  850, 190],
    [c1, 'Brand+Intent · Google',             'GOOGLE',  90000,  77000, 1100000, 24000,  540, 120],
    [c3, 'Appointments · Google Local',       'GOOGLE',  70000,  63000,  920000, 18000,  390,  85],
  ];
  for (const [cid, name, ch, budget, spend, impr, clicks, conv, rev_k] of camps) {
    const revenue = rev_k * 1000;
    const id = db.prepare(
      'INSERT INTO campaigns (client_id,name,channel,budget,spend,impressions,clicks,conversions,revenue) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(cid, name, ch, budget, spend, impr, clicks, conv, revenue).lastInsertRowid;
    recomputeCampaignMetrics(db.prepare('SELECT * FROM campaigns WHERE campaign_id=?').get(id));
  }

  // seed a couple of contacts + deals
  const cid = db.prepare(
    'INSERT INTO contacts (client_id,name,email,source,message,lead_score,score_reason,lifecycle_stage,owner) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(c1, 'Demo Lead', 'demo@example.com', 'referral', 'budget ready, want a demo', 90, 'referral+high-intent', 'SQL', 'Rohtash').lastInsertRowid;
  db.prepare('INSERT INTO activities (contact_id,client_id,type,detail) VALUES (?,?,?,?)')
    .run(cid, c1, 'seed', 'Demo contact seeded');

  db.prepare("INSERT INTO _meta VALUES ('seeded','1')").run();
  console.log('  DB seeded with 3 clients, 5 campaigns, 1 demo contact.');
}
