// The Landscape: one bubble per topic of the Signal, drawn from the layout the server keeps steady from day to day. Size is the topic's score, colour is the lens (grey outside the chosen lens),
// a ring and a mark say new or rising, and a dashed circle with a name groups topics that are talked about together. It is the view of the get_overview tool on both MCP servers and the picture
// on the landing page, in the sandboxed frame of src/site/viz.ts (there /viz/host.js answers get_overview from /overview.json).
// A plain page like first.ts and map.ts: classic inline script, the ui/* postMessage protocol directly, no SDK and no bundler. Keep it free of backticks and template placeholders.
// A click on a bubble: ask Claude to show the topic where the host allows messages (see act), else open its page.
// Data: the structuredContent of get_overview (or its JSON text, which is what the site gives): { window, lens: {key,name}|null, landscape: { w, h, clusters: [{id,name,x,y,r,members}],
//   bubbles: [{slug,label,url,x,y,r,cluster,state,change,score,lensColor,inLens,mix}], lens, lenses: [{key,name,color,light,dark}] } | null, topics: [...], since, rising }.
export default `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1c2b2d;--mut:#566a6d;--line:#d6dedb;--grey:#7d8d90;--ac:#b0245f;--btn:#eef2f0}
@media (prefers-color-scheme:dark){:root{--bg:#142224;--fg:#e8eeee;--mut:#9bb0b2;--line:#2c4144;--grey:#8fa4a7;--ac:#ff8fb8;--btn:#1d3033}}
:root[data-theme=light]{color-scheme:light;--bg:#fff;--fg:#1c2b2d;--mut:#566a6d;--line:#d6dedb;--grey:#7d8d90;--ac:#b0245f;--btn:#eef2f0}
:root[data-theme=dark]{color-scheme:dark;--bg:#142224;--fg:#e8eeee;--mut:#9bb0b2;--line:#2c4144;--grey:#8fa4a7;--ac:#ff8fb8;--btn:#1d3033}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
.hide{display:none!important}#app{padding:12px 12px 10px}#s{color:var(--mut);padding:18px 14px}
#bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-bottom:8px}#bar .sp{flex:1}
label{color:var(--mut);font-size:12.5px;display:flex;gap:6px;align-items:center}
select,button{font:inherit;color:var(--fg);background:var(--btn);border:1px solid var(--line);border-radius:7px;padding:3px 10px;cursor:pointer}select{padding:3px 6px}
button:hover,select:hover{border-color:var(--mut)}button[aria-pressed=true]{border-color:var(--ac);color:var(--ac);font-weight:600}button:disabled,select:disabled{opacity:.55;cursor:default}
button:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#wins{display:inline-flex;gap:4px}
#stage{position:relative}svg{display:block;width:100%;height:auto;max-width:100%}
.cl circle{fill:var(--fg);fill-opacity:.04;stroke:var(--line);stroke-width:1.5;stroke-dasharray:5 5}.cl text{fill:var(--mut);font-weight:600;paint-order:stroke;stroke:var(--bg);stroke-width:4px;stroke-linejoin:round}
.b{cursor:pointer;outline:none}.b .dot{stroke-width:2}.b .ring{fill:none;stroke:var(--ac);stroke-width:3}.b .mk{fill:var(--ac);font-weight:700;text-anchor:middle}
.b text.lb{fill:var(--fg);text-anchor:middle;pointer-events:none;font-weight:600}.b text.lb.out{paint-order:stroke;stroke:var(--bg);stroke-width:3px;stroke-linejoin:round}.b text.pc{fill:var(--mut);text-anchor:middle;pointer-events:none}
.b:hover .dot,.b:focus .dot{stroke-width:4}.b:focus .focus{display:block}.focus{display:none;fill:none;stroke:var(--fg);stroke-width:2;stroke-dasharray:2 3}
.b.sel .dot{stroke-width:5}.b .tick{display:none;fill:var(--fg);font-weight:700;text-anchor:middle}.b.sel .tick{display:block}
.pick .b{cursor:copy}.dim{opacity:.55}
#tip{position:absolute;pointer-events:none;max-width:260px;background:var(--bg);color:var(--fg);border:1px solid var(--mut);border-radius:8px;padding:7px 10px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.25);z-index:5}
#tip b{display:block;font-size:14px}#tip span{display:block;color:var(--mut)}#tip .st{color:var(--ac);font-weight:600}
#legend{color:var(--mut);font-size:12.5px;margin:8px 2px 4px}#legend b{color:var(--fg);font-weight:600}.sw{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 3px 0 8px;vertical-align:baseline;border:2px solid}
#note{color:var(--mut);font-size:12.5px;min-height:1.4em;margin:2px}
details{margin-top:4px}summary{cursor:pointer;color:var(--mut);font-size:13px}
ol{margin:6px 0 0;padding-left:0;list-style:none;display:grid;gap:2px}ol li button{display:flex;gap:8px;width:100%;text-align:left;border:0;background:none;padding:3px 4px;border-radius:5px}ol li button:hover{background:var(--btn)}
ol li .n{flex:1}ol li .t{color:var(--ac);font-size:12.5px}ol li .p{color:var(--mut);font-variant-numeric:tabular-nums}
body.full #app{min-height:100vh}
body.hero #bar,body.hero #lbox,body.hero #note:empty{display:none!important}body.hero #app{padding:8px 10px 6px}body.hero svg{height:340px}body.hero #legend{text-align:center;margin:6px 2px 2px}
</style></head><body><div id="s">Reading the landscape…</div><div id="app" class="hide">
<div id="bar"><label>Lens <select id="lens" aria-label="Lens"></select></label><span id="wins" role="group" aria-label="Time window"></span><span class="sp"></span>
<button id="pickb" class="hide" aria-pressed="false" title="Click bubbles to pick them, then ask Claude about them">Pick topics</button><button id="ask" class="hide"></button><button id="fs" class="hide">Fullscreen</button></div>
<div id="stage"><svg id="svg" role="group" aria-label="The landscape of topics"></svg><div id="tip" class="hide" role="status"></div></div>
<p id="legend"></p><p id="note" aria-live="polite"></p>
<details id="lbox"><summary>The topics as a list</summary><ol id="list"></ol></details></div>
<script>
var NS = 'http://www.w3.org/2000/svg', WINS = [[1, 'Today'], [3, '3 days'], [7, '7 days']];
var pending = {}, nextId = 2, host = {}, D = null, L = null, busy = false, theme = '', win = 1, lens = '', area = 'ai', picking = false, sel = {}, ctxTimer = 0, scale = 1, tipFor = '', ox = 0, oy = 0;
// Hero: the picture on the site's landing page (the host says so in hostContext.embed). The page has the lens, the window and the list already, so the view shows only the bubbles, zoomed to fit them.
var hero = false;
function el(id) { return document.getElementById(id); }
function send(m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); }
function request(method, params, ms, done) {
  var id = nextId++, timer = setTimeout(function () { delete pending[id]; done(new Error('no reply from the host')); }, ms || 20000);
  pending[id] = function (m) { clearTimeout(timer); done(m.error ? new Error(m.error.message || 'error') : null, m.result); };
  send({ id: id, method: method, params: params });
}
function reportSize() { send({ method: 'ui/notifications/size-changed', params: { width: Math.ceil(window.innerWidth), height: Math.ceil(el('app').getBoundingClientRect().height) + 2 } }); }
function setTheme(t) { if (t === 'light' || t === 'dark') { theme = t; document.documentElement.setAttribute('data-theme', t); if (L) draw(); } }
function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function sv(tag, attrs, text) { var e = document.createElementNS(NS, tag), k; for (k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; }
function pct(v) { var p = v * 100; return (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10) + '%'; }
function dark() { return theme ? theme === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }

// ---- the data: structuredContent when the host passes it on, else the JSON in the text (what the site gives)
function readResult(res) {
  if (!res) throw new Error('no answer');
  if (res.isError) throw new Error(res.content && res.content[0] ? res.content[0].text : 'the tool failed');
  if (res.structuredContent) return res.structuredContent;
  var t = res.content && res.content[0] ? res.content[0].text : '';
  try { return JSON.parse(t); } catch (e) { throw new Error('this host gave only text, no data for the picture'); }
}
function stateText(b) {
  if (b.state === 'new') return 'new';
  if (b.state === 'rising') return 'rising' + (b.change && b.change >= 1.5 ? ' x' + (Math.round(b.change * 10) / 10) : '');
  if (b.state === 'falling') return 'falling';
  return '';
}
function colorOf(b) {
  if (!b.lensColor) return null;
  var l = L.lenses.filter(function (x) { return x.color === b.lensColor; })[0];
  return l ? (dark() ? l.dark : l.light) : null;
}
function byKey(k) { return L.bubbles.filter(function (b) { return b.slug === k; })[0]; }
function togetherWith(b) {
  if (!b.cluster) return [];
  var c = L.clusters.filter(function (x) { return x.id === b.cluster; })[0];
  return c ? c.members.filter(function (k) { return k !== b.slug; }).map(function (k) { var o = byKey(k); return o ? o.label : k; }) : [];
}

// ---- drawing
function draw() {
  var svg = el('svg'), w = L.w, h = L.h, vx = 0, vy = 0, sc, fs, rect;
  svg.textContent = '';
  if (hero) {   // the box around the bubbles and groups, with room for names, instead of the whole layout
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    L.bubbles.forEach(function (b) { x0 = Math.min(x0, b.x - b.r); y0 = Math.min(y0, b.y - b.r); x1 = Math.max(x1, b.x + b.r); y1 = Math.max(y1, b.y + b.r); });
    L.clusters.forEach(function (c) { x0 = Math.min(x0, c.x - c.r); y0 = Math.min(y0, c.y - c.r); x1 = Math.max(x1, c.x + c.r); y1 = Math.max(y1, c.y + c.r); });
    var pad = Math.max(x1 - x0, y1 - y0) * 0.07 + 4;
    vx = x0 - pad; vy = y0 - pad; w = x1 - x0 + 2 * pad; h = y1 - y0 + 2 * pad;
  }
  svg.setAttribute('viewBox', vx + ' ' + vy + ' ' + w + ' ' + h);
  rect = svg.getBoundingClientRect();
  sc = hero && rect.height ? Math.min((rect.width || 600) / w, rect.height / h) : (rect.width || 600) / w; scale = sc;
  ox = hero ? ((rect.width || 600) - w * sc) / 2 - vx * sc : 0; oy = hero && rect.height ? (rect.height - h * sc) / 2 - vy * sc : 0;
  fs = function (px) { return Math.round(px / sc * 10) / 10; };
  svg.classList.toggle('pick', picking);
  L.clusters.forEach(function (c) {
    var g = sv('g', { 'class': 'cl' });
    g.appendChild(sv('circle', { cx: c.x, cy: c.y, r: c.r }));
    g.appendChild(sv('text', { x: c.x, y: Math.max(vy + fs(13), c.y - c.r - fs(5)), 'text-anchor': 'middle', 'font-size': fs(12.5) }, c.name));
    svg.appendChild(g);
  });
  L.bubbles.slice().sort(function (a, b) { return b.r - a.r; }).forEach(function (b) {
    var col = colorOf(b), g = sv('g', { 'class': 'b' + (sel[b.slug] ? ' sel' : '') + (L.lens && !b.inLens ? ' dim' : ''), tabindex: 0, role: picking ? 'checkbox' : 'link', 'data-k': b.slug }), px = b.r * sc, chars = Math.floor(px * 1.7 / 6.3), name = b.label;
    if (picking) g.setAttribute('aria-checked', sel[b.slug] ? 'true' : 'false');
    g.setAttribute('aria-label', b.label + (stateText(b) ? ', ' + stateText(b) : '') + ', ' + pct(b.score) + ' of items' + (picking ? '. Press Enter to pick or drop it.' : '. Press Enter to open it.'));
    g.appendChild(sv('circle', { 'class': 'focus', cx: b.x, cy: b.y, r: b.r + fs(6) }));
    if (b.state === 'new' || b.state === 'rising') g.appendChild(sv('circle', { 'class': 'ring', cx: b.x, cy: b.y, r: b.r + fs(3.5) }));
    var gid = gradient(svg, col || (dark() ? '#8fa4a7' : '#7d8d90'));
    g.appendChild(sv('circle', { 'class': 'dot', cx: b.x, cy: b.y, r: b.r, fill: 'url(#' + gid + ')', stroke: col || 'var(--grey)' }));
    label(g, b, px, sc, fs, name, chars);
    if (b.state === 'new' || b.state === 'rising' || b.state === 'falling') {
      var a = Math.PI / 4, mx = b.x + Math.cos(a) * (b.r + fs(3.5)), my = b.y - Math.sin(a) * (b.r + fs(3.5));
      g.appendChild(sv('text', { 'class': 'mk', x: mx, y: my + fs(4), 'font-size': fs(16), fill: b.state === 'falling' ? 'var(--mut)' : 'var(--ac)' }, b.state === 'new' ? '\\u2726' : b.state === 'rising' ? '\\u25B2' : '\\u25BC'));
    }
    g.appendChild(sv('text', { 'class': 'tick', x: b.x, y: Math.max(b.y - b.r + fs(16), b.y - fs(2)), 'font-size': fs(15) }, '\\u2713'));
    g.addEventListener('mouseenter', function () { showTip(b); });
    g.addEventListener('mouseleave', hideTip);
    g.addEventListener('focus', function () { showTip(b); });
    g.addEventListener('blur', hideTip);
    g.addEventListener('click', function () { act(b); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(b); } });
    svg.appendChild(g);
  });
  reportSize();
}
var gids = {};
function gradient(svg, color) {
  var id = 'g' + color.replace(/[^a-z0-9]/gi, ''), defs = svg.querySelector('defs');
  if (!defs) { defs = sv('defs', {}); svg.insertBefore(defs, svg.firstChild); }
  if (!svg.querySelector('#' + id)) {
    var rg = sv('radialGradient', { id: id, cx: '35%', cy: '30%', r: '80%' });
    rg.appendChild(sv('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.62 }));
    rg.appendChild(sv('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0.2 }));
    defs.appendChild(rg);
  }
  return id;
}
function wrap(words, perLine) {
  var lines = [], cur = '', i;
  for (i = 0; i < words.length; i++) {
    if (cur && (cur + ' ' + words[i]).length > perLine) { lines.push(cur); cur = words[i]; } else cur = cur ? cur + ' ' + words[i] : words[i];
  }
  if (cur) lines.push(cur);
  return lines;
}
// The name goes inside the bubble, broken over up to three lines, as large as fits; a bubble too small for that has its name beneath it.
function label(g, b, px, sc, fs, name) {
  var f, inner = px * 1.55, perLine, words = name.split(/\\s+/), lines, fits = false;
  // As large as fits, down to 11 px: a long word in a big bubble takes a smaller size instead of going outside.
  for (f = Math.max(11, Math.min(20, px * 0.27)); f >= 11; f -= 1) {
    perLine = Math.max(4, Math.floor(inner / (f * 0.56))); lines = wrap(words, perLine);
    fits = px >= 30 && lines.length <= 3 && lines.every(function (l) { return l.length <= perLine + 2; }) && lines.length * f * 1.15 <= px * 1.7;
    if (fits) break;
  }
  if (!fits) f = 11;
  if (fits) {
    var showPc = px >= 44 && lines.length <= 2, total = lines.length + (showPc ? 0.9 : 0);
    var top = b.y - fs(((total - 1) * f * 1.15) / 2) + fs(f * 0.35);
    lines.forEach(function (l, k) { g.appendChild(sv('text', { 'class': 'lb', x: b.x, y: top + fs(k * f * 1.15), 'font-size': fs(f) }, l)); });
    if (showPc) g.appendChild(sv('text', { 'class': 'pc', x: b.x, y: top + fs(lines.length * f * 1.15 + 1), 'font-size': fs(Math.max(10.5, f * 0.75)) }, pct(b.score)));
  } else if (px >= 10 && !hero) {   // in the hero the hover and the page's ranked list give the name: names under small bubbles would pile up
    g.appendChild(sv('text', { 'class': 'lb out', x: b.x, y: b.y + b.r + fs(14), 'font-size': fs(12) }, name.length > 22 ? name.slice(0, 21) + '\u2026' : name));
  }
}
function showTip(b) {
  var t = el('tip'), w = el('stage').getBoundingClientRect().width, x = ox + b.x * scale, y = oy + b.y * scale, r = b.r * scale, together = togetherWith(b), st = stateText(b);
  t.textContent = '';
  t.appendChild(mk('b', '', b.label));
  if (st) t.appendChild(mk('span', 'st', st.charAt(0).toUpperCase() + st.slice(1)));
  t.appendChild(mk('span', '', pct(b.score) + ' of items' + (L.lens ? (b.inLens ? ', in ' + L.lens.name : ', outside ' + L.lens.name) : '')));
  if (b.mix) t.appendChild(mk('span', '', 'From ' + b.mix));
  if (together.length) t.appendChild(mk('span', '', 'Talked about with ' + together.slice(0, 4).join(', ')));
  t.classList.remove('hide');
  var tw = t.offsetWidth, th = t.offsetHeight, left = Math.min(Math.max(4, x - tw / 2), Math.max(4, w - tw - 4)), top = y - r - th - 8;
  if (top < 2) top = y + r + 8;
  t.style.left = left + 'px'; t.style.top = top + 'px';
}
function hideTip() { el('tip').classList.add('hide'); }

// ---- the page around it
function renderBar() {
  var s = el('lens'), ls = L.lenses || [];
  s.textContent = '';
  var all = mk('option', '', 'All'); all.value = ''; s.appendChild(all);
  ls.forEach(function (l) { var o = mk('option', '', l.name); o.value = l.key; s.appendChild(o); });
  s.value = lens; s.disabled = busy; s.parentNode.classList.toggle('hide', !ls.length);
  var box = el('wins'); box.textContent = '';
  WINS.forEach(function (p) { var b = mk('button', '', p[1]); b.setAttribute('aria-pressed', p[0] === win ? 'true' : 'false'); b.disabled = busy; b.onclick = function () { if (p[0] !== win) { win = p[0]; reload(); } }; box.appendChild(b); });
  var can = !!(host.message || host.updateModelContext) || !Object.keys(host).length;   // a host that lists what it can do and cannot message gets no ask button
  el('pickb').classList.toggle('hide', !can);
  el('pickb').setAttribute('aria-pressed', picking ? 'true' : 'false');
  renderAsk();
}
function chosen() { return L.bubbles.filter(function (b) { return sel[b.slug]; }); }
function renderAsk() {
  var n = chosen().length, b = el('ask');
  b.classList.toggle('hide', !picking);
  b.textContent = n ? 'Ask Claude about these (' + n + ')' : 'Pick topics to ask about';
  b.disabled = !n;
}
function renderLegend() {
  var p = el('legend'), parts = [];
  p.textContent = '';
  if (hero) {   // one short line: the page explains the rest
    p.appendChild(document.createTextNode('Bigger bubble, bigger share \u00B7 \u2726 new \u00B7 \u25B2 rising \u00B7 \u25BC falling'));
    if (!L.lens) (L.lenses || []).forEach(function (l) { var s = mk('span', 'sw'); s.style.borderColor = dark() ? l.dark : l.light; p.appendChild(s); p.appendChild(document.createTextNode(l.name)); });
    return;
  }
  p.appendChild(mk('b', '', 'How to read it. '));
  p.appendChild(document.createTextNode('A bigger bubble is a bigger share of the day\\u2019s items. A ring with \\u2726 is a new topic, a ring with \\u25B2 a rising one, \\u25BC one that is falling. A dashed circle holds topics that are talked about together.'));
  if (L.lens) {
    p.appendChild(document.createTextNode(' Only the topics of ' + L.lens.name + ' are shown, drawn on their own.'));
  } else if ((L.lenses || []).length) {
    p.appendChild(document.createTextNode(' Colour is the lens a topic belongs to:'));
    L.lenses.forEach(function (l) { var s = mk('span', 'sw'); s.style.borderColor = dark() ? l.dark : l.light; p.appendChild(s); p.appendChild(document.createTextNode(l.name)); });
    p.appendChild(document.createTextNode('; grey belongs to none.'));
  }
}
function renderList() {
  var ol = el('list');
  ol.textContent = '';
  L.bubbles.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (b) {
    var li = mk('li'), btn = mk('button'), st = stateText(b);
    btn.appendChild(mk('span', 'n', b.label));
    if (st) btn.appendChild(mk('span', 't', st));
    btn.appendChild(mk('span', 'p', pct(b.score)));
    btn.setAttribute('aria-label', b.label + (st ? ', ' + st : '') + ', ' + pct(b.score) + ' of items');
    btn.onclick = function () { act(b); };
    li.appendChild(btn); ol.appendChild(li);
  });
}
function show(data) {
  D = data; win = D.window || 1; lens = D.lens ? D.lens.key : ''; area = D.area === 'politics' ? 'politics' : 'ai';   // the area decides which lenses the bar offers: they come with the data
  L = D.landscape || null;
  if (!L || !L.bubbles || !L.bubbles.length) {
    el('app').classList.add('hide'); el('s').classList.remove('hide');
    el('s').textContent = 'The landscape is not ready yet: it needs a published Signal with a few topics. The topics themselves are listed in the text answer.';
    reportSize(); return;
  }
  var keep = {}; L.bubbles.forEach(function (b) { if (sel[b.slug]) keep[b.slug] = true; }); sel = keep;
  el('s').classList.add('hide'); el('app').classList.remove('hide');
  renderBar(); renderLegend(); renderList(); draw();
  el('note').textContent = '';
}
function reload() {
  busy = true; renderBar(); el('note').textContent = 'Reading\\u2026';
  var args = { window: win }; if (lens) args.lens = lens; if (area === 'politics') args.area = area;
  request('tools/call', { name: 'get_overview', arguments: args }, 30000, function (err, res) {
    busy = false;
    try { if (err) throw err; show(readResult(res)); } catch (e) { renderBar(); el('note').textContent = 'Could not read it: ' + e.message; }
  });
}
el('lens').onchange = function () { lens = el('lens').value; reload(); };

// ---- clicking, picking, asking
function act(b) {
  if (picking) { if (sel[b.slug]) delete sel[b.slug]; else sel[b.slug] = true; var g = el('svg').querySelector('[data-k="' + b.slug + '"]'); if (g) { g.classList.toggle('sel', !!sel[b.slug]); g.setAttribute('aria-checked', sel[b.slug] ? 'true' : 'false'); } renderAsk(); sendContext(); return; }
  // A view cannot swap itself for another tool's view, so in a host that lets a view message Claude, a click asks Claude to open the topic: it calls get_topic and the Topic hub is drawn in the chat.
  // Where the host cannot message (the site's host lists only openLinks), a click opens the topic page, as before.
  if (host.message) {
    request('ui/message', { role: 'user', content: [{ type: 'text', text: 'Show me the topic ' + b.slug + ' (' + b.label + ') from the Undercurrent landscape.' }] }, 10000, function (err, res) {
      var n = el('note'); n.textContent = '';
      if (err || (res && res.isError)) { n.textContent = 'Could not send that to Claude. '; }
      else n.textContent = 'Asked Claude to open ' + b.label + '. ';
      var o = mk('button', '', 'Open the page instead'); o.onclick = function () { openPage(b); }; n.appendChild(o);
    });
    return;
  }
  openPage(b);
}
function openPage(b) {
  request('ui/open-link', { url: b.url }, 8000, function (err) { if (err) el('note').textContent = 'This host did not open the page. It is at ' + b.url; });
}
function describe(b) {
  var t = togetherWith(b), st = stateText(b);
  return '- ' + b.label + ' (topic ' + b.slug + (st ? ', ' + st : '') + ', ' + pct(b.score) + ' of items' + (b.mix ? ', from ' + b.mix : '') + (t.length ? ', talked about with ' + t.slice(0, 4).join(', ') : '') + ')';
}
function contextText() {
  var list = chosen();
  if (!list.length) return 'In the Undercurrent landscape, no topics are picked.';
  return 'In the Undercurrent landscape (' + (WINS.filter(function (p) { return p[0] === win; })[0][1].toLowerCase()) + (area === 'politics' ? ', politics' : '') + (L.lens ? ', lens ' + L.lens.name : '') + '), the user picked these topics:\\n' + list.map(describe).join('\\n') + '\\nUse get_topic with the topic address' + (area === 'politics' ? ' (area politics)' : '') + ' for the summary and evidence.';
}
function sendContext() {
  clearTimeout(ctxTimer);
  ctxTimer = setTimeout(function () { request('ui/update-model-context', { content: [{ type: 'text', text: contextText() }] }, 8000, function () {}); }, 400);
}
function askClaude() {
  var list = chosen();
  if (!list.length) return;
  var text = 'What is going on with ' + list.map(function (b) { return b.label; }).join(', ') + '? How do these topics relate, and what changed lately?\\n\\n' + contextText();
  request('ui/message', { role: 'user', content: [{ type: 'text', text: text }] }, 10000, function (err, res) { el('note').textContent = err || (res && res.isError) ? 'Could not send that. Ask in the chat instead.' : 'Sent to Claude.'; });
}
el('pickb').onclick = function () { picking = !picking; if (!picking) { sel = {}; sendContext(); } renderBar(); if (L) draw(); };
el('ask').onclick = askClaude;

// ---- sizes and the protocol
function setFull(on) { document.body.classList.toggle('full', on); el('fs').textContent = on ? 'Exit fullscreen' : 'Fullscreen'; if (L) draw(); }
el('fs').onclick = function () { request('ui/request-display-mode', { mode: document.body.classList.contains('full') ? 'inline' : 'fullscreen' }, 8000, function (err, res) { if (!err && res) setFull(res.mode === 'fullscreen'); }); };
var lastW = 0;
window.addEventListener('message', function (e) {
  var m = e.data, fn;
  if (!m) return;
  if (m.id === 1) {
    if (m.error) { el('s').textContent = 'initialize failed: ' + JSON.stringify(m.error); return; }
    var r = m.result || {}, hc = r.hostContext || {};
    host = r.hostCapabilities || {};
    hero = hc.embed === 'hero'; document.body.classList.toggle('hero', hero);
    setTheme(hc.theme);
    send({ method: 'ui/notifications/initialized' });
    reportSize();
    new ResizeObserver(function () { var w = Math.round(el('stage').getBoundingClientRect().width); if (L && w && w !== lastW) { lastW = w; draw(); } else reportSize(); }).observe(document.body);
    if (!hero && (hc.availableDisplayModes || []).indexOf('fullscreen') >= 0) el('fs').classList.remove('hide');
    if (hc.displayMode === 'fullscreen') setFull(true);
  } else if (m.id && pending[m.id]) {
    fn = pending[m.id]; delete pending[m.id]; fn(m);
  } else if (m.method === 'ui/notifications/tool-result') {
    try { show(readResult(m.params)); } catch (err) { el('s').classList.remove('hide'); el('s').textContent = 'Nothing to draw: ' + err.message; }
  } else if (m.method === 'ui/notifications/host-context-changed') {
    if (m.params && m.params.theme) setTheme(m.params.theme);
    if (m.params && m.params.displayMode) setFull(m.params.displayMode === 'fullscreen');
  } else if (m.method === 'ui/resource-teardown') {
    send({ id: m.id, result: {} });
  }
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
send({ id: 1, method: 'ui/initialize', params: { appInfo: { name: 'undercurrent-landscape', version: '0.1.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26' } });
</script></body></html>`;
