// Suggested questions under a view (A10): written by rule from the data, never by a model. At most three, in the order of the rules.
export const MAX_QUESTIONS = 3;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** A name as it may stand in a question: one line, no quotation marks, at most 60 letters. */
export const nameIn = (label: string): string => String(label ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
const weekday = (day: string): string | null => { const d = new Date(day + 'T12:00:00Z'); return Number.isNaN(d.getTime()) ? null : WEEKDAYS[d.getUTCDay()]; };

export interface TopicQ { label: string; state: string | null; phase: string | null; peakDay: string | null; /** The days of the series, oldest first. */ days: string[]; papers: number; /** The kinds of source in the order they had it, as titles. */ firstOrder: string[] }
export function topicQuestions(t: TopicQ): string[] {
  const n = nameIn(t.label), out: string[] = [];
  if (!n) return out;
  const recent = t.days.slice(-7), wd = t.peakDay && recent.includes(t.peakDay) ? weekday(t.peakDay) : null;
  if (wd && (t.phase === 'peaking' || t.phase === 'fading')) out.push(`Why did ${n} peak on ${wd}?`);
  if (t.papers > 0) out.push(`Which papers are behind ${n}?`);
  if (t.firstOrder.length >= 2) out.push(`How did ${n} get from ${t.firstOrder[0]} to ${t.firstOrder[1]}?`);
  if (t.state === 'new' || t.phase === 'emerging') out.push(`What is ${n}, in two sentences?`);
  if (t.phase === 'returning') out.push(`Why is ${n} back?`);
  return out.slice(0, MAX_QUESTIONS);
}
/** The overview: the topics that at least doubled, strongest first. */
export function overviewQuestions(rising: Array<{ label: string; change: number | null }>): string[] {
  return rising.filter((t) => (t.change ?? 0) >= 2 && nameIn(t.label)).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, MAX_QUESTIONS).map((t) => `What is driving ${nameIn(t.label)} this week?`);
}
/** Rising from the deep: the steepest climbs that are not at the surface yet. */
export function risingQuestions(climbs: Array<{ label: string; zone: string | null }>): string[] {
  return climbs.filter((t) => t.zone !== 'surface' && nameIn(t.label)).slice(0, MAX_QUESTIONS).map((t) => `Who is talking about ${nameIn(t.label)} so far?`);
}
/** The research map: the clusters with most uptake. */
export function papersQuestions(clusters: Array<{ name: string; discussed: number }>): string[] {
  return clusters.filter((c) => c.discussed > 0 && nameIn(c.name)).sort((a, b) => b.discussed - a.discussed).slice(0, MAX_QUESTIONS).map((c) => `What are people saying about the ${nameIn(c.name)} papers?`);
}
