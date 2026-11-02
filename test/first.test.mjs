import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { MIN_JOINED, QUIET_MS, TIE_MS, foldTerm, findWaves, isDateOnly, publicFirst, rankWaves, scoreFirsts, watchStartMs } from '../src/signal/first.ts';
import html from '../src/apps/first.ts';

const H = 3_600_000, D = 24 * H, T0 = Date.UTC(2026, 9, 20, 10, 7);
const it = (group, at, term = 'kimi', watch = group) => ({ group, watch, ts: T0 + at, terms: new Set([term]), title: `${group} ${at}`, url: '', by: '' });
const topic = { label: 'kimi', terms: ['kimi'] };
const opts = { from: T0 - D, historyStart: T0 - 10 * D, since: { a: 0, b: 0, c: 0 } };

describe('finding waves', () => {
  test('gives the order the groups arrived in, how late, and who stayed silent', () => {
    const { waves } = findWaves([topic], [it('b', 3 * H), it('a', 0), it('a', H), it('b', 4 * H)], opts);
    assert.equal(waves.length, 1);
    assert.deepEqual(waves[0].arrivals.map((a) => [a.group, a.lag, a.n]), [['a', 0, 2], ['b', 3 * H, 2]]);
    assert.equal(waves[0].mentions, 4); assert.deepEqual(waves[0].absent, ['c']);
  });
  test('a topic that never goes quiet has no start to judge', () => {
    const steady = Array.from({ length: 40 }, (_, i) => it(i % 2 ? 'a' : 'b', i * 12 * H - 15 * D));
    const r = findWaves([topic], steady, { ...opts, historyStart: T0 - 15 * D });
    assert.equal(r.waves.length, 0); assert.equal(r.skipped.noClearStart, 1);
  });
  test('a wave too close to the start of the history may have begun earlier', () => {
    const r = findWaves([topic], [it('a', 0), it('b', H), it('b', 2 * H)], { ...opts, historyStart: T0 - QUIET_MS + 1 });
    assert.equal(r.waves.length, 0); assert.equal(r.skipped.noClearStart, 1);
  });
  test('after a quiet gap the same topic starts a new wave', () => {
    const r = findWaves([topic], [it('a', 0), it('b', H), it('b', 2 * H), it('b', 5 * D), it('a', 5 * D + H), it('a', 5 * D + 2 * H)], opts);
    assert.deepEqual(r.waves.map((w) => w.arrivals[0].group), ['a', 'b']);
  });
  test('needs two groups and three mentions, because one group talking to itself is not a ripple', () => {
    const one = findWaves([topic], [it('a', 0), it('a', H), it('a', 2 * H)], opts), two = findWaves([topic], [it('a', 0), it('b', H)], opts);
    assert.equal(one.waves.length, 0); assert.equal(one.skipped.oneGroup, 1);
    assert.equal(two.waves.length, 0); assert.equal(two.skipped.oneGroup, 1);
  });
  test('a date with no time of day cannot come first', () => {
    const midnight = { ...it('c', 0), ts: Date.UTC(2026, 9, 20) };
    assert.ok(isDateOnly(midnight.ts));
    const r = findWaves([topic], [midnight, it('a', 0), it('b', H), it('b', 2 * H)], opts);
    assert.equal(r.waves[0].arrivals[0].group, 'a'); assert.equal(r.dateOnly, 1);
  });
  test('a group added after the wave began is neither late nor silent', () => {
    const r = findWaves([topic], [it('a', 0), it('b', H), it('b', 2 * H), it('c', 3 * H)], { ...opts, since: { a: 0, b: 0, c: T0 + H } });
    assert.deepEqual(r.waves[0].arrivals.map((a) => a.group), ['a', 'b']); assert.deepEqual(r.waves[0].absent, []);
  });
  test('an item from before its group was watched does not set the start', () => {
    const r = findWaves([topic], [it('c', -D), it('a', 0), it('b', H), it('b', 2 * H)], { ...opts, since: { a: 0, b: 0, c: T0 - H } });
    assert.equal(r.waves[0].onset, T0);
  });
  test('groups not being compared are ignored, and a late mention stays out of the wave', () => {
    const r = findWaves([topic], [it('x', -H), it('a', 0), it('b', H), it('b', 2 * H), it('c', 2.5 * D), it('c', 5 * D), it('c', 7.5 * D)], { ...opts, since: { a: 0, b: 0, c: 0 } });
    assert.equal(r.waves[0].onset, T0);
    assert.deepEqual(r.waves[0].arrivals.find((a) => a.group === 'c').n, 2);
  });
});

describe('scoring against chance', () => {
  const wave = (order) => ({ topic: 't', terms: ['t'], onset: T0, mentions: order.reduce((n, a) => n + a[2], 0), absent: [], arrivals: order.map(([group, lag, n]) => ({ group, lag, n, ts: T0 + lag, watch: group, by: '', title: '', url: '' })) });
  test('a group that posts nearly everything earns little credit for coming first', () => {
    const waves = Array.from({ length: 12 }, () => wave([['big', 0, 9], ['small', H, 1]]));
    const [big, small] = scoreFirsts(waves, ['big', 'small']);
    assert.equal(big.first, 12); assert.ok(Math.abs(big.expected - 10.8) < 1e-9);
    assert.equal(small.first, 0); assert.ok(Math.abs(small.expected - 1.2) < 1e-9);
    assert.equal(big.verdict, 'unclear');   // about one standard deviation: what volume alone would give
  });
  test('a quiet group that keeps coming first is early, and the one it beats is late', () => {
    const waves = Array.from({ length: 12 }, () => wave([['small', 0, 1], ['big', H, 9]]));
    const [small, big] = scoreFirsts(waves, ['small', 'big']);
    assert.equal(small.verdict, 'early'); assert.equal(big.verdict, 'late');
    assert.equal(big.medianLag, H); assert.equal(small.medianLag, 0);
  });
  test('too few waves are not called anything, however one-sided', () => {
    const waves = Array.from({ length: MIN_JOINED - 1 }, () => wave([['small', 0, 1], ['big', H, 9]]));
    assert.equal(scoreFirsts(waves, ['small', 'big'])[0].verdict, 'unclear');
  });
  test('arrivals close together share the credit and the first place', () => {
    const [a, b, c] = scoreFirsts([wave([['a', 0, 1], ['b', TIE_MS, 1], ['c', TIE_MS + 1, 1]])], ['a', 'b', 'c']);
    assert.equal(a.first, 0.5); assert.equal(b.first, 0.5); assert.equal(c.first, 0);
    assert.equal(b.medianLag, 0);
  });
  test('credit and chance each add up to the number of waves', () => {
    const s = scoreFirsts([wave([['a', 0, 3], ['b', H, 1]]), wave([['b', 0, 1], ['c', 0, 1], ['a', H, 2]])], ['a', 'b', 'c']);
    assert.ok(Math.abs(s.reduce((n, g) => n + g.first, 0) - 2) < 1e-9);
    assert.ok(Math.abs(s.reduce((n, g) => n + g.expected, 0) - 2) < 1e-9);
  });
  test('a group with no waves has nothing to report', () => {
    const [g] = scoreFirsts([], ['a']);
    assert.equal(g.joined, 0); assert.equal(g.medianLag, null); assert.equal(g.z, null); assert.equal(g.verdict, 'unclear');
  });
});

describe('the public answer', () => {
  const r = { boards: [{ id: 'secret-board', title: 'Private Signal' }], board: 'b1', groups: [{ key: 'list:764f676e', name: 'Tech feeds' }, { key: 'src:rss', name: 'RSS' }, { key: 'g:quiet', name: 'Quiet' }],
    waves: [{ topic: 'kimi', onset: 1, absent: ['g:quiet'], arrivals: [{ group: 'list:764f676e', by: '@someone', title: 'A title', url: 'https://a.example/1', source: 'A private feed name', lag: 0, n: 1, ts: 1 }, { group: 'src:rss', by: '', title: 'B', url: '', source: 'B', lag: 5, n: 1, ts: 6 }] }] };
  test('never names other Signals or internal list ids, and keeps a group\'s identity consistent', () => {
    const out = JSON.stringify(publicFirst(r, true));
    for (const secret of ['secret-board', 'Private Signal', '764f676e', 'b1', 'src:rss', 'g:quiet']) assert.ok(!out.includes(secret), secret);
    const p = publicFirst(r, true);
    assert.deepEqual(p.groups.map((g) => g.key), ['g0', 'g1', 'g2']); assert.deepEqual(p.waves[0].arrivals.map((a) => a.group), ['g0', 'g1']); assert.deepEqual(p.waves[0].absent, ['g2']);
    assert.equal(p.groups[0].name, 'Tech feeds');
  });
  test('with sources off, no title, link, handle or feed name gets out', () => {
    const out = JSON.stringify(publicFirst(r, false));
    for (const secret of ['A title', 'a.example', '@someone', 'A private feed name']) assert.ok(!out.includes(secret), secret);
    assert.equal(publicFirst(r, false).waves[0].arrivals[0].lag, 0);
  });
  test('with sources on, the items are shown', () => {
    const a = publicFirst(r, true).waves[0].arrivals[0];
    assert.equal(a.title, 'A title'); assert.equal(a.url, 'https://a.example/1');
  });
});

describe('small rules', () => {
  test('a watch stores seconds and an item milliseconds, so the two compare correctly', () => {
    assert.equal(watchStartMs(1_790_000_000), 1_790_000_000_000); assert.equal(watchStartMs(1_790_000_000_000), 1_790_000_000_000);
    assert.equal(watchStartMs(undefined), 0); assert.equal(watchStartMs(0), 0);
  });
  test('a plural folds into the name Signal uses, and an unknown term is dropped', () => {
    const known = new Set(['game', 'kimi']);
    assert.equal(foldTerm('game', known), 'game'); assert.equal(foldTerm('games', known), 'game'); assert.equal(foldTerm('chess', known), '');
  });
  test('the widest wave comes first, then the busiest, then the newest', () => {
    const w = (id, groups, mentions, onset) => ({ id, arrivals: Array(groups), mentions, onset });
    assert.deepEqual(rankWaves([w('c', 2, 9, 1), w('a', 3, 3, 1), w('b', 2, 9, 2)]).map((x) => x.id), ['a', 'b', 'c']);
  });
});

describe('the page', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  test('is one classic inline script that parses, with no loaded files', () => {
    new vm.Script(script);
    assert.equal((html.match(/<script/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|import\s*\(/);
  });
});
