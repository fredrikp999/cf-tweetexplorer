// Pictures that filter the lists (A5): which day, which kind of source and which order a topic's item list is shown in. Pure functions (no Worker APIs), so Node can test them.
// The topic page reads `?day=`, `?kind=` and `?sort=`, the MCP tool `get_topic_items` the same three; both ask the Monitor, which calls brushItems() on the items of the topic.
// Every list is ordered within one kind of source, so likes, points and views are never ranked against each other (section 7 of INTENT.md).
import type { EvKind } from './topicpage.ts';

/** The kinds of source that have items in the Talk list (papers have their own angle). */
export const BRUSH_KINDS: EvKind[] = ['x', 'hn', 'youtube', 'rss'];
export type BrushSort = 'reacted' | 'newest' | 'earliest' | 'accounts';
export const SORT_LABEL: Record<BrushSort, string> = { reacted: 'Most reacted', newest: 'Newest', earliest: 'Earliest in the wave', accounts: 'Most from one account' };
export const BRUSH_SORTS = Object.keys(SORT_LABEL) as BrushSort[];
/** What Talk shows when nothing is chosen: the most reacted of each kind. */
export const DEFAULT_SORT: BrushSort = 'reacted';
/** Items shown per kind: the usual few, or more when a day or a kind narrows the list. */
export const TALK_CAP = 8, TALK_CAP_NARROW = 20;

export interface Brush { day?: string; kind?: EvKind; sort: BrushSort }
/** The same, as asked for (anything not understood is simply left out). */
export interface BrushAsk { day?: string | null; kind?: string | null; sort?: string | null }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The `n` UTC days ending at `now`, oldest first, as YYYY-MM-DD. */
export function recentDays(now: number, n: number): string[] { return Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10)); }
/** The UTC day of a time in milliseconds. */
export const dayOfTs = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

/** A sort word as the site and the MCP tool say it (`new` and `top` are the older names of the tool). Anything else gives `fallback`. */
export function parseSort(v: string | null | undefined, fallback: BrushSort = DEFAULT_SORT): BrushSort {
  const s = String(v ?? '').toLowerCase();
  if (s === 'new') return 'newest';
  if (s === 'top') return 'reacted';
  return (BRUSH_SORTS as string[]).includes(s) ? (s as BrushSort) : fallback;
}
/**
 * The filter in an address, checked strictly: a day only in `<YYYY-MM-DD>` form and one of `days` (the days the topic has items for), a kind only one Talk has, a sort only one of the four.
 * What is not valid is dropped, so a wrong address gives the plain list, never an error.
 */
export function parseBrush(ask: BrushAsk, days: string[], fallbackSort: BrushSort = DEFAULT_SORT): Brush {
  const day = String(ask.day ?? ''), kind = String(ask.kind ?? '');
  return { ...(DAY.test(day) && days.includes(day) ? { day } : {}), ...(BRUSH_KINDS.includes(kind as EvKind) ? { kind: kind as EvKind } : {}), sort: parseSort(ask.sort, fallbackSort) };
}
/** The query parameters that say this filter (the default order is left out), for building addresses. */
export function brushParams(b: Brush, fallbackSort: BrushSort = DEFAULT_SORT): Array<[string, string]> {
  return [...(b.day ? [['day', b.day] as [string, string]] : []), ...(b.kind ? [['kind', b.kind] as [string, string]] : []), ...(b.sort !== fallbackSort ? [['sort', b.sort] as [string, string]] : [])];
}

/** What an item needs to be filtered and ordered. A number of -1 or undefined was not recorded. */
export interface BrushItem { kind: EvKind; by: string; ts: number; likes?: number; replies?: number; views?: number }
/** How much reaction an item has in its own unit: likes (points on Hacker News), replies counted twice, views a hundredth. Only comparable within one kind. */
export const weightOf = (i: BrushItem): number => Math.max(0, i.likes ?? 0) + 2 * Math.max(0, i.replies ?? 0) + Math.max(0, i.views ?? 0) / 100;

/** One kind's items in the order asked for. `accounts`: the accounts with most items first, each account's items together (an item without an author stands alone). */
export function sortItems<T extends BrushItem>(items: T[], sort: BrushSort): T[] {
  const byReaction = (a: T, b: T) => weightOf(b) - weightOf(a) || b.ts - a.ts;
  if (sort === 'newest') return [...items].sort((a, b) => b.ts - a.ts);
  if (sort === 'earliest') return [...items].sort((a, b) => a.ts - b.ts);
  if (sort === 'accounts') {
    const key = (i: T, n: number) => (i.by.trim() ? i.by.trim().toLowerCase() : `\u0000${n}`), keys = items.map(key), count = new Map<string, number>();
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
    return items.map((it, n) => ({ it, k: keys[n] })).sort((a, b) => (count.get(b.k)! - count.get(a.k)!) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0) || byReaction(a.it, b.it)).map((x) => x.it);
  }
  return [...items].sort(byReaction);
}

export interface Brushed<T> { /** The items to show: the kinds in their usual order, each ordered within itself and cut to `cap`. */ items: T[]; /** How many items match, per kind, before the cut. */ counts: Partial<Record<EvKind, number>>; /** Matching items in all. */ total: number }
/**
 * Narrow to a day and a kind, then order each kind within itself (never across kinds) and keep `cap` of each. Without a cap, all of them.
 */
export function brushItems<T extends BrushItem>(items: T[], b: Brush, cap = Infinity): Brushed<T> {
  const counts: Partial<Record<EvKind, number>> = {}, out: T[] = [];
  let total = 0;
  for (const k of BRUSH_KINDS) {
    if (b.kind && b.kind !== k) continue;
    const of = items.filter((i) => i.kind === k && (!b.day || dayOfTs(i.ts) === b.day));
    if (!of.length) continue;
    counts[k] = of.length; total += of.length;
    out.push(...sortItems(of, b.sort).slice(0, cap));
  }
  return { items: out, counts, total };
}

/** A sentence that says how the lists are ordered, and why they never mix units. Empty for the default order. */
export function sortNote(sort: BrushSort): string {
  const unit = 'Each kind of source is ordered by itself: likes, points and views are never ranked against each other.';
  if (sort === 'newest') return `Newest first. ${unit}`;
  if (sort === 'earliest') return `Oldest first, to show who was early in the wave. ${unit}`;
  if (sort === 'accounts') return `The accounts with most items here come first, each account’s items together. ${unit}`;
  return `Most reacted first. ${unit}`;
}
