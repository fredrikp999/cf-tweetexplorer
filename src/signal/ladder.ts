// The Ladder: the rank of the biggest topics on each of the last 14 days, one line per topic (a bump chart). Where the streamgraph shows how much, this shows the order,
// and since when: who climbed, who was overtaken, who dropped out.
// Pure functions (no Worker APIs), so Node can test them. The Monitor counts each topic's mentions and each group's items per day (`/mon/ladder-public`); here they become a score per day
// by the rule Signal itself uses (src/signal/score.ts), then a rank. No model is involved.
import { SMOOTH } from './score.ts';

export const LADDER_DAYS = 14, LADDER_TOP = 15;
/** A day's score looks at this many days ending on it, so one quiet day does not throw a topic off the ladder. */
export const LADDER_WINDOW = 3;
/** How many topics are scored each day: the ones that could be on the ladder. */
export const LADDER_POOL = 40;
/** Rank now against this many days ago, for "up 5 in a week". */
export const LADDER_SPAN = 7;

/**
 * A topic's Signal score on each of the last `n` days: the share of each group's items that mention it over the days the point looks at, averaged over the groups by weight.
 * `mentions[g]` and `items[g]` are per day, oldest first, and start `window - 1` days before the first day asked for. A group with no items in those days is left out of that day's average.
 */
export function dayScores(mentions: number[][], items: number[][], weights: number[], n = LADDER_DAYS, window = LADDER_WINDOW): number[] {
  const len = Math.max(0, ...items.map((r) => r.length)), lead = len - n, out: number[] = [];
  for (let d = 0; d < n; d++) {
    let sum = 0, wsum = 0;
    for (let g = 0; g < weights.length; g++) {
      if (!(weights[g] > 0)) continue;
      let m = 0, it = 0;
      for (let i = Math.max(0, d + lead - window + 1); i <= d + lead; i++) { m += mentions[g]?.[i] ?? 0; it += items[g]?.[i] ?? 0; }
      if (it <= 0) continue;
      sum += weights[g] * (m / (it + SMOOTH)); wsum += weights[g];
    }
    out.push(wsum ? sum / wsum : 0);
  }
  return out;
}

export interface LadderTopic {
  key: string; label: string;
  /** The rank on each day, 1 first; null on a day it was not among the top. */
  rank: Array<number | null>;
  /** The score on each day (four decimals). */
  score: number[];
  /** Its best rank in the days shown, and the first day it was on the ladder. */
  best: number; first: number;
}
export interface Ladder { top: number; span: number; window: number; topics: LadderTopic[] }

/**
 * The ladder: each day the topics are ranked by that day's score (a score of nothing has no rank; ties go to the name, so the same counts give the same order), and the first `top` are on it.
 * Only topics that were on it some day are kept, today's order first, then the ones that dropped out by their best rank.
 */
export function ladderOf(topics: Array<{ key: string; label: string; scores: number[] }>, top = LADDER_TOP): Ladder {
  const n = Math.max(0, ...topics.map((t) => t.scores.length)), rank = new Map(topics.map((t) => [t.key, new Array<number | null>(n).fill(null)] as const));
  for (let d = 0; d < n; d++) {
    topics.filter((t) => (t.scores[d] ?? 0) > 0).sort((a, b) => b.scores[d] - a.scores[d] || (a.key < b.key ? -1 : 1)).slice(0, top).forEach((t, i) => { rank.get(t.key)![d] = i + 1; });
  }
  const made: LadderTopic[] = topics.map((t) => { const r = rank.get(t.key)!, on = r.filter((x): x is number => x !== null);
    return { key: t.key, label: t.label, rank: r, score: t.scores.map((v) => Math.round(v * 10_000) / 10_000), best: on.length ? Math.min(...on) : 0, first: r.findIndex((x) => x !== null) }; }).filter((t) => t.best > 0);
  const last = (t: LadderTopic) => t.rank[n - 1] ?? Infinity;
  made.sort((a, b) => last(a) - last(b) || a.best - b.best || (a.key < b.key ? -1 : 1));
  return { top, span: LADDER_SPAN, window: LADDER_WINDOW, topics: made };
}

/** How a topic moved: its rank now, and `span` days ago (null: not on the ladder then, or now). `up` is positive when it climbed; null when either end is missing. */
export function moveOf(rank: Array<number | null>, span = LADDER_SPAN): { now: number | null; then: number | null; up: number | null } {
  const now = rank[rank.length - 1] ?? null, then = rank[Math.max(0, rank.length - 1 - span)] ?? null;
  return { now, then, up: now !== null && then !== null ? then - now : null };
}
/** The move in words: "up 5 in 7 days", "new on the ladder", "dropped out", "same place". */
export function moveWords(rank: Array<number | null>, span = LADDER_SPAN): string {
  const m = moveOf(rank, span), days = Math.min(span, rank.length - 1);
  if (m.now === null) return 'dropped out';
  if (m.then === null) return 'new on the ladder';
  return m.up === 0 ? 'same place' : `${m.up! > 0 ? 'up' : 'down'} ${Math.abs(m.up!)} in ${days} days`;
}
