import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, streamSummary } from '../src/summarize/agent.ts';
import { MockModel } from '../src/summarize/mock-model.ts';
import { tweet } from './helpers/fake-openrouter.mjs';

const tweets = Array.from({ length: 30 }, (_, i) => tweet(i));
const run = async (screen) => {
  const events = [];
  for await (const e of streamSummary({ req: { length: 'brief', instruction: 'AI news please', tweets }, sources: {}, model: new MockModel(), modelId: 'mock', screen })) events.push(e);
  return events;
};

describe('streamSummary screening hook', () => {
  test('hands the screen the tweets and the instruction, and uses what it returns', async () => {
    let seen;
    const events = await run(async (t, instruction) => { seen = [t.length, instruction]; return { tweets: t.slice(0, 20).map((x) => ({ ...x, signal: 50 })), dropped: 10 }; });
    assert.deepEqual(seen, [30, 'AI news please']);
    assert.ok(events.some((e) => e.type === 'status' && /removed 10/.test(e.text)));
    assert.equal(events.at(-1).type, 'done');
  });
  test('a screen that fails only warns: the summary is still written', async () => {
    const events = await run(async () => { throw new Error('OpenRouter 404: nope'); });
    assert.ok(events.some((e) => e.type === 'warning' && /Screening was skipped/.test(e.text)));
    assert.ok(!events.some((e) => e.type === 'error'));
    assert.equal(events.at(-1).type, 'done');
  });
  test('a screen that has nothing to say changes nothing', async () => {
    assert.equal((await run(async () => null)).at(-1).type, 'done');
  });
});

test('the prompt tells the writer about removed tweets and the signal', () => {
  assert.match(buildPrompt({ length: 'brief', tweets, instruction: 'x' }, new Date(), undefined, { dropped: 4 }), /4 off-topic or spam tweets were removed/);
});
