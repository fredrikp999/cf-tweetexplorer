import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayId, orFetch, useGateway } from '../src/llm/gateway.ts';

const GW = 'https://gateway.ai.cloudflare.com/v1/acct/default/openrouter';
const ai = { gateway: (id) => ({ getUrl: async (p) => `https://gateway.ai.cloudflare.com/v1/acct/${id}/${p}` }) };
const real = globalThis.fetch;
let calls;
function fakeFetch(answer) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input), headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    calls.push({ url, headers, body: typeof init?.body === 'string' ? init.body : init?.body ? new TextDecoder().decode(init.body) : '' });
    return answer(url);
  };
}
afterEach(() => { globalThis.fetch = real; });

describe('orFetch', () => {
  test('goes straight to OpenRouter when no gateway is set', async () => {
    useGateway({});
    fakeFetch(() => new Response('ok'));
    await orFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' });
    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(gatewayId(), undefined);
  });

  test('sends OpenRouter calls through the gateway, with its token', async () => {
    useGateway({ AI_GATEWAY: 'default', AI_GATEWAY_TOKEN: 't', AI: ai });
    fakeFetch(() => new Response('ok'));
    const res = await orFetch('https://openrouter.ai/api/v1/systemone', { method: 'POST', headers: { authorization: 'Bearer k' }, body: '{"a":1}' });
    assert.equal(await res.text(), 'ok');
    assert.equal(calls[0].url, `${GW}/systemone`);
    assert.equal(calls[0].headers.get('cf-aig-authorization'), 'Bearer t');
    assert.equal(calls[0].headers.get('authorization'), 'Bearer k');
    assert.equal(calls[0].body, '{"a":1}');
    assert.equal(gatewayId(), 'default');
  });

  test('passes on an OpenRouter 401 (a bad key) without retrying', async () => {
    useGateway({ AI_GATEWAY: 'other', AI: ai });
    fakeFetch(() => new Response('{"error":{"message":"No auth credentials found"}}', { status: 401 }));
    const res = await orFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' });
    assert.equal(res.status, 401);
    assert.equal(calls.length, 1);
  });

  test('a gateway that refuses the call is skipped from then on', async () => {
    useGateway({ AI_GATEWAY: 'locked', AI: ai });
    fakeFetch((url) => (url.startsWith('https://gateway.') ? new Response('{"success":false,"result":[],"messages":[],"error":[{"code":2009,"message":"Unauthorized"}]}', { status: 401 }) : new Response('direct')));
    const res = await orFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{"m":1}' });
    assert.equal(await res.text(), 'direct');
    assert.deepEqual(calls.map((c) => c.url), ['https://gateway.ai.cloudflare.com/v1/acct/locked/openrouter/chat/completions', 'https://openrouter.ai/api/v1/chat/completions']);
    assert.equal(calls[1].body, '{"m":1}');
    await orFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' });
    assert.equal(calls[2].url, 'https://openrouter.ai/api/v1/chat/completions');
  });

  test('leaves other addresses alone', async () => {
    useGateway({ AI_GATEWAY: 'default2', AI: ai });
    fakeFetch(() => new Response('ok'));
    await orFetch('https://example.com/x');
    assert.equal(calls[0].url, 'https://example.com/x');
  });
});
