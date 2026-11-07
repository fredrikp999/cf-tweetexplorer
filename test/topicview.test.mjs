// Step 7 of INTENT.md: who had a topic first (by kind of source), the timeline of key items, videos to watch, the paper lens mask and the uptake mark of the Research map.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { firstByKind, firstCaveat, firstSentence, lagWords, namesIn, pickWatch, stampUtc, startedWithin, timelineDots, timelineWords, videoId } from '../src/signal/topicview.ts';
import { paperLensMask, seedLenses } from '../src/signal/lens.ts';
import map from '../src/apps/map.ts';
import { topicFirstOut, boardFirstOut } from '../src/site/agentText.ts';

const H = 3_600_000, D = 24 * H;
const T0 = Date.UTC(2026, 10, 7, 0, 0);   // 7 Nov 2026, midnight UTC
const at = (day, h, m = 0) => T0 + day * D + h * H + m * 60_000;
const it = (kind, ts, o = {}) => ({ kind, ts, title: `${kind} item`, url: `https://example.com/${kind}/${ts}`, by: 'a', source: 's', likes: -1, replies: -1, views: -1, discussionUrl: '', ...o });

describe('who had it first, by kind of source', () => {
  const since = at(-14, 0);
  test('orders the kinds of a wave by their first mention and counts the items', () => {
    const f = firstByKind([it('x', at(-1, 10, 40)), it('hn', at(-1, 9, 12)), it('hn', at(-1, 11, 5)), it('rss', at(-1, 14, 0)), it('x', at(-1, 15, 3))], { since, hide: false });
    assert.deepEqual(f.arrivals.map((a) => a.kind), ['hn', 'x', 'rss']);
    assert.deepEqual(f.arrivals.map((a) => a.n), [2, 2, 1]);
    assert.equal(f.onset, at(-1, 9, 12));
    assert.equal(f.arrivals[1].lag, 88 * 60_000);
    assert.equal(f.openEnded, false);
    assert.equal(f.thin, false);
    assert.match(firstSentence(f), /^First seen on Hacker News \(6 Nov 09:12 UTC\), then X from 10:40, blogs and news from 14:00\.$/);
  });
  test('kinds that arrive within half an hour are first together', () => {
    const f = firstByKind([it('x', at(-2, 9, 0)), it('hn', at(-2, 9, 20)), it('rss', at(-2, 12, 0))], { since, hide: false });
    assert.match(firstSentence(f), /^First seen on X and Hacker News together/);
  });
  test('only the latest wave counts: an older one before a quiet stretch is left alone', () => {
    const f = firstByKind([it('rss', at(-12, 8, 15)), it('rss', at(-12, 9, 15)), it('x', at(-3, 9, 7)), it('hn', at(-3, 10, 9)), it('x', at(-3, 12, 1))], { since, hide: false });
    assert.equal(f.onset, at(-3, 9, 7));
    assert.deepEqual(f.arrivals.map((a) => a.kind), ['x', 'hn']);
  });
  test('a topic that was already going when the history starts says so', () => {
    const f = firstByKind([it('x', at(-13, 9, 7)), it('hn', at(-13, 10, 9)), it('x', at(-11, 9, 7)), it('x', at(-9, 9, 7)), it('x', at(-7, 9, 7)), it('x', at(-5, 9, 7)), it('x', at(-3, 9, 7)), it('x', at(-1, 9, 7))], { since, hide: false });
    assert.equal(f.openEnded, true);
    assert.match(firstCaveat(f), /already being talked about/);
    assert.match(firstCaveat(f), /does not say where the story began/);
  });
  test('few mentions are flagged as possibly chance; dates without a time of day are left out and counted', () => {
    const f = firstByKind([it('x', at(-1, 9, 7)), it('hn', at(-1, 10, 9)), it('rss', at(-1, 0, 0))], { since, hide: false });
    assert.equal(f.thin, true);
    assert.equal(f.dateOnly, 1);
    assert.deepEqual(f.arrivals.map((a) => a.kind), ['x', 'hn']);
    assert.match(firstCaveat(f), /only a few mentions/);
    assert.match(firstCaveat(f), /no time of day/);
  });
  test('papers are not a source kind here, and nothing at all gives an empty answer', () => {
    assert.equal(firstByKind([it('arxiv', at(-1, 9, 7))], { since, hide: false }).arrivals.length, 0);
    assert.equal(firstSentence(firstByKind([], { since, hide: false })), '');
  });
  test('a Signal without sources shown names no item', () => {
    const f = firstByKind([it('x', at(-1, 9, 7)), it('hn', at(-1, 10, 9)), it('x', at(-1, 11, 9))], { since, hide: true });
    assert.ok(f.arrivals.every((a) => a.item === undefined));
    assert.equal(JSON.stringify(f).includes('example.com'), false);
  });
  test('one kind alone, and the window test', () => {
    const f = firstByKind([it('hn', at(-1, 9, 7)), it('hn', at(-1, 10, 9)), it('hn', at(-1, 12, 9))], { since, hide: false });
    assert.match(firstSentence(f), /^Only Hacker News has had it/);
    assert.equal(startedWithin(f, 7, at(0, 0)), true);
    assert.equal(startedWithin(f, 1, at(2, 0)), false);
  });
  test('gaps and stamps in words', () => {
    assert.equal(lagWords(88 * 60_000), '1 h 28 min');
    assert.equal(lagWords(20 * 60_000), '20 min');
    assert.equal(lagWords(3 * D + 4 * H), '3 days 4 h');
    assert.equal(stampUtc(at(0, 9, 5)), '7 Nov 09:05 UTC');
  });
  test('the agent answer carries the order, the caveat and a window note', () => {
    const f = firstByKind([it('hn', at(-1, 9, 12)), it('x', at(-1, 10, 40)), it('x', at(-1, 11, 40))], { since, hide: false });
    const a = topicFirstOut({ slug: 'mcp', label: 'MCP', board: { slug: 'ai', title: 'AI', proof: true }, first: f }, 'https://site.test', 7, at(0, 0));
    assert.match(a.text, /First seen on Hacker News/);
    assert.match(a.text, /inside your 7-day window/);
    assert.match(a.text, /does not say where the story began/);
    assert.equal(a.data.order.length, 2);
    assert.equal(a.data.startedInWindow, true);
    const old = topicFirstOut({ slug: 'mcp', label: 'MCP', board: { slug: 'ai', title: 'AI', proof: true }, first: f }, 'https://site.test', 1, at(3, 0));
    assert.match(old.text, /before your 1-day window/);
  });
  test('the board answer names early groups only when clear', () => {
    const r = { days: 7, from: '', to: '', ai: true, totalWaves: 20, groups: [{ key: 'g0', name: 'Hacker News', joined: 12, first: 8, expected: 4, medianLag: 0, verdict: 'early' }, { key: 'g1', name: 'Blogs', joined: 12, first: 2, expected: 5, medianLag: 3_600_000, verdict: 'unclear' }],
      waves: [{ topic: 'mcp', onset: at(-1, 9, 12), mentions: 5, arrivals: [{ group: 'g0', ts: at(-1, 9, 12), lag: 0, n: 2 }, { group: 'g1', ts: at(-1, 11, 12), lag: 2 * H, n: 3 }], absent: [] }] };
    const a = boardFirstOut(r, { slug: 'ai', title: 'AI' }, 'https://site.test');
    assert.match(a.text, /Hacker News tends to be early/);
    assert.match(a.text, /mcp.*Hacker News first, Blogs \+2 h/);
  });
});

describe('the timeline', () => {
  const from = at(-14, 0), to = at(0, 0);
  test('a burst is one dot with a count, not many dots; kinds keep their own dots', () => {
    const burst = Array.from({ length: 30 }, (_, i) => it('x', at(-3, 10, i), { likes: i }));
    const dots = timelineDots([...burst, it('hn', at(-3, 10, 30), { likes: 50 })], { from, to, hide: false });
    assert.equal(dots.length, 2);
    const x = dots.find((d) => d.kind === 'x');
    assert.equal(x.n, 30);
    assert.equal(x.item.title, 'x item');
    assert.equal(x.item.url, `https://example.com/x/${at(-3, 10, 29)}`);   // the most reacted of the slot
    assert.ok(dots.every((d) => d.x > 0 && d.x < 1));
  });
  test('dots come out in time order and sit where their time says', () => {
    const dots = timelineDots([it('rss', at(-1, 12)), it('x', at(-10, 12)), it('hn', at(-5, 12))], { from, to, hide: false });
    assert.deepEqual(dots.map((d) => d.kind), ['x', 'hn', 'rss']);
    assert.ok(dots[0].x < dots[1].x && dots[1].x < dots[2].x);
    assert.ok(Math.abs(dots[0].x - (14 - 10 + 0.5) / 14) < 0.05);
  });
  test('outside the period, and papers, are left out; nothing gives no dots', () => {
    assert.equal(timelineDots([it('x', at(-20, 1)), it('arxiv', at(-1, 1))], { from, to, hide: false }).length, 0);
    assert.equal(timelineDots([], { from, to, hide: false }).length, 0);
  });
  test('no item is named when the Signal hides its sources', () => {
    const dots = timelineDots([it('x', at(-3, 10))], { from, to, hide: true });
    assert.equal(dots[0].item, undefined);
    assert.equal(JSON.stringify(dots).includes('example.com'), false);
  });
  test('the words under it say the same', () => {
    const w = timelineWords(timelineDots([it('hn', at(-3, 10)), it('hn', at(-3, 11)), it('x', at(-9, 10))], { from, to, hide: false }));
    assert.equal(w.length, 2);
    assert.match(w[0], /^X: 1 item around 29 Oct/);
    assert.match(w[1], /^Hacker News: 2 items around 4 Nov/);
  });
});

describe('watch', () => {
  test('finds the video in the usual links, and nothing in others', () => {
    assert.equal(videoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(videoId('https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
    assert.equal(videoId('https://youtu.be/dQw4w9WgXcQ?si=x'), 'dQw4w9WgXcQ');
    assert.equal(videoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(videoId('https://example.com/watch?v=dQw4w9WgXcQ'), '');
    assert.equal(videoId('https://www.youtube.com/channel/UC1234567890'), '');
  });
  test('names match whole words only', () => {
    assert.equal(namesIn('MCP auth bypass explained', ['mcp auth bypass', 'mcp']), true);
    assert.equal(namesIn('Gpt-5 and friends', ['gpt']), true);
    assert.equal(namesIn('Cooking with mcpserver', ['mcp']), false);
    assert.equal(namesIn('anything', ['ai']), false);   // too short to be a name
  });
  test('own videos first by views, feed matches added once, others dropped', () => {
    const own = [{ title: 'Own A', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', source: 'Chan', by: '', ts: 5, views: 100 }, { title: 'Not a video', url: 'https://example.com/x', source: 'Chan', by: '', ts: 6 }];
    const feeds = [
      { via: 'AI videos', title: 'MCP deep dive', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', source: 'Chan 2', by: '', ts: 9, reactions: 500, video: 'BBBBBBBBBBB' },
      { via: 'AI videos', title: 'MCP again', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', source: 'Chan', by: '', ts: 7, reactions: 1 },
      { via: 'AI videos', title: 'Cooking pasta', url: 'https://www.youtube.com/watch?v=CCCCCCCCCCC', source: 'Chan 3', by: '', ts: 8, reactions: 9, video: 'CCCCCCCCCCC' },
      { via: 'News', title: 'MCP on a blog', url: 'https://example.com/blog', source: 'Blog', by: '', ts: 4, reactions: 0 },
    ];
    const w = pickWatch(own, feeds, ['mcp']);
    assert.deepEqual(w.map((v) => v.video), ['BBBBBBBBBBB', 'AAAAAAAAAAA']);
    assert.equal(w[0].via, 'AI videos');
    assert.equal(w[1].via, 'Signal');
    assert.equal(pickWatch(own, feeds, ['mcp'], 1).length, 1);
  });
});

describe('lens mask and uptake mark', () => {
  const lenses = seedLenses('ai');
  test('a paper falls under the lenses whose words its title or abstract uses', () => {
    const sec = lenses.findIndex((l) => l.key === 'security'), ag = lenses.findIndex((l) => l.key === 'agentic');
    const m = paperLensMask(lenses, 'Prompt injection attacks on coding agents', 'We study ...');
    assert.ok(m & (1 << sec));
    assert.ok(m & (1 << ag));
    assert.equal(paperLensMask(lenses, 'Protein folding with diffusion', 'A study of proteins.'), 0);
    assert.ok(paperLensMask(lenses, 'A study', 'We find a new vulnerability in MCP servers.') & (1 << sec));
  });
  test('whole words only, and no lens means no mask', () => {
    assert.equal(paperLensMask([{ terms: ['rag'] }], 'Foraging in the wild', ''), 0);
    assert.equal(paperLensMask([], 'Prompt injection', ''), 0);
  });
  // The map view keeps the same rule as get_papers: named in posts, on Hacker News or upvoted on Hugging Face.
  const talkedIdx = runInNewContext('var PHF = 7, PHN = 8, PACC = 9;' + /function talked\(p\) \{[^}]*\}/.exec(map)[0] + '; talked');
  test('the map marks a paper as discussed from any of the three kinds of uptake, and not from none', () => {
    const row = (hf, hn, acc) => ['2511.00001', 't', 0, 1, 0, 0, 0, hf, hn, acc];
    assert.equal(talkedIdx(row(0, 0, 0)), false);
    assert.equal(talkedIdx(row(0, 0, 2)), true);
    assert.equal(talkedIdx(row(0, 30, 0)), true);
    assert.equal(talkedIdx(row(5, 0, 0)), true);
  });
  test('the map has a lens filter, a theme that follows the host and keeps the thank-you line', () => {
    assert.match(map, /data-theme=light/);
    assert.match(map, /host-context-changed/);
    assert.match(map, /data-lens/);
    assert.match(map, /not discussed yet/);
    assert.match(map, /d\.thanks/);
  });
});
