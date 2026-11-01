// Cloudflare host for the summarizer: real data sources (twitterapi.io + the Lists and Monitor objects)
// and a Server-Sent-Events response that streams the agent's progress to the browser.
import { search } from '../lib/twitterapi';
import type { Tweet } from '../lib/twitterapi';
import { streamSummary } from './agent.ts';
import { screenTweets } from './screen.ts';
import type { ListInfo, Sources } from './agent.ts';
import { MockModel } from './mock-model.ts';
import { buildModel, featureInfo } from './provider.ts';
import type { Provider, ProviderConfig } from './provider.ts';
import { parseRequest } from './request.ts';
import type { RawTweet } from './tweets.ts';
import { bill, exhausted, llmCost, newMeter, tweetCallCost } from './pricing.ts';
import { recordCost } from '../lib/costs';
import type { Meter } from './pricing.ts';
import { getTranscript, transcriptConfig } from '../sources/transcript.ts';
import { readMembers, type FeedMember } from '../sources/feedlist.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function getJson(key: string, path: string, params: Record<string, string>): Promise<Record<string, any>> {
  const url = `https://api.twitterapi.io${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(60_000) });
    if (res.status === 429 || res.status >= 500) { await res.body?.cancel(); await sleep(1000 + attempt * 1500); continue; }
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok || body.status === 'error') throw new Error(String(body.msg ?? body.message ?? `HTTP ${res.status}`));
    return body;
  }
  throw new Error('twitterapi.io is rate limiting; try again shortly');
}

async function pages(key: string, path: string, params: Record<string, string>, n: number, meter?: Meter): Promise<RawTweet[]> {
  const all: RawTweet[] = []; let cursor = '';
  for (let i = 0; i < n; i++) {
    if (exhausted(meter)) break;
    const r = await getJson(key, path, cursor ? { ...params, cursor } : params);
    const got = (r.tweets ?? r.data?.tweets ?? []) as RawTweet[]; bill(meter, got.length);
    all.push(...got);
    if (!r.has_next_page || !r.next_cursor) break;
    cursor = String(r.next_cursor);
  }
  return all;
}

/** `meter`, if given, counts every call made through these sources, so a run can report what it cost. */
export function workerSources(env: Env, meter?: Meter): Sources {
  const key = env.TWITTERAPI_IO_KEY;
  return {
    async search({ query, sort, pages: n }) {
      const all: Tweet[] = []; let cursor = '';
      for (let i = 0; i < n; i++) {
        if (exhausted(meter)) break;
        const r = await search({ key, query, queryType: sort, cursor });
        bill(meter, (r.tweets ?? []).length);
        all.push(...(r.tweets ?? []));
        if (!r.has_next_page || !r.next_cursor) break;
        cursor = r.next_cursor;
      }
      return all;
    },
    accountTweets: ({ handle, pages: n }) => pages(key, '/twitter/user/last_tweets', { userName: handle }, n, meter),
    replies: ({ tweetId, sort, pages: n }) => pages(key, '/twitter/tweet/replies/v2', { tweetId, queryType: sort }, n, meter),
    async lists(): Promise<ListInfo[]> {
      const res = await env.LISTS.getByName('main').fetch(new Request('https://internal/lists/all'));
      const all = (await res.json()) as Array<{ id: string; name: string; topic: string; members: Array<{ handle: string; missing: boolean }> }>;
      return all.map((l) => ({ id: l.id, name: l.name, topic: l.topic, handles: l.members.filter((m) => !m.missing).map((m) => m.handle) }));
    },
    async xlists() {
      const res = await env.LISTS.getByName('main').fetch(new Request('https://internal/lists/x-all'));
      return ((await res.json()) as Array<{ id: string; name: string; groups: string[] }>).map(({ id, name, groups }) => ({ id, name, groups }));
    },
    // Two ways to read an X list.
    //  best:   X searches the list (`list:ID`) for the period's top posts, without retweets or replies, and only the ones with at
    //          least `minFaves` likes: 20 a page, and we pay only for what comes back. Covers the whole period.
    //  latest: the list timeline, about 80 tweets a call, newest first, retweets included. It has no time filter, so read pages
    //          until one reaches back past the window. A busy list can take hours of pages to cover a day.
    async xlistTweets({ listId, hours, pages: n, mode, minFaves }) {
      const out: RawTweet[] = []; let cursor = '';
      if (mode === 'latest') {
        const since = Date.now() - hours * 3_600_000;
        for (let i = 0; i < n; i++) {
          if (exhausted(meter, tweetCallCost(80))) break;      // a timeline page is up to 80 tweets
          const r = await getJson(key, '/twitter/list/tweets_timeline', cursor ? { listId, cursor } : { listId });
          const got = (r.tweets ?? r.data?.tweets ?? []) as RawTweet[], oldest = got.at(-1)?.createdAt; bill(meter, got.length);
          out.push(...got.filter((t) => !t.createdAt || Date.parse(t.createdAt) >= since));
          if (!r.has_next_page || !r.next_cursor || (oldest && Date.parse(oldest) < since)) break;
          cursor = String(r.next_cursor);
        }
        return out;
      }
      const query = `list:${listId} since_time:${Math.floor(Date.now() / 1000 - hours * 3600)}${minFaves ? ` min_faves:${minFaves}` : ''} -filter:retweets -filter:replies`;
      for (let i = 0; i < n; i++) {
        if (exhausted(meter)) break;
        const r = await search({ key, query, queryType: 'Top', cursor });
        const got = r.tweets ?? []; bill(meter, got.length); out.push(...got);
        if (!r.has_next_page || !r.next_cursor) break;
        cursor = r.next_cursor;
      }
      return out;
    },
    async feedList({ listId, hours }) {
      const res = await env.LISTS.getByName('main').fetch(new Request('https://internal/lists/f-all'));
      const list = ((await res.json()) as Array<{ id: string; name: string; members: FeedMember[] }>).find((l) => l.id === listId);
      if (!list) throw new Error(`No feed list with id ${listId}.`);
      if (!list.members.length) return { tweets: [], name: list.name, feeds: 0, failed: [] };
      const r = await readMembers(list.members, Date.now() - hours * 3_600_000);
      return { tweets: r.items as unknown as RawTweet[], name: list.name, feeds: r.read, failed: r.failed };
    },
    async transcript({ videoId, lang }) {
      const t = await getTranscript(transcriptConfig(env as unknown as Record<string, string | undefined>), videoId, lang);
      if (t.via !== 'captions') await recordCost(env, { kind: 'summarize', ref: 'transcript', label: `Video transcripts (${t.via})`, llm: t.cost, calls: 1, tokensIn: t.tokensIn, tokensOut: t.tokensOut, model: t.model });
      return { text: t.text, via: t.via, lang: t.lang };
    },
    async feed({ limit, watch, source }) {
      const res = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/feed?limit=${limit}${source ? `&source=${source}` : ''}`));
      const items = (await res.json()) as Array<{ watchId: string; label: string; tweet: RawTweet }>;
      const w = watch?.toLowerCase();
      return items.filter((i) => !w || i.watchId === watch || i.label.toLowerCase().includes(w)).map((i) => i.tweet);
    },
  };
}

// Workers AI (the AI binding) is the default and needs no secret. OpenRouter and Anthropic are opt-in: set
// SUMMARY_PROVIDER to make one the main provider, or set OPENROUTER_API_KEY to offer its models in the picker and
// (with SUMMARY_FALLBACK_MODEL) to back up the main provider when it runs out of credits.
export function configOf(env: Env): ProviderConfig | null {
  const want = env.SUMMARY_PROVIDER as string, orKey = (env as { OPENROUTER_API_KEY?: string }).OPENROUTER_API_KEY || undefined;
  const ai = (env as { AI?: unknown }).AI;      // the Workers AI binding (in wrangler.jsonc for pictures); writes only when SUMMARY_PROVIDER picks it or is unset
  const provider: Provider | null = want === 'anthropic' ? (env.ANTHROPIC_API_KEY ? 'anthropic' : null) : want === 'openrouter' ? (orKey ? 'openrouter' : null) : ai ? 'workers-ai' : null;
  if (!provider) return null;
  return { provider, ai: ai as never, anthropicKey: env.ANTHROPIC_API_KEY || undefined, openrouterKey: orKey, configured: env.SUMMARY_MODEL, fallback: (env as { SUMMARY_FALLBACK_MODEL?: string }).SUMMARY_FALLBACK_MODEL || undefined };
}
// The configured model, or null when no provider is available. Shared with the scheduled publisher.
export const modelFor = (env: Env, requested?: string, fallback?: string) => { const c = configOf(env); return c ? buildModel(c, requested, fallback) : null; };
export const summarizerReady = (env: Env): boolean => env.SUMMARY_MOCK === '1' || configOf(env) !== null;
export const summarizerFeatures = (env: Env) => ({ summarize: summarizerReady(env), ...featureInfo(configOf(env)) });

export async function handleSummarize(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  // The mock is a dev convenience: never active when the request came through Cloudflare's edge (CF-Ray).
  const mock = env.SUMMARY_MOCK === '1' && !request.headers.has('CF-Ray');
  if (!mock && !configOf(env)) return json({ error: 'The summarizer is not configured: no AI provider is available.' }, 503);
  let parsed;
  try { parsed = parseRequest(await request.json().catch(() => ({}))); }
  catch (err) { return json({ error: err instanceof Error ? err.message : String(err) }, 400); }

  const ac = new AbortController();
  request.signal.addEventListener('abort', () => ac.abort());
  const built = mock ? { model: new MockModel(), id: 'mock' } : modelFor(env, parsed.model) as NonNullable<ReturnType<typeof modelFor>>;
  const model = built.model;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch { /* client gone */ } };
      const ping = setInterval(() => send(': ping\n\n'), 15_000);   // keeps the connection warm during slow tool calls
      const meter = newMeter();
      let usage: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number; model?: string } | null = null, failed = '', screenCost = 0;
      try {
        for await (const ev of streamSummary({ req: parsed, sources: workerSources(env, meter), model, modelId: built.id, signal: ac.signal,
          screen: async (tweets, instr) => { const r = await screenTweets(env, tweets, instr); if (r) screenCost += r.cost; return r; } })) {
          if (ev.type === 'usage') usage = ev;
          if (ev.type === 'error') failed = ev.message;
          send(`data: ${JSON.stringify(ev)}\n\n`);
        }
      } catch (err) {
        failed = err instanceof Error ? err.message : String(err);
        send(`data: ${JSON.stringify({ type: 'error', message: failed })}\n\n`);
      } finally {
        clearInterval(ping);
        if (meter.calls || usage) {   // also under the dev mock: the tweets it fetched were real
          const s = parsed.source, what = s?.type === 'search' ? 'search: ' + s.query.slice(0, 60) : s?.type === 'xlist' ? `${s.listIds.length} X list${s.listIds.length === 1 ? '' : 's'}` : s?.type ?? (parsed.tweets ? 'tweets on screen' : 'free');
          await recordCost(env, { kind: 'summarize', ref: s?.type ?? 'screen', label: `Summarize: ${what}`, twitter: meter.cost, tweets: meter.tweets, calls: meter.calls,
            llm: (llmCost(usage?.model ?? built.id, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, { read: usage?.cacheRead, write: usage?.cacheWrite }) ?? 0) + screenCost, tokensIn: usage?.inputTokens, tokensOut: usage?.outputTokens, model: usage?.model ?? built.id,
            run: { ok: !failed, note: failed } });
        }
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() { ac.abort(); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
