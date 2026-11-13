// Stories (docs/grouping-proposal.md): joining, the pool, births, the number veto, centres, lifecycle, names. Made-up vectors; a few real ones from the bge fixture.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  STORY_BIRTH_MIN, STORY_CLOSE_MS, STORY_FIX_MS, STORY_MERGE_SIM, STORY_POOL_MS, STORY_SIM, alike, assignItems, backgroundOf, cleanStoryName, findMerges, isNewStory, joinNames, needsRename,
  numberVeto, parseStoryName, storyStates, storySlug, storySystem, storyUser, typicalItems, updateCentre,
} from '../src/signal/stories.ts';
import { QUIET_MS } from '../src/signal/first.ts';
import real from './helpers/vectors-fixture.mjs';

function rnd(seed) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DIM = 48, HOUR = 3_600_000, NOW = Date.parse('2026-11-13T12:00:00Z');
const r = rnd(11), dir = () => Array.from({ length: DIM }, () => r() - 0.5);
const SHARED = dir(), TOPICS = [dir(), dir(), dir()];
/** An item of made-up topic t: the area's shared direction, the topic's own, and a little noise. */
const vec = (t, noise = 0.15) => { const n = dir(), v = SHARED.map((x, j) => 1.5 * x + 2 * TOPICS[t][j] + noise * n[j]), len = Math.hypot(...v); return v.map((x) => x / len); };   // unit length, as the model's vectors are
let k = 0;
const item = (t, o = {}) => ({ key: `i${k++}`, v: vec(t), ts: NOW - HOUR, names: [], group: 'g1', ...o });
const story = (t, o = {}) => ({ id: `s${t}`, area: 'ai', name: `story ${t}`, names: [], centre: unitOf(vec(t, 0)), n: 5, first: NOW - 86_400_000, last: NOW - HOUR, state: 'live', fixed: false, ...o });
const unitOf = (v) => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return Float32Array.from(v, (x) => x / n); };
const bg = () => backgroundOf(Array.from({ length: 30 }, (_, i) => vec(i % 3)));

describe('joining', () => {
  test('an item joins the story it is alike, not an unrelated one', () => {
    const a = item(0), res = assignItems([a], [story(0), story(1)], [], bg(), NOW);
    assert.deepEqual(res.joins, [{ key: a.key, story: 's0' }]);
    assert.equal(res.pool.length, 0);
  });
  test('an item like no story waits in the pool', () => {
    const a = item(2), res = assignItems([a], [story(0), story(1)], [], bg(), NOW);
    assert.deepEqual(res.joins, []);
    assert.deepEqual(res.pool.map((x) => x.key), [a.key]);
  });
  test('a dormant story wakes; a closed one never takes items', () => {
    const a = item(0), woke = assignItems([a], [story(0, { state: 'dormant' })], [], bg(), NOW);
    assert.deepEqual(woke.woke, ['s0']);
    const shut = assignItems([item(0)], [story(0, { state: 'closed' })], [], bg(), NOW);
    assert.deepEqual(shut.joins, []);
    assert.deepEqual(shut.woke, []);
  });
  test('a shared name helps an item just under the bar', () => {
    const s = story(0, { names: ['claude code'] });
    // an item between topic 0 and topic 1, found by walking along until it is just below the bar
    const b = bg(), c0 = vec(0, 0), c1 = vec(1, 0);
    let w = 0, v;
    for (; w <= 1; w += 0.01) { v = c0.map((x, j) => (1 - w) * x + w * c1[j]); if (alike(v, s.centre, b) < STORY_SIM) break; }
    const plain = { key: 'p', v, ts: NOW - HOUR, names: ['other'], group: 'g1' }, named = { ...plain, key: 'q', names: ['Claude Code'] };
    assert.ok(alike(v, s.centre, b) < STORY_SIM && alike(v, s.centre, b) > STORY_SIM - 0.08, 'the test item is borderline');
    assert.deepEqual(assignItems([plain], [s], [], b, NOW).joins, []);
    assert.equal(assignItems([named], [s], [], b, NOW).joins.length, 1);
  });
  test('a number clash vetoes a join even when the vectors are the same', () => {
    const s = story(0, { names: ['kimi k2'] }), a = item(0, { names: ['kimi k3'] }), same = item(0, { names: ['kimi k2'] });
    assert.deepEqual(assignItems([a], [s], [], bg(), NOW).joins, []);
    assert.equal(assignItems([same], [s], [], bg(), NOW).joins.length, 1);
    assert.equal(numberVeto(['gpt-5 release'], ['gpt-6 release']), true);
    assert.equal(numberVeto(['claude code'], ['claude code cli']), false);
    assert.equal(numberVeto(['kimi k2', 'kimi k3'], ['kimi k2']), false, 'a name shared outright is not vetoed');
  });
  test('the vetoed item can still be born into a story of its own', () => {
    const s = story(0, { names: ['kimi k2'] }), items = [0, 1, 2].map((i) => item(0, { names: ['kimi k3'], group: i === 0 ? 'g1' : 'g2', ts: NOW - (3 - i) * HOUR }));
    const res = assignItems(items, [s], [], bg(), NOW);
    assert.equal(res.joins.length, 0);
    assert.equal(res.births.length, 1);
  });
  test('an item that joined moves the centre for the next item of the batch', () => {
    const b = bg(), s = story(0), c0 = vec(0, 0), c1 = vec(1, 0);
    const mid = (w) => c0.map((x, j) => (1 - w) * x + w * c1[j]);
    // `far` is under the bar against the old centre; `pull` is over it and drags the centre toward `far`
    let wf = 0; while (alike(mid(wf), s.centre, b) >= STORY_SIM + 0.03) wf += 0.01;
    const far = mid(wf), pullW = wf / 2, pull = mid(pullW);
    const both = assignItems([{ key: 'a', v: pull, ts: NOW - 2 * HOUR, names: [], group: 'g' }, { key: 'b', v: far, ts: NOW - HOUR, names: [], group: 'g' }], [{ ...s, n: 1 }], [], b, NOW);
    const alone = assignItems([{ key: 'b', v: far, ts: NOW - HOUR, names: [], group: 'g' }], [{ ...s, n: 1 }], [], b, NOW);
    assert.ok(both.joins.length >= alone.joins.length);
    assert.ok(both.touched[0].n > 1);
  });
  test('a fixed centre does not move; a young one does', () => {
    const a = item(0, { v: vec(0, 0.4) }), young = assignItems([a], [story(0)], [], bg(), NOW), fixed = assignItems([a], [story(0, { fixed: true })], [], bg(), NOW);
    const old = assignItems([a], [story(0, { first: NOW - STORY_FIX_MS - 1 })], [], bg(), NOW);
    const was = story(0).centre;
    assert.deepEqual(Array.from(fixed.touched[0].centre), Array.from(was));
    assert.deepEqual(Array.from(old.touched[0].centre), Array.from(was));
    assert.notDeepEqual(Array.from(young.touched[0].centre), Array.from(was));
    assert.equal(fixed.touched[0].n, 6);
  });
  test('the same items in any order give the same result', () => {
    const items = [0, 1, 2, 0, 1, 2, 2].map((t, i) => item(t, { ts: NOW - (10 - i) * HOUR, group: `g${i % 3}` })), stories = [story(0), story(1)];
    const a = assignItems(items, stories, [], bg(), NOW), b = assignItems([...items].reverse(), [...stories].reverse(), [], bg(), NOW);
    assert.deepEqual(a, b);
  });
});

describe('births', () => {
  const trio = (groups, ages = [1, 2, 3]) => groups.map((g, i) => item(2, { group: g, ts: NOW - ages[i] * HOUR }));
  test('three alike items from two groups make a story', () => {
    const items = trio(['a', 'a', 'b']), res = assignItems(items, [story(0)], [], bg(), NOW);
    assert.equal(res.births.length, 1);
    assert.equal(res.births[0].items.length, 3);
    assert.deepEqual(res.births[0].groups, ['a', 'b']);
    assert.equal(res.pool.length, 0);
    assert.equal(res.births[0].centre.length, DIM);
  });
  test('one group alone, or too few items, stay in the pool', () => {
    const one = assignItems(trio(['a', 'a', 'a']), [], [], bg(), NOW);
    assert.equal(one.births.length, 0);
    assert.equal(one.pool.length, 3);
    const two = assignItems(trio(['a', 'b', 'a']).slice(0, STORY_BIRTH_MIN - 1), [], [], bg(), NOW);
    assert.equal(two.births.length, 0);
  });
  test('pooled items from before count, and ones older than 48 hours are dropped', () => {
    const old = item(2, { group: 'a', ts: NOW - 1 * HOUR }), a = item(2, { group: 'b', ts: NOW - 2 * HOUR }), b = item(2, { group: 'a', ts: NOW - 3 * HOUR });
    assert.equal(assignItems([a, b], [], [old], bg(), NOW).births.length, 1);
    const stale = item(2, { group: 'c', ts: NOW - STORY_POOL_MS - HOUR });
    const res = assignItems([a, b], [], [stale], bg(), NOW);
    assert.equal(res.births.length, 0, 'a stale item does not help');
    assert.equal(res.pool.length, 2);
    assert.ok(!res.pool.some((x) => x.key === stale.key));
  });
  test('two different subjects in the pool make two stories, with names ranked by use', () => {
    const items = [...[0, 1, 2].map((i) => item(1, { group: i ? 'a' : 'b', names: ['x story', i ? 'minor' : 'x story'], ts: NOW - i * HOUR })), ...[0, 1, 2].map((i) => item(2, { group: i ? 'a' : 'b', ts: NOW - i * HOUR }))];
    const res = assignItems(items, [], [], bg(), NOW);
    assert.equal(res.births.length, 2);
    assert.ok(res.births.some((b) => b.names[0] === 'x story'));
  });
});

describe('sources and merging', () => {
  test('two sources of one group are enough for a story; one source repeating itself is not', () => {
    const two = [item(0, { source: 'feed-a' }), item(0, { source: 'feed-b' }), item(0, { source: 'feed-a' })];
    assert.equal(assignItems(two, [], [], bg(), NOW).births.length, 1, 'the group is the same, the sources differ');
    const one = [item(1, { source: 'feed-a', group: 'g1' }), item(1, { source: 'feed-a', group: 'g1' }), item(1, { source: 'feed-a', group: 'g1' })];
    assert.equal(assignItems(one, [], [], bg(), NOW).births.length, 0);
  });
  test('two stories with the same centre become one: the smaller into the bigger', () => {
    const big = story(0, { id: 'big', n: 20 }), small = story(0, { id: 'small', n: 4 }), other = story(1, { id: 'other', n: 30 });
    const m = findMerges([small, other, big], bg());
    assert.equal(m.length, 1);
    assert.equal(m[0].from, 'small'); assert.equal(m[0].into, 'big');
    assert.ok(m[0].sim >= STORY_MERGE_SIM);
    assert.deepEqual(findMerges([big, other], bg()), [], 'different stories stay apart');
    assert.deepEqual(findMerges([big, story(0, { id: 'shut', state: 'closed' })], bg()), [], 'a closed story is left alone');
  });
  test('an item named for two stories does not make them one at birth', () => {
    // Exact vectors (no background): "alpha" items, "beta" items, and one item between them named for both. The beta items are alike to it only with the name
    // bonus, and only "alpha" can lead the group, so they are left waiting instead of being born with the alpha story.
    const D = 8, e = (i) => Array.from({ length: D }, (_, j) => (j === i ? 1 : 0)), mix = (...ws) => unitOf(ws.reduce((s, [w, v]) => s.map((x, j) => x + w * v[j]), Array(D).fill(0)));
    const a = [3, 4, 5].map((n, i) => ({ key: `a${i}`, v: mix([1, e(0)], [0.9, e(2)], [0.35, e(n)]), ts: NOW - (6 + i) * HOUR, names: ['alpha'], group: 'g', source: `a${i}` }));
    const b = [6, 7].map((n, i) => ({ key: `b${i}`, v: mix([1, e(1)], [0.9, e(2)], [0.35, e(n)]), ts: NOW - (1 + i) * HOUR, names: ['beta'], group: 'g', source: `b${i}` }));
    const bridge = { key: 'x', v: mix([1, e(0)], [0.1, e(1)], [0.9, e(2)]), ts: NOW - 5 * HOUR, names: ['alpha', 'beta'], group: 'g', source: 'x' };
    const res = assignItems([bridge, ...a, ...b], [], [], Array(D).fill(0), NOW);
    assert.deepEqual(res.births.map((x) => [...x.items].sort()), [['a0', 'a1', 'a2', 'x']]);
    assert.deepEqual(res.pool.map((x) => x.key).sort(), ['b0', 'b1']);
  });
  test('a clash in a number keeps two alike stories apart, and joined names keep the bigger story\'s lead', () => {
    assert.deepEqual(findMerges([story(0, { id: 'a', names: ['kimi k2'] }), story(0, { id: 'b', names: ['kimi k3'] })], bg()), []);
    assert.equal(joinNames(['nvidia ceo', 'huang resigns'], ['huang affair', 'nvidia ceo'])[0], 'nvidia ceo');
  });
});

describe('lifecycle and new', () => {
  test('dormant after the quiet time, closed after 14 days, closed stays closed', () => {
    const s = (id, ago, state = 'live') => ({ id, last: NOW - ago, state });
    const out = storyStates([s('a', QUIET_MS - 1), s('b', QUIET_MS), s('c', STORY_CLOSE_MS), s('d', STORY_CLOSE_MS, 'closed'), s('e', QUIET_MS + 1, 'dormant')], NOW);
    assert.deepEqual(out, [{ id: 'b', state: 'dormant' }, { id: 'c', state: 'closed' }]);
  });
  test('a story is new when unlike every earlier one', () => {
    const b = bg();
    assert.equal(isNewStory(story(2).centre, [story(0).centre, story(1).centre], b), true);
    assert.equal(isNewStory(story(1).centre, [story(0).centre, story(1).centre], b), false);
    assert.equal(isNewStory(story(1).centre, [], b), true);
  });
});

describe('centre', () => {
  test('a running unit mean', () => {
    const c = updateCentre(unitOf([1, 0]), 1, [0, 1]);
    assert.ok(Math.abs(c[0] - Math.SQRT1_2) < 1e-6 && Math.abs(c[1] - Math.SQRT1_2) < 1e-6);
    assert.ok(Math.abs(Math.hypot(...updateCentre(unitOf([1, 0]), 9, [0, 1])) - 1) < 1e-6);
  });
  test('typical items are the nearest the centre', () => {
    const b = bg(), items = [item(1), item(0), item(0, { v: vec(0, 0.6) })], t = typicalItems(items, story(0).centre, b, 2);
    assert.equal(t.length, 2);
    assert.ok(!t.includes(items[0]));
  });
});

describe('names', () => {
  test('rename only when grown and the leading name changed', () => {
    const s = { n: 30, names: ['kimi k3'] };
    assert.equal(needsRename(s, 10, 'kimi k2'), true);
    assert.equal(needsRename(s, 10, 'Kimi K3'), false);
    assert.equal(needsRename({ ...s, n: 29 }, 10, 'kimi k2'), false);
    assert.equal(needsRename(s, 10), true);
  });
  test('parsing and cleaning a name', () => {
    assert.equal(parseStoryName('{"name":"Claude Code source leak"}'), 'Claude Code source leak');
    assert.equal(parseStoryName('```json\n{"name":"*openssh* pre-auth flaw"}\n```'), 'openssh pre-auth flaw');
    assert.equal(parseStoryName('nonsense'), '');
    assert.equal(cleanStoryName('openai'), '', 'one word');
    assert.equal(cleanStoryName('ai technology'), '', 'only vague words');
    assert.equal(cleanStoryName('see https://x.y story'), '');
    assert.equal(cleanStoryName('one two three four five six seven'), 'one two three four five');
    assert.equal(cleanStoryName(null), '');
  });
  test('the prompts carry the material', () => {
    assert.match(storySystem().content, /JSON/);
    const u = storyUser(['A title https://x.y/z'], ['kimi k3']).content;
    assert.match(u, /kimi k3/);
    assert.doesNotMatch(u, /https/);
  });
  test('slugs are made like topic addresses', () => {
    assert.equal(storySlug('Claude Code backdoor'), 'claude-code-backdoor');
    assert.equal(storySlug('claude code backdoor'), 'claude-code-backdoor');
    assert.match(storySlug('c++ 26'), /^c-plus-plus-26-[a-z0-9]{5}$|^c-plus-/);
  });
});

describe('with real vectors', () => {
  const n = real.names, t = real.texts;
  test('kimi k2 and kimi k3 are near but the number veto keeps them apart', () => {
    const b = backgroundOf([...Object.values(n), ...Object.values(t)]);
    const s = { id: 's', area: 'ai', name: 'kimi k2', names: ['kimi k2'], centre: unitOf(n['kimi k2']), n: 5, first: NOW - 1e6, last: NOW - 1e6, state: 'live', fixed: false };
    const a = { key: 'a', v: n['kimi k3'], ts: NOW - HOUR, names: ['kimi k3'], group: 'g' };
    assert.equal(assignItems([a], [s], [], b, NOW).joins.length, 0);
  });
  test('the same story in different words is alike, a different one is not', () => {
    const b = backgroundOf([...Object.values(t), ...Object.values(n)]);
    assert.ok(alike(t.sameStory, t.copyA, b) > alike(t.other, t.copyA, b));
    assert.ok(alike(t.raiseA, t.raiseB, b) > STORY_SIM);
  });
});
