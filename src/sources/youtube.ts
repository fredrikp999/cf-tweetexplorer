// YouTube without the Data API: every channel and playlist has a public Atom feed, which rss.ts reads. This turns what a person
// pastes (a channel address, an @handle, a playlist, a video) into that feed's address.
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
