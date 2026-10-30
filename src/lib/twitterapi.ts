// advanced_search with retry/backoff, shared by the Monitor and History objects.
const UPSTREAM = 'https://api.twitterapi.io';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Tweet {
  id: string; url?: string; text?: string; createdAt: string; lang?: string; isReply?: boolean;
  likeCount?: number; retweetCount?: number; replyCount?: number; quoteCount?: number; viewCount?: number;
  retweeted_tweet?: unknown;
  author?: { id?: string; userName?: string; name?: string; profilePicture?: string };
  entities?: { hashtags?: { text: string }[]; urls?: { url: string; expanded_url?: string }[] };
  [k: string]: unknown;
}
export interface SearchResult { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string }

export class OutOfCredits extends Error {}
export class Stopped extends Error {}

// signal: any object with an `abort` flag; set it to true to cancel between attempts.
export async function search(opts: { key: string; query: string; queryType?: string; cursor?: string; signal?: { abort: boolean } }): Promise<SearchResult> {
  const params: Record<string, string> = { query: opts.query, queryType: opts.queryType ?? 'Latest' };
  if (opts.cursor) params.cursor = opts.cursor;
  const url = `${UPSTREAM}/twitter/tweet/advanced_search?${new URLSearchParams(params)}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (opts.signal?.abort) throw new Stopped('stopped');
    let res: Response;
    try { res = await fetch(url, { headers: { 'x-api-key': opts.key }, signal: AbortSignal.timeout(60_000) }); }
    catch (e) { lastErr = e; await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 429) { await res.body?.cancel(); await sleep(1000 + attempt * 1500); continue; }
    if (res.status === 402) { await res.body?.cancel(); throw new OutOfCredits('Out of credits (HTTP 402). Top up and resume.'); }
    const text = await res.text();
    if (res.status >= 500) { lastErr = new Error(`HTTP ${res.status}`); await sleep(1000 * (attempt + 1)); continue; }
    let body: Record<string, unknown>;
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`bad response: ${text.slice(0, 100)}`); }
    if (!res.ok || body.status === 'error') {
      const msg = body.msg ?? body.message ?? (typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`);
      throw new Error(String(msg));
    }
    return body as SearchResult;
  }
  throw lastErr instanceof Error ? lastErr : new Error('rate limited too long; slow down');
}

export const COST_PER_TWEET = 0.00015;

// Compact shape the UI renders (matches the local server).
export const slim = (t: Tweet) => ({
  id: t.id, url: t.url, text: t.text, createdAt: t.createdAt, lang: t.lang, isReply: !!t.isReply,
  likeCount: t.likeCount ?? 0, retweetCount: t.retweetCount ?? 0, replyCount: t.replyCount ?? 0, quoteCount: t.quoteCount ?? 0,
  viewCount: t.viewCount ?? 0, isRetweet: !!t.retweeted_tweet,
  author: { id: t.author?.id, userName: t.author?.userName, name: t.author?.name, profilePicture: t.author?.profilePicture },
  entities: {
    hashtags: (t.entities?.hashtags ?? []).map((h) => ({ text: h.text })),
    urls: (t.entities?.urls ?? []).map((u) => ({ url: u.url, expanded_url: u.expanded_url })),
  },
});

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
