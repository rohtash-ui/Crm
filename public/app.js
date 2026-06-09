const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const num = n => Math.round(n || 0).toLocaleString('en-IN');
const ago = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }); };

async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}

// ── stat cards ──────────────────────────────────────────────
async function loadStats() {
  const s = await api('/api/stats');
  document.getElementById('aimode').textContent = 'AI: ' + s.aiMode;
  document.getElementById('aidot').className = 'dot' + (s.aiMode === 'claude' ? ' on' : '');
  document.getElementById('stats').innerHTML = [
    ['Clients',     s.clients,                  'active'],
    ['Contacts',    s.contacts,                 'all time'],
    ['Deals',       s.deals,                    'pipeline'],
    ['Campaigns',   s.campaigns,                'active'],
    ['Spend',       inr(s.spend),               'total'],
    ['Revenue',     inr(s.revenue),             'attributed'],
    ['ROAS',        (s.roas || 0).toFixed(2) + '×', 'blended'],
  ].map(([l, v, sub]) => `<div class="card stat"><div class="lab">${l}</div><div class="val">${v}</div><div class="sub">${sub}</div></div>`).join('');
}

// ── pipeline table ───────────────────────────────────────────
async function loadPipeline() {
  const rows = await api('/api/contacts');
  const stageTag = s => ({ SQL: 'green', MQL: 'orange', nurturing: 'amber' }[s] || '');
  document.getElementById('pipeline').innerHTML = rows.length ? rows.map(r =>
    `<tr>
      <td class="b">${r.name || '—'}</td>
      <td class="mut">${r.email || '—'}</td>
      <td class="mut">${r.source || ''}</td>
      <td><span class="tag ${stageTag(r.lifecycle_stage)}">${r.lifecycle_stage}</span></td>
      <td class="b">${r.lead_score}</td>
      <td class="mut">${r.owner || ''}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="mut" style="padding:16px">No leads yet — capture one below.</td></tr>';
}

// ── campaign table ───────────────────────────────────────────
async function loadCampaigns() {
  const rows = await api('/api/campaigns');
  document.getElementById('campaigns').innerHTML = rows.length ? rows.map(r =>
    `<tr>
      <td class="b">${r.name}</td>
      <td class="mut">${r.channel}</td>
      <td class="${r.spend > r.budget ? 'bad' : ''}">${inr(r.spend)}</td>
      <td class="mut">${inr(r.budget)}</td>
      <td>${num(r.conversions)}</td>
      <td>${inr(r.cpl)}</td>
      <td class="${r.roas >= 1.5 ? 'good' : 'bad'}">${(r.roas || 0).toFixed(2)}×</td>
    </tr>`).join('') : '<tr><td colspan="7" class="mut" style="padding:16px">No campaigns yet.</td></tr>';
}

// ── activity feed ────────────────────────────────────────────
async function loadFeed() {
  const rows = await api('/api/activities');
  document.getElementById('feed').innerHTML = rows.map(r =>
    `<div class="ev"><div class="d"></div><div><div>${r.detail || r.type}</div><div class="t">${r.type} · ${ago(r.created_at)}</div></div></div>`
  ).join('') || '<p class="mut" style="font-size:12px">No activity yet.</p>';
}

// ── alerts ───────────────────────────────────────────────────
async function loadAlerts() {
  const rows = await api('/api/alerts');
  document.getElementById('alerts').innerHTML = rows.length
    ? rows.map(a => `<div class="alert"><span class="dot" style="background:${a.level === 'high' ? 'var(--danger)' : 'var(--warning)'}"></span><span><b>${a.type.replace(/_/g, ' ')}</b> — ${a.msg}</span></div>`).join('')
    : '<p class="mut" style="font-size:12px">✓ All clear.</p>';
}

// ── lead capture form ────────────────────────────────────────
document.getElementById('lead-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  const btn = e.target.querySelector('.submit');
  btn.textContent = 'Scoring…'; btn.disabled = true;
  try {
    const result = await api('/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const scoreEl = document.getElementById('score-out');
    const cls = result.score >= 75 ? 'good' : result.score >= 50 ? 'warn' : 'mut';
    scoreEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="mut">Lead score</span>
        <span class="big ${cls}">${result.score}/100 · ${result.stage}</span>
      </div>
      <p class="mut" style="margin-top:4px;font-size:12px">${result.reason}</p>
      <p style="margin-top:4px;font-size:12px">Routed to <b>${result.owner}</b> · nurture queued · AI: ${result.ai}</p>`;
    scoreEl.style.display = 'block';
    e.target.reset();
    refresh();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.textContent = 'Capture & score lead (W1)'; btn.disabled = false;
  }
});

// ── action buttons ───────────────────────────────────────────
document.getElementById('btn-sync').addEventListener('click', async () => {
  document.getElementById('btn-sync').textContent = 'Syncing…';
  await api('/api/sync', { method: 'POST' });
  document.getElementById('btn-sync').textContent = '⟳ Sync campaigns (W3)';
  refresh();
});
document.getElementById('btn-report').addEventListener('click', async () => {
  const id = prompt('Client ID (1, 2, or 3):') || '1';
  const r = await api('/api/reports/' + id);
  alert(`${r.client}\nSpend: ${inr(r.kpis.spend)} | Revenue: ${inr(r.kpis.revenue)} | ROAS: ${r.kpis.roas}x\n\n${r.summary}`);
  loadFeed();
});
document.getElementById('btn-alerts').addEventListener('click', loadAlerts);

function refresh() { loadStats(); loadPipeline(); loadCampaigns(); loadFeed(); loadAlerts(); }
refresh();
