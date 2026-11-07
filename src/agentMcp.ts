// The public MCP server (INTENT.md section 10): the same three zoom levels as the site, as text an agent can read and cite. Address /agent/mcp, no sign-in.
// It shows exactly what the public site shows (published briefings, published Signals, public research) and nothing from the admin: every read below is one the site's own pages make.
// Read only; a request never starts a model call, a job or any spending (summaries are written ahead of time). Streamable HTTP, stateless, POST only, like the private server in mcp.ts.
// The same tools and prompts are registered on the private server too (registerAgentTools), so one connector is enough for the owner.
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { ARXIV_THANKS } from './sources/arxiv';
import { SLUG } from './durable-objects/publish';
import { areaOf, publishedAreas, type Area } from './signal/area';
import { TOPIC_SLUG, topicSlug } from './signal/topicpage';
import { loadTopic } from './site/topicData';
import type { TopicData } from './signal/topicpage';
import landscapeHtml from './apps/landscape';
import mapHtml from './apps/map';
import topicHubHtml from './apps/topichub';
import { loadLenses, loadOverview } from './site/overview';
import { SEARCH_KINDS, SEARCH_WINDOWS, cleanQuery, windowOfSearch } from './site/search';
import { loadSearch } from './site/searchData';
import { boardFirstOut, briefingMissing, briefingOut, bucketWindow, catchUpPrompt, digIntoPrompt, itemsOut, listLensesOut, overviewOut, paperMissing, paperOut, papersOut, searchOut, topicFirstOut, topicMissing, topicOut,
  type Answer, type BoardFirstIn, type BriefingIn, type Detail, type ItemsIn, type PaperIn } from './site/agentText';

/** The Landscape view of get_overview. Bump the suffix when the page changes: hosts keep the resource they were given. */
/** v3: the view keeps the area of the data it was given (politics has its own lenses) and passes it back to get_overview. */
export const LANDSCAPE_UI = 'ui://agent-cortex/landscape-v3.html';
/** The Topic hub, the view of get_topic. */
export const TOPIC_UI = 'ui://agent-cortex/topic-v2.html';
/** The Research map, the view of get_papers (it reads its data with get_research_map). */
export const MAP_UI = 'ui://agent-cortex/research-map-v2.html';
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const ISSUE_ID = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;
const PAPER_ID = /^\d{4}\.\d{4,5}$/;
/** Answers are kept for two minutes, like the data behind them. */
const CACHE_SECONDS = 120;
const MAX_BODY = 64 * 1024;

const mon = (env: Env, path: string) => env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/' + path));
const pub = (env: Env, path: string) => env.PUBLISH.getByName('main').fetch(new Request('https://internal' + path));
const json = async <T>(r: Response): Promise<T | null> => { if (!r.ok) { await r.body?.cancel(); return null; } return (await r.json().catch(() => null)) as T | null; };

/** A topic as an agent may name it: its address, or a name that makes one ("MCP auth bypass"). */
const code = (v: string): string => '`' + v + '`';
const asSlug = (v: string): string => { const t = v.trim().toLowerCase(); return TOPIC_SLUG.test(t) ? t : topicSlug(v); };

/**
 * A topic by address or name, in the area asked for (else AI, else wherever it is). A name counted under a bigger topic opens that topic: its own page is read.
 * Null when no published Signal has it.
 */
async function findTopic(env: Env, name: string, area?: Area): Promise<TopicData | null> {
  let r = await loadTopic(env, asSlug(name), { quiet: true, area });
  if (r && 'redirect' in r) r = await loadTopic(env, r.redirect.slice('/t/'.length).split('?')[0], { quiet: true, area });
  return !r || 'redirect' in r ? null : r.data;
}

/** The deployed version is part of the key, so a deploy never serves an answer worded by the version before. */
async function cached(env: Env, origin: string, tool: string, args: unknown, make: () => Promise<Answer>): Promise<Answer> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const ver = (env as { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA?.id ?? '';
  const key = new Request(`${origin}/agent/cache/${tool}?${new URLSearchParams({ a: JSON.stringify(args), v: ver })}`, { method: 'GET' });
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) { const a = (await hit.json().catch(() => null)) as Answer | null; if (a?.text) return a; }
  const a = await make();
  if (!a.error && cache) await cache.put(key, new Response(JSON.stringify(a), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${CACHE_SECONDS}` } })).catch(() => undefined);
  return a;
}
const reply = (a: Answer) => ({ ...(a.error ? { isError: true } : {}), content: [{ type: 'text' as const, text: a.text }], structuredContent: a.data });
const oops = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });

const detailArg = z.enum(['brief', 'full']).default('brief').describe('"brief" (about 1,500 tokens) or "full" (about four times that)');
const areaArg = z.enum(['ai', 'politics']).default('ai').describe('"ai" (default) or "politics": each has its own lenses, topics and briefings, and an AI answer never includes politics topics');
const areaHintArg = z.enum(['ai', 'politics']).optional().describe('Only needed when the same name is a topic in both areas: which one you mean (AI when left out)');
const topicArg = z.string().min(1).max(64).describe('A topic address such as "mcp-auth-bypass" (as shown by get_overview), or its name');

/**
 * The tools and prompts of the public server. `origin` is the site's address (links in the answers are absolute, so an agent can cite them).
 * Names do not clash with the private server's tools (get_briefing_issue, get_research_papers...).
 */
export function registerAgentTools(server: McpServer, env: Env, origin: string, opts: { /** The private server: it keeps its own owner-only get_who_said_first (all groups, days and board), so the public one is not registered there. */ owner?: boolean } = {}): void {
  const run = (tool: string, args: unknown, make: () => Promise<Answer>) =>
    cached(env, origin, tool, args, make).then(reply).catch((err) => { console.error('agent tool failed', tool, err instanceof Error ? err.message : String(err)); return oops('This could not be read right now. Please try again in a moment.'); });

  server.registerTool('list_lenses', {
    title: 'List the areas and lenses',
    description: 'The areas of the site (AI and Politics) and their lenses, with a line each. A lens orders and highlights topics by an area of interest (Security, Agentic engineering, Observability...); it never hides anything. Start here if you do not know which lens to use.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, () => run('list_lenses', {}, async () => {
    const [ai, politics, boards, topics] = await Promise.all([loadLenses(env, 'ai'), loadLenses(env, 'politics'), json<Array<{ area?: Area }>>(await mon(env, 'signal-public-boards')), json<Array<{ area?: Area }>>(await pub(env, '/pub/topics'))]);
    return listLensesOut({ ai, politics }, origin, publishedAreas(boards ?? [], topics ?? []));
  }));

  // Hosts with MCP Apps draw the landscape (bubbles of the topics, in clusters) under the answer; the text answer is unchanged, so the others lose nothing. The data for it is `landscape` in structuredContent.
  registerAppTool(server, 'get_overview', {
    title: 'Overview: what is going on',
    description: 'Level 1: what is going on in an area right now (AI by default; `area: "politics"` for politics, which has its own lenses, topics and briefings). In brief (from the day\'s briefings), new and rising topics, the top topics with one line each and where their score comes from, research in short, and what is big outside the chosen lens. Topic addresses in the answer go to get_topic.',
    inputSchema: { area: areaArg, lens: z.string().max(20).optional().describe('A lens key from list_lenses (of the same area); its topics come first'),
      window: z.number().int().min(1).max(7).default(1).describe('Days to look at: 1, 3 or 7 (other numbers use the next window up)'), detail: detailArg },
    annotations: READ_ONLY,
    _meta: { ui: { resourceUri: LANDSCAPE_UI } },
  }, ({ area, lens, window, detail }) => {
    const w = bucketWindow(window);
    return run('get_overview', { area, lens, w, detail }, async () => overviewOut(await loadOverview(env, { window: w, lens, area }), origin, detail as Detail));
  });

  registerAppResource(server, 'Landscape', LANDSCAPE_UI, { mimeType: RESOURCE_MIME_TYPE },
    async () => ({ contents: [{ uri: LANDSCAPE_UI, mimeType: RESOURCE_MIME_TYPE, text: landscapeHtml }] }));

  // The Topic hub is drawn under the text answer, which is unchanged. The hub reads `structuredContent` and pages through get_topic_items itself.
  registerAppTool(server, 'get_topic', {
    title: 'Topic: what is this about',
    description: 'Level 2: one topic. The written summary, its state (new, rising, steady, falling), the evidence per kind of source (each in its own unit, never added together), top items, papers on the subject, briefings that covered it and related topics. Every line links to the original and to the topic page.',
    inputSchema: { topic: topicArg, area: areaHintArg, window: z.number().int().min(1).max(14).default(7).describe('Days for the count of mentions (the evidence always covers the last 7 days)'), detail: detailArg },
    annotations: READ_ONLY,
    _meta: { ui: { resourceUri: TOPIC_UI } },
  }, ({ topic, area, window, detail }) => run('get_topic', { topic: asSlug(topic), area, window, detail }, async () => {
    const d = await findTopic(env, topic, area);   // a name counted under a bigger topic opens that topic's own page; the answer says which area the topic is in
    return d ? topicOut(d, origin, detail as Detail, window) : topicMissing(topic, origin);
  }));

  registerAppResource(server, 'Topic hub', TOPIC_UI, { mimeType: RESOURCE_MIME_TYPE },
    async () => ({ contents: [{ uri: TOPIC_UI, mimeType: RESOURCE_MIME_TYPE, text: topicHubHtml }] }));

  server.registerTool('get_topic_items', {
    title: 'Topic items: show me the sources',
    description: 'Level 3: the items behind a topic (posts, threads, articles, videos) with author, time, reactions in the source\'s own unit and the link to the original, 25 a page. Newest first or most reacted first; filter by kind of source. Follow nextCursor for the next page. Only for Signals that show their sources.',
    inputSchema: { topic: topicArg, kind: z.enum(['x', 'hn', 'youtube', 'rss']).optional().describe('Only this kind of source: x, hn (Hacker News), youtube, rss (blogs and news)'),
      sort: z.enum(['new', 'top']).default('new').describe('new: newest first; top: most reacted first'), area: areaHintArg, cursor: z.string().regex(/^\d{1,4}$/).optional().describe('nextCursor from the previous page'), detail: detailArg },
    annotations: READ_ONLY,
  }, ({ topic, kind, sort, area, cursor, detail }) => run('get_topic_items', { topic: asSlug(topic), kind, sort, area, cursor, detail }, async () => {
    const offset = cursor ? Number(cursor) : 0, slug = asSlug(topic);
    const p = new URLSearchParams({ slug, sort, offset: String(offset), ...(kind ? { kind } : {}), ...(area ? { area } : {}) });
    const r = await json<ItemsIn>(await mon(env, `topic-items-public?${p}`));
    return itemsOut(r ?? { found: false }, { topic, kind, sort, offset }, origin, detail as Detail);
  }));

  // Who said it first. Public data only, text and JSON (no view: the ripple view draws waves across groups, which is not this answer's shape; the topic hub's "Who said it first" tab draws it).
  // The private server has a tool of the same name for the owner (days, board, all groups) with the ripple view; that one stays, and this is not registered there.
  if (!opts.owner) server.registerTool('get_who_said_first', {
    title: 'Who said it first',
    description: 'The order the kinds of source (X, Hacker News, YouTube, blogs and news) had a topic in, in words: "first seen on Hacker News 09:12, then X from 10:40, blogs from 14:00". With `topic`, for that topic\'s latest wave of mentions; without it, which groups of sources tend to be early across all topics, and the latest topic starts. It is the order among the sources followed here, by publication time; it does not say where a story began. Items are named only on Signals that show their sources.',
    inputSchema: { topic: topicArg.optional().describe('A topic address or name; leave out for the overview across all topics'), area: areaArg.describe('Without a topic: which area\'s Signals to compare ("ai" by default). With a topic: the area to prefer if the name is a topic in both'), window: z.number().int().min(1).max(14).default(7).describe('Days to look back: the topic\'s wave should have begun inside it. Without a topic: 7 or 14'), detail: detailArg },
    annotations: READ_ONLY,
  }, ({ topic, area, window, detail }) => run('get_who_said_first', { topic: topic && asSlug(topic), area, window, detail }, async () => {
    if (topic) {
      const d = await findTopic(env, topic, area);
      return d ? topicFirstOut(d, origin, window, Date.now(), detail as Detail) : topicMissing(topic, origin);
    }
    const boards = ((await json<Array<{ slug: string; title: string; area?: Area }>>(await mon(env, 'signal-public-boards'))) ?? []).filter((b) => areaOf(b) === area);
    const days = window <= 7 ? 7 : 14;
    for (const b of boards) {   // the first published Signal that has at least two groups to compare
      const r = await json<BoardFirstIn>(await mon(env, `first-public?slug=${encodeURIComponent(b.slug)}&days=${days}`));
      if (r && r.groups.length > 1) return boardFirstOut(r, b, origin, detail as Detail);
    }
    return { text: `No published Signal has two or more groups of sources to compare yet. Try ${code('get_who_said_first')} with a ${code('topic')}.`, data: { error: 'nothing to compare' }, error: true };
  }));

  // Search across everything the site shows. Topics first; each result links to the original and, for an item, to its topic page. Read only; the words are looked up in the objects that hold the data, bounded.
  server.registerTool('search', {
    title: 'Search topics, items, papers and briefings',
    description: 'Find things by words: topics (by name, by a name counted under them, or by their summary), items (posts, articles, videos and threads of the Signals and feed pages shown on the site), papers (title and abstract) and briefings (headline and themes). Results are grouped by kind, topics first, best match first; each has a link to the original and the Next: line names the tool that opens it (get_topic, get_paper, get_briefing). Words must all appear; the last may be the start of a word.',
    inputSchema: { query: z.string().min(2).max(80).describe('Words to look for, e.g. "MCP security". At most six words are used.'),
      kinds: z.array(z.enum(SEARCH_KINDS)).max(4).optional().describe('Only these kinds of result: topics, items, papers, briefings. All when left out.'),
      area: areaArg, lens: z.string().max(20).optional().describe('A lens key from list_lenses (of the same area): its topics and papers come first among equally good matches; nothing is hidden'),
      window: z.number().int().min(1).max(30).default(14).describe(`Days to look back for items, papers and briefings: ${SEARCH_WINDOWS.join(', ')} (other numbers use the default 14; items go back 14 days at most). Topics are always the ones in the Signals now.`), detail: detailArg },
    annotations: READ_ONLY,
  }, ({ query, kinds, area, lens, window, detail }) => {
    const q = cleanQuery(query), w = windowOfSearch(window), ks = kinds?.length ? SEARCH_KINDS.filter((k) => kinds.includes(k)) : [...SEARCH_KINDS], per = detail === 'full' ? 10 : 5;
    return run('search', { q: q.toLowerCase(), ks, area, lens, w, detail }, async () => {
      const lenses = await loadLenses(env, area), picked = lens ? lenses.find((l) => l.key === lens) : undefined;
      return searchOut(await loadSearch(env, { q, kinds: ks, window: w, lens: picked?.key, per, offset: 0, area }), origin, picked?.name, detail as Detail, area);
    });
  });

  server.registerTool('get_briefing', {
    title: 'A briefing',
    description: 'A published briefing with its TL;DR, themes and sources. `topic` is the briefing topic\'s address (not a Signal topic): an unknown one answers with the list of briefing topics. `day` is an issue id such as "2026-11-07"; leave it out for the latest.',
    inputSchema: { topic: z.string().min(1).max(40).describe('The briefing topic address, e.g. "ai"'), day: z.string().max(14).optional().describe('An issue id, e.g. "2026-11-07"; latest when left out'), detail: detailArg },
    annotations: READ_ONLY,
  }, ({ topic, day, detail }) => run('get_briefing', { topic, day, detail }, async () => {
    const slug = topic.trim().toLowerCase();
    const list = async () => ((await json<Array<{ slug: string; title: string; latest: { publishedAt: number } }>>(await pub(env, '/pub/topics'))) ?? []);
    if (!SLUG.test(slug) || (day && !ISSUE_ID.test(day))) return briefingMissing(topic, day, await list(), origin);
    const r = await json<BriefingIn>(await pub(env, day ? `/pub/issue?slug=${slug}&id=${day}` : `/pub/topic?slug=${slug}`));
    return r ? briefingOut(r, origin, detail as Detail) : briefingMissing(topic, day, await list(), origin);
  }));

  // Hosts with MCP Apps draw the Research map under the answer. The map needs the whole month, which does not belong in the text, so the view asks for it with get_research_map (app only). The scope of the call (words, topic, only discussed) preselects the map's filters.
  registerAppTool(server, 'get_papers', {
    title: 'Research papers',
    description: 'Papers of the last 30 days with abstract and uptake (how many posts, Hacker News stories or Hugging Face upvotes name each). Filter by a topic, a cluster of the Research map (numbers come with the answer), words, or only those being discussed. Abstracts only.',
    inputSchema: { topic: z.string().min(1).max(64).optional().describe('A Signal topic address: papers on that subject'), cluster: z.number().int().min(0).max(500).optional().describe('A cluster number from the Research map'),
      query: z.string().max(80).optional().describe('Words that must all be in the title or abstract'), discussed_only: z.boolean().default(false).describe('Only papers that are being discussed'), detail: detailArg },
    annotations: READ_ONLY,
    _meta: { ui: { resourceUri: MAP_UI } },
  }, ({ topic, cluster, query, discussed_only, detail }) => run('get_papers', { topic: topic && asSlug(topic), cluster, query, discussed_only, detail }, async () => {
    const d = detail as Detail, limit = d === 'full' ? 25 : 8;
    if (topic) {
      const found = await findTopic(env, topic);
      if (!found) return topicMissing(topic, origin);
      const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const list = found.papers.list.filter((p) => (!discussed_only || p.attention.hf || p.attention.hn || p.attention.accounts) && words.every((w) => `${p.title} ${p.abstract}`.toLowerCase().includes(w)))
        .map((p): PaperIn => ({ id: p.id, published: p.published, title: p.title, authors: p.authors, categories: p.categories, abstract: p.abstract, absUrl: p.absUrl, attention: { hf: p.attention.hf ?? null, hn: p.attention.hn ?? null, accounts: p.attention.accounts } }));
      return papersOut({ total: list.length, papers: list }, { topic: { slug: found.slug, label: found.label }, discussedOnly: discussed_only, query }, origin, d);
    }
    const p = new URLSearchParams({ limit: String(limit), ...(query ? { q: query } : {}), ...(cluster !== undefined ? { cluster: String(cluster) } : {}), ...(discussed_only ? { discussed: '1' } : {}) });
    const r = await json<{ total: number; papers: PaperIn[]; clusters: Array<{ id: number; name: string; summary: string; papers: number; discussed: number }> }>(await mon(env, `papers-public?${p}`));
    return r ? papersOut(r, { cluster, query, discussedOnly: discussed_only }, origin, d) : papersOut({ total: 0, papers: [] }, { cluster, query, discussedOnly: discussed_only }, origin, d);
  }));

  registerAppResource(server, 'Research map', MAP_UI, { mimeType: RESOURCE_MIME_TYPE },
    async () => ({ contents: [{ uri: MAP_UI, mimeType: RESOURCE_MIME_TYPE, text: mapHtml }] }));

  // View only (visibility "app": the model is not offered it). The same public JSON as /research/map.json: every paper of the month as one short row, grouped by subject; abstracts are fetched one at a time with get_paper.
  registerAppTool(server, 'get_research_map', {
    title: 'Research map data (for the view)',
    description: 'The data behind the Research map view: the last 30 days of papers as short rows with their clusters. Meant for the view, not for reading; use get_papers.',
    inputSchema: {},
    annotations: READ_ONLY,
    _meta: { ui: { resourceUri: MAP_UI, visibility: ['app'] } },
  }, async () => {
    const r = await json<Record<string, unknown>>(await mon(env, 'research-map'));
    if (!r) return oops('The map could not be read right now.');
    const data = { ...r, thanks: ARXIV_THANKS };
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data };
  });

  server.registerTool('get_paper', {
    title: 'One paper',
    description: 'Level 3: one paper by its id (such as "2511.01234", from get_papers): the abstract, the link to its original abstract page, the Hacker News and Hugging Face pages, and every post that names it. Abstracts only: the full text is never read or stored.',
    inputSchema: { id: z.string().min(4).max(20).describe('The paper id, e.g. "2511.01234"'), detail: detailArg },
    annotations: READ_ONLY,
  }, ({ id, detail }) => run('get_paper', { id, detail }, async () => {
    const clean = id.trim().replace(/^(arxiv:|https?:\/\/arxiv\.org\/abs\/)/i, '').replace(/v\d+$/, '');
    if (!PAPER_ID.test(clean)) return paperMissing(id);
    const r = await json<PaperIn>(await mon(env, `paper-public?id=${clean}`));
    return r ? paperOut(r, origin, detail as Detail) : paperMissing(clean);
  }));

  // Prompts: a ready start that tells the agent which tools to call, and in which order.
  server.registerPrompt('catch_up', {
    title: 'Catch up',
    description: 'What did I miss? A short answer from the overview, the topics that are new or rising, and the papers being discussed.',
    argsSchema: { area: z.enum(['ai', 'politics']).optional().describe('"ai" (default) or "politics"'), lens: z.string().max(20).optional().describe('A lens key from list_lenses'), since: z.string().max(40).optional().describe('Since when, e.g. "yesterday", "Friday", "3 days"') },
  }, (a) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: catchUpPrompt(a) } }] }));

  server.registerPrompt('dig_into', {
    title: 'Dig into a topic',
    description: 'The full walk for one topic: summary, evidence, the items behind it, the papers and the briefings, with links to every original.',
    argsSchema: { topic: topicArg },
  }, (a) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: digIntoPrompt(a) } }] }));
}

// ---- the endpoint
// A page in a browser may call this server (it holds nothing private and sets no cookies), so any origin is allowed and no credentials are: a website cannot ride on anyone's login here, because there is none.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id', 'access-control-max-age': '86400' };
const INSTRUCTIONS = 'Agent Cortex: what is being talked about in AI (and, with area: "politics", in politics), as the public site shows it; the areas are kept apart. Start with get_overview (or the catch_up prompt), then get_topic for one topic, or search to find it by words (get_who_said_first for the order the sources had it in), get_topic_items for the originals, get_papers / get_paper for research and get_briefing for a briefing. Evidence is given per kind of source, each in its own unit. Read only.';

const rpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...headers } });

export async function handleAgentMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST, OPTIONS', ...CORS, 'cache-control': 'no-store' } });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return rpcError(413, 'The request is too large.');
  // At most 60 requests a minute per client address (the AGENT_LIMIT binding in wrangler.jsonc; counted per Cloudflare location, so the limit is approximate). Without the binding there is no limit.
  const who = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const ok = await env.AGENT_LIMIT?.limit({ key: who }).catch(() => ({ success: true }));
  if (ok && !ok.success) return rpcError(429, 'Too many requests: at most 60 a minute from one address. Please wait a minute.', { 'retry-after': '60' });
  const server = new McpServer({ name: 'agent-cortex', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerAgentTools(server, env, new URL(request.url).origin);
  // Stateless: a fresh server per request, no session, plain JSON answers.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(request);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  out.headers.set('cache-control', 'no-store');
  return out;
}
