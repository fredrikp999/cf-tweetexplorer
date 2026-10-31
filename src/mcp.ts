// A read-only MCP server (Streamable HTTP, stateless) over the data this app keeps: History, Briefings, Lists, Monitor, Costs.
// It lives at /mcp, behind its own Access application; index.ts verifies the JWT (against MCP_POLICY_AUD) before a request gets here.
// For clients that cannot do a browser login, use an Access service token (docs/deployment.md).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import costsHtml from './apps/costs';

const MAX_TWEETS = 200;
const COSTS_UI = 'ui://tweet-explorer/costs-v6.html';

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

  server.registerTool('list_user_lists', {
    description: 'Your curated lists of accounts.',
    annotations: readOnly,
  }, () => ask(env.LISTS, '/lists/all'));

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
    inputSchema: { limit: z.number().int().min(1).max(500).default(100), source: z.enum(['x', 'rss', 'hn']).optional() },
    annotations: readOnly,
  }, ({ limit, source }) => ask(env.MONITOR, '/mon/feed', { limit, ...(source ? { source } : {}) }));

  // MCP Apps: hosts that support them show the Costs view inline; the others still get the JSON text.
  registerAppTool(server, 'get_costs', {
    description: 'Spend by feature over the last N days (twitterapi.io, language models, audio, pictures).',
    inputSchema: { days: z.number().int().min(1).max(365).default(30) },
    annotations: readOnly,
    _meta: { ui: { resourceUri: COSTS_UI } },
  }, async ({ days }) => text(await env.COST.getByName('main').summary(days)));

  registerAppResource(server, 'Costs', COSTS_UI, { mimeType: RESOURCE_MIME_TYPE },
    async () => ({ contents: [{ uri: COSTS_UI, mimeType: RESOURCE_MIME_TYPE, text: costsHtml }] }));

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
