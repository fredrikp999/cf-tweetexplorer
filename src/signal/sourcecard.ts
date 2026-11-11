// The source card /t/<topic>/i/<item>: level 3 of INTENT.md, one item with what only this site knows (why it is in the topic, its place in the wave, its neighbours in time).
// Pure functions (no Worker APIs), so Node can test them. The Monitor Durable Object gathers the pool of the topic's items and the extras (`/mon/topic-item-public`),
// src/site/public.ts draws the page, src/site/agentText.ts words it for the `get_item` tool. The id is also put on the items of the topic data, so a list can link to the card.
import { QUIET_MS, isDateOnly } from './first.ts';
import type { Area } from './area.ts';
import { ITEM_ID, itemHref, itemId } from './itemid.ts';
import { roughly, type EvItem, type EvKind } from './topicpage.ts';
import { lagWords, stampUtc } from './topicview.ts';

// ---- the id (src/signal/itemid.ts, kept apart so the topic data can use it without this file)
export { ITEM_ID, itemHref, itemId };

// ---- where it stands in time
const ordinal = (n: number): string => { const t = n % 100, o = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'; return `${n}${o}`; };
/** An item that can be placed in time: it has a time of day. */
const timed = (i: { ts: number }): boolean => i.ts > 0 && !isDateOnly(i.ts);
/** The topic's items in time order, oldest first (equal times by id, so the order never changes between requests). Only those with an id: the card is the link. */
export function inTimeOrder<T extends { ts: number; id?: string }>(items: T[]): T[] {
  const seen = new Set<string>(), out: T[] = [];
  for (const i of [...items].filter((x) => x.id).sort((a, b) => a.ts - b.ts || (a.id! < b.id! ? -1 : 1))) if (!seen.has(i.id!)) { seen.add(i.id!); out.push(i); }
  return out;
}

export interface WavePlace {
  /** 1 for the item that opened the wave. */ rank: number; /** Items in the wave. */ size: number;
  /** How long after the first item of the wave (ms); 0 for the first. */ lag: number; /** When the wave began. */ start: number;
}
/**
 * Where an item stands in the wave it belongs to: the run of items with no gap of QUIET_MS (the rule of Who Said It First) between them, among the topic's items in time order.
 * Null when the item has only a date, no time of day (it cannot be placed), or is not in the list.
 */
export function placeInWave(sorted: Array<{ ts: number; id?: string }>, id: string): WavePlace | null {
  const all = sorted.filter(timed), at = all.findIndex((i) => i.id === id);
  if (at < 0) return null;
  let a = at, b = at;
  while (a > 0 && all[a].ts - all[a - 1].ts < QUIET_MS) a--;
  while (b < all.length - 1 && all[b + 1].ts - all[b].ts < QUIET_MS) b++;
  return { rank: at - a + 1, size: b - a + 1, lag: all[at].ts - all[a].ts, start: all[a].ts };
}
/** "3rd of 12 items in this wave, 40 min after the first", or "the first of 12 items in this wave". Empty when there is no place to give. */
export function placeWords(p: WavePlace | null): string {
  if (!p) return '';
  if (p.size === 1) return 'The only item in its wave of talk.';
  if (p.rank === 1) return `The first of ${p.size} items in this wave of talk, from ${stampUtc(p.start)}.`;
  return `The ${ordinal(p.rank)} of ${p.size} items in this wave of talk, ${lagWords(p.lag)} after the first (${stampUtc(p.start)}).`;
}

export interface Neighbour { id: string; kind: EvKind; title: string; by: string; source: string; ts: number; /** Time between it and this item (ms), always positive. */ gap: number }
const neighbour = (i: EvItem & { id?: string }, from: number): Neighbour => ({ id: i.id!, kind: i.kind, title: i.title, by: i.by, source: i.source, ts: i.ts, gap: Math.abs(i.ts - from) });
/** The item before and the item after, in the topic's time order (null at either end). */
export function neighbours(sorted: Array<EvItem & { id?: string }>, id: string): { before: Neighbour | null; after: Neighbour | null } {
  const at = sorted.findIndex((i) => i.id === id);
  if (at < 0) return { before: null, after: null };
  return { before: at > 0 ? neighbour(sorted[at - 1], sorted[at].ts) : null, after: at < sorted.length - 1 ? neighbour(sorted[at + 1], sorted[at].ts) : null };
}

// ---- reactions, each in the unit of its source
/**
 * The numbers the source gave, as lines, never added into one: X likes, replies and views as rough numbers (they can be inflated), Hacker News points and comments exact, YouTube views as a rough number.
 * A number of -1 was not recorded for that item and is left out. Blogs and news have none.
 */
export function reactionLines(i: Pick<EvItem, 'kind' | 'likes' | 'replies' | 'views'>): string[] {
  const num = (v: number) => v.toLocaleString('en-GB'), out: string[] = [];
  if (i.kind === 'x') {
    if (i.likes >= 0) out.push(`${roughly(i.likes)} ${i.likes === 1 ? 'like' : 'likes'}`);
    if (i.replies > 0) out.push(`${roughly(i.replies)} ${i.replies === 1 ? 'reply' : 'replies'}`);
    if (i.views > 0) out.push(`${roughly(i.views)} views`);
  } else if (i.kind === 'hn') {
    if (i.likes >= 0) out.push(`${num(i.likes)} ${i.likes === 1 ? 'point' : 'points'}`);
    if (i.replies >= 0) out.push(`${num(i.replies)} ${i.replies === 1 ? 'comment' : 'comments'}`);
  } else if (i.kind === 'youtube') {
    if (i.views > 0) out.push(`${roughly(i.views)} views`);
  }
  return out;
}

// ---- why it is here
/** Which of the topic's names the item matched, in a sentence. `matched` are the names (lowercase) the reading of the item gave; empty when the item came in by its title (a video on a public feed page). */
export function whyWords(t: { label: string; term: string; members: string[] }, matched: string[]): string {
  const lead = t.term.toLowerCase(), mine = matched.filter((m) => m === lead || t.members.some((x) => x.toLowerCase() === m));
  if (!mine.length) return `It is here because the topic's names appear in its title.`;
  const list = mine.map((m) => `“${m}”`).join(', ');
  const main = mine.includes(lead);
  if (mine.length === 1) return main ? `Signal's reading of the item named ${list}, the name this topic is listed under.` : `Signal's reading of the item named ${list}, one of the other names counted under ${t.label}.`;
  return `Signal's reading of the item named ${list}, ${main ? 'among them the name this topic is listed under' : `names counted under ${t.label}`}.`;
}

// ---- the card
export interface CardTopic { slug: string; label: string; term: string; members: string[]; area: Area; board: { slug: string; title: string } }
export interface SourceCard {
  id: string; topic: CardTopic;
  item: { kind: EvKind; title: string; url: string; discussionUrl: string; source: string; by: string; ts: number; likes: number; replies: number; views: number };
  reactions: string[];
  why: { matched: string[]; words: string; place: WavePlace | null; placeWords: string; /** How many items the topic has in the window the position is taken among. */ among: number };
  /** Later copies of the same post that were folded into it. Null when that was not checked for this item (it was not read for its meaning). */
  copies: number | null;
  before: Neighbour | null; after: Neighbour | null;
  alsoIn: Array<{ slug: string; label: string }>;
}
/** What the Monitor knows about the item besides the pool: the names it matched, the copies folded into it, the other topics it is in. */
export interface CardExtras { matched?: string[]; copies?: number | null; alsoIn?: Array<{ slug: string; label: string }> }

/** The card for the item with this id, from the topic's pool of items. Null when the pool does not have it. */
export function buildCard(pool: Array<EvItem & { id?: string }>, id: string, topic: CardTopic, extras: CardExtras = {}): SourceCard | null {
  const sorted = inTimeOrder(pool), item = sorted.find((i) => i.id === id);
  if (!item) return null;
  const place = placeInWave(sorted, id), matched = extras.matched ?? [], { before, after } = neighbours(sorted, id);
  return {
    id, topic, item: { kind: item.kind, title: item.title, url: item.url, discussionUrl: item.discussionUrl, source: item.source, by: item.by, ts: item.ts, likes: item.likes, replies: item.replies, views: item.views },
    reactions: reactionLines(item),
    why: { matched, words: whyWords(topic, matched), place, placeWords: timed(item) ? placeWords(place) : 'It has a date but no time of day, so its place in the wave cannot be given.', among: sorted.length },
    copies: extras.copies ?? null, before, after, alsoIn: extras.alsoIn ?? [],
  };
}
