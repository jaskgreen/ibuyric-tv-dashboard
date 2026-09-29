// REsimpli adapter (Open API v6).
// Two calls are combined:
//   POST /lead/list     -> cheap, paginated, gives every lead's current status + who it's assigned to
//   POST /lead/details  -> expensive (one call per lead), gives the real qualified date, under-contract
//                          date, assignment fee (revenue) and closing date. Only called for leads that
//                          could plausibly matter for "This Year" (DETAIL_LOOKBACK_DAYS), to respect the
//                          100 req/min rate limit on a CRM with thousands of leads.
const fs = require('fs');
const path = require('path');

const BASE = process.env.RESIMPLI_BASE_URL || 'https://api.resimpli.com/api/v6/openapi';
const KEY = process.env.RESIMPLI_API_KEY;
const HEADER = process.env.RESIMPLI_AUTH_HEADER || 'Authorization';
const REP_ROLE = process.env.REP_ROLE_ID || '';                 // which assignUser role key = "sales rep"
const SOLD_STATUS_IDS = (process.env.SOLD_STATUS_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const SKIP_STATUS_TITLES = (process.env.SKIP_STATUS_TITLES || 'New Leads,New,discovery,Dead Lead')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const DETAIL_LOOKBACK_DAYS = Number(process.env.DETAIL_LOOKBACK_DAYS || 400);   // covers "This Year" + buffer
const MAX_DETAIL_CALLS = Number(process.env.MAX_DETAIL_CALLS || 3000);         // safety cap per refresh

let USERS = {};
try { USERS = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8')); } catch (e) {}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let setupInfo = { note: 'not loaded yet' };

async function post(p, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(BASE + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [HEADER]: KEY },
      body: JSON.stringify(body)
    });
    if (res.status === 429) { await sleep(15000 * (i + 1)); continue; }  // back off and retry on rate limit
    if (!res.ok) throw new Error(`REsimpli ${res.status} on ${p}`);
    return res.json();
  }
  throw new Error('REsimpli rate limit kept blocking us on ' + p);
}

async function fetchAllLeads() {
  const out = [];
  for (let page = 1; page <= 500; page++) {
    const j = await post('/lead/list', { page, limit: 100 });
    const items = (j.data && j.data.items) || [];
    out.push(...items);
    const total = (j.data && j.data.count) || 0;
    if (items.length < 100 || out.length >= total) break;
    await sleep(700);                                                    // ~85 calls/min, under the 100/min cap
  }
  return out;
}

async function fetchDetails(id) {
  const j = await post('/lead/details', { leadId: id });
  return j.data && j.data.leadData;
}

// Reps are credited only when their "spoke with the seller" tag is on the lead.
// REP_TAGS = "tag label=Rep Name,..." (case-insensitive). UNTAGGED_FALLBACK=role credits the assigned role instead.
const REP_TAGS = {};
(process.env.REP_TAGS || 'spoke-david=David Hughes,spoke-derrious=Derrious Clayton,spoke-ryan=Ryan Rice')
  .split(',').forEach(p => { const [t, n] = p.split('='); if (t && n) REP_TAGS[t.trim().toLowerCase()] = n.trim(); });
const FALLBACK_ROLE = process.env.UNTAGGED_FALLBACK === 'role';
const repsOf = d => {
  const names = [];
  (d.tags || []).forEach(t => {
    const n = REP_TAGS[String((t && t.label) || t).trim().toLowerCase()];
    if (n && !names.includes(n)) names.push(n);
  });
  if (!names.length && FALLBACK_ROLE) names.push(repOf(d));
  return names;
};
const repOf = obj => {
  const id = REP_ROLE && obj.assignUser && obj.assignUser[REP_ROLE] && obj.assignUser[REP_ROLE][0];
  return id ? (USERS[id] || 'Rep ' + String(id).slice(-4)) : 'Team';
};
const iso = ms => (ms ? new Date(ms).toISOString() : null);

async function getData() {
  if (process.env.DEMO_MODE === 'true' || !KEY) return demo();
  const rows = await fetchAllLeads();

  // Diagnostics for /api/setup: every status title seen, and every role/user id combo — use this to
  // fill in REP_ROLE_ID and SOLD_STATUS_IDS with real values instead of the placeholders below.
  const statusCounts = {}, roles = {};
  rows.forEach(l => {
    statusCounts[l.mainStatusTitle] = (statusCounts[l.mainStatusTitle] || 0) + 1;
    Object.entries(l.assignUser || {}).forEach(([role, users]) => {
      roles[role] = roles[role] || {};
      (users || []).forEach(u => { roles[role][u] = (roles[role][u] || 0) + 1; });
    });
  });

  const cutoff = Date.now() - DETAIL_LOOKBACK_DAYS * 864e5;
  const candidates = rows.filter(l => {
    const t = String(l.mainStatusTitle || '').toLowerCase();
    if (SKIP_STATUS_TITLES.includes(t)) return false;               // skip brand-new / dead, never qualified
    return (l.updatedAt || 0) >= cutoff;                            // skip anything untouched in a long time
  }).slice(0, MAX_DETAIL_CALLS);

  const leads = [], deals = [];
  let detailCalls = 0;
  for (const l of candidates) {
    let d;
    try { d = await fetchDetails(l._id); detailCalls++; }
    catch (e) { continue; }                                          // one bad lead shouldn't kill the refresh
    if (!d) continue;

    if (d.isQualified) leads.push({ qualifiedDate: iso(d.qualifiedAt) });

    const a = d.analyticsInfo || {};
    if (a.underContractDate) {
      // "Sold" detection: prefer an exact status-id match (set SOLD_STATUS_IDS once you confirm it from
      // a real closed deal); until then, fall back to "closing date has passed" as a reasonable guess.
      const sold = SOLD_STATUS_IDS.length
        ? SOLD_STATUS_IDS.includes(d.transactionMainStatusId) || SOLD_STATUS_IDS.includes(d.mainStatusId)
        : !!(a.closingDate && a.closingDate <= Date.now());
      deals.push({
        reps: repsOf(d),
        contractDate: iso(a.underContractDate),
        soldDate: sold ? iso(a.closingDate) : null,
        revenue: sold ? Number(a.assignmentFee) || 0 : 0
      });
    }
    await sleep(700);                                                   // ~85 calls/min, under the 100/min cap
  }
  setupInfo = { totalLeads: rows.length, detailCallsThisRefresh: detailCalls, statusCounts, rolesAndUsers: roles };
  return { leads, deals };
}

function demo() {
  const reps = ['Marcus Webb', 'Tasha Green', 'Devon Carter', 'Alicia Ruiz', 'Jordan Bell'];
  const now = Date.now(), day = 864e5, leads = [], deals = [];
  for (let i = 0; i < 420; i++) leads.push({ qualifiedDate: new Date(now - Math.random() * 300 * day).toISOString() });
  for (let i = 0; i < 90; i++) {
    const c = now - Math.random() * 300 * day, sold = Math.random() > 0.35;
    deals.push({
      reps: [reps[Math.floor(Math.random() * reps.length)]],
      contractDate: new Date(c).toISOString(),
      soldDate: sold ? new Date(c + 20 * day).toISOString() : null,
      revenue: sold ? 8000 + Math.round(Math.random() * 22000) : 0
    });
  }
  return { leads, deals };
}

module.exports = { getData, getSetupInfo: () => setupInfo };
