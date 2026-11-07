// Search across everything: the words, the ranking of each kind, grouping and paging, addresses, and the text the public tool answers with.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ARXIV_THANKS } from '../src/sources/arxiv.ts';
import { MAX_QUERY, PAGE_SIZE, PREVIEW, cleanQuery, emptyAnswer, itemQuality, pageOf, paperQuality, parseKinds, queryWords, rankBriefings, rankItems, rankPapers, rankTopics, searchHref, sliceFor, snippetAround, tokens, tooShort, topicFor, topicQuality, windowOfSearch } from '../src/site/search.ts';
import { searchOut } from '../src/site/agentText.ts';

const O = 'https://site.example';

describe('the query', () => {
  test('is cleaned and capped', () => {
    assert.equal(cleanQuery('  MCP \n\t security\u0000 '), 'MCP security');
    assert.equal(cleanQuery('x'.repeat(500)).length, MAX_QUERY);
    assert.equal(cleanQuery(null), '');
  });
  test('words are lower case, c++ and gpt-5.1 survive, six at most', () => {
    assert.deepEqual(tokens('C++ and GPT-5.1.'), ['c++', 'and', 'gpt', '5.1']);
    assert.equal(queryWords('aa bb cc dd ee ff gg hh').length, 6);
  });
  test('a lone letter is too short, two letters are not', () => {
    assert.equal(tooShort('a'), true); assert.equal(tooShort('   '), true); assert.equal(tooShort('ai'), false); assert.equal(tooShort('a 5'), true);
  });
  test('kinds, window and page fall back to safe values', () => {
    assert.deepEqual(parseKinds('papers,topics,nonsense'), ['topics', 'papers']);
    assert.deepEqual(parseKinds('nonsense'), ['topics', 'items', 'papers', 'briefings']);
    assert.deepEqual(parseKinds(null), ['topics', 'items', 'papers', 'briefings']);
    assert.equal(windowOfSearch('30'), 30); assert.equal(windowOfSearch('9'), 14); assert.equal(windowOfSearch(undefined), 14);
    assert.equal(pageOf('3'), 3); assert.equal(pageOf('99'), 5); assert.equal(pageOf('-2'), 1); assert.equal(pageOf('x'), 1);
  });
});

describe('topics', () => {
  const t = (term, o = {}) => ({ term, label: term, members: [], summary: '', ...o });
  test('exact name beats a run in a name beats all words beats a member beats the summary', () => {
    const w = queryWords('mcp auth');
    const q = (x) => topicQuality(w, x).quality;
    assert.equal(q(t('mcp auth')), 5);
    assert.equal(q(t('mcp auth bypass')), 4);
    assert.equal(q(t('auth in mcp')), 3);
    assert.equal(q(t('model context protocol', { members: ['mcp auth'] })), 2);
    assert.equal(q(t('security', { summary: 'The mcp spec has an auth flaw.' })), 1);
    assert.equal(q(t('rag')), 0);
  });
  test('the last word may be the start of a word, the others may not', () => {
    assert.equal(topicQuality(queryWords('langch'), t('langchain')).quality, 5);
    assert.equal(topicQuality(queryWords('lang chain'), t('langchain')).quality, 0);
  });
  test('says where it matched', () => {
    assert.equal(topicQuality(queryWords('claude'), t('anthropic', { members: ['claude code'] })).field, 'member');
    assert.equal(topicQuality(queryWords('claude'), t('anthropic', { summary: 'Claude got hooks' })).field, 'summary');
  });
  test('ranked by fit, then the lens, then the Signal score', () => {
    const r = rankTopics([{ label: 'a', quality: 4, signal: 0.9 }, { label: 'b', quality: 5, signal: 0.1 }, { label: 'c', quality: 4, signal: 0.2, inLens: true }, { label: 'd', quality: 4, signal: 0.5 }]);
    assert.deepEqual(r.map((x) => x.label), ['b', 'c', 'a', 'd']);
  });
});

describe('items', () => {
  test('a title match is better than a match in the text', () => {
    const w = queryWords('rust');
    assert.equal(itemQuality(w, 'Rust 2.0 released', 'x'), 2);
    assert.equal(itemQuality(w, 'Release notes', 'now with rust'), 1);
    assert.equal(itemQuality(w, 'Release notes', 'nothing'), 0);
  });
  test('title matches first, then newest; reactions never decide', () => {
    assert.deepEqual(rankItems([{ quality: 1, ts: 9, n: 'a' }, { quality: 2, ts: 1, n: 'b' }, { quality: 2, ts: 5, n: 'c' }]).map((x) => x.n), ['c', 'b', 'a']);
  });
  test('an item links to the topic whose longest name it contains', () => {
    const topics = [{ slug: 'claude', label: 'Claude', names: ['claude'] }, { slug: 'claude-code', label: 'Claude Code', names: ['claude code', 'cc'] }, { slug: 'ai', label: 'AI', names: ['ai'] }];
    assert.equal(topicFor('New Claude Code hooks', topics).slug, 'claude-code');
    assert.equal(topicFor('Claude is out', topics).slug, 'claude');
    assert.equal(topicFor('Nothing here, said Aiden', topics), undefined);   // "ai" is too short to link on, and "aiden" is another word
    assert.equal(topicFor('claudette', topics), undefined);
  });
});

describe('papers and briefings', () => {
  test('a run in the title is best, then words in the title, then the abstract', () => {
    const w = queryWords('tool use');
    assert.equal(paperQuality(w, 'Tool use in agents', 'x'), 3);
    assert.equal(paperQuality(w, 'Use of a tool', 'x'), 2);
    assert.equal(paperQuality(w, 'Agents', 'We study tool use.'), 1);
    assert.equal(paperQuality(w, 'Agents', 'We study tools'), 0);
  });
  test('papers: fit, lens, uptake, then newest', () => {
    const r = rankPapers([{ id: 1, quality: 1, score: 9, published: 1 }, { id: 2, quality: 3, score: 0, published: 1 }, { id: 3, quality: 1, score: 0, published: 5, inLens: true }, { id: 4, quality: 1, score: 9, published: 3 }]);
    assert.deepEqual(r.map((x) => x.id), [2, 3, 4, 1]);
  });
  test('briefings: theme titles, then the newest', () => {
    assert.deepEqual(rankBriefings([{ q: 'a', quality: 1, publishedAt: 9 }, { q: 'b', quality: 3, publishedAt: 1 }, { q: 'c', quality: 3, publishedAt: 2 }]).map((x) => x.q), ['c', 'b', 'a']);
  });
  test('a snippet is cut at word ends around the first match', () => {
    const text = 'alpha beta gamma '.repeat(30) + 'the needle is here ' + 'delta epsilon '.repeat(30);
    const s = snippetAround(text, ['needle'], 120);
    assert.ok(s.includes('needle')); assert.ok(s.length <= 124); assert.ok(s.startsWith('…') && s.endsWith('…'));
    assert.equal(snippetAround('short text', ['text']), 'short text');
  });
});

describe('paging and addresses', () => {
  test('several kinds show a preview of each; one kind pages', () => {
    assert.deepEqual(sliceFor(['topics', 'items'], 3), { per: PREVIEW, offset: 0 });
    assert.deepEqual(sliceFor(['papers'], 3), { per: PAGE_SIZE, offset: 2 * PAGE_SIZE });
  });
  test('addresses leave out the defaults and keep the words whole', () => {
    assert.equal(searchHref({ q: 'mcp security' }, false), '/search?q=mcp%20security');
    assert.equal(searchHref({ q: 'a', kinds: ['topics', 'items', 'papers', 'briefings'], window: 14, page: 1 }), '/search?q=a');
    assert.equal(searchHref({ q: 'a', kinds: ['papers'], lens: 'security', window: 30, page: 2 }), '/search?q=a&amp;kinds=papers&amp;lens=security&amp;window=30&amp;page=2');
  });
});

describe('the tool text', () => {
  const answer = () => {
    const a = emptyAnswer('mcp security', 14, ['topics', 'items', 'papers', 'briefings']);
    a.topics = { total: 7, list: [{ slug: 'mcp-auth-bypass', label: 'MCP auth bypass', term: 'mcp auth bypass', members: [], state: 'rising', signal: 0.2, quality: 4, field: 'name', lenses: ['security'] }] };
    a.items = { total: 1, list: [{ kind: 'hn', title: 'MCP servers leak tokens', url: 'https://news.example/1', discussionUrl: 'https://news.example/d', source: 'Hacker News', by: 'pg', ts: Date.parse('2026-11-06T10:00:00Z'), likes: 210, replies: 55, views: -1, quality: 2, topic: { slug: 'mcp-auth-bypass', label: 'MCP auth bypass' } }] };
    a.papers = { total: 1, list: [{ id: '2511.01234', title: 'Securing MCP', published: Date.parse('2026-11-01T00:00:00Z'), authors: ['A', 'B'], categories: ['cs.CR'], absUrl: 'https://arxiv.org/abs/2511.01234', snippet: 'We study MCP security.', quality: 3, score: 1, attention: { accounts: 2, hf: null, hn: null } }] };
    a.briefings = { total: 1, list: [{ slug: 'ai', title: 'AI', id: '2026-11-06', publishedAt: Date.parse('2026-11-06T06:00:00Z'), headline: 'MCP security day.', theme: 'Auth bypass', anchor: 'auth-bypass', quality: 3 }] };
    return a;
  };
  test('groups by kind with topics first, links to originals and topic pages, and Next hints', () => {
    const r = searchOut(answer(), O, 'Security');
    const t = r.text;
    assert.ok(t.indexOf('## Topics') < t.indexOf('## Items') && t.indexOf('## Items') < t.indexOf('## Papers') && t.indexOf('## Papers') < t.indexOf('## Briefings'));
    assert.ok(t.includes('(7 found; the best 1 are shown)'));
    assert.ok(t.includes(`](${O}/t/mcp-auth-bypass)`) && t.includes('](https://news.example/1)') && t.includes('](https://arxiv.org/abs/2511.01234)') && t.includes(`](${O}/ai/2026-11-06#auth-bypass)`));
    assert.ok(t.includes('210 points, 55 comments'));
    assert.ok(t.includes('**Next:**') && t.includes('`get_topic`') && t.includes('`get_paper`') && t.includes('`get_briefing`'));
    assert.ok(t.includes(ARXIV_THANKS));
    assert.ok(t.includes('Ordered by the lens Security; it hides nothing.'));
    assert.equal(r.data.counts.topics, 7); assert.equal(r.data.papers[0].uptake.accounts, 2); assert.equal(r.data.items[0].topic.url, `${O}/t/mcp-auth-bypass`);
  });
  test('without papers there is no thank-you line; nothing found says what to try', () => {
    const a = answer(); a.papers = { total: 0, list: [] };
    assert.ok(!searchOut(a, O).text.includes(ARXIV_THANKS));
    const none = searchOut(emptyAnswer('zzz', 7, ['topics']), O);
    assert.ok(none.text.startsWith('Nothing found for "zzz"') && none.text.includes('**Next:**') && !none.error);
    assert.equal(searchOut(emptyAnswer('', 7, ['topics']), O).error, true);
  });
});
