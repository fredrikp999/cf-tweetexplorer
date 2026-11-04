// Finding a good "at least N likes" for an X list, without any storage or network. X's Top order is not a sort by likes: the most liked post of a list can
// sit past the first page. But if fewer posts qualify than the pages hold, all of them come back and the order stops mattering. So the setting to look for
// is the lowest one where a list fits within its pages: every post above it is read, and only those are paid for.
// Imported by the Durable Object and by the tests, so: `.ts` extensions, and no TypeScript-only runtime syntax.

export const LIKE_RUNGS = [0, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
export const MAX_MIN_FAVES = 50000;
/** A group shares one setting, so waiting for its busiest list would starve the rest: this share of its lists may still go over. */
export const OVER_ALLOWED = 0.2;
/** A list with fewer posts than this in a run has little left to say. */
export const THIN_POSTS = 5;
const TWEET_PRICE = 0.00015;
/** A binary search over the rungs reads at most this many times. The first read may be a guess from history, so it can take one more. */
export const MAX_CHECKS = Math.ceil(Math.log2(LIKE_RUNGS.length)) + 1;

export const countAtLeast = (likes: number[], min: number): number => likes.filter((l) => l >= min).length;
/** The most a live check can spend on these lists: every read returning full pages. */
export const worstCost = (lists: number, pages: number): number => lists * MAX_CHECKS * pages * 20 * TWEET_PRICE;

/** A read that cannot be finished (the budget ran out) answers null. */
export type LikesCheck = (minFaves: number) => Promise<number[] | null>;
export interface Fit {
  /** The lowest rung that fits within the limit; null if none was found. */
  fit: number | null;
  /** The likes of every post at that rung: all of them, because it fits. So the count at any higher rung is known too. */
  likes: number[];
  /** False when the search stopped early, so a lower rung might also have fit. */
  complete: boolean;
}
/** Binary search for the lowest rung with fewer posts than `limit`. A full read also shows some higher rungs cannot fit, which saves reads. */
export async function findFit(check: LikesCheck, limit: number, start?: number): Promise<Fit> {
  let lo = 0, hi = LIKE_RUNGS.length - 1, fit: number | null = null, likes: number[] = [], next = start !== undefined ? Math.min(hi, Math.max(lo, start)) : undefined;
  while (lo <= hi) {
    const mid = next ?? (lo + hi) >> 1;
    next = undefined;
    const got = await check(LIKE_RUNGS[mid]);
    if (!got) return { fit, likes, complete: false };
    if (got.length < limit) { fit = LIKE_RUNGS[mid]; likes = got; hi = mid - 1; continue; }
    lo = mid + 1;
    while (lo <= hi && countAtLeast(got, LIKE_RUNGS[lo]) >= limit) lo++;
  }
  return { fit, likes, complete: true };
}

export interface LikeRow { minFaves: number; /** Posts a run across the lists: what would be bought. */ posts: number; cost: number; /** Lists that would still be cut off by their pages. */ over: number; /** Lists left with very few posts. */ thin: number }
export interface LiveList { fit: number | null; likes: number[] }

/** What each rung would buy, from live checks. Below a list's fit it fills its pages; at or above it the count is exact. */
export function liveRows(lists: LiveList[], limit: number): LikeRow[] {
  return LIKE_RUNGS.map((minFaves) => {
    let posts = 0, over = 0, thin = 0, cost = 0;
    for (const l of lists) {
      const fits = l.fit !== null && minFaves >= l.fit, n = fits ? countAtLeast(l.likes, minFaves) : limit;
      posts += n; cost += Math.max(1, n) * TWEET_PRICE;
      if (!fits) over++;
      if (n < THIN_POSTS) thin++;
    }
    return { minFaves, posts, cost, over, thin };
  });
}

export interface StoredList {
  /** The likes threshold the list was read with: lower rungs say nothing, those posts were never bought. */
  floor: number;
  /** The likes of the posts each past run bought, one array per run. */
  runs: number[][];
}
/** What each rung would have kept of the posts already collected. Null where the history cannot say. The posts past the page limit were never seen, so a count is a minimum. */
export function historyRows(lists: StoredList[], limit: number): Array<LikeRow | null> {
  const known = lists.filter((l) => l.runs.length);
  return LIKE_RUNGS.map((minFaves) => {
    if (!known.length || known.some((l) => minFaves < l.floor)) return null;
    let posts = 0, over = 0, thin = 0, cost = 0;
    for (const l of known) {
      const avg = l.runs.reduce((sum, run) => sum + countAtLeast(run, minFaves), 0) / l.runs.length;
      posts += avg; cost += Math.max(1, avg) * TWEET_PRICE;
      if (avg >= limit) over++;
      if (avg < THIN_POSTS) thin++;
    }
    return { minFaves, posts: Math.round(posts), cost, over, thin };
  });
}

/** The lowest rung where nearly every list fits and something is left to read. */
export function propose(rows: Array<LikeRow | null>, lists: number): number | null {
  const allowed = Math.floor(lists * OVER_ALLOWED);
  return rows.find((r) => r && r.posts > 0 && r.over <= allowed)?.minFaves ?? null;
}

/** Where the live search for one list should start: the lowest rung its history says fits. A minimum, so the search can still go either way. */
export function startFrom(list: StoredList | undefined, limit: number): number | undefined {
  if (!list?.runs.length) return undefined;
  const i = LIKE_RUNGS.findIndex((min) => min >= list.floor && list.runs.reduce((sum, run) => sum + countAtLeast(run, min), 0) / list.runs.length < limit);
  return i < 0 ? undefined : i;
}
