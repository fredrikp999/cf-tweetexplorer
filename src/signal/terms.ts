// The terms an item is counted under in Signal: hashtags, single words and two-word phrases. Pure functions (no Worker APIs), so Node can test them.
import { STOP } from '../history/stats.ts';

const MAX_TERMS = 40;
// Words that are everywhere in news and chat and say nothing about a topic, on top of the stop words History uses. Left in, they top the
// "everywhere" list. (Feed boilerplate such as "Show HN" is here too.)
const GENERIC = new Set(('said says told tell tells know knows known called calls call first last next best biggest largest new newest latest people person time times week weeks month months year years '
  + 'today yesterday tomorrow tonight monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december '
  + 'make makes made making take takes took taking back many even still think thinks thing things work works working like likes look looks want wants going really using used uses show shows '
  + 'found find finds need needs help helps give gives gave come comes came good great better well much more most some than then them they their there these those other another '
  + 'part year-old according report reports reported says video photo photos image watch read news story stories update updates live hn ask').split(' '));
// Clause breaks: a phrase does not run across them, so "rates. Apple" never becomes the phrase "rates apple".
const BREAK = /[.!?;:,()[\]{}"“”‘’|\n\r–—•·…]+|\s[-/]\s/;

/** A word worth counting: long enough to carry meaning, or a short all-capitals acronym (AI, EU, GPU). */
function keep(raw: string): string | null {
  const w = raw.replace(/['’]s$/i, '');
  if (w.length > 30 || /^\p{N}+$/u.test(w)) return null;
  const low = w.toLowerCase();
  if (STOP.has(low) || GENERIC.has(low)) return null;
  if (w.length >= 4 || (w.length >= 2 && w === w.toUpperCase() && /^\p{Lu}+$/u.test(w))) return low;
  return null;
}

/** Hashtags, words and adjacent-word phrases in a text, each once. Links and @mentions are ignored. */
export function extractTerms(text: string, max = MAX_TERMS): string[] {
  const out = new Set<string>();
  const clean = String(text ?? '').replace(/https?:\/\/\S+/g, ' ');
  for (const m of clean.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) out.add('#' + m[1].toLowerCase());
  for (const seg of clean.replace(/[@#][\p{L}\p{N}_]+/gu, ' ').split(BREAK)) {
    let prev: string | null = null;
    for (const raw of seg.match(/\p{L}[\p{L}\p{N}'’]*/gu) ?? []) {
      const w = keep(raw);
      if (w) { out.add(w); if (prev) out.add(prev + ' ' + w); }
      prev = w;
    }
    if (out.size >= max) break;
  }
  return [...out].slice(0, max);
}
