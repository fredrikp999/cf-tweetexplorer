// Shared advanced_search call with retry/backoff, used by the History and Monitor jobs.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// signal: any object with an `abort` boolean; set it to true to cancel between attempts.
export async function search({ upstream, key, query, queryType = 'Latest', cursor = '', signal = { abort: false } }) {
  const params = { query, queryType }; if (cursor) params.cursor = cursor;
  const url = `${upstream}/twitter/tweet/advanced_search?` + new URLSearchParams(params);
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (signal.abort) throw new Error('stopped');
    let res;
    try { res = await fetch(url, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(60000) }); }
    catch (e) { lastErr = e; await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 429) { await sleep(1000 + attempt * 1500); continue; } // free tier: 1 call / 5s
    if (res.status === 402) { const e = new Error('Out of credits (HTTP 402). Top up and resume.'); e.code = 402; throw e; }
    const text = await res.text();
    if (res.status >= 500) { lastErr = new Error(`HTTP ${res.status}`); await sleep(1000 * (attempt + 1)); continue; }
    let body; try { body = JSON.parse(text); } catch { throw new Error(`bad response: ${text.slice(0, 100)}`); }
    if (!res.ok || body.status === 'error') throw new Error(body.msg ?? body.message ?? (typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`));
    return body;
  }
  throw lastErr ?? new Error('rate limited too long; slow down');
}
