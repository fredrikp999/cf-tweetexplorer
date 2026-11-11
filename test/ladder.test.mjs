// The Ladder: a score per day by Signal's own rule, a rank per day, and how each topic moved.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LADDER_DAYS, dayScores, ladderOf, moveOf, moveWords } from '../src/signal/ladder.ts';
import { SMOOTH } from '../src/signal/score.ts';
import { ladderData } from '../src/site/landing.ts';
import { overviewOut } from '../src/site/agentText.ts';
import { ladderFixture } from './helpers/ladder-fixture.mjs';

describe('a score per day', () => {
  test('is the share of each group\'s items over the days it looks at, groups weighted', () => {
    // two groups, 4 days asked for, 2 days of lead (a window of 3)
    const items = [[10, 10, 10, 10, 10, 10], [0, 0, 20, 20, 20, 20]], mentions = [[0, 0, 3, 3, 0, 0], [0, 0, 0, 4, 4, 0]];
    const s = dayScores(mentions, items, [1, 2], 4, 3);
    assert.equal(s.length, 4);
    assert.ok(Math.abs(s[0] - (1 * (3 / (30 + SMOOTH)) + 2 * (0 / (20 + SMOOTH))) / 3) < 1e-12);
    assert.ok(Math.abs(s[1] - (1 * (6 / (30 + SMOOTH)) + 2 * (4 / (40 + SMOOTH))) / 3) < 1e-12);
    assert.ok(Math.abs(s[3] - (1 * (3 / (30 + SMOOTH)) + 2 * (8 / (60 + SMOOTH))) / 3) < 1e-12);
  });
  test('a group with no items in those days, or no weight, is left out of the average', () => {
    assert.ok(Math.abs(dayScores([[5], [0]], [[20], [0]], [1, 1], 1, 1)[0] - 5 / (20 + SMOOTH)) < 1e-12);
    assert.ok(Math.abs(dayScores([[5], [9]], [[20], [20]], [1, 0], 1, 1)[0] - 5 / (20 + SMOOTH)) < 1e-12);
    assert.deepEqual(dayScores([[0]], [[0]], [1], 1, 1), [0]);
  });
});

describe('the ladder', () => {
  const t = (key, scores) => ({ key, label: key.toUpperCase(), scores });
  const l = ladderOf([t('a', [5, 5, 1]), t('b', [3, 6, 2]), t('c', [0, 1, 3]), t('d', [1, 0, 0]), t('e', [0, 0, 0])], 2);
  const by = Object.fromEntries(l.topics.map((x) => [x.key, x]));
  test('ranks each day by that day\'s score, and only the first few are on it', () => {
    assert.deepEqual(by.a.rank, [1, 2, null]); assert.deepEqual(by.b.rank, [2, 1, 2]); assert.deepEqual(by.c.rank, [null, null, 1]);
  });
  test('keeps only topics that were on it some day, today\'s order first, then the ones that dropped out', () => {
    assert.deepEqual(l.topics.map((x) => x.key), ['c', 'b', 'a']);
    assert.equal(by.d, undefined); assert.equal(by.e, undefined);
    assert.equal(by.a.best, 1); assert.equal(by.c.first, 2);
  });
  test('nothing has no rank, and a tie goes to the name', () => {
    const z = ladderOf([t('y', [2, 0]), t('x', [2, 0])], 5);
    assert.deepEqual(z.topics.map((x) => [x.key, x.rank]), [['x', [1, null]], ['y', [2, null]]]);
  });
  test('says how a topic moved', () => {
    assert.deepEqual(moveOf([6, 5, 4, 3, 3, 2, 2, 1], 7), { now: 1, then: 6, up: 5 });
    assert.equal(moveWords([6, 5, 4, 3, 3, 2, 2, 1], 7), 'up 5 in 7 days');
    assert.equal(moveWords([1, 1, 1, 4], 7), 'down 3 in 3 days');
    assert.equal(moveWords([null, null, 3], 7), 'new on the ladder'); assert.equal(moveWords([2, 3, null], 7), 'dropped out'); assert.equal(moveWords([2, 9, 2], 7), 'same place');
  });
});

describe('on the page and in the answer', () => {
  const O = 'https://site.example', lens = { key: 'security', area: 'ai', name: 'Security', description: '', color: 'orange', terms: ['mcp', 'prompt injection'] };
  const raw = ladderFixture();
  test('the fixture is a fortnight with climbers, a newcomer and a topic that dropped out', () => {
    assert.equal(raw.days.length, LADDER_DAYS);
    const by = Object.fromEntries(raw.topics.map((x) => [x.key, x]));
    assert.equal(by['mcp-auth-bypass'].rank[13], 1); assert.equal(by['mcp-auth-bypass'].rank[0], null);
    assert.equal(by['rag'].rank[13], null); assert.ok(by['rag'].best <= 3);
    for (let d = 0; d < LADDER_DAYS; d++) { const r = raw.topics.map((x) => x.rank[d]).filter((x) => x !== null).sort((a, b) => a - b); assert.deepEqual(r, r.map((_, i) => i + 1)); }
  });
  test('joins lenses and links; with a lens only its topics have a colour', () => {
    const d = ladderData(raw, { lenses: [lens], origin: O }), t = (k, x = d) => x.topics.find((y) => y.slug === k);
    assert.equal(t('mcp-auth-bypass').url, O + '/t/mcp-auth-bypass'); assert.equal(t('mcp-auth-bypass').lensColor, 'orange'); assert.equal(t('claude-code').lensColor, null);
    assert.equal(t('mcp-auth-bypass').move, 'new on the ladder'); assert.equal(t('rag').move, 'dropped out');
    const l = ladderData(raw, { area: 'politics', lens, lenses: [lens], origin: O });
    assert.equal(t('claude-code', l).inLens, false); assert.equal(t('prompt-injection', l).inLens, true); assert.match(t('rag', l).url, /area=politics/);
  });
  test('nothing to draw is null', () => {
    assert.equal(ladderData(null, { lenses: [], origin: O }), null);
    assert.equal(ladderData({ ...raw, topics: raw.topics.slice(0, 1) }, { lenses: [], origin: O }), null);
  });
  test('get_overview carries it as data and names the first few in a section', () => {
    const sig = { slug: 's', title: 'Signal', baselineOk: true, groups: [{ name: 'Builders' }], top: [] };
    const a = overviewOut({ window: 1, lenses: [], sig, sig7: null, extras: null, briefs: [], ladder: raw }, O, 'full');
    assert.equal(a.data.ladder.topics.length, raw.topics.length);
    assert.match(a.text, /## The ladder, 14 days/); assert.match(a.text, /1\. \[MCP auth bypass\]\(https:\/\/site\.example\/t\/mcp-auth-bypass\) `mcp-auth-bypass`: new on the ladder/);
    assert.equal(overviewOut({ window: 1, lenses: [], sig, sig7: null, extras: null, briefs: [] }, O).data.ladder, null);
  });
});
