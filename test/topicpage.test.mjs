// The topic page: addresses, state, rough numbers and the evidence strip.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TOPIC_SLUG, evidenceSegments, fallbackSummary, roughly, topicSlug, topicState, usualLevel } from '../src/signal/topicpage.ts';

const it = (kind, o = {}) => ({ kind, by: '', source: '', title: 't', url: '', discussionUrl: '', ts: 1, likes: -1, replies: -1, views: -1, ...o });

describe('topicSlug', () => {
  test('a plain name keeps its words', () => {
    assert.equal(topicSlug('mcp auth bypass'), 'mcp-auth-bypass');
    assert.equal(topicSlug('GPT-5'), 'gpt-5');
    assert.equal(topicSlug('  kimi   k2 '), 'kimi-k2');
  });
  test('odd names get a readable part and a hash, and differ from their plain cousin', () => {
    const cpp = topicSlug('c++');
    assert.match(cpp, /^c-plus-plus-[a-z0-9]{5}$/);
    assert.notEqual(cpp, topicSlug('c'));
    assert.match(topicSlug('#rust'), /^rust-[a-z0-9]{5}$/);
    assert.match(topicSlug("kimi k2's"), /^kimi-k2-s-[a-z0-9]{5}$/);
    assert.match(topicSlug('日本語'), /^t-[a-z0-9]{5}$/);
    assert.notEqual(topicSlug('日本語'), topicSlug('中文'));
  });
  test('stable, and always a valid address', () => {
    for (const t of ['mcp auth bypass', 'c++', '#rust', "don't panic", 'x'.repeat(200), 'ünïcode näme', '日本語']) {
      assert.equal(topicSlug(t), topicSlug(t));
      assert.match(topicSlug(t), TOPIC_SLUG, t);
    }
  });
});

describe('topicState', () => {
  test('new, rising, steady, falling, and nothing when there is nothing to compare with', () => {
    assert.equal(topicState({ isNew: true, change: null }), 'new');
    assert.equal(topicState({ isNew: false, change: 2.4 }), 'rising');
    assert.equal(topicState({ isNew: false, change: 1.5 }), 'rising');
    assert.equal(topicState({ isNew: false, change: 1.1 }), 'steady');
    assert.equal(topicState({ isNew: false, change: 0.5 }), 'falling');
    assert.equal(topicState({ isNew: false, change: null }), null);
  });
});

describe('usualLevel', () => {
  test('median of the days before the last three; zero with too little history', () => {
    assert.equal(usualLevel([2, 4, 3, 5, 3, 4, 3, 2, 9, 12, 14]), 3);
    assert.equal(usualLevel([1, 2]), 0);
    assert.equal(usualLevel([]), 0);
  });
});

describe('roughly', () => {
  test('exact when small, rounded when large', () => {
    assert.equal(roughly(0), '0');
    assert.equal(roughly(7), '7');
    assert.equal(roughly(47), 'about 45');
    assert.equal(roughly(348), 'about 350');
    assert.equal(roughly(1960), 'about 2k');
    assert.equal(roughly(2300), 'about 2.5k');
    assert.equal(roughly(12_400), 'about 12k');
    assert.equal(roughly(1_240_000), 'about 1.2M');
  });
});

describe('evidenceSegments', () => {
  const items = [
    it('x', { by: '@a', likes: 1500, replies: 20 }), it('x', { by: '@b', likes: 600 }), it('x', { by: '@a', likes: 0 }),
    it('hn', { by: 'pg', source: 'HN', likes: 312, replies: 140 }),
    it('youtube', { source: 'Channel One', views: 40_000 }), it('youtube', { source: 'Channel Two', views: -1 }),
    it('rss', { source: 'The Verge' }), it('rss', { source: 'Ars' }), it('rss', { source: 'Ars' }),
  ];
  test('one segment per kind, each in its own unit', () => {
    const segs = evidenceSegments(items, { matched: 4, mentioned: 1 }, false);
    assert.deepEqual(segs.map((s) => s.kind), ['x', 'hn', 'youtube', 'rss', 'arxiv']);
    const by = Object.fromEntries(segs.map((s) => [s.kind, s]));
    assert.deepEqual(by.x.lines, ['3 posts from 2 accounts', 'about 2k likes']);
    assert.deepEqual(by.hn.lines, ['1 thread', '312 points, 140 comments']);
    assert.deepEqual(by.youtube.lines, ['2 videos from chosen channels', 'about 40k views (counted on 1 of 2)']);
    assert.deepEqual(by.rss.lines, ['3 articles from 2 outlets']);
    assert.deepEqual(by.arxiv.lines, ['4 papers on the subject in the last 30 days', '1 named in posts or on Hacker News']);
  });
  test('outlet and channel names only when the Signal shows its sources', () => {
    assert.equal(evidenceSegments(items, { matched: 0, mentioned: 0 }, false).some((s) => s.names), false);
    const by = Object.fromEntries(evidenceSegments(items, { matched: 0, mentioned: 0 }, true).map((s) => [s.kind, s]));
    assert.deepEqual(by.rss.names, ['The Verge', 'Ars']);
    assert.deepEqual(by.youtube.names, ['Channel One', 'Channel Two']);
    assert.equal(by.x.names, undefined);
  });
  test('says less when the numbers were not kept, and nothing for kinds with no items', () => {
    const segs = evidenceSegments([it('x', { by: '@a' }), it('hn')], { matched: 0, mentioned: 0 }, false);
    assert.deepEqual(segs.find((s) => s.kind === 'x').lines, ['1 post from 1 account']);
    assert.deepEqual(segs.find((s) => s.kind === 'hn').lines, ['1 thread']);
    assert.deepEqual(evidenceSegments([], { matched: 0, mentioned: 0 }, true), []);
  });
  test('papers with no uptake are a neutral state, not a weakness', () => {
    const [s] = evidenceSegments([], { matched: 3, mentioned: 0 }, false);
    assert.equal(s.lines[1], 'not discussed in posts yet');
  });
});

describe('fallbackSummary', () => {
  test('a line from the numbers', () => {
    const segs = evidenceSegments([it('x', { by: '@a' }), it('x', { by: '@b' }), it('hn')], { matched: 0, mentioned: 0 }, false);
    assert.equal(fallbackSummary({ label: 'mcp auth bypass', state: 'new', total: 3, days: 7, segments: segs, groups: 2 }),
      'mcp auth bypass is new: 3 items in the last 7 days across 2 groups of sources, most on X and Hacker News.');
    assert.equal(fallbackSummary({ label: 'rag', state: null, total: 1, days: 7, segments: [], groups: 1 }), 'rag is being talked about: 1 item in the last 7 days.');
  });
});
