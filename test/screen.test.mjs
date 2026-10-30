import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, questionsFor, screenModel, screenTweets } from '../src/summarize/screen.ts';
import { installFakeOpenRouter, tweet } from './helpers/fake-openrouter.mjs';

const env = { OPENROUTER_API_KEY: 'k' }, topic = 'AI research news from the last day';
let fake;
before(() => { fake = installFakeOpenRouter(); });
after(() => fake.restore());

describe('screenTweets', () => {
  test('drops off-topic and spam tweets, scores the rest, keeps the order', async () => {
    fake.mode = 'ok'; fake.calls.length = 0;
    const tweets = Array.from({ length: 60 }, (_, i) => tweet(i, i < 5 ? `offtopic ${i}` : i < 8 ? `BUY now ${i}` : undefined));
    const r = await screenTweets(env, tweets, topic);
    assert.equal(r.dropped, 8);
    assert.equal(r.tweets.length, 52);
    assert.ok(r.tweets.every((t) => typeof t.signal === 'number'));
    assert.deepEqual(r.tweets.map((t) => Number(t.id)), r.tweets.map((t) => Number(t.id)).sort((a, b) => a - b));
    assert.equal(fake.calls.length, 60);                                      // one request per tweet
    assert.deepEqual(Object.keys(fake.calls[0].body.questions), ['relevant', 'useful', 'junk']);
  });
  test('never screens a briefing below 20 tweets', async () => {
    const r = await screenTweets(env, Array.from({ length: 40 }, (_, i) => tweet(i, `offtopic ${i}`)), topic);
    assert.equal(r.tweets.length, 20);
    assert.equal(r.dropped, 20);
  });
  test('skips relevance without a real topic, and short lists altogether', async () => {
    fake.calls.length = 0;
    await screenTweets(env, Array.from({ length: 30 }, (_, i) => tweet(i)), 'Summarize');
    assert.deepEqual(Object.keys(fake.calls[0].body.questions), ['useful', 'junk']);
    assert.equal(await screenTweets(env, Array.from({ length: 10 }, (_, i) => tweet(i)), topic), null);
  });
  test('an unknown model fails loudly so the caller can warn', async () => {
    fake.mode = '404';
    await assert.rejects(screenTweets(env, Array.from({ length: 30 }, (_, i) => tweet(i)), topic), /404/);
    fake.mode = 'ok';
  });
});

describe('screenModel', () => {
  test('defaults to Decider Flash when OpenRouter is available', () => {
    assert.equal(screenModel(env), '~perplexity/pplx-decider-flash-latest');
    assert.equal(screenModel({}), null);
  });
  test('can be turned off or set to the other Decider', () => {
    assert.equal(screenModel({ ...env, SUMMARY_SCREEN_MODEL: 'off' }), null);
    assert.equal(screenModel({ ...env, SUMMARY_SCREEN_MODEL: '~perplexity/pplx-decider-latest' }), '~perplexity/pplx-decider-latest');
  });
});

test('judge never drops a tweet it has no answers for', () => {
  assert.deepEqual(judge({ relevant: null, useful: null, junk: null }), { signal: null, drop: false });
  assert.equal(judge({ relevant: 0.05, useful: 0.9, junk: 0 }).drop, true);
  assert.equal(judge({ relevant: 0.9, useful: 0.9, junk: 0.95 }).drop, true);
  assert.equal(judge({ relevant: 0.9, useful: 0.9, junk: 0.1 }).drop, false);
});

test('questionsFor asks about relevance only with a real topic', () => {
  assert.deepEqual(Object.keys(questionsFor('Summarize')), ['useful', 'junk']);
  assert.deepEqual(Object.keys(questionsFor(topic)), ['relevant', 'useful', 'junk']);
});
