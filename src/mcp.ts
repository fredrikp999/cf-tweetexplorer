// A read-only MCP server (Streamable HTTP, stateless) over the data this app keeps: History, Briefings, Lists, Monitor, Costs.
// It lives at /mcp, behind its own Access application; index.ts verifies the JWT (against MCP_POLICY_AUD) before a request gets here.
// For clients that cannot do a browser login, use an Access service token (docs/deployment.md).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import costsHtml from './apps/costs';
import firstHtml from './apps/first';
import galaxyHtml from './apps/galaxy';
import signalHtml from './apps/signal';
import { GALAXY_PAGE } from './history/galaxy';

const MAX_TWEETS = 200;
const COSTS_UI = 'ui://tweet-explorer/costs-v7.html';
const SIGNAL_UI = 'ui://tweet-explorer/signal-v2.html';
const GALAXY_UI = 'ui://tweet-explorer/galaxy-v2.html';
const FIRST_UI = 'ui://tweet-explorer/first-v1.html';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const failure = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });

function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: 'tweet-explorer', version: '0.1.0' });

  // The Durable Objects take the same internal requests the admin app's routes forward to them.
  const ask = async (ns: DurableObjectNamespace, path: string, params: Record<string, string | number | undefined> = {}) => {
    const u = new URL(path, 'https://internal');
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
    const res = await (ns as unknown as DurableObjectNamespace<Rpc.DurableObjectBranded>).getByName('main').fetch(new Request(u));
    const body: unknown = await res.json().catch(() => null);
    return res.ok ? text(body) : failure((body as { error?: string } | null)?.error ?? `request failed (${res.status})`);
  };
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool('list_history_jobs', {
    description: 'List History collections (a search run over a date range): id, query, status, tweet count, whether a report is published.',
    annotations: readOnly,
  }, () => ask(env.HISTORY, '/hist/jobs'));

  server.registerTool('get_history_job', {
    description: 'One History collection with its progress and settings.',
    inputSchema: { id: z.string() },
    annotations: readOnly,
  }, ({ id }) => ask(env.HISTORY, '/hist/job', { id }));

  server.registerTool('get_history_analysis', {
    description: 'The AI analysis of a History collection: themes, kinds, stance toward subjects, and the written summary. Null if none was run.',
    inputSchema: { id: z.string() },
    annotations: readOnly,
  }, async ({ id }) => {
    const res = await env.HISTORY.getByName('main').fetch(new Request(`https://internal/hist/analysis?id=${encodeURIComponent(id)}`));
    const body = (await res.json().catch(() => null)) as { analysis?: unknown; error?: string } | null;
    return res.ok ? text(body?.analysis ?? null) : failure(body?.error ?? `request failed (${res.status})`);
  });

  server.registerTool('get_history_tweets', {
    description: `Tweets collected by a History job, newest first (at most ${MAX_TWEETS} per call; page with offset).`,
    inputSchema: { id: z.string(), limit: z.number().int().min(1).max(MAX_TWEETS).default(50), offset: z.number().int().min(0).default(0) },
    annotations: readOnly,
  }, async ({ id, limit, offset }) => {
    const res = await env.HISTORY.getByName('main').fetch(new Request(`https://internal/hist/data?id=${encodeURIComponent(id)}`));
    if (!res.ok) return failure(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `request failed (${res.status})`);
    const all = (await res.json()) as unknown[];
    return text({ total: all.length, offset, tweets: all.slice(offset, offset + limit) });
  });

  server.registerTool('list_briefing_topics', {
    description: 'Briefing topics with their schedule, sources and the 30 most recent issues (drafts included).',
    annotations: readOnly,
  }, () => ask(env.PUBLISH, '/adm/topics'));

  server.registerTool('get_briefing_issue', {
    description: 'The full text of one briefing issue, draft or published.',
    inputSchema: { slug: z.string().describe('The topic address'), id: z.string() },
    annotations: readOnly,
  }, ({ slug, id }) => ask(env.PUBLISH, '/adm/issue', { slug, id }));

  server.registerTool('list_collection_sources', {
    description: 'The data collection layer: every source that is collected, how often, its health and limits hit, what it cost in the last 7 days, and which briefings, Signals and feed pages use it. Also shows the collection mode and how live fetches compare with the store.',
    annotations: readOnly,
  }, () => ask(env.COLLECT, '/collect/overview'));

  server.registerTool('get_collected_items', {
    description: `Items the collection layer has stored, newest first (at most 100 per call; page with offset). Filter by source id, kind, consumer ("briefing:<slug>"), words or days.`,
    inputSchema: { source: z.string().optional(), kind: z.enum(['x', 'rss', 'hn', 'youtube', 'arxiv']).optional(), consumer: z.string().optional(), q: z.string().optional(), days: z.number().int().min(1).max(90).optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) },
    annotations: readOnly,
  }, (a) => ask(env.COLLECT, '/collect/items', a));

  server.registerTool('get_research_pulse', {
    description: 'Research pulse: for each research topic, how many new arXiv papers it had in the last whole week, its share of all AI papers, and whether that share is a spike against the 8 weeks before. Thank you to arXiv for use of its open access interoperability.',
    inputSchema: {},
    annotations: readOnly,
  }, () => ask(env.MONITOR, '/mon/pulse'));

  server.registerTool('get_research_papers', {
    description: `One research topic's new arXiv papers: the few getting attention (Hugging Face upvotes, Hacker News points, collected posts that link to them), then all of them newest first, with abstracts. Topic slugs are in get_research_pulse. Thank you to arXiv for use of its open access interoperability.`,
    inputSchema: { slug: z.string().max(60), page: z.number().int().min(1).max(100).default(1) },
    annotations: readOnly,
  }, ({ slug, page }) => ask(env.MONITOR, '/mon/research-page', { slug, page }));

  server.registerTool('list_user_lists', {
    description: 'Your curated lists of accounts.',
    annotations: readOnly,
  }, () => ask(env.LISTS, '/lists/all'));

  server.registerTool('list_feed_lists', {
    description: 'Your feed lists: curated sets of RSS feeds, YouTube channels and Hacker News searches.',
    annotations: readOnly,
  }, () => ask(env.LISTS, '/lists/f-all'));

  server.registerTool('list_x_lists', {
    description: 'X Lists kept by reference, with their groups.',
    annotations: readOnly,
  }, () => ask(env.LISTS, '/lists/x-all'));

  server.registerTool('list_monitor_watches', {
    description: 'Monitor watches (X searches and accounts, RSS feeds, Hacker News), their status and today\'s spend.',
    annotations: readOnly,
  }, () => ask(env.MONITOR, '/mon/state'));

  server.registerTool('get_monitor_feed', {
    description: 'The most recent items the Monitor found, newest first: tweets, RSS items and Hacker News stories. Every item has a `source` (x, rss or hn); leave `source` out for all of them combined.',
    inputSchema: { limit: z.number().int().min(1).max(500).default(100), source: z.enum(['x', 'rss', 'hn', 'youtube', 'arxiv']).optional() },
    annotations: readOnly,
  }, ({ limit, source }) => ask(env.MONITOR, '/mon/feed', { limit, ...(source ? { source } : {}) }));

  // MCP Apps: hosts that support them show the Costs view inline; the others still get the JSON text.
  registerAppTool(server, 'get_costs', {
    description: 'Spend by feature over the last N days (twitterapi.io, language models, audio, pictures, embeddings, Cloudflare storage), and what is stored now.',
    inputSchema: { days: z.number().int().min(1).max(365).default(30) },
    annotations: readOnly,
    _meta: { ui: { resourceUri: COSTS_UI } },
  }, async ({ days }) => { const cost = env.COST.getByName('main'); try { await cost.measureStorage(); } catch { /* the costs still show */ } return text(await cost.summary(days)); });

  registerAppResource(server, 'Costs', COSTS_UI, { mimeType: RESOURCE_MIME_TYPE },
    async () => ({ contents: [{ uri: COSTS_UI, mimeType: RESOURCE_MIME_TYPE, text: costsHtml }] }));

  server.registerTool('get_signal_items', {
    description: 'The proof for a Signal topic: the actual items (title, link, source, date) that mention it, newest first, with how many come from each group and source. Use a term or topic name from get_signal; `terms` may list several that belong to one topic.',
    inputSchema: { terms: z.array(z.string()).min(1).max(12).describe('The term(s) to find, as named by get_signal'), days: z.number().int().min(1).max(14).default(7), group: z.string().optional().describe('Only items from this group (its key from get_signal)'), watch: z.string().optional().describe('Only items from this source (a watch id)'),
      limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0) },
    annotations: readOnly,
  }, ({ terms, days, group, watch, limit, offset }) => ask(env.MONITOR, '/mon/signal-items', { terms: terms.join('|'), days, group, watch, limit, offset }));

  // The Signal dashboard: the same JSON as the get_signal text, drawn as an interactive view (window, which Signal, strength or spread, and the items behind a topic via get_signal_items). Registered here, after the Costs view, so the two apps sit together.
  registerAppTool(server, 'get_signal', {
    description: 'Signal: the topics across all watched sources combined into one weighted score. Each source group (a feed list, a kind of source, or a name you gave it) has a weight; a term is scored by how large a share of each group\'s items mention it. Hosts with MCP Apps show it as an interactive dashboard (pick a window or a published Signal, open a topic to see the items behind it); other clients get this JSON. Returns the groups, the top terms, the rising terms, the terms found in most groups ("shared") and the terms found almost only in one group ("single"), each with the groups it comes from.',
    inputSchema: { days: z.number().int().min(1).max(14).default(7).describe('The window; it is compared with the same number of days before it'), steady: z.boolean().default(false).describe('Also list topics that are at the same level as in the period before (background); by default they are left out'), board: z.string().optional().describe('Only the groups of one top-level Signal (its id or address); the answer lists them under `boards`') },
    annotations: readOnly,
    _meta: { ui: { resourceUri: SIGNAL_UI } },
  }, ({ days, board, steady }) => ask(env.MONITOR, '/mon/signal', { days, board, steady: steady ? 1 : 0 }));

  registerAppResource(server, 'Signal', SIGNAL_UI, { mimeType: RESOURCE_MIME_TYPE },
    async () => ({ contents: [{ uri: SIGNAL_UI, mimeType: RESOURCE_MIME_TYPE, text: signalHtml }] }));

  registerAppTool(server, 'get_who_said_first', {
    description: 'Who Said It First: the order Signal\'s topics reached your source groups in, by publication time, and which groups tend to be early. Only a topic that starts after a quiet spell and reaches at least two groups is judged. For each group, `first` is how often it came first and `expected` how often chance predicts given how much it posts; `verdict` is early or late only when that difference is clear, otherwise unclear. `skipped` says how many topics could not be judged. It is the order among these sources only, and does not say where a story began. Hosts with MCP Apps show each topic as a ripple spreading from the first group to the others; other clients get this JSON.',
    inputSchema: { days: z.number().int().min(1).max(14).default(14).describe('Judge the topics that started in this many days'), board: z.string().optional().describe('Only the groups of one top-level Signal (its id or address); the answer lists them under `boards`') },
    annotations: readOnly,
    _meta: { ui: { resourceUri: FIRST_UI } },
  }, ({ days, board }) => ask(env.MONITOR, '/mon/who-first', { days, board }));

  registerAppResource(server, 'Who Said It First', FIRST_UI, { mimeType: RESOURCE_MIME_TYPE },
    async () => ({ contents: [{ uri: FIRST_UI, mimeType: RESOURCE_MIME_TYPE, text: firstHtml }] }));

  // The Tweet Galaxy: the model gets the summary, and the view reads the points itself (get_galaxy_points), because thousands of tweets do not belong in the conversation.
  registerAppTool(server, 'get_tweet_galaxy', {
    description: 'Tweet Galaxy: a History collection summarised by theme, kind and stance. Hosts with MCP Apps show it as an interactive picture where every tweet is a particle that moves between a timeline, spirals per theme or kind, and for and against a subject; selecting tweets there tells you which ones the user is looking at. Other clients get this JSON. Leave `id` out for the latest analysed collection; the answer lists the others under `jobs`.',
    inputSchema: { id: z.string().optional().describe('A History collection id from list_history_jobs') },
    annotations: readOnly,
    _meta: { ui: { resourceUri: GALAXY_UI } },
  }, ({ id }) => ask(env.HISTORY, '/hist/galaxy', { id }));

  server.registerTool('get_galaxy_points', {
    description: 'The data the Tweet Galaxy view draws, as compact rows, most liked first. It is meant for the view: to read tweets, use get_history_tweets.',
    inputSchema: { id: z.string(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(GALAXY_PAGE).default(GALAXY_PAGE) },
    annotations: readOnly,
  }, ({ id, offset, limit }) => ask(env.HISTORY, '/hist/galaxy-points', { id, offset, limit }));

  registerAppResource(server, 'Tweet Galaxy', GALAXY_UI, { mimeType: RESOURCE_MIME_TYPE },
    async () => ({ contents: [{ uri: GALAXY_UI, mimeType: RESOURCE_MIME_TYPE, text: galaxyHtml }] }));

  return server;
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  // Stateless: there is no event stream or session to open or close, so only POST is meaningful.
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  // Stateless: a fresh server per request, no session to keep, plain JSON answers instead of an event stream.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await buildServer(env).connect(transport);
  return transport.handleRequest(request);
}
