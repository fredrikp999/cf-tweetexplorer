// One function that assembles a topic for everything that shows one: the page /t/<slug>, its JSON at /t/<slug>.json and, in later steps, the MCP `get_topic` tool and the topic hub view.
// The Monitor gathers the numbers, evidence, papers and summary (`/mon/topic-public`); the briefings that mention the topic live in the Publish object (`/pub/mentions`).
import { topicHref, type Area } from '../signal/area';
import { ITEM_ID, type CardTopic, type SourceCard } from '../signal/sourcecard';
import type { BrushAsk } from '../signal/brush';
import { TOPIC_SLUG, type TopicBriefing, type TopicData } from '../signal/topicpage';
import type { TopicBrief } from '../signal/trail';

export type TopicLoad = { data: TopicData } | { redirect: string } | null;

/**
 * The topic at `slug`, with its briefings. `{ redirect }` when the address is a name counted under a bigger topic (the page then lives at that topic's own address).
 * Null when no published Signal has it. Never starts a model call: the summary was written ahead of time.
 */
export async function loadTopic(env: Env, slug: string, opts: { /** The MCP server only reads: it does not wake the summary writer the way a page does. */ quiet?: boolean; /** The area a link came from: the same address can be a topic in both areas, and this one wins (else AI). */ area?: Area | null; /** The day, kind and order asked for the Talk list (A5); checked by the Monitor. The JSON of a topic never passes it. */ brush?: BrushAsk } = {}): Promise<TopicLoad> {
  if (!TOPIC_SLUG.test(slug)) return null;
  const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/topic-public?slug=${encodeURIComponent(slug)}${opts.quiet ? '&quiet=1' : ''}${opts.area ? '&area=' + opts.area : ''}${opts.brush?.day ? '&day=' + encodeURIComponent(opts.brush.day) : ''}${opts.brush?.kind ? '&kind=' + encodeURIComponent(opts.brush.kind) : ''}${opts.brush?.sort ? '&sort=' + encodeURIComponent(opts.brush.sort) : ''}`));
  if (!r.ok) { await r.body?.cancel(); return null; }
  const data = (await r.json().catch(() => null)) as TopicData | null;
  if (!data?.slug) return null;
  if (data.slug !== slug) return { redirect: topicHref(data.slug, data.area) };
  const names = [data.label, data.term, ...data.members].filter((x, i, a) => a.indexOf(x) === i).join('|');
  data.briefings = await env.PUBLISH.getByName('main').fetch(new Request(`https://internal/pub/mentions?q=${encodeURIComponent(names)}&area=${data.area}`))
    .then((x) => (x.ok ? (x.json() as Promise<TopicBriefing[]>) : [])).catch(() => [] as TopicBriefing[]);
  return { data };
}

export type CardLoad =
  | { card: SourceCard }
  | { redirect: string }
  /** The item is no longer in the topic: only its original can be pointed to. */
  | { gone: { topic: CardTopic; original: string; discussionUrl: string } }
  | null;

/**
 * The source card of one item of a topic (src/signal/sourcecard.ts), for the page /t/<slug>/i/<id>, its JSON and the MCP tool `get_item`. Null when there is no such topic or nobody can tell the id is real
 * (404); `gone` when the item has left the topic (410). `redirect` is the topic's own slug when `slug` is a name counted under a bigger topic. Never starts a model call.
 */
export async function loadItemCard(env: Env, slug: string, id: string, area?: Area | null): Promise<CardLoad> {
  if (!TOPIC_SLUG.test(slug) || !ITEM_ID.test(id)) return null;
  const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/topic-item-public?slug=${encodeURIComponent(slug)}&item=${id}${area ? '&area=' + area : ''}`));
  if (!r.ok) { await r.body?.cancel(); return null; }
  const d = (await r.json().catch(() => null)) as { found: boolean; redirect?: string; gone?: boolean; topic?: CardTopic; original?: string; discussionUrl?: string; card?: SourceCard } | null;
  if (!d?.found) return null;
  if (d.redirect) return { redirect: d.redirect };
  if (d.gone && d.topic && d.original) return { gone: { topic: d.topic, original: d.original, discussionUrl: d.discussionUrl ?? '' } };
  return d.card ? { card: d.card } : null;
}

/** The small card of one topic (state, 14 days, one line) for /t/<slug>/peek: much lighter than the whole topic. Null when no published Signal has it. */
export async function loadPeek(env: Env, slug: string, area?: Area | null): Promise<TopicBrief | null> {
  if (!TOPIC_SLUG.test(slug)) return null;
  const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/topic-peek?slug=${encodeURIComponent(slug)}${area ? '&area=' + area : ''}`));
  if (!r.ok) { await r.body?.cancel(); return null; }
  const d = (await r.json().catch(() => null)) as TopicBrief | null;
  return d?.slug ? d : null;
}
