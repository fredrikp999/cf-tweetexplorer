// Statistics for a collected set of tweets: what a published History report shows next to the tweets.
// Pure functions (no Worker APIs), so Node can test them. Times are UTC.

export interface StatTweet {
  id: string; text?: string; createdAt: string; lang?: string;
  likeCount?: number; retweetCount?: number; replyCount?: number; quoteCount?: number; viewCount?: number;
  author?: { userName?: string; name?: string };
  entities?: { hashtags?: { text: string }[]; urls?: { url: string; expanded_url?: string }[] };
}
export interface Counted { label: string; count: number }
export interface Stats {
  tweets: number; authors: number; firstTs: number; lastTs: number;
  likes: number; retweets: number; replies: number; quotes: number; views: number;
  stepSec: number; startTs: number; perStep: number[]; likesPerStep: number[];   // activity over time, in buckets of stepSec from startTs
  heat: number[][];                                                              // weekday (Mon first) x hour, UTC
  topAuthors: Array<{ handle: string; name: string; tweets: number; likes: number }>;
  hashtags: Counted[]; langs: Counted[]; words: Counted[]; domains: Counted[];
}

const DAY = 86_400, TOP = 15;
export const epochOf = (t: { createdAt: string }): number => Math.floor(Date.parse(t.createdAt) / 1000);

// Common words that say nothing about a topic (English and Swedish), plus link and chat debris.
export const STOP = new Set(('about above after again also been being below between both but cant cannot could did does doing dont down during each every from further have having here hers herself himself how into its itself just like more most much must myself need once only other ours over same should some such than that their theirs them then there these they this those through under until very want was were what when where which while who whom why will with would your yours yourself yourselves https http amp get got new now one out says see use via way well the and are for you not was can has had her his she him our any may too yes its who how why let all any few off own too yet etc per '
  + 'och att det som en är på för med har inte den till av jag om ett men var vi de han hon kan ska från så vad efter eller mot nu här också när hur sig sin sitt sina bara mer än alla blir bli ha vill måste').split(' '));

/** The step that gives a readable chart: hours for a couple of days, then days, weeks, 30-day months. */
export function pickStep(spanSec: number): number {
  return spanSec <= 2 * DAY ? 3600 : spanSec <= 100 * DAY ? DAY : spanSec <= 730 * DAY ? 7 * DAY : 30 * DAY;
}

const top = (m: Map<string, number>, n = TOP): Counted[] => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([label, count]) => ({ label, count }));
const bump = (m: Map<string, number>, k: string, cap = 300_000) => { if (m.has(k) || m.size < cap) m.set(k, (m.get(k) ?? 0) + 1); };

/** One pass over the tweets. `range` is the collected period (it sets the chart's axis); tweets outside it still count. */
export function computeStats(tweets: Iterable<StatTweet>, range: { fromTs: number; toTs: number }): Stats {
  const s: Stats = { tweets: 0, authors: 0, firstTs: 0, lastTs: 0, likes: 0, retweets: 0, replies: 0, quotes: 0, views: 0, stepSec: 0, startTs: 0, perStep: [], likesPerStep: [],
    heat: Array.from({ length: 7 }, () => Array(24).fill(0)), topAuthors: [], hashtags: [], langs: [], words: [], domains: [] };
  const stepSec = pickStep(Math.max(1, range.toTs - range.fromTs));
  const startTs = Math.floor(range.fromTs / stepSec) * stepSec, buckets = Math.min(2000, Math.ceil((range.toTs - startTs) / stepSec));
  s.stepSec = stepSec; s.startTs = startTs; s.perStep = Array(buckets).fill(0); s.likesPerStep = Array(buckets).fill(0);
  const authors = new Map<string, { name: string; tweets: number; likes: number }>(), tags = new Map<string, number>(), langs = new Map<string, number>(), words = new Map<string, number>(), domains = new Map<string, number>();
  for (const t of tweets) {
    const ts = epochOf(t), likes = t.likeCount ?? 0;
    s.tweets++; s.likes += likes; s.retweets += t.retweetCount ?? 0; s.replies += t.replyCount ?? 0; s.quotes += t.quoteCount ?? 0; s.views += t.viewCount ?? 0;
    if (Number.isFinite(ts)) {
      if (!s.firstTs || ts < s.firstTs) s.firstTs = ts;
      if (ts > s.lastTs) s.lastTs = ts;
      const b = Math.floor((ts - startTs) / stepSec);
      if (b >= 0 && b < buckets) { s.perStep[b]++; s.likesPerStep[b] += likes; }
      const d = new Date(ts * 1000); s.heat[(d.getUTCDay() + 6) % 7][d.getUTCHours()]++;
    }
    const handle = t.author?.userName ?? '';
    if (handle) { const a = authors.get(handle) ?? { name: t.author?.name ?? '', tweets: 0, likes: 0 }; a.tweets++; a.likes += likes; authors.set(handle, a); }
    for (const h of t.entities?.hashtags ?? []) if (h.text) bump(tags, '#' + h.text.toLowerCase());
    if (t.lang) bump(langs, t.lang);
    for (const u of t.entities?.urls ?? []) {
      try { const host = new URL(u.expanded_url ?? u.url).hostname.replace(/^www\./, ''); if (host && !/^(t\.co|x\.com|twitter\.com)$/.test(host)) bump(domains, host); } catch { /* not a URL */ }
    }
    const text = (t.text ?? '').replace(/https?:\/\/\S+/g, ' ').replace(/[@#][\p{L}\p{N}_]+/gu, ' ').toLowerCase();
    for (const w of text.match(/\p{L}[\p{L}'’]{2,}/gu) ?? []) if (!STOP.has(w)) bump(words, w);
  }
  s.authors = authors.size;
  s.topAuthors = [...authors].sort((a, b) => b[1].tweets - a[1].tweets || b[1].likes - a[1].likes).slice(0, TOP).map(([handle, a]) => ({ handle, name: a.name, tweets: a.tweets, likes: a.likes }));
  s.hashtags = top(tags); s.langs = top(langs, 8); s.words = top(words, 20); s.domains = top(domains, 10);
  return s;
}
