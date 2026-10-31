// The Costs view for the get_costs tool (MCP Apps): a plain page that speaks the ui/* postMessage protocol directly and draws the tool's JSON result.
// No SDK and no bundler: bundling the ext-apps App class into the view hung the Claude app at "rendering widget" (see the mcp-app skill).
// The summary it draws: { days, since, totals: { twitter, llm, audio, image, tweets, calls }, byDay: [{ day, ... }], byKind: [{ kind, ... }] }.
// The range buttons ask the host to call get_costs again with another number of days.
export default `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mut:#6b6b6b;--line:#e2e2e2;--c1:#2f6fed;--c2:#e8833a;--c3:#2aa06b;--c4:#a259d9}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f2f2f2;--mut:#9a9a9a;--line:#38383a;--c1:#6a9bff;--c2:#f0a060;--c3:#4cc790;--c4:#c48af0}}
:root[data-theme=light]{--bg:#fff;--fg:#1a1a1a;--mut:#6b6b6b;--line:#e2e2e2;--c1:#2f6fed;--c2:#e8833a;--c3:#2aa06b;--c4:#a259d9}
:root[data-theme=dark]{--bg:#1c1c1e;--fg:#f2f2f2;--mut:#9a9a9a;--line:#38383a;--c1:#6a9bff;--c2:#f0a060;--c3:#4cc790;--c4:#c48af0}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{margin:0;font-size:26px}h1 small{font-size:13px;font-weight:400;color:var(--mut)}
.range{margin:12px 0 0}button{font:inherit;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:6px;padding:4px 10px;margin-right:6px;cursor:pointer}
button.on{border-color:var(--c1);color:var(--c1)}button:disabled{opacity:.5;cursor:default}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:12px 0}.card{border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.card b{display:block;font-size:18px}.card span{color:var(--mut);font-size:12px}
.axis{display:flex;justify-content:space-between;color:var(--mut);font-size:12px}
.legend{margin-top:6px}.legend span{margin-right:12px;color:var(--mut);font-size:12px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--line)}th:first-child,td:first-child{text-align:left}th{color:var(--mut);font-weight:500}
#s{color:var(--mut)}
</style></head><body>
<div id="s">waiting for data</div><div id="root"></div>
<script>
var RANGES = [2, 7, 30, 90], TOOL = 'get_costs';
var COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'], NAMES = ['twitterapi.io', 'models', 'audio', 'pictures'];
var s = document.getElementById('s'), root = document.getElementById('root');
var send = function (m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); };
var DOLLAR = String.fromCharCode(36);
var money = function (n) { return DOLLAR + n.toFixed(n < 1 ? 3 : 2); };
var parts = function (r) { return [r.twitter, r.llm, r.audio, r.image]; };
var total = function (r) { return r.twitter + r.llm + r.audio + r.image; };
var esc = function (v) { var d = document.createElement('div'); d.textContent = String(v == null ? '' : v); return d.innerHTML; };
var pending = {}, nextId = 2, current = 30, buttons = [];

function chart(byDay) {
  var W = 600, H = 120, n = byDay.length, max = 0.0001, svg = '', i, j, y, h, p, bw;
  for (i = 0; i < n; i++) max = Math.max(max, total(byDay[i]));
  bw = W / Math.max(n, 1);
  for (i = 0; i < n; i++) {
    p = parts(byDay[i]); y = H;
    for (j = 0; j < 4; j++) {
      h = p[j] / max * (H - 4); y -= h;
      if (h > 0) svg += '<rect x="' + (i * bw + 2) + '" y="' + y + '" width="' + Math.max(1, bw - 4) + '" height="' + h + '" fill="' + COLORS[j] + '"><title>' + esc(byDay[i].day) + ' ' + NAMES[j] + ' ' + money(p[j]) + '</title></rect>';
    }
  }
  var axis = n ? '<div class="axis"><span>' + esc(byDay[0].day) + '</span><span>' + esc(byDay[n - 1].day) + '</span></div>' : '';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img">' + svg + '</svg>' + axis;
}

function render(d) {
  var t = d.totals, i, r, kinds = '', cards = '', legend = '';
  for (i = 0; i < d.byKind.length; i++) {
    r = d.byKind[i];
    kinds += '<tr><td>' + esc(r.kind) + '</td><td>' + money(r.twitter) + '</td><td>' + money(r.llm) + '</td><td>' + money(r.audio + r.image) + '</td><td><b>' + money(total(r)) + '</b></td></tr>';
  }
  for (i = 0; i < 4; i++) {
    cards += '<div class="card"><b>' + money(parts(t)[i]) + '</b><span>' + NAMES[i] + '</span></div>';
    legend += '<span><i style="background:' + COLORS[i] + '"></i>' + NAMES[i] + '</span>';
  }
  current = d.days;
  s.textContent = '';
  root.innerHTML = '<h1>' + money(total(t)) + ' <small>over ' + esc(d.days) + ' days since ' + esc(d.since) + ' - ' + esc(t.tweets) + ' tweets</small></h1>'
    + '<div class="cards">' + cards + '</div>' + chart(d.byDay) + '<div class="legend">' + legend + '</div>'
    + '<table><thead><tr><th>Feature</th><th>X data</th><th>Models</th><th>Media</th><th>Total</th></tr></thead><tbody>' + kinds + '</tbody></table>';
  for (i = 0; i < buttons.length; i++) buttons[i].className = RANGES[i] === current ? 'on' : '';
  reportSize();
}

// Range buttons live above the data, so they stay put while render() replaces the rest.
function addButtons() {
  var bar = document.createElement('div'), i;
  bar.className = 'range';
  for (i = 0; i < RANGES.length; i++) (function (n) {
    var b = document.createElement('button');
    b.textContent = n + ' days';
    b.onclick = function () { load(n); };
    buttons.push(b); bar.appendChild(b);
  })(RANGES[i]);
  document.body.insertBefore(bar, root);
}

// Ask the host to call the tool again; it answers with the same JSON text the model got.
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
    try { if (!buttons.length) addButtons(); render(JSON.parse(m.params.content[0].text)); } catch (err) { s.textContent = 'No cost data in this result: ' + err.message; }
  } else if (m.method === 'ui/notifications/host-context-changed') {
    setTheme(m.params && m.params.theme);
  }
});
send({ id: 1, method: 'ui/initialize', params: { appInfo: { name: 'tweet-explorer-costs', version: '0.3.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' } });
</script></body></html>`;
