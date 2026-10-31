// Feed lists: curated sets of feeds (RSS, YouTube channels and playlists, Hacker News searches). Reading a list fetches every member
// now and keeps what was published in the window, so a briefing or a summary does not depend on what the Monitor happened to capture.
import { fetchHn, HN_TAGS, type HnTag } from './hn.ts';
import { checkFeedUrl, fetchRss } from './rss.ts';
import { toFeedShape, type SourceItem } from './types.ts';
import { isYoutubeFeed, resolveYoutubeFeed } from './youtube.ts';

export interface FeedMember {
  source: 'rss' | 'youtube' | 'hn';
  /** The feed address (rss, youtube) or the keywords (hn, may be empty). */
  query: string;
  hnTag?: HnTag; minPoints?: number;
  label: string; note: string; addedAt: number;
}
export const MAX_MEMBERS = 200;
const MAX_READ = 100, CONCURRENCY = 4, MAX_ITEMS = 400;

export const memberKey = (m: Pick<FeedMember, 'source' | 'query' | 'hnTag' | 'minPoints'>) =>
  m.source === 'hn' ? `hn\n${m.hnTag ?? 'front_page'}\n${m.query.toLowerCase()}\n${m.minPoints ?? 0}` : `${m.source === 'youtube' ? 'rss' : m.source}\n${m.query}`;

/** The runtime reports an unreachable host as "internal error; reference = …": say what it means. */
const friendly = (err: unknown): string => { const m = err instanceof Error ? err.message : String(err); return /internal error|fetch failed|network|timed out|aborted/i.test(m) ? 'could not reach that address' : m; };

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

export interface ResolveResult { line: string; ok: boolean; member?: Pick<FeedMember, 'source' | 'query' | 'label'>; error?: string }

/** One pasted line (a link, a handle or a feed address) → a member, checked by loading it once. */
async function resolveLine(raw: string): Promise<ResolveResult> {
  const line = raw.trim();
  try {
    const looksYoutube = /^@?[\w.-]{2,60}$/.test(line) && !/\./.test(line.replace(/^@/, '')) || /^UC[\w-]{22}$/.test(line) || /^(PL|UU|OL)[\w-]{10,60}$/.test(line)
      || /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\b/i.test(line);
    if (looksYoutube) {
      const feed = await resolveYoutubeFeed(line), r = await fetchRss({ url: feed });
      return { line, ok: true, member: { source: 'youtube', query: feed, label: r.title.slice(0, 80) || feed } };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(line) && !/^https?:\/\//i.test(line)) throw new Error('the address must start with https://');
    const url = checkFeedUrl(/^https?:\/\//i.test(line) ? line : `https://${line}`);
    if (isYoutubeFeed(url)) { const r = await fetchRss({ url }); return { line, ok: true, member: { source: 'youtube', query: url, label: r.title.slice(0, 80) || url } }; }
    const r = await fetchRss({ url });
    return { line, ok: true, member: { source: 'rss', query: url, label: r.title.slice(0, 80) || new URL(url).hostname } };
  } catch (err) { return { line, ok: false, error: friendly(err) }; }
}
export async function resolveLines(lines: string[]): Promise<ResolveResult[]> {
  return pool(lines.map((l) => l.trim()).filter(Boolean).slice(0, 25), CONCURRENCY, resolveLine);
}

/** Everything the members published since `sinceMs`, newest first, shaped like the Monitor feed (with `feed` and `feedUrl`). */
export async function readMembers(members: FeedMember[], sinceMs: number): Promise<{ items: ReturnType<typeof toFeedShape>[]; failed: string[]; read: number }> {
  const use = members.slice(0, MAX_READ), failed: string[] = [], items: Array<{ it: SourceItem; label: string; url: string }> = [];
  await pool(use, CONCURRENCY, async (m) => {
    try {
      const url = m.source === 'hn' ? 'https://news.ycombinator.com/' : m.query;
      const r = m.source === 'hn' ? await fetchHn({ tag: HN_TAGS.includes(m.hnTag as HnTag) ? m.hnTag! : 'front_page', query: m.query || undefined, minPoints: m.minPoints, since: Math.floor(sinceMs / 1000) })
        : await fetchRss({ url: m.query });
      for (const it of r.items) if (Date.parse(it.at) >= sinceMs) items.push({ it, label: m.label, url });
    } catch (err) { failed.push(`${m.label} (${friendly(err).slice(0, 60)})`); }
  });
  const seen = new Set<string>(), out: ReturnType<typeof toFeedShape>[] = [];
  for (const { it, label, url } of items.sort((a, b) => Date.parse(b.it.at) - Date.parse(a.it.at))) {
    const same = it.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();   // one story carried by two feeds has two ids but one address
    if (seen.has(it.id) || seen.has(same)) continue;
    seen.add(it.id); seen.add(same);
    out.push({ ...toFeedShape(it), feed: label, feedUrl: url } as ReturnType<typeof toFeedShape>);
    if (out.length >= MAX_ITEMS) break;
  }
  return { items: out, failed, read: use.length };
}
