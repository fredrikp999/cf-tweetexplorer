// Areas (INTENT.md journey H): AI and Politics kept apart. Which board or briefing belongs where, which one a page takes its numbers from, and the addresses.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AREA_BRIEFINGS, areaOfRequest, AREA_HOME, areaHint, areaOf, areaPath, boardsOfArea, parseArea, pickBoard, publishedAreas, rankByArea, topicHref, topicsOfArea } from '../src/signal/area.ts';
import { inBrief, landscapeOf } from '../src/site/landing.ts';
import { listLensesOut, overviewOut, searchOut, topicOut, catchUpPrompt } from '../src/site/agentText.ts';
import { emptyAnswer } from '../src/site/search.ts';
import { seedLenses } from '../src/signal/lens.ts';

const boards = [{ slug: 'pol', area: 'politics' }, { slug: 'ai-main' }, { slug: 'ai-two', area: 'ai' }, { slug: 'pol-two', area: 'politics' }];
const O = 'https://site.example';

describe('area values', () => {
  test('anything that is not politics is AI; a hint is only a hint', () => {
    assert.equal(parseArea('politics'), 'politics'); assert.equal(parseArea('ai'), 'ai');
    for (const v of [undefined, null, '', 'Politics', 'sports', 7]) assert.equal(parseArea(v), 'ai');
    assert.equal(areaHint('politics'), 'politics'); assert.equal(areaHint('ai'), 'ai'); assert.equal(areaHint('x'), null); assert.equal(areaHint(undefined), null);
    assert.equal(areaOf({}), 'ai'); assert.equal(areaOf(null), 'ai'); assert.equal(areaOf({ area: 'politics' }), 'politics');
  });
  test('addresses', () => {
    assert.equal(AREA_HOME.ai, '/'); assert.equal(AREA_HOME.politics, '/politics'); assert.equal(AREA_BRIEFINGS.politics, '/politics/briefings');
    assert.equal(areaPath('ai', 'briefings'), '/briefings'); assert.equal(areaPath('politics'), '/politics'); assert.equal(areaPath('politics', '/briefings'), '/politics/briefings');
    assert.equal(topicHref('mcp', 'ai'), '/t/mcp'); assert.equal(topicHref('mcp', 'ai', 'first'), '/t/mcp?angle=first');
    assert.equal(topicHref('vote', 'politics'), '/t/vote?area=politics'); assert.equal(topicHref('vote', 'politics', 'papers'), '/t/vote?area=politics&angle=papers');
  });
});

describe('picking a board', () => {
  test('the first published board of the area, never one of the other area', () => {
    assert.equal(pickBoard(boards, 'ai').slug, 'ai-main');
    assert.equal(pickBoard(boards, 'politics').slug, 'pol');
    assert.deepEqual(boardsOfArea(boards, 'politics').map((b) => b.slug), ['pol', 'pol-two']);
  });
  test('an area with no board has none (the page says so; it does not borrow the other one)', () => {
    assert.equal(pickBoard([{ slug: 'x' }], 'politics'), null);
    assert.equal(pickBoard([{ slug: 'p', area: 'politics' }], 'ai'), null);
    assert.equal(pickBoard([], 'ai'), null);
  });
  test('briefing topics are split the same way', () => {
    const ts = [{ slug: 'a' }, { slug: 'b', area: 'politics' }];
    assert.deepEqual(topicsOfArea(ts, 'ai').map((t) => t.slug), ['a']); assert.deepEqual(topicsOfArea(ts, 'politics').map((t) => t.slug), ['b']);
  });
  test('the chooser appears only when politics has a Signal or a briefing', () => {
    assert.deepEqual(publishedAreas([], []), ['ai']);
    assert.deepEqual(publishedAreas([{}], [{}]), ['ai']);
    assert.deepEqual(publishedAreas([{ area: 'politics' }], []), ['ai', 'politics']);
    assert.deepEqual(publishedAreas([], [{ area: 'politics' }]), ['ai', 'politics']);
  });
});

describe('the same name in both areas', () => {
  test('the area asked for wins, else AI, then the strongest', () => {
    const found = [{ area: 'politics', signal: 0.5 }, { area: 'ai', signal: 0.1 }, { area: 'ai', signal: 0.3 }];
    assert.deepEqual(rankByArea(found, null), [2, 1, 0]);
    assert.deepEqual(rankByArea(found, 'ai'), [2, 1, 0]);
    assert.deepEqual(rankByArea(found, 'politics'), [0, 2, 1]);
  });
  test('a name only in politics is found without a hint', () => {
    assert.deepEqual(rankByArea([{ area: 'politics', signal: 0.2 }], null), [0]);
    assert.deepEqual(rankByArea([], 'politics'), []);
  });
});

describe('links carry the area', () => {
  const topics = [{ term: 'budget vote', label: 'Budget vote', members: [], signal: 0.3, change: null, isNew: false, kind: 'shared', breadth: 2, active: 2, parts: [1] }];
  test('In brief links a politics line to its politics topic page', () => {
    const briefs = [{ slug: 'pol-day', title: 'Politics day', publishedAt: Date.now() - 3600_000, tldr: 'x. y.', themes: ['The budget vote passes'] }];
    assert.equal(inBrief(briefs, topics, 5, Date.now(), 'politics')[0].href, '/t/budget-vote?area=politics');
    assert.equal(inBrief(briefs, topics)[0].href, '/t/budget-vote');
  });
  test('the landscape bubbles link the same way', () => {
    const layout = { w: 100, h: 100, bubbles: [{ key: 'budget-vote', x: 1, y: 2, r: 3, cluster: '' }], clusters: [] };
    const o = { lenses: [], groups: [], baselineOk: true, origin: O, stateOf: () => null };
    assert.equal(landscapeOf(layout, topics, { ...o, area: 'politics' }).bubbles[0].url, O + '/t/budget-vote?area=politics');
    assert.equal(landscapeOf(layout, topics, o).bubbles[0].url, O + '/t/budget-vote');
  });
});

describe('the text answers', () => {
  const lens = seedLenses('politics')[0], ailens = seedLenses('ai')[0];
  test('list_lenses lists both areas, and says when one has nothing published', () => {
    const a = listLensesOut({ ai: [ailens], politics: [lens] }, O, ['ai']);
    assert.deepEqual(a.data.areas.map((x) => x.area), ['ai', 'politics']);
    assert.equal(a.data.areas[1].published, false); assert.match(a.text, /nothing is published in this area yet/);
    assert.match(a.text, /`politics` `elections`/); assert.match(a.text, /site\.example\/politics\?lens=elections/);
    assert.equal(listLensesOut([ailens], O).data.areas[0].lenses.length, 1);
  });
  const sig = { slug: 'pol', title: 'Politics', baselineOk: true, groups: [{ name: 'News' }], top: [{ term: 'budget vote', label: 'Budget vote', members: [], signal: 0.3, change: null, isNew: true, kind: 'shared', breadth: 1, active: 1, parts: [1] }] };
  test('a politics overview names the area, links politics topic pages and has no research', () => {
    const a = overviewOut({ area: 'politics', window: 1, lenses: [lens], sig, sig7: null, extras: { lines: {}, papers: [{ id: '2511.00001', title: 'P', published: Date.now(), score: 1, talked: true }], risingResearch: [], reads: [] }, briefs: [] }, O, 'brief');
    assert.equal(a.data.area, 'politics'); assert.equal(a.data.research, null); assert.equal(a.data.read, null);
    assert.match(a.text, /Politics, today/); assert.doesNotMatch(a.text, /paper/i); assert.doesNotMatch(a.text, /Research map/);
    assert.match(a.text, /site\.example\/t\/budget-vote\?area=politics/); assert.match(a.text, /area: "politics"/);
    assert.equal(a.data.url, O + '/politics');
  });
  test('an empty politics area says so', () => {
    const a = overviewOut({ area: 'politics', window: 1, lenses: [], sig: null, sig7: null, extras: null, briefs: [] }, O, 'brief');
    assert.match(a.text, /No Politics Signal is published yet/);
  });
  test('AI stays AI when no area is given', () => {
    const a = overviewOut({ window: 1, lenses: [], sig, sig7: null, extras: null, briefs: [] }, O, 'brief');
    assert.equal(a.data.area, 'ai'); assert.match(a.text, /\*\*AI, today:/);
  });
  test('search links the topic with its area, and a search address keeps it', () => {
    const ans = { ...emptyAnswer('vote', 14, ['topics'], 1, 5), topics: { total: 1, list: [{ slug: 'budget-vote', label: 'Budget vote', term: 'budget vote', members: [], state: null, signal: 0.1, quality: 3, field: 'term', lenses: [] }] } };
    const a = searchOut(ans, O, undefined, 'brief', 'politics');
    assert.equal(a.data.area, 'politics'); assert.equal(a.data.topics[0].url, O + '/t/budget-vote?area=politics'); assert.match(a.data.searchUrl, /area=politics/);
    assert.equal(searchOut(ans, O).data.topics[0].url, O + '/t/budget-vote');
  });
  test('catch_up asks for the politics area when told to', () => {
    assert.match(catchUpPrompt({ area: 'politics', lens: 'elections' }), /happened in politics[\s\S]*area: "politics"` and `lens: "elections"`/);
    assert.doesNotMatch(catchUpPrompt({ area: 'politics' }), /get_paper/);
    assert.match(catchUpPrompt({ lens: 'security' }), /happened in AI[\s\S]* with `lens: "security"`/);
  });
});

describe('which area a request is in', () => {
  const bs = [{ slug: 'pol', aliases: ['old-pol'], area: 'politics' }, { slug: 'main' }], ts = [{ slug: 'daily-pol', area: 'politics' }, { slug: 'daily' }];
  const at = (path) => { const u = new URL('https://x.example' + path); return areaOfRequest(u.pathname.split('/').filter(Boolean), u.searchParams, bs, ts); };
  test('/politics and what lives in it', () => { assert.equal(at('/politics'), 'politics'); assert.equal(at('/politics/briefings'), 'politics'); });
  test('a Signal or a briefing is of the area it was published in', () => {
    assert.equal(at('/signal/pol'), 'politics'); assert.equal(at('/signal/old-pol/first'), 'politics'); assert.equal(at('/signal/main'), 'ai');
    assert.equal(at('/daily-pol'), 'politics'); assert.equal(at('/daily-pol/2026-11-07'), 'politics'); assert.equal(at('/daily'), 'ai');
  });
  test('?area= counts only on the pages shared by both areas', () => {
    assert.equal(at('/search?q=vote&area=politics'), 'politics'); assert.equal(at('/topics?area=politics'), 'politics'); assert.equal(at('/signal?area=politics'), 'politics');
    assert.equal(at('/?area=politics'), 'ai'); assert.equal(at('/briefings?area=politics'), 'ai'); assert.equal(at('/search?q=x'), 'ai'); assert.equal(at('/topics?area=nope'), 'ai');
  });
  test('a topic page starts in AI unless asked; the page then follows the topic', () => { assert.equal(at('/t/vote'), 'ai'); assert.equal(at('/t/vote?area=politics'), 'ai'); });
});
