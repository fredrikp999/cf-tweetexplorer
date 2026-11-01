// Signal: turns per-group document counts into one weighted score per term, and says where each term shows up.
// Pure functions (no Worker APIs), so Node can test them. The Monitor Durable Object (durable-objects/monitor.ts) does the storage.
//
// A "group" is a set of sources that vote together (a feed list, a kind of source, or a name you gave). For a term in a window:
//   share(g)  = items in g that mention the term / (items in g + SMOOTH)      so a busy group does not drown a quiet one
//   signal    = sum(weight(g) * share(g)) / sum(weight(g))                    over the groups that have items and a weight
// Compared with the previous window of the same length, that gives the change. Where the signal comes from gives the kind.

export interface GroupInfo { key: string; name: string; weight: number }
/** term -> group key -> number of items that mention it. */
export type Counts = Map<string, Record<string, number>>;

export interface TermGroup { key: string; docs: number; share: number; /** This group's part of the weighted signal, 0 to 1. */ part: number }
export interface ScoredTerm {
  term: string; docs: number; signal: number; prev: number;
  /** Signal now divided by signal before (smoothed); null when there is no earlier window to compare with. */
  change: number | null; isNew: boolean;
  /** Groups that really mention it, and how many groups could have. */
  breadth: number; active: number;
  /** The share of the weighted signal that comes from the strongest group. */
  exclusivity: number; topGroup: string;
  /** Mentioned on nearly every day of the kept history: always there, so it says nothing about what is being discussed now. */
  evergreen: boolean;
  /** shared: in most groups; single: nearly all in one; mixed: in between. */
  kind: 'shared' | 'single' | 'mixed';
  groups: TermGroup[];
}

/** An always-present term only counts when it is at least this many times as strong as before. */
export const SPIKE = 2;
export const SMOOTH = 5;        // added to a group's item count, so three items cannot make a 100% share
const EPS = 0.002;              // a share this small counts as nothing when comparing windows
export const SMALL_WINDOW = 400;   // fewer items than this in the window counts as little data
const MIN_BASELINE_ITEMS = 10;  // fewer items than this in the earlier window and a change means nothing
const MIN_BASELINE_SHARE = 0.4; // nor when the earlier window holds under this part of this window's items: a source just added would make everything look new

/** A group counts as having the term when two items mention it, or one in a group too small to expect more. */
const present = (docs: number, items: number) => docs >= 2 || (docs >= 1 && items < 40);

export interface ScoreInput {
  groups: GroupInfo[];
  items: Record<string, number>; prevItems: Record<string, number>;
  cur: Counts; prev: Counts;
  minDocs?: number;
  /** term -> how many different sources mention it; with `minVoices`, terms that fewer sources mention are left out (one source repeating itself is not a signal). */
  voices?: Map<string, number>; minVoices?: number;
  /** Terms mentioned on most days of the kept history (see `findEvergreen`). */
  evergreen?: Set<string>;
}

/** "game" and "games" are one term: the plural is folded into the singular (or the other way round when only the plural is common). Per group the larger count is kept, since an item may mention both. */
export function foldPlurals(counts: Counts): Counts {
  const out: Counts = new Map(), into = new Map<string, string>();
  for (const t of counts.keys()) {
    if (t.length < 5 || !t.endsWith('s') || /(ss|us|is|os)$/.test(t)) continue;
    const one = t.slice(0, -1);
    if (counts.has(one)) into.set(t, one);
  }
  for (const [t, c] of counts) {
    const to = into.get(t) ?? t, have = out.get(to);
    if (!have) { out.set(to, { ...c }); continue; }
    for (const [g, n] of Object.entries(c)) have[g] = Math.max(have[g] ?? 0, n);
  }
  return out;
}

export function scoreTerms(inp: ScoreInput): { terms: ScoredTerm[]; baselineOk: boolean; active: GroupInfo[] } {
  // A small window (a board of a few feeds) rarely repeats a story three times: two mentions are enough when there is little data.
  const total = Object.values(inp.items).reduce((n, v) => n + v, 0);
  const minDocs = inp.minDocs ?? (total < SMALL_WINDOW ? 2 : 3);
  const active = inp.groups.filter((g) => g.weight > 0 && (inp.items[g.key] ?? 0) > 0);
  const wsum = active.reduce((n, g) => n + g.weight, 0);
  const prevTotal = Object.values(inp.prevItems).reduce((n, v) => n + v, 0);
  const curTotal = Object.values(inp.items).reduce((n, v) => n + v, 0);
  const baselineOk = prevTotal >= MIN_BASELINE_ITEMS && prevTotal >= MIN_BASELINE_SHARE * curTotal;
  if (!wsum) return { terms: [], baselineOk, active };
  const share = (docs: number, items: number) => docs / (items + SMOOTH);
  const signalOf = (c: Record<string, number> | undefined, items: Record<string, number>) =>
    c ? active.reduce((n, g) => n + g.weight * share(c[g.key] ?? 0, items[g.key] ?? 0), 0) / wsum : 0;
  const sharedAt = Math.max(2, Math.ceil(active.length * 0.6));

  const terms: ScoredTerm[] = [], curC = foldPlurals(inp.cur), prevC = foldPlurals(inp.prev);
  for (const [term, c] of curC) {
    const docs = active.reduce((n, g) => n + (c[g.key] ?? 0), 0);
    if (docs < minDocs || (inp.minVoices && (inp.voices?.get(term) ?? 0) < inp.minVoices)) continue;
    const signal = signalOf(c, inp.items), prev = signalOf(prevC.get(term), inp.prevItems);
    const parts = active.map((g) => ({ key: g.key, docs: c[g.key] ?? 0, share: share(c[g.key] ?? 0, inp.items[g.key] ?? 0) }));
    const total = parts.reduce((n, p, i) => n + active[i].weight * p.share, 0) || 1;
    const groups: TermGroup[] = parts.map((p, i) => ({ ...p, part: (active[i].weight * p.share) / total }));
    const top = groups.reduce((a, b) => (b.part > a.part ? b : a), groups[0]);
    const breadth = active.filter((g) => present(c[g.key] ?? 0, inp.items[g.key] ?? 0)).length;
    const kind = active.length < 2 ? 'single' : breadth >= sharedAt && top.part < 0.6 ? 'shared' : top.part >= 0.75 || breadth <= 1 ? 'single' : 'mixed';
    const prevDocs = Object.values(prevC.get(term) ?? {}).reduce((n, v) => n + v, 0);
    terms.push({ term, docs, signal, prev, change: baselineOk ? (signal + EPS) / (prev + EPS) : null, isNew: baselineOk && prevDocs === 0,
      breadth, active: active.length, exclusivity: top.part, topGroup: top.key, evergreen: inp.evergreen?.has(term) ?? false, kind, groups });
  }
  terms.sort((a, b) => b.signal - a.signal || b.docs - a.docs || a.term.localeCompare(b.term));
  return { terms: dropParts(terms), baselineOk, active };
}

/** "interest" next to "interest rates" with almost the same count is one topic: keep the phrase, drop the word. */
export const EVERGREEN_SHARE = 0.7;   // present on this part of the days with data or more: always there
export const EVERGREEN_MIN_DAYS = 5;  // with fewer days of history nothing can be called always there
/** Terms present on most days there is data for: "claude" in a feed about AI. `daysPresent` is per term; `daysWithData` the days the sources delivered anything. */
export function findEvergreen(daysPresent: Map<string, number>, daysWithData: number): Set<string> {
  const out = new Set<string>();
  if (daysWithData < EVERGREEN_MIN_DAYS) return out;
  for (const [t, d] of daysPresent) if (d / daysWithData >= EVERGREEN_SHARE) out.add(t);
  return out;
}

export function dropParts(sorted: ScoredTerm[]): ScoredTerm[] {
  const phrases = sorted.filter((t) => t.term.includes(' '));
  const covered = new Set<string>();
  for (const p of phrases) {
    for (const w of p.term.split(' ')) {
      const one = sorted.find((t) => t.term === w);
      if (one && p.docs >= 0.7 * one.docs) covered.add(w);
    }
  }
  return sorted.filter((t) => !covered.has(t.term));
}

/** Terms that are rising: more signal than before, weighted by how much signal there is. */
export const rising = (terms: ScoredTerm[], n: number): ScoredTerm[] =>
  terms.filter((t) => t.change !== null && t.change >= 1.5 && (!t.evergreen || t.change >= SPIKE)).sort((a, b) => b.signal * Math.log(b.change!) - a.signal * Math.log(a.change!)).slice(0, n);

/** What one group talks about that the others do not: its share against the average share elsewhere. */
export function distinctive(terms: ScoredTerm[], key: string, n: number, minDocs = 3): Array<ScoredTerm & { own: number; others: number; lift: number }> {
  const out: Array<ScoredTerm & { own: number; others: number; lift: number }> = [];
  for (const t of terms) {
    const g = t.groups.find((x) => x.key === key);
    if (!g || g.docs < minDocs) continue;
    const rest = t.groups.filter((x) => x.key !== key);
    const others = rest.length ? rest.reduce((s, x) => s + x.share, 0) / rest.length : 0;
    out.push({ ...t, own: g.share, others, lift: (g.share + EPS) / (others + EPS) });
  }
  return out.filter((t) => t.lift >= 2).sort((a, b) => b.own * Math.log(b.lift) - a.own * Math.log(a.lift)).slice(0, n);
}

/** Not just always there: more than before, new, or too little history to tell. A topic at the same level as in the period before is background ("ai" on a feed about AI). */
export const notSteady = (t: ScoredTerm): boolean => (t.evergreen ? t.change !== null && t.change >= SPIKE : t.change === null || t.isNew || t.change >= 1.15);
