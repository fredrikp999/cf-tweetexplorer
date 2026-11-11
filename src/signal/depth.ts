// The Depth chart ("what is rising, before it is news"): a cross-section of water. The surface is where a topic is everywhere (every kind of source, most groups, many sources),
// the deep is where it lives in one place only. Each topic is a bubble at the depth of its breadth, and its path over the last 14 days shows whether it is rising.
// Pure functions (no Worker APIs), so Node can test them. The Monitor counts which sources mentioned each topic on each day (`/mon/depth-public`), `depthLayout` turns the counts into
// breadth and positions, and the view (src/apps/depth.ts) only draws. No model is involved.
// Depth is breadth, never loudness: how much of what is watched had the topic, not how many reactions it got. The parts of the number are always given beside it.

export const DEPTH_W = 1000, DEPTH_H = 560;
/** The water: breadth 1 is drawn at SURFACE_Y, breadth 0 at FLOOR_Y. */
export const SURFACE_Y = 90, FLOOR_Y = DEPTH_H - 34;
export const DEPTH_DAYS = 14, DEPTH_TOPICS = 24;
/** A day's breadth looks at this many days ending on it: one quiet day does not sink a topic. */
export const DEPTH_WINDOW = 3;
/** A climb compares today with this many days ago. */
export const CLIMB_SPAN = 4;
/** The least climb worth naming. */
export const MIN_CLIMB = 0.08;
const R_MIN = 11, R_MAX = 40, GAP = 3, EDGE = 8;

export type Zone = 'surface' | 'mid' | 'deep';
export const ZONE_LABEL: Record<Zone, string> = { surface: 'At the surface', mid: 'Mid-water', deep: 'In the deep' };
/** Where the zones meet, as breadth. */
export const ZONE_SURFACE = 0.66, ZONE_MID = 0.4;
export const zoneOf = (breadth: number): Zone => (breadth >= ZONE_SURFACE ? 'surface' : breadth >= ZONE_MID ? 'mid' : 'deep');

/** How much had a topic: kinds of source, groups of sources and single sources. */
export interface Reach { kinds: number; groups: number; sources: number }

/**
 * Breadth, 0 to 1: the mean of the share of the kinds of source that had the topic, the share of the groups, and the share of the sources (on a log scale: the step from one source
 * to five says more than from 100 to 105). A part with only one thing to reach says nothing and is left out. 0 when no source had it.
 */
export function breadthOf(r: Reach, all: Reach): number {
  if (r.sources <= 0) return 0;
  const parts: number[] = [];
  if (all.kinds > 1) parts.push(Math.min(1, r.kinds / all.kinds));
  if (all.groups > 1) parts.push(Math.min(1, r.groups / all.groups));
  if (all.sources > 1) parts.push(Math.min(1, Math.log(1 + r.sources) / Math.log(1 + all.sources)));
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1;
}

/** One point of a topic's path: which kinds had it (a bit per kind, in the order of `kinds`), how many groups and sources, and the mentions, over the days the point looks at. */
export interface ReachPoint { k: number; g: number; s: number; m: number }

/**
 * A topic's reach on each of the last `n` days. `daily` is one entry per day, oldest first, each a list of [source, mentions]; it starts `window - 1` days before the first day asked for.
 * `info` says which kind and group a source is; a source it does not know is left out.
 */
export function reachSeries(daily: Array<Array<[string, number]>>, info: Map<string, { kind: string; group: string }>, kinds: string[], n = DEPTH_DAYS, window = DEPTH_WINDOW): ReachPoint[] {
  const out: ReachPoint[] = [], lead = daily.length - n;
  for (let d = 0; d < n; d++) {
    const src = new Set<string>(), grp = new Set<string>();
    let k = 0, m = 0;
    for (let i = Math.max(0, d + lead - window + 1); i <= d + lead; i++) for (const [w, c] of daily[i] ?? []) {
      const x = info.get(w);
      if (!x || !(c > 0)) continue;
      src.add(w); grp.add(x.group); m += c;
      const bit = kinds.indexOf(x.kind);
      if (bit >= 0) k |= 1 << bit;
    }
    out.push({ k, g: grp.size, s: src.size, m });
  }
  return out;
}
const bits = (v: number): number => { let c = 0; for (let x = v; x; x >>= 1) c += x & 1; return c; };

/** How far a topic rose: breadth now against `span` days ago (not there then counts as 0). */
export function climbOf(breadth: number[], span = CLIMB_SPAN): { from: number; to: number; rise: number } {
  const to = breadth[breadth.length - 1] ?? 0, from = breadth[Math.max(0, breadth.length - 1 - span)] ?? 0;
  return { from, to, rise: to - from };
}

export interface DepthIn { key: string; label: string; score: number; reach: ReachPoint[] }
export interface DepthTopic {
  key: string; label: string; score: number; r: number;
  /** The first day (an index) it was there in the days shown; the picture puts the ones around longest to the left. */
  first: number;
  /** Per day: breadth (0 to 1, two decimals more than the eye needs), and where the bubble is; null on a day no source had it. */
  b: number[]; x: Array<number | null>; y: Array<number | null>;
  k: number[]; g: number[]; s: number[]; m: number[];
  rise: number;
}
export interface DepthLayout {
  w: number; h: number; surfaceY: number; floorY: number; window: number; span: number;
  kinds: string[]; watched: Reach; topics: DepthTopic[];
  /** The keys of the steepest climbs, steepest first (at most five, each at least MIN_CLIMB). */
  rising: string[];
}

const yOf = (b: number): number => FLOOR_Y - b * (FLOOR_Y - SURFACE_Y);
const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Breadth, size and a place for every topic on every day. Depth is exact; sideways a topic has a slot (the ones around longest to the left, the newest to the right) and is nudged from it
 * only as far as it must so bubbles do not overlap. The same input gives the same picture.
 */
export function depthLayout(topics: DepthIn[], kinds: string[], watched: Reach): DepthLayout {
  const n = Math.max(0, ...topics.map((t) => t.reach.length)), max = Math.max(1e-9, ...topics.map((t) => t.score));
  const made: DepthTopic[] = topics.map((t) => {
    const b = t.reach.map((p) => breadthOf({ kinds: bits(p.k), groups: p.g, sources: p.s }, watched)), first = b.findIndex((v) => v > 0);
    return { key: t.key, label: t.label, score: t.score, r: round1(R_MIN + (R_MAX - R_MIN) * Math.sqrt(Math.max(0, t.score) / max)), first: first < 0 ? n : first,
      b: b.map((v) => Math.round(v * 1000) / 1000), x: b.map(() => null), y: b.map((v) => (v > 0 ? round1(yOf(v)) : null)),
      k: t.reach.map((p) => p.k), g: t.reach.map((p) => p.g), s: t.reach.map((p) => p.s), m: t.reach.map((p) => p.m), rise: Math.round(climbOf(b).rise * 1000) / 1000 };
  });
  // slots: around longest first, then the bigger, then by name, so a topic keeps its place from day to day
  const order = [...made].sort((a, c) => a.first - c.first || c.score - a.score || (a.key < c.key ? -1 : 1));
  const slot = new Map(order.map((t, i) => [t.key, EDGE + R_MAX + ((i + 0.5) / order.length) * (DEPTH_W - 2 * (EDGE + R_MAX))] as const));
  const rank = new Map(order.map((t, i) => [t.key, i] as const));
  let before = new Map<string, number>();
  for (let d = 0; d < n; d++) {
    const here = order.filter((t) => t.y[d] !== null), xs = new Map(here.map((t) => [t.key, before.get(t.key) ?? slot.get(t.key)!] as const));
    for (let it = 0; it < 80; it++) {
      let moved = 0;
      for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) {
        const a = here[i], c = here[j], need = a.r + c.r + GAP, dy = Math.abs(a.y[d]! - c.y[d]!);
        if (dy >= need) continue;
        const want = Math.sqrt(need * need - dy * dy), xa = xs.get(a.key)!, xc = xs.get(c.key)!, cur = Math.abs(xa - xc);
        if (cur >= want) continue;
        const left = xa < xc || (xa === xc && rank.get(a.key)! < rank.get(c.key)!), push = (want - cur) / 2;
        xs.set(a.key, xa + (left ? -push : push)); xs.set(c.key, xc + (left ? push : -push));
        moved += push;
      }
      for (const t of here) {   // a pull back to the slot, and the walls
        const x = xs.get(t.key)!, pulled = x + (slot.get(t.key)! - x) * 0.04;
        xs.set(t.key, Math.min(DEPTH_W - EDGE - t.r, Math.max(EDGE + t.r, pulled)));
      }
      if (moved < 0.05) break;
    }
    for (const t of here) t.x[d] = round1(xs.get(t.key)!);
    before = xs;
  }
  const rising = made.filter((t) => t.rise >= MIN_CLIMB && (t.b[n - 1] ?? 0) > 0).sort((a, c) => c.rise - a.rise || c.score - a.score || (a.key < c.key ? -1 : 1)).slice(0, 5).map((t) => t.key);
  return { w: DEPTH_W, h: DEPTH_H, surfaceY: SURFACE_Y, floorY: FLOOR_Y, window: DEPTH_WINDOW, span: CLIMB_SPAN, kinds, watched, topics: made, rising };
}

export const KIND_NAME: Record<string, string> = { x: 'X', hn: 'Hacker News', youtube: 'YouTube', rss: 'blogs and news', arxiv: 'arXiv' };
/** A point's reach in words: "on X and Hacker News (2 of 4 kinds of source), 3 of 5 groups, 14 of 150 sources". */
export function reachWords(p: ReachPoint, kinds: string[], all: Reach): string {
  if (!p.s) return 'no source had it';
  const names = kinds.filter((_, i) => p.k & (1 << i)).map((k) => KIND_NAME[k] ?? k);
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] ?? 'one kind of source';
  return `on ${list} (${names.length} of ${all.kinds} kind${all.kinds === 1 ? '' : 's'} of source), ${p.g} of ${all.groups} group${all.groups === 1 ? '' : 's'}, ${p.s} of ${all.sources} source${all.sources === 1 ? '' : 's'}`;
}
