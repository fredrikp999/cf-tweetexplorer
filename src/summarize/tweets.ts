// Shared helpers for the summarizer: compact tweet shape, account grouping, input limits.
// Imported by both the Worker and the local Node server, so: `import type` for types, `.ts` extensions,
// and no TypeScript-only runtime syntax (Node strips types, it doesn't compile them).

export interface RawTweet {
  id: string; url?: string; text?: string; createdAt?: string; lang?: string;
  likeCount?: number; retweetCount?: number; replyCount?: number; viewCount?: number;
  author?: { userName?: string; name?: string };
  /** Absent for X. RSS and Hacker News items from the Monitor feed carry these (see sources/types.ts). */
  source?: string; title?: string; discussionUrl?: string;
}
export interface CompactTweet {
  id: string; url: string; by: string; at: string; text: string;
  likes: number; retweets: number; replies: number; views: number; lang?: string;
  /** 0 to 100: an automatic estimate of how relevant and informative the tweet is (summarize/screen.ts). Absent when the tweet was not screened. */
  signal?: number;
  /** 'rss' or 'hn' for items that are not tweets; absent for X. For those, `by` is a site or author name and `url` is the article. */
  source?: string; discussion?: string;
}

export const MAX_TEXT = 600;

export function compact(t: RawTweet): CompactTweet {
  const by = t.author?.userName ?? '';
  const other = t.source && t.source !== 'x';   // an RSS item or a Hacker News story: no handle, and the link is the article
  return {
    id: String(t.id), url: t.url ?? (by && !other ? `https://x.com/${by}/status/${t.id}` : ''), by: other ? (t.author?.name || by) : by ? '@' + by : '',
    at: t.createdAt ? new Date(t.createdAt).toISOString() : '', text: String(t.text ?? '').slice(0, MAX_TEXT),
    likes: t.likeCount ?? 0, retweets: t.retweetCount ?? 0, replies: t.replyCount ?? 0, views: t.viewCount ?? 0, lang: t.lang,
    ...(other ? { source: t.source, ...(t.discussionUrl ? { discussion: t.discussionUrl } : {}) } : {}),
  };
}

export function dedupeSort(tweets: RawTweet[]): RawTweet[] {
  const seen = new Set<string>(), out: RawTweet[] = [];
  for (const t of tweets) if (t?.id && !seen.has(String(t.id))) { seen.add(String(t.id)); out.push(t); }
  return out.sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
}

// "(from:a OR from:b …)" groups that stay under the search query length limit.
export function handleQueries(handles: string[], maxLen = 300): string[] {
  const groups: string[][] = []; let cur: string[] = [];
  const len = (arr: string[]) => arr.map((h) => 'from:' + h).join(' OR ').length + 2;
  for (const h of handles) { if (cur.length && len([...cur, h]) > maxLen) { groups.push(cur); cur = []; } cur.push(h); }
  if (cur.length) groups.push(cur);
  return groups.map((g) => (g.length === 1 ? 'from:' + g[0] : '(' + g.map((h) => 'from:' + h).join(' OR ') + ')'));
}

export const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

// Tweets sent by the browser are untrusted input too: keep only known fields, bounded.
export function cleanClientTweets(raw: unknown, max = 200): CompactTweet[] {
  if (!Array.isArray(raw)) return [];
  const out: CompactTweet[] = [];
  for (const t of raw.slice(0, max)) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    if (!r.id) continue;
    out.push(compact({
      id: String(r.id).slice(0, 30), url: typeof r.url === 'string' && /^https:\/\/(x|twitter)\.com\//.test(r.url) ? r.url : undefined,
      text: String(r.text ?? ''), createdAt: typeof r.createdAt === 'string' ? r.createdAt : undefined, lang: typeof r.lang === 'string' ? r.lang.slice(0, 8) : undefined,
      likeCount: Number(r.likeCount) || 0, retweetCount: Number(r.retweetCount) || 0, replyCount: Number(r.replyCount) || 0, viewCount: Number(r.viewCount) || 0,
      author: { userName: typeof (r.author as Record<string, unknown>)?.userName === 'string' ? String((r.author as Record<string, unknown>).userName).slice(0, 15) : '' },
    }));
  }
  return out;
}
