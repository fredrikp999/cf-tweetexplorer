// Cloudflare AI Gateway: when the AI_GATEWAY variable names a gateway, OpenRouter calls go through it, so the dashboard
// (AI > AI Gateway) logs each one with its model, tokens, cost and latency. Workers AI pictures pass the same id to the binding.
// Nothing depends on it: unset, everything goes straight to OpenRouter as before, and a gateway that refuses the call
// (authentication on, but no AI_GATEWAY_TOKEN secret) is skipped for the rest of the isolate's life, the call going direct.
// Set up once per Worker or Durable Object from env, like setYoutubeKey.
const OPENROUTER = 'https://openrouter.ai/api/v1';
type GatewayBinding = { gateway(id: string): { getUrl(provider?: string): Promise<string> } };

let id = '', token: string | undefined, base: Promise<string | null> | null = null, direct = false;

export function useGateway(env: Env): void {
  const e = env as { AI_GATEWAY?: string; AI_GATEWAY_TOKEN?: string; AI?: GatewayBinding };
  const want = (e.AI_GATEWAY ?? '').trim();
  if (want === id && base) return;
  id = want; token = e.AI_GATEWAY_TOKEN || undefined; direct = false;
  base = id && e.AI ? e.AI.gateway(id).getUrl('openrouter').then((u) => u.replace(/\/+$/, '')).catch(() => null) : null;
}

/** The gateway id for Workers AI binding calls (`{ gateway: { id } }`), or undefined when there is none. */
export const gatewayId = (): string | undefined => id || undefined;

/** `fetch` for OpenRouter addresses: through the gateway when one is set up, otherwise (or if it refuses) straight to OpenRouter. */
export async function orFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const gw = !direct && base && url.startsWith(OPENROUTER) ? await base : null;
  if (!gw) return fetch(input, init);
  const req = new Request(input, init), headers = new Headers(req.headers);
  if (token) headers.set('cf-aig-authorization', `Bearer ${token}`);
  const body = req.body ? await req.arrayBuffer() : undefined;      // kept, so a refused call can be sent again directly
  const res = await fetch(gw + url.slice(OPENROUTER.length), { method: req.method, headers, body, signal: req.signal });
  if (res.status !== 401 && res.status !== 403) return res;
  const text = await res.text().catch(() => '');
  // The gateway's own refusals carry its error codes (2009 unauthorized, 2001 unknown gateway); OpenRouter's 401 (a bad key) is passed on.
  if (!/\b(2009|2001|2002)\b|ai gateway|cf-aig/i.test(text)) return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
  console.warn('AI Gateway refused the call; OpenRouter is called directly from now on', res.status, text.slice(0, 200));
  direct = true;
  return fetch(url, { method: req.method, headers: req.headers, body, signal: req.signal });
}
