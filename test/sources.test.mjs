import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, checkFeedUrl } from '../src/sources/rss.ts';
import { fetchHn } from '../src/sources/hn.ts';
import { toFeedShape } from '../src/sources/types.ts';

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>Example &amp; Co</title>
<item><title><![CDATA[First <b>post</b>]]></title><link>https://example.com/1</link><guid>g1</guid><pubDate>Mon, 02 Mar 2026 10:00:00 GMT</pubDate>
<dc:creator>Ann</dc:creator><description>&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</description></item>
<item><title>No link</title><description>skipped</description></item>
<item><title>Bad scheme</title><link>javascript:alert(1)</link></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
<entry><title>Entry one</title><id>urn:1</id><link rel="alternate" href="https://blog.test/a?x=1&amp;y=2"/><link rel="edit" href="https://blog.test/edit"/>
<published>2026-03-01T08:00:00Z</published><author><name>Bo</name></author><summary>Short summary</summary></entry></feed>`;

describe('parseFeed', () => {
  test('reads RSS 2.0: entities, CDATA, author, skips items without a safe link', async () => {
    const { title, items } = await parseFeed(RSS, 'https://example.com/feed.xml');
    assert.equal(title, 'Example & Co');
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'First post');
    assert.equal(items[0].text, 'Hello & welcome');
    assert.equal(items[0].by, 'Ann');
    assert.equal(items[0].url, 'https://example.com/1');
    assert.equal(items[0].at, '2026-03-02T10:00:00.000Z');
  });
  test('reads Atom: picks the alternate link, decodes the href', async () => {
    const { items } = await parseFeed(ATOM, 'https://blog.test/atom');
    assert.equal(items[0].url, 'https://blog.test/a?x=1&y=2');
    assert.equal(items[0].by, 'Bo');
  });
  test('ids are stable and differ between feeds', async () => {
    const a = await parseFeed(RSS, 'https://one.test/f'), b = await parseFeed(RSS, 'https://two.test/f'), a2 = await parseFeed(RSS, 'https://one.test/f');
    assert.equal(a.items[0].id, a2.items[0].id);
    assert.notEqual(a.items[0].id, b.items[0].id);
    assert.match(a.items[0].id, /^rss:[0-9a-f]{16}$/);
  });
  test('checkFeedUrl refuses other schemes and credentials', () => {
    assert.throws(() => checkFeedUrl('ftp://x.test/f'));
    assert.throws(() => checkFeedUrl('https://u:p@x.test/f'));
    assert.throws(() => checkFeedUrl('nonsense'));
    assert.equal(checkFeedUrl(' https://x.test/f '), 'https://x.test/f');
  });
});

describe('fetchHn', () => {
  const real = globalThis.fetch;
  after(() => { globalThis.fetch = real; });
  test('builds the Algolia query and maps hits', async () => {
    let seen;
    globalThis.fetch = async (u) => {
      seen = new URL(String(u));
      return Response.json({ hits: [
        { objectID: '1', title: 'Show', url: 'https://a.test/x', author: 'pg', points: 120, num_comments: 30, created_at_i: 1_700_000_000 },
        { objectID: '2', title: 'Ask HN: why', url: null, author: 'sam', points: 5, num_comments: 2, created_at_i: 1_700_000_100, story_text: '<p>Body &amp; more</p>' },
        { objectID: '3', title: null, created_at_i: 1 },
      ] });
    };
    const { items } = await fetchHn({ tag: 'story', query: 'rust', minPoints: 50, since: 10 });
    assert.equal(seen.pathname, '/api/v1/search_by_date');
    assert.equal(seen.searchParams.get('tags'), 'story');
    assert.equal(seen.searchParams.get('query'), 'rust');
    assert.match(seen.searchParams.get('numericFilters'), /created_at_i>\d+,points>=50/);
    assert.equal(items.length, 2);
    assert.equal(items[0].url, 'https://a.test/x');
    assert.equal(items[0].discussionUrl, 'https://news.ycombinator.com/item?id=1');
    assert.equal(items[1].url, 'https://news.ycombinator.com/item?id=2');
    assert.equal(items[1].discussionUrl, undefined);
    assert.equal(items[1].text, 'Body & more');
  });
  test('the front page is read ranked, with no time window', async () => {
    let seen;
    globalThis.fetch = async (u) => { seen = new URL(String(u)); return Response.json({ hits: [] }); };
    await fetchHn({ tag: 'front_page', since: 10 });
    assert.equal(seen.pathname, '/api/v1/search');
    assert.equal(seen.searchParams.get('numericFilters'), null);
  });
  test('an HTTP error is reported', async () => {
    globalThis.fetch = async () => new Response('x', { status: 503 });
    await assert.rejects(fetchHn({ tag: 'story', since: 0 }), /HTTP 503/);
  });
});

test('toFeedShape keeps the tweet fields the UI and summarizer read', () => {
  const t = toFeedShape({ source: 'hn', id: 'hn:1', url: 'https://a.test', title: 'T', text: '', by: 'pg', at: '2026-01-01T00:00:00.000Z', points: 3, comments: 2 });
  assert.equal(t.text, 'T'); assert.equal(t.likeCount, 3); assert.equal(t.replyCount, 2); assert.equal(t.author.userName, 'pg'); assert.equal(t.source, 'hn');
});

const { compact } = await import('../src/summarize/tweets.ts');
const { markdown } = await import('../src/site/markdown.ts');
describe('citing RSS and Hacker News items', () => {
  const item = { id: 'hn:1', url: 'https://a.test/post', discussionUrl: 'https://news.ycombinator.com/item?id=1', source: 'hn', text: 'T', createdAt: '2026-01-01T00:00:00Z', author: { userName: 'pg', name: 'pg' } };

  test('compact gives an article url and a plain name, never a made-up x.com link', () => {
    const c = compact(item);
    assert.equal(c.url, 'https://a.test/post'); assert.equal(c.by, 'pg'); assert.equal(c.source, 'hn'); assert.equal(c.discussion, item.discussionUrl);
    const noUrl = compact({ ...item, url: undefined });
    assert.equal(noUrl.url, '');
    assert.equal(compact({ id: '5', text: 'x', author: { userName: 'ann' } }).url, 'https://x.com/ann/status/5');
  });
  test('the public page links x.com and the listed addresses only', () => {
    const md = 'See [post](https://a.test/post), [evil](https://evil.test/x), [tweet](https://x.com/ann/status/5) and [talk](https://news.ycombinator.com/item?id=1).';
    const html = markdown(md, ['https://a.test/post', 'https://news.ycombinator.com/item?id=1']);
    assert.match(html, /<a href="https:\/\/a\.test\/post"/);
    assert.match(html, /<a href="https:\/\/news\.ycombinator\.com\/item\?id=1"/);
    assert.match(html, /<a href="https:\/\/x\.com\/ann\/status\/5"/);
    assert.doesNotMatch(html, /evil\.test/);
    assert.match(html, /<\/a>, evil, <a /);   // the text stays, the link goes
  });
  test('without a list only x.com is linked, as before', () => {
    assert.doesNotMatch(markdown('[a](https://a.test/post)'), /<a /);
  });
});

describe('reading tools', async () => {
  const { checkReadableUrl, extractArticle, readArticle, readHnComments } = await import('../src/sources/read.ts');
  const { buildTools } = await import('../src/summarize/agent.ts');
  const real = globalThis.fetch;
  after(() => { globalThis.fetch = real; });

  test('refuses local, numeric, credentialed and non-web addresses', () => {
    for (const u of ['http://localhost/x', 'http://127.0.0.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'https://intranet/x', 'https://u:p@example.com/', 'ftp://example.com/', 'https://example.com:8080/', 'https://printer.local/'])
      assert.throws(() => checkReadableUrl(u), undefined, u);
    assert.equal(checkReadableUrl('https://example.com/a?b=1').hostname, 'example.com');
  });
  test('extracts the article, without scripts or navigation', () => {
    const body = 'Real content sentence. '.repeat(40);
    const html = `<html><head><title>My &amp; title</title><script>evil()</script></head><body><nav>Menu Home</nav><article><h1>Head</h1><p>${body}</p><p>Second</p></article><footer>Copyright</footer></body></html>`;
    const a = extractArticle(html, 'https://example.com/x', 100);
    assert.equal(a.title, 'My & title'); assert.ok(a.text.startsWith('Head')); assert.equal(a.truncated, true); assert.equal(a.text.length, 100);
    assert.doesNotMatch(extractArticle(html, 'https://example.com/x', 5000).text, /Menu|evil|Copyright/);
  });
  test('redirects to a local address are refused', async () => {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
    await assert.rejects(readArticle('https://example.com/x'), /local and numeric/);
  });
  test('refuses non-text content and reads plain pages', async () => {
    globalThis.fetch = async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } });
    await assert.rejects(readArticle('https://example.com/x.pdf'), /cannot read application\/pdf/);
    globalThis.fetch = async () => new Response('<title>T</title><p>Hello world</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const a = await readArticle('https://example.com/x');
    assert.equal(a.title, 'T'); assert.equal(a.text, 'Hello world');
  });
  test('HN comments: best first, two levels, text flattened', async () => {
    let asked;
    globalThis.fetch = async (u) => { asked = String(u); return Response.json({ title: 'S', points: 9, children: [
      { author: 'a', text: '<p>First &amp; best</p>', children: [{ author: 'b', text: 'reply', children: [{ author: 'c', text: 'too deep' }] }] },
      { author: 'd', text: null }, { author: 'e', text: 'second' }] }); };
    const r = await readHnComments('42', 30);
    assert.equal(asked, 'https://hn.algolia.com/api/v1/items/42');
    assert.deepEqual(r.comments.map((c) => [c.by, c.depth, c.text]), [['a', 0, 'First & best'], ['b', 1, 'reply'], ['e', 0, 'second']]);
    await assert.rejects(readHnComments('42/../x'), /not a Hacker News item id/);
  });
  test('the tools only accept addresses and ids from items the writer was given', async () => {
    globalThis.fetch = async () => new Response('<p>ok</p>', { headers: { 'content-type': 'text/html' } });
    const given = [{ id: 'hn:7', url: 'https://example.com/story', by: 'pg', at: '', text: 'T', likes: 1, retweets: 0, replies: 0, views: 0, source: 'hn', discussion: 'https://news.ycombinator.com/item?id=7' }];
    const tools = buildTools({}, given), run = (name, input) => tools.find((t) => t.name === name).invoke(input, {});
    await assert.rejects(run('read_article', { url: 'https://evil.example.org/x', maxChars: 1000 }), /not from an RSS or Hacker News item/);
    assert.match(await run('read_article', { url: 'https://example.com/story', maxChars: 1000 }), /ok/);
    await assert.rejects(run('get_hn_comments', { id: 'hn:8', limit: 5 }), /not a Hacker News story you were given/);
  });
});

describe('YouTube feeds', async () => {
  const yt = await import('../src/sources/youtube.ts');
  const real = globalThis.fetch;
  after(() => { globalThis.fetch = real; });
  const FEED = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<title>Fireship</title><entry><id>yt:video:abcDEF12345</id><yt:videoId>abcDEF12345</yt:videoId><title>Did it pop?</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcDEF12345"/>
<author><name>Fireship</name></author><published>2026-03-01T08:00:00+00:00</published>
<media:group><media:title>Did it pop?</media:title><media:description>Long description &amp; links</media:description><media:community><media:statistics views="12345"/></media:community></media:group></entry></feed>`;

  test('parses a channel feed into video items', async () => {
    const { items } = await parseFeed(FEED, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA');
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].source, items[0].id, items[0].url, items[0].by, items[0].views], ['youtube', 'yt:abcDEF12345', 'https://www.youtube.com/watch?v=abcDEF12345', 'Fireship', 12345]);
    assert.equal(items[0].text, 'Long description & links');
    assert.equal(toFeedShape(items[0]).viewCount, 12345);
  });
  test('addresses: channel, playlist, feed, and what is not YouTube', async () => {
    const UC = 'UCsBjURrPoezykLs9EqgamOA';
    assert.equal(await yt.resolveYoutubeFeed(UC), `https://www.youtube.com/feeds/videos.xml?channel_id=${UC}`);
    assert.equal(await yt.resolveYoutubeFeed(`https://www.youtube.com/channel/${UC}/videos`), `https://www.youtube.com/feeds/videos.xml?channel_id=${UC}`);
    assert.equal(await yt.resolveYoutubeFeed('https://www.youtube.com/playlist?list=PLabcdefghijk123'), 'https://www.youtube.com/feeds/videos.xml?playlist_id=PLabcdefghijk123');
    await assert.rejects(yt.resolveYoutubeFeed('https://evil.example.com/@x'), /not a YouTube/);
    await assert.rejects(yt.resolveYoutubeFeed(''), /enter a channel/);
  });
  test('an @handle is looked up on youtube.com only', async () => {
    let asked;
    globalThis.fetch = async (u) => { asked = String(u); return new Response('<link rel="canonical" href="https://www.youtube.com/channel/UCsBjURrPoezykLs9EqgamOA">'); };
    assert.match(await yt.resolveYoutubeFeed('@Fireship'), /channel_id=UCsBjURrPoezykLs9EqgamOA/);
    assert.equal(asked, 'https://www.youtube.com/@Fireship');
    globalThis.fetch = async () => new Response('<html>nothing</html>');
    await assert.rejects(yt.resolveYoutubeFeed('@nobody'), /could not find the channel/);
  });
  test('helpers', () => {
    assert.equal(yt.videoIdOf('https://youtu.be/abcDEF12345'), 'abcDEF12345');
    assert.equal(yt.videoIdOf('https://www.youtube.com/watch?v=abcDEF12345&t=3'), 'abcDEF12345');
    assert.equal(yt.videoIdOf('https://evil.test/watch?v=abcDEF12345'), '');
    assert.equal(yt.pageOfFeed('https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA'), 'https://www.youtube.com/channel/UCsBjURrPoezykLs9EqgamOA');
    assert.equal(yt.pageOfFeed('https://example.com/feed.xml'), null);
    assert.ok(yt.isYoutubeFeed('https://www.youtube.com/feeds/videos.xml?playlist_id=PLabcdefghijk123'));
  });
});

describe('transcripts', async () => {
  const tr = await import('../src/sources/transcript.ts');
  const real = globalThis.fetch;
  after(() => { globalThis.fetch = real; });
  const PLAYER = { captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=sv', languageCode: 'sv' },
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr&fmt=srv3', languageCode: 'en', kind: 'asr' },
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en' }] } } };
  const XML = '<transcript><text start="0.5" dur="2">Hello &amp;amp; welcome</text><text start="40" dur="2">It&amp;#39;s me</text></transcript>';
  // Routes the calls a provider makes to canned answers; records what was asked.
  const route = (table) => { const calls = []; globalThis.fetch = async (u, init) => { const url = String(u); calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined, headers: init?.headers });
    const hit = table.find(([re]) => re.test(url)); if (!hit) throw new Error('unexpected fetch ' + url); const r = hit[1](url, init); return r instanceof Response ? r : Response.json(r); }; return calls; };

  test('settings: captions by default, bad values fall back, fallback must differ', () => {
    assert.equal(tr.transcriptConfig({}).provider, 'captions');
    assert.equal(tr.transcriptConfig({ TRANSCRIPT_PROVIDER: 'nonsense' }).provider, 'captions');
    assert.equal(tr.transcriptConfig({ TRANSCRIPT_PROVIDER: 'openrouter' }).provider, 'openrouter');
    assert.equal(tr.transcriptConfig({ TRANSCRIPT_FALLBACK: 'replicate' }).fallback, 'replicate');
    assert.equal(tr.transcriptConfig({ TRANSCRIPT_PROVIDER: 'replicate', TRANSCRIPT_FALLBACK: 'replicate' }).fallback, undefined);
    assert.equal(tr.transcriptConfig({}).openrouterModel, tr.DEFAULT_TRANSCRIPT_MODEL);
    assert.equal(tr.transcriptConfig({ TRANSCRIPT_MODEL: 'bad model' }).openrouterModel, tr.DEFAULT_TRANSCRIPT_MODEL);
  });
  test('caption xml in both formats, entities decoded, grouped by 30 seconds', () => {
    const segs = tr.parseCaptionXml(XML);
    assert.deepEqual(segs.map((s) => s.text), ['Hello & welcome', "It's me"]);
    assert.equal(tr.formatSegments(segs), "[0:00] Hello & welcome\n[0:40] It's me");
    assert.deepEqual(tr.parseCaptionXml('<timedtext><body><p t="1500" d="1000"><s>Hi</s> <s>there</s></p></body></timedtext>'), [{ start: 1.5, text: 'Hi there' }]);
  });
  test('captions: asks InnerTube, prefers the manual track in the wanted language', async () => {
    const calls = route([[/youtubei\/v1\/player/, () => PLAYER], [/api\/timedtext/, () => new Response(XML)]]);
    const t = await tr.captionsTranscript('abcDEF12345', 'en');
    assert.equal(t.via, 'captions'); assert.equal(t.cost, 0); assert.equal(t.lang, 'en');
    assert.equal(calls[0].body.videoId, 'abcDEF12345');
    assert.equal(calls[1].url, 'https://www.youtube.com/api/timedtext?v=x&lang=en');   // not the asr one, not Swedish
    await assert.rejects(tr.captionsTranscript('short'), /not a YouTube video id/);
  });
  test('captions: a video without them, or one YouTube refuses, says why', async () => {
    route([[/youtubei/, () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you are not a bot' } })]]);
    await assert.rejects(tr.captionsTranscript('abcDEF12345'), /Sign in to confirm/);
    route([[/youtubei/, () => ({ playabilityStatus: { status: 'OK' } })]]);
    await assert.rejects(tr.captionsTranscript('abcDEF12345'), /no captions/);
  });
  test('openrouter: sends the video address to a Gemini model and reports the cost', async () => {
    const calls = route([[/openrouter\.ai/, () => ({ choices: [{ message: { content: '[0:00] Hi' } }], usage: { prompt_tokens: 1000, completion_tokens: 50, cost: 0.0042 } })]]);
    const cfg = tr.transcriptConfig({ TRANSCRIPT_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' });
    const t = await tr.getTranscript(cfg, 'abcDEF12345');
    assert.deepEqual([t.via, t.text, t.cost, t.model], ['openrouter', '[0:00] Hi', 0.0042, 'google/gemini-2.5-flash']);
    const part = calls[0].body.messages[0].content.find((c) => c.type === 'video_url');
    assert.equal(part.video_url.url, 'https://www.youtube.com/watch?v=abcDEF12345');
    assert.equal(calls[0].body.model, 'google/gemini-2.5-flash');
    await assert.rejects(tr.getTranscript(tr.transcriptConfig({ TRANSCRIPT_PROVIDER: 'openrouter' }), 'abcDEF12345'), /OPENROUTER_API_KEY/);
  });
  test('replicate: runs the model by version with the video address and prices the compute', async () => {
    const out = JSON.stringify({ segments: [{ text: ' Hello', start: 0 }, { text: ' again', start: 45 }] });
    const calls = route([[/\/v1\/models\//, () => ({ latest_version: { id: 'ver123' } })], [/\/v1\/predictions$/, () => ({ status: 'succeeded', output: out, metrics: { predict_time: 20 } })]]);
    const cfg = tr.transcriptConfig({ TRANSCRIPT_PROVIDER: 'replicate', REPLICATE_API_TOKEN: 't', TRANSCRIPT_REPLICATE_USD_PER_SEC: '0.002' });
    const t = await tr.getTranscript(cfg, 'abcDEF12345');
    assert.equal(t.text, '[0:00] Hello\n[0:45] again'); assert.equal(t.via, 'replicate'); assert.equal(t.cost, 0.04);
    assert.deepEqual(calls[1].body, { version: 'ver123', input: { url: 'https://www.youtube.com/watch?v=abcDEF12345' } });
  });
  test('the fallback runs only when the first way fails, and a double failure lists both', async () => {
    route([[/youtubei/, () => ({ playabilityStatus: { status: 'OK' } })], [/openrouter\.ai/, () => ({ choices: [{ message: { content: 'From the service' } }], usage: {} })]]);
    const both = tr.transcriptConfig({ TRANSCRIPT_FALLBACK: 'openrouter', OPENROUTER_API_KEY: 'k' });
    assert.equal((await tr.getTranscript(both, 'abcDEF12345')).via, 'openrouter');
    route([[/youtubei/, () => ({ playabilityStatus: { status: 'OK' } })]]);
    await assert.rejects(tr.getTranscript(tr.transcriptConfig({ TRANSCRIPT_FALLBACK: 'replicate' }), 'abcDEF12345'), /captions: this video has no captions; replicate: needs the REPLICATE_API_TOKEN/);
    const ok = route([[/youtubei/, () => PLAYER], [/api\/timedtext/, () => new Response(XML)]]);
    await tr.getTranscript(both, 'abcDEF12345');
    assert.ok(ok.every((c) => !/openrouter/.test(c.url)), 'a working first way never reaches the service');
  });
  test('the tool only serves videos the writer was given, and needs a provider', async () => {
    const { buildTools } = await import('../src/summarize/agent.ts');
    const given = [{ id: 'yt:abcDEF12345', url: 'https://www.youtube.com/watch?v=abcDEF12345', by: 'Fireship', at: '', text: 'T', likes: 0, retweets: 0, replies: 0, views: 5, source: 'youtube' }];
    const asked = [];
    const run = (tools, input) => tools.find((t) => t.name === 'get_video_transcript').invoke(input, {});
    const tools = buildTools({ transcript: async (a) => { asked.push(a); return { text: 'x'.repeat(5000), via: 'captions', lang: 'en' }; } }, given);
    await assert.rejects(run(tools, { id: 'yt:zzzzzzzzzzz' }), /not a YouTube video you were given/);
    const r = JSON.parse(await run(tools, { id: 'yt:abcDEF12345', maxChars: 2000 }));
    assert.deepEqual([r.via, r.chars, r.truncated, r.text.length], ['captions', 5000, true, 2000]);
    assert.equal(asked[0].videoId, 'abcDEF12345');
    await assert.rejects(run(buildTools({}, given), { id: 'yt:abcDEF12345' }), /not available on this deployment/);
  });
});

describe('feed lists', async () => {
  const fl = await import('../src/sources/feedlist.ts');
  const { buildTools, fetchSource, buildPrompt } = await import('../src/summarize/agent.ts');
  const { parseRequest } = await import('../src/summarize/request.ts');
  const real = globalThis.fetch;
  after(() => { globalThis.fetch = real; });
  const day = 86_400_000;
  const rss = (title, items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items.map(([t, l, ago]) => `<item><title>${t}</title><link>${l}</link><guid>${l}</guid><pubDate>${new Date(Date.now() - ago).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
  const feeds = {
    'https://a.example.com/feed': rss('Blog A', [['Fresh A', 'https://a.example.com/1', 2 * 3600_000], ['Old A', 'https://a.example.com/0', 10 * day]]),
    'https://b.example.com/feed': rss('Blog B', [['Fresh B', 'https://b.example.com/1', 5 * 3600_000], ['Same story', 'https://shared.example.com/s', 3600_000]]),
    'https://c.example.com/feed': rss('Blog C', [['Same story again', 'https://shared.example.com/s', 3600_000]]),
  };
  const serve = () => { globalThis.fetch = async (u) => { const body = feeds[String(u)]; return body ? new Response(body, { headers: { 'content-type': 'application/xml' } }) : new Response('nope', { status: 404 }); }; };
  const member = (url, label) => ({ source: 'rss', query: url, label, note: '', addedAt: 1 });

  test('lines: a feed is checked and named, a broken one is reported, the rest still work', async () => {
    serve();
    const r = await fl.resolveLines(['https://a.example.com/feed', 'https://missing.example.com/x', '  ', 'ftp://bad.example.com']);
    assert.equal(r.length, 3);
    assert.deepEqual([r[0].ok, r[0].member.source, r[0].member.label], [true, 'rss', 'Blog A']);
    assert.equal(r[1].ok, false); assert.match(r[1].error, /HTTP 404/);
    assert.equal(r[2].ok, false);
  });
  test('a YouTube feed address pasted as a link becomes a youtube member', async () => {
    const YT = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA';
    globalThis.fetch = async () => new Response('<feed xmlns:yt="y" xmlns="http://www.w3.org/2005/Atom"><title>Fireship</title></feed>');
    const [r] = await fl.resolveLines([YT]);
    assert.deepEqual([r.ok, r.member.source, r.member.label, r.member.query], [true, 'youtube', 'Fireship', YT]);
  });
  test('reading keeps the window, names each item\'s feed, and drops a story two feeds both carry', async () => {
    serve();
    const r = await fl.readMembers([member('https://a.example.com/feed', 'Blog A'), member('https://b.example.com/feed', 'Blog B'), member('https://c.example.com/feed', 'Blog C'), member('https://gone.example.com/feed', 'Gone')], Date.now() - 2 * day);
    assert.equal(r.read, 4);
    assert.deepEqual(r.items.map((i) => i.title).filter((t) => t.startsWith('Fresh')).sort(), ['Fresh A', 'Fresh B']);
    assert.equal(r.items.length, 3);
    assert.ok(!r.items.some((i) => i.title === 'Old A'), 'older than the window');
    assert.equal(r.items.filter((i) => i.url === 'https://shared.example.com/s').length, 1);
    assert.deepEqual(r.items.find((i) => i.title === 'Fresh A').feed, 'Blog A');
    assert.equal(r.items.find((i) => i.title === 'Fresh A').feedUrl, 'https://a.example.com/feed');
    assert.ok(r.failed.some((f) => /^Gone/.test(f)));
    assert.ok(r.items[0].createdAt >= r.items[1].createdAt, 'newest first');
  });
  test('the same feed in two members is one entry', () => {
    assert.equal(fl.memberKey({ source: 'youtube', query: 'https://x.test/f' }), fl.memberKey({ source: 'rss', query: 'https://x.test/f' }));
    assert.notEqual(fl.memberKey({ source: 'hn', query: 'rust', hnTag: 'story' }), fl.memberKey({ source: 'hn', query: 'rust', hnTag: 'front_page' }));
  });
  test('as a source: parsed from a request, prefetched, and offered to the agent as a tool', async () => {
    assert.deepEqual(parseRequest({ source: { type: 'flist', listId: 'ab12', hours: 48 } }).source, { type: 'flist', listId: 'ab12', hours: 48 });
    assert.throws(() => parseRequest({ source: { type: 'flist', listId: '../x' } }), /pick a feed list/);
    const item = { id: 'rss:1', url: 'https://a.example.com/1', text: 'Fresh A', createdAt: new Date().toISOString(), source: 'rss', feed: 'Blog A', author: { userName: 'Blog A', name: 'Blog A' } };
    const sources = { feedList: async (a) => { assert.deepEqual(a, { listId: 'ab12', hours: 48 }); return { tweets: [item], name: 'My feeds', feeds: 3, failed: ['Gone'] }; } };
    const got = await fetchSource(sources, { type: 'flist', listId: 'ab12', hours: 48 });
    assert.deepEqual([got.tweets.length, got.parts[0].kind, got.parts[0].label], [1, 'flist', 'My feeds']);
    assert.match(got.note, /Could not read: Gone/);
    await assert.rejects(fetchSource({}, { type: 'flist', listId: 'ab12', hours: 48 }), /only available on the deployed site/);
    assert.match(buildPrompt({ length: 'brief', source: { type: 'flist', listId: 'ab12', hours: 48 } }), /get_feed_list_items/);
    assert.ok(buildTools(sources).some((t) => t.name === 'get_feed_list_items'));
    assert.ok(!buildTools({}).some((t) => t.name === 'get_feed_list_items'));
  });
});

test('unreachable and non-web addresses give readable reasons', async () => {
  const fl = await import('../src/sources/feedlist.ts');
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('internal error; reference = abc123'); };
    const [a, b] = await fl.resolveLines(['https://down.example.com/feed', 'ftp://files.example.com/x']);
    assert.equal(a.error, 'could not reach that address');
    assert.match(b.error, /must start with https/);
    const r = await fl.readMembers([{ source: 'rss', query: 'https://down.example.com/feed', label: 'Down', note: '', addedAt: 1 }], 0);
    assert.deepEqual(r.failed, ['Down (could not reach that address)']);
  } finally { globalThis.fetch = real; }
});

describe('the sources of a summary', async () => {
  const { sourceRefs, streamSummary } = await import('../src/summarize/agent.ts');
  const { compact } = await import('../src/summarize/tweets.ts');
  const yt = (n, feed, url) => compact({ id: `yt:${n}`, url: `https://www.youtube.com/watch?v=${n}`, text: `Video ${n}\nlong description`, createdAt: '2026-01-01T00:00:00Z', source: 'youtube', feed, feedUrl: url, author: { name: feed, userName: feed } });
  const A = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA';
  const items = [yt('aaaaaaaaaa1', 'Fireship', A), yt('aaaaaaaaaa2', 'Fireship', A), compact({ id: 'hn:7', url: 'https://a.example.com/p', discussionUrl: 'https://news.ycombinator.com/item?id=7', text: 'A story', source: 'hn', feed: 'HN front page', feedUrl: 'https://news.ycombinator.com/', author: { userName: 'pg', name: 'pg' } }), compact({ id: '99', text: 'a tweet', author: { userName: 'ann' } })];

  test('lists the feeds it read, counts what it cited, and links the channel page', () => {
    const r = sourceRefs(items, 'See [Fireship: Video aaaaaaaaaa1](https://www.youtube.com/watch?v=aaaaaaaaaa1) and [the talk](https://news.ycombinator.com/item?id=7).');
    assert.deepEqual([r.items, r.xPosts, r.feeds.length, r.cited.length], [3, 1, 2, 2]);
    const f = r.feeds.find((x) => x.source === 'youtube');
    assert.deepEqual([f.label, f.count, f.cited, f.page, f.url], ['Fireship', 2, 1, 'https://www.youtube.com/channel/UCsBjURrPoezykLs9EqgamOA', A]);
    assert.deepEqual(new Set(r.cited.map((c) => c.title)), new Set(['Video aaaaaaaaaa1', 'A story']));
    assert.equal(r.feeds[0].cited >= r.feeds[1].cited, true, 'cited feeds first');
  });
  test('nothing for a summary of tweets only', () => { assert.equal(sourceRefs([items[3]], 'x'), null); });
  test('streamSummary sends it before the usage, after the text', async () => {
    // Only the order of the events is checked, with the scripted mock model.
    const { MockModel } = await import('../src/summarize/mock-model.ts');
    const ev = []; for await (const e of streamSummary({ req: { length: 'brief', tweets: items }, sources: {}, model: new MockModel(), modelId: 'mock' })) ev.push(e.type);
    assert.ok(ev.includes('sources'), ev.join());
    assert.ok(ev.indexOf('sources') < ev.indexOf('usage') && ev.indexOf('usage') < ev.indexOf('done'));
  });
});

describe('expandShorthand', async () => {
  const { expandShorthand } = await import('../src/sources/presets.ts');
  test('turns shorthand into feed addresses', () => {
    assert.equal(expandShorthand('r/rust'), 'https://www.reddit.com/r/rust/.rss');
    assert.equal(expandShorthand('reddit: local llama'), 'https://www.reddit.com/search.rss?q=local%20llama&sort=new');
    assert.equal(expandShorthand('lobsters:rust'), 'https://lobste.rs/t/rust.rss');
    assert.equal(expandShorthand('github:cloudflare/workers-sdk'), 'https://github.com/cloudflare/workers-sdk/releases.atom');
    assert.equal(expandShorthand('arxiv:cs.AI'), 'https://rss.arxiv.org/rss/cs.AI');
    assert.match(expandShorthand('arxiv: diffusion models'), /export\.arxiv\.org\/api\/query\?search_query=all:diffusion%20models/);
    assert.match(expandShorthand('news: climate policy'), /news\.google\.com\/rss\/search\?q=climate%20policy/);
    assert.equal(expandShorthand('@alice@mastodon.social'), 'https://mastodon.social/@alice.rss');
    assert.equal(expandShorthand('#rust@fosstodon.org'), 'https://fosstodon.org/tags/rust.rss');
    assert.match(expandShorthand('redditsearch:rust'), /search\.rss\?q=rust/);
    assert.match(expandShorthand('arxivsearch:diffusion'), /search_query=all:diffusion/);
    assert.equal(expandShorthand('bluesky:alice.bsky.social'), 'https://bsky.app/profile/alice.bsky.social/rss');
  });
  test('turns pasted page links into feeds and leaves other input alone', () => {
    assert.equal(expandShorthand('https://old.reddit.com/r/rust/top'), 'https://www.reddit.com/r/rust/top/.rss');
    assert.equal(expandShorthand('https://github.com/a/b'), 'https://github.com/a/b/releases.atom');
    assert.equal(expandShorthand('https://example.com/feed.xml'), null);
    assert.equal(expandShorthand('https://www.youtube.com/@TED'), null);
    assert.equal(expandShorthand('@Fireship'), null);
    assert.equal(expandShorthand('example.com/feed'), null);
  });
  test('says what is wrong when the kind is known but the rest is not', () => {
    assert.throws(() => expandShorthand('github:nonsense'), /could not read/);
  });
});

describe('more shorthand and JSON feeds', async () => {
  const { expandShorthand } = await import('../src/sources/presets.ts');
  const { parseJsonFeed, withDates } = await import('../src/sources/json.ts');
  const hash = async (s) => String(s.length);
  test('expands the further kinds', () => {
    assert.equal(expandShorthand('trends:se'), 'https://trends.google.com/trending/rss?geo=SE');
    assert.equal(expandShorthand('trends:'), 'https://trends.google.com/trending/rss?geo=US');
    assert.equal(expandShorthand('pypi:httpx'), 'https://pypi.org/rss/project/httpx/releases.xml');
    assert.equal(expandShorthand('npm:@hono/node-server'), 'https://registry.npmjs.org/@hono/node-server');
    assert.equal(expandShorthand('huggingface:blog'), 'https://huggingface.co/blog/feed.xml');
    assert.equal(expandShorthand('status:https://www.githubstatus.com/'), 'https://www.githubstatus.com/history.atom');
    assert.equal(expandShorthand('devto:@ann'), 'https://dev.to/feed/ann');
    assert.equal(expandShorthand('tildes:~comp'), 'https://tildes.net/~comp/topics.atom');
    assert.equal(expandShorthand('usgs:4.5_day'), 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.atom');
    assert.throws(() => expandShorthand('huggingface:nope'), /could not read/);
  });
  test('{7d} becomes a date', () => assert.match(withDates('https://x.test/?q=a+created:%3E%7B7d%7D'), /created:%3E\d{4}-\d\d-\d\d$/));
  test('reads GitHub search and Mastodon trending JSON', async () => {
    const gh = await parseJsonFeed(JSON.stringify({ items: [{ id: 1, html_url: 'https://github.com/a/b', full_name: 'a/b', description: 'D', owner: { login: 'a' }, created_at: '2026-01-01T00:00:00Z', stargazers_count: 9, open_issues_count: 2 }] }), 'https://api.github.com/search/repositories?q=llm', hash);
    assert.equal(gh.items[0].title, 'a/b'); assert.equal(gh.items[0].points, 9); assert.equal(gh.items[0].comments, 2);
    const m = await parseJsonFeed(JSON.stringify([{ id: '1', url: 'https://m.test/@a/1', content: '<p>Hi &amp; bye</p>', account: { acct: 'a' }, created_at: '2026-01-01T00:00:00Z', favourites_count: 5, replies_count: 1 }]), 'https://m.test/api/v1/trends/statuses', hash);
    assert.equal(m.items[0].text, 'Hi & bye'); assert.equal(m.items[0].points, 5);
  });
  test('leaves other addresses to the XML reader', async () => assert.equal(await parseJsonFeed('{}', 'https://example.com/x.json', hash), null));
});
