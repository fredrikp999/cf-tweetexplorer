// Research pulse: is a research topic getting a bigger part of AI research than it usually does?
// arXiv papers have no likes or retweets, so this measures volume alone: papers in a topic in a week, as a share of all papers in the AI categories.
// The share matters. The whole field has weeks twice its usual size (the week of 2026-09-23 had 4,252 papers against about 2,050), and in raw counts every topic spikes at once.
// Backtested on 18 weeks of real data (test/pulse.test.mjs): raw counts flagged 11 of 36 topic-weeks, the share 4, of which this rule calls 3 spikes and leaves out one dip too small to be falling.
// Pure functions (no Worker APIs), so Node can test them. The Monitor Durable Object does the storage and the fetching.

export interface PulseTopic { id: string; slug: string; title: string; blurb: string; /** arXiv's search_query. */ query: string }
export interface PulseWindow { end: string; n: number; base: number }
export type PulseState = 'building' | 'normal' | 'rising' | 'spike' | 'falling';
export interface PulseResult {
  state: PulseState; sustained: boolean;
  /** The newest window. */ end: string; from: string; n: number; base: number; share: number;
  /** The median share of the 8 windows before it, this window against it, and how unusual that is. */ baseline: number; ratio: number; z: number;
  /** Oldest first, for the chart. */ series: Array<{ end: string; n: number; share: number }>;
}

/** What "all of AI research" is, for the share. */
export const PULSE_BASE = 'cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.MA';
export const PULSE_BASE_ID = '__base';
export const BASELINE_WEEKS = 8, CHART_WEEKS = 18;
const DAY = 86_400_000;
/** The newest days are not all listed yet, so a window ends this many days ago. */
export const LAG_DAYS = 2;
/** A count is final once read this many days after its window ended: until then, papers listed late are still coming in. */
export const SETTLE_DAYS = 5;
// A spike has to be unusual for this topic (Z), big enough to matter (RATIO), and not a few papers more of very few (MIN_PAPERS).
const Z = 3, RATIO = 1.25, MIN_PAPERS = 20, RISING_Z = 2, RISING_RATIO = 1.1, FALLING_RATIO = 0.8, SURGE = 1.5;

const CATS = '(cat:cs.AI OR cat:cs.CL OR cat:cs.MA OR cat:cs.SE)';
export const DEFAULT_PULSE_TOPICS: PulseTopic[] = [
  { id: 'agents', slug: 'agents', title: 'Agents', blurb: 'AI agents and agentic systems', query: `(ti:agent OR ti:agents OR ti:agentic) AND ${CATS}` },
  { id: 'evals', slug: 'evaluations', title: 'Evaluations', blurb: 'Benchmarks and evaluations of language models and agents', query: '(ti:benchmark OR ti:evaluation) AND (ti:LLM OR ti:LLMs OR ti:"language model" OR ti:"language models" OR ti:agent OR ti:agents) AND (cat:cs.AI OR cat:cs.CL)' },
  { id: 'safety', slug: 'safety', title: 'Safety and security', blurb: 'AI safety, alignment, jailbreaks and prompt injection', query: '(abs:"AI safety" OR abs:"AI alignment" OR ti:jailbreak OR ti:jailbreaks OR ti:"prompt injection" OR abs:"mechanistic interpretability" OR ti:"red teaming") AND (cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.CR)' },
  { id: 'llms', slug: 'llms', title: 'LLMs in general', blurb: 'Papers with large language models in the title', query: 'ti:"large language model" OR ti:"large language models" OR ti:LLM OR ti:LLMs' },
];

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const windowStart = (end: string) => dayOf(Date.parse(end) - 6 * DAY);

/** The window ends to read today, newest first: a week apart, so each one is compared with whole weeks. */
export function pulseWindows(now: number, weeks = CHART_WEEKS): string[] {
  const newest = Date.parse(dayOf(now)) - LAG_DAYS * DAY;
  return Array.from({ length: weeks }, (_, k) => dayOf(newest - k * 7 * DAY));
}

/** What still has to be read, newest first: counts never read, and those read before they had settled. */
export function pulseWork(ids: string[], ends: string[], stored: Map<string, string>, now: number): Array<{ topic: string; end: string }> {
  const today = dayOf(now), out: Array<{ topic: string; end: string }> = [];
  for (const end of ends) for (const topic of ids) {
    const checked = stored.get(`${topic}\n${end}`);
    if (checked === undefined) out.push({ topic, end });
    else if (checked < dayOf(Date.parse(end) + SETTLE_DAYS * DAY) && checked < today) out.push({ topic, end });   // read again at most once a day
  }
  return out;
}

const median = (xs: number[]) => { const a = [...xs].sort((p, q) => p - q), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const spread = (xs: number[], med: number) => median(xs.map((x) => Math.abs(x - med))) * 1.4826;

function judge(shares: number[], i: number): { baseline: number; ratio: number; z: number } | null {
  if (i < BASELINE_WEEKS) return null;
  const h = shares.slice(i - BASELINE_WEEKS, i);
  if (h.some((x) => !Number.isFinite(x))) return null;
  const baseline = median(h);
  if (!(baseline > 0)) return null;
  // A floor under the spread: a very steady history would otherwise make any small move look huge.
  return { baseline, ratio: shares[i] / baseline, z: (shares[i] - baseline) / Math.max(spread(h, baseline), baseline * 0.05) };
}
const isSpike = (j: { ratio: number; z: number }, n: number) => j.z >= Z && j.ratio >= RATIO && n >= MIN_PAPERS;

/** One topic's windows, oldest first. Windows with no count yet leave a gap in the history: until there are enough, it says so instead of guessing. */
export function pulseOf(windows: PulseWindow[]): PulseResult {
  const shares = windows.map((w) => (w.base > 0 ? w.n / w.base : NaN));
  const series = windows.map((w, i) => ({ end: w.end, n: w.n, share: Number.isFinite(shares[i]) ? shares[i] : 0 }));
  const i = windows.length - 1, last = windows[i], j = i >= 0 ? judge(shares, i) : null;
  const base = { end: last?.end ?? '', from: last ? windowStart(last.end) : '', n: last?.n ?? 0, base: last?.base ?? 0, share: i >= 0 && Number.isFinite(shares[i]) ? shares[i] : 0, series };
  if (!j || !Number.isFinite(shares[i])) return { state: 'building', sustained: false, baseline: 0, ratio: 0, z: 0, ...base };
  let state: PulseState = 'normal';
  if (isSpike(j, last.n)) state = 'spike';
  else if (j.z >= RISING_Z && j.ratio >= RISING_RATIO && last.n >= MIN_PAPERS) state = 'rising';
  else if (j.z <= -Z && j.ratio <= FALLING_RATIO) state = 'falling';
  const before = judge(shares, i - 1);
  return { state, sustained: state === 'spike' && !!before && isSpike(before, windows[i - 1].n), ...j, ...base };
}

/** Whether all of AI research is having an unusually big week, which is a different story from one topic growing. Counts of the base, oldest first. */
export function fieldSurge(base: number[]): { surge: boolean; ratio: number } {
  const i = base.length - 1;
  if (i < BASELINE_WEEKS || !(base[i] > 0)) return { surge: false, ratio: 0 };
  const m = median(base.slice(i - BASELINE_WEEKS, i));
  const ratio = m > 0 ? base[i] / m : 0;
  return { surge: ratio >= SURGE, ratio };
}
