// Which papers get lifted out of date order, and which links count as being about a paper.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { arxivIdsIn, attentionOf, coinedName, namesIn, trustedNames } from '../src/signal/attention.ts';

describe('finding a paper in a post', () => {
  test('abstract, PDF, HTML and the sites that mirror them, without the version', () => {
    assert.deepEqual(arxivIdsIn('see https://arxiv.org/abs/2610.18861v2 and arxiv.org/pdf/2610.12242.pdf'), ['2610.18861', '2610.12242']);
    assert.deepEqual(arxivIdsIn('https://huggingface.co/papers/2610.11765 https://www.alphaxiv.org/abs/2610.13166 https://arxiv.org/html/2610.28577v1'), ['2610.11765', '2610.13166', '2610.28577']);
  });
  test('the same paper twice is one, and a number or a word alone is not a paper', () => {
    assert.deepEqual(arxivIdsIn('arxiv.org/abs/2610.11765 arxiv.org/pdf/2610.11765'), ['2610.11765']);
    assert.deepEqual(arxivIdsIn('our new paper 2610.11765 on arxiv'), []);
  });
});

describe('a paper named without a link', () => {
  // Real titles and posts, from a test on 1,124 posts: these were right, and the all-capitals names were ordinary words.
  test('a made-up mixed-case name counts as the name of the paper', () => {
    assert.equal(coinedName('nanoMuse: An Open-Source Personal Agent for Every Device You Own'), 'nanoMuse');
    assert.equal(coinedName('AutoEnvScaling: Automating the Data Flywheel with Terminal Agents'), 'AutoEnvScaling');
    assert.equal(coinedName('VerusEval: Evaluating LLM-Generated Verus Specifications Beyond Verifier Acceptance'), 'VerusEval');
    assert.equal(coinedName('ToFu: Exploiting and Fuzzing the LLM-Orchestrator-Tool Trust Boundary'), 'ToFu');
  });
  test('ordinary words, plain titles and products do not', () => {
    for (const t of ['SOTA: Stock Options Trading Agents', 'CASE: Cost-Aware Stopping', 'PAUSE: Search-Free Steering', 'WASD: Wasserstein-based Distillation', 'Memory: A Survey', 'Recursive Self-Improvement through Multi-Agent Self-Supervision', 'ChatGPT: A Study of Use', 'Two Words: A Title'])
      assert.equal(coinedName(t), '', t);
  });
  test('it has to be there exactly, as a whole word', () => {
    const names = new Set(['nanoMuse', 'ToFu']);
    assert.deepEqual(namesIn("nanoMuse's memory runs on the phone. • ToFu fuzzed 273 servers", names), ['nanoMuse', 'ToFu']);
    assert.deepEqual(namesIn('tofu for dinner, nanomuse and nanoMusey', names), []);
  });
  test('a name in use before its paper appeared is not that paper', () => {
    const at = Date.UTC(2026, 9, 20), day = 86_400_000, pub = new Map([['ToFu', at], ['nanoMuse', at]]);
    const good = trustedNames([{ name: 'ToFu', by: 'a', ts: at - 3 * day }, { name: 'ToFu', by: 'b', ts: at + day }, { name: 'nanoMuse', by: 'c', ts: at - day / 2 }], pub);
    assert.deepEqual([...good], ['nanoMuse']);
  });
  test('a name that very many accounts use is more likely a product', () => {
    const at = Date.UTC(2026, 9, 20), hits = Array.from({ length: 26 }, (_, i) => ({ name: 'SomeTool', by: `a${i}`, ts: at + 1000 }));
    assert.equal(trustedNames(hits, new Map([['SomeTool', at]])).size, 0);
    assert.equal(trustedNames(hits.slice(0, 25), new Map([['SomeTool', at]])).size, 1);
  });
  test('an author naming their own paper is not attention', () => {
    const a = attentionOf({ mentions: [{ by: 'simon_ycl', name: 'Simon Y', reactions: 90, url: 'https://x.com/1' }] }, ['Simon Y']);
    assert.deepEqual(a.mentions, []); assert.equal(a.top, false);
  });
  test('an id written out next to arXiv counts, a number alone does not', () => {
    assert.deepEqual(arxivIdsIn('Wang et al., Shenzhen University, arXiv 2610.26464, October'), ['2610.26464']);
    assert.deepEqual(arxivIdsIn('see arXiv:2610.26464v2'), ['2610.26464']);
    assert.deepEqual(arxivIdsIn('version 2610.26464 of the arxiv dump'), []);
  });
});

describe('attention', () => {
  const m = (by, reactions = 5, name) => ({ by, reactions, url: `https://x.com/${by}/status/1`, name });
  test('no signal is simply no signal', () => {
    const a = attentionOf({});
    assert.equal(a.top, false); assert.equal(a.score, 0); assert.deepEqual(a.mentions, []);
  });
  test('Hugging Face and Hacker News lift a paper at their thresholds', () => {
    assert.equal(attentionOf({ hf: { upvotes: 9, url: '' } }).top, false);
    assert.equal(attentionOf({ hf: { upvotes: 10, url: '' } }).top, true);
    assert.equal(attentionOf({ hn: { points: 2, comments: 0, url: '' } }).top, false);
    assert.equal(attentionOf({ hn: { points: 520, comments: 90, url: '' } }).top, true);
  });
  test('two accounts, or one post with real reach, lift it; one quiet post does not', () => {
    assert.equal(attentionOf({ mentions: [m('a')] }).top, false);
    assert.equal(attentionOf({ mentions: [m('a'), m('b')] }).top, true);
    assert.equal(attentionOf({ mentions: [m('a', 60)] }).top, true);
  });
  test('one account posting three times is one voice, kept at its best post', () => {
    const a = attentionOf({ mentions: [m('a', 1), m('A', 9), m('a', 3)] });
    assert.equal(a.mentions.length, 1); assert.equal(a.mentions[0].reactions, 9); assert.equal(a.top, false);
  });
  test('accounts that post papers for a living do not count, nor does an author about their own paper', () => {
    assert.deepEqual(attentionOf({ mentions: [m('HuggingPapers', 500)] }).mentions, []);
    const a = attentionOf({ mentions: [m('adal', 900, 'Ada Lovelace'), m('other', 2, 'Someone Else')] }, ['Ada Lovelace', 'Bo K']);
    assert.deepEqual(a.mentions.map((x) => x.by), ['other']); assert.equal(a.top, false);
  });
  test('more attention scores higher, and one enormous post cannot outweigh everything', () => {
    assert.ok(attentionOf({ hf: { upvotes: 100, url: '' } }).score > attentionOf({ hf: { upvotes: 10, url: '' } }).score);
    assert.ok(attentionOf({ hf: { upvotes: 137, url: '' }, hn: { points: 100, comments: 1, url: '' } }).score > attentionOf({ mentions: [m('a', 5_000_000)] }).score);
  });
});
