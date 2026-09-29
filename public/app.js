// Written in plain ES5 (var, XHR, no template literals/spread) so it runs on older signage web views.
var KEYS = ['week', 'month', 'quarter', 'year'];
var ROTATE_MS = 15000, POLL_MS = 30000;
var m = /[?&]token=([^&]*)/.exec(location.search);
var token = m ? m[1] : '';
var data = null, idx = 0;
function $(id) { return document.getElementById(id); }
function money(n) { return '$' + fmt(Math.round(n)); }
function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
var dots = '';
for (var i = 0; i < KEYS.length; i++) dots += '<i></i>';
$('dots').innerHTML = dots;

var raf = window.requestAnimationFrame || function (f) { return setTimeout(function () { f(new Date().getTime()); }, 33); };
function now() { return window.performance && performance.now ? performance.now() : new Date().getTime(); }

function countUp(el, to, f, ms) {
  f = f || fmt; ms = ms || 1200;
  var from = Number(el.getAttribute('data-v') || 0);
  el.setAttribute('data-v', to);
  var t0 = now();
  (function step() {
    var p = Math.min(1, (now() - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    el.textContent = f(from + (to - from) * e);
    if (p < 1) raf(step);
  })();
}

function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function avatar(r) {
  var ini = r.name.split(' ').map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
  if (!r.photo) return '<div class="av">' + ini + '</div>';
  return '<img class="av" src="' + esc(r.photo) + '" alt="" onerror="this.outerHTML=\'<div class=&quot;av&quot;>' + ini + '</div>\'">';
}

function render() {
  if (!data) return;
  var p = data.periods[KEYS[idx]];
  $('periodLabel').textContent = p.label;
  var d = $('dots').children;
  for (var i = 0; i < d.length; i++) d[i].className = i === idx ? 'on' : '';
  countUp($('qualifiedLeads'), p.qualifiedLeads);
  countUp($('underContract'), p.underContract);
  countUp($('sold'), p.sold);
  if (p.revenue == null) { $('revenue').textContent = '—'; $('revenue').setAttribute('data-v', 0); } else countUp($('revenue'), p.revenue, money);
  var max = 1;
  p.leaderboard.forEach(function (r) { if (r.sold > max) max = r.sold; });
  $('rows').innerHTML = p.leaderboard.length ? p.leaderboard.map(function (r, i) {
    return '<div class="row"><div class="rank">' + (i + 1) + '</div>' + avatar(r) +
      '<div><div class="nm">' + esc(r.name) + '</div><div class="track"><i style="width:' + (r.sold / max) * 100 + '%"></i></div></div>' +
      '<div class="sd">' + r.sold + '</div><div class="rv">' + (r.revenue == null ? '' : money(r.revenue)) + '</div></div>';
  }).join('') : '<div class="empty">No closed deals yet this period — first one gets the trophy 🏆</div>';
  var u = new Date(data.updatedAt);
  $('foot').textContent = 'Updated ' + ((u.getHours() % 12) || 12) + ':' + ('0' + u.getMinutes()).slice(-2) + (u.getHours() < 12 ? ' AM' : ' PM');
}

function restartBar() {
  var b = $('bar');
  b.className = '';
  void b.offsetWidth;
  b.className = 'run';
}

function poll() {                 // silent: updates numbers in place, no reload
  try {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/stats?token=' + encodeURIComponent(token) + '&_=' + new Date().getTime(), true);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || x.status !== 200) return;
      try { data = JSON.parse(x.responseText); render(); } catch (e) { /* keep last good data */ }
    };
    x.send();
  } catch (e) { /* keep showing last good data */ }
}

function rotate() {
  var s = $('stage');
  s.className = 'out';
  setTimeout(function () { idx = (idx + 1) % KEYS.length; render(); s.className = ''; restartBar(); }, 450);
}

poll(); restartBar();
setInterval(poll, POLL_MS);
setInterval(rotate, ROTATE_MS);
setTimeout(function () { location.reload(); }, 6 * 3600 * 1000); // safety refresh every 6h
