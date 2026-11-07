// One function that assembles a topic for everything that shows one: the page /t/<slug>, its JSON at /t/<slug>.json and, in later steps, the MCP `get_topic` tool and the topic hub view.
// The Monitor gathers the numbers, evidence, papers and summary (`/mon/topic-public`); the briefings that mention the topic live in the Publish object (`/pub/mentions`).
import { topicHref, type Area } from '../signal/area';
import { TOPIC_SLUG, type TopicBriefing, type TopicData } from '../signal/topicpage';

export type TopicLoad = { data: TopicData } | { redirect: string } | null;

/**
 * The topic at `slug`, with its briefings. `{ redirect }` when the address is a name counted under a bigger topic (the page then lives at that topic's own address).
 * Null when no published Signal has it. Never starts a model call: the summary was written ahead of time.
 */
export async function loadTopic(env: Env, slug: string, opts: { /** The MCP server only reads: it does not wake the summary writer the way a page does. */ quiet?: boolean; /** The area a link came from: the same address can be a topic in both areas, and this one wins (else AI). */ area?: Area | null } = {}): Promise<TopicLoad> {
  if (!TOPIC_SLUG.test(slug)) return null;
  const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/topic-public?slug=${encodeURIComponent(slug)}${opts.quiet ? '&quiet=1' : ''}${opts.area ? '&area=' + opts.area : ''}`));
  if (!r.ok) { await r.body?.cancel(); return null; }
  const data = (await r.json().catch(() => null)) as TopicData | null;
  if (!data?.slug) return null;
  if (data.slug !== slug) return { redirect: topicHref(data.slug, data.area) };
  const names = [data.label, data.term, ...data.members].filter((x, i, a) => a.indexOf(x) === i).join('|');
  data.briefings = await env.PUBLISH.getByName('main').fetch(new Request(`https://internal/pub/mentions?q=${encodeURIComponent(names)}&area=${data.area}`))
    .then((x) => (x.ok ? (x.json() as Promise<TopicBriefing[]>) : [])).catch(() => [] as TopicBriefing[]);
  return { data };
}
