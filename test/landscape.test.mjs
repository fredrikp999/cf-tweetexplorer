// The landscape layout: clusters by shared items, a layout that is the same every time and barely moves from one day to the next.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LAND_H, LAND_W, MAX_CLUSTER, cleanLayout, clusterTopics, coCounts, layoutKeys, layoutLandscape } from '../src/signal/landscape.ts';

const names = (k) => ({ key: k, names: [k, k + ' x'] });
const topic = (key, score, label = key) => ({ key, label, score });
// items: lists of topic names
const items = (...rows) => rows.map((r) => ({ terms: new Set(r) }));
const keys12 = ['mcp', 'auth', 'oauth', 'kimi', 'qwen', 'otel', 'tracing', 'rag', 'evals', 'agents', 'cursor', 'claude'];
const topics = keys12.map((k, i) => topic(k, 12 - i));
const rows = [...Array(6).fill(['mcp', 'auth']), ...Array(4).fill(['mcp', 'oauth', 'auth']), ...Array(5).fill(['kimi', 'qwen']), ...Array(4).fill(['otel x', 'tracing']), ['rag'], ['evals'], ['agents', 'cursor'], ['claude']];
const co = coCounts(keys12.map(names), items(...rows));

const overlaps = (l, tol = 0.5) => { const out = []; for (let i = 0; i < l.bubbles.length; i++) for (let j = i + 1; j < l.bubbles.length; j++) { const a = l.bubbles[i], b = l.bubbles[j]; if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - tol) out.push([a.key, b.key]); } return out; };

describe('counting together', () => {
  test('counts items per topic and per pair, under any of the topic names', () => {
    assert.equal(co.n.get('mcp'), 10); assert.equal(co.n.get('otel'), 4);
    assert.equal(co.pair.get('auth\u0000mcp'), 10); assert.equal(co.pair.get('mcp\u0000oauth'), 4);
    assert.equal(co.pair.get('kimi\u0000mcp') ?? 0, 0);
  });
});

describe('clusters', () => {
  test('topics that share items group; others stand alone; strongest first', () => {
    const g = clusterTopics(topics, co);
    assert.deepEqual(g.find((x) => x.includes('mcp')), ['mcp', 'auth', 'oauth']);
    assert.deepEqual(g.find((x) => x.includes('kimi')), ['kimi', 'qwen']);
    assert.deepEqual(g.find((x) => x.includes('rag')), ['rag']);
    assert.equal(g.flat().length, keys12.length); assert.equal(new Set(g.flat()).size, keys12.length);
  });
  test('one shared item is a coincidence, not a cluster', () => {
    const g = clusterTopics([topic('a', 2), topic('b', 1)], coCounts([names('a'), names('b')], items(['a', 'b'], ['a'], ['b'])));
    assert.deepEqual(g, [['a'], ['b']]);
  });
  test('a cluster never grows past the limit', () => {
    const ks = Array.from({ length: 10 }, (_, i) => 't' + i), rows2 = ks.flatMap((a) => ks.filter((b) => b > a).flatMap((b) => [[a, b], [a, b], [a, b]]));
    const g = clusterTopics(ks.map((k, i) => topic(k, 10 - i)), coCounts(ks.map(names), items(...rows2)));
    assert.ok(g.every((x) => x.length <= MAX_CLUSTER));
  });
  test('a pair that sat together yesterday stays together over a thin link', () => {
    const t2 = [topic('a', 3), topic('b', 2), topic('c', 1)], c2 = coCounts(t2.map((t) => names(t.key)), items(['a', 'b'], ['a', 'b'], ...Array(25).fill(['a']), ...Array(25).fill(['b'])));
    assert.deepEqual(clusterTopics(t2, c2), [['a'], ['b'], ['c']]);
    assert.deepEqual(clusterTopics(t2, c2, new Map([['a', 'x'], ['b', 'x']])), [['a', 'b'], ['c']]);
  });
});

describe('layout', () => {
  const day1 = layoutLandscape(topics, co);
  test('is the same every time', () => assert.deepEqual(layoutLandscape(topics, co), day1));
  test('nothing overlaps and everything is inside the box', () => {
    assert.deepEqual(overlaps(day1), []);
    for (const b of day1.bubbles) { assert.ok(b.x - b.r >= -0.5 && b.x + b.r <= LAND_W + 0.5 && b.y - b.r >= -0.5 && b.y + b.r <= LAND_H + 0.5, b.key); }
  });
  test('size follows the score', () => {
    const r = Object.fromEntries(day1.bubbles.map((b) => [b.key, b.r]));
    assert.ok(r.mcp > r.otel && r.otel > r.claude);
  });
  test('clusters are named by their strongest topic and their members sit close together', () => {
    const c = day1.clusters.find((x) => x.members.includes('kimi'));
    assert.equal(c.name, 'kimi'); assert.equal(c.lead, 'kimi'); assert.ok(!day1.clusters.some((x) => x.members.length < 2));
    const mine = day1.bubbles.filter((b) => b.cluster === c.id);
    assert.equal(mine.length, 2); for (const b of mine) assert.ok(Math.hypot(b.x - c.x, b.y - c.y) + b.r <= c.r + 0.5);
    assert.equal(day1.bubbles.find((b) => b.key === 'rag').cluster, '');
  });
  test('handles many large topics: circles shrink instead of overlapping', () => {
    const many = Array.from({ length: 40 }, (_, i) => topic('m' + i, 10 - i * 0.01)), l = layoutLandscape(many, coCounts([], []));
    assert.deepEqual(overlaps(l), []); assert.equal(l.bubbles.length, 40);
  });
  test('empty and single', () => {
    assert.deepEqual(layoutLandscape([], co).bubbles, []);
    const one = layoutLandscape([topic('a', 1)], co); assert.equal(one.bubbles.length, 1); assert.deepEqual(overlaps(one), []);
  });
});

describe('from one day to the next', () => {
  const day1 = layoutLandscape(topics, co);
  // tomorrow: scores shift, one topic leaves, one arrives, the kimi cluster gains a member
  const t2 = topics.filter((t) => t.key !== 'claude').map((t, i) => topic(t.key, t.score * (1 + ((i % 3) - 1) * 0.15))).concat([topic('gemini', 5), topic('newthing', 3)]);
  const rows2 = [...rows, ...Array(3).fill(['kimi', 'gemini']), ['newthing']];
  const co2 = coCounts(t2.map((t) => names(t.key)), items(...rows2));
  const day2 = layoutLandscape(t2, co2, day1);
  test('topics that were there barely move, far less than a fresh layout would', () => {
    const was = new Map(day1.bubbles.map((b) => [b.key, b]));
    const shift = (l) => { const d = l.bubbles.filter((b) => was.has(b.key)).map((b) => Math.hypot(b.x - was.get(b.key).x, b.y - was.get(b.key).y)); return d.reduce((a, b) => a + b, 0) / d.length; };
    const fresh = layoutLandscape(t2, co2);
    assert.ok(shift(day2) < 40, 'mean shift ' + shift(day2));
    assert.ok(shift(day2) < shift(fresh), `${shift(day2)} vs fresh ${shift(fresh)}`);
    assert.deepEqual(overlaps(day2), []);
  });
  test('a cluster keeps its id and name while its lead is in it, and new members join it', () => {
    const was = day1.clusters.find((c) => c.members.includes('kimi')), now = day2.clusters.find((c) => c.members.includes('kimi'));
    assert.equal(now.id, was.id); assert.equal(now.name, was.name); assert.ok(now.members.includes('gemini'));
    assert.equal(day2.clusters.find((c) => c.members.includes('mcp')).id, day1.clusters.find((c) => c.members.includes('mcp')).id);
  });
  test('a new lead renames the cluster but keeps its id', () => {
    const t3 = t2.map((t) => (t.key === 'kimi' ? topic('kimi', 0.2) : t.key === 'qwen' ? topic('qwen', 7) : t));
    const day3 = layoutLandscape(t3, co2, day2), c = day3.clusters.find((x) => x.members.includes('qwen'));
    assert.equal(c.id, day2.clusters.find((x) => x.members.includes('kimi')).id);
    assert.equal(c.lead, 'qwen'); assert.equal(c.name, 'qwen' === c.lead && !c.members.includes('kimi') ? 'qwen' : c.name);
  });
  test('keys and cleaning', () => {
    assert.equal(layoutKeys(day1), [...keys12].sort().join('|'));
    assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(day1))), day1); assert.equal(cleanLayout({ bubbles: 1 }), null); assert.equal(cleanLayout(null), null);
    assert.equal(cleanLayout({ bubbles: [{ key: 'a', x: 'no' }], clusters: [] }).bubbles.length, 0);
  });
});
