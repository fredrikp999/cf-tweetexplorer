// RSS 2.0 and Atom. Workers have no DOMParser, and feeds are regular enough that a small tolerant reader will do.
import { isJsonFeed, parseJsonFeed, withDates } from './json.ts';
import type { FetchResult, SourceItem } from './types';
import { fetchYoutubeApi, hasYoutubeKey, isYoutubeFeed } from './youtube.ts';

const MAX_BYTES = 3_000_000, MAX_JSON_BYTES = 12_000_000;
const MAX_ITEMS = 50;

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return NAMED[e.toLowerCase()] ?? m;
});
// Text of an element: CDATA is taken as it is, anything else has its entities decoded.
const text = (raw: string) => { const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw); return (m ? m[1] : decode(raw)).trim(); };
const plain = (html: string) => decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function element(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? text(m[1]) : undefined;
}
function atomLink(block: string): string | undefined {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel\s*=\s*["']alternate["']/i.test(a)) ?? links.find((a) => !/rel\s*=/i.test(a)) ?? links[0];
  const href = pick && /href\s*=\s*["']([^"']+)["']/i.exec(pick)?.[1];
  return href ? decode(href) : undefined;
}

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Parses a feed document. `feedUrl` namespaces the ids, so two feeds can carry the same link. */
export async function parseFeed(xml: string, feedUrl: string): Promise<{ title: string; items: SourceItem[] }> {
  const atom = /<feed[\s>]/i.test(xml.slice(0, 2000)) && !/<rss[\s>]/i.test(xml.slice(0, 2000));
  const tag = atom ? 'entry' : 'item';
  const blocks = [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]);
  const head = xml.slice(0, Math.max(0, xml.search(new RegExp(`<${tag}[\\s>]`, 'i'))) || xml.length);
  const feedTitle = plain(element(head, 'title') ?? '') || new URL(feedUrl).hostname;
  const host = new URL(feedUrl).hostname;
  const items: SourceItem[] = [];
  for (const b of blocks.slice(0, MAX_ITEMS)) {
    const videoId = /^[\w-]{11}$/.test(element(b, 'yt:videoId') ?? '') ? element(b, 'yt:videoId')! : '';   // a YouTube channel or playlist feed
    if (videoId) {
      const title = plain(element(b, 'media:title') ?? element(b, 'title') ?? ''), views = Number(/<media:statistics\b[^>]*\bviews="(\d+)"/i.exec(b)?.[1]);
      const when = Date.parse(element(b, 'published') ?? element(b, 'updated') ?? '');
      items.push({
        source: 'youtube', id: `yt:${videoId}`, url: `https://www.youtube.com/watch?v=${videoId}`, title: title || 'Untitled video',
        text: plain(element(b, 'media:description') ?? '').slice(0, 600), by: plain(element(b, 'name') ?? '').slice(0, 80) || feedTitle,
        at: new Date(Number.isNaN(when) ? Date.now() : Math.min(when, Date.now())).toISOString(), ...(Number.isFinite(views) ? { views } : {}),
      });
      continue;
    }
    const link = atom ? atomLink(b) : element(b, 'link') ?? atomLink(b);
    const guid = element(b, atom ? 'id' : 'guid') ?? link;
    const title = plain(element(b, 'title') ?? '');
    const body = plain(element(b, 'content:encoded') ?? element(b, 'content') ?? element(b, 'description') ?? element(b, 'summary') ?? '');
    if (!(link || guid) || !(title || body)) continue;
    let url = link ?? guid!;
    try { const u = new URL(url, feedUrl); if (u.protocol !== 'http:' && u.protocol !== 'https:') continue; url = u.href; } catch { continue; }
    const when = Date.parse(element(b, atom ? 'published' : 'pubDate') ?? element(b, 'updated') ?? element(b, 'dc:date') ?? '');
    const author = plain(element(b, 'dc:creator') ?? element(b, 'author') ?? element(b, 'name') ?? '');
    items.push({
      source: 'rss', id: `rss:${await sha(`${feedUrl}\n${guid ?? url}`)}`, url, title: title || body.slice(0, 120),
      text: title ? body.slice(0, 600) : '', by: author && !author.includes('@') ? author.slice(0, 80) : feedTitle || host,
      at: new Date(Number.isNaN(when) ? Date.now() : Math.min(when, Date.now())).toISOString(),
    });
  }
  return { title: feedTitle, items };
}

export function checkFeedUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error('enter the full address of the feed, starting with https://'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('the feed address must start with https://');
  if (u.username || u.password) throw new Error('the feed address cannot contain a username or password');
  return u.href;
}

/** A feed, and for a YouTube channel or playlist whose public feed fails, the same videos from the YouTube Data API (when a key is set). */
export async function fetchRss(opts: { url: string; etag?: string; lastModified?: string }): Promise<FetchResult & { title: string }> {
  try { return await fetchFeedDirect(opts); }
  catch (err) {
    if (!isYoutubeFeed(opts.url) || !hasYoutubeKey()) throw err;
    try { return { ...(await fetchYoutubeApi(opts.url)), viaApi: true }; }
    catch (e2) { throw new Error(`${err instanceof Error ? err.message : String(err)}; the YouTube API also failed: ${e2 instanceof Error ? e2.message : String(e2)}`); }
  }
}
async function fetchFeedDirect(opts: { url: string; etag?: string; lastModified?: string }): Promise<FetchResult & { title: string }> {
  const headers: Record<string, string> = { accept: 'application/rss+xml, application/json;q=0.9, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5', 'user-agent': 'TweetExplorer/1.0 (feed reader)' };
  if (opts.etag) headers['if-none-match'] = opts.etag;
  if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;
  const res = await fetch(withDates(opts.url), { headers, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (res.status === 304) { await res.body?.cancel(); return { items: [], unchanged: true, title: '' }; }
  if (!res.ok) { await res.body?.cancel(); throw new Error(`the feed answered HTTP ${res.status}`); }
  const buf = await res.arrayBuffer();
  const limit = isJsonFeed(opts.url) ? MAX_JSON_BYTES : MAX_BYTES;   // an npm package's whole history is several MB of JSON
  if (buf.byteLength > limit) throw new Error(`the feed is larger than ${limit / 1_000_000} MB`);
  const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(new TextDecoder().decode(buf.slice(0, 200)))?.[1] ?? 'utf-8';
  let xml: string;
  try { xml = new TextDecoder(charset).decode(buf); } catch { xml = new TextDecoder().decode(buf); }
  const json = /^\s*[{[]/.test(xml.slice(0, 50)) ? await parseJsonFeed(xml, opts.url, sha) : null;
  if (json) return { ...json, cache: { etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined } };
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 3000))) throw new Error('that address is not an RSS or Atom feed');
  const parsed = await parseFeed(xml, opts.url);
  return { ...parsed, cache: { etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined } };
}
