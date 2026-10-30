// Local-Node host for the summarizer: data sources that call this app's own server (so they share its
// API key handling, Lists and Monitor stores), used by server/index.js.
import type { ListInfo, Sources } from './agent.ts';
import type { RawTweet } from './tweets.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function nodeSources(base: string): Sources {
  async function get(path: string, params: Record<string, string> = {}): Promise<any> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(`${base}${path}?${new URLSearchParams(params)}`);
      if (res.status === 429) { await sleep(5200); continue; }          // free tier: one request per 5 seconds
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || body.status === 'error') throw new Error(String(body.msg ?? body.message ?? body.error ?? `HTTP ${res.status}`));
      return body;
    }
    throw new Error('twitterapi.io is rate limiting; try again shortly');
  }
  async function pages(path: string, params: Record<string, string>, n: number): Promise<RawTweet[]> {
    const all: RawTweet[] = []; let cursor = '';
    for (let i = 0; i < n; i++) {
      const r = await get(path, cursor ? { ...params, cursor } : params);
      all.push(...((r.tweets ?? r.data?.tweets ?? []) as RawTweet[]));
      if (!r.has_next_page || !r.next_cursor) break;
      cursor = String(r.next_cursor);
    }
    return all;
  }
  return {
    search: ({ query, sort, pages: n }) => pages('/api/twitter/tweet/advanced_search', { query, queryType: sort }, n),
    accountTweets: ({ handle, pages: n }) => pages('/api/twitter/user/last_tweets', { userName: handle }, n),
    replies: ({ tweetId, sort, pages: n }) => pages('/api/twitter/tweet/replies/v2', { tweetId, queryType: sort }, n),
    async lists(): Promise<ListInfo[]> {
      const all: Array<{ id: string; name: string; topic: string; members: Array<{ handle: string; missing: boolean }> }> = await get('/lists/all');
      return all.map((l) => ({ id: l.id, name: l.name, topic: l.topic, handles: l.members.filter((m) => !m.missing).map((m) => m.handle) }));
    },
    async feed({ limit, watch }) {
      const items: Array<{ watchId: string; label: string; tweet: RawTweet }> = await get('/mon/feed', { limit: String(limit) });
      const w = watch?.toLowerCase();
      return items.filter((i) => !w || i.watchId === watch || i.label.toLowerCase().includes(w)).map((i) => i.tweet);
    },
  };
}
