// YouTube without the Data API: every channel and playlist has a public Atom feed, which rss.ts reads. This turns what a person
// pastes (a channel address, an @handle, a playlist, a video) into that feed's address.
import type { SourceItem } from './types';

const UA = 'Mozilla/5.0 (compatible; TweetExplorer/1.0)';
const HOSTS = /^(www\.|m\.)?youtube\.com$/;

export const channelFeed = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
export const playlistFeed = (id: string) => `https://www.youtube.com/feeds/videos.xml?playlist_id=${id}`;
export const isYoutubeFeed = (raw: string): boolean => { try { const u = new URL(raw); return HOSTS.test(u.hostname) && u.pathname === '/feeds/videos.xml'; } catch { return false; } };

/** The public page of the channel or playlist behind a YouTube feed address, for linking to; null if it is not one. */
export function pageOfFeed(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!isYoutubeFeed(raw)) return null;
    const c = u.searchParams.get('channel_id'), p = u.searchParams.get('playlist_id');
    return c && /^UC[\w-]{22}$/.test(c) ? `https://www.youtube.com/channel/${c}` : p && /^[\w-]{10,64}$/.test(p) ? `https://www.youtube.com/playlist?list=${p}` : null;
  } catch { return null; }
}

/** The video id in a YouTube address, or '' . */
export function videoIdOf(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.hostname === 'youtu.be') return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : '';
    if (!HOSTS.test(u.hostname)) return '';
    const v = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(shorts|embed|live)\/([\w-]{11})/.exec(u.pathname)?.[2];
    return v && /^[\w-]{11}$/.test(v) ? v : '';
  } catch { return ''; }
}

async function channelIdFromPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`YouTube answered HTTP ${res.status} for that address`); }
  const html = (await res.text()).slice(0, 1_500_000);
  const id = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1]
    ?? /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ?? /<meta itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/.exec(html)?.[1] ?? /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1];
  if (!id) throw new Error('could not find the channel on that page; paste the channel address that contains /channel/UC… instead');
  return id;
}

/** What someone pastes → the address of the Atom feed to watch. */
export async function resolveYoutubeFeed(input: string): Promise<string> {
  const q = input.trim();
  if (!q) throw new Error('enter a channel, an @handle or a playlist');
  if (/^UC[\w-]{22}$/.test(q)) return channelFeed(q);
  if (/^(PL|UU|OL|LL|FL)[\w-]{10,60}$/.test(q)) return playlistFeed(q);
  if (/^@?[\w.-]{2,60}$/.test(q)) return channelFeed(await channelIdFromPage(`https://www.youtube.com/@${q.replace(/^@/, '')}`));
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(q) ? q : `https://${q}`); } catch { throw new Error('that is not a YouTube channel, @handle or playlist'); }
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be' || HOSTS.test(host)) {
    if (u.pathname === '/feeds/videos.xml') {
      const c = u.searchParams.get('channel_id'), p = u.searchParams.get('playlist_id');
      if (c && /^UC[\w-]{22}$/.test(c)) return channelFeed(c);
      if (p && /^[\w-]{10,64}$/.test(p)) return playlistFeed(p);
    }
    const ch = /^\/channel\/(UC[\w-]{22})/.exec(u.pathname)?.[1];
    if (ch) return channelFeed(ch);
    const list = u.searchParams.get('list');
    if (u.pathname === '/playlist' && list && /^[\w-]{10,64}$/.test(list)) return playlistFeed(list);
    const handle = /^\/(@[\w.-]{2,60})/.exec(u.pathname)?.[1];
    if (handle) return channelFeed(await channelIdFromPage(`https://www.youtube.com/${handle}`));
    const legacy = /^\/(user|c)\/([\w.-]{1,60})/.exec(u.pathname);
    if (legacy) return channelFeed(await channelIdFromPage(`https://www.youtube.com/${legacy[1]}/${legacy[2]}`));
    const v = videoIdOf(u.href);
    if (v) return channelFeed(await channelIdFromPage(`https://www.youtube.com/watch?v=${v}`));   // the channel that posted this video
  }
  throw new Error('that is not a YouTube channel, @handle or playlist');
}

// ---- When the public feed fails: the YouTube Data API (needs the YOUTUBE_API_KEY secret; 1 quota unit a call, 10,000 free a day).
// YouTube's feeds/videos.xml sometimes answers 404 for every channel for days. A channel's uploads are also a playlist ("UU" + the channel id
// without "UC"), which the API lists. The items get the same ids as from the feed (yt:<video>), so nothing is counted twice when the feed comes back.
let apiKey = '';
/** Set once per Worker or Durable Object from its environment; without a key the fallback is off. */
export const setYoutubeKey = (key: string | undefined): void => { if (key) apiKey = key; };
export const hasYoutubeKey = (): boolean => !!apiKey;

export async function fetchYoutubeApi(feedUrl: string): Promise<{ title: string; items: SourceItem[] }> {
  const u = new URL(feedUrl), c = u.searchParams.get('channel_id') ?? '', p = u.searchParams.get('playlist_id') ?? '';
  const playlist = p || (/^UC[\w-]{22}$/.test(c) ? 'UU' + c.slice(2) : '');
  if (!playlist || !apiKey) throw new Error('not a YouTube channel or playlist, or no YOUTUBE_API_KEY');
  const api = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  for (const [k, v] of Object.entries({ part: 'snippet,contentDetails', maxResults: '15', playlistId: playlist, key: apiKey })) api.searchParams.set(k, v);
  const res = await fetch(api, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`the YouTube API answered HTTP ${res.status}`); }
  type Item = { snippet?: { title?: string; description?: string; publishedAt?: string; channelTitle?: string; videoOwnerChannelTitle?: string; resourceId?: { videoId?: string } }; contentDetails?: { videoId?: string; videoPublishedAt?: string } };
  const d = (await res.json()) as { items?: Item[] };
  const items: SourceItem[] = [];
  for (const it of d.items ?? []) {
    const id = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId ?? '', title = String(it.snippet?.title ?? '');
    if (!/^[\w-]{11}$/.test(id) || title === 'Private video' || title === 'Deleted video') continue;
    const when = Date.parse(it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? '');
    items.push({ source: 'youtube', id: `yt:${id}`, url: `https://www.youtube.com/watch?v=${id}`, title: title || 'Untitled video', text: String(it.snippet?.description ?? '').slice(0, 600),
      by: String(it.snippet?.videoOwnerChannelTitle ?? it.snippet?.channelTitle ?? '').slice(0, 80), at: new Date(Number.isNaN(when) ? Date.now() : Math.min(when, Date.now())).toISOString() });
  }
  return { title: items[0]?.by || String(d.items?.[0]?.snippet?.channelTitle ?? ''), items };
}
