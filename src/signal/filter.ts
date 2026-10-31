// The words Signal leaves out because you said so. Applied when reading, so a change shows at once and also covers what was counted before.
// Pure functions (no Worker APIs), so Node can test them.

/** `phrases`: also leave out any phrase that contains the word ("ai" also hides "ai tools"); otherwise only the term itself. */
export interface FilterWord { term: string; phrases: boolean }
export const MAX_FILTER = 200;
/** What a new setup starts with. */
export const DEFAULT_FILTER: FilterWord[] = [{ term: 'ai', phrases: false }];

/** A list from the browser, made safe: lowercase, one to four words, no duplicates, bounded. */
export function cleanFilter(raw: unknown): FilterWord[] {
  const seen = new Set<string>(), out: FilterWord[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const e = (r && typeof r === 'object' ? r : { term: r }) as { term?: unknown; phrases?: unknown };
    const term = String(e.term ?? '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim().replace(/[*]+$/, '').trim();
    if (!term || term.length > 40 || term.split(' ').length > 4 || seen.has(term)) continue;
    seen.add(term); out.push({ term, phrases: e.phrases === true });
    if (out.length >= MAX_FILTER) break;
  }
  return out;
}

/** A function that says whether a term (a word, a phrase or a #hashtag, lowercase) is left out. */
export function makeBlocker(words: FilterWord[]): (term: string) => boolean {
  const exact = new Set(words.map((w) => w.term)), inside = words.filter((w) => w.phrases).map((w) => ' ' + w.term + ' ');
  if (!exact.size) return () => false;
  return (term) => exact.has(term) || (inside.length > 0 && inside.some((w) => (' ' + term + ' ').includes(w)));
}
