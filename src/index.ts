import { verifyAccess } from './access';
import { json } from './lib/twitterapi';
import { handleSummarize, summarizerFeatures } from './summarize/worker';
import { handlePublic } from './site/public';
import { recordCost } from './lib/costs';
import { serveAudio, serveImage } from './media/audio-serve';
import { PROFILE_PRICE, tweetCallCost } from './summarize/pricing.ts';
export { MonitorDO } from './durable-objects/monitor';
export { HistoryDO } from './durable-objects/history';
export { ListsDO } from './durable-objects/lists';
export { PublishDO } from './durable-objects/publish';
export { CostDO } from './durable-objects/cost';

const UPSTREAM = 'https://api.twitterapi.io';

// Read-only passthrough, same allowlist as the local server.
const ALLOWED = [
  /^\/twitter\/user\/(info|search|last_tweets|followers|followings|mentions|verifiedFollowers)$/,
  /^\/twitter\/user_about$/,
  /^\/twitter\/tweets$/,
  /^\/twitter\/tweet\/(advanced_search|replies|replies\/v2|quotes|retweeters|thread_context)$/,
  /^\/twitter\/list\/tweets_timeline$/,
  /^\/twitter\/trends$/,
  /^\/oapi\/my\/info$/,
];

// What this deployment offers. The UI hides the rest.
const FEATURES = { agent: false, account: false, push: false, local: false, deployed: true, xlists: true, costs: true, publish: true };

// What a passthrough call cost, estimated from the size of the answer (the API bills per tweet / profile returned).
function exploreCost(path: string, text: string): { ref: string; label: string; twitter: number; tweets: number } {
  const ref = /advanced_search/.test(path) ? 'search' : /\/user\//.test(path) || /user_about/.test(path) ? 'user' : /\/list\//.test(path) ? 'list' : /trends/.test(path) ? 'trends' : /\/tweet/.test(path) ? 'tweets' : 'other';
  const label = { search: 'Search', user: 'Users and followers', list: 'X list timelines', trends: 'Trends', tweets: 'Tweet lookups', other: 'Other' }[ref]!;
  let j: Record<string, any> = {};
  try { j = JSON.parse(text); } catch { /* not JSON: bill the minimum */ }
  const tweets = (j.tweets ?? j.data?.tweets ?? []) as unknown[], people = (j.users ?? j.followers ?? j.followings ?? j.members ?? []) as unknown[];
  const twitter = tweets.length ? tweetCallCost(tweets.length) : people.length ? people.length * PROFILE_PRICE : /user\/info|user_about/.test(path) ? PROFILE_PRICE : tweetCallCost(0);
  return { ref, label, twitter, tweets: tweets.length };
}

async function apiProxy(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname.slice('/api'.length);
  if (request.method !== 'GET' || !ALLOWED.some((re) => re.test(path))) return json({ error: 'endpoint not allowed' }, 403);
  const up = await fetch(UPSTREAM + path + url.search, { headers: { 'x-api-key': env.TWITTERAPI_IO_KEY } });
  const text = await up.text();
  if (up.ok && path !== '/oapi/my/info') ctx.waitUntil(recordCost(env, { kind: 'explore', calls: 1, ...exploreCost(path, text) }));
  return new Response(text, { status: up.status, headers: { 'content-type': up.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
}

// One private area, behind Cloudflare Access: /admin (the explorer app and scheduled publishing together).
// Everything else is public, read-only, and served from published issues only (site/public.ts).
// /custom was the explorer's old address: it still counts as private, and its pages redirect to /admin.
const PRIVATE = /^\/(admin|custom)(\/|$)/;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!PRIVATE.test(url.pathname)) return handlePublic(request, env, url);
    // The old address: send people (and bookmarks) to the new one. Nothing is served or revealed here.
    if (url.pathname === '/custom' || url.pathname.startsWith('/custom/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'moved to /admin' }, 404);
      return Response.redirect(url.origin + '/admin' + (url.pathname.slice('/custom'.length) || '/') + url.search, 301);
    }

    // 1. Authenticate every private request, including static files.
    const who = await verifyAccess(request, env);
    if (!who.ok) return json({ error: who.reason }, who.status);

    // 2. Writes: same-origin JSON only. The Access cookie is sent automatically by browsers, so without
    //    this a page on another site could post to these routes as the signed-in user.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) return json({ error: 'cross-origin request refused' }, 403);
      if (!(request.headers.get('content-type') ?? '').includes('application/json')) return json({ error: 'application/json required' }, 415);
    }

    try {
      const rest = url.pathname.slice('/admin'.length) || '/';
      // The app was written for the site root; give it the same path without the /admin prefix.
      const inner = new Request(new URL(rest + url.search, url.origin), request);

      // An issue's audio, for the admin to listen to before (or without) publishing it.
      if (rest === '/pub/audio-file') {
        const u = new URL('https://internal/adm/issue'); u.searchParams.set('slug', url.searchParams.get('slug') ?? ''); u.searchParams.set('id', url.searchParams.get('id') ?? '');
        const r = await env.PUBLISH.getByName('main').fetch(new Request(u));
        const key = r.ok ? ((await r.json()) as { audio?: { key?: string } }).audio?.key : undefined;
        return key ? await serveAudio(env, key, request, 'private, no-store') : json({ error: 'no audio' }, 404);
      }
      // An issue's picture, for the admin to look at before (or without) publishing it.
      if (rest === '/pub/image-file') {
        const u = new URL('https://internal/adm/issue'); u.searchParams.set('slug', url.searchParams.get('slug') ?? ''); u.searchParams.set('id', url.searchParams.get('id') ?? '');
        const r = await env.PUBLISH.getByName('main').fetch(new Request(u));
        const key = r.ok ? ((await r.json()) as { image?: { key?: string } }).image?.key : undefined;
        return key ? await serveImage(env, key, request, 'private, no-store') : json({ error: 'no image' }, 404);
      }
      // Scheduled publishing (topics, issues). Under /pub so it does not clash with the explorer's /api proxy.
      if (rest.startsWith('/pub/')) return await env.PUBLISH.getByName('main').fetch(new Request(new URL('/adm/' + rest.slice('/pub/'.length) + url.search, url.origin), request));
      if (rest === '/features') return json({ ...FEATURES, ...summarizerFeatures(env) });
      if (rest.startsWith('/sum/')) return await handleSummarize(request, env);
      if (rest.startsWith('/api/')) return await apiProxy(request, new URL(inner.url), env, ctx);
      if (rest === '/costs/summary') return json(await env.COST.getByName('main').summary(Number(url.searchParams.get('days')) || 30));
      if (rest.startsWith('/mon/')) return await env.MONITOR.getByName('main').fetch(inner);
      if (rest.startsWith('/lists/')) return await env.LISTS.getByName('main').fetch(inner);
      if (rest.startsWith('/hist/')) return await env.HISTORY.getByName('main').fetch(inner);
      if (rest.startsWith('/act/') || rest.startsWith('/agent/')) return json({ error: 'not available on this deployment' }, 404);
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error('request failed', url.pathname, err instanceof Error ? err.message : String(err));
      return json({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
