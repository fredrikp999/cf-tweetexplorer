// Verifies the Cloudflare Access JWT on every request, so the Worker stays closed even if the
// Access application is misconfigured or someone reaches it by another route. Fails closed.

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
type Verdict = { ok: true; email: string } | { ok: false; status: number; reason: string };

// Public signing keys only (not request-scoped state), refreshed hourly or when an unknown kid shows up.
let keyCache: { at: number; keys: Map<string, CryptoKey> } | null = null;
const KEY_TTL_MS = 3_600_000;

const b64url = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const parseJson = <T>(part: string): T => JSON.parse(new TextDecoder().decode(b64url(part))) as T;

async function loadKeys(team: string): Promise<Map<string, CryptoKey>> {
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const map = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA') continue;
    map.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk as JsonWebKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  return map;
}

async function keyFor(team: string, kid: string): Promise<CryptoKey | undefined> {
  if (!keyCache || Date.now() - keyCache.at > KEY_TTL_MS || !keyCache.keys.has(kid)) {
    keyCache = { at: Date.now(), keys: await loadKeys(team) };
  }
  return keyCache.keys.get(kid);
}

export async function verifyAccess(request: Request, env: Env, audience: string = env.POLICY_AUD): Promise<Verdict> {
  // Local `wrangler dev` only. The flag lives in .dev.vars (never deployed), and it is ignored whenever a
  // CF-Ray header is present: Cloudflare's edge adds that to every production request and overwrites any
  // client-supplied value, so the bypass cannot work in production even if the flag were set there.
  if (env.DEV_BYPASS_ACCESS === '1' && !request.headers.has('CF-Ray')) return { ok: true, email: 'dev@localhost' };

  const team: string = env.TEAM_DOMAIN, aud: string = audience;
  if (!team || !aud) return { ok: false, status: 503, reason: 'Access is not configured for this deployment' };

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, status: 403, reason: 'Missing Access token' };
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return { ok: false, status: 403, reason: 'Malformed token' };

  try {
    const header = parseJson<{ alg?: string; kid?: string }>(h);
    if (header.alg !== 'RS256' || !header.kid) return { ok: false, status: 403, reason: 'Unsupported token' };
    const key = await keyFor(team, header.kid);
    if (!key) return { ok: false, status: 403, reason: 'Unknown signing key' };
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!valid) return { ok: false, status: 403, reason: 'Bad signature' };

    const claims = parseJson<{ aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string }>(p);
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(aud)) return { ok: false, status: 403, reason: 'Wrong audience' };
    if (claims.iss !== `https://${team}`) return { ok: false, status: 403, reason: 'Wrong issuer' };
    if (typeof claims.exp !== 'number' || claims.exp < now) return { ok: false, status: 403, reason: 'Token expired' };
    if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return { ok: false, status: 403, reason: 'Token not yet valid' };
    return { ok: true, email: claims.email ?? 'unknown' };
  } catch (err) {
    console.error('access verification failed', err instanceof Error ? err.message : String(err));
    return { ok: false, status: 403, reason: 'Token could not be verified' };
  }
}
