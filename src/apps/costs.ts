// The Costs view for the get_costs tool: runs inside the host's sandboxed iframe (MCP Apps) and draws the tool's result.
// Bundled into one HTML string by scripts/build-apps.mjs; edit this file, not src/apps/costs.html.ts.
import { App } from '@modelcontextprotocol/ext-apps';

type Row = { day?: string; kind?: string; twitter: number; llm: number; audio: number; image: number };
type Summary = { days: number; since: string; totals: Row & { tweets: number; calls: number }; byDay: Row[]; byKind: Row[] };

const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const total = (r: Row) => r.twitter + r.llm + r.audio + r.image;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const root = document.getElementById('root')!;

function render(s: Summary) {
  const t = s.totals, max = Math.max(...s.byDay.map(total), 0.0001);
  const bars = s.byDay.map((d) => `<div class="bar" title="${esc(d.day ?? '')}: ${money(total(d))}" style="height:${Math.max(2, (total(d) / max) * 100)}%"></div>`).join('');
  const kinds = s.byKind.map((k) => `<tr><td>${esc(k.kind ?? '')}</td><td>${money(k.twitter)}</td><td>${money(k.llm)}</td><td>${money(k.audio + k.image)}</td><td><b>${money(total(k))}</b></td></tr>`).join('');
  root.innerHTML = `
    <h1>${money(total(t))} <small>over ${s.days} days since ${esc(s.since)}</small></h1>
    <p class="sub">twitterapi.io ${money(t.twitter)} · models ${money(t.llm)} · audio ${money(t.audio)} · pictures ${money(t.image)} · ${t.tweets} tweets</p>
    <div class="chart">${bars}</div>
    <table><thead><tr><th>Feature</th><th>X data</th><th>Models</th><th>Media</th><th>Total</th></tr></thead><tbody>${kinds}</tbody></table>`;
}

const app = new App({ name: 'tweet-explorer-costs', version: '0.1.0' });
app.ontoolresult = (result) => {
  const block = result.content?.find((c) => c.type === 'text');
  try { render(JSON.parse(block && 'text' in block ? block.text : '')); } catch { root.textContent = 'No cost data in this result.'; }
};
app.onhostcontextchanged = (ctx) => { if (ctx.theme) document.documentElement.dataset.theme = ctx.theme; };
await app.connect();
const theme = app.getHostContext()?.theme;
if (theme) document.documentElement.dataset.theme = theme;
