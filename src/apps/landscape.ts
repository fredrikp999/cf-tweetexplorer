// The Landscape: one bubble per topic of the Signal, drawn from the layout the server keeps steady from day to day. Size is the topic's score, colour is the lens (grey outside the chosen lens),
// a tag in words on the top edge says new, rising or falling, and a dashed circle with a name groups topics that are talked about together. It is the view of the get_overview tool on both MCP servers and the picture
// on the landing page, in the sandboxed frame of src/site/viz.ts (there /viz/host.js answers get_overview from /overview.json).
// A plain page like first.ts and map.ts: classic inline script, the ui/* postMessage protocol directly, no SDK and no bundler. Keep it free of backticks and template placeholders.
// A click on a bubble: ask Claude to show the topic where the host allows messages (see act), else open its page.
// Data: the structuredContent of get_overview (or its JSON text, which is what the site gives): { window, lens: {key,name}|null, landscape: { w, h, clusters: [{id,name,x,y,r,members}],
//   bubbles: [{slug,label,url,x,y,r,cluster,state,change,score,lensColor,inLens,mix}], lens, lenses: [{key,name,color,light,dark}] } | null, topics: [...], since, rising }.
// ladder: { days, top, span, window, lens, topics: [{slug,label,url,state,lensColor,inLens,rank[],score[],best,first,move}] } | null: the rank of the biggest topics per day (src/signal/ladder.ts),
//   drawn as a second picture (the Ladder button): one line per topic; hover lights a line, a click keeps it lit (up to three), a click on a name opens the topic, Draw it draws it from left to right.
// On the site only (no lens): replay: { today, frames: [{ day, bubbles: [{k,x,y,r,l}] }] }, the layouts of the days before today, for the Replay button.
export default `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1c2b2d;--mut:#566a6d;--line:#d6dedb;--grey:#7d8d90;--ac:#b0245f;--btn:#eef2f0;--halo:rgba(255,255,255,.55)}
@media (prefers-color-scheme:dark){:root{--bg:#142224;--fg:#e8eeee;--mut:#9bb0b2;--line:#2c4144;--grey:#8fa4a7;--ac:#ff8fb8;--btn:#1d3033;--halo:rgba(0,0,0,.25)}}
:root[data-theme=light]{color-scheme:light;--bg:#fff;--fg:#1c2b2d;--mut:#566a6d;--line:#d6dedb;--grey:#7d8d90;--ac:#b0245f;--btn:#eef2f0;--halo:rgba(255,255,255,.55)}
:root[data-theme=dark]{color-scheme:dark;--bg:#142224;--fg:#e8eeee;--mut:#9bb0b2;--line:#2c4144;--grey:#8fa4a7;--ac:#ff8fb8;--btn:#1d3033;--halo:rgba(0,0,0,.25)}
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
.b{cursor:pointer;outline:none}.b .dot{stroke-width:2}
.b .pill rect{fill:var(--ac);stroke:var(--bg);stroke-width:2}.b .pill text{fill:var(--bg);font-weight:800;text-anchor:middle;letter-spacing:.04em;pointer-events:none}
.b .pill.down rect{fill:var(--btn);stroke:var(--line)}.b .pill.down text{fill:var(--mut)}
.b text.lb{fill:var(--fg);text-anchor:middle;pointer-events:none;font-weight:600;paint-order:stroke;stroke:var(--halo);stroke-width:2px;stroke-linejoin:round}.b text.lb.out{stroke:var(--bg);stroke-width:3px}.b text.pc{fill:var(--fg);fill-opacity:.78;text-anchor:middle;pointer-events:none;font-weight:600}
.b:hover .dot,.b:focus .dot{stroke-width:4}.b:focus .focus{display:block}.focus{display:none;fill:none;stroke:var(--fg);stroke-width:2;stroke-dasharray:2 3}
.b.sel .dot{stroke-width:5}.b .tick{display:none;fill:var(--fg);font-weight:700;text-anchor:middle}.b.sel .tick{display:block}
.pick .b{cursor:copy}.dim{opacity:.55}
#tip{position:absolute;pointer-events:none;max-width:260px;background:var(--bg);color:var(--fg);border:1px solid var(--mut);border-radius:8px;padding:7px 10px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.25);z-index:5}
#tip b{display:block;font-size:14px}#tip span{display:block;color:var(--mut)}#tip .st{color:var(--ac);font-weight:600}
#legend{color:var(--mut);font-size:12.5px;margin:8px 2px 4px}#legend b{color:var(--fg);font-weight:600}.sw{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 3px 0 8px;vertical-align:baseline;border:2px solid}
.key{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 14px}.key+.key{margin-top:4px}.it{white-space:nowrap;display:inline-flex;align-items:center;gap:5px}.it .sw{margin:0}
.kp{display:inline-block;background:var(--ac);color:var(--bg);font-size:10px;font-weight:800;letter-spacing:.04em;border-radius:9px;padding:1px 7px}.kp.down{background:var(--btn);color:var(--mut);border:1px solid var(--line)}
#note{color:var(--mut);font-size:12.5px;min-height:1.4em;margin:2px}
details{margin-top:4px}summary{cursor:pointer;color:var(--mut);font-size:13px}
ol{margin:6px 0 0;padding-left:0;list-style:none;display:grid;gap:2px}ol li button{display:flex;gap:8px;width:100%;text-align:left;border:0;background:none;padding:3px 4px;border-radius:5px}ol li button:hover{background:var(--btn)}
ol li .n{flex:1}ol li .t{color:var(--ac);font-size:12.5px}ol li .p{color:var(--mut);font-variant-numeric:tabular-nums}
#rp{position:absolute;left:8px;bottom:8px;display:flex;gap:10px;align-items:center;z-index:4}#rp button{background:var(--bg);box-shadow:0 1px 8px rgba(0,0,0,.22);font-weight:700;border-color:var(--ac);color:var(--ac)}
#rdots{display:inline-flex;gap:4px}#rdots i{width:7px;height:7px;border-radius:50%;background:var(--line)}#rdots i.on{background:var(--ac)}
#rday{position:absolute;left:8px;top:6px;z-index:4;font-weight:800;font-size:15px;color:var(--fg);background:var(--halo);padding:2px 12px;border-radius:999px;pointer-events:none;backdrop-filter:blur(3px)}
.rb text.lb{pointer-events:none}
.glow{fill:none;stroke:var(--ac);stroke-width:3;stroke-opacity:.55;stroke-dasharray:none;animation:glow 2.2s ease-out 3}@keyframes glow{0%{stroke-opacity:1;stroke-width:5}100%{stroke-opacity:.35;stroke-width:2}}
@media (prefers-reduced-motion:reduce){.glow{animation:none}}
#since{position:absolute;right:8px;top:6px;z-index:4;font-size:12.5px;font-weight:700;color:var(--fg);background:var(--halo);border:1px solid var(--ac);padding:2px 10px;border-radius:999px;pointer-events:none;backdrop-filter:blur(3px)}
.lad{cursor:pointer;outline:none;transition:opacity .15s}.lad path.ln{fill:none;stroke-linecap:round;stroke-linejoin:round}.lad path.hit{fill:none;stroke:transparent;pointer-events:stroke}.lad text{fill:var(--fg);cursor:pointer}.lad.grey text{fill:var(--mut)}.lad.pin text{font-weight:700}.lad:focus-visible path.ln{stroke-dasharray:1 0;filter:drop-shadow(0 0 3px var(--ac))}.lad text:focus-visible{outline:2px solid var(--ac)}
.lgrid line{stroke:var(--line);stroke-opacity:.7}.lgrid text{fill:var(--mut)}
#modes{display:inline-flex;gap:4px}
body.full #app{min-height:100vh}
body.hero #bar,body.hero #lbox,body.hero #note:empty{display:none!important}body.hero #app{padding:8px 10px 6px}body.hero svg{height:340px}body.hero #legend{text-align:center;margin:6px 2px 2px}
</style></head><body><div id="s">Reading the landscape…</div><div id="app" class="hide">
<div id="bar"><label>Lens <select id="lens" aria-label="Lens"></select></label><span id="modes" class="hide" role="group" aria-label="Picture"></span><span id="wins" role="group" aria-label="Time window"></span><button id="ldraw" class="hide" type="button">▶ Draw it</button><span class="sp"></span>
<button id="pickb" class="hide" aria-pressed="false" title="Click bubbles to pick them, then ask Claude about them">Pick topics</button><button id="ask" class="hide"></button><button id="fs" class="hide">Fullscreen</button></div>
<div id="stage"><svg id="svg" role="group" aria-label="The landscape of topics"></svg><div id="tip" class="hide" role="status"></div><div id="rday" class="hide" aria-live="polite"></div><div id="since" class="hide"></div><div id="rp" class="hide"><button id="play" type="button"></button><span id="rdots" aria-hidden="true"></span></div></div>
<p id="legend"></p><p id="note" aria-live="polite"></p>
<details id="lbox"><summary>The topics as a list</summary><ol id="list"></ol></details></div>
<script>
var NS = 'http://www.w3.org/2000/svg', WINS = [[1, 'Today'], [3, '3 days'], [7, '7 days']];
var pending = {}, nextId = 2, host = {}, D = null, L = null, busy = false, theme = '', win = 1, lens = '', area = 'ai', picking = false, sel = {}, ctxTimer = 0, scale = 1, tipFor = '', ox = 0, oy = 0;
// Hero: the picture on the site's landing page (the host says so in hostContext.embed). The page has the lens, the window and the list already, so the view shows only the bubbles, zoomed to fit them.
var hero = false, lastVisit = 0, fresh = {};
// The second picture: the Ladder (D.ladder). pins: the lines kept lit; ladT: how much of it is drawn (1: all).
var mode = 'map', pins = {}, ladHot = '', ladT = 1, ladRaf = 0;
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
  if (mode === 'ladder' && D && D.ladder) { drawLadder(); return; }
  if (playing) { drawReplay(rT); return; }
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
  var tags = sv('g', { 'class': 'b', 'pointer-events': 'none', 'aria-hidden': 'true' });   // the new/rising/falling tags, over every bubble
  L.clusters.forEach(function (c) {
    var g = sv('g', { 'class': 'cl' });
    g.appendChild(sv('circle', { cx: c.x, cy: c.y, r: c.r }));
    g.appendChild(sv('text', { x: c.x, y: Math.max(vy + fs(13), c.y - c.r - fs(5)), 'text-anchor': 'middle', 'font-size': fs(12.5) }, c.name));
    svg.appendChild(g);
  });
  L.bubbles.slice().sort(function (a, b) { return b.r - a.r; }).forEach(function (b) {
    var col = colorOf(b), g = sv('g', { 'class': 'b' + (sel[b.slug] ? ' sel' : '') + (L.lens && !b.inLens ? ' dim' : ''), tabindex: 0, role: picking ? 'checkbox' : 'link', 'data-k': b.slug }), px = b.r * sc, chars = Math.floor(px * 1.7 / 6.3), name = b.label;
    if (picking) g.setAttribute('aria-checked', sel[b.slug] ? 'true' : 'false');
    g.setAttribute('aria-label', b.label + (fresh[b.slug] ? ', new since your last visit' : '') + (stateText(b) ? ', ' + stateText(b) : '') + ', ' + pct(b.score) + ' of items' + (picking ? '. Press Enter to pick or drop it.' : '. Press Enter to open it.'));
    g.appendChild(sv('circle', { 'class': 'focus', cx: b.x, cy: b.y, r: b.r + fs(6) }));
    if (fresh[b.slug] && !picking) g.appendChild(sv('circle', { 'class': 'glow', cx: b.x, cy: b.y, r: b.r + fs(5) }));
    var gid = gradient(svg, col || (dark() ? '#8fa4a7' : '#7d8d90'));
    g.appendChild(sv('circle', { 'class': 'dot', cx: b.x, cy: b.y, r: b.r, fill: 'url(#' + gid + ')', stroke: col || 'var(--grey)' }));
    label(g, b, px, sc, fs, name, chars);
    pill(tags, b, fs);
    g.appendChild(sv('text', { 'class': 'tick', x: b.x, y: Math.max(b.y - b.r + fs(26), b.y - fs(2)), 'font-size': fs(15) }, '\\u2713'));
    g.addEventListener('mouseenter', function () { showTip(b); });
    g.addEventListener('mouseleave', hideTip);
    g.addEventListener('focus', function () { showTip(b); });
    g.addEventListener('blur', hideTip);
    g.addEventListener('click', function () { act(b); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(b); } });
    svg.appendChild(g);
  });
  svg.appendChild(tags);
  reportSize();
}
// New, rising or falling: a small filled tag in words on the bubble's top edge, readable at a glance, instead of a ring with a glyph on it.
function pillText(b) {
  if (b.state === 'new') return 'NEW';
  if (b.state === 'rising') return '\\u25B2 ' + (b.change && b.change >= 1.5 ? '\\u00D7' + (Math.round(b.change * 10) / 10) : 'RISING');
  if (b.state === 'falling') return '\\u25BC FALLING';
  return '';
}
function pill(g, b, fs) {
  var t = pillText(b);
  if (!t) return;
  var f = 11, w = t.length * f * 0.68 + 14, h = f + 8, p = sv('g', { 'class': 'pill' + (b.state === 'falling' ? ' down' : '') });
  p.appendChild(sv('rect', { x: b.x - fs(w / 2), y: b.y - b.r - fs(h / 2), width: fs(w), height: fs(h), rx: fs(h / 2) }));
  p.appendChild(sv('text', { x: b.x, y: b.y - b.r + fs(f * 0.36), 'font-size': fs(f) }, t));
  g.appendChild(p);
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
  var f, inner = px * 1.55, perLine, words = name.split(/\\s+/), lines, fits = false, least = hero ? 10 : 11;
  // As large as fits, down to 11 px (10 in the hero): a long word in a big bubble takes a smaller size instead of going outside.
  for (f = Math.max(least, Math.min(20, px * 0.27)); f >= least; f -= 1) {
    perLine = Math.max(4, Math.floor(inner / (f * 0.56))); lines = wrap(words, perLine);
    fits = px >= 26 && lines.length <= 3 && lines.every(function (l) { return l.length <= perLine + 2; }) && lines.length * f * 1.15 <= px * 1.7;
    if (fits) break;
  }
  if (!fits && hero && px >= 22) {   // the hero has no names under bubbles, so a name that does not fit is cut short inside rather than left out
    f = least; perLine = Math.max(4, Math.floor(inner / (f * 0.56)));
    var all = wrap(words, perLine);
    lines = all.slice(0, 3).map(function (l) { return l.length > perLine + 1 ? l.slice(0, perLine) + '\\u2026' : l; });
    if (all.length > 3) lines[2] = lines[2].replace(/\\u2026$/, '') + '\\u2026';
    fits = true;
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

// ---- the replay: the layouts kept for the days before today (D.replay, only on the site's frame and with no lens), played one after another and ending on today's picture.
// Bubbles move, grow, shrink and fade between days. Nothing moves until the button is pressed; with reduced motion the days are shown one by one, without the moves in between.
var RF = null, playing = false, rT = 0, rRaf = 0, rLast = 0, rTimer = 0, STEP_MS = 1500;
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
function dayText(iso) { var d = new Date(iso + 'T12:00:00Z'); return isNaN(d) ? iso : WDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
function setupReplay() {
  RF = null;
  var r = D && D.replay, frames = r && r.frames ? r.frames : [];
  if (L && !L.lens && frames.length) {
    RF = frames.slice(-7).map(function (f) { var m = {}; (f.bubbles || []).forEach(function (b) { m[b.k] = b; }); return { day: f.day, m: m }; });
    var now = {}; L.bubbles.forEach(function (b) { now[b.slug] = { k: b.slug, x: b.x, y: b.y, r: b.r, l: b.label }; });
    RF.push({ day: r.today, m: now, today: true });
  }
  el('rp').classList.toggle('hide', !RF);
  el('rday').classList.add('hide');
  renderPlay();
}
function renderPlay() {
  if (!RF) return;
  var b = el('play'), n = RF.length, mid = rT > 0 && rT < n - 1;
  b.textContent = playing ? '❚❚ Pause' : mid ? '▶ Go on' : '▶ Replay ' + n + ' days';
  b.setAttribute('aria-label', playing ? 'Pause the replay' : 'Replay how the landscape changed over the last ' + n + ' days, ending today');
  var dots = el('rdots'); dots.textContent = '';
  RF.forEach(function (f, i) { dots.appendChild(mk('i', (playing || mid) && i <= Math.floor(rT + 0.5) ? 'on' : '')); });
}
function startReplay() {
  if (!RF) return;
  if (rT >= RF.length - 1) rT = 0;
  playing = true; hideTip(); rLast = 0;
  el('rday').classList.remove('hide'); el('since').classList.add('hide');
  renderPlay(); drawReplay(rT);
  if (reduced()) rTimer = setInterval(function () { rT = Math.floor(rT) + 1; if (rT >= RF.length - 1) endReplay(); else { drawReplay(rT); renderPlay(); } }, 1100);
  else rRaf = requestAnimationFrame(tick);
}
function stopReplay() { playing = false; cancelAnimationFrame(rRaf); clearInterval(rTimer); }
function endReplay() {
  stopReplay(); rT = RF.length - 1;
  el('rday').textContent = dayText(RF[RF.length - 1].day) + ' · today';
  setTimeout(function () { if (!playing) el('rday').classList.add('hide'); }, 1600);
  draw(); renderPlay(); sinceLast();
}
function tick(ts) {
  if (!playing) return;
  if (!rLast) rLast = ts;
  rT += Math.min(100, ts - rLast) / STEP_MS; rLast = ts;
  if (rT >= RF.length - 1) { endReplay(); return; }
  drawReplay(rT);
  if (Math.floor(rT * 4) !== Math.floor((rT - 0.02) * 4)) renderPlay();
  rRaf = requestAnimationFrame(tick);
}
function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
/** The box around a set of discs, with room for names, as the hero draws it. */
function boxOf(list) {
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  list.forEach(function (b) { x0 = Math.min(x0, b.x - b.r); y0 = Math.min(y0, b.y - b.r); x1 = Math.max(x1, b.x + b.r); y1 = Math.max(y1, b.y + b.r); });
  var pad = Math.max(x1 - x0, y1 - y0) * 0.07 + 4;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}
function drawReplay(t) {
  var n = RF.length, i = Math.min(n - 1, Math.floor(t)), j = Math.min(n - 1, i + 1), f = t - i, e = f < 0.25 ? 0 : f > 0.9 ? 1 : ease((f - 0.25) / 0.65);
  var A = RF[i].m, B = RF[j].m, keys = {}, k, list = [];
  for (k in A) keys[k] = 1;
  for (k in B) keys[k] = 1;
  for (k in keys) {
    var a = A[k], b = B[k], o;
    if (a && b) o = { k: k, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, r: a.r + (b.r - a.r) * e, l: b.l || a.l, op: 1 };
    else if (a) o = { k: k, x: a.x, y: a.y, r: a.r * (1 - e), l: a.l, op: 1 - e };
    else o = { k: k, x: b.x, y: b.y, r: b.r * e, l: b.l, op: e };
    if (o.r > 0.5) list.push(o);
  }
  var svg = el('svg'), vb, rect, sc, fs;
  svg.textContent = '';
  if (hero) {   // the box around every day's bubbles, closing in on today's box over the last step, so the picture lands where the still one is
    var all = []; RF.forEach(function (fr) { for (var q in fr.m) all.push(fr.m[q]); });
    var u = boxOf(all), td = boxOf(L.bubbles.concat(L.clusters)), z = i >= n - 2 ? e : 0;
    vb = { x: u.x + (td.x - u.x) * z, y: u.y + (td.y - u.y) * z, w: u.w + (td.w - u.w) * z, h: u.h + (td.h - u.h) * z };
  } else vb = { x: 0, y: 0, w: L.w, h: L.h };
  svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  rect = svg.getBoundingClientRect();
  sc = hero && rect.height ? Math.min((rect.width || 600) / vb.w, rect.height / vb.h) : (rect.width || 600) / vb.w;
  fs = function (px) { return Math.round(px / sc * 10) / 10; };
  list.sort(function (p, q) { return q.r - p.r; }).forEach(function (o) {
    var cur = byKey(o.k), col = cur ? colorOf(cur) : null, g = sv('g', { 'class': 'b rb', opacity: Math.max(0, Math.min(1, o.op)).toFixed(3) }), gid = gradient(svg, col || (dark() ? '#8fa4a7' : '#7d8d90'));
    g.appendChild(sv('circle', { 'class': 'dot', cx: o.x, cy: o.y, r: o.r, fill: 'url(#' + gid + ')', stroke: col || 'var(--grey)' }));
    if (o.r * sc >= 22) label(g, o, o.r * sc, sc, fs, o.l || o.k);
    svg.appendChild(g);
  });
  var d = RF[e >= 0.5 ? j : i];
  el('rday').textContent = dayText(d.day) + (d.today ? ' · today' : '');
}
el('play').onclick = function () { if (playing) { stopReplay(); renderPlay(); } else startReplay(); };

// ---- since the last visit: the site's host passes when the reader was last here (hostContext.lastVisit, kept by the page in the browser). With the kept layouts of D.replay,
// a topic that is in today's picture but not in the layout of that day gets a ring, and a tag says how many. Nothing is stored or sent: it is worked out here.
function sinceLast() {
  fresh = {};
  var tag = el('since'), frames = D && D.replay && D.replay.frames ? D.replay.frames : [], n = 0;
  tag.classList.add('hide');
  if (!lastVisit || !L || L.lens || !frames.length) return;
  var day = new Date(lastVisit).toISOString().slice(0, 10), then = null;
  frames.forEach(function (f) { if (f.day <= day) then = f; });
  if (!then) return;
  var had = {}; then.bubbles.forEach(function (b) { had[b.k] = 1; });
  L.bubbles.forEach(function (b) { if (!had[b.slug]) { fresh[b.slug] = true; n++; } });
  if (!n) return;
  tag.textContent = 'Since ' + dayText(then.day) + ': ' + n + ' new ' + (n === 1 ? 'topic' : 'topics') + ' (ringed)';
  tag.classList.remove('hide');
}
// ---- the Ladder: the rank of the biggest topics on each day, one line per topic. Without a lens the ten highest today have a colour each; with one, its topics take its colour and the rest are grey.
var LAD_COLORS = ['#1f7a8c', '#d6336c', '#e3a008', '#7c5cbf', '#2f9e6b', '#c2410c', '#4263eb', '#74b816', '#ae3ec9', '#99582a'];
function pinned() { return D && D.ladder ? D.ladder.topics.filter(function (t) { return pins[t.slug]; }) : []; }
function ladColor(t) {
  var A = D.ladder, now = t.rank[t.rank.length - 1], l;
  if (A.lens) { l = t.inLens && t.lensColor ? (L.lenses || []).filter(function (x) { return x.color === t.lensColor; })[0] : null; return l ? (dark() ? l.dark : l.light) : null; }
  return now && now <= LAD_COLORS.length ? LAD_COLORS[now - 1] : null;
}
function ladLight() {
  var any = !!ladHot || pinned().length > 0;
  Array.prototype.forEach.call(el('svg').querySelectorAll('.lad'), function (g) { var k = g.getAttribute('data-k'), on = !any || k === ladHot || pins[k]; g.setAttribute('opacity', on ? '1' : '.16'); g.classList.toggle('pin', !!pins[k]); g.setAttribute('aria-pressed', pins[k] ? 'true' : 'false'); });
}
function togglePin(t) {
  if (pins[t.slug]) delete pins[t.slug];
  else if (pinned().length >= 3) { el('note').textContent = 'Three lines are kept lit already: click one of them to let it go.'; return; }
  else pins[t.slug] = true;
  el('note').textContent = ''; ladLight(); renderAsk(); sendContext();
}
function ladTip(t, x, y) {
  var tip = el('tip'), w = el('stage').getBoundingClientRect().width, now = t.rank[t.rank.length - 1];
  tip.textContent = '';
  tip.appendChild(mk('b', '', t.label));
  tip.appendChild(mk('span', 'st', (now ? 'Number ' + now + ' today' : 'Not on the ladder today') + ' · ' + t.move));
  tip.appendChild(mk('span', '', 'Best place: ' + t.best + (now ? ' · ' + pct(t.score[t.score.length - 1]) + ' of items now' : '')));
  tip.appendChild(mk('span', '', pins[t.slug] ? 'Click to let it go.' : 'Click to keep it lit.'));
  tip.classList.remove('hide');
  var tw = tip.offsetWidth, th = tip.offsetHeight, top = y * scale - th - 12;
  tip.style.left = Math.min(Math.max(4, x * scale - tw / 2), Math.max(4, w - tw - 4)) + 'px'; tip.style.top = (top < 2 ? y * scale + 14 : top) + 'px';
}
function drawLadder() {
  var A = D.ladder, svg = el('svg'), S = A.days.length, last = S - 1, rows = 1, W = 1000, Lm, top = 14, rect, sc, fs, R, rowH, H;
  A.topics.forEach(function (t) { t.rank.forEach(function (r) { if (r && r > rows) rows = r; }); });
  svg.textContent = '';
  rect = svg.getBoundingClientRect(); sc = (rect.width || 600) / W; scale = sc; ox = 0; oy = 0;
  fs = function (px) { return Math.round(px / sc * 10) / 10; };
  Lm = fs(26); R = Math.min(W * 0.45, fs(200)); rowH = Math.max(24, fs(21)); H = top + rows * rowH + fs(26);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  var x = function (i) { return Lm + (S > 1 ? i / (S - 1) : 0.5) * (W - Lm - R); }, y = function (r) { return top + (r - 0.5) * rowH; }, i;
  var grid = sv('g', { 'class': 'lgrid', 'aria-hidden': 'true' });
  for (i = 0; i < S; i++) grid.appendChild(sv('line', { x1: x(i), x2: x(i), y1: top, y2: top + rows * rowH }));
  for (i = 1; i <= rows; i++) grid.appendChild(sv('text', { x: Lm - fs(9), y: y(i) + fs(4), 'text-anchor': 'end', 'font-size': fs(11.5) }, String(i)));
  [0, Math.floor(last / 2), last].forEach(function (d, j) { grid.appendChild(sv('text', { x: x(d), y: H - fs(7), 'text-anchor': j === 0 ? 'start' : 'middle', 'font-size': fs(11.5) }, dayText(A.days[d]) + (d === last ? ' · today' : ''))); });
  svg.appendChild(grid);
  if (ladT < 1) { var defs = sv('defs', {}), cp = sv('clipPath', { id: 'lclip' }); cp.appendChild(sv('rect', { x: 0, y: 0, width: Lm + ladT * (W - Lm - R) + fs(6), height: H })); defs.appendChild(cp); svg.appendChild(defs); }
  var lines = sv('g', ladT < 1 ? { 'clip-path': 'url(#lclip)' } : {});
  svg.appendChild(lines);
  A.topics.map(function (t) { return { t: t, c: ladColor(t) }; }).sort(function (a, b) { return Number(!b.c) - Number(!a.c); }).forEach(function (o) {
    var t = o.t, col = o.c || 'var(--grey)', now = t.rank[last], d = '', endI = -1, g = sv('g', { 'class': 'lad' + (o.c ? '' : ' grey'), 'data-k': t.slug, tabindex: 0, role: 'button' });
    g.setAttribute('aria-label', t.label + ': ' + (now ? 'number ' + now + ' today' : 'not on the ladder today') + ', ' + t.move + '. Press Enter to keep its line lit.');
    var dots = [];
    t.rank.forEach(function (r, k) {
      if (r === null || r === undefined) return;
      var before = k > 0 ? t.rank[k - 1] : null, mx;
      if (before === null || before === undefined) d += 'M' + x(k) + ' ' + y(r);
      else { mx = (x(k - 1) + x(k)) / 2; d += 'C' + mx + ' ' + y(before) + ' ' + mx + ' ' + y(r) + ' ' + x(k) + ' ' + y(r); }
      dots.push(before === null && k > 0 ? sv('circle', { cx: x(k), cy: y(r), r: fs(4.2), fill: 'var(--bg)', stroke: col, 'stroke-width': fs(2) }) : sv('circle', { cx: x(k), cy: y(r), r: fs(k === last ? 4.2 : 2.4), fill: col }));
      endI = k;
    });
    g.appendChild(sv('path', { 'class': 'hit', d: d, 'stroke-width': fs(14) }));
    g.appendChild(sv('path', { 'class': 'ln', d: d, stroke: col, 'stroke-width': fs(o.c ? 3.2 : 1.6), 'stroke-opacity': o.c ? 1 : 0.65 }));
    dots.forEach(function (c) { g.appendChild(c); });
    var tipAt = function () { if (endI >= 0) ladTip(t, x(endI), y(t.rank[endI])); };
    g.addEventListener('mouseenter', function () { ladHot = t.slug; ladLight(); tipAt(); });
    g.addEventListener('mouseleave', function () { if (ladHot === t.slug) ladHot = ''; ladLight(); hideTip(); });
    g.addEventListener('focus', function () { ladHot = t.slug; ladLight(); tipAt(); });
    g.addEventListener('blur', function () { if (ladHot === t.slug) ladHot = ''; ladLight(); hideTip(); });
    g.addEventListener('click', function () { togglePin(t); tipAt(); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePin(t); } });
    lines.appendChild(g);
    if (now && ladT >= 1) {   // the name at the end of the line opens the topic
      var chars = Math.max(6, Math.floor((R - fs(18)) * sc / 6.6)), nm = sv('text', { x: W - R + fs(13), y: y(now) + fs(4.5), 'font-size': fs(12.5), tabindex: 0, role: 'link' }, t.label.length > chars ? t.label.slice(0, chars - 1) + '…' : t.label);
      nm.setAttribute('aria-label', 'Open ' + t.label);
      nm.addEventListener('click', function (e) { e.stopPropagation(); act(t); });
      nm.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); act(t); } });
      g.appendChild(nm);
    }
  });
  ladLight();
  if (ladT >= 1) reportSize();
}
el('ldraw').onclick = function () {
  if (mode !== 'ladder' || reduced()) return;
  cancelAnimationFrame(ladRaf); hideTip();
  var t0 = 0, step = function (ts) { if (!t0) t0 = ts; ladT = Math.min(1, (ts - t0) / 2600); if (mode === 'ladder') draw(); if (ladT < 1) ladRaf = requestAnimationFrame(step); };
  ladT = 0; ladRaf = requestAnimationFrame(step);
};
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
  var hasLad = !hero && !!(D.ladder && D.ladder.topics && D.ladder.topics.length), m = el('modes'), lad = mode === 'ladder';
  m.textContent = ''; m.classList.toggle('hide', !hasLad);
  [['map', 'Landscape'], ['ladder', 'Ladder']].forEach(function (p) { var b = mk('button', '', p[1]); b.setAttribute('aria-pressed', p[0] === mode ? 'true' : 'false'); b.title = p[0] === 'map' ? 'The topics of the window as bubbles' : 'The rank of the biggest topics on each of the last days'; b.onclick = function () { setMode(p[0]); }; m.appendChild(b); });
  el('wins').classList.toggle('hide', lad); el('ldraw').classList.toggle('hide', !lad || reduced());
  if (lad) el('pickb').classList.add('hide');
  renderAsk();
}
function setMode(m) {
  if (m === mode) return;
  mode = m; picking = false; sel = {}; stopReplay(); rT = 0; cancelAnimationFrame(ladRaf); ladT = 1; hideTip();
  renderBar(); renderLegend();
  if (m === 'map') { sinceLast(); draw(); setupReplay(); } else { el('since').classList.add('hide'); el('rday').classList.add('hide'); el('rp').classList.add('hide'); draw(); }
  el('note').textContent = ''; sendContext();
}
function chosen() { return L.bubbles.filter(function (b) { return sel[b.slug]; }); }
function renderAsk() {
  var n = chosen().length, b = el('ask');
  if (mode === 'ladder') {   // in the Ladder the pinned lines are what is asked about
    n = pinned().length; b.classList.toggle('hide', !n || !(host.message || !Object.keys(host).length)); b.textContent = 'Ask Claude about these (' + n + ')'; b.disabled = !n; return;
  }
  b.classList.toggle('hide', !picking);
  b.textContent = n ? 'Ask Claude about these (' + n + ')' : 'Pick topics to ask about';
  b.disabled = !n;
}
function renderLegend() {
  var p = el('legend'), parts = [];
  p.textContent = '';
  if (mode === 'ladder' && D.ladder) {
    p.appendChild(mk('b', '', 'How to read it. '));
    p.appendChild(document.createTextNode('Each line is a topic and its place in the order on each day, among the ' + D.ladder.top + ' biggest; a ring is where it came onto the ladder. The order is by the Signal score of the ' + D.ladder.window + ' days to each day, balanced between the groups of sources: order, not volume. Hover a line to light it, click it to keep it lit (up to three), click a name to open the topic.'));
    return;
  }
  if (hero) {   // a short key: the page explains the rest. The tags as they look on the bubbles, then the lens colours, each colour kept on one line with its name
    var k1 = mk('div', 'key'), it = function (box, node, text) { var s = mk('span', 'it'); s.appendChild(node); s.appendChild(document.createTextNode(text)); box.appendChild(s); };
    k1.appendChild(mk('span', 'it', 'Bigger bubble, bigger share'));
    it(k1, mk('span', 'kp', 'NEW'), 'new topic');
    it(k1, mk('span', 'kp', '\\u25B2 \\u00D72'), 'rising, and how fast');
    it(k1, mk('span', 'kp down', '\\u25BC'), 'falling');
    p.appendChild(k1);
    if (!L.lens && (L.lenses || []).length) {
      var k2 = mk('div', 'key');
      L.lenses.forEach(function (l) { var s = mk('span', 'sw'); s.style.borderColor = dark() ? l.dark : l.light; s.style.background = dark() ? l.dark : l.light; it(k2, s, l.name); });
      p.appendChild(k2);
    }
    return;
  }
  p.appendChild(mk('b', '', 'How to read it. '));
  p.appendChild(document.createTextNode('A bigger bubble is a bigger share of the day\\u2019s items. A tag on the top edge says NEW for a new topic, \\u25B2 for a rising one (with how many times its share grew), \\u25BC FALLING for one that is falling. A dashed circle holds topics that are talked about together.'));
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
  if (!D.ladder || !D.ladder.topics || hero) mode = 'map';
  var kp = {}; if (D.ladder) D.ladder.topics.forEach(function (t) { if (pins[t.slug]) kp[t.slug] = true; }); pins = kp; cancelAnimationFrame(ladRaf); ladT = 1;
  el('s').classList.add('hide'); el('app').classList.remove('hide');
  stopReplay(); rT = 0; sinceLast();
  renderBar(); renderLegend(); renderList(); draw(); setupReplay();
  if (mode === 'ladder') { el('rp').classList.add('hide'); el('since').classList.add('hide'); }
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
  if (mode === 'ladder' && D.ladder) {
    var pl = pinned();
    if (!pl.length) return 'In the Undercurrent ladder (rank of topics per day), no lines are pinned.';
    return 'In the Undercurrent ladder (the rank of the biggest topics on each of ' + D.ladder.days.length + ' days, by Signal score: order, not volume' + (area === 'politics' ? ', politics' : '') + '), the user pinned these topics:\\n' + pl.map(function (t) { var now = t.rank[t.rank.length - 1]; return '- ' + t.label + ' (topic ' + t.slug + ', ' + (now ? 'number ' + now + ' today' : 'not on the ladder today') + ', ' + t.move + ', best ' + t.best + ')'; }).join('\\n') + '\\nUse get_topic with the topic address' + (area === 'politics' ? ' (area politics)' : '') + ' for the summary and evidence.';
  }
  var list = chosen();
  if (!list.length) return 'In the Undercurrent landscape, no topics are picked.';
  return 'In the Undercurrent landscape (' + (WINS.filter(function (p) { return p[0] === win; })[0][1].toLowerCase()) + (area === 'politics' ? ', politics' : '') + (L.lens ? ', lens ' + L.lens.name : '') + '), the user picked these topics:\\n' + list.map(describe).join('\\n') + '\\nUse get_topic with the topic address' + (area === 'politics' ? ' (area politics)' : '') + ' for the summary and evidence.';
}
function sendContext() {
  clearTimeout(ctxTimer);
  ctxTimer = setTimeout(function () { request('ui/update-model-context', { content: [{ type: 'text', text: contextText() }] }, 8000, function () {}); }, 400);
}
function askClaude() {
  if (mode === 'ladder') {
    var pl = pinned(); if (!pl.length) return;
    request('ui/message', { role: 'user', content: [{ type: 'text', text: 'Why did ' + pl.map(function (t) { return t.label; }).join(', ') + ' move the way ' + (pl.length === 1 ? 'it' : 'they') + ' did in the ladder?\\n\\n' + contextText() }] }, 10000, function (err, res) { el('note').textContent = err || (res && res.isError) ? 'Could not send that. Ask in the chat instead.' : 'Sent to Claude.'; });
    return;
  }
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
    lastVisit = Number(hc.lastVisit) || 0;
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
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideTip(); if (playing) { stopReplay(); rT = 0; el('rday').classList.add('hide'); draw(); renderPlay(); sinceLast(); } } });
send({ id: 1, method: 'ui/initialize', params: { appInfo: { name: 'undercurrent-landscape', version: '0.1.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26' } });
</script></body></html>`;
