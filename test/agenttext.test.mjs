// The text of the public MCP server: length budget, links, units, next hints, prompts.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ARXIV_THANKS } from '../src/sources/arxiv.ts';
import { BUDGET, assemble, briefingMissing, briefingOut, bucketWindow, catchUpPrompt, digIntoPrompt, itemsOut, listLensesOut, overviewOut, paperMissing, paperOut, papersOut, reactionText, topicMissing, topicOut, windowFromSince } from '../src/site/agentText.ts';

const O = 'https://site.example';
const now = Date.parse('2026-11-07T10:00:00Z');
const T = (term, signal, o = {}) => ({ term, label: term, members: [], signal, change: null, isNew: false, kind: 'shared', breadth: 2, active: 2, parts: [0.6, 0.4], ...o });
const lens = { key: 'security', area: 'ai', name: 'Security', description: 'Attacks and defences.', color: 'orange', terms: ['security', 'bypass'] };
const overview = (o = {}) => ({
  window: 1, lens: undefined, lenses: [lens],
  sig: { slug: 'ai', title: 'AI', baselineOk: true, groups: [{ name: 'Hacker News' }, { name: 'X' }], top: [T('mcp auth bypass', 0.2, { label: 'MCP auth bypass', isNew: true }), T('claude code', 0.1, { change: 2 }), T('rag', 0.05, { change: 0.5 })] },
  sig7: null, extras: { lines: { 'claude-code': 'Claude Code adds hooks. More.' }, papers: [{ id: '2511.00001', title: 'A paper', published: now - 86400_000, score: 3, talked: true }], risingResearch: [{ slug: 'agents', title: 'Agents', state: 'rising' }], reads: [{ title: 'A post', url: 'https://blog.example/p', by: '', source: 'Blog', kind: 'rss', ts: now, reactions: 0 }] },
  briefs: [{ slug: 'ai', title: 'AI', publishedAt: now - 3600_000, tldr: 'Day. More.', themes: ['An MCP auth bypass hits servers'] }], ...o });

describe('windows', () => {
  test('bucketWindow picks the next window up', () => { assert.deepEqual([0, 1, 2, 3, 4, 7, 30, NaN].map(bucketWindow), [1, 1, 3, 3, 7, 7, 7, 1]); });
  test('windowFromSince understands people', () => {
    const fri = Date.parse('2026-11-06T10:00:00Z');   // a Friday
    assert.equal(windowFromSince('yesterday', fri), 1); assert.equal(windowFromSince('3 days', fri), 3); assert.equal(windowFromSince('last week', fri), 7);
    assert.equal(windowFromSince('Wednesday', fri), 3); assert.equal(windowFromSince('the weekend', fri), 3); assert.equal(windowFromSince(undefined, fri), 1); assert.equal(windowFromSince('???', fri), 1);
  });
});

describe('assemble', () => {
  test('keeps the lead and the next line, drops late sections that do not fit', () => {
    const big = 'x'.repeat(BUDGET.brief);
    const out = assemble(['lead'], ['a short one', big, 'tail'], 'do this', 'brief');
    assert.ok(out.startsWith('lead')); assert.match(out, /a short one/); assert.ok(!out.includes(big));
    assert.match(out, /left out/); assert.match(out, /\*\*Next:\*\* do this$/); assert.ok(out.length <= BUDGET.brief + 200);
  });
});

describe('list_lenses', () => {
  test('lists lenses with links and a next hint', () => {
    const a = listLensesOut([lens], O);
    assert.match(a.text, /`security`/); assert.match(a.text, /site\.example\/\?lens=security/); assert.match(a.text, /\*\*Next:\*\*.*get_overview/);
    assert.equal(a.data.areas[0].lenses[0].key, 'security');
  });
});

describe('get_overview', () => {
  test('leads with the answer, links topic pages, says what the score is, within budget', () => {
    const a = overviewOut(overview(), O, 'brief', now);
    assert.match(a.text.split('\n')[0], /1 new topic, 1 rising/);
    assert.match(a.text, /\(https:\/\/site\.example\/t\/mcp-auth-bypass\)/);
    assert.match(a.text, /share of each group of sources' items/); assert.match(a.text, /Hacker News 60%, X 40%/);
    assert.match(a.text, /\*\*Next:\*\*.*get_topic.*mcp-auth-bypass/);
    assert.ok(a.text.length <= BUDGET.brief + 300);
    assert.equal(a.data.topics[0].slug, 'mcp-auth-bypass'); assert.equal(a.data.inBrief[0].topic, 'mcp-auth-bypass');
    assert.equal(a.data.research.mostDiscussed[0].id, '2511.00001'); assert.equal(a.data.window, 1);
  });
  test('a lens puts its topics first and says what is outside', () => {
    const a = overviewOut(overview({ lens }), O, 'brief', now);
    assert.match(a.text, /Security first/); assert.equal(a.data.lens.key, 'security');
    assert.equal(a.data.topics[0].inLens, true);
  });
  test('no Signal: a plain answer, not a failure', () => {
    const a = overviewOut(overview({ sig: null }), O, 'brief', now);
    assert.match(a.text, /No Signal is published/); assert.ok(!a.error);
  });
  test('full is longer than brief but within its own budget', () => {
    const many = Array.from({ length: 30 }, (_, i) => T('topic ' + i, 0.3 - i * 0.005, { change: 2 }));
    const d = overview({ sig: { ...overview().sig, top: many } });
    const b = overviewOut(d, O, 'brief', now), f = overviewOut(d, O, 'full', now);
    assert.ok(f.text.length > b.text.length); assert.ok(b.text.length <= BUDGET.brief + 300); assert.ok(f.text.length <= BUDGET.full + 300);
  });
});

const topic = (o = {}) => ({
  slug: 'mcp-auth-bypass', term: 'mcp auth bypass', label: 'MCP auth bypass', members: [], board: { slug: 'ai', title: 'AI', proof: true }, alsoIn: [], days: 7, from: '2026-10-31', to: '2026-11-07', baselineOk: true,
  state: 'rising', signal: 0.2, change: 2.4, isNew: false, kind: 'shared', breadth: 3, active: 3, reactions: 100,
  series: { days: Array.from({ length: 14 }, (_, i) => `d${i}`), counts: [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7], usual: 1 }, counts: { x: 2, hn: 1 }, total: 3,
  evidence: [{ kind: 'x', label: 'X', count: 2, lines: ['2 posts from 2 accounts', 'about 2k likes'] }, { kind: 'hn', label: 'Hacker News', count: 1, lines: ['1 thread', '120 points, 40 comments'] }, { kind: 'arxiv', label: 'Research papers', count: 1, lines: ['1 paper on the subject in the last 30 days', '1 named in posts or on Hacker News'] }],
  summary: { text: 'A flaw lets attackers skip authentication.', day: '2026-11-07', model: 'm', itemCount: 3, items: [] }, fallback: 'fallback',
  talk: [{ kind: 'x', title: 'Thread on the bypass', url: 'https://x.com/a/status/1', discussionUrl: 'https://x.com/a/status/1', source: 'X', by: 'alice', ts: now - 3600_000, likes: 2100, replies: 30 }, { kind: 'hn', title: 'MCP bypass', url: 'https://example.com/post', discussionUrl: 'https://news.ycombinator.com/item?id=1', source: 'news.ycombinator.com', by: 'bob', ts: now, likes: 120, replies: 40 }],
  papers: { matched: 1, mentioned: 1, list: [{ id: '2511.00001', published: now - 86400_000, title: 'Auth in MCP', authors: ['A'], categories: ['cs.CR'], abstract: 'About auth.', absUrl: 'https://arxiv.org/abs/2511.00001', pdfUrl: 'x', also: [], attention: { top: false, mentions: [], accounts: 2 } }] },
  first: { onset: now - 5 * 3600_000, openEnded: false, thin: false, since: now - 14 * 86400_000, mentions: 3, dateOnly: 0, arrivals: [{ kind: 'hn', ts: now - 5 * 3600_000, lag: 0, n: 1, item: { title: 'MCP bypass', url: 'https://example.com/post', by: 'bob', source: 'news.ycombinator.com' } }, { kind: 'x', ts: now - 3 * 3600_000, lag: 2 * 3600_000, n: 2 }] },
  timeline: [], watch: [{ video: 'dQw4w9WgXcQ', title: 'MCP auth explained', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', source: 'Chan', by: '', ts: now - 86400_000, views: 1200, via: 'Signal' }],
  related: [{ slug: 'oauth', label: 'OAuth' }], briefings: [{ slug: 'ai', title: 'AI', id: '2026-11-07', publishedAt: now, tldr: 'Day. More.', theme: 'MCP bypass', anchor: 'mcp-bypass' }], ...o });

describe('get_topic', () => {
  test('summary first, evidence per kind in its own unit, links to originals and the topic page, thanks with papers', () => {
    const a = topicOut(topic(), O, 'brief', 7);
    assert.match(a.text, /^\*\*MCP auth bypass\*\* is rising/); assert.match(a.text, /A flaw lets attackers/);
    assert.match(a.text, /never added together/); assert.match(a.text, /about 2k likes/); assert.match(a.text, /120 points, 40 comments/);
    assert.match(a.text, /https:\/\/x\.com\/a\/status\/1/); assert.match(a.text, /https:\/\/site\.example\/t\/mcp-auth-bypass/);
    assert.match(a.text, /https:\/\/arxiv\.org\/abs\/2511\.00001/); assert.ok(a.text.includes(ARXIV_THANKS));
    assert.match(a.text, /https:\/\/site\.example\/ai\/2026-11-07#mcp-bypass/);
    assert.match(a.text, /\*\*Next:\*\*.*get_topic_items.*mcp-auth-bypass/); assert.ok(a.text.length <= BUDGET.brief + 300);
    assert.equal(a.data.slug, 'mcp-auth-bypass'); assert.equal(a.data.window.mentions, 28); assert.equal(a.data.evidence.length, 3);
    assert.equal(a.data.papers.thanks, ARXIV_THANKS);   // the hub view shows it with the papers
    assert.match(a.text, /Who had it first[\s\S]*First seen on Hacker News[\s\S]*then X from/); assert.match(a.text, /MCP auth explained/);   // step 7: the order, and a video
    assert.equal(a.data.first.order.length, 2); assert.equal(a.data.watch[0].thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  });
  test('suggested questions: at most three strings; lens is null or the key given', () => {
    const a = topicOut(topic(), O), b = topicOut(topic(), O, 'brief', 7, undefined, 'security');
    assert.ok(Array.isArray(a.data.questions) && a.data.questions.length <= 3 && a.data.questions.every((q) => typeof q === 'string'));
    assert.equal(a.data.lens, null); assert.equal(b.data.lens, 'security');
  });
  test('without a written summary it says so and uses the numbers', () => {
    const a = topicOut(topic({ summary: null }), O);
    assert.match(a.text, /fallback/); assert.match(a.text, /No written summary yet/);
  });
  test('a Signal without sources has no items to show and says so', () => {
    const a = topicOut(topic({ board: { slug: 'ai', title: 'AI', proof: false }, talk: [] }), O);
    assert.match(a.text, /does not show its sources/); assert.ok(!/get_topic_items/.test(a.text.split('**Next:**')[1]));
  });
  const pv = (id, name, kind, typical) => ({ id, name, by: 'model', n: 12, kind, began: Date.UTC(2026, 10, 3), last: now, typical, dots: [{ id: 'aaaaaaaaaaa', ts: now }] });
  const prism = (typical) => ({ day: '2026-11-07', groups: [pv('c1', 'the exploit', 'x', typical ? [{ id: 'aaaaaaaaaaa', kind: 'x', title: 'Exploit write-up', url: 'https://e.example/w', by: 'alice', source: 'X', ts: now }] : []), pv('c2', 'vendor responses', 'mixed', [])], other: 3, from: now - 7 * 86400_000, to: now });
  test('conversations inside it: data, layout, section and the next hint', () => {
    const a = topicOut(topic({ prism: prism(true) }), O);
    assert.deepEqual(a.data.prism.groups.map((g) => g.id), ['c1', 'c2']); assert.equal(a.data.prism.layout.petals.filter((p) => p.id !== 'other').length, 2);
    assert.match(a.text, /## Conversations inside it[\s\S]*the exploit[\s\S]*vendor responses[\s\S]*## Papers/); assert.match(a.text, /mostly X, from 3 Nov\. Most typical: \[Exploit write-up\]/); assert.match(a.text, /several kinds of source/);
    assert.match(a.text, /3 more items are in none of these/); assert.match(a.text.split('**Next:**')[1], /conversation: "c1"/);
  });
  test('conversations of a Signal without sources: no typical items', () => {
    const a = topicOut(topic({ prism: prism(false) }), O), sec = a.text.split('## Conversations inside it')[1].split('## ')[0];
    assert.ok(!/Most typical/.test(sec)); assert.ok(!/Exploit write-up/.test(sec)); assert.match(sec, /the exploit/);
  });
  test('without a prism: no section, data.prism null, the same text', () => {
    const a = topicOut(topic(), O), b = topicOut(topic({ prism: null }), O);
    assert.equal(a.data.prism, null); assert.ok(!/Conversations inside it/.test(a.text) && !/conversation:/.test(a.text)); assert.equal(a.text, b.text);
  });
  test('missing topic is an error answer that points to get_overview', () => {
    const a = topicMissing('nope', O); assert.ok(a.error); assert.match(a.text, /get_overview/);
  });
});

describe('get_topic_items', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ kind: i % 2 ? 'hn' : 'x', by: 'u' + i, source: 'S', title: 'Item ' + i, url: 'https://e.example/' + i, discussionUrl: '', ts: now - i * 1000, likes: 100 + i, replies: 5, views: -1 }));
  test('a page with units per kind, a cursor and a next hint', () => {
    const a = itemsOut({ found: true, slug: 'mcp-auth-bypass', label: 'MCP', proof: true, total: 60, counts: { x: 30, hn: 30 }, items }, { topic: 'mcp-auth-bypass', sort: 'new', offset: 0 }, O);
    assert.equal(a.data.nextCursor, '25'); assert.equal(a.data.items.length, 25);
    assert.match(a.data.items[0].reactionsText, /likes/); assert.match(a.data.items[1].reactionsText, /points/);   // the hub shows the unit as given
    assert.match(a.text, /Showing 1 to 25/); assert.match(a.text, /points, 5 comments/); assert.match(a.text, /about 100 likes/);
    assert.match(a.text, /cursor: "25"/); assert.match(a.text, /https:\/\/e\.example\/3/);
  });
  test('the last page has no cursor', () => {
    const a = itemsOut({ found: true, slug: 's', label: 'L', proof: true, total: 30, counts: {}, items: items.slice(0, 5) }, { topic: 's', sort: 'top', offset: 25 }, O);
    assert.equal(a.data.nextCursor, null); assert.match(a.text, /Showing 26 to 30/);
  });
  test('sources not shown, and not found', () => {
    assert.match(itemsOut({ found: true, slug: 's', label: 'L', proof: false }, { topic: 's', sort: 'new', offset: 0 }, O).text, /not public/);
    assert.ok(itemsOut({ found: false }, { topic: 'zz', sort: 'new', offset: 0 }, O).error);
  });
  test('a conversation is named in the lead and carried by the next page; one that was ignored is said', () => {
    const a = itemsOut({ found: true, slug: 's', label: 'L', proof: true, total: 60, counts: {}, conv: { id: 'c2', name: 'vendor responses' }, items }, { topic: 's', sort: 'newest', conversation: 'c2', offset: 0 }, O);
    assert.match(a.text, /in the conversation vendor responses/); assert.match(a.text, /conversation: "c2"/); assert.deepEqual(a.data.conversation, { id: 'c2', name: 'vendor responses' });
    const b = itemsOut({ found: true, slug: 's', label: 'L', proof: true, total: 5, counts: {}, conv: null, items: items.slice(0, 5) }, { topic: 's', sort: 'newest', conversation: 'c9', offset: 0 }, O);
    assert.match(b.text, /`c9` is not a conversation of this topic today, so it was ignored/); assert.equal(b.data.conversation, null);
  });
  test('reactionText uses the unit of each source', () => {
    assert.equal(reactionText({ kind: 'rss', likes: 5 }), ''); assert.equal(reactionText({ kind: 'youtube', views: 12000 }), 'about 12k views'); assert.equal(reactionText({ kind: 'hn', likes: 3, replies: 0 }), '3 points, 0 comments');
  });
});

describe('get_briefing', () => {
  const page = { topic: { slug: 'ai', title: 'AI', description: 'd' }, issue: { id: '2026-11-07', tldr: 'Short **day**. More.', publishedAt: now, markdown: '## MCP bypass\nText [a](https://x.com/a/status/1).\n'.repeat(400) }, archive: [{ id: '2026-11-07', publishedAt: now, tldr: 't', themes: ['MCP bypass'] }, { id: '2026-11-06', publishedAt: now - 86400_000, tldr: 't' }] };
  test('tl;dr first, themes link into the page, long text is cut with a way to the rest', () => {
    const a = briefingOut(page, O);
    assert.match(a.text, /Short day\./); assert.match(a.text, /site\.example\/ai\/2026-11-07#mcp-bypass/); assert.match(a.text, /Read it in full/);
    assert.ok(a.text.length <= BUDGET.brief + 300); assert.equal(a.data.truncated, true); assert.match(a.text, /day: "<id>"/);
  });
  test('unknown briefing lists the known ones', () => {
    const a = briefingMissing('zz', undefined, [{ slug: 'ai', title: 'AI', latest: { publishedAt: now } }], O);
    assert.ok(a.error); assert.match(a.text, /`ai`/);
  });
});

describe('papers', () => {
  const p = (id, o = {}) => ({ id, published: now, title: 'Paper ' + id, authors: ['A', 'B', 'C', 'D'], categories: ['cs.AI'], abstract: 'An abstract about things.', absUrl: 'https://arxiv.org/abs/' + id, attention: { accounts: 0 }, ...o });
  test('list: uptake not blended, thanks, next hint', () => {
    const a = papersOut({ total: 2, papers: [p('2511.00001', { attention: { accounts: 3, hn: { points: 80, comments: 9, url: 'u' } } }), p('2511.00002')], clusters: [{ id: 0, name: 'Agents', summary: 's', papers: 5, discussed: 1 }] }, { discussedOnly: false }, O);
    assert.match(a.text, /named in posts by 3 accounts; 80 points on Hacker News/); assert.match(a.text, /not discussed yet/); assert.ok(a.text.includes(ARXIV_THANKS));
    assert.match(a.text, /Agents/); assert.match(a.text, /get_paper.*2511\.00001/); assert.match(a.text, /A, B, C et al\./);
    assert.equal(a.data.papers.length, 2); assert.equal(a.data.papers[0].uptake.discussed, true);
  });
  test('empty answer still carries the thanks', () => {
    assert.ok(papersOut({ total: 0, papers: [] }, { query: 'x', discussedOnly: true }, O).text.includes(ARXIV_THANKS));
  });
  test('one paper: abstract, original link, every mention, no PDF link', () => {
    const a = paperOut(p('2511.00001', { attention: { accounts: 2, mentions: [{ by: 'alice', url: 'https://x.com/alice/status/9', reactions: 2400 }, { by: 'bob', url: 'https://x.com/bob/status/8', reactions: 3 }], hf: { upvotes: 12, url: 'https://huggingface.co/papers/2511.00001' } } }), O);
    assert.match(a.text, /> An abstract about things\./); assert.match(a.text, /x\.com\/alice\/status\/9/); assert.match(a.text, /about 2\.5k reactions/); assert.match(a.text, /huggingface/);
    assert.ok(a.text.includes(ARXIV_THANKS)); assert.ok(!/\/pdf\//.test(a.text)); assert.equal(a.data.mentions.length, 2);
  });
  test('missing paper', () => assert.ok(paperMissing('1').error));
});

describe('prompts', () => {
  test('catch_up names the tools in order and the window', () => {
    const t = catchUpPrompt({ lens: 'security', since: 'Friday' }, Date.parse('2026-11-07T10:00:00Z'));
    assert.ok(t.indexOf('get_overview') < t.indexOf('get_topic') && t.indexOf('get_topic') < t.indexOf('get_briefing') && t.indexOf('get_briefing') < t.indexOf('get_paper'));
    assert.match(t, /lens: "security"/); assert.match(t, /window: 1/);
  });
  test('dig_into walks summary to sources', () => {
    const t = digIntoPrompt({ topic: 'mcp-auth-bypass' });
    assert.ok(t.indexOf('get_topic`') < t.indexOf('get_topic_items') && t.indexOf('get_topic_items') < t.indexOf('get_papers')); assert.match(t, /mcp-auth-bypass/);
  });
});
