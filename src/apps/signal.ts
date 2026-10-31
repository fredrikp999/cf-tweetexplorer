// The Signal view for the get_signal tool (MCP Apps): a plain page that speaks the ui/* postMessage protocol directly and draws the tool's JSON result.
// Same approach as costs.ts (no SDK, no bundler; see the mcp-app skill and that file for why).
// The result it draws: { days, from, to, baselineOk, groups: [{ key, name, weight, items, perDay }], lists: { top, rising, shared, single }, terms: { [term]: { signal, change, isNew, kind, topGroup, breadth, active, groups: [{ key, part }] } } }.
// The window buttons ask the host to call get_signal again with another number of days.
export default `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mut:#6b6b6b;--line:#e2e2e2;--ac:#c9265f}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f2f2f2;--mut:#9a9a9a;--line:#38383a;--ac:#ff6b97}}
:root[data-theme=light]{--bg:#fff;--fg:#1a1a1a;--mut:#6b6b6b;--line:#e2e2e2;--ac:#c9265f}
:root[data-theme=dark]{--bg:#1c1c1e;--fg:#f2f2f2;--mut:#9a9a9a;--line:#38383a;--ac:#ff6b97}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{margin:0;font-size:22px}h1 small{font-size:13px;font-weight:400;color:var(--mut)}
h2{font-size:14px;margin:18px 0 6px}
.range{margin:12px 0 0}button{font:inherit;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:6px;padding:4px 10px;margin-right:6px;cursor:pointer}
button.on{border-color:var(--ac);color:var(--ac)}button:disabled{opacity:.5;cursor:default}
.groups{display:flex;flex-wrap:wrap;gap:6px 14px;margin:12px 0;color:var(--mut);font-size:12px}.groups i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.row{display:grid;grid-template-columns:minmax(90px,170px) minmax(0,1fr) 44px;gap:10px;align-items:center;padding:3px 0}
.row .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.row .t small{display:block;font-weight:400;font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis}.hl{font-size:12px;color:var(--mut);margin:0 0 4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row .v{text-align:right;color:var(--mut);font-size:12px}
.bar{display:flex;height:14px;border-radius:3px;overflow:hidden}.bar b{display:block;min-width:2px}
.chip{display:inline-block;font-size:11px;padding:0 7px;margin:0 4px 0 0;border:1px solid var(--line);border-radius:99px;color:var(--mut)}
.chip.up{color:var(--ac);border-color:var(--ac)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.li{display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid var(--line)}.li small{color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#s,.note{color:var(--mut)}.note{font-size:12px;margin-top:10px}
</style></head><body>
<div id="s">waiting for data</div><div id="root"></div>
<script>
var RANGES = [1, 3, 7, 14], TOOL = 'get_signal';
var PAL = ['#2f6fed', '#e8833a', '#2aa06b', '#a259d9', '#d6336c', '#0ca678', '#868e96', '#e8590c'];
var s = document.getElementById('s'), root = document.getElementById('root');
var send = function (m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); };
var esc = function (v) { var d = document.createElement('div'); d.textContent = String(v == null ? '' : v); return d.innerHTML; };
var pct = function (x) { var p = x * 100; return (p < 10 ? p.toFixed(1) : Math.round(p)) + '%'; };
var pending = {}, nextId = 2, current = 7, buttons = [];

function chips(t, name) {
  var c = '';
  if (t.active > 1) c += t.kind === 'shared' ? '<span class="chip">everywhere</span>' : t.kind === 'single' ? '<span class="chip">only ' + esc(name(t.topGroup)) + '</span>' : '<span class="chip">mixed</span>';
  if (t.isNew) c += '<span class="chip up">new</span>'; else if (t.change !== null && t.change >= 1.5) c += '<span class="chip up">up x' + t.change.toFixed(1) + '</span>';
  return c;
}

function render(d) {
  var color = {}, names = {}, i, g, html = '', top = d.lists.top.slice(0, 20), max = 0.000001, t, n;
  for (i = 0; i < d.groups.length; i++) { g = d.groups[i]; color[g.key] = PAL[i % PAL.length]; names[g.key] = g.name; }
  var name = function (k) { return names[k] || k; };
  for (i = 0; i < top.length; i++) max = Math.max(max, d.terms[top[i]].signal);
  var legend = '', rows = '', list = function (title, keys, note) {
    var out = '<div><h2>' + title + '</h2>', j;
    for (j = 0; j < keys.length && j < 8; j++) out += '<div class="li"><span>' + esc(d.terms[keys[j]].label || keys[j]) + '</span><small>' + esc(note(d.terms[keys[j]])) + '</small></div>';
    return out + (keys.length ? '' : '<div class="note">Nothing yet.</div>') + '</div>';
  };
  for (i = 0; i < d.groups.length; i++) {
    g = d.groups[i];
    legend += '<span><i style="background:' + color[g.key] + '"></i>' + esc(g.name) + ' - ' + esc(g.items) + ' items' + (g.weight === 1 ? '' : g.weight === 0 ? ' (off)' : ' (x' + esc(g.weight) + ')') + '</span>';
  }
  for (i = 0; i < top.length; i++) {
    t = d.terms[top[i]]; n = '';
    for (var j = 0; j < t.groups.length; j++) if (t.groups[j].part >= 0.02) n += '<b style="flex:' + t.groups[j].part.toFixed(3) + ';background:' + color[t.groups[j].key] + '" title="' + esc(name(t.groups[j].key)) + '"></b>';
    rows += '<div class="row"><span class="t" title="' + esc(top[i]) + '">' + esc(t.label || top[i]) + (t.related && t.related.length ? '<small>' + esc(t.related.join(' / ')) + '</small>' : '') + '</span><span><span class="bar" style="width:' + Math.max(2, t.signal / max * 100).toFixed(1) + '%">' + n + '</span>' + chips(t, name) + '</span><span class="v">' + pct(t.signal) + '</span></div>' + (t.headlines && t.headlines[0] ? '<div class="hl">' + esc(t.headlines[0].title) + ' <span class="note">' + esc(t.headlines[0].by) + '</span></div>' : '');
  }
  current = d.days;
  s.textContent = '';
  root.innerHTML = '<h1>Signal <small>' + esc(d.from) + (d.from === d.to ? '' : ' to ' + esc(d.to)) + '</small></h1><div class="groups">' + (legend || 'No groups yet') + '</div>'
    + (rows ? '<div>' + rows + '</div>' : '<div class="note">No term is mentioned often enough yet.</div>')
    + '<div class="cols">' + list('Everywhere', d.lists.shared, function (x) { return x.breadth + ' of ' + x.active + ' groups'; })
    + list('Only in one group', d.lists.single.filter(function (k) { return d.terms[k].active > 1; }), function (x) { return name(x.topGroup); })
    + list('Rising', d.lists.rising, function (x) { return x.isNew ? 'new' : 'x' + x.change.toFixed(1); }) + '</div>'
    + '<div class="note">Score = share of each group\\'s items that mention the term, averaged over groups by weight.' + (d.baselineOk ? '' : ' Too little earlier data to say what is rising yet.') + '</div>';
  for (i = 0; i < buttons.length; i++) buttons[i].className = RANGES[i] === current ? 'on' : '';
  reportSize();
}

function addButtons() {
  var bar = document.createElement('div'), i;
  bar.className = 'range';
  for (i = 0; i < RANGES.length; i++) (function (n) {
    var b = document.createElement('button');
    b.textContent = n === 1 ? 'Today' : n + ' days';
    b.onclick = function () { load(n); };
    buttons.push(b); bar.appendChild(b);
  })(RANGES[i]);
  document.body.insertBefore(bar, root);
}

function load(days) {
  var id = nextId++, i, timer;
  for (i = 0; i < buttons.length; i++) buttons[i].disabled = true;
  var done = function (err, res) {
    for (i = 0; i < buttons.length; i++) buttons[i].disabled = false;
    if (err) { s.textContent = 'Could not load ' + days + ' days: ' + err.message; return; }
    try { render(JSON.parse(res.content[0].text)); } catch (e) { s.textContent = 'Could not read the result: ' + e.message; }
  };
  timer = setTimeout(function () { delete pending[id]; done(new Error('no reply from the host')); }, 15000);
  pending[id] = function (m) { clearTimeout(timer); done(m.error ? new Error(m.error.message || 'error') : null, m.result); };
  send({ id: id, method: 'tools/call', params: { name: TOOL, arguments: { days: days } } });
}

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
    try { if (!buttons.length) addButtons(); render(JSON.parse(m.params.content[0].text)); } catch (err) { s.textContent = 'No signal data in this result: ' + err.message; }
  } else if (m.method === 'ui/notifications/host-context-changed') {
    setTheme(m.params && m.params.theme);
  }
});
send({ id: 1, method: 'ui/initialize', params: { appInfo: { name: 'tweet-explorer-signal', version: '0.1.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' } });
</script></body></html>`;
