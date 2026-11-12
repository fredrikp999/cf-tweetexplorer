// The ordered list of topics behind a `from=` (A4, src/signal/trail.ts): the lens's ranking as the landing page shows it, a search's topics, or the topics a briefing's themes touch, in the order of the themes.
// The topic page, the peek and the MCP tool `get_topic` read it to say what comes before and after. Reuses the readers the landing page and the search already use, and never fails: a list that cannot be made is empty.
import { pickBoard, type Area } from '../signal/area';
import { chosenLens, type Lens } from '../signal/lens';
import { topicSlug } from '../signal/topicpage';
import { FROM_LIST, fromValue, uniqueTopics, type From } from '../signal/trail';
import { isMeta, sectionsOf } from './brief';
import { hasName, rankList, type SigTopic } from './landing';
import { loadBoards, loadLenses } from './overview';
import { loadSearch } from './searchData';
import type { PubBoard, PubSignal } from './public';

export interface TrailTopic { slug: string; label: string }
const monitor = (env: Env, path: string) => env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/' + path));
/** A minute in this isolate: walking through a list asks for the same list on every page. */
const kept = new Map<string, { at: number; v: TrailTopic[] }>();

/** The topics of an origin, in its order (at most FROM_LIST). `boards` and `lenses` are passed by a caller that has them already. */
export async function resolveFrom(env: Env, from: From, o: { area: Area; boards?: PubBoard[]; lenses?: Lens[] }): Promise<TrailTopic[]> {
  const key = `${o.area}|${fromValue(from)}`, hit = kept.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let list: TrailTopic[] = [];
  try {
    if (from.kind === 'lens') list = await lensList(env, from, o);
    else if (from.kind === 'search') list = (await loadSearch(env, { q: from.q, kinds: ['topics'], window: 14, page: 1, per: 15, offset: 0, area: o.area })).topics.list.map((t) => ({ slug: t.slug, label: t.label }));
    else list = await briefingList(env, from, o);
  } catch { list = []; }
  list = uniqueTopics(list, FROM_LIST);
  if (kept.size > 50) kept.clear();
  kept.set(key, { at: Date.now(), v: list });
  return list;
}

async function lensList(env: Env, from: Extract<From, { kind: 'lens' }>, o: { area: Area; boards?: PubBoard[]; lenses?: Lens[] }): Promise<TrailTopic[]> {
  const [boards, lenses] = await Promise.all([o.boards ?? loadBoards(env), o.lenses ?? loadLenses(env, o.area)]);
  const board = pickBoard(boards, o.area), lens = from.key === 'all' ? undefined : chosenLens(lenses, from.key);
  if (!board || (from.key !== 'all' && !lens)) return [];
  const r = await monitor(env, `signal-public?slug=${encodeURIComponent(board.slug)}&days=${from.window}`);
  const sig = r.ok ? ((await r.json()) as PubSignal | null) : null;
  if (!sig?.top) return [];
  return rankList(sig.top as unknown as SigTopic[], lens, FROM_LIST, true).rows.map((x) => ({ slug: topicSlug(x.topic.term), label: x.topic.label }));
}

/** The topics a briefing's themes touch, theme by theme (the chips the briefing page shows under each theme). */
async function briefingList(env: Env, from: Extract<From, { kind: 'briefing' }>, o: { area: Area; boards?: PubBoard[] }): Promise<TrailTopic[]> {
  const boards = o.boards ?? await loadBoards(env), board = pickBoard(boards, o.area);
  if (!board) return [];
  const [pr, sr] = await Promise.all([env.PUBLISH.getByName('main').fetch(new Request(`https://internal/pub/issue?slug=${from.slug}&id=${from.id}`)), monitor(env, `signal-public?slug=${encodeURIComponent(board.slug)}&days=7`)]);
  if (!pr.ok || !sr.ok) { await pr.body?.cancel(); await sr.body?.cancel(); return []; }
  const page = (await pr.json()) as { issue: { markdown: string } }, sig = (await sr.json()) as PubSignal | null;
  const terms = (sig?.top ?? []) as unknown as SigTopic[], out: TrailTopic[] = [];
  for (const sec of sectionsOf(page.issue.markdown).filter((x) => !isMeta(x.title))) {
    const text = `${sec.title}\n${sec.body}`;
    for (const t of terms) if ([t.label, t.term].some((x) => hasName(text, x))) out.push({ slug: topicSlug(t.term), label: t.label });
  }
  return out;
}
