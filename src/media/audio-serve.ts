// Serves an MP3 from R2 with Range support, so a player can seek and start before the file has all arrived.
export async function serveAudio(env: Env, key: string, request: Request, cache: string): Promise<Response> {
  const ranged = request.headers.has('range');
  const obj = (ranged ? await env.AUDIO.get(key, { range: request.headers }) : await env.AUDIO.get(key)) as R2ObjectBody | R2Object | null;
  if (!obj) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const h = new Headers({ 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': cache, etag: obj.httpEtag, 'x-content-type-options': 'nosniff' });
  if (!('body' in obj)) return new Response(null, { status: 416, headers: { ...Object.fromEntries(h), 'content-range': `bytes */${obj.size}` } });
  let status = 200, length = obj.size;
  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (ranged && r) {
    const offset = r.offset ?? Math.max(0, obj.size - (r.suffix ?? 0));
    length = r.length ?? obj.size - offset;
    h.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    status = 206;
  }
  h.set('content-length', String(length));
  return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers: h });
}

// Serves a briefing's picture from R2. The type is whatever was stored (jpeg, png, webp; an SVG only for the local mock).
export async function serveImage(env: Env, key: string, request: Request, cache: string): Promise<Response> {
  const obj = await env.AUDIO.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const type = obj.httpMetadata?.contentType ?? 'image/jpeg';
  const h = new Headers({ 'content-type': /^image\/(jpeg|png|webp|svg\+xml)$/.test(type) ? type : 'image/jpeg', 'cache-control': cache, etag: obj.httpEtag, 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'content-length': String(obj.size) });
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers: h });
}
