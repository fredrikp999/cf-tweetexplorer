// Themes around src/signal/themes.ts (docs/grouping-proposal.md, steps 3 and 4): the rows the Monitor keeps turned into what themes.ts wants, how a proposal is known again
// from one week to the next, the admin's source lists (section 6b) and the marks a story gets (section 5). Pure functions (no Worker APIs), so Node can test them.
import type { ThemeProposal, ThemeStory } from './themes.ts';
import { likeness, THEME_SEEN_SIM } from './themes.ts';

const DAY = 86_400_000, WEEK = 7 * DAY;
/** Themes are looked for once a week, from the alarm. */
export const THEME_RUN_MS = WEEK;
/** "Later" and "keep it as it is" hold a proposal back this long; then it is proposed again if it still passes. */
export const THEME_LATER_MS = 4 * WEEK;
/** Candidates named by the model per run; the others keep a name made from their biggest story until the next run. */
export const THEME_NAME_MAX = 8;
/** How far back stories are read for a run: the discovery window (8 weeks) is inside it, and a theme's six quiet weeks before "retire" too. */
export const THEME_READ_WEEKS = 26;
/** The public curve of a theme, in weeks. */
export const THEME_PUBLIC_WEEKS = 26;
/** "New in <theme>": a new story born this recently. */
export const THEME_NEW_DAYS = 7;
/** The admin's lists of section 6b: a theme carried by this many sources or fewer; a source with at least NOISY_MIN items read of which this share landed in no story. */
export const THIN_SOURCES = 2, NOISY_MIN = 20, NOISY_SHARE = 0.8;
/** A theme is followed on the site as a topic is, under this address prefix (no topic address has two dashes in a row, so the two never meet). */
export const THEME_FOLLOW_PREFIX = 'theme--';

export const themeHref = (slug: string, area: string): string => `/theme/${slug}${area === 'politics' ? '?area=politics' : ''}`;
export const followOfTheme = (slug: string): string => THEME_FOLLOW_PREFIX + slug;
/** The theme address inside a followed address, or null for a topic. */
export const themeOfFollow = (slug: string): string | null => (slug.startsWith(THEME_FOLLOW_PREFIX) ? slug.slice(THEME_FOLLOW_PREFIX.length) : null);

/** Stories as themes.ts reads them, from the story rows and their daily counts per group (story_day). */
export function themeStoriesOf(rows: Array<{ id: string; name: string; centre: ArrayLike<number>; first: number; last: number; n: number; theme: string | null }>, days: Array<{ story: string; day: string; grp: string; n: number }>): ThemeStory[] {
  const by = new Map<string, Record<string, Record<string, number>>>();
  for (const d of days) { const s = by.get(d.story) ?? by.set(d.story, {}).get(d.story)!, g = s[d.day] ?? (s[d.day] = {}); g[d.grp] = (g[d.grp] ?? 0) + d.n; }
  return rows.map((r) => ({ id: r.id, name: r.name, centre: r.centre, first: r.first, last: r.last, n: r.n, theme: r.theme, days: by.get(r.id) ?? {} }));
}

/** How a proposal is known again next week: a candidate by its stories (themes.ts gives the key), the others by kind and theme. */
export function proposalKey(p: ThemeProposal | { kind: 'candidate'; key: string }): string {
  switch (p.kind) {
    case 'candidate': return 'c:' + p.key;
    case 'merge': return 'merge:' + [...p.themes].sort().join('|');
    default: return `${p.kind}:${p.theme}`;
  }
}
/**
 * Whether a new proposal is held back by one the admin put off (Later, or Keep for a theme): the same key, or for a candidate one whose centre is as alike as a theme seen
 * before would be (the stories of a group change a little from week to week, so its key does too).
 */
export function heldBack(p: { key: string; centre?: ArrayLike<number> }, later: Array<{ key: string; centre?: ArrayLike<number> }>, bg: ArrayLike<number>): boolean {
  return later.some((l) => l.key === p.key || (!!p.centre && !!l.centre && p.key.startsWith('c:') && l.key.startsWith('c:') && likeness(p.centre, l.centre, bg) >= THEME_SEEN_SIM));
}

/** The weeks of items there are, from the oldest day counted (YYYY-MM-DD), at least one. */
export const weeksSince = (oldestDay: string | null, now: number): number => (oldestDay ? Math.max(1, Math.ceil((now - Date.parse(oldestDay + 'T00:00:00Z')) / WEEK)) : 1);

/** Section 6b: themes heard from THIN_SOURCES sources or fewer (where to add sources), from the sources of each theme's items. */
export function thinThemes(sources: Map<string, Set<string>>): Array<{ theme: string; sources: number }> {
  return [...sources].filter(([, s]) => s.size <= THIN_SOURCES).map(([theme, s]) => ({ theme, sources: s.size })).sort((a, b) => a.sources - b.sources || (a.theme < b.theme ? -1 : 1));
}
/** Section 6b: sources whose items mostly land in no story (candidates to drop), most first. `read`: items read per source; `inStory`: those in a story. */
export function noisySources(read: Map<string, number>, inStory: Map<string, number>): Array<{ watch: string; read: number; none: number }> {
  return [...read].map(([watch, n]) => ({ watch, read: n, none: Math.max(0, n - (inStory.get(watch) ?? 0)) })).filter((x) => x.read >= NOISY_MIN && x.none / x.read >= NOISY_SHARE)
    .sort((a, b) => b.none / b.read - a.none / a.read || b.read - a.read);
}

/** Items per week, oldest first, `weeks` long, the last ending at `now`: a theme's curve from its stories' daily counts. */
export function weekly(days: Array<{ day: string; n: number }>, weeks: number, now: number): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const d of days) { const w = Math.max(0, Math.floor((now - Date.parse(d.day + 'T00:00:00Z')) / WEEK)); if (w < weeks) out[weeks - 1 - w] += d.n; }
  return out;
}

/** The marks of section 5 for a story: "New in <theme>" (a new story inside a theme, born in the last THEME_NEW_DAYS) and "Uncharted" (in no theme). Only where there are themes. */
export function storyMarks(s: { theme: unknown; bornNew: boolean; first: number }, now: number, themesExist: boolean): { newIn: boolean; uncharted: boolean } {
  return { newIn: !!s.theme && s.bornNew && s.first >= now - THEME_NEW_DAYS * DAY, uncharted: themesExist && !s.theme };
}

// ---- the public shapes (the Monitor's `themes-public` and `theme-public`; the pages, their JSON and the MCP tools read them)
export interface ThemeStoryCard { slug: string; name: string; first: number; last: number; n: number; isNew: boolean; state: string; newIn?: boolean }
export interface ThemesPublic {
  area: 'ai' | 'politics'; weeks?: number;
  themes: Array<{ slug: string; name: string; sentence: string; lens: { key: string; name: string } | null; stories: number; live: number; items: number; last: number | null; curve: number[]; recent: number; newStories: ThemeStoryCard[]; top: ThemeStoryCard[] }>;
  uncharted: { count: number; stories: ThemeStoryCard[] };
}
export interface ThemePublic {
  slug: string; area: 'ai' | 'politics'; name: string; sentence: string; inside: string; outside: string; notConfused: string; state: 'active' | 'retired'; created: number;
  lens: { key: string; name: string; color: string } | null; weeks: number; curve: number[]; /** The last day of the curve. */ to: string;
  groups: Array<{ name: string; n: number }>; stories: ThemeStoryCard[]; newStories: ThemeStoryCard[]; others: Array<{ slug: string; name: string }>;
}
