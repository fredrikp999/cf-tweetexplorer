// The source card (A1): the public id of an item, its place in the wave, its neighbours in time, the reactions in each source's own unit, and the text of get_item.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ITEM_ID, buildCard, inTimeOrder, itemHref, itemId, neighbours, placeInWave, placeWords, reactionLines, whyWords } from '../src/signal/sourcecard.ts';
import { pickWatch, timelineDots } from '../src/signal/topicview.ts';
import { itemGoneOut, itemMissing, itemOut, itemsOut } from '../src/site/agentText.ts';

const H = 3_600_000, MIN = 60_000;
const T0 = Date.UTC(2026, 10, 7, 9, 0);
const it = (kind, ts, o = {}) => { const url = o.url ?? `https://example.com/${kind}/${ts}`; return { id: itemId(url), kind, ts, title: `${kind} item ${ts}`, url, by: 'a', source: 's', likes: -1, replies: -1, views: -1, discussionUrl: '', ...o }; };
const topic = { slug: 'mcp-auth-bypass', label: 'MCP auth bypass', term: 'mcp auth bypass', members: ['mcp bypass'], area: 'ai', board: { slug: 'ai-week', title: 'AI week' } };

describe('the item id', () => {
  test('eleven letters and digits, the same every time', () => {
    const id = itemId('https://news.ycombinator.com/item?id=42');
    assert.match(id, ITEM_ID);
    assert.equal(id, itemId('https://news.ycombinator.com/item?id=42'));
    assert.equal(id.length, 11);
  });
  test('different addresses give different ids; the part after # and spaces around do not count', () => {
    const a = itemId('https://example.com/a'), b = itemId('https://example.com/b');
    assert.notEqual(a, b);
    assert.equal(itemId(' https://example.com/a#comments '), a);
    const many = new Set(Array.from({ length: 5000 }, (_, i) => itemId(`https://x.com/u/status/${1000000 + i}`)));
    assert.equal(many.size, 5000);
  });
  test('an item without a web address has no id', () => {
    assert.equal(itemId(''), '');
    assert.equal(itemId('javascript:alert(1)'), '');
    assert.equal(itemId('not a url'), '');
  });
  test('the address of a card carries the area only for politics', () => {
    assert.equal(itemHref('abc', 'id123456789'), '/t/abc/i/id123456789');
    assert.equal(itemHref('abc', 'id123456789', 'politics'), '/t/abc/i/id123456789?area=politics');
  });
});

describe('place in the wave', () => {
  const items = [it('hn', T0), it('x', T0 + 40 * MIN), it('x', T0 + 90 * MIN), it('rss', T0 + 3 * H), it('x', T0 + 4 * 24 * H), it('x', T0 + 4 * 24 * H + 5 * MIN)];
  const sorted = inTimeOrder(items);
  test('orders by time and drops items without an id and repeats of one id', () => {
    const shuffled = [items[3], { ...items[1], id: undefined }, items[0], items[2], items[0]];
    assert.deepEqual(inTimeOrder(shuffled).map((i) => i.ts), [T0, T0 + 90 * MIN, T0 + 3 * H]);
  });
  test('rank, size and lag are taken within one wave, split by a quiet stretch', () => {
    const p = placeInWave(sorted, items[2].id);
    assert.deepEqual({ rank: p.rank, size: p.size, lag: p.lag, start: p.start }, { rank: 3, size: 4, lag: 90 * MIN, start: T0 });
    const later = placeInWave(sorted, items[5].id);
    assert.deepEqual({ rank: later.rank, size: later.size }, { rank: 2, size: 2 });
  });
  test('says it in words', () => {
    assert.match(placeWords(placeInWave(sorted, items[2].id)), /^The 3rd of 4 items in this wave of talk, 1 h 30 min after the first \(7 Nov 09:00 UTC\)\.$/);
    assert.match(placeWords(placeInWave(sorted, items[0].id)), /^The first of 4 items/);
    assert.match(placeWords(placeInWave(sorted, items[1].id)), /^The 2nd of 4/);
    assert.equal(placeWords(placeInWave([it('x', T0)], it('x', T0).id)), 'The only item in its wave of talk.');
    assert.equal(placeWords(null), '');
  });
  test('an item with a date but no time of day cannot be placed', () => {
    const dateOnly = it('rss', Date.UTC(2026, 10, 8, 0, 0));
    assert.equal(placeInWave(inTimeOrder([...items, dateOnly]), dateOnly.id), null);
    assert.equal(placeInWave(sorted, 'zzzzzzzzzzz'), null);
  });
  test('ordinals: 11th, 12th, 13th, 21st', () => {
    const many = inTimeOrder(Array.from({ length: 25 }, (_, i) => it('x', T0 + i * MIN)));
    const word = (n) => placeWords(placeInWave(many, many[n - 1].id));
    assert.match(word(11), /^The 11th/); assert.match(word(12), /^The 12th/); assert.match(word(13), /^The 13th/); assert.match(word(21), /^The 21st/);
  });
});

describe('before and after', () => {
  const sorted = inTimeOrder([it('hn', T0), it('x', T0 + 10 * MIN), it('rss', T0 + 2 * H)]);
  test('the neighbours in time, with the gap', () => {
    const n = neighbours(sorted, sorted[1].id);
    assert.equal(n.before.id, sorted[0].id); assert.equal(n.before.gap, 10 * MIN);
    assert.equal(n.after.id, sorted[2].id); assert.equal(n.after.gap, 110 * MIN);
  });
  test('nothing before the first or after the last', () => {
    assert.equal(neighbours(sorted, sorted[0].id).before, null);
    assert.equal(neighbours(sorted, sorted[2].id).after, null);
    assert.deepEqual(neighbours(sorted, 'nope'), { before: null, after: null });
  });
});

describe('reactions in the unit of each source', () => {
  test('X: likes and replies as rough numbers, views when known', () => {
    assert.deepEqual(reactionLines({ kind: 'x', likes: 1234, replies: 12, views: 50_000 }), ['about 1k likes', 'about 10 replies', 'about 50k views']);
  });
  test('Hacker News: points and comments, exact', () => {
    assert.deepEqual(reactionLines({ kind: 'hn', likes: 312, replies: 1 , views: -1 }), ['312 points', '1 comment']);
  });
  test('YouTube: views only', () => assert.deepEqual(reactionLines({ kind: 'youtube', likes: 5, replies: 2, views: 120_000 }), ['about 120k views']));
  test('what was not recorded (-1) and blogs say nothing, and nothing is added up', () => {
    assert.deepEqual(reactionLines({ kind: 'x', likes: -1, replies: -1, views: -1 }), []);
    assert.deepEqual(reactionLines({ kind: 'rss', likes: 40, replies: 3, views: 900 }), []);
  });
});

describe('why it is here', () => {
  test('names the lead name, another name, or says it came in by its title', () => {
    assert.match(whyWords(topic, ['mcp auth bypass']), /“mcp auth bypass”, the name this topic is listed under/);
    assert.match(whyWords(topic, ['mcp bypass']), /one of the other names counted under MCP auth bypass/);
    assert.match(whyWords(topic, ['mcp bypass', 'mcp auth bypass']), /among them the name this topic is listed under/);
    assert.match(whyWords(topic, []), /names appear in its title/);
    assert.match(whyWords(topic, ['something else']), /names appear in its title/);
  });
});

describe('the card', () => {
  const pool = [it('hn', T0, { likes: 100, replies: 20, discussionUrl: 'https://news.ycombinator.com/item?id=1' }), it('x', T0 + 40 * MIN, { likes: 900 }), it('rss', T0 + 2 * H)];
  test('builds from the pool, with place, neighbours, reactions and extras', () => {
    const c = buildCard(pool, pool[1].id, topic, { matched: ['mcp auth bypass'], copies: 3, alsoIn: [{ slug: 'oauth', label: 'OAuth' }] });
    assert.equal(c.id, pool[1].id);
    assert.equal(c.item.url, pool[1].url);
    assert.deepEqual(c.reactions, ['about 900 likes']);
    assert.equal(c.why.place.rank, 2);
    assert.match(c.why.placeWords, /^The 2nd of 3 items in this wave of talk, 40 min after the first/);
    assert.equal(c.before.id, pool[0].id); assert.equal(c.after.id, pool[2].id);
    assert.equal(c.copies, 3); assert.equal(c.alsoIn[0].slug, 'oauth');
  });
  test('copies are null (not checked) unless given, and an id the pool lacks has no card', () => {
    assert.equal(buildCard(pool, pool[0].id, topic).copies, null);
    assert.equal(buildCard(pool, 'zzzzzzzzzzz', topic), null);
  });
});

describe('the id travels with the topic data', () => {
  test('timeline dots and videos carry the id of their item, only when it is named', () => {
    const items = [it('x', T0 + H, { likes: 5 })];
    const dots = timelineDots(items, { from: T0, to: T0 + 24 * H, hide: false });
    assert.equal(dots[0].item.id, items[0].id);
    assert.equal(timelineDots(items, { from: T0, to: T0 + 24 * H, hide: true })[0].item, undefined);
    const w = pickWatch([], [{ via: 'Videos', title: 'MCP auth bypass explained', url: 'https://www.youtube.com/watch?v=abcdefghijk', source: 'Chan', by: 'Chan', ts: T0, reactions: 0 }], ['mcp auth bypass']);
    assert.equal(w[0].id, itemId('https://www.youtube.com/watch?v=abcdefghijk'));
  });
});

describe('get_item text', () => {
  const pool = [it('hn', T0, { title: 'Show HN: a bypass', likes: 100, replies: 20, discussionUrl: 'https://news.ycombinator.com/item?id=1' }), it('x', T0 + 40 * MIN, { title: 'a post', likes: 900, by: '@someone' }), it('rss', T0 + 2 * H)];
  const card = buildCard(pool, pool[1].id, topic, { matched: ['mcp auth bypass'], copies: 0, alsoIn: [{ slug: 'oauth', label: 'OAuth' }] });
  test('leads with the item, then why, the neighbours and where to go next', () => {
    const a = itemOut(card, 'https://site.test');
    assert.ok(!a.error);
    assert.match(a.text, /\*\*\[a post\]\(https:\/\/example\.com\/x\/\d+\)\*\* \(X, @someone, 2026-11-07 09:40 UTC\) in \[MCP auth bypass\]\(https:\/\/site\.test\/t\/mcp-auth-bypass\)/);
    assert.match(a.text, /Reactions, in this source's own unit: about 900 likes\./);
    assert.match(a.text, /## Why it is here/);
    assert.match(a.text, /The 2nd of 3 items/);
    assert.match(a.text, /## Said the same\nNo later post/);
    assert.match(a.text, /Before \(40 min earlier\): \[Show HN: a bypass\]/);
    assert.match(a.text, /\*\*Next:\*\* .*get_item.*item: "/);
    assert.equal(a.data.id, card.id);
    assert.equal(a.data.reactions.likes, 900);
    assert.equal(a.data.reactions.views, null);
    assert.equal(a.data.after.url, `https://site.test/t/mcp-auth-bypass/i/${pool[2].id}`);
  });
  test('missing and gone answers are errors that say what to do', () => {
    const m = itemMissing({ topic: 'x', item: 'abc' }, 'https://site.test');
    assert.ok(m.error); assert.match(m.text, /get_topic_items/);
    const g = itemGoneOut({ topic: { slug: 'mcp-auth-bypass', label: 'MCP auth bypass', area: 'ai' }, original: 'https://example.com/old' }, 'abcdefghijk', 'https://site.test');
    assert.ok(g.error); assert.match(g.text, /https:\/\/example\.com\/old/); assert.equal(g.data.gone, true);
  });
  test('get_topic_items lines end with the item id and point to get_item', () => {
    const a = itemsOut({ found: true, slug: 'mcp-auth-bypass', label: 'MCP auth bypass', proof: true, total: 1, counts: { x: 1 }, items: [pool[1]] }, { topic: 'mcp-auth-bypass', sort: 'new', offset: 0 }, 'https://site.test');
    assert.ok(a.text.includes('`' + pool[1].id + '`'));
    assert.match(a.text, /get_item/);
    assert.equal(a.data.items[0].id, pool[1].id);
    assert.equal(a.data.items[0].cardUrl, `https://site.test/t/mcp-auth-bypass/i/${pool[1].id}`);
  });
});
