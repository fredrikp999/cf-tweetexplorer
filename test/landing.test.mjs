// The landing page's pure parts: In brief, the rising strip, the ranked landscape, research and reads, and the last-visit script.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';
import { VISIT_JS, cardLine, firstLine, inBrief, mixText, pickReads, rankList, researchStrip, risingStrip, sinceCounts, windowOf } from '../src/site/landing.ts';

const T = (term, signal, o = {}) => ({ term, label: term, members: [], signal, change: null, isNew: false, kind: 'shared', breadth: 2, active: 2, parts: [0.5, 0.5], ...o });
const now = Date.parse('2026-11-07T10:00:00Z');
const b = (slug, themes, o = {}) => ({ slug, title: slug.toUpperCase(), publishedAt: now - 3600_000, tldr: 'A day. More.', themes, ...o });

describe('windowOf', () => {
  test('only 1, 3 and 7; anything else is today', () => {
    assert.equal(windowOf('7'), 7); assert.equal(windowOf('3'), 3);
    for (const v of [null, '', '2', '14', 'x']) assert.equal(windowOf(v), 1);
  });
});

describe('inBrief', () => {
  const topics = [T('mcp auth bypass', 5, { label: 'MCP auth bypass' }), T('claude code', 3), T('rag', 1)];
  test('lines link to topic pages, matched by name', () => {
    const out = inBrief([b('ai', ['An MCP auth bypass hits servers', 'Claude Code adds hooks'])], topics, 5, now);
    assert.deepEqual(out.map((l) => l.href), ['/t/mcp-auth-bypass', '/t/claude-code']);
    assert.ok(out.every((l) => l.topic));
  });
  test('a line without a topic links to its briefing and comes after those with one', () => {
    const out = inBrief([b('ai', ['Weather is nice', 'Claude Code adds hooks'])], topics, 5, now);
    assert.equal(out[0].href, '/t/claude-code');
    assert.equal(out[1].topic, false);
    assert.match(out[1].href, /^\/ai#/);
  });
  test('one line per topic, first themes of every briefing first, capped', () => {
    const out = inBrief([b('a', ['Claude Code one', 'RAG news']), b('b', ['Claude Code two', 'MCP auth bypass again'])], topics, 3, now);
    assert.equal(out.length, 3);
    assert.equal(new Set(out.map((l) => l.href)).size, 3);
  });
  test('a briefing without themes uses its TL;DR; old briefings are used when none is fresh', () => {
    const out = inBrief([b('a', [], { tldr: 'Claude Code ships a thing. Other.', publishedAt: now - 5 * 86400_000 })], topics, 5, now);
    assert.equal(out.length, 1); assert.equal(out[0].href, '/t/claude-code');
  });
  test('nothing in, nothing out', () => assert.deepEqual(inBrief([], topics, 5, now), []));
});

describe('risingStrip', () => {
  const ts = [T('a', 5, { isNew: true }), T('b', 4, { change: 2.5 }), T('c', 3, { change: 0.5 }), T('d', 2, { change: 0.4 }), T('e', 2, { change: 0.3 }), T('p', 9, { isNew: true, parent: 'a' }), T('s', 8, { change: 1.0 })];
  test('new, then rising, then at most two falling; parts and steady left out', () => {
    const r = risingStrip(ts, true);
    assert.deepEqual(r.map((x) => x.state), ['new', 'rising', 'falling', 'falling']);
    assert.deepEqual(r.map((x) => x.term), ['a', 'b', 'c', 'd']);
  });
  test('without a baseline nothing is called rising or falling', () => assert.deepEqual(risingStrip(ts, false).map((x) => x.state), ['new']));
  test('the cap holds', () => assert.equal(risingStrip(ts, true, 3).length, 3));
});

describe('rankList', () => {
  const ts = [T('x', 1), T('security flaw', 9), T('y', 5), T('y part', 4, { parent: 'y' })];
  test('ranked by score with parts under their topic', () => {
    const { rows } = rankList(ts, undefined);
    assert.deepEqual(rows.map((r) => r.topic.term), ['security flaw', 'y', 'y part', 'x']);
    assert.deepEqual(rows.map((r) => r.part), [false, false, true, false]);
    assert.ok(rows.every((r) => !r.inLens));
  });
  test('a lens puts its topics first and keeps the others; big ones outside are named', () => {
    const lens = { key: 's', area: 'ai', name: 'S', description: '', color: 'orange', terms: ['x'] };
    const { rows, outside, inCount } = rankList(ts, lens);
    assert.equal(rows[0].topic.term, 'x'); assert.equal(rows.length, 4); assert.equal(inCount, 1);
    assert.deepEqual(outside.map((t) => t.term), ['security flaw']);
  });
});

describe('text helpers', () => {
  test('firstLine takes a sentence and cuts at a word', () => {
    assert.equal(firstLine('One thing. Two things.'), 'One thing.');
    assert.ok(firstLine('word '.repeat(60), 40).endsWith('…'));
    assert.equal(firstLine('[a link](http://x.y) and **bold**'), 'a link and bold');
  });
  test('mixText lists the larger shares', () => {
    assert.equal(mixText([0.6, 0.38, 0.02], ['HN', 'X', 'Y']), 'HN 60%, X 38%');
    assert.equal(mixText([1], ['HN']), '');
  });
  test('cardLine prefers the summary', () => {
    assert.equal(cardLine(T('a', 1), 'Summary here. More.', []), 'Summary here.');
    assert.match(cardLine(T('a', 1, { isNew: true, parts: [0.8, 0.2] }), undefined, ['HN', 'X']), /a is new, most in HN\./);
  });
});

describe('counts, research and reads', () => {
  const lens = { key: 's', area: 'ai', name: 'S', description: '', color: 'orange', terms: ['security'] };
  test('sinceCounts counts new and rising topics, in the lens when there is one', () => {
    const ts = [T('security x', 1, { isNew: true }), T('other', 1, { isNew: true }), T('security y', 1, { change: 2 })];
    assert.deepEqual(sinceCounts(ts, undefined, 4), { newTopics: 2, rising: 1, papers: 4 });
    assert.deepEqual(sinceCounts(ts, lens, 1), { newTopics: 1, rising: 1, papers: 1 });
  });
  test('researchStrip counts the window and picks the three most discussed', () => {
    const p = (id, title, days, score, talked) => ({ id, title, published: now - days * 86400_000, score, talked });
    const ps = [p('1', 'Security of agents', 1, 5, true), p('2', 'Other', 2, 9, true), p('3', 'Old', 6, 1, true), p('4', 'Quiet', 0, 0, false), p('5', 'Another', 3, 3, true)];
    const r = researchStrip(ps, undefined, 3, now);
    assert.equal(r.newPapers, 4);
    assert.deepEqual(r.top.map((x) => x.id), ['2', '1', '5']);
    assert.equal(r.discussed, 4);
    assert.deepEqual(researchStrip(ps, lens, 7, now).top.map((x) => x.id), ['1']);
  });
  test('pickReads: most reacted articles, or newest when nobody reacted', () => {
    const i = (kind, title, ts, reactions) => ({ kind, title, ts, reactions, url: 'https://x', by: '', source: 's' });
    const r = pickReads([i('rss', 'a', 1, 0), i('rss', 'b', 2, 5), i('hn', 'c', 1, 50), i('hn', 'd', 1, 90)]);
    assert.equal(r.articles[0].title, 'b'); assert.equal(r.reacted, true); assert.equal(r.hn[0].title, 'd');
    const q = pickReads([i('rss', 'a', 1, 0), i('rss', 'b', 2, 0)]);
    assert.equal(q.reacted, false); assert.equal(q.articles[0].title, 'b');
  });
});

describe('visit.js', () => {
  // A minimal browser: one element, storage, and a clock.
  function run({ prev, win, nowMs }) {
    const store = { visit: prev === undefined ? undefined : String(prev) }, sess = {};
    const link = { getAttribute: () => '/?window=3' };
    const lbl = { textContent: 'Today:' }; const added = [];
    const el = { getAttribute: () => String(win), querySelector: () => lbl, appendChild: (x) => added.push(x) };
    const doc = { getElementById: () => el, querySelector: () => link, createElement: () => ({ setAttribute() {}, appendChild() {}, set className(v) {} }), createTextNode: () => ({}) };
    const D = class extends Date { constructor(...a) { super(...(a.length ? a : [nowMs])); } static now() { return nowMs; } };
    vm.runInNewContext(VISIT_JS, { document: doc, Date: D, Number, Math, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, sessionStorage: { getItem: (k) => sess[k] ?? null, setItem: (k, v) => { sess[k] = v; } } });
    return { label: lbl.textContent, added: added.length, store };
  }
  const t = Date.parse('2026-11-07T10:00:00Z');
  test('first visit changes nothing and remembers the time', () => {
    const r = run({ prev: undefined, win: 1, nowMs: t });
    assert.equal(r.label, 'Today:'); assert.equal(r.store.visit, String(t));
  });
  test('yesterday on the one-day window relabels; a bigger gap on that window points to a wider one', () => {
    assert.equal(run({ prev: t - 86400_000, win: 1, nowMs: t }).label, 'Since yesterday:');
    const far = run({ prev: t - 3 * 86400_000, win: 1, nowMs: t });
    assert.equal(far.label, 'Today:'); assert.equal(far.added, 1);
  });
  test('a visit hours ago changes nothing', () => assert.equal(run({ prev: t - 3600_000, win: 1, nowMs: t }).label, 'Today:'));
});

describe('landscapeOf', async () => {
  const { landscapeOf } = await import('../src/site/landing.ts');
  const topic = (term, o = {}) => ({ term, label: term, members: [], signal: 0.1, change: null, isNew: false, kind: 'shared', breadth: 2, active: 5, parts: [1, 1], ...o });
  const layout = { w: 1000, h: 640, bubbles: [{ key: 'mcp-auth', x: 100, y: 100, r: 40, cluster: 'c1' }, { key: 'oauth', x: 160, y: 120, r: 20, cluster: 'c1' }, { key: 'kimi', x: 500, y: 300, r: 30, cluster: '' }, { key: 'gone', x: 800, y: 300, r: 30, cluster: '' }],
    clusters: [{ id: 'c1', name: 'MCP auth', x: 120, y: 110, r: 70, lead: 'mcp-auth', members: ['mcp-auth', 'oauth'] }] };
  const lenses = [{ key: 'security', area: 'ai', name: 'Security', description: '', color: 'orange', terms: ['auth', 'oauth'] }, { key: 'models', area: 'ai', name: 'Models', description: '', color: 'blue', terms: ['kimi'] }];
  const topics = [topic('mcp auth', { isNew: true }), topic('oauth', { signal: 0.05 }), topic('kimi', { signal: 0.08 })];
  const base = { lenses, groups: ['X', 'HN'], baselineOk: true, origin: 'https://x.example', stateOf: (t) => (t.isNew ? 'new' : null) };
  test('joins the layout with the topics: a topic the layout lacks is not drawn, one the layout holds but Signal lost is dropped', () => {
    const l = landscapeOf(layout, topics, base);
    assert.deepEqual(l.bubbles.map((b) => b.slug), ['mcp-auth', 'oauth', 'kimi']);
    assert.equal(l.bubbles[0].state, 'new'); assert.equal(l.bubbles[0].url, 'https://x.example/t/mcp-auth'); assert.equal(l.clusters.length, 1);
    assert.equal(landscapeOf(null, topics, base), null);
  });
  test('without a lens a topic has the colour of its first lens, else none; the legend lists the lenses with both shades', () => {
    const l = landscapeOf(layout, topics, base);
    assert.deepEqual(l.bubbles.map((b) => b.lensColor), ['orange', 'orange', 'blue']); assert.equal(l.bubbles[0].inLens, null);
    assert.equal(l.lenses[0].light.startsWith('#'), true); assert.equal(l.lens, null);
  });
  test('with a lens its topics take its colour and the rest are grey and marked outside', () => {
    const l = landscapeOf(layout, topics, { ...base, lens: lenses[0] });
    assert.deepEqual(l.bubbles.map((b) => [b.lensColor, b.inLens]), [['orange', true], ['orange', true], [null, false]]);
  });
  test('a cluster left with one visible member is dropped and its bubble stands alone', () => {
    const l = landscapeOf(layout, [topics[0], topics[2]], base);
    assert.equal(l.clusters.length, 0); assert.equal(l.bubbles[0].cluster, '');
  });
});
