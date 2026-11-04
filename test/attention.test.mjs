// Which papers get lifted out of date order, and which links count as being about a paper.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { arxivIdsIn, attentionOf } from '../src/signal/attention.ts';

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
