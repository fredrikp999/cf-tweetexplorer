import { SHELL_CSS, SHELL_JS } from './shell.ts';
// The Topic hub: one topic of the Signal as a small workspace, the view of the get_topic tool on both MCP servers (the site's topic page /t/<slug> stays plain server-rendered HTML).
// Header with the state, the written summary, the evidence per kind of source (each in its own unit, never added together) and a sparkline; tabs for the angles (Talk, Who said it first, Papers, Watch,
// Briefings, the order of INTENT.md; the list TABS and the map PANES are where an angle is added); related topics at the foot that switch the view to that topic. Talk pages through get_topic_items with tools/call (kind, sort, cursor).
// Every original opens with ui/open-link. Items, papers and related topics can be ticked: the ticks go to Claude's context (ui/update-model-context) and "Ask Claude about these" sends ui/message.
// A plain page like landscape.ts: classic inline script, the ui/* postMessage protocol directly, no SDK and no bundler. Keep it free of backticks; the only template placeholders are the shell's two (see shell.ts).
// Data: the structuredContent of get_topic (shape in docs/mcp.md): { slug, label, url, state, change, signal, window, period, summary, fallback, evidence: [{kind,label,count,lines,names?}], series: {days,counts,usual},
//   talk, papers: {matched,mentioned,list,thanks}, briefings, related: [{slug,label,url}], sourcesShown, first: {sentence,caveat,openEnded,thin,order:[{kind,label,at,afterText,items,first?:{title,url,by,source}}]},
//   watch: [{video,title,url,source,by,ts,views?,via}] }. get_topic_items gives { items: [{kind,title,url,discussionUrl,source,by,date,reactionsText}], nextCursor, total, counts }.
export default `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
${SHELL_CSS}
:root{color-scheme:light dark;--bg:#fff;--fg:#1c2b2d;--mut:#566a6d;--line:#d6dedb;--ac:#b0245f;--btn:#eef2f0;--card:#f6f8f7}
@media (prefers-color-scheme:dark){:root{--bg:#142224;--fg:#e8eeee;--mut:#9bb0b2;--line:#2c4144;--ac:#ff8fb8;--btn:#1d3033;--card:#192b2d}}
:root[data-theme=light]{color-scheme:light;--bg:#fff;--fg:#1c2b2d;--mut:#566a6d;--line:#d6dedb;--ac:#b0245f;--btn:#eef2f0;--card:#f6f8f7}
:root[data-theme=dark]{color-scheme:dark;--bg:#142224;--fg:#e8eeee;--mut:#9bb0b2;--line:#2c4144;--ac:#ff8fb8;--btn:#1d3033;--card:#192b2d}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
.hide{display:none!important}#app{padding:14px 14px 12px}#s{color:var(--mut);padding:18px 14px}
button,select{font:inherit;color:var(--fg);background:var(--btn);border:1px solid var(--line);border-radius:7px;padding:3px 10px;cursor:pointer}select{padding:3px 6px}
button:hover,select:hover{border-color:var(--mut)}button[aria-pressed=true],button[aria-selected=true]{border-color:var(--ac);color:var(--ac);font-weight:600}button:disabled,select:disabled{opacity:.55;cursor:default}
button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.lk{background:none;border:0;padding:0;text-align:left;color:var(--fg);text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:2px;border-radius:2px;font-weight:500}.lk:hover{color:var(--ac);border:0;text-decoration-color:var(--ac)}
#top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px}#top .sp{flex:1}
h1{margin:0;font-size:21px;line-height:1.2}
#state{display:inline-block;border:1.5px solid var(--ac);color:var(--ac);border-radius:99px;padding:0 9px;font-size:12.5px;font-weight:600;margin-left:8px;vertical-align:3px}#state.steady{border-color:var(--mut);color:var(--mut)}
#sum{margin:6px 0 2px;max-width:46rem}#by{color:var(--mut);font-size:12.5px;margin:0 0 10px}
#evwrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,230px);gap:10px 18px;align-items:start}
#ev{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.seg{border:1px solid var(--line);background:var(--card);border-radius:9px;padding:7px 10px}.seg b{display:block;font-size:13px}.seg .n{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}.seg span{display:block;color:var(--mut);font-size:12.5px}
#evnote{color:var(--mut);font-size:12.5px;margin:6px 0 0}
#spark svg{display:block;width:100%;height:64px}#spark .ax{display:flex;justify-content:space-between;color:var(--mut);font-size:11.5px}#spark .cap{color:var(--mut);font-size:12px;margin:0 0 2px}
#spark rect{fill:var(--ac);opacity:.75}#spark line{stroke:var(--mut);stroke-dasharray:3 3;stroke-width:1}
#tabs{display:flex;gap:4px;margin:14px 0 8px;border-bottom:1px solid var(--line);flex-wrap:wrap}
#tabs button{border:0;border-bottom:3px solid transparent;border-radius:6px 6px 0 0;background:none;padding:5px 12px}#tabs button[aria-selected=true]{border-bottom-color:var(--ac)}#tabs small{color:var(--mut);font-weight:400;margin-left:4px}
#ctl{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-bottom:8px}#ctl .g{display:inline-flex;gap:4px;flex-wrap:wrap}#ctl label{color:var(--mut);font-size:12.5px;display:flex;gap:6px;align-items:center}
.row{display:grid;grid-template-columns:22px minmax(0,1fr);gap:6px;padding:7px 0;border-top:1px solid var(--line)}.row input{margin:3px 0 0;accent-color:var(--ac);width:16px;height:16px}
.row .k{color:var(--ac);font-size:12px;font-weight:600;margin-right:6px}.row .m{color:var(--mut);font-size:12.5px;margin-top:1px}.row .m button{font-size:12.5px;text-decoration:underline;border:0;background:none;padding:0;color:var(--mut)}.row .m button:hover{color:var(--ac)}
.row .t{margin-top:1px;color:var(--fg);font-size:13px}
#more{margin-top:8px}.note{color:var(--mut);font-size:13px;padding:10px 0}
#rel{margin-top:14px}#rel h2{font-size:13.5px;margin:0 0 6px;color:var(--mut);font-weight:600}#rel .chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:99px;padding:1px 10px 1px 7px;background:var(--btn)}.chip input{accent-color:var(--ac);margin:0}.chip button{border:0;background:none;padding:2px 0}
#foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px;padding-top:10px;border-top:1px solid var(--line)}#foot .sp{flex:1}#msg{color:var(--mut);font-size:12.5px;min-height:1.4em;margin:6px 0 0}
#thanks{color:var(--mut);font-size:12px;margin:8px 0 0}
body.full #app{min-height:100vh}
:root{--k-x:#1f7a8c;--k-hn:#d9480f;--k-youtube:#c2255c;--k-rss:#6741d9}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--k-x:#3fa5b8;--k-hn:#f76707;--k-youtube:#e64980;--k-rss:#845ef7}}
:root[data-theme=dark]{--k-x:#3fa5b8;--k-hn:#f76707;--k-youtube:#e64980;--k-rss:#845ef7}
.prism{max-width:520px;width:100%;height:auto;display:block;margin:0 0 6px}.prism text{font-size:12px;fill:var(--fg)}.prism .pn{fill:var(--mut);font-size:11px}
.pp{fill:color-mix(in srgb,var(--pk,var(--mut)) 20%,var(--card));stroke:var(--pk,var(--mut));stroke-width:1.2;cursor:pointer}.pp.k-x{--pk:var(--k-x)}.pp.k-hn{--pk:var(--k-hn)}.pp.k-youtube{--pk:var(--k-youtube)}.pp.k-rss{--pk:var(--k-rss)}.pp.other{stroke-dasharray:3 3;cursor:default}
.pp.on{stroke-width:2.6}.pp:hover,.pp:focus-visible{stroke-width:2.4}.pp:focus-visible,.pd:focus-visible{outline:none}.pd{fill:var(--fg);opacity:.55;cursor:pointer}.pd:hover,.pd:focus-visible{fill:var(--ac);opacity:1}.pc{fill:var(--card);stroke:var(--line)}
.plist{list-style:none;margin:6px 0;padding:0;display:grid;gap:6px}.plist li{border-left:3px solid var(--line);padding-left:10px}.plist small{color:var(--mut)}.plist li button.ask{margin-left:6px;font-size:12.5px}
#slide{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:2px 0 8px;color:var(--mut);font-size:12.5px}#slide input{accent-color:var(--ac);flex:1;min-width:140px;max-width:360px}
@media (max-width:560px){#evwrap{grid-template-columns:1fr}}
</style></head><body><div id="s">Reading the topic…</div><div id="app" class="hide">
<div id="top"><span class="sp"></span><button id="fs" class="hide">Fullscreen</button></div>
<h1><span id="label"></span><span id="state" class="hide"></span></h1>
<p id="sum"></p><p id="by"></p>
<div id="evwrap"><div><div id="ev"></div><p id="evnote"></p></div><div id="spark"></div></div>
<div id="tabs" role="tablist" aria-label="Angles on this topic"></div>
<div id="pane" role="tabpanel"></div>
<div id="rel" class="hide"><h2>Talked about together with</h2><div class="chips" id="chips"></div></div>
<p id="msg" aria-live="polite"></p>
</div>
<script>
${SHELL_JS}
var NS = 'http://www.w3.org/2000/svg';
// The angles, in the order of the topic page on the site. A new angle: one entry here and one function in PANES.
var TABS = [['talk', 'Talk'], ['first', 'Who said it first'], ['papers', 'Papers'], ['watch', 'Watch'], ['briefings', 'Briefings']];
TABS.splice(1, 0, ['conv', 'Conversations']);
var pending = {}, nextId = 2, host = {}, D = null, theme = '', tab = 'talk', busy = false, home = '';
var T = { kind: '', sort: 'new', conv: '', items: [], next: null, total: 0, loading: false, err: '', loaded: false, gen: 0 }, PT = 0;
function el(id) { return document.getElementById(id); }
function send(m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); }
function request(method, params, ms, done) {
  var id = nextId++, timer = setTimeout(function () { delete pending[id]; done(new Error('no reply from the host')); }, ms || 20000);
  pending[id] = function (m) { clearTimeout(timer); done(m.error ? new Error(m.error.message || 'error') : null, m.result); };
  send({ id: id, method: method, params: params });
}
var ready = false;
function reportSize() { if (!ready) return; send({ method: 'ui/notifications/size-changed', params: { width: Math.ceil(window.innerWidth), height: Math.ceil(el('app').getBoundingClientRect().height) + 2 } }); }
function setTheme(t) { if (t === 'light' || t === 'dark') { theme = t; document.documentElement.setAttribute('data-theme', t); } }
function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function sv(tag, attrs, text) { var e = document.createElementNS(NS, tag), k; for (k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; }
function fmt(n) { return Number(n).toLocaleString('en-US'); }
function when(ms) { return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }

function readResult(res) {
  if (!res) throw new Error('no answer');
  if (res.isError) throw new Error(res.content && res.content[0] ? res.content[0].text : 'the tool failed');
  if (res.structuredContent) return res.structuredContent;
  var t = res.content && res.content[0] ? res.content[0].text : '';
  try { return JSON.parse(t); } catch (e) { throw new Error('this host gave only text, no data for the view'); }
}
function link(url, then) {
  request('ui/open-link', { url: url }, 8000, function (err) { if (err) el('msg').textContent = 'This host did not open the link. It is at ' + url; else if (then) then(); });
}
function can() { return !!(host.message || host.updateModelContext) || !Object.keys(host).length; }   // a host that lists what it can do and cannot message gets no ask button

// ---- the header
var STATES = { 'new': ['New', '\\u2726'], rising: ['Rising', '\\u25B2'], steady: ['Steady', '\\u25CF'], falling: ['Falling', '\\u25BC'] };
function spark(s) {
  var box = el('spark'), n = s.counts.length, W = 300, H = 60, top = Math.max.apply(null, s.counts.concat([s.usual || 0, 1])), bw = W / n, svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Mentions per day, last ' + n + ' days' });
  box.textContent = '';
  box.appendChild(mk('p', 'cap', 'Mentions per day' + (s.usual ? ' (dashed: the usual level)' : '')));
  s.counts.forEach(function (c, i) {
    var h = c ? Math.max(2, Math.round(c / top * (H - 4))) : 0, r = sv('rect', { x: (i * bw + 1).toFixed(1), y: H - h, width: Math.max(1, bw - 2).toFixed(1), height: h });
    r.appendChild(sv('title', {}, s.days[i] + ': ' + c));
    svg.appendChild(r);
  });
  if (s.usual) { var y = H - Math.round(s.usual / top * (H - 4)); svg.appendChild(sv('line', { x1: 0, x2: W, y1: y, y2: y })); }
  box.appendChild(svg);
  var ax = mk('div', 'ax'); ax.appendChild(mk('span', '', s.days[0].slice(5))); ax.appendChild(mk('span', '', s.days[n - 1].slice(5)));
  box.appendChild(ax);
}
function header() {
  var st = D.state && STATES[D.state];
  el('label').textContent = D.label;
  el('state').classList.toggle('hide', !st); el('state').className = st ? (D.state === 'steady' ? 'steady' : '') : 'hide';
  if (st) el('state').textContent = st[1] + ' ' + st[0] + (D.change && D.state !== 'steady' && D.change >= 1.5 ? ', x' + (Math.round(D.change * 10) / 10) : '');
  el('sum').textContent = D.summary ? D.summary.text : D.fallback;
  el('by').textContent = (D.summary ? 'Written by an AI on ' + D.summary.day + ' from ' + fmt(D.summary.itemCount) + ' items; the originals are under Talk. ' : 'No written summary yet; the line above is built from the numbers. ') + fmt(D.window.mentions) + ' mention' + (D.window.mentions === 1 ? '' : 's') + ' in the last ' + D.window.days + ' days.';
  var ev = el('ev'); ev.textContent = '';
  D.evidence.forEach(function (e) {
    var d = mk('div', 'seg'); d.appendChild(mk('b', '', e.label)); d.appendChild(mk('span', 'n', fmt(e.count)));
    e.lines.forEach(function (l) { d.appendChild(mk('span', '', l)); });
    if (e.names && e.names.length) d.appendChild(mk('span', '', e.names.join(', ')));
    ev.appendChild(d);
  });
  el('evnote').textContent = D.evidence.length ? 'Each source counts in its own unit, so the numbers are never added together.' : '';
  spark(D.series);
}

// ---- tabs
function renderTabs() {
  var box = el('tabs'); box.textContent = '';
  TABS.forEach(function (t) {
    if (t[0] === 'conv' && !D.prism) return;
    var n = t[0] === 'conv' ? D.prism.groups.length : t[0] === 'briefings' ? D.briefings.length : t[0] === 'papers' ? D.papers.matched : t[0] === 'first' ? D.first.order.length : t[0] === 'watch' ? D.watch.length : null, b = mk('button', '', t[1]);
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', t[0] === tab ? 'true' : 'false');
    if (n) b.appendChild(mk('small', '', String(n)));
    b.onclick = function () { tab = t[0]; renderTabs(); renderPane(); UC.tell(); };
    box.appendChild(b);
  });
}
function renderPane() { var p = el('pane'); p.textContent = ''; PANES[tab](p); reportSize(); }
function tick(key, desc) {
  var c = mk('input'); c.type = 'checkbox'; c.checked = UC.picked(key); c.setAttribute('aria-label', 'Pick ' + desc.label);
  c.onchange = function () { UC.pick(key, c.checked ? desc : null); };
  return c;
}
function cell(key, desc) { var c = mk('div'); if (can()) c.appendChild(tick(key, desc)); return c; }
function openBtn(text, url, cls) { var b = mk('button', cls || 'lk', text); b.onclick = function () { link(url); }; return b; }

// Talk: the items behind the topic, a page at a time from get_topic_items
function kinds() { return D.evidence.filter(function (e) { return e.kind !== 'arxiv'; }); }
function talkPane(p) {
  if (!D.sourcesShown) { p.appendChild(mk('p', 'note', 'This topic\\u2019s Signal does not show its sources, so the items behind it are not public. The summary and the numbers above are all there is.')); return; }
  if (T.conv) {
    var cg = convGroup(T.conv), chip = mk('p', 'note', 'Showing ' + (cg ? cg.name : 'one conversation') + ' \\u00B7 '), clr = mk('button', 'lk', 'clear');
    clr.onclick = function () { T.conv = ''; loadItems(true); UC.tell(); };
    chip.appendChild(clr); p.appendChild(chip);
  }
  var ctl = mk('div'); ctl.id = 'ctl';
  var g = mk('span', 'g'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Kind of source');
  [['', 'All']].concat(kinds().map(function (e) { return [e.kind, e.label]; })).forEach(function (k) {
    var b = mk('button', '', k[1]); b.setAttribute('aria-pressed', T.kind === k[0] ? 'true' : 'false');
    b.onclick = function () { if (T.kind !== k[0]) { T.kind = k[0]; loadItems(true); UC.tell(); } };
    g.appendChild(b);
  });
  var lab = mk('label', '', 'Order '), s = mk('select'); s.setAttribute('aria-label', 'Order');
  [['new', 'Newest first'], ['top', 'Most reacted first']].forEach(function (o) { var op = mk('option', '', o[1]); op.value = o[0]; s.appendChild(op); });
  s.value = T.sort; s.onchange = function () { T.sort = s.value; loadItems(true); UC.tell(); };
  lab.appendChild(s); ctl.appendChild(g); ctl.appendChild(lab); p.appendChild(ctl);
  if (T.sort === 'top') p.appendChild(mk('p', 'note', 'Most reacted weighs likes, replies and views; compare numbers only within one kind of source (use the filter).'));
  T.items.forEach(function (i) {
    var r = mk('div', 'row'), body = mk('div'), key = i.url, m = mk('div', 'm'), bits = [];
    r.appendChild(cell(key, { k: 'item', label: i.title || i.url, url: i.url, t: D.slug, meta: [i.by, i.source, i.date].filter(Boolean).join(', ') }));
    body.appendChild(mk('span', 'k', i.kind === 'x' ? 'X' : i.kind === 'hn' ? 'HN' : i.kind === 'youtube' ? 'YouTube' : 'Blog'));
    body.appendChild(openBtn(i.title || i.url, i.url));
    bits = [i.by ? (i.kind === 'x' ? '@' + i.by.replace(/^@/, '') : i.by) : '', i.kind !== 'x' ? i.source : '', i.date, i.reactionsText].filter(Boolean);
    m.appendChild(document.createTextNode(bits.join(' \\u00B7 ')));
    if (i.discussionUrl && i.discussionUrl !== i.url) { m.appendChild(document.createTextNode(' \\u00B7 ')); m.appendChild(openBtn('thread', i.discussionUrl, '')); }
    if (i.id && UC.can.panels()) { m.appendChild(document.createTextNode(' \\u00B7 ')); var ic = mk('button', '', 'In context'); ic.onclick = function () { UC.open('item', { topic: D.slug, item: i.id, area: D.area }); }; m.appendChild(ic); }
    body.appendChild(m); r.appendChild(body); p.appendChild(r);
  });
  if (T.loading) p.appendChild(mk('p', 'note', 'Reading\\u2026'));
  else if (T.err) p.appendChild(mk('p', 'note', 'Could not read the items: ' + T.err));
  else if (T.loaded && !T.items.length) p.appendChild(mk('p', 'note', 'Nothing here for this filter.'));
  if (T.next && !T.loading) { var more = mk('button', '', 'Show more (' + fmt(T.total - T.items.length) + ' left)'); more.id = 'more'; more.onclick = function () { loadItems(false); }; p.appendChild(more); }
  if (T.loaded && T.items.length) p.appendChild(mk('p', 'note', 'Posts and articles are written by others; follow a link to read the original.'));
}
function loadItems(reset) {
  var gen, args;
  if (reset) { T.items = []; T.next = null; T.total = 0; T.loaded = false; T.gen++; }
  gen = T.gen; T.loading = true; T.err = '';
  args = { topic: D.slug, sort: T.sort }; if (T.conv) args = { topic: D.slug, sort: T.sort, conversation: T.conv }; if (T.kind) args.kind = T.kind; if (T.next && !reset) args.cursor = T.next;
  if (tab === 'talk') renderPane();
  request('tools/call', { name: 'get_topic_items', arguments: args }, 30000, function (err, res) {
    if (gen !== T.gen) return;   // the topic or the filter changed meanwhile
    T.loading = false;
    try { if (err) throw err; var r = readResult(res); T.items = T.items.concat(r.items || []); T.next = r.nextCursor || null; T.total = r.total || 0; T.loaded = true; } catch (e) { T.err = e.message; }
    if (tab === 'talk') renderPane();
  });
}
function briefingsPane(p) {
  if (!D.briefings.length) { p.appendChild(mk('p', 'note', 'No published briefing has covered this topic yet.')); return; }
  D.briefings.forEach(function (b) {
    var r = mk('div', 'row'), body = mk('div'), m = mk('div', 'm');
    r.appendChild(mk('div'));
    body.appendChild(openBtn(b.title + (b.theme ? ': ' + b.theme : ''), b.url));
    m.appendChild(document.createTextNode(when(b.publishedAt)));
    body.appendChild(m);
    if (b.tldr) body.appendChild(mk('div', 't', b.tldr.length > 220 ? b.tldr.slice(0, 220).replace(/\\s+\\S*$/, '') + '\\u2026' : b.tldr));
    r.appendChild(body); p.appendChild(r);
  });
}
function uptake(u) {
  var b = [];
  if (u.accounts) b.push(u.accounts + ' post' + (u.accounts === 1 ? '' : 's'));
  if (u.hn) b.push(fmt(u.hn.points) + ' Hacker News points');
  if (u.hf) b.push(fmt(u.hf.upvotes) + ' Hugging Face upvotes');
  return b.length ? b.join(', ') : 'not discussed yet';
}
function papersPane(p) {
  var pp = D.papers;
  if (!pp.matched) { p.appendChild(mk('p', 'note', 'No paper of the last 30 days names this subject.')); return; }
  p.appendChild(mk('p', 'note', fmt(pp.matched) + ' paper' + (pp.matched === 1 ? '' : 's') + ' from the last 30 days name this subject; ' + (pp.mentioned ? fmt(pp.mentioned) + ' named in posts or on Hacker News' : 'none discussed yet, which says nothing against them') + '. They are found by the topic\\u2019s names in titles and abstracts, so some may only be close.'));
  pp.list.forEach(function (q) {
    var r = mk('div', 'row'), body = mk('div'), m = mk('div', 'm');
    r.appendChild(cell('paper:' + q.id, { k: 'paper', label: q.title, id: q.id, url: q.url, t: D.slug }));
    body.appendChild(openBtn(q.title, q.url));
    m.appendChild(document.createTextNode(when(q.published) + ' \\u00B7 ' + q.id + ' \\u00B7 ' + uptake(q.uptake)));
    if (UC.can.panels()) { m.appendChild(document.createTextNode(' \\u00B7 ')); var ab = mk('button', '', 'Abstract'); ab.onclick = function () { UC.open('paper', { id: q.id }); }; m.appendChild(ab); }
    body.appendChild(m); r.appendChild(body); p.appendChild(r);
  });
  if (pp.thanks) p.appendChild(mk('p', 'note', pp.thanks)).id = 'thanks';
}
// Who said it first: the order the kinds of source had the topic in, as one sentence and a list. No ripple here: that picture compares groups across topics (see the site's Who said it first page).
function firstPane(p) {
  var f = D.first;
  if (!f.order.length) { p.appendChild(mk('p', 'note', 'No mention with a time of day was logged for this topic in the last two weeks, so there is no order to show.')); return; }
  p.appendChild(mk('p', 't', f.sentence));
  f.order.forEach(function (a, i) {
    var r = mk('div', 'row'), body = mk('div'), m = mk('div', 'm');
    r.appendChild(mk('div'));
    body.appendChild(mk('span', 'k', (i + 1) + '.')); body.appendChild(document.createTextNode(a.label));
    m.appendChild(document.createTextNode(a.afterText + ' \u00B7 ' + a.at + ' \u00B7 ' + fmt(a.items) + (a.items === 1 ? ' item' : ' items')));
    body.appendChild(m);
    if (a.first && a.first.url) { var t = mk('div', 't'); t.appendChild(openBtn(a.first.title || a.first.url, a.first.url)); body.appendChild(t); }
    r.appendChild(body); p.appendChild(r);
  });
  p.appendChild(mk('p', 'note', f.caveat + (D.sourcesShown ? '' : ' This Signal shows scores only, so the first items are not named.')));
}
// Watch: videos and talks on the topic. Text and links only: a host decides what pictures a view may load.
function watchPane(p) {
  if (!D.watch.length) { p.appendChild(mk('p', 'note', 'No video on this subject in the last two weeks.')); return; }
  D.watch.forEach(function (v) {
    var r = mk('div', 'row'), body = mk('div'), m = mk('div', 'm');
    r.appendChild(cell('video:' + v.video, { k: 'item', label: v.title, url: v.url, meta: [v.source, v.by].filter(Boolean).join(', ') }));
    body.appendChild(mk('span', 'k', 'Video')); body.appendChild(openBtn(v.title, v.url));
    m.appendChild(document.createTextNode([v.source, when(v.ts), v.views ? 'about ' + fmt(v.views) + ' views' : ''].filter(Boolean).join(' \u00B7 ')));
    body.appendChild(m); r.appendChild(body); p.appendChild(r);
  });
  p.appendChild(mk('p', 'note', 'Matched by the topic\u2019s names in titles, from chosen YouTube channels and feed pages. Each opens on YouTube.'));
}
// Conversations (Prism): the groups inside the topic as petals, drawn from the layout the server worked out (D.prism.layout); the view does no geometry of its own.
function convGroup(id) { var i, g = D && D.prism ? D.prism.groups : []; for (i = 0; i < g.length; i++) if (g[i].id === id) return g[i]; return null; }
function pickConv(id) { T.conv = T.conv === id ? '' : id; tab = 'talk'; renderTabs(); if (D.sourcesShown) loadItems(true); else renderPane(); UC.tell(); }
function convPane(p) {
  var pr = D.prism, L = pr.layout, hasDots = false, top = mk('div'), bot = mk('div');
  L.petals.forEach(function (pt) { if (pt.dots.length) hasDots = true; });
  p.appendChild(top);
  if (hasDots) {
    var sl = mk('div'), lab = mk('label', '', 'Up to '), rg = mk('input'), when1 = mk('span', '', when(PT));
    sl.id = 'slide'; rg.type = 'range'; rg.min = String(pr.from); rg.max = String(pr.to); rg.step = '3600000'; rg.value = String(PT); rg.setAttribute('aria-label', 'Show the conversations up to this time');
    rg.oninput = function () { PT = Number(rg.value); when1.textContent = when(PT); drawConv(top, bot, hasDots); reportSize(); };
    rg.onchange = function () { UC.tell(); };
    lab.appendChild(when1); sl.appendChild(lab); sl.appendChild(rg); p.appendChild(sl);
  }
  p.appendChild(bot);
  drawConv(top, bot, hasDots);
}
function drawConv(top, bot, hasDots) {
  var pr = D.prism, L = pr.layout, count = {}, kindCls = { x: 'k-x', hn: 'k-hn', youtube: 'k-youtube', rss: 'k-rss' };
  L.petals.forEach(function (pt) {
    var g = convGroup(pt.id);
    count[pt.id] = !hasDots || pt.id === 'other' ? (g ? g.n : pr.other) : pt.dots.filter(function (d) { return d.ts <= PT; }).length;
  });
  var svg = sv('svg', { viewBox: '0 0 520 340', 'class': 'prism', role: 'group', 'aria-label': D.label + ': ' + pr.groups.length + ' conversations' });
  L.petals.forEach(function (pt) {
    var g = convGroup(pt.id), name = g ? g.name : 'Other', n = count[pt.id], path = sv('path', { d: pt.path, 'class': 'pp ' + (g ? (kindCls[g.kind] || 'mixed') : 'other') + (g && T.conv === g.id ? ' on' : '') });
    path.appendChild(sv('title', {}, name + ': ' + fmt(n) + (n === 1 ? ' item' : ' items')));
    if (g) {
      path.setAttribute('tabindex', '0'); path.setAttribute('role', 'button'); path.setAttribute('aria-label', name + ', ' + fmt(n) + ' items');
      path.onclick = function () { pickConv(g.id); };
      path.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickConv(g.id); } };
    }
    svg.appendChild(path);
    pt.dots.forEach(function (d) {
      if (d.ts > PT) return;
      var c = sv('circle', { cx: d.x, cy: d.y, r: 2.4, 'class': 'pd' });
      c.appendChild(sv('title', {}, when(d.ts)));
      if (UC.can.panels()) {
        c.setAttribute('tabindex', '0'); c.setAttribute('role', 'button'); c.setAttribute('aria-label', 'Open an item from ' + when(d.ts));
        c.onclick = function () { UC.open('item', { topic: D.slug, item: d.id, area: D.area }); };
        c.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); UC.open('item', { topic: D.slug, item: d.id, area: D.area }); } };
      }
      svg.appendChild(c);
    });
    var lines = name.length > 16 && name.indexOf(' ') > 0 ? (function () { var best = -1, i, mid = name.length / 2; for (i = 0; i < name.length; i++) if (name.charAt(i) === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; return [name.slice(0, best), name.slice(best + 1)]; })() : [name],
      ly = pt.label[1] + (pt.anchor === 'middle' && pt.label[1] < L.cy ? -(lines.length) * 13 : 0), tx = sv('text', { x: pt.label[0], y: ly, 'text-anchor': pt.anchor });
    lines.forEach(function (ln, i) { tx.appendChild(sv('tspan', { x: pt.label[0], dy: i ? 13 : 0 }, ln)); });
    tx.appendChild(sv('tspan', { 'class': 'pn', dx: 4 }, fmt(n)));
    svg.appendChild(tx);
  });
  svg.appendChild(sv('circle', { cx: L.cx, cy: L.cy, r: L.r0, 'class': 'pc' }));
  var nm = D.label.length > 22 ? D.label.slice(0, 21) + '\\u2026' : D.label, cl = nm.length > 11 && nm.indexOf(' ') > 0 ? [nm.slice(0, nm.lastIndexOf(' ', 11) > 0 ? nm.lastIndexOf(' ', 11) : nm.indexOf(' ')), ''] : [nm];
  if (cl.length > 1) cl[1] = nm.slice(cl[0].length + 1);
  var ct = sv('text', { x: L.cx, y: L.cy - (cl.length - 1) * 6 + 4, 'text-anchor': 'middle' });
  cl.forEach(function (ln, i) { ct.appendChild(sv('tspan', { x: L.cx, dy: i ? 13 : 0 }, ln)); });
  svg.appendChild(ct);
  top.textContent = ''; bot.textContent = ''; top.appendChild(svg);
  var ol = mk('ol', 'plist');
  pr.groups.slice().sort(function (a, b) { return count[b.id] - count[a.id]; }).forEach(function (g) {
    var li = mk('li'), b = mk('button', 'lk', g.name), n = count[g.id];
    b.onclick = function () { pickConv(g.id); };
    li.appendChild(b); li.appendChild(document.createTextNode(' '));
    li.appendChild(mk('small', '', fmt(n) + (n === 1 ? ' item' : ' items') + (g.began ? ' \\u00B7 began ' + when(g.began) : '')));
    if (can()) {
      var ask = mk('button', 'ask', 'Ask Claude about this conversation');
      ask.onclick = function () { UC.ask('About the conversation "' + g.name + '" inside the topic ' + D.label + ': what is it about, and what should I read first? Its most typical items: ' + g.typical.map(function (i) { return i.title + ' (' + i.url + ')'; }).join('; ') + '. (get_topic_items with topic ' + D.slug + ' and conversation ' + g.id + ' lists all of them.)'); };
      li.appendChild(ask);
    }
    ol.appendChild(li);
  });
  bot.appendChild(ol);
  if (pr.other > 0) bot.appendChild(mk('p', 'note', fmt(pr.other) + ' more item' + (pr.other === 1 ? ' is' : 's are') + ' in none of these.'));
  bot.appendChild(mk('p', 'note', 'The items are grouped by what they say, by a model, and each name was written by ' + (pr.groups.some(function (g) { return g.namedBy === 'rule'; }) ? 'a model or, where marked with quotation marks, taken from the title of the most typical item' : 'a model from the most typical items') + '. It can get things wrong.'));
}
var PANES = { talk: talkPane, conv: convPane, first: firstPane, papers: papersPane, watch: watchPane, briefings: briefingsPane };

// ---- related topics: a click switches this view to that topic
function related() {
  var box = el('chips'); box.textContent = '';
  D.related.forEach(function (r) {
    var c = mk('span', 'chip'), b = mk('button', '', r.label);
    if (can()) c.appendChild(tick('topic:' + r.slug, { k: 'topic', label: r.label, slug: r.slug, url: r.url }));
    b.onclick = function () { go(r.slug, true); };
    c.appendChild(b); box.appendChild(c);
  });
  el('rel').classList.toggle('hide', !D.related.length);
}
function go(slug, push) {
  if (busy) return;
  busy = true; el('msg').textContent = 'Reading\\u2026';
  request('tools/call', { name: 'get_topic', arguments: { topic: slug } }, 30000, function (err, res) {
    busy = false;
    try { if (err) throw err; var prev = D; show(readResult(res)); if (push && prev) { var ps = prev.slug; UC.step(D.label, function () { go(ps, false); }); } el('msg').textContent = ''; } catch (e) { el('msg').textContent = 'Could not open that topic: ' + e.message; }
  });
}

// ---- what the shell needs from this view
var TABNAME = { talk: 'Talk', conv: 'Conversations', first: 'Who said it first', papers: 'Papers', watch: 'Watch', briefings: 'Briefings' };
function contextText() {
  var t = 'In the topic hub for ' + D.label + ' (address ' + D.slug + (D.area === 'politics' ? ', area politics' : '') + '), on the ' + TABNAME[tab] + ' tab';
  if (tab === 'talk') t += (T.kind ? ', only ' + T.kind : '') + (T.conv ? ', in the conversation "' + (convGroup(T.conv) ? convGroup(T.conv).name : T.conv) + '"' : '') + ', ' + (T.sort === 'top' ? 'most reacted first' : 'newest first');
  if (tab === 'conv' && D.prism && PT < D.prism.to) t += ', looking at its conversations up to ' + when(PT);
  return t + '.';
}
function siteUrl() {
  var q = [];
  if (!D || !D.url) return '';
  if (tab !== 'talk') q.push('angle=' + tab);
  if (tab === 'talk' && T.kind) q.push('kind=' + T.kind);
  if (tab === 'talk' && T.conv) q.push('conv=' + encodeURIComponent(T.conv));
  if (tab === 'talk' && T.sort === 'new') q.push('sort=newest');
  return D.url + (q.length ? (D.url.indexOf('?') >= 0 ? '&' : '?') + q.join('&') : '');
}
function origin() { return D && D.url ? D.url.split('/').slice(0, 3).join('/') : ''; }

// ---- showing a topic
function show(data) {
  if (!data || data.error || !data.slug) throw new Error(data && data.error ? data.error : 'no topic');
  D = data; D.evidence = D.evidence || []; D.briefings = D.briefings || []; D.related = D.related || []; D.papers = D.papers || { matched: 0, mentioned: 0, list: [] };
  D.series = D.series || { days: [], counts: [], usual: 0 };
  D.first = D.first || { order: [], sentence: '', caveat: '' }; D.first.order = D.first.order || []; D.watch = D.watch || []; D.prism = D.prism || null;
  tab = 'talk'; PT = D.prism ? D.prism.to : 0; T = { kind: '', sort: 'new', conv: '', items: [], next: null, total: 0, loading: false, err: '', loaded: false, gen: T.gen + 1 };
  el('s').classList.add('hide'); el('app').classList.remove('hide');
  header(); renderTabs(); related(); renderPane();
  if (D.sourcesShown) loadItems(true);
  if (!home) home = D.label;
  UC.suggest(D.questions); UC.refresh(); UC.tell();
}

function setFull(on) { document.body.classList.toggle('full', on); el('fs').textContent = on ? 'Exit fullscreen' : 'Fullscreen'; reportSize(); }
el('fs').onclick = function () { request('ui/request-display-mode', { mode: document.body.classList.contains('full') ? 'inline' : 'fullscreen' }, 8000, function (err, res) { if (!err && res) setFull(res.mode === 'fullscreen'); }); };
window.addEventListener('message', function (e) {
  var m = e.data, fn;
  if (!m) return;
  if (m.id === 1) {
    if (m.error) { el('s').textContent = 'initialize failed: ' + JSON.stringify(m.error); return; }
    var r = m.result || {}, hc = r.hostContext || {};
    host = r.hostCapabilities || {};
    UC.init({ title: function () { return home || 'Topic'; }, host: host, root: el('app'), size: reportSize,
      note: function (t) { el('msg').textContent = t; }, site: siteUrl,
      context: function () { return D ? contextText() : ''; },
      state: function () { return D ? { area: D.area, lens: D.lens || '', window: D.window ? D.window.days : 0 } : {}; },
      redraw: function () { if (D) renderPane(); },
      cleared: function () { if (D) { renderPane(); related(); } },
      question: function () { return 'What do these say about ' + D.label + '? Summarise what they agree and disagree on, and what I should read first.'; },
      saveBase: function () { return origin() ? origin() + '/me/save' : ''; } });
    setTheme(hc.theme);
    send({ method: 'ui/notifications/initialized' });
    ready = true; reportSize();
    new ResizeObserver(reportSize).observe(document.body);
    if ((hc.availableDisplayModes || []).indexOf('fullscreen') >= 0) el('fs').classList.remove('hide');
    if (hc.displayMode === 'fullscreen') setFull(true);
    if (D) { renderPane(); related(); }
  } else if (m.id && pending[m.id]) {
    fn = pending[m.id]; delete pending[m.id]; fn(m);
  } else if (m.method === 'ui/notifications/tool-result') {
    try { show(readResult(m.params)); } catch (err) { el('s').classList.remove('hide'); el('s').textContent = 'Nothing to show: ' + err.message; reportSize(); }
  } else if (m.method === 'ui/notifications/host-context-changed') {
    if (m.params && m.params.theme) setTheme(m.params.theme);
    if (m.params && m.params.displayMode) setFull(m.params.displayMode === 'fullscreen');
  } else if (m.method === 'ui/resource-teardown') {
    send({ id: m.id, result: {} });
  }
});
send({ id: 1, method: 'ui/initialize', params: { appInfo: { name: 'undercurrent-topic', version: '0.1.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26' } });
</script></body></html>`;
