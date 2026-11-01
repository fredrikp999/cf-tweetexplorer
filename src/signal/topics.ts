// Signal topics: a bare word says little ("kimi"), so words that turn up in the same items are merged into one topic and each topic is described by
// the terms that go with it and by the items it comes from. Pure functions (no Worker APIs), so Node can test them.
import type { ScoredTerm } from './score.ts';

/** One item in the window, as the terms it was counted under. */
/** `eng`: how much people reacted to it (likes, replies, points); absent when the source has no such number. */
export interface TopicItem { terms: Set<string>; ts: number; eng?: number }
/** term -> positions of the items that mention it. */
export type Postings = Map<string, number[]>;

export function indexItems(items: TopicItem[]): Postings {
  const post: Postings = new Map();
  items.forEach((it, i) => { for (const t of it.terms) (post.get(t) ?? post.set(t, []).get(t)!).push(i); });
  return post;
}

const jaccard = (a: number[], b: number[]): number => {
  if (!a.length || !b.length) return 0;
  const s = new Set(a); let inter = 0;
  for (const x of b) if (s.has(x)) inter++;
  return inter / (a.length + b.length - inter);
};

export interface Cluster { lead: ScoredTerm; /** The name of the topic: the strongest phrase among its terms, else its strongest word. */ label: string; members: ScoredTerm[] }

/**
 * Terms (strongest first) that appear in mostly the same items become one topic. A term that is in fewer than two items cannot be compared and stands alone.
 * `n` topics at most; the lead is the strongest term of each.
 */
export function mergeTopics(terms: ScoredTerm[], post: Postings, n: number, minJaccard = 0.5): Cluster[] {
  const out: Array<{ lead: ScoredTerm; members: ScoredTerm[] }> = [];
  for (const t of terms) {
    const mine = post.get(t.term) ?? [];
    const home = mine.length >= 2 ? out.find((c) => jaccard(mine, post.get(c.lead.term) ?? []) >= minJaccard) : undefined;
    if (home) home.members.push(t);
    else if (out.length < n) out.push({ lead: t, members: [t] });
  }
  return out.map((c) => {
    const phrase = c.members.find((m) => m.term.includes(' '));   // members are strongest first
    return { lead: c.lead, label: (phrase ?? c.lead).term, members: c.members };
  });
}

/** Terms that go with these ones: they turn up in the same items, and are not common everywhere (so "model" ranks below "moonshot"). */
export function relatedTerms(own: string[], items: TopicItem[], post: Postings, n = 4): string[] {
  const idx = new Set<number>();
  for (const t of own) for (const i of post.get(t) ?? []) idx.add(i);
  if (idx.size < 2) return [];
  const counts = new Map<string, number>();
  for (const i of idx) for (const t of items[i].terms) counts.set(t, (counts.get(t) ?? 0) + 1);
  const parts = own.flatMap((o) => [o, ...o.split(' ')]);
  const overlaps = (t: string) => parts.some((p) => p === t || t.includes(p) || p.includes(t));
  return [...counts]
    .filter(([t, c]) => c >= 2 && !overlaps(t))
    .map(([t, c]) => [t, c * Math.log(1 + items.length / (post.get(t)?.length ?? 1))] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n).map(([t]) => t);
}

/** How much people reacted to the items of a topic, summed over its items. */
export function topicEngagement(own: string[], items: TopicItem[], post: Postings): number {
  const idx = new Set<number>();
  for (const t of own) for (const i of post.get(t) ?? []) idx.add(i);
  let n = 0;
  for (const i of idx) n += items[i].eng ?? 0;
  return n;
}

/**
 * Topics ordered by signal, lifted by reactions: a topic whose items got the most reactions in the window gains up to half again on its signal
 * (on a log scale, so one viral item does not bury everything else). With no reaction data nothing changes.
 */
export function boostByEngagement<T extends { lead: { signal: number } }>(topics: T[], eng: number[]): T[] {
  const top = Math.log1p(Math.max(0, ...eng));
  if (!top) return topics;
  return topics.map((t, i) => [t, t.lead.signal * (1 + 0.5 * Math.log1p(eng[i]) / top)] as const).sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** The items a topic comes from, best first: the ones that carry most of its terms, then the ones people reacted to most, then the newest. Positions in `items`. */
export function topicItems(own: string[], items: TopicItem[], post: Postings, n = 3): number[] {
  const score = new Map<number, number>();
  for (const t of own) for (const i of post.get(t) ?? []) score.set(i, (score.get(i) ?? 0) + 1);
  return [...score].sort((a, b) => b[1] - a[1] || (items[b[0]].eng ?? 0) - (items[a[0]].eng ?? 0) || items[b[0]].ts - items[a[0]].ts).slice(0, n).map(([i]) => i);
}
