// What the landing page (/) and the MCP tool `get_overview` both show: one function reads it, so the two cannot drift apart.
// Every read is on its own: one source failing leaves that block empty and the rest as it was. Never starts a model call.
import { pickBoard, topicsOfArea, type Area } from '../signal/area';
import { chosenLens, type Lens } from '../signal/lens';
import type { Layout, ReplayFrame } from '../signal/landscape';
import { rankList, type BriefIn, type LadderRaw, type LandingWindow, type SigTopic } from './landing';
import type { LandingExtras, PubBoard, PubSignal, PubTopic } from './public';
import { risingOf, type DepthRaw, type RisingData } from './rising';

export interface OverviewData {
  /** The area the numbers are from; the page and the tools of one area never take a board or a briefing from the other. */
  area: Area;
  window: LandingWindow; lenses: Lens[]; lens?: Lens;
  /** The Signal the page takes its numbers from (the first published one of the area). */
  board: PubBoard | null;
  /** Signal for the window, and for 7 days (what In brief matches against). */
  sig: PubSignal | null; sig7: PubSignal | null; extras: LandingExtras | null;
  /** The newest published briefing of each briefing topic. */
  briefs: BriefIn[];
  /** Where the landscape's bubbles sit (kept by the Monitor for the day); null when there is none yet. */
  landscape: Layout | null;
  /** The kept layouts of the days before today, oldest first, when asked for (`replay`) and no lens is chosen; else null. */
  replay: ReplayFrame[] | null;
  /** The rank of the biggest topics on each of the last 14 days (the Ladder); null when there is none. */
  ladder: LadderRaw | null;
}

export const briefsOf = (topics: PubTopic[]): BriefIn[] => topics.map((t) => ({ slug: t.slug, title: t.title, publishedAt: t.latest.publishedAt, tldr: t.latest.tldr, themes: t.latest.themes, position: t.position }));

/** How many topics the landing page's streamgraph draws. */
export const STREAM_TOPICS = 10;
const monitor = (env: Env, path: string) => env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/' + path));
/** The lenses of an area, for the pages and tools that apply one. Never fails: with none, the plain lists show. */
export const loadLenses = (env: Env, area: Area = 'ai'): Promise<Lens[]> => monitor(env, `lenses-public?area=${encodeURIComponent(area)}`).then((r) => (r.ok ? (r.json() as Promise<Lens[]>) : [])).catch(() => [] as Lens[]);
export const loadBoards = (env: Env): Promise<PubBoard[]> => monitor(env, 'signal-public-boards').then((r) => (r.ok ? (r.json() as Promise<PubBoard[]>) : [])).catch(() => [] as PubBoard[]);

/**
 * The overview of an area (AI unless asked) for a lens and a window (1, 3 or 7 days). `boards` and `briefs` are passed by a caller that has them already (the page reads them for its menu); either may hold both areas, the area picks.
 * Papers, feed pages and what was read most are not tagged with an area: they belong to AI, so a politics overview has none of them.
 */
export async function loadOverview(env: Env, o: { window: LandingWindow; lens?: string | null; boards?: PubBoard[]; briefs?: BriefIn[]; area?: Area; /** A signed-in reader's own lenses of the area (src/site/me.ts): chosen like the site's. */ own?: Lens[]; /** Also read the layouts of the last days, for the landscape's replay (the landing page's frame; the MCP tool does not). */ replay?: boolean }): Promise<OverviewData> {
  const win = o.window, area = o.area ?? 'ai';
  const [lenses, boards, briefs] = await Promise.all([
    loadLenses(env, area),
    o.boards ? Promise.resolve(o.boards) : loadBoards(env),
    o.briefs ? Promise.resolve(o.briefs) : env.PUBLISH.getByName('main').fetch(new Request('https://internal/pub/topics')).then((r) => (r.ok ? (r.json() as Promise<PubTopic[]>) : [])).then((ts) => briefsOf(topicsOfArea(ts, area))).catch(() => [] as BriefIn[]),
  ]);
  lenses.push(...(o.own ?? []));
  const lens = chosenLens(lenses, o.lens), board = pickBoard(boards, area);
  const signal = (days: number) => (board ? monitor(env, `signal-public?slug=${board.slug}&days=${days}`).then((r) => (r.ok ? (r.json() as Promise<PubSignal>) : null)).then((d) => (d?.top ? d : null)).catch(() => null) : Promise.resolve(null));
  const [sig, sig7, landscape, replay, ladder] = await Promise.all([signal(win), win === 7 ? null : signal(7),
    board ? monitor(env, `landscape-public?slug=${board.slug}&days=${win}`).then((r) => (r.ok ? (r.json() as Promise<Layout | null>) : null)).catch(() => null) : null,
    board && o.replay && !lens ? monitor(env, `landscape-replay-public?slug=${board.slug}&days=${win}`).then((r) => (r.ok ? (r.json() as Promise<ReplayFrame[]>) : null)).catch(() => null) : null,
    board ? monitor(env, `ladder-public?slug=${board.slug}`).then((r) => (r.ok ? (r.json() as Promise<LadderRaw | null>) : null)).catch(() => null) : null]);
  // The cards and the streamgraph want a daily count each: ask for the topics that will be on them (the cards take the first six, the stream up to STREAM_TOPICS).
  const cardTerms = sig ? rankList(sig.top as SigTopic[], lens, 15).rows.filter((r) => !r.part && (!lens || r.inLens)).slice(0, STREAM_TOPICS).map((r) => r.topic.term.toLowerCase()) : [];
  let extras = await monitor(env, `landing-public?spark=${encodeURIComponent(cardTerms.join('|'))}${board && area !== 'ai' ? '&board=' + encodeURIComponent(board.slug) : ''}`).then((r) => (r.ok ? (r.json() as Promise<LandingExtras>) : null)).catch(() => null);
  if (extras && area !== 'ai') extras = { ...extras, papers: [], risingResearch: [], reads: [] };
  return { area, window: win, lenses, lens, board, sig, sig7: win === 7 ? sig : sig7, extras, briefs, landscape: landscape ?? null, replay: replay ?? null, ladder: ladder ?? null };
}

/** The Depth chart of an area (the page /rising, /rising.json and the MCP tool `get_rising`): the first published Signal's topics by breadth over 14 days, with the lens applied. Null when there is nothing to draw. */
export async function loadRising(env: Env, o: { area?: Area; lens?: string | null; boards?: PubBoard[]; own?: Lens[]; origin: string }): Promise<RisingData | null> {
  const area = o.area ?? 'ai', [lenses, boards] = await Promise.all([loadLenses(env, area), o.boards ? Promise.resolve(o.boards) : loadBoards(env)]);
  lenses.push(...(o.own ?? []));
  const board = pickBoard(boards, area);
  if (!board) return null;
  const raw = await monitor(env, `depth-public?slug=${encodeURIComponent(board.slug)}`).then((r) => (r.ok ? (r.json() as Promise<DepthRaw | null>) : null)).catch(() => null);
  return risingOf(raw, { area, lens: chosenLens(lenses, o.lens), lenses, origin: o.origin });
}
