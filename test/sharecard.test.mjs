// The picture a shared topic link shows: the SVG it is drawn from (the PNG step needs WebAssembly and runs in the Worker).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { latinOnly, shareCardSvg, wrapLines } from '../src/site/shareCard.ts';

const days = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
const card = (o = {}) => shareCardSvg({ label: 'MCP auth bypass', area: 'ai', state: 'rising', change: 2.4, series: { days, counts: [2, 8, 14, 12, 6, 1, 0, 0, 1, 2, 6, 10, 12, 11] }, host: 'example.net', ...o });

describe('share card', () => {
  test('names the topic, its state, its phase and the host, at 1200×630', () => {
    const s = card();
    assert.match(s, /width="1200" height="630"/);
    assert.match(s, />MCP auth bypass</);
    assert.match(s, />RISING ×2\.4</);
    assert.match(s, />BACK AGAIN</);
    assert.match(s, />85 mentions in 14 days</);
    assert.match(s, />example\.net</);
  });
  test('escapes the name and keeps only what the bundled font can draw', () => {
    assert.match(card({ label: 'A <b> & "c"' }), />A &lt;b&gt; &amp; &quot;c&quot;</);
    assert.equal(latinOnly('GPT-5 日本語 café'), 'GPT-5 café');
    assert.match(card({ label: '日本語' }), />Topic</);
  });
  test('a long name takes two lines at most, cut with an ellipsis', () => {
    const lines = wrapLines('one two three four five six seven eight nine ten', 10, 2);
    assert.equal(lines.length, 2);
    assert.ok(lines[1].endsWith('…'));
    const s = card({ label: 'Claude Opus 5.5 agentic coding benchmarks and the SWE-bench Verified leaderboard and more words still' });
    assert.equal((s.match(/font-weight="800" letter-spacing="-1.5"/g) ?? []).length, 2);
  });
  test('a topic with too little to say draws no phase, and a politics card says so', () => {
    const s = card({ series: { days, counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1] }, state: null, area: 'politics' });
    assert.doesNotMatch(s, /EMERGING|FADING|STEADY|BACK AGAIN|AT ITS PEAK/);
    assert.match(s, /in politics, before/);
  });
});
