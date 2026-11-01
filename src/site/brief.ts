// The structure of a briefing: its themes (headed sections), anchors to link to them, reading time, language, and which themes carry on from the
// day before. Pure functions (no Worker APIs), shared by the public pages and the Publish Durable Object, so Node can test them.

/** A link target for a heading: lowercase letters and digits joined by dashes ("AI speeding up attackers" -> "ai-speeding-up-attackers"). */
export const anchorOf = (title: string): string =>
  plainText(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';

/** Markdown inline marks and links reduced to their text. */
export const plainText = (s: string): string => String(s ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();

/**
 * Briefings written before themes had headings start each theme with a bold lead-in ("**AI under attack.** Nvidia told…"). Those become
 * "## AI under attack" followed by the text, so every briefing has headings. The first line, a sentence in bold (the TL;DR), stays as it is, and so do real headings.
 */
export function normalizeThemes(md: string): string {
  const lines = String(md ?? '').split('\n'), out: string[] = [];
  let first = true;
  for (const line of lines) {
    if (!line.trim()) { out.push(line); continue; }
    const isFirst = first; first = false;
    if (isFirst || /^\s*(#|[-*]\s|\d+\.\s|\||```)/.test(line)) { out.push(line); continue; }
    const lead = /^\*\*([^*\n]{3,90}?)\*\*\s*(\S.*)$/.exec(line.trim());
    if (lead && /[.:!?]\s*$/.test(lead[1])) { out.push(`## ${lead[1].replace(/[.:]\s*$/, '').trim()}`, '', lead[2]); continue; }
    const alone = /^\*\*([^*\n]{3,60})\*\*:?\s*$/.exec(line.trim());   // "**Notable posts**" on its own line
    if (alone) { out.push(`## ${alone[1].replace(/[.:]\s*$/, '').trim()}`); continue; }
    out.push(line);
  }
  return out.join('\n');
}

export interface Section { title: string; anchor: string; body: string }
/** The headed sections of a briefing (after normalizeThemes), in order. Text before the first heading is not a section. */
export function sectionsOf(md: string): Section[] {
  const out: Section[] = [], seen = new Map<string, number>();
  let cur: Section | null = null;
  for (const line of normalizeThemes(md).split('\n')) {
    const h = /^#{1,3}\s+(.*)$/.exec(line);
    if (h) {
      const title = plainText(h[1]), base = anchorOf(title), n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      cur = { title, anchor: n ? `${base}-${n + 1}` : base, body: '' };
      out.push(cur);
    } else if (cur) cur.body += line + '\n';
  }
  return out;
}

// Sections that are about the posts rather than a theme of the day.
const META = /^(notable (posts|items|videos|articles)|open questions|disagreements?( or open questions)?|accounts? (with no|that were quiet)|quiet accounts|uppmärksammade inlägg|öppna frågor)/i;
export const isMeta = (title: string): boolean => META.test(title.trim());
/** The themes of a briefing: its section titles, without the sections about notable posts or open questions. */
export const themesOf = (md: string): string[] => sectionsOf(md).filter((s) => !isMeta(s.title)).map((s) => s.title);

/** Minutes to read, at about 220 words a minute. */
export const readingMinutes = (md: string): number => Math.max(1, Math.round(plainText(md.replace(/```[\s\S]*?```/g, '')).split(' ').filter(Boolean).length / 220));

const SV = new Set('och att det som är för med på inte har en av till om de den ett var vi men också från efter kan säger sverige regeringen'.split(' '));
const EN = new Set('the and of to is that for with on not has a by from this are was be it as an at'.split(' '));
/** "sv" for a briefing written in Swedish, otherwise "en". */
export function langOf(md: string): 'sv' | 'en' {
  let sv = 0, en = 0;
  for (const w of plainText(md).toLowerCase().split(/[^\p{L}]+/u)) { if (SV.has(w)) sv++; else if (EN.has(w)) en++; }
  return sv >= 10 && sv > en * 1.2 ? 'sv' : 'en';
}

const STOP = new Set([...SV, ...EN, 'new', 'more', 'over', 'into', 'about', 'their', 'after', 'what', 'how', 'why', 'nya', 'mer']);
const words = (s: string) => new Set(plainText(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)));
/**
 * For each theme: carried on from the briefing before (it shares at least two words, or a third of its words, with one of that briefing's themes), or new.
 * Without an earlier briefing nothing is marked.
 */
export function continuity(themes: string[], prev: string[] | undefined): Array<'new' | 'continuing' | null> {
  if (!prev?.length) return themes.map(() => null);
  const before = prev.map(words);
  return themes.map((t) => {
    const w = words(t);
    const hit = before.some((b) => { let shared = 0; for (const x of w) if (b.has(x)) shared++; return shared >= 2 || (shared >= 1 && shared / Math.max(1, Math.min(w.size, b.size)) >= 0.34 && w.size <= 3); });
    return hit ? 'continuing' : 'new';
  });
}
