// The three angles that step 7 of INTENT.md adds to a topic: who had it first (by kind of source), the timeline of key items, and what to watch (videos).
// Pure functions (no Worker APIs), so Node can test them. The Monitor gathers the items (`topicData`), src/site/public.ts draws the page, src/site/agentText.ts words it for agents,
// src/apps/topichub.ts draws the same lists in the hub view. The data rides in TopicData (src/signal/topicpage.ts), so the page, /t/<slug>.json and the MCP tools say the same.
import { QUIET_MS, TIE_MS, WAVE_MS, MIN_MENTIONS, isDateOnly } from './first.ts';
import type { EvItem, EvKind } from './topicpage.ts';

const MIN = 60_000, HOUR = 3_600_000;
export const KIND_ORDER: EvKind[] = ['x', 'hn', 'youtube', 'rss'];
/** How a kind of source is named in running text ("first seen on Hacker News", "then blogs and news"). */
export const KIND_WORDS: Record<EvKind, string> = { x: 'X', hn: 'Hacker News', youtube: 'YouTube', rss: 'blogs and news', arxiv: 'research papers' };
/** The same names for the start of a line or a heading. */
export const KIND_TITLE: Record<EvKind, string> = { x: 'X', hn: 'Hacker News', youtube: 'YouTube', rss: 'Blogs and news', arxiv: 'Research papers' };
/** A mark and a short name for each kind, so a picture never relies on colour alone. */
export const KIND_MARK: Record<EvKind, { shape: 'circle' | 'square' | 'triangle' | 'diamond'; short: string }> = {
  x: { shape: 'circle', short: 'X' }, hn: { shape: 'square', short: 'HN' }, youtube: { shape: 'triangle', short: 'YouTube' }, rss: { shape: 'diamond', short: 'Blogs' }, arxiv: { shape: 'diamond', short: 'Papers' },
};

// ---- who had it first
/** The item that opened a kind of source's part of the wave. Only on a Signal that shows its sources. */
export interface FirstRef { title: string; url: string; by: string; source: string }
export interface KindArrival { kind: EvKind; /** When the kind first had it (ms). */ ts: number; /** How long after the start of the wave (ms). */ lag: number; /** Items of this kind in the wave. */ n: number; item?: FirstRef }
export interface TopicFirst {
  /** The start of the latest wave of mentions: the first item after a quiet stretch. Null when there is nothing to order. */
  onset: number | null;
  /** The quiet before the first item cannot be seen, because it falls before the items we have: "first" then means first among what we have. */
  openEnded: boolean;
  /** Fewer mentions than are needed to say anything about the order. */
  thin: boolean;
  /** The oldest time the items cover (ms). */
  since: number;
  /** Items in the wave, and items left out because their date has no time of day. */
  mentions: number; dateOnly: number;
  arrivals: KindArrival[];
}
export interface FirstOptions { /** The oldest time the items cover. */ since: number; /** Hide titles, links and names (the Signal does not show its sources). */ hide: boolean }

/**
 * The order the kinds of source had a topic in. It looks at the latest wave only: mentions that follow a quiet stretch (QUIET_MS, the rule of Who Said It First), up to WAVE_MS after the start.
 * Dates with no time of day are left out, as there. `arrivals` are in order of arrival; a kind that arrives within TIE_MS of the start is "first" together with the others that do.
 * This is an order among the sources we follow, by publication time. It does not say where a story began.
 */
export function firstByKind(items: Array<Pick<EvItem, 'kind' | 'ts' | 'title' | 'url' | 'by' | 'source'>>, o: FirstOptions): TopicFirst {
  const dateOnly = items.filter((i) => i.kind !== 'arxiv' && isDateOnly(i.ts)).length;
  const mine = items.filter((i) => i.kind !== 'arxiv' && i.ts > 0 && !isDateOnly(i.ts)).sort((a, b) => a.ts - b.ts || a.kind.localeCompare(b.kind));
  const none: TopicFirst = { onset: null, openEnded: false, thin: false, since: o.since, mentions: 0, dateOnly, arrivals: [] };
  if (!mine.length) return none;
  let start = mine.length - 1;   // walk back from the newest item to the start of its wave
  while (start > 0 && mine[start].ts - mine[start - 1].ts < QUIET_MS) start--;
  const onset = mine[start].ts, wave = mine.slice(start).filter((i) => i.ts < onset + WAVE_MS), by = new Map<EvKind, KindArrival>();
  for (const i of wave) {
    const have = by.get(i.kind);
    if (have) have.n++;
    else by.set(i.kind, { kind: i.kind, ts: i.ts, lag: i.ts - onset, n: 1, ...(o.hide ? {} : { item: { title: i.title, url: i.url, by: i.by, source: i.source } }) });
  }
  return { onset, openEnded: onset - QUIET_MS < o.since, thin: wave.length < MIN_MENTIONS, since: o.since, mentions: wave.length, dateOnly, arrivals: [...by.values()] };
}

/** "1 h 28 min", "3 days 4 h": a gap in words. */
export function lagWords(ms: number): string {
  const m = Math.round(ms / MIN), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (m < 1) return 'at once';
  if (m < 60) return `${m} min`;
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${d} days${h % 24 ? ` ${h % 24} h` : ''}`;
}
const pad2 = (n: number) => String(n).padStart(2, '0');
/** "7 Nov 09:12 UTC": a moment in words (always UTC, so the page reads the same everywhere and caches once). */
export function stampUtc(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}
/** Hours and minutes only, for a line that already gave the day. */
const clock = (ts: number) => `${pad2(new Date(ts).getUTCHours())}:${pad2(new Date(ts).getUTCMinutes())}`;

/**
 * The order in one plain sentence: "First seen on Hacker News (7 Nov 09:12 UTC), then X from 10:40, blogs and news from 14:00." Empty when there is nothing to say.
 * Kinds that arrived together say so. A single kind says that and no more.
 */
export function firstSentence(f: TopicFirst): string {
  if (!f.arrivals.length || f.onset === null) return '';
  const tied = f.arrivals.filter((a) => a.lag <= TIE_MS), later = f.arrivals.filter((a) => a.lag > TIE_MS);
  const names = (l: KindArrival[]) => l.map((a) => KIND_WORDS[a.kind]).join(' and ');
  if (f.arrivals.length === 1) return `Only ${KIND_WORDS[f.arrivals[0].kind]} has had it (from ${stampUtc(f.arrivals[0].ts)}).`;
  const head = tied.length > 1 ? `First seen on ${names(tied)} together (${stampUtc(f.onset)})` : `First seen on ${names(tied)} (${stampUtc(f.onset)})`;
  return `${head}${later.length ? ', then ' + later.map((a) => `${KIND_WORDS[a.kind]} from ${clock(a.ts)}${new Date(a.ts).getUTCDate() !== new Date(f.onset!).getUTCDate() ? ` on ${stampUtc(a.ts).slice(0, -10).trim()}` : ''}`).join(', ') : ''}.`;
}
/** What the order does and does not tell, to put beside it. */
export function firstCaveat(f: TopicFirst): string {
  const bits = ['This is the order among the sources we follow, by publication time. It does not say where the story began.'];
  if (f.openEnded) bits.push('The topic was already being talked about when our history starts, so "first" is the first of what we have.');
  if (f.thin) bits.push('There are only a few mentions, so the order may be chance.');
  if (f.dateOnly) bits.push(`${f.dateOnly} ${f.dateOnly === 1 ? 'item' : 'items'} with a date but no time of day ${f.dateOnly === 1 ? 'is' : 'are'} left out.`);
  return bits.join(' ');
}
/** A first order restricted to a window (days back from `now`): the wave has to have begun inside it, or the answer says it began earlier. */
export function startedWithin(f: TopicFirst, days: number, now: number): boolean { return f.onset !== null && f.onset >= now - days * 24 * HOUR; }

// ---- the timeline
export interface TimelineDot {
  kind: EvKind;
  /** The middle of its time slot (ms), and the position on the line, 0 at the start and 1 at the end. */
  ts: number; x: number;
  /** Items of this kind in the slot. */
  n: number;
  /** The one worth naming: the most reacted of the slot. Only on a Signal that shows its sources. */
  item?: FirstRef & { ts: number };
}
export interface TimelineOptions { from: number; to: number; /** Slots on the line. */ slots?: number; hide: boolean }
const weightOf = (i: Pick<EvItem, 'likes' | 'replies' | 'views'>) => Math.max(0, i.likes) + 2 * Math.max(0, i.replies) + Math.max(0, i.views) / 100;

/**
 * Items over time as dots on one line: the period is cut into slots, and each kind of source has at most one dot per slot, standing for its items there (`n`),
 * named by the most reacted one. A burst of fifty posts is one dot with a number, not fifty dots on top of each other. Dots come out in time order, kinds in a fixed order within a slot.
 */
export function timelineDots(items: EvItem[], o: TimelineOptions): TimelineDot[] {
  const slots = Math.max(4, o.slots ?? 42), span = Math.max(1, o.to - o.from), cell = new Map<string, { kind: EvKind; slot: number; n: number; best: EvItem }>();
  for (const i of items) {
    if (i.kind === 'arxiv' || i.ts < o.from || i.ts > o.to) continue;
    const slot = Math.min(slots - 1, Math.floor(((i.ts - o.from) / span) * slots)), key = `${slot}|${i.kind}`, c = cell.get(key);
    if (!c) cell.set(key, { kind: i.kind, slot, n: 1, best: i });
    else { c.n++; if (weightOf(i) > weightOf(c.best) || (weightOf(i) === weightOf(c.best) && i.ts < c.best.ts)) c.best = i; }
  }
  return [...cell.values()].sort((a, b) => a.slot - b.slot || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)).map((c) => ({
    kind: c.kind, ts: Math.round(o.from + ((c.slot + 0.5) / slots) * span), x: +((c.slot + 0.5) / slots).toFixed(4), n: c.n,
    ...(o.hide ? {} : { item: { title: c.best.title, url: c.best.url, by: c.best.by, source: c.best.source, ts: c.best.ts } }),
  }));
}
/** The busiest slot of each kind, in words, as the text equivalent of the timeline ("Hacker News: busiest 7 Nov, 12 items"). */
export function timelineWords(dots: TimelineDot[]): string[] {
  const out: string[] = [];
  for (const k of KIND_ORDER) {
    const of = dots.filter((d) => d.kind === k);
    if (!of.length) continue;
    const total = of.reduce((n, d) => n + d.n, 0), top = of.reduce((a, d) => (d.n > a.n ? d : a));
    out.push(`${KIND_TITLE[k]}: ${total} ${total === 1 ? 'item' : 'items'}${of.length > 1 ? `, most around ${stampUtc(top.ts).slice(0, -10).trim()} (${top.n})` : ` around ${stampUtc(top.ts).slice(0, -10).trim()}`}`);
  }
  return out;
}

// ---- watch
export interface TopicWatch { video: string; title: string; url: string; source: string; by: string; ts: number; views?: number; /** Where it was found: the Signal's own YouTube channels, or the title of a feed page. */ via: string }
/** The YouTube id in a watch or short link, or ''. */
export function videoId(url: string): string {
  const m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i.exec(String(url ?? '').trim());
  return m ? m[1] : '';
}
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether a title names the topic: any of its names as whole words (the way papers are matched). */
export function namesIn(title: string, names: string[]): boolean {
  const t = title.toLowerCase();
  return names.map((n) => n.toLowerCase().trim()).filter((n) => n.length >= 3).some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(n)}($|[^\\p{L}\\p{N}])`, 'u').test(t));
}
/**
 * Videos and talks on a topic: the Signal's own YouTube items for it, then matches from the public feed pages (a title that names the topic). One entry per video; the most viewed
 * (or reacted) first, then the newest. `via` says where each came from, so the page can say "from the channels we follow" and name the feed page.
 */
export function pickWatch(own: Array<Omit<TopicWatch, 'video' | 'via'>>, feeds: Array<{ via: string; title: string; url: string; source: string; by: string; ts: number; reactions: number; video?: string }>, names: string[], max = 12): TopicWatch[] {
  const seen = new Map<string, TopicWatch>();
  for (const i of own) { const video = videoId(i.url); if (video && !seen.has(video)) seen.set(video, { ...i, video, via: 'Signal' }); }
  for (const f of feeds) {
    const video = f.video || videoId(f.url);
    if (!video || seen.has(video) || !namesIn(f.title, names)) continue;
    seen.set(video, { video, title: f.title, url: f.url, source: f.source, by: f.by, ts: f.ts, ...(f.reactions > 0 ? { views: f.reactions } : {}), via: f.via });
  }
  return [...seen.values()].sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || b.ts - a.ts).slice(0, max);
}
