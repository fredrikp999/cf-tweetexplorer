import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, decideAll, probOf } from '../src/llm/decisions.ts';
import { installFakeOpenRouter } from './helpers/fake-openrouter.mjs';

const env = { OPENROUTER_API_KEY: 'k' };
const questions = { theme: { type: 'choice', instructions: 'x', criteria: { t0: 'a' } } };
let fake;
before(() => { fake = installFakeOpenRouter(); });
after(() => fake.restore());

describe('decide', () => {
  test('posts state and questions to the systemone endpoint and reads the cost', async () => {
    fake.mode = 'ok'; fake.calls.length = 0;
    const d = await decide(env, '~perplexity/pplx-decider-flash-latest', { tweet: 'hi' }, { a: { type: 'noul', instructions: 'x' } });
    assert.equal(fake.calls[0].url, 'https://openrouter.ai/api/v1/systemone');
    assert.equal(fake.calls[0].body.model, '~perplexity/pplx-decider-flash-latest');
    assert.equal(fake.calls[0].auth, 'Bearer k');
    assert.equal(d.cost, 0.000002);
    assert.equal(d.tokensIn, 200);
  });
  test('needs the OpenRouter key', async () => {
    await assert.rejects(decide({}, 'x', {}, {}), /No OpenRouter API key/);
  });
});

describe('decideAll', () => {
  test('isolates a failed request and reports it', async () => {
    fake.mode = 'flaky';
    const errors = [];
    const out = await decideAll(Array.from({ length: 30 }, (_, i) => `tweet ${i}`), 10, (t) => decide(env, 'x', { tweet: t }, questions), () => false, (e) => errors.push(e));
    assert.equal(out.filter((x) => !x).length, 5);      // tweets 0, 7, 14, 21, 28
    assert.equal(errors.length, 5);
  });
  test('fails the whole run on an unknown model', async () => {
    fake.mode = '404';
    await assert.rejects(decideAll(['a', 'b'], 2, (t) => decide(env, 'x', { tweet: t }, questions)), /404/);
  });
});

test('probOf accepts only probabilities', () => {
  assert.equal(probOf({ type: 'noul', noul: 0.4 }), 0.4);
  assert.equal(probOf({ type: 'noul', noul: 4078.5 }), null);
  assert.equal(probOf(undefined), null);
});
