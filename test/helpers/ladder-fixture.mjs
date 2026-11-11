// A made-up fortnight for the Ladder: scores per day for a dozen topics with different lives.
import { LADDER_DAYS, ladderOf } from '../../src/signal/ladder.ts';
import { dayList } from './depth-fixture.mjs';

const wave = (peak, width, height, floor = 0) => Array.from({ length: LADDER_DAYS }, (_, d) => floor + height * Math.exp(-((d - peak) ** 2) / (2 * width * width)));
const flat = (v, wobble = 0) => Array.from({ length: LADDER_DAYS }, (_, d) => v + wobble * Math.sin(d * 1.3));
export const LADDER_TOPICS = [
  ['claude-code', 'Claude Code', flat(0.2, 0.01)],
  ['mcp-auth-bypass', 'MCP auth bypass', Array.from({ length: LADDER_DAYS }, (_, d) => (d < 8 ? 0 : 0.05 * (d - 7) ** 1.25))],
  ['open-weights', 'Open-weight coding model', wave(6, 2.2, 0.26, 0.03)],
  ['agent-memory', 'Agent memory', flat(0.12, 0.02)],
  ['prompt-injection', 'Prompt injection', flat(0.1, 0.03)],
  ['browser-agents', 'Browser agents', Array.from({ length: LADDER_DAYS }, (_, d) => 0.03 + d * 0.011)],
  ['rag', 'RAG pipelines', Array.from({ length: LADDER_DAYS }, (_, d) => (d > 9 ? 0 : 0.19 - d * 0.02))],
  ['eval-leakage', 'Eval leakage', wave(11, 1.6, 0.13, 0.01)],
  ['small-models', 'Small models on device', flat(0.07, 0.015)],
  ['gpu-export-rules', 'GPU export rules', wave(3, 1.5, 0.15, 0.02)],
  ['otel-llm-spans', 'OpenTelemetry LLM spans', flat(0.045, 0.01)],
  ['vibe-ops', 'Vibe ops', Array.from({ length: LADDER_DAYS }, (_, d) => (d < 11 ? 0 : 0.06))],
];
export function ladderFixture(top = 10) {
  const l = ladderOf(LADDER_TOPICS.map(([key, label, scores]) => ({ key, label, scores })), top);
  return { ...l, days: dayList(), baselineOk: true, meta: l.topics.map((t) => ({ key: t.key, term: t.label.toLowerCase(), members: [], isNew: t.key === 'vibe-ops', change: 1 })) };
}
