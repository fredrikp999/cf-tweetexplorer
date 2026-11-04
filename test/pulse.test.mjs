// Research pulse. The windows here are real: papers per week from arXiv, 2026-07-01 to 2026-10-28.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fieldSurge, pulseOf, pulseWindows, pulseWork, windowStart, DEFAULT_PULSE_TOPICS, CHART_WEEKS } from '../src/signal/pulse.ts';
import { arxivSearchQuery } from '../src/sources/arxiv.ts';

const ENDS = ['07-07', '07-14', '07-21', '07-28', '08-04', '08-11', '08-18', '08-25', '09-01', '09-08', '09-15', '09-22', '09-29', '10-06', '10-13', '10-20', '10-27', '11-03'].map((d) => `2026-${d}`);
const BASE = [1882, 1737, 1664, 1831, 2377, 2176, 1872, 2023, 2337, 2047, 2143, 2059, 4252, 3487, 3239, 2919, 2417, 2288];
const TOPICS = {
  agents: [243, 243, 225, 210, 381, 330, 262, 276, 338, 279, 247, 280, 609, 521, 442, 502, 440, 360],
  evals: [58, 60, 73, 65, 111, 93, 71, 88, 105, 79, 70, 73, 142, 123, 101, 125, 100, 85],
  safety: [23, 33, 34, 35, 40, 44, 34, 44, 60, 46, 43, 40, 70, 65, 44, 66, 52, 43],
  llms: [298, 321, 296, 318, 484, 392, 337, 385, 476, 378, 353, 355, 615, 545, 486, 513, 417, 376],
};
const upTo = (ns, i) => ns.slice(0, i + 1).map((n, k) => ({ end: ENDS[k], n, base: BASE[k] }));
// The state of a topic in every week that has a full history behind it, as it would have looked that week.
const states = (ns) => ns.map((_, i) => [ENDS[i], pulseOf(upTo(ns, i))]).filter(([, r]) => r.state !== 'building');

describe('the pulse on 18 weeks of real data', () => {
  test('the week the whole field doubled is not a spike in any topic', () => {
    assert.ok(fieldSurge(BASE.slice(0, 13)).surge);
    for (const ns of Object.values(TOPICS)) assert.notEqual(pulseOf(upTo(ns, 12)).state, 'spike');
  });
  test('raw counts would have flagged that week: this is why it uses the share', () => {
    const counts = TOPICS.agents.slice(4, 12).sort((a, b) => a - b), median = (counts[3] + counts[4]) / 2;
    assert.ok(TOPICS.agents[12] / median > 2);
  });
  test('Agents growing in October is a spike, and sustained the week after', () => {
    const oct20 = pulseOf(upTo(TOPICS.agents, 15)), oct27 = pulseOf(upTo(TOPICS.agents, 16));
    assert.equal(oct20.state, 'spike'); assert.equal(oct20.sustained, false); assert.ok(oct20.ratio > 1.25);
    assert.equal(oct27.state, 'spike'); assert.equal(oct27.sustained, true);
  });
  test('spikes stay rare, and steady topics stay quiet', () => {
    const spikes = Object.fromEntries(Object.entries(TOPICS).map(([k, ns]) => [k, states(ns).filter(([, r]) => r.state === 'spike').map(([e]) => e)]));
    assert.deepEqual(spikes, { agents: ['2026-10-20', '2026-10-27'], evals: [], safety: ['2026-09-01'], llms: [] });
  });
  test('a small dip is not called falling', () => {
    assert.notEqual(pulseOf(upTo(TOPICS.agents, 10)).state, 'falling');
  });
});

describe('the pulse rules', () => {
  const flat = (n, base = 1000, weeks = 8) => Array.from({ length: weeks }, (_, k) => ({ end: `2026-01-${String(k + 1).padStart(2, '0')}`, n: n + (k % 2), base }));
  test('it says it is still building rather than guessing', () => {
    const r = pulseOf(flat(50, 1000, 5));
    assert.equal(r.state, 'building'); assert.equal(pulseOf([]).state, 'building');
  });
  test('a gap in the history is not filled in', () => {
    const w = [...flat(50), { end: '2026-02-01', n: 120, base: 1000 }];
    w[3] = { ...w[3], base: 0 };
    assert.equal(pulseOf(w).state, 'building');
  });
  test('a few extra papers on very few is not a spike', () => {
    assert.notEqual(pulseOf([...flat(4), { end: '2026-02-01', n: 15, base: 1000 }]).state, 'spike');
  });
  test('rising, spike and falling', () => {
    assert.equal(pulseOf([...flat(50), { end: '2026-02-01', n: 90, base: 1000 }]).state, 'spike');
    assert.equal(pulseOf([...flat(50), { end: '2026-02-01', n: 57, base: 1000 }]).state, 'rising');
    assert.equal(pulseOf([...flat(50), { end: '2026-02-01', n: 25, base: 1000 }]).state, 'falling');
    assert.equal(pulseOf([...flat(50), { end: '2026-02-01', n: 51, base: 1000 }]).state, 'normal');
  });
  test('the newest window ends two days ago, and windows are whole weeks apart', () => {
    const ends = pulseWindows(Date.UTC(2026, 10, 4, 15));
    assert.equal(ends[0], '2026-11-02'); assert.equal(ends[1], '2026-10-26'); assert.equal(ends.length, CHART_WEEKS);
    assert.equal(windowStart('2026-11-02'), '2026-10-27');
  });
  test('what is left to read: new counts, and unsettled ones at most once a day', () => {
    const now = Date.UTC(2026, 10, 4), end = '2026-11-02', old = '2026-10-01';
    assert.deepEqual(pulseWork(['a'], [end], new Map(), now), [{ topic: 'a', end }]);
    assert.deepEqual(pulseWork(['a'], [end], new Map([[`a\n${end}`, '2026-11-04']]), now), []);
    assert.deepEqual(pulseWork(['a'], [end], new Map([[`a\n${end}`, '2026-11-03']]), now), [{ topic: 'a', end }]);
    assert.deepEqual(pulseWork(['a'], [old], new Map([[`a\n${old}`, '2026-10-20']]), now), []);
  });
  test('the default topics are searches arXiv accepts as written, within the length limit', () => {
    for (const t of DEFAULT_PULSE_TOPICS) { assert.equal(arxivSearchQuery(t.query), t.query); assert.ok(t.query.length <= 300, t.id); }
  });
});
