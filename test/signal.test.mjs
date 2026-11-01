import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTerms } from '../src/signal/terms.ts';
import { distinctive, dropParts, findEvergreen, foldPlurals, notSteady, rising, scoreTerms } from '../src/signal/score.ts';

describe('extractTerms', () => {
  test('hashtags, words, phrases and acronyms; no links, mentions or stop words', () => {
    const t = extractTerms('The Fed holds interest rates. @someone says AI chips #Nvidia https://example.com/x');
    for (const want of ['#nvidia', 'interest', 'rates', 'interest rates', 'ai', 'chips', 'ai chips', 'holds']) assert.ok(t.includes(want), want);
    for (const no of ['the', 'someone', 'https', 'example', 'rates ai']) assert.ok(!t.includes(no), no);
  });
  test('a phrase does not run across a sentence break, and each term is counted once per text', () => {
    const t = extractTerms('Markets fell. Apple rose. Apple rose again');
    assert.ok(!t.includes('fell apple'));
    assert.equal(t.filter((x) => x === 'apple rose').length, 1);
  });
  test('is bounded and tolerates junk', () => {
    assert.ok(extractTerms(Array.from({ length: 200 }, (_, i) => `word${'x'.repeat(i % 5)}abc`).join(' ')).length <= 40);
    assert.deepEqual(extractTerms(''), []);
    assert.deepEqual(extractTerms(undefined), []);
  });
});

const G = (key, weight = 1) => ({ key, name: key, weight });
const counts = (o) => new Map(Object.entries(o));

describe('scoreTerms', () => {
  const groups = [G('x'), G('news'), G('hn')];
  const items = { x: 100, news: 100, hn: 100 }, prevItems = { x: 100, news: 100, hn: 100 };

  test('a term in every group is shared; a term in one group is single', () => {
    const { terms } = scoreTerms({ groups, items, prevItems, prev: counts({}),
      cur: counts({ everywhere: { x: 20, news: 20, hn: 20 }, onlyx: { x: 30 }, some: { x: 10, news: 5 } }) });
    const by = Object.fromEntries(terms.map((t) => [t.term, t]));
    assert.equal(by.everywhere.kind, 'shared');
    assert.equal(by.onlyx.kind, 'single');
    assert.equal(by.onlyx.topGroup, 'x');
    assert.ok(by.onlyx.exclusivity > 0.99);
    assert.equal(by.some.kind, 'mixed');
  });

  test('weights move the signal: muting a group removes its voice', () => {
    const cur = counts({ topic: { x: 30, news: 0, hn: 0 }, other: { x: 0, news: 20, hn: 20 } });
    const a = scoreTerms({ groups, items, prevItems, cur, prev: counts({}) }).terms;
    assert.equal(a[0].term, 'other');
    const b = scoreTerms({ groups: [G('x', 3), G('news', 1), G('hn', 1)], items, prevItems, cur, prev: counts({}) }).terms;
    assert.equal(b[0].term, 'topic');
    const c = scoreTerms({ groups: [G('x', 0), G('news'), G('hn')], items, prevItems, cur, prev: counts({}) });
    assert.ok(!c.terms.some((t) => t.term === 'topic'), 'topic only lived in the muted group');
    assert.equal(c.active.length, 2);
  });

  test('a busy group does not drown a small one: shares, not counts', () => {
    const { terms } = scoreTerms({ groups: [G('big'), G('small')], items: { big: 1000, small: 20 }, prevItems: {}, prev: counts({}),
      cur: counts({ t: { big: 10, small: 10 } }) });
    assert.ok(terms[0].groups.find((g) => g.key === 'small').part > 0.9);
  });

  test('change and new terms need an earlier window with enough items', () => {
    const cur = counts({ up: { x: 30, news: 30 }, flat: { x: 20, news: 20 }, fresh: { x: 15, news: 15 } });
    const prev = counts({ up: { x: 5, news: 5 }, flat: { x: 20, news: 20 } });
    const r = scoreTerms({ groups: [G('x'), G('news')], items, prevItems, cur, prev });
    const by = Object.fromEntries(r.terms.map((t) => [t.term, t]));
    assert.ok(by.up.change > 3);
    assert.ok(Math.abs(by.flat.change - 1) < 0.01);
    assert.equal(by.fresh.isNew, true);
    assert.deepEqual(rising(r.terms, 5).map((t) => t.term).sort(), ['fresh', 'up']);   // flat is not rising
    const none = scoreTerms({ groups: [G('x')], items: { x: 100 }, prevItems: { x: 2 }, cur: counts({ up: { x: 30 } }), prev: counts({}) });
    assert.equal(none.baselineOk, false);
    assert.equal(none.terms[0].change, null);
    assert.equal(none.terms[0].isNew, false);
  });

  test('terms below the minimum, and everything when nothing has a weight, are left out', () => {
    const big = { x: 1000, news: 1000, hn: 1000 };
    assert.deepEqual(scoreTerms({ groups, items: big, prevItems, prev: counts({}), cur: counts({ rare: { x: 2 } }) }).terms, []);
    assert.equal(scoreTerms({ groups, items, prevItems, prev: counts({}), cur: counts({ rare: { x: 2 }, once: { x: 1 } }) }).terms.length, 1, 'a small window: two mentions are enough, one is not');
    assert.deepEqual(scoreTerms({ groups: [G('x', 0)], items, prevItems, prev: counts({}), cur: counts({ t: { x: 50 } }) }).terms, []);
  });

  test('one stray mention in a big group is not presence', () => {
    const { terms } = scoreTerms({ groups, items, prevItems, prev: counts({}), cur: counts({ t: { x: 30, news: 1, hn: 1 } }) });
    assert.equal(terms[0].breadth, 1);
    assert.equal(terms[0].kind, 'single');
  });
});

describe('corroboration', () => {
  test('a term only one source mentions is left out when two are needed', () => {
    const cur = counts({ footer: { x: 12 }, topic: { x: 8, news: 6 } });
    const voices = new Map([['footer', 1], ['topic', 3]]);
    const base = { groups: [G('x'), G('news')], items: { x: 100, news: 100 }, prevItems: {}, prev: counts({}), cur };
    assert.deepEqual(scoreTerms({ ...base, voices, minVoices: 2 }).terms.map((t) => t.term), ['topic']);
    assert.deepEqual(scoreTerms({ ...base, voices, minVoices: 1 }).terms.map((t) => t.term).sort(), ['footer', 'topic']);
    assert.equal(scoreTerms(base).terms.length, 2, 'no voices given: nothing is dropped');
  });
});

describe('steady background', () => {
  test('a topic at its usual level is background; new, growing or unknown ones are not', () => {
    const cur = counts({ steady: { x: 30, news: 30 }, grow: { x: 30, news: 30 }, fresh: { x: 15, news: 15 } });
    const prev = counts({ steady: { x: 30, news: 30 }, grow: { x: 10, news: 10 } });
    const r = scoreTerms({ groups: [G('x'), G('news')], items: { x: 100, news: 100 }, prevItems: { x: 100, news: 100 }, cur, prev });
    assert.deepEqual(r.terms.filter(notSteady).map((t) => t.term).sort(), ['fresh', 'grow']);
    const none = scoreTerms({ groups: [G('x')], items: { x: 100 }, prevItems: {}, cur: counts({ t: { x: 30 } }), prev: counts({}) });
    assert.deepEqual(none.terms.filter(notSteady).map((t) => t.term), ['t'], 'no earlier period: nothing is called background');
  });
});

describe('boilerplate words', () => {
  test('footer verbs of video descriptions are not terms', () => {
    const t = extractTerms('Join our newsletter, follow links below for sponsorship inquiries. Claude Code review');
    for (const no of ['join', 'newsletter', 'links', 'sponsorship', 'inquiries', 'sponsorship inquiries']) assert.ok(!t.includes(no), no);
    assert.ok(t.includes('claude code'));
    assert.ok(!extractTerms('Some post submitted by /u/someone [link] [comments]').includes('submitted'), 'Reddit feed footer');
  });
});

describe('dropParts and distinctive', () => {
  test('keeps the phrase when it carries almost all of the word\'s mentions', () => {
    const t = (term, docs) => ({ term, docs, groups: [] });
    assert.deepEqual(dropParts([t('interest rates', 20), t('interest', 22), t('rates', 40), t('fed', 9)]).map((x) => x.term), ['interest rates', 'rates', 'fed']);
  });
  test('what one group talks about that the others do not', () => {
    const { terms } = scoreTerms({ groups: [G('x'), G('news')], items: { x: 100, news: 100 }, prevItems: {}, prev: counts({}),
      cur: counts({ mine: { x: 30, news: 1 }, both: { x: 20, news: 20 }, theirs: { x: 1, news: 30 } }) });
    assert.deepEqual(distinctive(terms, 'x', 5).map((t) => t.term), ['mine']);
    assert.deepEqual(distinctive(terms, 'news', 5).map((t) => t.term), ['theirs']);
  });
});

import { boostByEngagement, indexItems, mergeTopics, relatedTerms, topicEngagement, topicItems } from '../src/signal/topics.ts';
describe('topics', () => {
  const T = (term, signal) => ({ term, signal, docs: 5, prev: 0, change: null, isNew: false, breadth: 1, active: 1, exclusivity: 1, topGroup: 'x', kind: 'single', groups: [] });
  const item = (ts, ...terms) => ({ ts, terms: new Set(terms) });
  const items = [
    item(1, 'kimi', 'kimi k2', 'moonshot', 'thinking', 'model'),
    item(2, 'kimi', 'kimi k2', 'moonshot', 'benchmark', 'model'),
    item(3, 'kimi', 'moonshot', 'open source', 'model'),
    item(4, 'deepseek', 'deepseek v4', 'model', 'release'),
    item(5, 'deepseek', 'model', 'release', 'chips'),
    item(6, 'model', 'weather'), item(7, 'model', 'sports'), item(8, 'model', 'news'),
  ];
  const post = indexItems(items);

  test('terms in the same items become one topic, named by its strongest phrase', () => {
    const c = mergeTopics([T('model', 9), T('kimi', 8), T('moonshot', 7), T('kimi k2', 6), T('deepseek', 5)], post, 10);
    assert.deepEqual(c.map((x) => x.lead.term), ['model', 'kimi', 'deepseek']);
    const kimi = c.find((x) => x.lead.term === 'kimi');
    assert.deepEqual(kimi.members.map((m) => m.term), ['kimi', 'moonshot', 'kimi k2']);
    assert.equal(kimi.label, 'kimi k2');
    assert.equal(c.find((x) => x.lead.term === 'model').label, 'model', 'a word in everything stays alone');
  });
  test('a term in a single item stands alone, and at most n topics are made', () => {
    const c = mergeTopics([T('thinking', 3), T('chips', 2), T('weather', 1)], post, 2);
    assert.equal(c.length, 2);
  });
  test('related terms are the ones that go with it, rarer ones first, and not its own parts', () => {
    const r = relatedTerms(['kimi', 'kimi k2'], items, post, 4);
    assert.ok(r.includes('moonshot'));
    assert.ok(!r.includes('kimi') && !r.includes('kimi k2'));
    assert.ok(r.indexOf('moonshot') < r.indexOf('model'), 'moonshot is more specific than model');
    assert.deepEqual(relatedTerms(['weather'], items, post), [], 'one item is not enough to say what goes with it');
  });
  test('the best items carry most of the topic\'s terms, then the newest', () => {
    assert.deepEqual(topicItems(['kimi', 'kimi k2', 'moonshot'], items, post, 3), [1, 0, 2]);
  });
});

import { estimatePer1000, normTopic, parseTopics, topicUser } from '../src/signal/ai.ts';
describe('AI topics', () => {
  test('topic names are cleaned and generic ones dropped', () => {
    assert.equal(normTopic('  Kimi K2! '), 'kimi k2');
    assert.equal(normTopic('"Rust 2.0"'), 'rust 2.0');
    assert.equal(normTopic('ai'), null);
    assert.equal(normTopic('News'), null);
    assert.equal(normTopic('one two three four five'), null);
    assert.equal(normTopic('2024'), null);
    assert.equal(normTopic(''), null);
    assert.equal(normTopic('x'.repeat(50)), null);
    assert.equal(normTopic('Ångström'), 'ångström');
  });
  test('parses the answer, wrapped or not, and keeps only what is valid', () => {
    const m = parseTopics('Sure:\n```json\n{"items":[{"i":1,"t":["Kimi K2","moonshot","kimi k2","video","a b c","d"]},{"i":3,"t":["bbrouter","openai"]},{"i":9,"t":["out of range"]},{"i":1,"t":["dup"]}]}\n```', 3);
    assert.deepEqual(m.get(0), ['kimi k2', 'moonshot', 'a b c']);
    assert.deepEqual(m.get(2), ["bbrouter"]);
    assert.equal(m.has(1), false, 'an item the model skipped is absent, not empty');
    assert.equal(m.size, 2);
    assert.equal(parseTopics('not json at all', 3).size, 0);
    assert.equal(parseTopics('{"items":"nope"}', 3).size, 0);
  });
  test('the prompt numbers the items from 1 and strips links', () => {
    assert.equal(topicUser(['Hello https://x.co/a world', '']).content, '1. Hello world\n2. (no text)');
  });
  test('a thousand items cost a few cents on a cheap model', () => {
    const c = estimatePer1000(0.06, 0.18);
    assert.ok(c > 0.005 && c < 0.05, String(c));
  });
});

import { cleanFilter, makeBlocker } from '../src/signal/filter.ts';
describe('filter', () => {
  test('a list from the browser is cleaned', () => {
    assert.deepEqual(cleanFilter([' AI ', { term: 'Model*', phrases: true }, 'ai', '', 'a b c d e', 'x'.repeat(41), { term: '#Hype' }]),
      [{ term: 'ai', phrases: false }, { term: 'model', phrases: true }, { term: '#hype', phrases: false }]);
    assert.deepEqual(cleanFilter(null), []);
    assert.equal(cleanFilter(Array.from({ length: 300 }, (_, i) => 'w' + i)).length, 200);
  });
  test('exact entries hide the term only; phrase entries hide phrases that contain the word', () => {
    const b = makeBlocker(cleanFilter([{ term: 'ai' }, { term: 'model', phrases: true }]));
    assert.equal(b('ai'), true);
    assert.equal(b('ai agents'), false, 'a legitimate topic that contains a filtered word stays');
    assert.equal(b('model'), true);
    assert.equal(b('open model release'), true);
    assert.equal(b('modeling'), false, 'whole words only');
    assert.equal(makeBlocker([])('anything'), false);
  });
});

describe('plurals and thin baselines', () => {
  test('"game" and "games" become one term; "ss", "us", "is" and "os" endings are left alone', () => {
    const f = foldPlurals(counts({ game: { x: 4, hn: 1 }, games: { x: 3, hn: 5 }, glass: { x: 2 }, lotus: { x: 2 }, lot: { x: 1 }, thing: { x: 1 } }));
    assert.deepEqual(f.get('game'), { x: 4, hn: 5 });
    assert.ok(!f.has('games') && f.has('glass') && f.has('lotus'));
  });
  test('an earlier window much smaller than this one is no baseline: nothing is called new', () => {
    const r = scoreTerms({ groups: [G('x')], items: { x: 200 }, prevItems: { x: 20 }, cur: counts({ t: { x: 30 } }), prev: counts({}) });
    assert.equal(r.baselineOk, false);
    assert.equal(r.terms[0].isNew, false);
  });
});

describe('reactions', () => {
  const T = (term, signal) => ({ lead: { term, signal } });
  test('a topic people reacted to climbs; with no reactions the order stays', () => {
    const a = T('quiet', 1.0), b = T('loud', 0.8);
    assert.deepEqual(boostByEngagement([a, b], [0, 5000]).map((x) => x.lead.term), ['loud', 'quiet']);
    assert.deepEqual(boostByEngagement([a, b], [0, 0]).map((x) => x.lead.term), ['quiet', 'loud']);
  });
  test("engagement sums over a topic's items; the headline shown is the one with most reactions", () => {
    const items = [{ terms: new Set(['k']), ts: 1, eng: 5 }, { terms: new Set(['k']), ts: 2, eng: 300 }, { terms: new Set(['k']), ts: 3 }];
    const post = indexItems(items);
    assert.equal(topicEngagement(['k'], items, post), 305);
    assert.equal(topicItems(['k'], items, post, 1)[0], 1);
  });
});

describe('always-there terms', () => {
  test('a term on most days is evergreen, but not with too little history', () => {
    const d = new Map([['claude', 12], ['kimi k2', 2]]);
    assert.deepEqual([...findEvergreen(d, 14)], ['claude']);
    assert.equal(findEvergreen(d, 4).size, 0);
  });
  test('an evergreen term is background unless it spikes', () => {
    const base = { term: 't', signal: 0.1, prev: 0.1, docs: 9, isNew: false, breadth: 2, active: 2, exclusivity: 0.5, topGroup: 'x', kind: 'mixed', groups: [], evergreen: true };
    assert.equal(notSteady({ ...base, change: 1.4 }), false);
    assert.equal(notSteady({ ...base, change: 2.5 }), true);
    assert.equal(notSteady({ ...base, evergreen: false, change: 1.4 }), true);
    assert.deepEqual(rising([{ ...base, change: 1.8 }], 5), []);
  });
  test('model plurals are folded, big names alone are not topics', () => {
    assert.equal(normTopic('LLMs'), null);
    assert.equal(normTopic('openai'), null);
    assert.equal(normTopic('Chip exports'), 'chip export');
    assert.equal(normTopic('Mozilla ethics'), 'mozilla ethics');
  });
});

import { llmCost, openrouterIdOf } from '../src/summarize/pricing.ts';
describe('model prices', () => {
  test("Anthropic's own model ids are priced like the same model on OpenRouter", () => {
    assert.equal(openrouterIdOf('claude-sonnet-5-5'), 'anthropic/claude-sonnet-5.5');
    assert.equal(openrouterIdOf('meta-llama/llama-4-scout'), 'meta-llama/llama-4-scout');
    assert.ok(llmCost('claude-sonnet-5-5', 1_000_000, 0) > 0, 'a briefing written through Anthropic is not free');
    assert.equal(llmCost('mock', 1000, 1000), null);
  });
});

describe('cache tokens', () => {
  test('cached input is billed apart: a read at a tenth, a write at a quarter more', () => {
    const base = llmCost('claude-sonnet-5-5', 1_000_000, 0);
    assert.ok(Math.abs(llmCost('claude-sonnet-5-5', 0, 0, { read: 1_000_000 }) - base * 0.1) < 1e-9);
    assert.ok(Math.abs(llmCost('claude-sonnet-5-5', 0, 0, { write: 1_000_000 }) - base * 1.25) < 1e-9);
  });
});

import { cleanTitle, isBait } from '../src/signal/clean.ts';
describe('clean', () => {
  test('giveaways and like-and-reply-to-win posts are bait; news is not', () => {
    for (const t of ["I'm giving away a new iPhone 18 Pro Max. In 5 hours I'll pick 85 random people from my replies to win. RULES: like this post, comment \"Ready\" and follow",
      'GIVEAWAY: 3 GPUs! Like + RT to enter', 'Comment "AI" to get my free guide', 'Like and retweet to win a Claude Max subscription']) assert.ok(isBait(t), t);
    for (const t of ['Anthropic takes steps to block Claude from reverse-engineering video games', 'Nvidia gives away nothing in its earnings call, analysts say it will win the year',
      'Like many developers, I comment my code']) assert.equal(isBait(t), false, t);
  });
  test('titles lose links and are cut at a word', () => {
    assert.equal(cleanTitle('Read this https://t.co/abc now'), 'Read this now');
    assert.equal(cleanTitle('Trailing link: https://t.co/x'), 'Trailing link');
    const long = cleanTitle('word '.repeat(60), 50);
    assert.ok(long.endsWith('…') && long.length <= 51 && !long.includes('wo…'));
  });
});
describe('merging reordered names', () => {
  test('"claude anthropic" and "anthropic claude" become one topic', () => {
    const T = (term, signal) => ({ term, signal, docs: 2, prev: 0, change: null, isNew: false, breadth: 1, active: 1, exclusivity: 1, topGroup: 'x', kind: 'single', groups: [], evergreen: false });
    const post = new Map([['claude anthropic', [0, 1]], ['anthropic claude', [2, 3]]]);
    const m = mergeTopics([T('claude anthropic', 0.2), T('anthropic claude', 0.1)], post, 10);
    assert.equal(m.length, 1);
    assert.equal(m[0].members.length, 2);
  });
  test('one viral item lifts a topic only up to the cap', () => {
    const items = [{ terms: new Set(['k']), ts: 1, eng: 50000 }, { terms: new Set(['k']), ts: 2, eng: 10 }];
    assert.equal(topicEngagement(['k'], items, indexItems(items), 1000), 1010);
  });
});

import { fetchYoutubeApi, setYoutubeKey } from '../src/sources/youtube.ts';
describe('YouTube API fallback', () => {
  test('a channel feed is read as its uploads playlist, with the same ids as the feed', async () => {
    setYoutubeKey('k');
    const real = globalThis.fetch; let asked = '';
    globalThis.fetch = async (u) => { asked = String(u); return new Response(JSON.stringify({ items: [
      { snippet: { title: 'Kimi K2 explained', description: 'd', channelTitle: 'AI Explained', resourceId: { videoId: 'abcdefghijk' } }, contentDetails: { videoId: 'abcdefghijk', videoPublishedAt: '2026-10-31T10:00:00Z' } },
      { snippet: { title: 'Private video' }, contentDetails: { videoId: 'zzzzzzzzzzz' } }] }), { status: 200 }); };
    try {
      const r = await fetchYoutubeApi('https://www.youtube.com/feeds/videos.xml?channel_id=UCNJ1Ymd5yFuUPtn21xtRbbw');
      assert.match(asked, /playlistId=UUNJ1Ymd5yFuUPtn21xtRbbw/);
      assert.equal(r.items.length, 1);
      assert.equal(r.items[0].id, 'yt:abcdefghijk');
      assert.equal(r.title, 'AI Explained');
    } finally { globalThis.fetch = real; }
  });
});
