// The heat calendar: daily mentions as a grid of days, a column per week and a row per weekday, darker for busier days. On a topic page (its own mentions) and on the landing page
// (the mentions of the topics shown, with or without a lens). Pure functions (no Worker APIs), so Node can test them. The Monitor keeps daily counts for 30 days, so that is what it covers.

export interface CalCell { day: string; n: number; /** 0 (none) to 4 (busiest), by the share of the busiest day. */ level: 0 | 1 | 2 | 3 | 4; /** Weekday, Monday 0 to Sunday 6, and the week column. */ row: number; col: number }
export interface Calendar { cells: CalCell[]; weeks: number; max: number; total: number;
  /** The busiest day, and how the weekdays compare: words for both, empty when there is too little to say. */ busiest: string; pattern: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayWords = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return `${WEEKDAYS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** The level of a count against the busiest day: square-root steps, so a few busy days do not leave the rest blank. */
export function levelOf(n: number, max: number): CalCell['level'] {
  if (n <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil(Math.sqrt(n / max) * 4))) as CalCell['level'];
}

/**
 * The grid for `days` (ISO, oldest first) and their counts. Weeks start on Monday; the first column may be partly empty.
 * `pattern` names a weekday only when it is clearly busier (1.4 times the average of the others) and there are at least three of each weekday and 20 mentions in all.
 */
export function calendar(days: string[], counts: number[]): Calendar {
  const c = days.map((_, i) => Math.max(0, Number(counts[i]) || 0)), max = Math.max(0, ...c), total = c.reduce((a, b) => a + b, 0);
  if (!days.length) return { cells: [], weeks: 0, max: 0, total: 0, busiest: '', pattern: '' };
  const first = (new Date(days[0] + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const cells = days.map((day, i) => ({ day, n: c[i], level: levelOf(c[i], max), row: (first + i) % 7, col: Math.floor((first + i) / 7) }));
  const weeks = cells.length ? cells[cells.length - 1].col + 1 : 0;
  let top = 0;
  for (let i = 1; i < c.length; i++) if (c[i] > c[top]) top = i;
  const busiest = max > 0 ? `Busiest on ${dayWords(days[top])}, with ${max.toLocaleString('en-GB')} ${max === 1 ? 'mention' : 'mentions'}.` : '';
  let pattern = '';
  const per = WEEKDAYS.map((_, w) => cells.filter((x) => x.row === w).map((x) => x.n));
  if (total >= 20 && per.every((l) => l.length >= 3)) {
    const avg = per.map((l) => l.reduce((a, b) => a + b, 0) / l.length), best = avg.indexOf(Math.max(...avg)), rest = avg.filter((_, i) => i !== best), restAvg = rest.reduce((a, b) => a + b, 0) / rest.length;
    if (restAvg > 0 && avg[best] >= 1.4 * restAvg) pattern = `${WEEKDAYS[best]}s are busiest: about ${(avg[best] / restAvg).toFixed(1)} times an average other day.`;
    const weekend = (avg[5] + avg[6]) / 2, weekdays = avg.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    if (!pattern && weekdays > 0 && weekend <= 0.5 * weekdays) pattern = 'Quieter at weekends: about half a weekday or less.';
  }
  return { cells, weeks, max, total, busiest, pattern };
}
