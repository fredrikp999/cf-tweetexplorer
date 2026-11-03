import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, canReuse, compareSets, dedupeByAddress, demandsOf, hitLimit, incrementalAllowed, matchesFeed, mergeDepth, nextDelaySec, pagesWithin, readSince, reuseMs, selectForUse, sourceKey, strategyOf } from '../src/collect/plan.ts';

const HOUR = 3_600_000, NOW = 1_800_000_000_000;
const lookups = {
  xlists: [{ id: '1', name: 'One', groups: ['g'] }, { id: '2', name: 'Two', groups: ['g'] }, { id: '3', name: 'Three', groups: [] }],
  lists: [{ id: 'a', name: 'Accounts' }],
  flists: [{ id: 'f', name: 'Feeds', members: [{ source: 'youtube', query: 'https://y/feed', label: 'Y' }, { source: 'hn', query: 'rust', hnTag: 'story', minPoints: 5, label: 'H' }] }],
};

describe('sources', () => {
  test('the same list in two briefings is one source, whatever the depth', () => {
    const a = demandsOf({ sources: [{ type: 'xlist', listId: '1', pages: 1, minFaves: 100 }] }, lookups);
    const b = demandsOf({ sources: [{ type: 'xgroup', group: 'g', pages: 3, minFaves: 5 }] }, lookups);
    assert.equal(a[0].key, b[0].key);
    assert.deepEqual(mergeDepth([a[0], b[0]]), { pages: 3, minFaves: 5 });
  });
  test('reading a list two ways is two sources; a YouTube feed and the same address as RSS are one', () => {
    assert.notEqual(sourceKey('x_list', { listId: '1', mode: 'best' }), sourceKey('x_list', { listId: '1', mode: 'latest' }));
    assert.equal(sourceKey('rss', { query: 'u' }), sourceKey('youtube', { query: 'u' }));
  });
  test('a group, a feed list, an account list and a search each expand to what they stand for', () => {
    const d = demandsOf({ sources: [{ type: 'xgroup', group: 'g' }, { type: 'flist', listId: 'f' }, { type: 'list', listId: 'a' }, { type: 'search', query: 'q', sort: 'Top' }, { type: 'feed', source: 'rss' }] }, lookups);
    assert.deepEqual(d.map((x) => [x.kind, x.part]), [['x_list', 0], ['x_list', 0], ['youtube', 1], ['hn', 1], ['x_accounts', 2], ['x_search', 3]]);
    assert.equal(d[0].minFaves, 5, 'best mode defaults to 5 likes');
  });
  test('a live feed source collects nothing itself, and matches by kind or watch', () => {
    assert.equal(demandsOf({ sources: [{ type: 'feed' }] }, lookups).length, 0);
    const w = { id: 'abc', label: 'HN front page', kind: 'hn' };
    assert.ok(matchesFeed({}, w)); assert.ok(matchesFeed({ source: 'hn' }, w)); assert.ok(!matchesFeed({ source: 'rss' }, w));
    assert.ok(matchesFeed({ watch: 'abc' }, w)); assert.ok(matchesFeed({ watch: 'front' }, w)); assert.ok(!matchesFeed({ watch: 'zzz' }, w));
    assert.ok(matchesFeed({ source: 'x' }, { id: 'x', label: 'x', kind: 'x_watch' }));
  });
  test('paid and free sources are collected differently', () => {
    assert.equal(strategyOf('x_list'), 'window'); assert.equal(strategyOf('x_watch'), 'incremental'); assert.equal(strategyOf('rss'), 'poll');
  });
  test('a data budget shares pages out between lists, and never below one', () => {
    assert.equal(pagesWithin(5, 'best', undefined, 10), 5);
    assert.equal(pagesWithin(5, 'best', 0.02, 2), 2);    // 0.017 for 2 lists at 0.003 a page
    assert.equal(pagesWithin(5, 'best', 0.001, 10), 1);
  });
});

describe('reusing what was collected', () => {
  const need = { hours: 24, pages: 1, minFaves: 100 };
  const covered = (agoH, o = {}) => ({ from: NOW - (agoH + 24) * HOUR, to: NOW - agoH * HOUR, pages: 1, minFaves: 100, ...o });
  test('a re-run shortly after does not buy the same tweets again', () => assert.ok(canReuse(covered(2), need, NOW)));
  test('not when nothing was collected, or it is too old', () => {
    assert.ok(!canReuse(undefined, need, NOW));
    assert.ok(!canReuse(covered(7), need, NOW));
    assert.equal(reuseMs(24), 6 * HOUR); assert.equal(reuseMs(6), 1.5 * HOUR); assert.equal(reuseMs(168), 6 * HOUR);
  });
  test('not when this use needs more: a longer period, deeper pages or fewer likes', () => {
    assert.ok(!canReuse(covered(1), { ...need, hours: 168 }, NOW));
    assert.ok(!canReuse(covered(1), { ...need, pages: 2 }, NOW));
    assert.ok(!canReuse(covered(1), { ...need, minFaves: 5 }, NOW));
    assert.ok(canReuse(covered(1), { ...need, minFaves: 500 }, NOW), 'more likes than were asked for is a filter on what is there');
  });
  test('a re-run reads the same period as the run it repeats', () => {
    assert.equal(readSince([covered(3), covered(2)], 24, NOW), NOW - 27 * HOUR);
    assert.equal(readSince([undefined], 24, NOW), NOW - 24 * HOUR);
  });
});

describe('how often a feed is read', () => {
  const free = { baseSec: 3600, errors: 0, quiet: 0, paid: false, pinned: false };
  test('a feed with news keeps its interval', () => assert.equal(nextDelaySec(free), 3600));
  test('a quiet feed slows down to at most six hours', () => {
    assert.equal(nextDelaySec({ ...free, quiet: 2 }), 3600);
    assert.equal(nextDelaySec({ ...free, quiet: 3 }), 7200);
    assert.equal(nextDelaySec({ ...free, quiet: 4 }), 14400);
    assert.equal(nextDelaySec({ ...free, quiet: 50 }), 21600);
  });
  test('a pinned interval and a paid search do not stretch when quiet', () => {
    assert.equal(nextDelaySec({ ...free, quiet: 50, pinned: true }), 3600);
    assert.equal(nextDelaySec({ ...free, quiet: 50, paid: true }), 3600);
  });
  test('failures back off to six hours, unlike the old ten minutes', () => {
    assert.equal(nextDelaySec({ ...free, errors: 1 }), 7200);
    assert.equal(nextDelaySec({ ...free, errors: 16 }), 21600);
    assert.equal(nextDelaySec({ ...free, baseSec: 86400, errors: 3 }), 86400, 'never sooner than its own interval');
    assert.equal(nextDelaySec({ ...free, baseSec: 60, errors: 2 }), 240);
  });
  test('recurring X collection leaves room for the briefings still due', () => {
    assert.ok(incrementalAllowed(0.1, 2, 0.2)); assert.ok(!incrementalAllowed(1.9, 2, 0.2)); assert.ok(!incrementalAllowed(2, 2, 0));
  });
});

describe('what a briefing reads', () => {
  const item = (id, ts, likes, url) => ({ id, ts, likes, json: { id, url } });
  const list = { kind: 'x_list', spec: { listId: '1', mode: 'best' }, pages: 1, minFaves: 100 };
  test('only the period', () => {
    assert.deepEqual(selectForUse([item('new', NOW, 200), item('old', NOW - 48 * HOUR, 200)], list, NOW - 24 * HOUR).map((i) => i.id), ['new']);
  });
  test('a briefing sharing a deeper source sees what it asked for: its own likes and its own pages', () => {
    const many = Array.from({ length: 50 }, (_, i) => item('t' + i, NOW, i * 10));
    const got = selectForUse(many, list, NOW - HOUR);
    assert.equal(got.length, 20); assert.equal(got[0].id, 't49'); assert.ok(got.every((i) => i.likes >= 100));
  });
  test('other kinds keep all of the period; an item with no date stays in', () => {
    assert.equal(selectForUse([item('a', NaN, 0), item('b', NOW, 0)], { kind: 'rss', spec: {}, pages: 0, minFaves: 0 }, NOW - HOUR).length, 2);
  });
  test('one story from two feeds counts once', () => {
    const got = dedupeByAddress([item('rss:1', NOW, 0, 'https://a/x/'), item('rss:2', NOW, 0, 'https://A/x#y'), item('rss:3', NOW, 0, 'https://a/z')]);
    assert.deepEqual(got.map((i) => i.id), ['rss:1', 'rss:3']);
  });
  test('reaching a limit is flagged, for best mode and searches', () => {
    assert.ok(hitLimit('x_list', { mode: 'best' }, 40, 2)); assert.ok(!hitLimit('x_list', { mode: 'best' }, 39, 2));
    assert.ok(!hitLimit('x_list', { mode: 'latest' }, 400, 2)); assert.ok(hitLimit('x_search', {}, 60, 3)); assert.ok(!hitLimit('rss', {}, 100, 0));
  });
  test('a shared source splits its cost', () => { assert.equal(allocate(0.06, 3), 0.02); assert.equal(allocate(0.06, 0), 0.06); });
  test('shadow comparison counts each side', () => assert.deepEqual(compareSets(['a', 'b', 'b'], ['b', 'c']), { live: 2, store: 2, both: 1, onlyLive: 1, onlyStore: 1 }));
});
