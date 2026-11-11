// The Depth chart: a cross-section of water with one bubble per topic. How high a bubble floats is its breadth (the surface: every kind of source and most groups have it; the deep: it lives
// in one place), its size is its share of the week's items, and the trail under or over it is where it was on the days before. A slider and a Play button go through the 14 days.
// It is the view of the get_rising tool on both MCP servers and the picture on the site's /rising page, in the sandboxed frame of src/site/viz.ts (there /viz/host.js answers get_rising from /rising.json).
// A plain page like landscape.ts: classic inline script, the ui/* postMessage protocol directly, no SDK and no bundler. Keep it free of backticks and template placeholders.
// Data: the structuredContent of get_rising (or its JSON text, which is what the site gives), RisingData in src/site/rising.ts:
//   { area, lens: {key,name}|null, lenses: [{key,name,color,light,dark}], days: [iso...], w, h, surfaceY, floorY, window, span, kinds, kindNames, watched: {kinds,groups,sources},
//     topics: [{slug,label,url,state,score,r,first,lensColor,inLens,b[],x[],y[],k[],g[],s[],m[],rise,zone,reach}], rising: [slug...] }
// The water is dark in both themes (it is a picture of depth); everything around it follows the host's theme.
export default `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1c2b2d;--mut:#566a6d;--line:#d6dedb;--ac:#b0245f;--btn:#eef2f0;--w0:#2c8794;--w1:#0b3344;--w2:#061722}
@media (prefers-color-scheme:dark){:root{--bg:#142224;--fg:#e8eeee;--mut:#9bb0b2;--line:#2c4144;--ac:#ff8fb8;--btn:#1d3033;--w0:#1c6470;--w1:#082634;--w2:#040e16}}
:root[data-theme=light]{color-scheme:light;--bg:#fff;--fg:#1c2b2d;--mut:#566a6d;--line:#d6dedb;--ac:#b0245f;--btn:#eef2f0;--w0:#2c8794;--w1:#0b3344;--w2:#061722}
:root[data-theme=dark]{color-scheme:dark;--bg:#142224;--fg:#e8eeee;--mut:#9bb0b2;--line:#2c4144;--ac:#ff8fb8;--btn:#1d3033;--w0:#1c6470;--w1:#082634;--w2:#040e16}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
.hide{display:none!important}#app{padding:12px 12px 10px}#s{color:var(--mut);padding:18px 14px}
#bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-bottom:8px}#bar .sp{flex:1}
label{color:var(--mut);font-size:12.5px;display:flex;gap:6px;align-items:center}
select,button{font:inherit;color:var(--fg);background:var(--btn);border:1px solid var(--line);border-radius:7px;padding:3px 10px;cursor:pointer}select{padding:3px 6px}
button:hover,select:hover{border-color:var(--mut)}button[aria-pressed=true]{border-color:var(--ac);color:var(--ac);font-weight:600}button:disabled,select:disabled{opacity:.55;cursor:default}
button:focus-visible,select:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
@media (min-width:780px){#grid{grid-template-columns:minmax(0,1fr) 232px}}
#stage{position:relative;border-radius:12px;overflow:hidden;background:var(--bg)}
svg{display:block;width:100%;height:auto}
.sky text{fill:var(--mut)}.zone line{stroke:#fff;stroke-opacity:.16;stroke-dasharray:3 7}.zone text{fill:#fff;fill-opacity:.62;font-weight:700;letter-spacing:.09em}.zone .sub{font-weight:400;letter-spacing:0;fill-opacity:.5}
.ax text{fill:#fff;fill-opacity:.45}
.b{cursor:pointer;outline:none}.b .dot{stroke-width:1.6}.b .shine{fill:#fff;fill-opacity:.3;pointer-events:none}
.b text.lb{fill:#fff;text-anchor:middle;pointer-events:none;font-weight:600;paint-order:stroke;stroke:rgba(4,18,26,.55);stroke-width:2.5px;stroke-linejoin:round}
.b text.tag{fill:#ffd98a;text-anchor:middle;pointer-events:none;font-weight:800;letter-spacing:.03em;paint-order:stroke;stroke:rgba(4,18,26,.7);stroke-width:3px;stroke-linejoin:round}
.b text.tag.new{fill:#fff}
.b:hover .dot,.b:focus .dot,.b.hot .dot{stroke-width:3.5}.b:focus .focus{display:block}.focus{display:none;fill:none;stroke:#fff;stroke-width:2;stroke-dasharray:2 3}
.b.sel .dot{stroke-width:4.5}.b .tick{display:none;fill:#fff;font-weight:700;text-anchor:middle;pointer-events:none}.b.sel .tick{display:block}
.pick .b{cursor:copy}.tr{fill:none;stroke-linecap:round;pointer-events:none}
#tip{position:absolute;pointer-events:none;max-width:280px;background:var(--bg);color:var(--fg);border:1px solid var(--mut);border-radius:8px;padding:7px 10px;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,.35);z-index:5}
#tip b{display:block;font-size:14px}#tip span{display:block;color:var(--mut)}#tip .st{color:var(--ac);font-weight:600}
#side h2{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);margin:2px 0 6px;font-weight:700}
#side ol,#list{margin:0;padding:0;list-style:none;display:grid;gap:4px}
#up button{display:block;width:100%;text-align:left;padding:7px 10px;border-radius:9px;background:none}
#up button:hover{background:var(--btn)}#up b{display:block}#up .c{color:var(--ac);font-weight:700;font-variant-numeric:tabular-nums}#up small{display:block;color:var(--mut);font-size:12.5px}
#upnone{color:var(--mut);font-size:13px;margin:0}
#scrub{display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap;margin:10px 2px 2px}#scrub input{flex:1 1 180px;min-width:120px;accent-color:var(--ac)}
#play{font-weight:700;border-color:var(--ac);color:var(--ac)}#dlabel{font-weight:700;font-variant-numeric:tabular-nums;min-width:9.5em}
#legend{color:var(--mut);font-size:12.5px;margin:8px 2px 4px}#legend b{color:var(--fg);font-weight:600}
#note{color:var(--mut);font-size:12.5px;min-height:1.4em;margin:2px}
details{margin-top:4px}summary{cursor:pointer;color:var(--mut);font-size:13px}
#list{margin-top:6px;gap:2px}#list button{display:flex;gap:8px;width:100%;text-align:left;border:0;background:none;padding:3px 4px;border-radius:5px;flex-wrap:wrap}#list button:hover{background:var(--btn)}
#list .n{flex:1 1 12em}#list .z{color:var(--mut);font-size:12.5px;flex:2 1 16em}#list .p{color:var(--mut);font-variant-numeric:tabular-nums}
body.full #app{min-height:100vh}body.full svg{max-height:calc(100vh - 210px)}
</style></head><body><div id="s">Reading the water…</div><div id="app" class="hide">
<div id="bar"><label>Lens <select id="lens" aria-label="Lens"></select></label><span class="sp"></span>
<button id="pickb" class="hide" aria-pressed="false" title="Click bubbles to pick them, then ask Claude about them">Pick topics</button><button id="ask" class="hide"></button><button id="fs" class="hide">Fullscreen</button></div>
<div id="grid"><div id="stage"><svg id="svg" role="group" aria-label="Topics by depth: the surface is everywhere, the deep is one place"></svg><div id="tip" class="hide" role="status"></div></div>
<aside id="side"><h2>Rising from the deep</h2><ol id="up"></ol><p id="upnone" class="hide">Nothing climbed much in the last days.</p></aside></div>
<div id="scrub"><button id="play" type="button"></button><input id="day" type="range" min="0" max="13" step="1" value="13" aria-label="Day"><output id="dlabel" for="day"></output></div>
<p id="legend"></p><p id="note" aria-live="polite"></p>
<details id="lbox"><summary>The topics as a list</summary><ol id="list"></ol></details></div>
<script>
var NS = 'http://www.w3.org/2000/svg', MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], ZONES = { surface: 'at the surface', mid: 'mid-water', deep: 'in the deep' };
var pending = {}, nextId = 2, host = {}, D = null, busy = false, theme = '', lens = '', area = 'ai', picking = false, sel = {}, ctxTimer = 0, scale = 1, ox = 0, oy = 0;
var T = 0, playing = false, raf = 0, stepTimer = 0, hot = '', MIN_CLIMB = 0.08, TRAIL = 6, DAY_MS = 750;
function el(id) { return document.getElementById(id); }
function send(m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); }
function request(method, params, ms, done) {
  var id = nextId++, timer = setTimeout(function () { delete pending[id]; done(new Error('no reply from the host')); }, ms || 20000);
  pending[id] = function (m) { clearTimeout(timer); done(m.error ? new Error(m.error.message || 'error') : null, m.result); };
  send({ id: id, method: method, params: params });
}
function reportSize() { send({ method: 'ui/notifications/size-changed', params: { width: Math.ceil(window.innerWidth), height: Math.ceil(el('app').getBoundingClientRect().height) + 2 } }); }
function setTheme(t) { if (t === 'light' || t === 'dark') { theme = t; document.documentElement.setAttribute('data-theme', t); if (D) draw(); } }
function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function sv(tag, attrs, text) { var e = document.createElementNS(NS, tag), k; for (k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; }
function pct(v) { return Math.round(v * 100) + '%'; }
function still() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
function dayText(i) { var p = String(D.days[i] || '').split('-'); return p.length === 3 ? Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] : ''; }
function last() { return D.days.length - 1; }

// ---- the data: structuredContent when the host passes it on, else the JSON in the text (what the site gives)
function readResult(res) {
  if (!res) throw new Error('no answer');
  if (res.isError) throw new Error(res.content && res.content[0] ? res.content[0].text : 'the tool failed');
  if (res.structuredContent) return res.structuredContent;
  var t = res.content && res.content[0] ? res.content[0].text : '';
  try { return JSON.parse(t); } catch (e) { throw new Error('this host gave only text, no data for the picture'); }
}
function bySlug(k) { return D.topics.filter(function (t) { return t.slug === k; })[0]; }
function colorOf(t) {
  if (!t.lensColor) return '#cfeef2';
  var l = D.lenses.filter(function (x) { return x.color === t.lensColor; })[0];
  return l ? l.dark : '#cfeef2';   // the water is dark in both themes, so the shade made for dark
}
function zoneAt(b) { return b >= 0.66 ? 'surface' : b >= 0.4 ? 'mid' : 'deep'; }
function yOf(b) { return D.floorY - b * (D.floorY - D.surfaceY); }
function riseAt(t, i) { return (t.b[i] || 0) - (t.b[Math.max(0, i - D.span)] || 0); }
function reachText(t, i) {
  if (!t.s[i]) return 'No source had it in these days.';
  var names = D.kindNames.filter(function (_, j) { return t.k[i] & (1 << j); });
  return 'On ' + names.join(', ') + ' (' + names.length + ' of ' + D.watched.kinds + ' kinds of source) · ' + t.g[i] + ' of ' + D.watched.groups + ' groups · ' + t.s[i] + ' of ' + D.watched.sources + ' sources · ' + t.m[i] + (t.m[i] === 1 ? ' mention' : ' mentions');
}
// where a bubble is at a moment between two days: it glides when it is there on both, and fades in or out when it is there on one
function at(t, time) {
  var i0 = Math.floor(time), i1 = Math.min(last(), i0 + 1), f = time - i0, a = t.y[i0] !== null && t.y[i0] !== undefined, b = t.y[i1] !== null && t.y[i1] !== undefined;
  if (f === 0 || i0 === i1) return a ? { x: t.x[i0], y: t.y[i0], o: 1 } : null;
  if (a && b) return { x: t.x[i0] + (t.x[i1] - t.x[i0]) * f, y: t.y[i0] + (t.y[i1] - t.y[i0]) * f, o: 1 };
  if (a) return { x: t.x[i0], y: t.y[i0], o: 1 - f };
  if (b) return { x: t.x[i1], y: t.y[i1], o: f };
  return null;
}

// ---- drawing
function water(svg, fs, taken) {
  var w = D.w, h = D.h, sy = D.surfaceY, defs = sv('defs', {}), g = sv('linearGradient', { id: 'wg', x1: 0, y1: 0, x2: 0, y2: 1 }), css = getComputedStyle(document.documentElement), x, d;
  g.appendChild(sv('stop', { offset: '0', 'stop-color': css.getPropertyValue('--w0').trim() || '#2c8794' }));
  g.appendChild(sv('stop', { offset: '.45', 'stop-color': css.getPropertyValue('--w1').trim() || '#0b3344' }));
  g.appendChild(sv('stop', { offset: '1', 'stop-color': css.getPropertyValue('--w2').trim() || '#061722' }));
  defs.appendChild(g);
  var ray = sv('linearGradient', { id: 'rg', x1: 0, y1: 0, x2: 0, y2: 1 });
  ray.appendChild(sv('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.13' })); ray.appendChild(sv('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }));
  defs.appendChild(ray); svg.appendChild(defs);
  // the surface: a gentle swell, the same every time
  d = 'M0 ' + sy;
  for (x = 0; x <= w; x += 25) d += ' L' + x + ' ' + (sy + Math.sin(x / 58) * 3 + Math.sin(x / 23 + 1) * 1.4).toFixed(1);
  svg.appendChild(sv('path', { d: d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z', fill: 'url(#wg)' }));
  [[150, 70, 260], [470, 110, 330], [790, 60, 240]].forEach(function (r) { svg.appendChild(sv('path', { d: 'M' + r[0] + ' ' + (sy + 3) + ' L' + (r[0] + r[1]) + ' ' + (sy + 3) + ' L' + (r[0] + r[1] - 40) + ' ' + (sy + r[2]) + ' L' + (r[0] - 90) + ' ' + (sy + r[2]) + ' Z', fill: 'url(#rg)', 'pointer-events': 'none' })); });
  svg.appendChild(sv('path', { d: d, fill: 'none', stroke: '#fff', 'stroke-opacity': '.55', 'stroke-width': 1.5 }));
  var sky = sv('g', { 'class': 'sky', 'aria-hidden': 'true' });
  var st = sv('text', { x: 14, y: fs(17), 'font-size': fs(12) });
  st.appendChild(sv('tspan', { 'font-weight': 700, 'letter-spacing': '.09em' }, 'THE SURFACE'));
  st.appendChild(sv('tspan', { dx: fs(8) }, 'everywhere: every kind of source, most groups'));
  sky.appendChild(st);
  svg.appendChild(sky);
  var z = sv('g', { 'class': 'zone', 'aria-hidden': 'true' });
  [[0.66, 'MID-WATER', 'some kinds, some groups'], [0.4, 'THE DEEP', 'one place']].forEach(function (p) {
    var y = yOf(p[0]);
    z.appendChild(sv('line', { x1: 0, y1: y, x2: w, y2: y }));
    var zt = sv('text', { x: 14, y: y + fs(16), 'font-size': fs(11) }, p[1]);
    zt.appendChild(sv('tspan', { 'class': 'sub', dx: fs(7) }, p[2]));
    z.appendChild(zt);
    taken.push({ zone: true, x0: 14, y0: y + fs(4), x1: 14 + fs(p[1].length * 8.4 + p[2].length * 5.4 + 8), y1: y + fs(20) });
  });
  svg.appendChild(z);
  var ax = sv('g', { 'class': 'ax', 'aria-hidden': 'true' });
  ax.appendChild(sv('text', { x: 14, y: h - fs(9), 'font-size': fs(11.5) }, '← around longer'));
  ax.appendChild(sv('text', { x: w - 14, y: h - fs(9), 'font-size': fs(11.5), 'text-anchor': 'end' }, 'newer →'));
  svg.appendChild(ax);
}
function draw() {
  var svg = el('svg'), w = D.w, h = D.h, rect, sc, fs, day = Math.round(T), trails = sv('g', { 'aria-hidden': 'true' }), tags = sv('g', { 'class': 'b', 'pointer-events': 'none', 'aria-hidden': 'true' });
  svg.textContent = '';
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  rect = svg.getBoundingClientRect();
  sc = rect.height ? Math.min((rect.width || 600) / w, rect.height / h) : (rect.width || 600) / w; scale = sc;
  ox = ((rect.width || 600) - w * sc) / 2; oy = rect.height ? (rect.height - h * sc) / 2 : 0;
  fs = function (px) { return Math.round(px / sc * 10) / 10; };
  svg.classList.toggle('pick', picking);
  var taken = [], spots = [], labels = {};
  water(svg, fs, taken);
  svg.appendChild(trails);
  D.topics.forEach(function (t) { var p = at(t, T); if (p) spots.push({ t: t, p: p, up: riseAt(t, day) >= MIN_CLIMB }); });
  // The names: inside the bubble when all of it fits; else under it, over it or beside it, wherever nothing else is. A name with no free place is left to the tooltip and the list.
  var hits = function (b, skip) {
    var i, o, cx, cy;
    if (b.x0 < 2 || b.x1 > w - 2 || b.y0 < D.surfaceY + fs(8) || b.y1 > h - fs(18)) return true;   // in the water, clear of the foot line
    for (i = 0; i < taken.length; i++) { o = taken[i]; if (o.zone && skip.up) continue;   /* a climber's name may sit on a caption of the water: the name matters more */ if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return true; }
    for (i = 0; i < spots.length; i++) { o = spots[i]; if (o === skip) continue; cx = Math.max(b.x0, Math.min(b.x1, o.p.x)); cy = Math.max(b.y0, Math.min(b.y1, o.p.y)); if (Math.hypot(cx - o.p.x, cy - o.p.y) < o.t.r + fs(2)) return true; }
    return false;
  };
  spots.forEach(function (o) { if (o.up || (o.t.state === 'new' && day === last())) taken.push({ x0: o.p.x - fs(22), x1: o.p.x + fs(22), y0: o.p.y - o.t.r - fs(20), y1: o.p.y - o.t.r }); });
  spots.slice().sort(function (a, b) { return Number(b.up) - Number(a.up) || Number(hot === b.t.slug) - Number(hot === a.t.slug) || b.t.r - a.t.r; }).forEach(function (o) {
    var t = o.t, p = o.p, name = t.label.length > 26 ? t.label.slice(0, 25) + '…' : t.label, px = t.r * sc, i, c, b;
    if (t.label.length <= Math.floor(px * 1.7 / 6.3)) { labels[t.slug] = { x: p.x, y: p.y + fs(4), size: fs(Math.max(10.5, Math.min(13.5, px / 3.4))), text: t.label }; return; }
    var half = fs(name.length * 3.2 + 3), tall = fs(15), tagged = o.up || (t.state === 'new' && day === last());
    var tries = [[p.x, p.y + t.r + fs(14), 'middle'], [p.x, p.y - t.r - fs(tagged ? 24 : 6), 'middle'], [p.x + t.r + fs(5) + half, p.y + fs(4), 'middle'], [p.x - t.r - fs(5) - half, p.y + fs(4), 'middle']];
    for (i = 0; i < tries.length; i++) {
      c = tries[i]; b = { x0: c[0] - half, x1: c[0] + half, y0: c[1] - tall + fs(3), y1: c[1] + fs(4) };
      if (!hits(b, o)) { taken.push(b); labels[t.slug] = { x: c[0], y: c[1], size: fs(11.5), text: name }; return; }
    }
    i = Math.floor(px * 1.7 / 6.3);   // no free place: the start of the name inside, when a few letters fit
    if (i >= 5) labels[t.slug] = { x: p.x, y: p.y + fs(4), size: fs(10.5), text: t.label.slice(0, i - 1).replace(/\\s+$/, '') + '…' };
  });
  spots.slice().sort(function (a, b) { return b.t.r - a.t.r; }).forEach(function (o) {
    var t = o.t, p = o.p;
    var col = colorOf(t), rise = riseAt(t, day), up = rise >= MIN_CLIMB, dim = (D.lens && !t.inLens ? 0.5 : 1) * p.o, i, a, b, n = 0;
    // the trail: where it was on the days before, fading with age; a climb is drawn warm
    for (i = Math.max(1, Math.ceil(T) - TRAIL + 1); i <= Math.ceil(T); i++) {
      a = t.y[i - 1] !== null && t.y[i - 1] !== undefined ? { x: t.x[i - 1], y: t.y[i - 1] } : null;
      b = i <= T ? (t.y[i] !== null && t.y[i] !== undefined ? { x: t.x[i], y: t.y[i] } : null) : p;
      if (!a || !b || (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5)) continue;
      n = 1 - (T - i + 1) / TRAIL;
      trails.appendChild(sv('line', { 'class': 'tr', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: up ? '#ffd98a' : col, 'stroke-opacity': (0.12 + 0.5 * Math.max(0, n)) * dim, 'stroke-width': 1.2 + Math.max(0, n) * Math.min(7, t.r * 0.32) }));
    }
    var g = sv('g', { 'class': 'b' + (sel[t.slug] ? ' sel' : '') + (hot === t.slug ? ' hot' : ''), tabindex: 0, role: picking ? 'checkbox' : 'link', 'data-k': t.slug, opacity: dim });
    if (picking) g.setAttribute('aria-checked', sel[t.slug] ? 'true' : 'false');
    g.setAttribute('aria-label', t.label + ', ' + ZONES[zoneAt(t.b[day] || 0)] + ', breadth ' + pct(t.b[day] || 0) + (up ? ', up ' + Math.round(rise * 100) + ' points in ' + D.span + ' days' : '') + (picking ? '. Press Enter to pick or drop it.' : '. Press Enter to open it.'));
    g.appendChild(sv('circle', { 'class': 'focus', cx: p.x, cy: p.y, r: t.r + fs(6) }));
    if (up) g.appendChild(sv('circle', { cx: p.x, cy: p.y, r: t.r + fs(4), fill: 'none', stroke: '#ffd98a', 'stroke-opacity': '.55', 'stroke-width': fs(1.5) }));
    g.appendChild(sv('circle', { 'class': 'dot', cx: p.x, cy: p.y, r: t.r, fill: col, 'fill-opacity': '.24', stroke: col }));
    g.appendChild(sv('ellipse', { 'class': 'shine', cx: p.x - t.r * 0.36, cy: p.y - t.r * 0.42, rx: t.r * 0.2, ry: t.r * 0.12, transform: 'rotate(-35 ' + (p.x - t.r * 0.36) + ' ' + (p.y - t.r * 0.42) + ')' }));
    if (labels[t.slug]) g.appendChild(sv('text', { 'class': 'lb', x: labels[t.slug].x, y: labels[t.slug].y, 'font-size': labels[t.slug].size }, labels[t.slug].text));
    g.appendChild(sv('text', { 'class': 'tick', x: p.x, y: p.y - t.r * 0.45, 'font-size': fs(12) }, '✓'));
    if (up) tags.appendChild(sv('text', { 'class': 'tag', x: p.x, y: p.y - t.r - fs(8), 'font-size': fs(11), opacity: dim }, '▲ +' + Math.round(rise * 100)));
    else if (t.state === 'new' && day === last()) tags.appendChild(sv('text', { 'class': 'tag new', x: p.x, y: p.y - t.r - fs(6), 'font-size': fs(10), opacity: dim }, 'NEW'));
    svg.appendChild(g);
  });
  svg.appendChild(tags);
  el('day').value = String(day); el('dlabel').textContent = day === last() ? dayText(day) + ' · today' : dayText(day);
  el('day').setAttribute('aria-valuetext', dayText(day));
  if (!playing) reportSize();
}

// ---- hover, focus
function showTip(t, g) {
  var tip = el('tip'), day = Math.round(T), p = at(t, T), rise = riseAt(t, day), st = el('stage').getBoundingClientRect();
  if (!p) return;
  tip.textContent = '';
  tip.appendChild(mk('b', '', t.label));
  tip.appendChild(mk('span', 'st', ZONES[zoneAt(t.b[day] || 0)].replace(/^./, function (c) { return c.toUpperCase(); }) + ' · breadth ' + pct(t.b[day] || 0) + (rise >= MIN_CLIMB ? ' · up ' + Math.round(rise * 100) + ' points in ' + D.span + ' days' : rise <= -MIN_CLIMB ? ' · down ' + Math.round(-rise * 100) + ' points' : '')));
  tip.appendChild(mk('span', '', reachText(t, day)));
  tip.appendChild(mk('span', '', 'The ' + D.window + ' days to ' + dayText(day) + (t.state && day === last() ? ' · ' + t.state + ' this week' : '') + ' · ' + (Math.round(t.score * 1000) / 10) + '% of the week\\'s items'));
  tip.classList.remove('hide');
  var x = ox + p.x * scale, y = oy + (p.y - t.r) * scale, tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.max(4, Math.min(st.width - tw - 4, x - tw / 2)) + 'px';
  tip.style.top = (y - th - 8 < 4 ? oy + (p.y + t.r) * scale + 8 : y - th - 8) + 'px';
}
function hideTip() { el('tip').classList.add('hide'); }
function topicOf(e) { var g = e.target && e.target.closest ? e.target.closest('.b[data-k]') : null; return g ? bySlug(g.getAttribute('data-k')) : null; }
el('svg').addEventListener('mouseover', function (e) { var t = topicOf(e); if (t) showTip(t); });
el('svg').addEventListener('mouseout', function (e) { if (topicOf(e)) hideTip(); });
el('svg').addEventListener('focusin', function (e) { var t = topicOf(e); if (t) showTip(t); });
el('svg').addEventListener('focusout', hideTip);
el('svg').addEventListener('click', function (e) { var t = topicOf(e); if (t) act(t); });
el('svg').addEventListener('keydown', function (e) { var t = topicOf(e); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act(t); } });

// ---- the bar, the lists, the words
function chosen() { return D.topics.filter(function (t) { return sel[t.slug]; }); }
function renderAsk() {
  var n = chosen().length, a = el('ask');
  a.classList.toggle('hide', !picking || !host.message);
  a.textContent = n ? 'Ask Claude about ' + n + (n === 1 ? ' topic' : ' topics') : 'Pick a bubble'; a.disabled = !n;
}
function renderBar() {
  var s = el('lens'), o;
  s.textContent = '';
  o = mk('option', '', 'All'); o.value = ''; s.appendChild(o);
  (D.lenses || []).forEach(function (l) { var x = mk('option', '', l.name); x.value = l.key; s.appendChild(x); });
  s.value = lens; s.disabled = busy; s.parentNode.classList.toggle('hide', !(D.lenses || []).length);
  el('pickb').classList.toggle('hide', !host.message); el('pickb').setAttribute('aria-pressed', picking ? 'true' : 'false');
  renderAsk();
}
function climbText(t) {
  var then = t.b[Math.max(0, last() - D.span)] || 0, now = t.b[last()] || 0;
  return (then > 0 ? ZONES[zoneAt(then)] : 'not there') + ' → ' + ZONES[zoneAt(now)];
}
function renderLists() {
  var up = el('up'), list = el('list'), rising = (D.rising || []).map(bySlug).filter(function (t) { return t && (!D.lens || t.inLens); });
  if (!rising.length) rising = (D.rising || []).map(bySlug).filter(Boolean);
  up.textContent = '';
  rising.forEach(function (t) {
    var li = mk('li'), b = mk('button'), head = mk('b', '', t.label + ' ');
    head.appendChild(mk('span', 'c', '▲ +' + Math.round(t.rise * 100)));
    b.appendChild(head); b.appendChild(mk('small', '', climbText(t) + ', in ' + D.span + ' days'));
    b.onclick = function () { act(t); };
    b.onmouseenter = b.onfocus = function () { hot = t.slug; draw(); }; b.onmouseleave = b.onblur = function () { if (hot === t.slug) { hot = ''; draw(); } };
    li.appendChild(b); up.appendChild(li);
  });
  el('upnone').classList.toggle('hide', rising.length > 0);
  list.textContent = '';
  D.topics.slice().sort(function (a, b) { return (b.b[last()] || 0) - (a.b[last()] || 0); }).forEach(function (t) {
    var li = mk('li'), b = mk('button');
    b.appendChild(mk('span', 'n', t.label)); b.appendChild(mk('span', 'z', t.zone ? ZONES[t.zone] + ': ' + (t.reach || '') : 'no source had it in the last days')); b.appendChild(mk('span', 'p', pct(t.b[last()] || 0)));
    b.onclick = function () { act(t); };
    li.appendChild(b); list.appendChild(li);
  });
}
function renderLegend() {
  var p = el('legend');
  p.textContent = '';
  p.appendChild(mk('b', '', 'Depth is breadth, not loudness: '));
  p.appendChild(document.createTextNode('how much of what is watched had the topic over ' + D.window + ' days (kinds of source, groups of sources, single sources). Size is its share of the week\\'s items. ▲ +N: breadth up N points in ' + D.span + ' days. Watched: ' + D.kindNames.join(', ') + '; ' + D.watched.groups + ' groups; ' + D.watched.sources + ' sources.'));
}
function renderPlay() { el('play').textContent = playing ? '❚❚ Pause' : '▶ Play ' + D.days.length + ' days'; el('play').setAttribute('aria-pressed', playing ? 'true' : 'false'); }
function show(d) {
  if (!d || !d.topics || !d.topics.length || !d.days || !d.days.length) throw new Error('no topics to place yet');
  stop();
  D = d; area = d.area === 'politics' ? 'politics' : 'ai'; lens = d.lens ? d.lens.key : '';
  var keep = {}; D.topics.forEach(function (t) { if (sel[t.slug]) keep[t.slug] = true; }); sel = keep;
  T = last(); el('day').max = String(last());
  el('s').classList.add('hide'); el('app').classList.remove('hide');
  renderBar(); renderLegend(); renderLists(); renderPlay(); draw();
  el('note').textContent = '';
}
function reload() {
  busy = true; renderBar(); el('note').textContent = 'Reading…';
  var args = {}; if (lens) args.lens = lens; if (area === 'politics') args.area = area;
  request('tools/call', { name: 'get_rising', arguments: args }, 30000, function (err, res) {
    busy = false;
    try { if (err) throw err; show(readResult(res)); } catch (e) { renderBar(); el('note').textContent = 'Could not read it: ' + e.message; }
  });
}
el('lens').onchange = function () { lens = el('lens').value; reload(); };

// ---- the days: nothing moves until Play is pressed; with reduced motion the days step instead of gliding
function stop() { playing = false; cancelAnimationFrame(raf); clearInterval(stepTimer); if (D) renderPlay(); }
function play() {
  if (playing) { stop(); T = Math.round(T); draw(); return; }
  playing = true; hideTip(); if (T >= last()) T = 0; renderPlay();
  if (still()) { draw(); stepTimer = setInterval(function () { if (T >= last()) { stop(); return; } T = Math.round(T) + 1; draw(); }, DAY_MS); return; }
  var from = T, t0 = 0;
  var tick = function (now) {
    if (!playing) return;
    if (!t0) t0 = now;
    T = Math.min(last(), from + (now - t0) / DAY_MS);
    draw();
    if (T >= last()) { stop(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
el('play').onclick = play;
el('day').oninput = function () { stop(); T = Number(el('day').value) || 0; draw(); };

// ---- clicking, picking, asking
function act(t) {
  if (picking) { if (sel[t.slug]) delete sel[t.slug]; else sel[t.slug] = true; draw(); renderAsk(); sendContext(); return; }
  // A view cannot swap itself for another tool's view: where the host lets a view message Claude, a click asks Claude to open the topic (get_topic, and the Topic hub is drawn). Elsewhere it opens the page.
  if (host.message) {
    request('ui/message', { role: 'user', content: [{ type: 'text', text: 'Show me the topic ' + t.slug + ' (' + t.label + ') from the Undercurrent depth chart.' }] }, 10000, function (err, res) {
      var n = el('note'); n.textContent = err || (res && res.isError) ? 'Could not send that to Claude. ' : 'Asked Claude to open ' + t.label + '. ';
      var o = mk('button', '', 'Open the page instead'); o.onclick = function () { openPage(t); }; n.appendChild(o);
    });
    return;
  }
  openPage(t);
}
function openPage(t) { request('ui/open-link', { url: t.url }, 8000, function (err) { if (err) el('note').textContent = 'This host did not open the page. It is at ' + t.url; }); }
function describe(t) {
  return '- ' + t.label + ' (topic ' + t.slug + ', ' + (t.zone ? ZONES[t.zone] : 'not there now') + ', breadth ' + pct(t.b[last()] || 0) + (t.rise >= MIN_CLIMB ? ', up ' + Math.round(t.rise * 100) + ' points in ' + D.span + ' days' : '') + (t.reach ? ', ' + t.reach : '') + ')';
}
function contextText() {
  var list = chosen();
  if (!list.length) return 'In the Undercurrent depth chart, no topics are picked.';
  return 'In the Undercurrent depth chart (breadth of topics over ' + D.days.length + ' days' + (area === 'politics' ? ', politics' : '') + (D.lens ? ', lens ' + D.lens.name : '') + '), the user picked these topics:\\n' + list.map(describe).join('\\n') + '\\nBreadth is reach (kinds of source, groups, sources), not reactions. Use get_topic with the topic address' + (area === 'politics' ? ' (area politics)' : '') + ' for the summary and evidence.';
}
function sendContext() {
  if (!host.message) return;
  clearTimeout(ctxTimer);
  ctxTimer = setTimeout(function () { request('ui/update-model-context', { content: [{ type: 'text', text: contextText() }] }, 8000, function () {}); }, 400);
}
function askClaude() {
  var list = chosen();
  if (!list.length) return;
  var text = 'What is going on with ' + list.map(function (t) { return t.label; }).join(', ') + '? Why are they where they are in the depth chart, and which of them is likely to reach the surface?\\n\\n' + contextText();
  request('ui/message', { role: 'user', content: [{ type: 'text', text: text }] }, 10000, function (err, res) { el('note').textContent = err || (res && res.isError) ? 'Could not send that. Ask in the chat instead.' : 'Sent to Claude.'; });
}
el('pickb').onclick = function () { picking = !picking; if (!picking) { sel = {}; sendContext(); } renderBar(); if (D) draw(); };
el('ask').onclick = askClaude;

// ---- sizes and the protocol
function setFull(on) { document.body.classList.toggle('full', on); el('fs').textContent = on ? 'Exit fullscreen' : 'Fullscreen'; if (D) draw(); }
el('fs').onclick = function () { request('ui/request-display-mode', { mode: document.body.classList.contains('full') ? 'inline' : 'fullscreen' }, 8000, function (err, res) { if (!err && res) setFull(res.mode === 'fullscreen'); }); };
var lastW = 0;
window.addEventListener('message', function (e) {
  var m = e.data, fn;
  if (!m) return;
  if (m.id === 1) {
    if (m.error) { el('s').textContent = 'initialize failed: ' + JSON.stringify(m.error); return; }
    var r = m.result || {}, hc = r.hostContext || {};
    host = r.hostCapabilities || {};
    setTheme(hc.theme);
    send({ method: 'ui/notifications/initialized' });
    reportSize();
    new ResizeObserver(function () { var w = Math.round(el('stage').getBoundingClientRect().width); if (D && w && w !== lastW) { lastW = w; if (!playing) draw(); } else reportSize(); }).observe(document.body);
    if ((hc.availableDisplayModes || []).indexOf('fullscreen') >= 0) el('fs').classList.remove('hide');
    if (hc.displayMode === 'fullscreen') setFull(true);
  } else if (m.id && pending[m.id]) {
    fn = pending[m.id]; delete pending[m.id]; fn(m);
  } else if (m.method === 'ui/notifications/tool-result') {
    try { show(readResult(m.params)); } catch (err) { el('s').classList.remove('hide'); el('s').textContent = 'Nothing to draw: ' + err.message; }
  } else if (m.method === 'ui/notifications/host-context-changed') {
    if (m.params && m.params.theme) setTheme(m.params.theme);
    if (m.params && m.params.displayMode) setFull(m.params.displayMode === 'fullscreen');
  } else if (m.method === 'ui/resource-teardown') {
    stop(); send({ id: m.id, result: {} });
  }
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideTip(); if (playing) { stop(); T = last(); draw(); } } });
send({ id: 1, method: 'ui/initialize', params: { appInfo: { name: 'undercurrent-depth', version: '0.1.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26' } });
</script></body></html>`;
