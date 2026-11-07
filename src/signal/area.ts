// Areas (INTENT.md journey H): the site follows AI first; Politics is a second, separate area with the same structure under /politics.
// A published Signal (board) and a briefing topic each belong to one area, set in the admin; older ones have none stored and are AI.
// Pure functions (no Worker APIs), so Node can test them. Nothing from one area shows on the other's pages unless asked.
import { LENS_AREAS, type LensArea } from './lens.ts';

export type Area = LensArea;
export const AREAS: readonly Area[] = LENS_AREAS;
export const AREA_LABEL: Record<Area, string> = { ai: 'AI', politics: 'Politics' };
/** The home page of an area on the site. */
export const AREA_HOME: Record<Area, string> = { ai: '/', politics: '/politics' };
/** The briefings list of an area. */
export const AREA_BRIEFINGS: Record<Area, string> = { ai: '/briefings', politics: '/politics/briefings' };

/** An area from an address or a tool argument; AI for anything missing or unknown (a made-up value changes nothing). */
export const parseArea = (v: unknown): Area => (v === 'politics' ? 'politics' : 'ai');
/** Like `parseArea`, but null when nothing valid was asked for (a hint is only a hint). */
export const areaHint = (v: unknown): Area | null => (v === 'politics' || v === 'ai' ? v : null);
/** The area of a stored board or briefing topic: none stored means AI. */
export const areaOf = (x: { area?: string } | null | undefined): Area => parseArea(x?.area);

/** The published boards of one area, in the order they were given. */
export const boardsOfArea = <B extends { area?: string }>(boards: B[], area: Area): B[] => boards.filter((b) => areaOf(b) === area);
/** The first published board of an area: what the landing page, overview, landscape and search take their numbers from. Null when the area has none. */
export const pickBoard = <B extends { area?: string }>(boards: B[], area: Area): B | null => boardsOfArea(boards, area)[0] ?? null;
/** The briefing topics of one area. */
export const topicsOfArea = <T extends { area?: string }>(topics: T[], area: Area): T[] => topics.filter((t) => areaOf(t) === area);

/** Whether an area has anything published: the area chooser is shown only when there is more than AI to choose. AI is always there. */
export const publishedAreas = (boards: Array<{ area?: string }>, topics: Array<{ area?: string }>): Area[] =>
  AREAS.filter((a) => a === 'ai' || boardsOfArea(boards, a).length > 0 || topicsOfArea(topics, a).length > 0);

/**
 * Which of several candidates for one topic address to use (the same slug can exist on boards in both areas): the area asked for (`?area=`), else AI, then the strongest.
 * Returns the indexes into `found`, best first.
 */
export function rankByArea(found: Array<{ area: Area; signal: number }>, hint: Area | null): number[] {
  const want = hint ?? 'ai';
  return found.map((f, i) => ({ f, i })).sort((a, b) => Number(b.f.area === want) - Number(a.f.area === want) || b.f.signal - a.f.signal || a.i - b.i).map((x) => x.i);
}

/** The address of a topic page; the area is added only for a politics topic, so the page can lead back to /politics (and so a name in both areas opens the right one). */
export const topicHref = (slug: string, area: Area, angle?: string): string => {
  const q = [area === 'politics' ? 'area=politics' : '', angle ? 'angle=' + angle : ''].filter(Boolean).join('&');
  return `/t/${slug}${q ? '?' + q : ''}`;
};

/** A path under an area: '/' + '' = '/', '/politics' + '/briefings'. Used for the pages that exist once per area. */
export const areaPath = (area: Area, sub = ''): string => (area === 'ai' ? '/' + sub.replace(/^\//, '') : '/politics' + (sub ? '/' + sub.replace(/^\//, '') : ''));

/**
 * Which area a request belongs to, from the address alone (no reads of its own): /politics..., a Signal at /signal/<slug> and a briefing at /<slug> are of the area they were published in.
 * `?area=` only matters on the pages that exist once for both areas (search, topics, the Signal index); the AI home and the briefings page stay AI whatever the address says.
 * The same name as a topic in both areas is told apart on the topic page itself (`?area=`, else AI), and an unlisted briefing is placed by the page once it has read it.
 */
export function areaOfRequest(parts: string[], query: URLSearchParams, boards: Array<{ slug: string; aliases?: string[]; area?: string }>, topics: Array<{ slug: string; area?: string }>): Area {
  if (parts[0] === 'politics') return 'politics';
  if (parts[0] === 'signal' && parts[1]) { const b = boards.find((x) => x.slug === parts[1] || x.aliases?.includes(parts[1])); if (b) return areaOf(b); }
  else if (parts.length >= 1 && parts[0] !== 't' && parts[0] !== 'search' && parts[0] !== 'topics') { const t = topics.find((x) => x.slug === parts[0]); if (t) return areaOf(t); }
  const shared = parts[0] === 'search' || parts[0] === 'topics' || (parts[0] === 'signal' && parts.length === 1);
  return shared ? parseArea(query.get('area')) : 'ai';
}
