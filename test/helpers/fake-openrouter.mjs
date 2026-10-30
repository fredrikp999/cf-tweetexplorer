// A fake of OpenRouter's /api/v1/systemone (decision models), installed over global fetch for the length of a test file.
// Behaviour is chosen per call with `fake.mode`: 'ok', 'flaky' (every 7th tweet answers 500) or '404'.
export function installFakeOpenRouter() {
  const real = globalThis.fetch;
  const fake = { mode: 'ok', calls: [], restore: () => { globalThis.fetch = real; } };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    fake.calls.push({ url: String(url), body, auth: init.headers.authorization });
    if (fake.mode === '404') return new Response('no such model', { status: 404 });
    const text = body.state.tweet ?? '', n = Number(/\d+/.exec(text)?.[0] ?? 0);
    if (fake.mode === 'flaky' && n % 7 === 0) return new Response('boom', { status: 500 });
    const answers = {};
    for (const [key, q] of Object.entries(body.questions)) {
      if (q.type === 'noul') answers[key] = { type: 'noul', noul: key === 'junk' ? (text.includes('BUY') ? 0.97 : 0.02) : key === 'relevant' ? (text.includes('offtopic') ? 0.02 : 0.9) : 0.8 };
      else if (key === 'theme') answers[key] = { type: 'choice', choice: 't1', confidence: n % 2 ? 0.3 : 0.9 };
      else if (key === 'kind') answers[key] = { type: 'choice', choice: 'news' };
      else answers[key] = { type: 'choice', choice: 'against' };
    }
    return new Response(JSON.stringify({ answers, model: 'fake', usage: { inputTokens: 200, outputTokens: 0, cost: 0.000002 } }), { status: 200 });
  };
  return fake;
}
export const tweet = (i, text) => ({ id: String(i), url: '', by: '@u', at: '', text: text ?? `tweet ${i}`, likes: i, retweets: 0, replies: 0, views: 0 });
