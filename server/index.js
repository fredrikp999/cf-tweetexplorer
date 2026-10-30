// Minimal local server: serves ./public and proxies read-only calls to twitterapi.io,
// injecting the API key server-side so it never reaches the browser.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpAgent } from './acp.js';
import { History } from './history.js';
import { Monitor } from './monitor.js';
import { Lists } from './lists.js';
// The Summarize agent (Strands) is TypeScript shared with the Cloudflare Worker; Node runs it directly.
import { streamSummary } from '../src/summarize/agent.ts';
import { buildModel, featureInfo } from '../src/summarize/provider.ts';
import { restRunner } from '../src/summarize/workers-ai.ts';
import { MockModel } from '../src/summarize/mock-model.ts';
import { nodeSources } from '../src/summarize/node.ts';
import { parseRequest } from '../src/summarize/request.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));      // the project root; server/ is one level down
const DATA = join(ROOT, '.data');                                // everything this server writes (git-ignored)
const PUBLIC = join(ROOT, 'public');
const UPSTREAM = 'https://api.twitterapi.io';
const PORT = Number(process.env.PORT) || 3000;

// Load .env without a dependency
try {
  for (const line of (await readFile(join(ROOT, '.env'), 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const KEY = process.env.TWITTERAPI_IO_KEY;
if (!KEY) console.warn('Warning: TWITTERAPI_IO_KEY is not set; API calls will fail.');

// /api is a read-only passthrough; writes go through the /act actions above.
const ALLOWED = [
  /^\/twitter\/user\/(info|search|last_tweets|followers|followings|mentions|verifiedFollowers)$/,
  /^\/twitter\/user_about$/,
  /^\/twitter\/tweets$/,
  /^\/twitter\/tweet\/(advanced_search|replies|replies\/v2|quotes|retweeters|thread_context)$/,
  /^\/twitter\/trends$/,
  /^\/oapi\/my\/info$/,
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
};

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};
const json = (res, status, obj) => send(res, status, JSON.stringify(obj));

// ---- Account actions (writes) -------------------------------------------------
// The session (login_cookies + proxy) lives only on the server, in a 0600 file.
// The browser sends just the action fields; the server adds cookies and proxy.
await mkdir(DATA, { recursive: true });
const SESSION_FILE = join(DATA, 'session.json');
let session = { login_cookies: '', proxy: process.env.TWITTERAPI_IO_PROXY ?? '', user_name: '' };
try { session = { ...session, ...JSON.parse(await readFile(SESSION_FILE, 'utf8')) }; } catch {}
const saveSession = () => writeFile(SESSION_FILE, JSON.stringify(session), { mode: 0o600 });

const ACTIONS = {
  create_tweet:   { path: '/twitter/create_tweet_v2',   fields: ['tweet_text', 'reply_to_tweet_id', 'quote_tweet_id'] },
  delete_tweet:   { path: '/twitter/delete_tweet_v2',   fields: ['tweet_id'] },
  like:           { path: '/twitter/like_tweet_v2',     fields: ['tweet_id'] },
  unlike:         { path: '/twitter/unlike_tweet_v2',   fields: ['tweet_id'] },
  retweet:        { path: '/twitter/retweet_tweet_v2',  fields: ['tweet_id'] },
  bookmark:       { path: '/twitter/bookmark_tweet_v2', fields: ['tweet_id'] },
  unbookmark:     { path: '/twitter/unbookmark_tweet_v2', fields: ['tweet_id'] },
  follow:         { path: '/twitter/follow_user_v2',    fields: ['user_id'] },
  unfollow:       { path: '/twitter/unfollow_user_v2',  fields: ['user_id'] },
  send_dm:        { path: '/twitter/send_dm_to_user',   fields: ['user_id', 'text'] },
  bookmarks:      { path: '/twitter/bookmarks_v2',      fields: ['count', 'cursor'] },
};

const readBody = async (req) => {
  let s = ''; for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
};

const upstreamPost = async (path, body) => {
  const up = await fetch(UPSTREAM + path, { method: 'POST',
    headers: { 'x-api-key': KEY ?? '', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await up.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: up.status, data };
};

async function handleAct(req, res, name) {
  if (name === 'session' && req.method === 'GET')
    return json(res, 200, { loggedIn: !!session.login_cookies, user_name: session.user_name, hasProxy: !!session.proxy });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
  const b = await readBody(req);

  if (name === 'logout') { session.login_cookies = ''; session.user_name = ''; await saveSession(); return json(res, 200, { ok: true }); }

  if (name === 'session') { // use existing cookies / change proxy without paying for a new login
    if (b.proxy) session.proxy = String(b.proxy);
    if (b.login_cookies) { session.login_cookies = String(b.login_cookies); session.user_name = String(b.user_name ?? ''); }
    await saveSession();
    return json(res, 200, { loggedIn: !!session.login_cookies, user_name: session.user_name, hasProxy: !!session.proxy });
  }

  if (name === 'login') {
    const proxy = b.proxy || session.proxy;
    if (!proxy) return json(res, 400, { error: 'A proxy is required' });
    const body = { user_name: b.user_name, email: b.email, password: b.password, proxy };
    if (b.totp_secret) body.totp_secret = b.totp_secret;
    const { status, data } = await upstreamPost('/twitter/user_login_v2', body);
    const cookies = data.login_cookies ?? data.login_cookie ?? data.data?.login_cookies;
    if (status !== 200 || !cookies) return json(res, status === 200 ? 400 : status, { error: data.message ?? data.msg ?? data.detail ?? data.error ?? 'login failed' });
    session = { login_cookies: cookies, proxy, user_name: b.user_name };
    await saveSession();
    return json(res, 200, { loggedIn: true, user_name: session.user_name });
  }

  const action = ACTIONS[name];
  if (!action) return json(res, 404, { error: 'unknown action' });
  if (!session.login_cookies || !session.proxy) return json(res, 400, { error: 'Not logged in (cookies and proxy required)' });
  const body = { login_cookies: session.login_cookies, proxy: session.proxy };
  for (const f of action.fields) if (b[f] !== undefined && b[f] !== '') body[f] = b[f];
  const { status, data } = await upstreamPost(action.path, body);
  return json(res, status, data);
}

// ---- Agent tab: Claude Code over ACP, with the twitterapi-io skill --------------
const agent = new AcpAgent({ cwd: join(DATA, 'agent-workspace'), env: { TWITTERAPI_IO_KEY: KEY ?? '' } });
const sseClients = new Set();
const broadcast = (msg) => { const d = `data: ${JSON.stringify(msg)}\n\n`; for (const c of sseClients) c.write(d); };
const clip = (s, n = 6000) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `… [${s.length - n} more chars]` : s);
const clipContent = (content) => content?.map((c) => (c.content?.text ? { ...c, content: { ...c.content, text: clip(c.content.text) } } : c));

agent.on('update', (sessionId, u) => {
  if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update')
    u = { ...u, content: clipContent(u.content), rawOutput: undefined };
  if (['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'].includes(u.sessionUpdate))
    broadcast({ type: 'update', sessionId, update: u });
});
agent.on('permission', (p) => broadcast({ type: 'permission', ...p, toolCall: { ...p.toolCall, content: clipContent(p.toolCall?.content), rawOutput: undefined } }));
agent.on('exit', (code) => broadcast({ type: 'exit', code }));

async function handleAgent(req, res, name) {
  if (name === 'events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
  const b = await readBody(req);
  if (name === 'new') return json(res, 200, { sessionId: await agent.newSession() });
  if (name === 'prompt') {
    if (!agent.sessions.has(b.sessionId)) return json(res, 400, { error: 'unknown session' });
    return json(res, 200, { stopReason: await agent.prompt(b.sessionId, String(b.text ?? '')) });
  }
  if (name === 'permission') return json(res, 200, { ok: agent.resolvePermission(String(b.requestId), b.optionId ?? null) });
  if (name === 'cancel') { agent.cancel(b.sessionId); return json(res, 200, { ok: true }); }
  return json(res, 404, { error: 'unknown agent route' });
}

// ---- History tab: long-running time-sharded collection jobs ---------------------
const history = new History({ dir: join(DATA, 'history'), key: KEY ?? '', upstream: UPSTREAM });
await history.init();

async function handleHist(req, res, name, url) {
  const id = url.searchParams.get('id') ?? '';
  try {
    if (req.method === 'GET') {
      if (name === 'jobs') return json(res, 200, history.list());
      if (!history.get(id)) return json(res, 404, { error: 'unknown job' });
      if (name === 'job') return json(res, 200, history.view(history.get(id)));
      if (name === 'data') { // normalized tweets as a JSON array, streamed
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.write('['); let first = true;
        for await (const t of history.normalized(id)) { res.write((first ? '' : ',') + JSON.stringify(t)); first = false; }
        return res.end(']');
      }
      if (name === 'raw') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson', 'content-disposition': `attachment; filename="tweets-${id}.jsonl"` });
        return history.rawStream(id).pipe(res);
      }
      return json(res, 404, { error: 'unknown history route' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST required' });
    const b = await readBody(req);
    if (name === 'probe') return json(res, 200, await history.probe(b));
    if (name === 'start') return json(res, 200, await history.start(b));
    if (!history.get(b.id)) return json(res, 404, { error: 'unknown job' });
    if (name === 'stop') return json(res, 200, { ok: history.stop(b.id) });
    if (name === 'resume') return json(res, 200, { ok: history.resume(b.id, b.maxTweets) });
    if (name === 'delete') { await history.remove(b.id); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'unknown history route' });
  } catch (e) {
    if (!res.headersSent) return json(res, 400, { error: String(e.message ?? e) });
    res.end();
  }
}

// ---- Monitor tab: polling watches that push new tweets to the browser ------------
const monitor = new Monitor({ dir: join(DATA, 'monitor'), key: KEY ?? '', upstream: UPSTREAM });
await monitor.init();
const monClients = new Set();
const monBroadcast = (msg) => { const d = `data: ${JSON.stringify(msg)}\n\n`; for (const c of monClients) c.write(d); };
monitor.on('tweet', (item) => monBroadcast({ type: 'tweet', item }));
monitor.on('state', () => monBroadcast({ type: 'state', ...monitor.snapshot() }));

async function handleMon(req, res, name, url) {
  try {
    if (name === 'events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n'); monClients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { monClients.delete(res); clearInterval(ping); });
      return;
    }
    if (req.method === 'GET') {
      if (name === 'state') return json(res, 200, monitor.snapshot());
      if (name === 'feed') return json(res, 200, monitor.feed.slice(0, Math.min(500, Number(url.searchParams.get('limit')) || 200)));
      return json(res, 404, { error: 'unknown monitor route' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST required' });
    const b = await readBody(req);
    if (name === 'add') { const w = monitor.add(b); monBroadcast({ type: 'state', ...monitor.snapshot() }); return json(res, 200, w); }
    if (name === 'update') { const w = monitor.update(b.id, b); monBroadcast({ type: 'state', ...monitor.snapshot() }); return json(res, 200, w); }
    if (name === 'delete') { monitor.remove(b.id); monBroadcast({ type: 'state', ...monitor.snapshot() }); return json(res, 200, { ok: true }); }
    if (name === 'check') { monitor.checkNow(b.id); return json(res, 200, { ok: true }); }
    if (name === 'settings') { monitor.setSettings(b); monBroadcast({ type: 'state', ...monitor.snapshot() }); return json(res, 200, monitor.snapshot()); }
    if (name === 'clear') { await monitor.clearFeed(); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'unknown monitor route' });
  } catch (e) {
    if (!res.headersSent) return json(res, 400, { error: String(e.message ?? e) });
    res.end();
  }
}

// ---- Lists tab: curated groups of accounts --------------------------------------
const lists = new Lists({ dir: join(DATA, 'lists') });
await lists.init();

async function handleLists(req, res, name) {
  try {
    if (req.method === 'GET' && name === 'all') return json(res, 200, lists.all());
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST required' });
    const b = await readBody(req);
    if (name === 'save') return json(res, 200, await lists.save(b));
    if (name === 'delete') { await lists.remove(b.id); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'unknown lists route' });
  } catch (e) { return json(res, 400, { error: String(e.message ?? e) }); }
}

// ---- Summarize tab: a Strands agent that summarizes tweets (same code runs on Cloudflare) --
// Workers AI (needs a Cloudflare API token with the Workers AI permission), OpenRouter or Anthropic, from .env.
// OPENROUTER_API_KEY also adds OpenRouter models to the picker, and with SUMMARY_FALLBACK_MODEL backs up the main provider.
function sumProvider() {
  const { CLOUDFLARE_ACCOUNT_ID: acct, CLOUDFLARE_API_TOKEN: tok, ANTHROPIC_API_KEY: akey, OPENROUTER_API_KEY: okey, SUMMARY_PROVIDER: want } = process.env;
  const ai = acct && tok ? restRunner(acct, tok) : undefined;
  const base = { ai, anthropicKey: akey || undefined, openrouterKey: okey || undefined, configured: process.env.SUMMARY_MODEL, fallback: process.env.SUMMARY_FALLBACK_MODEL || undefined };
  const provider = want === 'anthropic' ? (akey && 'anthropic') : want === 'openrouter' ? (okey && 'openrouter')
    : ai ? 'workers-ai' : akey ? 'anthropic' : okey ? 'openrouter' : null;
  return provider ? { ...base, provider } : null;
}
const sumFeatures = () => ({ summarize: !!sumProvider() || process.env.SUMMARY_MOCK === '1', ...featureInfo(sumProvider()) });

async function handleSum(req, res, name) {
  if (name !== 'run' || req.method !== 'POST') return json(res, 404, { error: 'unknown route' });
  const prov = sumProvider(), mock = process.env.SUMMARY_MOCK === '1';
  if (!prov && !mock) return json(res, 503, { error: 'The summarizer is not configured: add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI), ANTHROPIC_API_KEY or OPENROUTER_API_KEY, to .env and restart.' });
  let parsed;
  try { parsed = parseRequest(await readBody(req)); } catch (e) { return json(res, 400, { error: String(e.message ?? e) }); }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const ac = new AbortController();
  res.on('close', () => ac.abort());          // browser closed: stop spending
  const built = mock ? { model: new MockModel(), id: 'mock' } : buildModel(prov, parsed.model);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  try {
    for await (const ev of streamSummary({ req: parsed, sources: nodeSources(`http://127.0.0.1:${PORT}`), model: built.model, modelId: built.id, signal: ac.signal })) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  } catch (e) { res.write(`data: ${JSON.stringify({ type: 'error', message: String(e.message ?? e) })}\n\n`); }
  clearInterval(ping); res.end();
}

// Writes act on a real account, so refuse requests that a web page on another origin could forge.
const sameOrigin = (req) => {
  const host = req.headers.host ?? '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  return !origin || new URL(origin).host === host;
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // The deployed site serves the app under /admin/; locally it also answers at /.
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) url.pathname = url.pathname.slice('/admin'.length) || '/';
  try {
    if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin request refused' });
    if (url.pathname === '/features') return json(res, 200, { agent: true, account: true, push: true, local: true, deployed: false, ...sumFeatures() });
    if (url.pathname.startsWith('/sum/')) return await handleSum(req, res, url.pathname.slice(5));
    if (url.pathname.startsWith('/act/')) return await handleAct(req, res, url.pathname.slice(5));
    if (url.pathname.startsWith('/agent/')) return await handleAgent(req, res, url.pathname.slice(7));
    if (url.pathname.startsWith('/lists/')) return await handleLists(req, res, url.pathname.slice(7));
    if (url.pathname.startsWith('/mon/')) return await handleMon(req, res, url.pathname.slice(5), url);
    if (url.pathname.startsWith('/hist/')) return await handleHist(req, res, url.pathname.slice(6), url);
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(4);
      if (req.method !== 'GET' || !ALLOWED.some((re) => re.test(path)))
        return send(res, 403, JSON.stringify({ error: 'endpoint not allowed' }));
      const up = await fetch(UPSTREAM + path + url.search, { headers: { 'x-api-key': KEY ?? '' } });
      return send(res, up.status, await up.text());
    }
    const rel = url.pathname === '/' ? 'admin/index.html' : url.pathname.slice(1);
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'not found', 'text/plain');
    send(res, 502, JSON.stringify({ error: String(e.message ?? e) }));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}`));
