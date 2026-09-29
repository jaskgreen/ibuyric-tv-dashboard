// Server-side page renderer. All four periods are drawn into the HTML and rotated with pure CSS
// animation (no JavaScript needed), because signage web views often stop page timers/scripts.
const KEYS = ['week', 'month', 'quarter', 'year'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const money = n => '$' + num(n);

function panel(p, i, solo, start) {
  const d = (15 * start - 15 * i + 60) % 60;                       // where this panel is in its 60s animation at page load
  const dl = solo ? '' : ` style="-webkit-animation-delay:-${d}s;animation-delay:-${d}s"`;
  const bl = solo ? '' : ` style="-webkit-animation-delay:-${d}s;animation-delay:-${d}s"`;
  const max = Math.max(1, ...p.leaderboard.map(r => r.sold));
  const dots = KEYS.map((_, j) => `<i${j === i ? ' class="on"' : ''}></i>`).join('');
  const rows = p.leaderboard.length ? p.leaderboard.map((r, k) => {
    const ini = r.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="row"><div class="rank">${k + 1}</div><div class="av">${esc(ini)}</div>
      <div><div class="nm">${esc(r.name)}</div><div class="track"><i style="width:${(r.sold / max) * 100}%"></i></div></div>
      <div class="sd">${r.sold}</div><div class="rv">${r.revenue == null ? '' : money(r.revenue)}</div></div>`;
  }).join('') : '<div class="empty">No credited deals this period</div>';
  return `<section class="panel p${i}${solo ? ' solo' : ''}"${dl}>
  <header>
    <div class="brand"><span class="mark">▲</span><span class="name">I BUY <b>RIC</b></span><span class="tag">SALES LEADERBOARD</span></div>
    <div class="period"><div class="pl">${esc(p.label)}</div><div class="dots">${dots}</div></div>
  </header>
  <div class="bar"><i${bl}></i></div>
  <main>
    <div class="kpis">
      <div class="card"><div class="k">QUALIFIED LEADS</div><div class="v">${num(p.qualifiedLeads)}</div></div>
      <div class="card"><div class="k">UNDER CONTRACT</div><div class="v">${num(p.underContract)}</div></div>
      <div class="card"><div class="k">DEALS SOLD</div><div class="v">${num(p.sold)}</div></div>
      <div class="card hero"><div class="k">REVENUE</div><div class="v">${p.revenue == null ? '—' : money(p.revenue)}</div></div>
    </div>
    <div class="board"><div class="bt">LEADERBOARD <span>RANKED BY DEALS SOLD</span></div>${rows}</div>
  </main>
  <footer>Updated ${esc(p.updated)}</footer>
</section>`;
}

function page(body, period, start) {
  start = start || 0;
  const head = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${body ? 300 : 15}">
<title>I BUY RIC — Sales Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css"></head><body class="tv"><div class="glow g1"></div><div class="glow g2"></div>`;
  if (!body) return head + '<section class="panel solo"><header><div class="brand"><span class="mark">▲</span><span class="name">I BUY <b>RIC</b></span></div></header><main><div class="empty">Loading live data…</div></main></section></body></html>';
  const upd = new Date(body.updatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const solo = KEYS.indexOf(period);
  const list = solo >= 0 ? [solo] : [0, 1, 2, 3];
  return head + list.map(i => panel({ ...body.periods[KEYS[i]], updated: upd }, i, solo >= 0, start)).join('') + '</body></html>';
}

module.exports = { page };
