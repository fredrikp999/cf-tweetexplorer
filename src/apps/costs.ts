// The Costs view for the get_costs tool (MCP Apps): a plain page that speaks the ui/* postMessage protocol directly and draws the tool's JSON result.
// It is built exactly like hello.ts, the shape the host is known to render: classic inline script, ASCII only, no "$" characters, no build step.
// The summary it draws: { days, since, totals: { twitter, llm, audio, image, tweets, calls }, byDay: [{ day, ... }], byKind: [{ kind, ... }] }.
export default `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mut:#6b6b6b;--bar:#2f6fed;--line:#e2e2e2}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f2f2f2;--mut:#9a9a9a;--bar:#6a9bff;--line:#38383a}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{margin:0;font-size:26px}h1 small{font-size:13px;font-weight:400;color:var(--mut)}.sub{margin:4px 0 16px;color:var(--mut)}
.chart{display:flex;align-items:flex-end;gap:2px;height:90px;margin-bottom:16px}.bar{flex:1;background:var(--bar);border-radius:2px 2px 0 0;min-width:2px}
table{width:100%;border-collapse:collapse}th,td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--line)}th:first-child,td:first-child{text-align:left}th{color:var(--mut);font-weight:500}
</style></head><body>
<div id="s">waiting for data</div><div id="root"></div>
<script>
var s = document.getElementById('s'), root = document.getElementById('root');
var send = function (m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); };
var DOLLAR = String.fromCharCode(36);
var money = function (n) { return DOLLAR + n.toFixed(n < 1 ? 3 : 2); };
var total = function (r) { return r.twitter + r.llm + r.audio + r.image; };
var esc = function (v) { var d = document.createElement('div'); d.textContent = String(v == null ? '' : v); return d.innerHTML; };

function render(d) {
  var t = d.totals, max = 0.0001, bars = '', kinds = '', i, r;
  for (i = 0; i < d.byDay.length; i++) max = Math.max(max, total(d.byDay[i]));
  for (i = 0; i < d.byDay.length; i++) {
    r = d.byDay[i];
    bars += '<div class="bar" title="' + esc(r.day) + ': ' + money(total(r)) + '" style="height:' + Math.max(2, total(r) / max * 100) + '%"></div>';
  }
  for (i = 0; i < d.byKind.length; i++) {
    r = d.byKind[i];
    kinds += '<tr><td>' + esc(r.kind) + '</td><td>' + money(r.twitter) + '</td><td>' + money(r.llm) + '</td><td>' + money(r.audio + r.image) + '</td><td><b>' + money(total(r)) + '</b></td></tr>';
  }
  s.textContent = '';
  root.innerHTML = '<h1>' + money(total(t)) + ' <small>over ' + esc(d.days) + ' days since ' + esc(d.since) + '</small></h1>'
    + '<p class="sub">twitterapi.io ' + money(t.twitter) + ' - models ' + money(t.llm) + ' - audio ' + money(t.audio) + ' - pictures ' + money(t.image) + ' - ' + esc(t.tweets) + ' tweets</p>'
    + '<div class="chart">' + bars + '</div>'
    + '<table><thead><tr><th>Feature</th><th>X data</th><th>Models</th><th>Media</th><th>Total</th></tr></thead><tbody>' + kinds + '</tbody></table>';
}

function reportSize() {
  send({ method: 'ui/notifications/size-changed', params: { width: Math.ceil(window.innerWidth), height: Math.ceil(document.documentElement.getBoundingClientRect().height) } });
}

window.addEventListener('message', function (e) {
  var m = e.data;
  if (m && m.id === 1) {
    if (m.error) { s.textContent = 'initialize failed: ' + JSON.stringify(m.error); return; }
    send({ method: 'ui/notifications/initialized' });
    reportSize();
    new ResizeObserver(reportSize).observe(document.body);
  } else if (m && m.method === 'ui/notifications/tool-result') {
    try { render(JSON.parse(m.params.content[0].text)); } catch (err) { s.textContent = 'No cost data in this result: ' + err.message; }
  }
});
send({ id: 1, method: 'ui/initialize', params: { appInfo: { name: 'tweet-explorer-costs', version: '0.2.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' } });
</script></body></html>`;
