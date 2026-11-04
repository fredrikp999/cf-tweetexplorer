// The Research map on the public site (/research/map): the papers of the last 30 days grouped by subject, with sliders for the dates, the level of detail and the smallest group shown.
// A plain page like first.ts: classic inline script, the ui/* postMessage protocol directly, no SDK and no bundler. Keep it free of backticks and template placeholders.
// Everything recalculates in the browser from one read of Monitor.mapView, so the controls answer at once:
//   { state: 'ready', built, from, days, lagDays, topics: [{ id, slug, title }], leaves: [{ name, summary, terms }], joins: [[a, b]],
//     papers: [[id, title, day, topicMask, leaf, top, score, hfUpvotes, hnPoints, accounts]] }, or { state: 'building', progress: { read, total, toEmbed }, error }.
export default `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark;--bg:#07090f;--fg:#eef0f5;--mut:#9aa1b2;--line:#262b38;--card:#11141d;--ac:#8fb8f2;--up:#7fd1a8;--down:#e6a57e}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
a{color:var(--fg)}a:hover{color:var(--ac)}button,select,input{font:inherit;color:var(--fg)}.hide{display:none!important}
#app{padding:14px}#s{color:var(--mut);padding:24px 4px}#s b{color:var(--fg)}
button{background:transparent;border:1px solid var(--line);border-radius:7px;padding:3px 10px;cursor:pointer}button:hover{border-color:var(--mut)}button.on{background:#1b2130;border-color:var(--ac);color:var(--ac)}
button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--ac);outline-offset:1px}
.lab{color:var(--mut);font-size:12px}.val{font-variant-numeric:tabular-nums}
#time{border:1px solid var(--line);border-radius:10px;padding:10px 12px 8px;background:var(--card)}
#timehead{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;justify-content:space-between;margin-bottom:6px}#dates{font-weight:600;font-variant-numeric:tabular-nums}.btns{display:flex;gap:5px;flex-wrap:wrap}.btns button{font-size:12px;padding:2px 8px}
#hist{display:flex;align-items:flex-end;gap:1px;height:56px}#hist i{flex:1 1 0;min-width:1px;background:#3a4256;border-radius:1px 1px 0 0}#hist i.in{background:var(--ac)}#hist i.late.in{background:#55708f}
#range{position:relative;height:22px;margin-top:2px}#range input{position:absolute;inset:0;width:100%;margin:0;background:none;pointer-events:none;-webkit-appearance:none;appearance:none;height:22px}
#range input::-webkit-slider-thumb{-webkit-appearance:none;pointer-events:auto;width:14px;height:20px;border-radius:4px;background:var(--fg);border:2px solid var(--bg);cursor:ew-resize}
#range input::-moz-range-thumb{pointer-events:auto;width:12px;height:18px;border-radius:4px;background:var(--fg);border:2px solid var(--bg);cursor:ew-resize}
#late{color:var(--mut);font-size:12px}
#ctl{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px 18px;margin:12px 0}
#ctl label{display:block}#ctl .row{display:flex;justify-content:space-between;gap:8px}#ctl input[type=range]{width:100%;accent-color:var(--ac);margin:4px 0 0}
#ctl input[type=search],#ctl select{width:100%;margin-top:3px;background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:4px 8px}
#filters{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}#filters small{color:var(--mut);margin-left:3px;font-variant-numeric:tabular-nums}
#sum{margin:12px 0 8px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 12px;align-items:baseline}#sum b{font-size:15px}#hidden{color:var(--mut);font-size:12px}
.c{border-top:1px solid var(--line)}.chead{display:grid;grid-template-columns:minmax(0,1fr) 92px 56px;gap:4px 12px;align-items:center;width:100%;padding:10px 4px;background:none;border:0;border-radius:6px;text-align:left}
.chead:hover{background:var(--card)}.chead h3{margin:0;font-size:14.5px;font-weight:600}.chead p{margin:2px 0 0;color:var(--mut);font-size:13px}
.nums{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.nums small{display:block;font-weight:400;color:var(--mut);font-size:11.5px}.up{color:var(--up)!important}.down{color:var(--down)!important}
.bar{height:5px;background:var(--line);border-radius:3px;margin-top:6px;overflow:hidden}.bar i{display:block;height:100%;background:var(--ac)}
svg{display:block;width:92px;height:30px}
.cbody{padding:2px 4px 12px}.terms{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 8px}.terms span{border:1px solid var(--line);border-radius:99px;padding:0 7px;font-size:12px;color:var(--mut)}
.subs{margin:0 0 8px;font-size:13px;color:var(--mut)}.subs b{color:var(--fg);font-weight:500}
.p{padding:7px 0;border-top:1px solid #1a1e29}.p .t{font-weight:500}.p .m{color:var(--mut);font-size:12px;display:flex;flex-wrap:wrap;gap:2px 10px;align-items:center;margin-top:1px}.badge{color:var(--ac)}
.link{background:none;border:0;padding:0;color:var(--mut);text-decoration:underline;font-size:12px;border-radius:2px}.link:hover{color:var(--fg)}
.abs{margin:6px 0 2px;font-size:13px;color:#cdd2de}.abs .au{color:var(--mut);font-size:12px;margin-bottom:4px}
.more{margin-top:8px;font-size:12.5px}#none{color:var(--mut);padding:18px 4px}
@media (max-width:520px){.chead{grid-template-columns:minmax(0,1fr) 60px}.chead svg{display:none}}
</style></head><body><div id="app"><div id="s">Reading the map…</div><div id="main" class="hide">
<section id="time" aria-label="Dates"><div id="timehead"><span id="dates"></span><span class="btns" id="presets"></span></div><div id="hist" aria-hidden="true"></div>
<div id="range"><input id="from" type="range" aria-label="From date"><input id="to" type="range" aria-label="To date"></div><div id="late"></div></section>
<section id="ctl"><label><span class="row"><span class="lab">Detail</span><span class="val" id="detailV"></span></span><input id="detail" type="range" aria-label="Number of clusters"></label>
<label><span class="row"><span class="lab">Smallest cluster shown</span><span class="val" id="minV"></span></span><input id="min" type="range" min="1" max="60" value="1" aria-label="Smallest cluster shown"></label>
<label><span class="lab">Sort</span><select id="sort"><option value="n">Most papers</option><option value="trend">Growing fastest</option><option value="att">Most attention</option></select></label>
<label><span class="lab">Search titles and cluster names</span><input id="q" type="search" placeholder="such as memory" maxlength="80"></label></section>
<div id="filters"></div><div id="sum"><b id="total"></b><span id="hidden"></span></div><div id="list"></div><div id="none" class="hide">No papers match. Widen the dates or clear a filter.</div>
</div></div>
<script>
var d, seq = 10, pending = {}, S = { from: 0, to: 0, detail: 16, min: 1, sort: 'n', q: '', off: 0, att: false, open: {}, shown: {}, abs: {} };
var PID = 0, PTITLE = 1, PDAY = 2, PMASK = 3, PLEAF = 4, PTOP = 5, PSCORE = 6, PHF = 7, PHN = 8, PACC = 9;
function el(id) { return document.getElementById(id); }
function send(m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(n) { return Number(n).toLocaleString('en-US'); }
function dayText(i) { return new Date(Date.parse(d.from) + i * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function size() { send({ method: 'ui/notifications/size-changed', params: { width: Math.ceil(window.innerWidth), height: Math.ceil(el('app').getBoundingClientRect().height) + 2 } }); }
function open_(url) { send({ id: ++seq, method: 'ui/open-link', params: { url: url } }); }

function setup() {
  var last = d.days, k = d.leaves.length;
  S.to = last; S.from = 0;
  S.detail = Math.min(k, 16);
  ['from', 'to'].forEach(function (x) { var i = el(x); i.min = 0; i.max = last; i.step = 1; });
  el('from').value = 0; el('to').value = last;
  var dt = el('detail'); dt.min = Math.min(k, 4); dt.max = k; dt.value = S.detail;
  el('presets').innerHTML = [[7, 'Last 7 days'], [14, '14 days'], [30, '30 days']].map(function (p) { return '<button data-days="' + p[0] + '">' + p[1] + '</button>'; }).join('');
  el('filters').innerHTML = d.topics.map(function (t, i) { return '<button data-topic="' + i + '" class="on" aria-pressed="true">' + esc(t.title) + '<small id="tn' + i + '"></small></button>'; }).join('') + '<button id="att" aria-pressed="false">Getting attention only<small id="attn"></small></button><button id="reset" class="link" style="margin-left:6px">Reset</button>';
  var counts = new Array(last + 1).fill(0);
  d.papers.forEach(function (p) { if (p[PDAY] <= last) counts[p[PDAY]]++; });
  d.counts = counts;
  var top = Math.max.apply(null, counts) || 1;
  el('hist').innerHTML = counts.map(function (c, i) { return '<i data-d="' + i + '" style="height:' + Math.max(2, Math.round(c / top * 100)) + '%"' + (i > last - d.lagDays ? ' class="late"' : '') + '></i>'; }).join('');
  el('s').classList.add('hide'); el('main').classList.remove('hide');
  draw();
}
function leafRoots() {
  var k = d.leaves.length, up = {}, root = function (x) { while (up[x] !== undefined) x = up[x]; return x; };
  d.joins.slice(0, Math.max(0, k - S.detail)).forEach(function (j, i) { up[j[0]] = k + i; up[j[1]] = k + i; });
  var out = []; for (var g = 0; g < k; g++) out.push(root(g));
  return out;
}
function nameOf(g) {
  var top = g.subs[0];
  if (g.subs.length === 1) return d.leaves[top.leaf].name;
  return d.leaves[top.leaf].name + ' & ' + d.leaves[g.subs[1].leaf].name + (g.subs.length > 2 ? ' +' + (g.subs.length - 2) : '');
}
function draw() {
  var k = d.leaves.length, roots = leafRoots(), q = S.q.trim().toLowerCase(), mid = S.from + (S.to - S.from + 1) / 2, wide = S.to - S.from + 1 >= 14;
  var byRoot = {}, shown = 0, early = 0, later = 0, tCount = d.topics.map(function () { return 0; }), attCount = 0, leafHits = {};
  if (q) d.leaves.forEach(function (l, i) { if (l.name.toLowerCase().indexOf(q) >= 0 || (l.summary || '').toLowerCase().indexOf(q) >= 0) leafHits[i] = 1; });
  for (var i = 0; i < d.papers.length; i++) {
    var p = d.papers[i];
    if (p[PDAY] < S.from || p[PDAY] > S.to) continue;
    if (q && !leafHits[p[PLEAF]] && p[PTITLE].toLowerCase().indexOf(q) < 0) continue;
    var on = (p[PMASK] & ~S.off) !== 0;
    if (on || !S.att) d.topics.forEach(function (t, b) { if ((p[PMASK] & (1 << b)) && (!S.att || p[PTOP])) tCount[b]++; });
    if (on && p[PTOP]) attCount++;
    if (!on || (S.att && !p[PTOP])) continue;
    shown++;
    var late = p[PDAY] >= mid;
    if (late) later++; else early++;
    var r = roots[p[PLEAF]], g = byRoot[r] || (byRoot[r] = { root: r, papers: [], leaves: {}, early: 0, later: 0, att: 0, days: {} });
    g.papers.push(p); g.leaves[p[PLEAF]] = (g.leaves[p[PLEAF]] || 0) + 1;
    if (late) g.later++; else g.early++;
    if (p[PTOP]) g.att++;
    g.days[p[PDAY]] = (g.days[p[PDAY]] || 0) + 1;
  }
  var all = Object.keys(byRoot).map(function (x) { return byRoot[x]; });
  all.forEach(function (g) {
    g.subs = Object.keys(g.leaves).map(function (l) { return { leaf: +l, n: g.leaves[l] }; }).sort(function (a, b) { return b.n - a.n || a.leaf - b.leaf; });
    g.trend = wide && g.papers.length >= 20 && g.early >= 5 && early && later ? (g.later / later) / (g.early / early) : null;
  });
  var largest = all.reduce(function (n, g) { return Math.max(n, g.papers.length); }, 1), mn = el('min');
  mn.max = Math.max(2, largest);   // the slider spans the clusters on show, so it does something at every level of detail
  if (S.min > largest) { S.min = Math.max(1, largest); }
  mn.value = S.min;
  var list = all.filter(function (g) { return g.papers.length >= S.min; }), gone = all.length - list.length, goneN = all.reduce(function (n, g) { return n + (g.papers.length < S.min ? g.papers.length : 0); }, 0);
  list.sort(S.sort === 'trend' ? function (a, b) { return (b.trend === null ? -1 : b.trend) - (a.trend === null ? -1 : a.trend) || b.papers.length - a.papers.length; } : S.sort === 'att' ? function (a, b) { return b.att - a.att || b.papers.length - a.papers.length; } : function (a, b) { return b.papers.length - a.papers.length || a.root - b.root; });
  var biggest = list.reduce(function (n, g) { return Math.max(n, g.papers.length); }, 1);

  el('dates').textContent = dayText(S.from) + ' to ' + dayText(S.to);
  Array.prototype.forEach.call(el('hist').children, function (b, x) { b.classList.toggle('in', x >= S.from && x <= S.to); });
  el('late').textContent = S.to > d.days - d.lagDays ? 'The newest two days (darker) are not fully listed yet, so they look smaller than they are.' : '';
  Array.prototype.forEach.call(el('presets').children, function (b) { var n = +b.dataset.days, w = Math.min(n, d.days + 1); b.classList.toggle('on', S.to === d.days && S.to - S.from + 1 === w); });
  el('detailV').textContent = S.detail + ' clusters'; el('minV').textContent = S.min === 1 ? 'All' : S.min + ' papers';
  d.topics.forEach(function (t, b) { el('tn' + b).textContent = fmt(tCount[b]); });
  el('attn').textContent = fmt(attCount);
  el('total').textContent = fmt(shown) + ' papers in ' + list.length + ' cluster' + (list.length === 1 ? '' : 's');
  el('hidden').textContent = gone ? gone + ' smaller cluster' + (gone === 1 ? '' : 's') + ' hidden (' + fmt(goneN) + ' papers)' : '';
  el('none').classList.toggle('hide', list.length > 0);
  el('list').innerHTML = list.map(function (g) { return clusterHtml(g, biggest); }).join('');
  size();
}
function spark(g) {
  var W = 92, H = 30, n = S.to - S.from + 1, per = Math.max(1, Math.round(n / 12)), vals = [], top = 1;
  for (var x = S.from; x <= S.to; x += per) { var s = 0; for (var y = x; y < x + per && y <= S.to; y++) s += g.days[y] || 0; vals.push(s); if (s > top) top = s; }
  var bw = W / vals.length;
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + vals.map(function (v, i) { var h = Math.round(v / top * (H - 2)); return '<rect x="' + (i * bw).toFixed(1) + '" y="' + (H - h) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + h + '" fill="#8fb8f2" opacity=".75"/>'; }).join('') + '</svg>';
}
function clusterHtml(g, biggest) {
  var opened = !!S.open[g.root], one = g.subs.length === 1, lead = d.leaves[g.subs[0].leaf];
  var t = g.trend, tr = t === null ? '<small>&nbsp;</small>' : t >= 1.5 ? '<small class="up">&#8599; ' + t.toFixed(1) + '&times; share</small>' : t <= 0.67 ? '<small class="down">&#8600; ' + t.toFixed(1) + '&times; share</small>' : '<small>steady</small>';
  var h = '<div class="c"><button class="chead" data-open="' + g.root + '" aria-expanded="' + opened + '"><span><h3>' + esc(nameOf(g)) + '</h3>' + (lead.summary && one ? '<p>' + esc(lead.summary) + '</p>' : '') + '<div class="bar"><i style="width:' + Math.round(g.papers.length / biggest * 100) + '%"></i></div></span>' + spark(g) + '<span class="nums">' + fmt(g.papers.length) + tr + '</span></button>';
  if (opened) {
    h += '<div class="cbody">';
    if (!one) h += '<p class="subs">Includes: ' + g.subs.map(function (s) { return '<b>' + esc(d.leaves[s.leaf].name) + '</b> (' + s.n + ')'; }).join(', ') + '</p>';
    if (one && lead.terms && lead.terms.length) h += '<div class="terms">' + lead.terms.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>';
    var sorted = g.papers.slice().sort(function (a, b) { return b[PSCORE] - a[PSCORE] || b[PDAY] - a[PDAY] || (a[PID] < b[PID] ? 1 : -1); }), n = S.shown[g.root] || 15;
    h += sorted.slice(0, n).map(paperHtml).join('');
    if (sorted.length > n) h += '<button class="more" data-more="' + g.root + '">Show ' + Math.min(25, sorted.length - n) + ' more of ' + fmt(sorted.length - n) + '</button>';
    h += '</div>';
  }
  return h + '</div>';
}
function paperHtml(p) {
  var id = p[PID], b = [], a = S.abs[id];
  if (p[PHF]) b.push('<span class="badge">' + p[PHF] + ' upvotes</span>');
  if (p[PHN]) b.push('<span class="badge">' + p[PHN] + ' HN points</span>');
  if (p[PACC]) b.push('<span class="badge">' + p[PACC] + ' post' + (p[PACC] === 1 ? '' : 's') + '</span>');
  var topics = d.topics.filter(function (t, i) { return p[PMASK] & (1 << i); }).map(function (t) { return t.title; }).join(', ');
  var h = '<div class="p"><div class="t"><a href="https://arxiv.org/abs/' + esc(id) + '" data-link="https://arxiv.org/abs/' + esc(id) + '">' + esc(p[PTITLE]) + '</a></div><div class="m"><span>' + dayText(p[PDAY]) + '</span><span>' + esc(topics) + '</span>' + b.join('') + '<button class="link" data-abs="' + esc(id) + '">' + (a && a.open ? 'Hide abstract' : 'Abstract') + '</button></div>';
  if (a && a.open) h += '<div class="abs">' + (a.err ? 'This could not be read.' : a.data ? (a.data.authors && a.data.authors.length ? '<div class="au">' + esc(a.data.authors.join(', ')) + '</div>' : '') + esc(a.data.abstract) : 'Reading…') + '</div>';
  return h + '</div>';
}
function toggleAbs(id) {
  var a = S.abs[id] || (S.abs[id] = {});
  a.open = !a.open;
  if (a.open && !a.data) {
    var m = ++seq;
    pending[m] = function (r) { try { if (r && !r.isError) a.data = JSON.parse(r.content[0].text); else a.err = true; } catch (e) { a.err = true; } a.loading = false; draw(); };
    send({ id: m, method: 'tools/call', params: { name: 'get_paper', arguments: { id: id } } });
  }
  draw();
}
var queued = false;
function later_() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; draw(); }); }
function bind() {
  el('from').addEventListener('input', function () { S.from = Math.min(+this.value, S.to); this.value = S.from; later_(); });
  el('to').addEventListener('input', function () { S.to = Math.max(+this.value, S.from); this.value = S.to; later_(); });
  el('detail').addEventListener('input', function () { S.detail = +this.value; later_(); });
  el('min').addEventListener('input', function () { S.min = +this.value; later_(); });
  el('sort').addEventListener('change', function () { S.sort = this.value; draw(); });
  el('q').addEventListener('input', function () { S.q = this.value; later_(); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-link],[data-open],[data-more],[data-abs],[data-days],[data-topic],#att,#reset');
    if (!t) return;
    if (t.dataset.link) { e.preventDefault(); open_(t.dataset.link); return; }
    if (t.dataset.open !== undefined) { S.open[t.dataset.open] = !S.open[t.dataset.open]; draw(); return; }
    if (t.dataset.more !== undefined) { S.shown[t.dataset.more] = (S.shown[t.dataset.more] || 15) + 25; draw(); return; }
    if (t.dataset.abs) { toggleAbs(t.dataset.abs); return; }
    if (t.dataset.days) { S.to = d.days; S.from = Math.max(0, d.days - +t.dataset.days + 1); el('from').value = S.from; el('to').value = S.to; draw(); return; }
    if (t.dataset.topic !== undefined) { var b = 1 << +t.dataset.topic; S.off ^= b; var on = !(S.off & b); t.classList.toggle('on', on); t.setAttribute('aria-pressed', on); draw(); return; }
    if (t.id === 'att') { S.att = !S.att; t.classList.toggle('on', S.att); t.setAttribute('aria-pressed', S.att); draw(); return; }
    if (t.id === 'reset') {
      S.from = 0; S.to = d.days; S.detail = Math.min(d.leaves.length, 16); S.min = 1; S.sort = 'n'; S.q = ''; S.off = 0; S.att = false; S.open = {}; S.shown = {};
      el('from').value = 0; el('to').value = d.days; el('detail').value = S.detail; el('min').value = 1; el('sort').value = 'n'; el('q').value = '';
      document.querySelectorAll('[data-topic]').forEach(function (x) { x.classList.add('on'); x.setAttribute('aria-pressed', true); });
      el('att').classList.remove('on'); el('att').setAttribute('aria-pressed', false); draw();
    }
  });
}
function status(text) { el('s').innerHTML = text; size(); }
function building(v) {
  var p = v.progress || {};
  if (v.error) { status('<b>The map is not ready.</b> ' + esc(v.error) + '. It tries again by itself.'); return; }
  var step = p.toEmbed ? 'analysing papers, ' + fmt(p.toEmbed) + ' to go' : 'reading the month from arXiv at its pace, ' + fmt(p.read || 0) + (p.total ? ' of about ' + fmt(p.total) : '') + ' papers so far';
  status('<b>The map is being built.</b> This takes some minutes the first time: ' + step + '. Come back shortly.');
}
function take(r) {
  var v;
  try { if (r.isError) throw 0; v = JSON.parse(r.content[0].text); } catch (e) { status('The map could not be read.'); return; }
  if (v.state !== 'ready') { building(v); return; }
  d = v; setup();
}
window.addEventListener('message', function (e) {
  if (e.source !== parent || !e.data) return;
  var m = e.data;
  if (m.id === 1) { send({ method: 'ui/notifications/initialized' }); return; }
  if (m.id && pending[m.id]) { var f = pending[m.id]; delete pending[m.id]; f(m.result || { isError: true }); return; }
  if (m.method === 'ui/notifications/tool-result') take(m.params || {});
});
bind();
new ResizeObserver(size).observe(el('app'));
send({ id: 1, method: 'ui/initialize', params: { appInfo: { name: 'tweet-explorer-map', version: '0.1.0' }, appCapabilities: { availableDisplayModes: ['inline'] }, protocolVersion: '2026-01-26' } });
</script></body></html>`;
