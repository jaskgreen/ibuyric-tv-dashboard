const KEYS = ['week', 'month', 'quarter', 'year'];
const ROTATE_MS = 15000, POLL_MS = 30000;
const token = new URLSearchParams(location.search).get('token') || '';
let data = null, idx = 0;
const $ = id => document.getElementById(id);
const money = n => '$' + Math.round(n).toLocaleString('en-US');
$('dots').innerHTML = KEYS.map(() => '<i></i>').join('');

function countUp(el, to, fmt = v => Math.round(v).toLocaleString('en-US'), ms = 1200) {
  const from = Number(el.dataset.v || 0); el.dataset.v = to;
  const t0 = performance.now();
  (function step(t) {
    const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function avatar(r) {
  const ini = r.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  if (!r.photo) return `<div class="av">${ini}</div>`;
  return `<img class="av" src="${esc(r.photo)}" alt="" onerror="this.outerHTML='<div class=\\'av\\'>${ini}</div>'">`;
}

function render() {
  if (!data) return;
  const p = data.periods[KEYS[idx]];
  $('periodLabel').textContent = p.label;
  [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i === idx));
  countUp($('qualifiedLeads'), p.qualifiedLeads);
  countUp($('underContract'), p.underContract);
  countUp($('sold'), p.sold);
  if (p.revenue == null) { $('revenue').textContent = '—'; $('revenue').dataset.v = 0; } else countUp($('revenue'), p.revenue, money);
  const max = Math.max(1, ...p.leaderboard.map(r => r.sold));
  $('rows').innerHTML = p.leaderboard.length ? p.leaderboard.map((r, i) => `
    <div class="row"><div class="rank">${i + 1}</div>${avatar(r)}
      <div><div class="nm">${esc(r.name)}</div><div class="track"><i style="width:${(r.sold / max) * 100}%"></i></div></div>
      <div class="sd">${r.sold}</div><div class="rv">${r.revenue == null ? '' : money(r.revenue)}</div></div>`).join('')
    : '<div class="empty">No closed deals yet this period — first one gets the trophy 🏆</div>';
  $('foot').textContent = 'Updated ' + new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function restartBar() { const b = $('bar'); b.classList.remove('run'); void b.offsetWidth; b.classList.add('run'); }

async function poll() {           // silent: updates numbers in place, no reload
  try {
    const r = await fetch('/api/stats?token=' + encodeURIComponent(token), { cache: 'no-store' });
    if (r.ok) { data = await r.json(); render(); }
  } catch (e) { /* keep showing last good data */ }
}

function rotate() {
  const m = $('stage'); m.classList.add('out');
  setTimeout(() => { idx = (idx + 1) % KEYS.length; render(); m.classList.remove('out'); restartBar(); }, 450);
}

poll().then(restartBar);
setInterval(poll, POLL_MS);
setInterval(rotate, ROTATE_MS);
setTimeout(() => location.reload(), 6 * 3600 * 1000); // safety refresh every 6h to clear any browser memory creep
