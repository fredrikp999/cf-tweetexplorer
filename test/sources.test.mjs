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
