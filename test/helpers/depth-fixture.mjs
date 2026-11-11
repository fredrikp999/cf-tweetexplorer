// A made-up fortnight for the Depth chart: sources of four kinds in five groups, and topics with different lives (always everywhere, climbing, niche, new, gone).
import { DEPTH_DAYS, DEPTH_WINDOW, depthLayout, reachSeries } from '../../src/signal/depth.ts';

export const KINDS = ['x', 'hn', 'youtube', 'rss'];
export const info = new Map();
for (let i = 0; i < 60; i++) info.set('x' + i, { kind: 'x', group: i < 30 ? 'builders' : i < 45 ? 'researchers' : 'security' });
for (let i = 0; i < 6; i++) info.set('hn' + i, { kind: 'hn', group: 'hn' });
for (let i = 0; i < 8; i++) info.set('yt' + i, { kind: 'youtube', group: 'video' });
for (let i = 0; i < 26; i++) info.set('rss' + i, { kind: 'rss', group: i < 13 ? 'researchers' : 'security' });
export const WATCHED = { kinds: 4, groups: 5, sources: info.size };
const N = DEPTH_DAYS + DEPTH_WINDOW - 1;
/** Days of [source, mentions]: `plan(day)` gives the sources that mention the topic that day (day 0 is the oldest). */
export const life = (plan) => Array.from({ length: N }, (_, d) => plan(d - (DEPTH_WINDOW - 1)).map((w) => [w, 1]));
const some = (prefix, n, from = 0) => Array.from({ length: n }, (_, i) => prefix + (from + i));

export const TOPICS = [
  ['claude-code', 'Claude Code', 0.21, () => [...some('x', 28), ...some('hn', 4), ...some('yt', 5), ...some('rss', 14, 6)]],
  ['mcp-auth-bypass', 'MCP auth bypass', 0.13, (d) => (d < 6 ? [] : d < 9 ? some('x', 2, 46) : d < 11 ? [...some('x', 6, 44), ...some('rss', 3, 14)] : [...some('x', 16, 30), ...some('rss', 6, 12), ...some('hn', 3), ...some('yt', 1)])],
  ['eval-leakage', 'Eval leakage', 0.07, (d) => (d < 3 ? [] : d < 10 ? some('rss', 2) : [...some('rss', 5), ...some('x', 5, 30), ...some('hn', 1)])],
  ['open-weights', 'Open-weight coding model', 0.16, (d) => (d < 4 ? [] : [...some('x', 20), ...some('hn', 5), ...some('yt', 3), ...some('rss', 8)])],
  ['otel-llm-spans', 'OpenTelemetry LLM spans', 0.05, () => some('rss', 3, 2)],
  ['vibe-ops', 'Vibe ops', 0.04, (d) => (d < 12 ? [] : some('x', 3, 3))],
  ['rag', 'RAG pipelines', 0.09, (d) => (d < 8 ? [...some('x', 18), ...some('rss', 9), ...some('hn', 2), ...some('yt', 2)] : d < 11 ? [...some('x', 8), ...some('rss', 4)] : some('x', 3))],
  ['agent-memory', 'Agent memory', 0.11, () => [...some('x', 12), ...some('rss', 5), ...some('yt', 2)]],
  ['prompt-injection', 'Prompt injection', 0.1, () => [...some('x', 9, 45), ...some('rss', 8, 13), ...some('hn', 1)]],
  ['gpu-export-rules', 'GPU export rules', 0.06, (d) => (d < 7 ? [] : d < 12 ? some('rss', 4, 20) : [...some('rss', 6, 18), ...some('x', 4, 10)])],
  ['small-models', 'Small models on device', 0.08, () => [...some('x', 7, 30), ...some('yt', 3, 4)]],
  ['browser-agents', 'Browser agents', 0.12, (d) => [...some('x', 10 + d), ...some('hn', d > 9 ? 2 : 0), ...some('rss', 3)]],
];
export const dayList = (end = '2026-11-11') => Array.from({ length: DEPTH_DAYS }, (_, i) => new Date(Date.parse(end + 'T00:00:00Z') - (DEPTH_DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10));
export function rawFixture() {
  const layout = depthLayout(TOPICS.map(([key, label, score, plan]) => ({ key, label, score, reach: reachSeries(life(plan), info, KINDS) })), KINDS, WATCHED);
  return { ...layout, days: dayList(), baselineOk: true, meta: TOPICS.map(([key, label]) => ({ key, term: label.toLowerCase(), members: [], isNew: key === 'vibe-ops', change: key === 'mcp-auth-bypass' ? 2.4 : key === 'rag' ? 0.5 : 1 })) };
}
