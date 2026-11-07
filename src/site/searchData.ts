// The one function that runs a search for everything that shows one: the page /search and the public MCP tool `search`.
// Topics, items and papers are found in the Monitor object, briefings in the Publish object; both only look at what the public pages already show.
import type { Area } from '../signal/area';
import { SEARCH_KINDS, cleanQuery, emptyAnswer, queryWords, sliceFor, type Part, type SearchAnswer, type SearchBriefing, type SearchKind } from './search.ts';

type Found = Pick<SearchAnswer, 'topics' | 'items' | 'papers'>;
const ok = async <T>(r: Response): Promise<T | null> => { if (!r.ok) { await r.body?.cancel(); return null; } return (await r.json().catch(() => null)) as T | null; };

/** Asks both objects for `per` results of each of `kinds`, from `offset`. A failure leaves that kind empty: the rest of the page still shows. */
async function ask(env: Env, q: string, kinds: SearchKind[], window: number, lens: string | undefined, per: number, offset: number, area: Area): Promise<Partial<Pick<SearchAnswer, SearchKind>>> {
  const monKinds = kinds.filter((k) => k !== 'briefings'), page = { per: String(per), offset: String(offset), area };
  const [found, briefs] = await Promise.all([
    monKinds.length ? env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/search-public?' + new URLSearchParams({ q, kinds: monKinds.join(','), window: String(window), ...page, ...(lens ? { lens } : {}) }))).then((r) => ok<Found>(r)).catch(() => null) : null,
    kinds.includes('briefings') ? env.PUBLISH.getByName('main').fetch(new Request('https://internal/pub/search?' + new URLSearchParams({ q, window: String(window), ...page }))).then((r) => ok<Part<SearchBriefing>>(r)).catch(() => null) : null,
  ]);
  return { ...(found ?? {}), ...(briefs ? { briefings: briefs } : {}) };
}

/**
 * `per` and `offset` default to what the page shows for these kinds (a short preview of each, or a page of one). With one kind, the others are still counted (one result each) so the page can show how many there are.
 * A search that is too short finds nothing and asks nothing.
 */
export async function loadSearch(env: Env, p: { q: string; kinds: SearchKind[]; window: number; lens?: string; page?: number; per?: number; offset?: number; /** Which area to search (default AI): a politics search sees politics Signals and briefings only. */ area?: Area }): Promise<SearchAnswer> {
  const area = p.area ?? 'ai', q = cleanQuery(p.q), page = p.page ?? 1, def = sliceFor(p.kinds, page), per = p.per ?? def.per, offset = p.offset ?? def.offset;
  const out = emptyAnswer(q, p.window, p.kinds, page, per);
  if (!queryWords(q).length) return out;
  const rest = SEARCH_KINDS.filter((k) => !p.kinds.includes(k));
  const [main, counts] = await Promise.all([ask(env, q, p.kinds, p.window, p.lens, per, offset, area), p.per === undefined && rest.length ? ask(env, q, rest, p.window, p.lens, 1, 0, area) : {}]);
  return { ...out, ...counts, ...main };
}
