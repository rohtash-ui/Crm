// Headless pipeline demo: runs W1→W5 and prints results.
// node --experimental-sqlite src/demo.js
import { initSchema, seed } from './db.js';
import { captureLead, syncCampaigns, generateReport, checkAnomalies } from './automations.js';
import { aiMode } from './ai.js';

initSchema();
seed();

console.log(`\n=== Webfluence CRM demo (AI mode: ${aiMode}) ===\n`);

// W1 – high-intent referral lead (should score ~90-100, stage SQL)
console.log('--- W1: captureLead ---');
const lead = await captureLead({
  client_id: 1,
  name: 'Ravi Sharma',
  email: 'ravi@towercorp.com',
  phone: '+91 98765 43210',
  source: 'referral',
  message: 'budget ready, want a demo ASAP',
});
console.log(lead);
console.assert(lead.score >= 75, `Expected score>=75, got ${lead.score}`);
console.assert(lead.stage === 'SQL', `Expected stage=SQL, got ${lead.stage}`);

// W3 – campaign sync
console.log('\n--- W3: syncCampaigns ---');
const sync = syncCampaigns();
console.log(sync);

// W4 – generate report for client 1
console.log('\n--- W4: generateReport(1) ---');
const report = await generateReport(1);
console.log({ client: report.client, kpis: report.kpis });
console.log('summary:', report.summary.slice(0, 120) + '…');

// W5 – anomaly alerts
console.log('\n--- W5: checkAnomalies ---');
const alerts = checkAnomalies();
console.log(alerts);
console.assert(alerts.some(a => a.type === 'overspend'), 'Expected at least one overspend alert');

console.log('\n✓ All checks passed.\n');
