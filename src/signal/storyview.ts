// Stories as the public pages and the Monitor's admin see them (docs/grouping-proposal.md, steps 1 and 2). src/signal/stories.ts finds the stories; this file holds the
// small rules around them: which area a source belongs to, a story's first name and address, the counts Signal scores, and which story an address leads to.
// Pure functions (no Worker APIs), so Node can test them.
import { parseArea, type Area } from './area.ts';
import type { Counts } from './score.ts';
import { cleanStoryName, storySlug } from './stories.ts';
import { topicSlug } from './topicpage.ts';

/** The longest a story's address is made, so "-2" still fits under the 64 letters an address may have. */
export const STORY_SLUG_MAX = 56;
/** How many of the names its items carried stand as a story's other names: shown with it, searched, and old topic addresses with one of them lead to it. */
export const STORY_ALIASES = 4;
/** A backfill step takes items from at most this much time at once: well inside the 48 hours a pooled item waits (STORY_POOL_MS), so a birth is never missed for a step that was too long. */
export const STORY_CHUNK_MS = 12 * 3_600_000;
/** The items the backfill reads per query. */
export const STORY_BACKFILL_PAGE = 400;
/** How far back the backfill starts: as far as items are kept. */
export const STORY_BACKFILL_DAYS = 30;

/**
 * Which area each source group belongs to: the area of the published Signals (boards) that hold it, the first one when two areas share a group.
 * A group on no board has no area: its items are in no story, since no page shows them.
 */
export function groupAreas(boards: Array<{ groups: string[]; area?: string }>): Map<string, Area> {
  const out = new Map<string, Area>();
  for (const b of boards) for (const g of b.groups) if (!out.has(g)) out.set(g, parseArea(b.area));
  return out;
}

/** The name a story has until the model names it: the most used name of its items that can be shown (two words or more, not vague), else the most used one, else "new story". */
export function provisionalName(names: string[]): string {
  for (const n of names) { const c = cleanStoryName(n); if (c) return c.toLowerCase(); }
  return String(names[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 48) || 'new story';
}

/** A story's address from its name, made unique with "-2", "-3"... when `taken` says the plain one is in use. Always an address topicSlug leaves as it is, so the pages that make addresses from names agree. */
export function uniqueSlug(name: string, taken: (slug: string) => boolean): string {
  let base = storySlug(name);
  if (base.length > STORY_SLUG_MAX) base = base.slice(0, STORY_SLUG_MAX).replace(/-+$/, '');
  if (!base || topicSlug(base) !== base) base = topicSlug(base || 'story');
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * The counts Signal scores (src/signal/score.ts) for stories instead of terms: per story id, per group, the items in it; and how many different sources had it.
 * `rows`: items per story and source; `of`: the group of each source; `allow`: the groups that count; `perGroup`: how many sources each group has in the window.
 * A story heard from one source only counts as two voices when that source is the only one of its group (as for terms: there is no one else to ask).
 */
export function storyCounts(rows: Array<{ story: string; watch: string; n: number }>, of: Map<string, string>, allow: Set<string>, perGroup: Map<string, number>): { counts: Counts; voices: Map<string, number> } {
  const counts: Counts = new Map(), seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const g = of.get(r.watch);
    if (!g || !allow.has(g) || !(r.n > 0)) continue;
    const c = counts.get(r.story) ?? counts.set(r.story, {}).get(r.story)!;
    c[g] = (c[g] ?? 0) + r.n;
    (seen.get(r.story) ?? seen.set(r.story, new Set()).get(r.story)!).add(r.watch);
  }
  const heard = (w: Set<string>) => (w.size === 1 && (perGroup.get(of.get([...w][0]) ?? '') ?? 0) <= 1 ? 2 : w.size);
  return { counts, voices: new Map([...seen].map(([s, w]) => [s, heard(w)] as const)) };
}

/** The first rows (oldest first) that fall within `span` of the first one: one backfill step. Always at least one row when there are any. */
export function chunkBySpan<T extends { ts: number }>(rows: T[], span = STORY_CHUNK_MS): T[] {
  if (!rows.length) return [];
  const end = rows[0].ts + span, out: T[] = [];
  for (const r of rows) { if (r.ts > end && out.length) break; out.push(r); }
  return out;
}

/** A story's other names: the names its items carried most, without its own name. */
export const storyAliases = (name: string, names: string[]): string[] => names.filter((n) => n && n.toLowerCase() !== name.toLowerCase()).slice(0, STORY_ALIASES);

export interface SlugStory { slug: string; oldSlugs: string[]; name: string; names: string[] }
/**
 * Which story an address leads to, among `stories` given strongest first: the one whose address it is; else one that had it before (it was renamed);
 * else one whose name or other names give that address (an old topic page, from the time topics were names). Null when none does.
 */
export function storyFor<T extends SlugStory>(slug: string, stories: T[]): { story: T; how: 'slug' | 'old' | 'name' } | null {
  const own = stories.find((s) => s.slug === slug);
  if (own) return { story: own, how: 'slug' };
  const old = stories.find((s) => s.oldSlugs.includes(slug));
  if (old) return { story: old, how: 'old' };
  const named = stories.find((s) => [s.name, ...storyAliases(s.name, s.names)].some((n) => topicSlug(n) === slug));
  return named ? { story: named, how: 'name' } : null;
}

/** Stories that go with this one: those whose own or other names share a name with it, most shared first, then in the order given (strongest first). Ids, at most `k`. */
export function relatedByNames(own: { id: string; name: string; names: string[] }, others: Array<{ id: string; name: string; names: string[] }>, k = 4): string[] {
  const key = (s: { name: string; names: string[] }) => new Set([s.name, ...storyAliases(s.name, s.names)].map((n) => n.toLowerCase().trim()).filter(Boolean));
  const mine = key(own);
  return others.map((o, i) => ({ o, i, n: [...key(o)].filter((x) => mine.has(x)).length })).filter((x) => x.o.id !== own.id && x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i).slice(0, k).map((x) => x.o.id);
}

/** The "New story" mark (section 5): born in the window, and unlike every story of the 30 days before it when it was born. */
export const isNewInWindow = (s: { bornNew: boolean; first: number }, fromMs: number): boolean => s.bornNew && s.first >= fromMs;
