// Who Said It First: which source groups tend to carry a topic before the others. Pure functions (no Worker APIs), so Node can test them.
// The Monitor Durable Object (durable-objects/monitor.ts) reads the items; the view is src/apps/first.ts.
//
// Three things would make a naive "earliest mention" meaningless, and each has a rule here:
//  - A topic that is always talked about has no beginning: its "first" mention is whoever posted just after the window opened. So only a wave counts: mentions that follow
//    a quiet gap of QUIET_MS, with enough history before them to know the gap was really quiet.
//  - A group that posts more wins more often by luck. So firsts are compared with chance: if a wave's mentions were shuffled in time, a group would come first with a
//    probability equal to its share of those mentions. A group is called early or late only when it is well away from that.
//  - A date with no time of day (exactly midnight UTC) would look early, and a source added after a wave began would look late. Those are left out.
// The answer is the order among your own sources by publication time. It does not say where a story began.
import type { TopicItem } from './topics.ts';

const HOUR = 3_600_000, DAY = 24 * HOUR;
export const QUIET_MS = 3 * DAY;    // no mention for this long before a wave
export const WAVE_MS = 7 * DAY;     // a mention later than this after the start is not part of the same wave
export const TIE_MS = 30 * 60_000;  // feeds round their times, so arrivals this close to the start count as first together
export const MIN_MENTIONS = 3;      // fewer than this in a wave could be a coincidence of words
export const MIN_JOINED = 8;        // a group needs this many waves before it is called early or late
const CLEAR_Z = 2;                  // how far from chance, in standard deviations, counts as clear

export interface FirstItem extends TopicItem { group: string; watch: string; title: string; url: string; by: string }
export interface FirstTopic { label: string; terms: string[] }
export interface Arrival { group: string; ts: number; lag: number; n: number; watch: string; by: string; title: string; url: string }
export interface Wave { topic: string; terms: string[]; onset: number; mentions: number; arrivals: Arrival[]; absent: string[] }
export interface FindOptions {
  /** A wave has to start at or after this. */
  from: number;
  /** The oldest time the items cover: a wave starting within QUIET_MS of it may really have started earlier. */
  historyStart: number;
  /** Group key -> when its first source was added. Only groups listed here are compared. */
  since: Record<string, number>;
}
export interface GroupScore { key: string; joined: number; first: number; expected: number; medianLag: number | null; z: number | null; verdict: 'early' | 'late' | 'unclear' }

/** An item's term as Signal counts it: "games" under "game" when that is the name in use (see foldPlurals). Empty when Signal does not know the term. */
export function foldTerm(t: string, known: Set<string>): string {
  if (known.has(t)) return t;
  return t.endsWith('s') && known.has(t.slice(0, -1)) ? t.slice(0, -1) : '';
}

/** When a watch was added, in milliseconds: watches store whole seconds, and item times are milliseconds. A watch with no date counts as always there. */
export const watchStartMs = (created: number | undefined): number => { const c = Number(created) || 0; return c < 1e11 ? c * 1000 : c; };

/** A publication date with no time of day. */
export const isDateOnly = (ts: number): boolean => ts % DAY === 0;

function arrivalsOf(items: FirstItem[], onset: number): Arrival[] {
  const by = new Map<string, Arrival>();
  for (const m of items) {   // oldest first, so the first one seen of a group is its arrival
    const have = by.get(m.group);
    if (have) have.n++;
    else by.set(m.group, { group: m.group, ts: m.ts, lag: m.ts - onset, n: 1, watch: m.watch, by: m.by, title: m.title, url: m.url });
  }
  return [...by.values()];
}

/** The waves that start in the window and reach at least two groups, newest last in the order of `topics`; and why the other topics do not count. */
export function findWaves(topics: FirstTopic[], items: FirstItem[], o: FindOptions): { waves: Wave[]; skipped: { noClearStart: number; oneGroup: number }; dateOnly: number } {
  const usable = items.filter((i) => !isDateOnly(i.ts) && o.since[i.group] !== undefined && i.ts >= o.since[i.group]);
  const dateOnly = items.filter((i) => isDateOnly(i.ts)).length;
  const waves: Wave[] = [], skipped = { noClearStart: 0, oneGroup: 0 };
  for (const topic of topics) {
    const mine = usable.filter((i) => topic.terms.some((t) => i.terms.has(t))).sort((a, b) => a.ts - b.ts || a.group.localeCompare(b.group));
    let found = 0, thin = 0;
    for (let start = 0; start < mine.length;) {
      let end = start + 1;
      while (end < mine.length && mine[end].ts - mine[end - 1].ts < QUIET_MS) end++;
      const onset = mine[start].ts;
      if (onset >= o.from && onset - QUIET_MS >= o.historyStart) {
        // A group added after the wave began was not listening, so its place in the order says nothing.
        const inWave = mine.slice(start, end).filter((m) => m.ts < onset + WAVE_MS && o.since[m.group] <= onset);
        const arrivals = arrivalsOf(inWave, onset);
        if (arrivals.length >= 2 && inWave.length >= MIN_MENTIONS) {
          const heard = new Set(arrivals.map((a) => a.group));
          waves.push({ topic: topic.label, terms: topic.terms, onset, mentions: inWave.length, arrivals, absent: Object.keys(o.since).filter((g) => !heard.has(g) && o.since[g] <= onset) });
          found++;
        } else thin++;
      }
      start = end;
    }
    if (!found) { if (thin) skipped.oneGroup++; else skipped.noClearStart++; }
  }
  return { waves, skipped, dateOnly };
}

const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Per group: how many waves it joined, how often it came first (a tie shares the credit), how often chance alone predicts, and how long it usually takes to arrive. */
export function scoreFirsts(waves: Wave[], groups: string[]): GroupScore[] {
  const t = new Map(groups.map((key): [string, { joined: number; first: number; expected: number; spread: number; lags: number[] }] => [key, { joined: 0, first: 0, expected: 0, spread: 0, lags: [] }]));
  for (const w of waves) {
    const tied = w.arrivals.filter((a) => a.lag <= TIE_MS);
    for (const a of w.arrivals) {
      const s = t.get(a.group); if (!s) continue;
      const p = a.n / w.mentions;
      s.joined++; s.expected += p; s.spread += p * (1 - p); s.lags.push(a.lag <= TIE_MS ? 0 : a.lag);
      if (a.lag <= TIE_MS) s.first += 1 / tied.length;
    }
  }
  return groups.map((key) => {
    const s = t.get(key)!, z = s.spread > 0 ? (s.first - s.expected) / Math.sqrt(s.spread) : null;
    const verdict = s.joined < MIN_JOINED || z === null ? 'unclear' : z >= CLEAR_Z ? 'early' : z <= -CLEAR_Z ? 'late' : 'unclear';
    return { key, joined: s.joined, first: s.first, expected: s.expected, medianLag: median(s.lags), z, verdict };
  });
}

/** What a public page may show. Group keys can hold internal list ids, so they become plain numbers; other Signals are not named; and an item's title, link and source appear only on a Signal that has sources switched on. */
export function publicFirst<G extends { key: string }, A extends { group: string; by: string; title: string; url: string; source: string }, W extends { arrivals: A[]; absent: string[] }>(r: { groups: G[]; waves: W[] }, proof: boolean) {
  const keys = new Map(r.groups.map((g, i) => [g.key, 'g' + i] as const)), key = (k: string) => keys.get(k) ?? '';
  return { ...r, board: '', boards: [] as never[], groups: r.groups.map((g) => ({ ...g, key: key(g.key) })),
    waves: r.waves.map((w) => ({ ...w, absent: w.absent.map(key).filter(Boolean), arrivals: w.arrivals.map((a) => ({ ...a, group: key(a.group), ...(proof ? {} : { by: '', title: '', url: '', source: '' }) })) })) };
}

/** Most worth looking at first: the widest spread, then the most mentions, then the newest. */
export const rankWaves = (waves: Wave[]): Wave[] => [...waves].sort((a, b) => b.arrivals.length - a.arrivals.length || b.mentions - a.mentions || b.onset - a.onset);
