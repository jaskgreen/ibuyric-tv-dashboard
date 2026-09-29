require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { getData, getSetupInfo } = require('./resimpli');

const app = express();
const PORT = process.env.PORT || 3000;
const reps = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/reps.json'), 'utf8'));

function ranges() {
  const n = new Date(), y = n.getFullYear();
  const week = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
  const q = Math.floor(n.getMonth() / 3) * 3;
  return {
    week:    { label: 'THIS WEEK',    start: week },
    month:   { label: 'THIS MONTH',   start: new Date(y, n.getMonth(), 1) },
    quarter: { label: 'THIS QUARTER', start: new Date(y, q, 1) },
    year:    { label: 'THIS YEAR',    start: new Date(y, 0, 1) }
  };
}
const inRange = (d, s) => d && new Date(d) >= s;

async function build() {
  const R = ranges();
  const { leads, deals } = await getData();
  const out = { updatedAt: new Date().toISOString(), periods: {} };
  for (const [key, { label, start }] of Object.entries(R)) {
    const sold = deals.filter(d => inRange(d.soldDate, start));
    const byRep = {};
    const UNCLAIMED = 'Team UnClaimed';                       // deals with no rep tag: flags work left to do in REsimpli
    sold.forEach(d => (d.reps && d.reps.length ? d.reps : [UNCLAIMED]).forEach(name => {   // every tagged rep gets full credit
      byRep[name] = byRep[name] || { name, sold: 0, revenue: 0 };
      byRep[name].sold++; byRep[name].revenue += d.revenue || 0;
    }));
    const hasRevenue = sold.some(d => d.revenue !== null);
    out.periods[key] = {
      label,
      qualifiedLeads: leads.filter(l => inRange(l.qualifiedDate, start)).length,
      underContract: deals.filter(d => inRange(d.contractDate, start)).length,
      sold: sold.length,
      revenue: hasRevenue || !sold.length ? sold.reduce((s, d) => s + (d.revenue || 0), 0) : null,
      leaderboard: Object.values(byRep)
        .sort((a, b) => b.sold - a.sold || b.revenue - a.revenue).slice(0, 6)
        .map(r => ({ ...r, revenue: hasRevenue ? r.revenue : null, photo: reps[r.name] || null }))
    };
  }
  return out;
}

// Refresh in the background so the TV always gets an instant answer (a full CRM pull takes ~40s).
let cache = { body: null };
async function refresh() {
  try { cache.body = await build(); console.log('refreshed', cache.body.updatedAt); }
  catch (e) { console.error('refresh failed:', e.message); }     // keep serving the last good data
}
refresh();
setInterval(refresh, Number(process.env.REFRESH_MS) || 30 * 60 * 1000);

const auth = (req, res, next) => {
  const t = process.env.DASH_TOKEN;
  if (t && req.query.token !== t) return res.status(401).json({ error: 'unauthorized' });
  next();
};
app.get('/api/stats', auth, (req, res) => {
  if (!cache.body) return res.status(503).json({ error: 'warming_up' });
  res.set('Cache-Control', 'no-store').json(cache.body);
});
app.get('/api/setup', auth, (req, res) => res.json(getSetupInfo()));
// Page is rendered on the server (all four periods, rotated by CSS) so it works on signage players that block scripts.
const { page } = require('./render');
// Signage players may reload the page mid-cycle (e.g. every 30s), which would restart on "This Week" every time.
// Remember when each screen last loaded and start the new load where its animation would have been.
const screens = new Map();
function startSlot(req) {
  const key = (req.headers['x-forwarded-for'] || req.ip || '') + '|' + (req.headers['user-agent'] || '');
  const now = Date.now(), last = screens.get(key);
  const pos = last ? ((last.pos + (now - last.t) / 1000) % 60) : 0;
  const slot = Math.round(pos / 15) % 4;
  screens.set(key, { pos: slot * 15, t: now });
  if (screens.size > 200) screens.delete(screens.keys().next().value);
  return slot;
}
app.get(['/', '/index.html'], (req, res) => {
  const t = process.env.DASH_TOKEN, ok = cache.body && (!t || req.query.token === t);
  const period = req.query.period || req.query['amp;period'];      // tolerate "&amp;" mangling by signage software
  res.set('Cache-Control', 'no-store').type('html').send(page(ok ? cache.body : null, period, startSlot(req)));
});
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log('I Buy RIC TV dashboard on :' + PORT));
