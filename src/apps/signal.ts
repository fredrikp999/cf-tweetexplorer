// The Signal dashboard for the get_signal tool (MCP Apps): a plain page that speaks the ui/* postMessage protocol directly (no SDK, no bundler; see the
// mcp-app skill and costs.ts for why) and draws the tool's JSON result.
// The result it draws: { days, from, to, baselineOk, board, boards: [{ id, title, slug, public, proof }], ai: { using },
//   groups: [{ key, name, weight, items, perDay }], lists: { top, rising, shared, single },
//   terms: { [term]: { label, members, related, signal, change, isNew, kind, topGroup, breadth, active, groups: [{ key, docs, share, part }], headlines } } }.
// It is interactive through tools/call: the window, the Signal (board) and the background-topics switch ask the host to call get_signal again, and
// opening a topic calls get_signal_items for the items behind it. Strength / Where it shows up and the open topic are kept in the page.
export default `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mut:#6b6b6b;--line:#e2e2e2;--ac:#c9265f;--card:#f6f6f7}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f2f2f2;--mut:#9a9a9a;--line:#38383a;--ac:#ff6b97;--card:#27272a}}
:root[data-theme=light]{--bg:#fff;--fg:#1a1a1a;--mut:#6b6b6b;--line:#e2e2e2;--ac:#c9265f;--card:#f6f6f7}
:root[data-theme=dark]{--bg:#1c1c1e;--fg:#f2f2f2;--mut:#9a9a9a;--line:#38383a;--ac:#ff6b97;--card:#27272a}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
a{color:inherit}h1{margin:0;font-size:22px}h1 small{font-size:13px;font-weight:400;color:var(--mut)}h2{font-size:14px;margin:18px 0 6px}
.ctl{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:12px 0 0}.seg{display:inline-flex;gap:4px}
button,select{font:inherit;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}select{background:var(--bg)}
button.on{border-color:var(--ac);color:var(--ac)}button:disabled,select:disabled{opacity:.5;cursor:default}
label.chk{color:var(--mut);font-size:12px;cursor:pointer}
.info{color:var(--mut);font-size:12px;margin:8px 0 0}.badge{display:inline-block;font-size:11px;padding:0 7px;border:1px solid var(--line);border-radius:99px}.badge.pub{color:#2a9d6b;border-color:#2a9d6b}
.groups{display:flex;flex-wrap:wrap;gap:6px 14px;margin:12px 0;color:var(--mut);font-size:12px}.groups i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.row{display:grid;grid-template-columns:minmax(90px,180px) minmax(0,1fr) 44px;gap:10px;align-items:center;padding:4px 6px;margin:0 -6px;border-radius:6px;cursor:pointer;width:100%;border:0;text-align:left;background:transparent;color:inherit}
.row:hover,.row.on{background:var(--card)}
.row .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.row .t small{display:block;font-weight:400;font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis}.row .v{text-align:right;color:var(--mut);font-size:12px}
.hl{font-size:12px;color:var(--mut);margin:0 0 4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{display:flex;height:14px;border-radius:3px;overflow:hidden}.bar b{display:block;min-width:2px}
.cells{display:grid;gap:4px}.cells span{height:18px;border-radius:3px;background:var(--card);font-size:11px;line-height:18px;padding-left:5px;overflow:hidden;white-space:nowrap}
.cap{display:grid;grid-template-columns:minmax(90px,180px) minmax(0,1fr) 44px;gap:10px;color:var(--mut);font-size:11px;margin-top:6px}.cap .cells span{background:none;height:auto;padding:0;overflow:hidden;text-overflow:ellipsis}
.chip{display:inline-block;font-size:11px;padding:0 7px;margin:3px 4px 0 0;border:1px solid var(--line);border-radius:99px;color:var(--mut)}.chip.up{color:var(--ac);border-color:var(--ac)}
.detail{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:4px 0 10px;background:var(--card)}.detail h3{margin:0 0 6px;font-size:14px}
.item{padding:5px 0;border-top:1px solid var(--line);font-size:13px}.item:first-of-type{border-top:0}.item .by{color:var(--mut);font-size:11px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.li{display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid var(--line)}.li small{color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#s,.note{color:var(--mut)}.note{font-size:12px;margin-top:10px}
</style></head><body>
<div id="s">waiting for data</div><div id="root"></div>
<script>
var RANGES = [1, 3, 7, 14];
var PAL = ['#2f6fed', '#e8833a', '#2aa06b', '#a259d9', '#d6336c', '#0ca678', '#868e96', '#e8590c'];
var s = document.getElementById('s'), root = document.getElementById('root');
var send = function (m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); };
var esc = function (v) { var d = document.createElement('div'); d.textContent = String(v == null ? '' : v); return d.innerHTML; };
var pct = function (x) { var p = x * 100; return (p < 10 ? p.toFixed(1) : Math.round(p)) + '%'; };
var pending = {}, nextId = 2;
// What the page remembers between draws.
var st = { days: 7, board: '', steady: false, view: 'strength', open: null, proof: null, showAll: false, busy: false, data: null };

function call(name, args, done) {
  var id = nextId++, timer = setTimeout(function () { delete pending[id]; done(new Error('no reply from the host')); }, 20000);
  pending[id] = function (m) { clearTimeout(timer); if (m.error) return done(new Error(m.error.message || 'error')); try { done(null, JSON.parse(m.result.content[0].text)); } catch (e) { done(e); } };
  send({ id: id, method: 'tools/call', params: { name: name, arguments: args } });
}

function reload() {
  st.busy = true; s.textContent = 'loading...'; draw();
  call('get_signal', { days: st.days, board: st.board || undefined, steady: st.steady }, function (err, d) {
    st.busy = false;
    if (err) { s.textContent = 'Could not load: ' + err.message; draw(); return; }
    s.textContent = ''; st.data = d; st.open = null; st.proof = null; draw();
  });
}

function openTerm(key) {
  if (st.open === key) { st.open = null; st.proof = null; draw(); return; }
  var t = st.data.terms[key], terms = [key].concat(t.members || []).slice(0, 12);
  st.open = key; st.proof = 'loading'; draw();
  call('get_signal_items', { terms: terms, days: st.days, limit: 8 }, function (err, r) {
    if (st.open !== key) return;
    st.proof = err ? { error: err.message } : r; draw();
  });
}

function chips(t, name) {
  var c = '';
  if (t.active > 1) c += t.kind === 'shared' ? '<span class="chip">everywhere</span>' : t.kind === 'single' ? '<span class="chip">only ' + esc(name(t.topGroup)) + '</span>' : '<span class="chip">mixed</span>';
  if (t.isNew) c += '<span class="chip up">new</span>'; else if (t.change !== null && t.change >= 1.5) c += '<span class="chip up">up x' + t.change.toFixed(1) + '</span>';
  return c;
}

function proofHtml(name) {
  var p = st.proof;
  if (p === 'loading') return '<div class="detail"><span class="note">Loading the items...</span></div>';
  if (p && p.error) return '<div class="detail"><span class="note">Could not load the items: ' + esc(p.error) + '</span></div>';
  var h = '<div class="detail"><h3>' + esc(st.data.terms[st.open].label || st.open) + ' <span class="note">' + esc(p.total) + ' item' + (p.total === 1 ? '' : 's') + ', ' + esc(p.from) + (p.from === p.to ? '' : ' to ' + esc(p.to)) + '</span></h3>', i, x, url;
  for (i = 0; i < p.items.length; i++) {
    x = p.items[i]; url = /^https:\\/\\//.test(x.url || '') ? x.url : '';
    h += '<div class="item">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title || url) + '</a>' : esc(x.title))
      + '<div class="by">' + esc(name(x.group)) + ' - ' + esc(x.label || '') + (x.by && x.by !== x.label ? ' - ' + esc(x.by) : '') + (x.ts ? ' - ' + esc(new Date(x.ts).toISOString().slice(0, 10)) : '') + '</div></div>';
  }
  if (!p.items.length) h += '<span class="note">Nothing is logged for this period.</span>';
  return h + '</div>';
}

function controls(d) {
  var h = '<div class="ctl"><span class="seg">', i, b;
  for (i = 0; i < RANGES.length; i++) h += '<button data-days="' + RANGES[i] + '" class="' + (RANGES[i] === st.days ? 'on' : '') + '"' + (st.busy ? ' disabled' : '') + '>' + (RANGES[i] === 1 ? 'Today' : RANGES[i] + ' days') + '</button>';
  h += '</span>';
  if (d.boards && d.boards.length) {
    h += '<select data-board' + (st.busy ? ' disabled' : '') + '><option value="">Everything</option>';
    for (i = 0; i < d.boards.length; i++) { b = d.boards[i]; h += '<option value="' + esc(b.id) + '"' + (b.id === (d.board || '') ? ' selected' : '') + '>' + esc(b.title) + '</option>'; }
    h += '</select>';
  }
  h += '<span class="seg"><button data-view="strength" class="' + (st.view === 'strength' ? 'on' : '') + '">Strength</button><button data-view="spread" class="' + (st.view === 'spread' ? 'on' : '') + '">Where it shows up</button></span>'
    + '<label class="chk"><input type="checkbox" data-steady' + (st.steady ? ' checked' : '') + (st.busy ? ' disabled' : '') + '> show background topics</label></div>';
  var cur = d.boards && d.boards.filter(function (x) { return x.id === d.board; })[0];
  h += '<div class="info">' + (cur ? (cur.public ? '<span class="badge pub">Published</span> at /signal/' + esc(cur.slug) + (cur.proof ? ' with sources' : '') : '<span class="badge">Draft</span> not public') : 'All groups combined, not a published page')
    + (d.ai && d.ai.using ? ' - topics named by AI' : '') + '</div>';
  return h;
}

function draw() {
  var d = st.data;
  if (!d) return;
  var color = {}, names = {}, i, j, g, t, html = '', top = d.lists.top, max = 0.000001, act = [];
  for (i = 0; i < d.groups.length; i++) { g = d.groups[i]; color[g.key] = PAL[i % PAL.length]; names[g.key] = g.name; if (g.weight > 0 && g.items > 0) act.push(g); }
  var name = function (k) { return names[k] || k; };
  var shown = st.showAll ? top : top.slice(0, 20);
  for (i = 0; i < top.length; i++) max = Math.max(max, d.terms[top[i]].signal);
  var legend = '', rows = '', cap = '';
  for (i = 0; i < d.groups.length; i++) {
    g = d.groups[i];
    legend += '<span><i style="background:' + color[g.key] + '"></i>' + esc(g.name) + ' - ' + esc(g.items) + ' items' + (g.weight === 1 ? '' : g.weight === 0 ? ' (off)' : ' (x' + esc(g.weight) + ')') + '</span>';
  }
  if (st.view === 'spread') {
    cap = '<div class="cap"><span></span><div class="cells" style="grid-template-columns:repeat(' + act.length + ',minmax(0,1fr))">';
    for (i = 0; i < act.length; i++) cap += '<span title="' + esc(act[i].name) + '">' + esc(act[i].name) + '</span>';
    cap += '</div><span></span></div>';
  }
  for (i = 0; i < shown.length; i++) {
    t = d.terms[shown[i]];
    var mid = '', hl = t.headlines && t.headlines[0];
    if (st.view === 'spread') {
      var row = 0.000001, x;
      for (j = 0; j < t.groups.length; j++) row = Math.max(row, t.groups[j].share);
      mid = '<span class="cells" style="grid-template-columns:repeat(' + act.length + ',minmax(0,1fr))">';
      for (j = 0; j < act.length; j++) {
        x = t.groups.filter(function (y) { return y.key === act[j].key; })[0];
        mid += x && x.docs ? '<span style="background:' + color[act[j].key] + ';color:#fff;opacity:' + Math.max(0.25, x.share / row).toFixed(2) + '" title="' + esc(act[j].name) + ': ' + esc(x.docs) + ' items">' + pct(x.share) + '</span>' : '<span></span>';
      }
      mid += '</span>';
    } else {
      mid = '<span class="bar" style="width:' + Math.max(2, t.signal / max * 100).toFixed(1) + '%">';
      for (j = 0; j < t.groups.length; j++) if (t.groups[j].part >= 0.02) mid += '<b style="flex:' + t.groups[j].part.toFixed(3) + ';background:' + color[t.groups[j].key] + '" title="' + esc(name(t.groups[j].key)) + '"></b>';
      mid += '</span>';
    }
    rows += '<button class="row' + (st.open === shown[i] ? ' on' : '') + '" data-term="' + esc(shown[i]) + '"><span class="t" title="' + esc([t.label].concat(t.members || []).join(', ')) + '">' + esc(t.label || shown[i])
      + (t.related && t.related.length ? '<small>' + esc(t.related.join(' / ')) + '</small>' : '') + '</span><span>' + mid + (st.view === 'strength' ? chips(t, name) : '') + '</span><span class="v">' + pct(t.signal) + '</span></button>'
      + (hl ? '<div class="hl">' + esc(hl.title) + ' <span class="note">' + esc(hl.by) + '</span></div>' : '')
      + (st.open === shown[i] ? proofHtml(name) : '');
  }
  var list = function (title, keys, note) {
    var out = '<div><h2>' + title + '</h2>', k;
    for (k = 0; k < keys.length && k < 8; k++) out += '<div class="li"><span>' + esc(d.terms[keys[k]].label || keys[k]) + '</span><small>' + esc(note(d.terms[keys[k]])) + '</small></div>';
    return out + (keys.length ? '' : '<div class="note">Nothing yet.</div>') + '</div>';
  };
  root.innerHTML = '<h1>Signal <small>' + esc(d.from) + (d.from === d.to ? '' : ' to ' + esc(d.to)) + '</small></h1>' + controls(d) + '<div class="groups">' + (legend || 'No groups yet') + '</div>'
    + (rows ? cap + '<div>' + rows + '</div>' + (top.length > 20 ? '<button data-more style="margin-top:8px">' + (st.showAll ? 'Show fewer' : 'Show all ' + top.length) + '</button>' : '') : '<div class="note">No topic is mentioned often enough yet.</div>')
    + '<div class="cols">' + list('Everywhere', d.lists.shared, function (x) { return x.breadth + ' of ' + x.active + ' groups'; })
    + list('Only in one group', d.lists.single.filter(function (k) { return d.terms[k].active > 1; }), function (x) { return name(x.topGroup); })
    + list('Rising', d.lists.rising, function (x) { return x.isNew ? 'new' : 'x' + x.change.toFixed(1); }) + '</div>'
    + '<div class="note">Score = share of each group items that mention the topic, averaged over groups by weight. Click a topic to see the items behind it.' + (d.baselineOk ? '' : ' Too little earlier data to say what is rising yet.') + '</div>';
  reportSize();
}

root.addEventListener('click', function (e) {
  var t = e.target.closest && e.target.closest('[data-term],[data-days],[data-view],[data-more]');
  if (!t) return;
  if (t.hasAttribute('data-term')) openTerm(t.getAttribute('data-term'));
  else if (t.hasAttribute('data-days')) { st.days = +t.getAttribute('data-days'); reload(); }
  else if (t.hasAttribute('data-view')) { st.view = t.getAttribute('data-view'); draw(); }
  else if (t.hasAttribute('data-more')) { st.showAll = !st.showAll; draw(); }
});
root.addEventListener('change', function (e) {
  var t = e.target;
  if (t.hasAttribute('data-board')) { st.board = t.value; reload(); }
  else if (t.hasAttribute('data-steady')) { st.steady = t.checked; reload(); }
});

function reportSize() {
  send({ method: 'ui/notifications/size-changed', params: { width: Math.ceil(window.innerWidth), height: Math.ceil(document.documentElement.getBoundingClientRect().height) } });
}
function setTheme(theme) { if (theme) document.documentElement.setAttribute('data-theme', theme); }

window.addEventListener('message', function (e) {
  var m = e.data, fn;
  if (!m) return;
  if (m.id === 1) {
    if (m.error) { s.textContent = 'initialize failed: ' + JSON.stringify(m.error); return; }
    setTheme(m.result && m.result.hostContext && m.result.hostContext.theme);
    send({ method: 'ui/notifications/initialized' });
    reportSize();
    new ResizeObserver(reportSize).observe(document.body);
  } else if (m.id && pending[m.id]) {
    fn = pending[m.id]; delete pending[m.id]; fn(m);
  } else if (m.method === 'ui/notifications/tool-result') {
    try {
      var d = JSON.parse(m.params.content[0].text);
      st.data = d; st.days = d.days; st.board = d.board || ''; st.open = null; st.proof = null; s.textContent = ''; draw();
    } catch (err) { s.textContent = 'No signal data in this result: ' + err.message; }
  } else if (m.method === 'ui/notifications/host-context-changed') {
    setTheme(m.params && m.params.theme);
  }
});
send({ id: 1, method: 'ui/initialize', params: { appInfo: { name: 'tweet-explorer-signal', version: '0.2.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' } });
</script></body></html>`;
