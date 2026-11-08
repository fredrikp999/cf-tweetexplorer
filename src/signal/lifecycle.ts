// Where a topic is in its life, from the shape of its daily counts: emerging, at its peak, fading, back again, or steady.
// Pure functions (no Worker APIs), so Node can test them. It reads the same 14 days of mentions the topic page's curve draws (TopicData.series) and the landing cards' counts,
// so the word and the picture next to it always agree. The state pill (new, rising, falling) compares one window with the one before; this looks at the whole curve, day by day.

export type Phase = 'emerging' | 'peaking' | 'fading' | 'returning' | 'steady';
export const PHASE_LABEL: Record<Phase, string> = { emerging: 'Emerging', peaking: 'At its peak', fading: 'Fading', returning: 'Back again', steady: 'Steady' };
/** A mark that says the same as the word, so the badge never relies on colour alone. */
export const PHASE_MARK: Record<Phase, string> = { emerging: '↗', peaking: '▲', fading: '↘', returning: '↻', steady: '→' };
/** The order of a life, for the track that shows where a topic is in it. "Back again" sits beside it, as a loop. */
export const PHASE_TRACK: Phase[] = ['emerging', 'peaking', 'fading'];

export interface Lifecycle {
  phase: Phase;
  /** The day of the highest point of the smoothed curve (an index into the series), and of the earlier peak for a topic that is back again. */
  peak: number; firstPeak?: number;
  /** The last three days against the peak, 0 to 1. */
  level: number;
  /** One plain sentence, the text equivalent of the badge and the curve. */
  words: string;
}

/** Fewer mentions than this in the whole series and the shape is chance: no word at all. */
const MIN_TOTAL = 6;
/** A three-day moving average (two days at the ends), so one busy day is not a peak. */
export function smooth(c: number[]): number[] {
  return c.map((_, i) => { const a = c.slice(Math.max(0, i - 1), Math.min(c.length, i + 2)); return a.reduce((s, v) => s + v, 0) / a.length; });
}
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
/** The index of the highest value; on a tie, the latest (a plateau that runs to today is a peak today). */
const argmax = (a: number[], from = 0, to = a.length) => { let k = from; for (let i = from; i < to; i++) if (a[i] >= a[k]) k = i; return k; };
const argmin = (a: number[], from: number, to: number) => { let k = from; for (let i = from; i < to; i++) if (a[i] < a[k]) k = i; return k; };

/**
 * The phase of a topic from its daily counts, oldest first. `days` (ISO dates, same length) words the peak's day. Null when there are too few mentions or days to tell.
 * - emerging: hardly mentioned in the first days, and now at half its peak or more, with the peak in the last five days
 * - returning: an earlier peak, a quiet stretch after it (under 40% of that peak), and the last days back at 60% of it or more
 * - peaking: the highest point is in the last three days and the last days are at 60% of it or more
 * - fading: the peak is older than three days and the last days are at 55% of it or less
 * - steady: none of these
 */
export function lifecycle(counts: number[], days: string[] = []): Lifecycle | null {
  const n = counts.length, c = counts.map((v) => Math.max(0, Number(v) || 0));
  if (n < 7 || c.reduce((s, v) => s + v, 0) < MIN_TOTAL) return null;
  const s = smooth(c), pk = argmax(s), top = Math.max(1e-9, s[pk]), recent = mean(c.slice(-3)), level = Math.min(1, recent / top);
  const early = mean(c.slice(0, n - 5)), day = (i: number) => dayWords(days[i]);
  const out = (phase: Phase, words: string, firstPeak?: number): Lifecycle => ({ phase, peak: pk, ...(firstPeak !== undefined ? { firstPeak } : {}), level: Math.round(level * 100) / 100, words });

  if (early <= 0.15 * top && level >= 0.5 && pk >= n - 5) {
    const start = c.findIndex((v) => v >= 0.25 * top);
    return out('emerging', `Emerging: hardly mentioned before ${day(Math.max(0, start)) || 'the last few days'}, and growing since.`);
  }
  if (n >= 9) {   // an earlier peak, a dip, and a return
    const a = argmax(s, 0, n - 5), t = a + 1 < n - 3 ? argmin(s, a + 1, n - 3) : -1;
    if (t > a && s[a] >= 1 && s[t] <= 0.4 * s[a] && recent >= 0.6 * s[a] && recent >= 2 * s[t] + 1)
      return out('returning', `Back again: it peaked ${on(day(a))}, went quiet, and is picking up again.`, a);
  }
  if (pk >= n - 3 && level >= 0.6) return out('peaking', 'At its peak: the busiest days are now.');
  if (pk < n - 3 && level <= 0.55) return out('fading', `Fading: it peaked ${on(day(pk))} and is now at about ${Math.round(level * 100)}% of that.`);
  return out('steady', 'Steady: talked about at a similar level over the period.');
}
const on = (d: string) => (d ? `on ${d}` : 'earlier');
/** "3 Nov" from "2026-11-03"; '' for anything else. */
function dayWords(iso: string | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}
