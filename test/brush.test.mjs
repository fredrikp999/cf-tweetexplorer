// Pictures that filter the lists (A5): the day, kind and order of a topic's Talk list and of get_topic_items.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BRUSH_KINDS, TALK_CAP, brushItems, brushParams, dayOfTs, parseBrush, parseSort, recentDays, sortItems, sortNote, weightOf } from '../src/signal/brush.ts';
import { itemsOut } from '../src/site/agentText.ts';

const NOW = Date.UTC(2026, 10, 11, 12, 0), D = 86_400_000, H = 3_600_000;
const days = recentDays(NOW, 14);
const it = (kind, ts, o = {}) => ({ kind, ts, by: 'a', source: 's', title: `${kind} ${ts}`, url: `https://e.com/${kind}/${ts}`, discussionUrl: '', likes: -1, replies: -1, views: -1, ...o });

describe('the days', () => {
  test('fourteen UTC days, oldest first, ending today', () => {
    assert.equal(days.length, 14);
    assert.equal(days[13], '2026-11-11');
    assert.equal(days[0], '2026-10-29');
    assert.equal(dayOfTs(NOW - 20 * H), '2026-11-10');
  });
});

describe('reading the address', () => {
  test('a valid day, kind and sort are kept', () => {
    assert.deepEqual(parseBrush({ day: '2026-11-04', kind: 'hn', sort: 'newest' }, days), { day: '2026-11-04', kind: 'hn', sort: 'newest' });
  });
  test('anything not valid is dropped, never an error', () => {
    assert.deepEqual(parseBrush({ day: '2026-13-45', kind: 'tiktok', sort: 'best' }, days), { sort: 'reacted' });
    assert.deepEqual(parseBrush({ day: '2026-9-4', kind: 'X' }, days), { sort: 'reacted' });
    assert.deepEqual(parseBrush({ day: '2025-01-01' }, days), { sort: 'reacted' });   // well formed but outside the topic's days
    assert.deepEqual(parseBrush({ day: "2026-11-04'><script>", kind: 'x"' }, days), { sort: 'reacted' });
    assert.deepEqual(parseBrush({ kind: 'arxiv' }, days), { sort: 'reacted' });   // papers have their own angle
    assert.deepEqual(parseBrush({}, days), { sort: 'reacted' });
    assert.deepEqual(parseBrush({ day: null, kind: null, sort: null }, days), { sort: 'reacted' });
  });
  test('a conversation is kept only when the topic has it today, and combines with a day and a kind', () => {
    const days = recentDays(Date.parse('2026-11-12T10:00:00Z'), 14);
    assert.deepEqual(parseBrush({ conv: 'c2' }, days, 'reacted', ['c1', 'c2']), { conv: 'c2', sort: 'reacted' });
    for (const bad of ['c3', 'C2', '', null]) assert.deepEqual(parseBrush({ conv: bad }, days, 'reacted', ['c1', 'c2']), { sort: 'reacted' }, String(bad));
    assert.deepEqual(parseBrush({ conv: 'c2' }, days), { sort: 'reacted' }, 'no conversations known: dropped');
    const b = parseBrush({ day: '2026-11-10', kind: 'hn', conv: 'c1', sort: 'newest' }, days, 'reacted', ['c1']);
    assert.deepEqual(b, { day: '2026-11-10', kind: 'hn', conv: 'c1', sort: 'newest' });
    assert.deepEqual(brushParams(b), [['day', '2026-11-10'], ['kind', 'hn'], ['conv', 'c1'], ['sort', 'newest']]);
  });
  test('the older tool names still work; the default can differ', () => {
    assert.equal(parseSort('new'), 'newest');
    assert.equal(parseSort('top'), 'reacted');
    assert.equal(parseSort('earliest'), 'earliest');
    assert.equal(parseSort('nonsense', 'newest'), 'newest');
    assert.equal(parseBrush({}, days, 'newest').sort, 'newest');
  });
  test('the default order stays out of the address', () => {
    assert.deepEqual(brushParams({ sort: 'reacted' }), []);
    assert.deepEqual(brushParams({ day: '2026-11-04', kind: 'x', sort: 'earliest' }), [['day', '2026-11-04'], ['kind', 'x'], ['sort', 'earliest']]);
  });
});

describe('ordering', () => {
  const xs = [it('x', NOW - 3 * H, { by: 'ann', likes: 5 }), it('x', NOW - 1 * H, { by: 'bob', likes: 90 }), it('x', NOW - 2 * H, { by: 'ann', likes: 1 }), it('x', NOW - 4 * H, { by: 'cy', likes: 30 }), it('x', NOW - 5 * H, { by: 'Ann', likes: 2 })];
  test('newest and earliest', () => {
    assert.deepEqual(sortItems(xs, 'newest').map((i) => i.by), ['bob', 'ann', 'ann', 'cy', 'Ann']);
    assert.deepEqual(sortItems(xs, 'earliest').map((i) => i.by), ['Ann', 'cy', 'ann', 'ann', 'bob']);
  });
  test('most reacted weighs likes, replies and views', () => {
    assert.deepEqual(sortItems(xs, 'reacted').map((i) => i.by), ['bob', 'cy', 'ann', 'Ann', 'ann']);
    assert.equal(weightOf(it('hn', NOW, { likes: 10, replies: 4 })), 18);
    assert.equal(weightOf(it('youtube', NOW, { views: 1000 })), 10);
    assert.equal(weightOf(it('rss', NOW)), 0);
  });
  test('accounts: the one with most items first, each account together, names compared without case', () => {
    assert.deepEqual(sortItems(xs, 'accounts').map((i) => i.by.toLowerCase()), ['ann', 'ann', 'ann', 'bob', 'cy']);
    const blank = [it('rss', NOW - H, { by: '' }), it('rss', NOW - 2 * H, { by: '' }), it('rss', NOW - 3 * H, { by: 'z' })];
    assert.equal(sortItems(blank, 'accounts').length, 3);   // items without an author do not count as one account
  });
  test('does not change the list it is given', () => {
    const copy = xs.map((i) => i.ts);
    sortItems(xs, 'earliest');
    assert.deepEqual(xs.map((i) => i.ts), copy);
  });
});

describe('narrowing', () => {
  const d4 = Date.UTC(2026, 10, 4, 9), d5 = Date.UTC(2026, 10, 5, 9);
  const items = [it('x', d4, { likes: 3 }), it('x', d4 + H, { likes: 40 }), it('x', d5, { likes: 7 }), it('hn', d4 + 2 * H, { likes: 120, replies: 30 }), it('hn', d5, { likes: 9 }), it('youtube', d5, { views: 5000 }), it('rss', d4)];
  test('a day keeps that UTC day only, and counts per kind', () => {
    const r = brushItems(items, { day: '2026-11-04', sort: 'newest' });
    assert.equal(r.total, 4);
    assert.deepEqual(r.counts, { x: 2, hn: 1, rss: 1 });
    assert.ok(r.items.every((i) => dayOfTs(i.ts) === '2026-11-04'));
  });
  test('a kind keeps that kind; a day and a kind combine', () => {
    assert.equal(brushItems(items, { kind: 'hn', sort: 'reacted' }).total, 2);
    const both = brushItems(items, { day: '2026-11-05', kind: 'x', sort: 'reacted' });
    assert.equal(both.total, 1);
    assert.equal(both.items[0].likes, 7);
  });
  test('kinds stay apart: a list is each kind ordered by itself, in the usual order of kinds, never one ranking across kinds', () => {
    const r = brushItems(items, { sort: 'reacted' });
    assert.deepEqual(r.items.map((i) => i.kind), ['x', 'x', 'x', 'hn', 'hn', 'youtube', 'rss']);
    assert.deepEqual(r.items.filter((i) => i.kind === 'x').map((i) => i.likes), [40, 7, 3]);
    assert.ok(r.items.findIndex((i) => i.kind === 'youtube') > r.items.findIndex((i) => i.likes === 9));   // 5000 views do not outrank 120 points
  });
  test('the cap is per kind and the counts are before the cut', () => {
    const many = Array.from({ length: 20 }, (_, n) => it('x', d4 + n * 1000, { likes: n }));
    const r = brushItems([...many, it('hn', d4)], { sort: 'reacted' }, TALK_CAP);
    assert.equal(r.items.filter((i) => i.kind === 'x').length, TALK_CAP);
    assert.equal(r.counts.x, 20);
    assert.equal(r.items.filter((i) => i.kind === 'hn').length, 1);
  });
  test('nothing matching is an empty list, not an error', () => {
    const r = brushItems(items, { day: '2026-11-09', sort: 'newest' });
    assert.deepEqual(r, { items: [], counts: {}, total: 0 });
  });
  test('only the kinds Talk has', () => {
    assert.deepEqual(BRUSH_KINDS, ['x', 'hn', 'youtube', 'rss']);
  });
});

describe('the words under the lists', () => {
  test('every order says that kinds are ordered by themselves', () => {
    for (const s of ['reacted', 'newest', 'earliest', 'accounts']) assert.match(sortNote(s), /never ranked against each other/);
  });
});

describe('get_topic_items', () => {
  const items = [it('hn', NOW - D, { id: 'aaaaaaaaaaa', likes: 12, replies: 3, by: 'u' })];
  const base = { found: true, slug: 't', label: 'T', proof: true, total: 1, counts: { hn: 4 }, items };
  const O = 'https://example.test';
  test('says the day it applied and offers it in the next-page hint', () => {
    const a = itemsOut({ ...base, day: '2026-11-10', total: 40 }, { topic: 't', sort: 'earliest', day: '2026-11-10', offset: 0 }, O);
    assert.match(a.text, /on 2026-11-10/);
    assert.match(a.text, /earliest first/);
    assert.match(a.text, /day: "2026-11-10"/);
    assert.equal(a.data.day, '2026-11-10');
    assert.equal(a.data.sort, 'earliest');
  });
  test('a day the topic does not have is said to be ignored', () => {
    const a = itemsOut({ ...base, day: null }, { topic: 't', sort: 'newest', day: '2020-01-01', offset: 0 }, O);
    assert.match(a.text, /ignored/);
    assert.match(a.text, /in the last 7 days/);
  });
  test('most reacted says it is ordered within each kind; the old names work', () => {
    const a = itemsOut(base, { topic: 't', sort: 'top', offset: 0 }, O);
    assert.match(a.text, /within each kind of source/);
    assert.equal(a.data.sort, 'reacted');
    assert.equal(itemsOut(base, { topic: 't', sort: 'new', offset: 0 }, O).data.sort, 'newest');
  });
});
