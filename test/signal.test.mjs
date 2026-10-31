import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTerms } from '../src/signal/terms.ts';
import { distinctive, dropParts, rising, scoreTerms } from '../src/signal/score.ts';

describe('extractTerms', () => {
  test('hashtags, words, phrases and acronyms; no links, mentions or stop words', () => {
    const t = extractTerms('The Fed holds interest rates. @someone says AI chips #Nvidia https://example.com/x');
    for (const want of ['#nvidia', 'interest', 'rates', 'interest rates', 'ai', 'chips', 'ai chips', 'holds']) assert.ok(t.includes(want), want);
    for (const no of ['the', 'someone', 'https', 'example', 'rates ai']) assert.ok(!t.includes(no), no);
  });
  test('a phrase does not run across a sentence break, and each term is counted once per text', () => {
    const t = extractTerms('Markets fell. Apple rose. Apple rose again');
    assert.ok(!t.includes('fell apple'));
    assert.equal(t.filter((x) => x === 'apple rose').length, 1);
  });
  test('is bounded and tolerates junk', () => {
    assert.ok(extractTerms(Array.from({ length: 200 }, (_, i) => `word${'x'.repeat(i % 5)}abc`).join(' ')).length <= 40);
    assert.deepEqual(extractTerms(''), []);
    assert.deepEqual(extractTerms(undefined), []);
  });
});

const G = (key, weight = 1) => ({ key, name: key, weight });
const counts = (o) => new Map(Object.entries(o));

describe('scoreTerms', () => {
  const groups = [G('x'), G('news'), G('hn')];
  const items = { x: 100, news: 100, hn: 100 }, prevItems = { x: 100, news: 100, hn: 100 };

  test('a term in every group is shared; a term in one group is single', () => {
    const { terms } = scoreTerms({ groups, items, prevItems, prev: counts({}),
      cur: counts({ everywhere: { x: 20, news: 20, hn: 20 }, onlyx: { x: 30 }, some: { x: 10, news: 5 } }) });
    const by = Object.fromEntries(terms.map((t) => [t.term, t]));
    assert.equal(by.everywhere.kind, 'shared');
    assert.equal(by.onlyx.kind, 'single');
    assert.equal(by.onlyx.topGroup, 'x');
    assert.ok(by.onlyx.exclusivity > 0.99);
    assert.equal(by.some.kind, 'mixed');
  });

  test('weights move the signal: muting a group removes its voice', () => {
    const cur = counts({ topic: { x: 30, news: 0, hn: 0 }, other: { x: 0, news: 20, hn: 20 } });
    const a = scoreTerms({ groups, items, prevItems, cur, prev: counts({}) }).terms;
    assert.equal(a[0].term, 'other');
    const b = scoreTerms({ groups: [G('x', 3), G('news', 1), G('hn', 1)], items, prevItems, cur, prev: counts({}) }).terms;
    assert.equal(b[0].term, 'topic');
    const c = scoreTerms({ groups: [G('x', 0), G('news'), G('hn')], items, prevItems, cur, prev: counts({}) });
    assert.ok(!c.terms.some((t) => t.term === 'topic'), 'topic only lived in the muted group');
    assert.equal(c.active.length, 2);
  });

  test('a busy group does not drown a small one: shares, not counts', () => {
    const { terms } = scoreTerms({ groups: [G('big'), G('small')], items: { big: 1000, small: 20 }, prevItems: {}, prev: counts({}),
      cur: counts({ t: { big: 10, small: 10 } }) });
    assert.ok(terms[0].groups.find((g) => g.key === 'small').part > 0.9);
  });

  test('change and new terms need an earlier window with enough items', () => {
    const cur = counts({ up: { x: 30, news: 30 }, flat: { x: 20, news: 20 }, fresh: { x: 15, news: 15 } });
    const prev = counts({ up: { x: 5, news: 5 }, flat: { x: 20, news: 20 } });
    const r = scoreTerms({ groups: [G('x'), G('news')], items, prevItems, cur, prev });
    const by = Object.fromEntries(r.terms.map((t) => [t.term, t]));
    assert.ok(by.up.change > 3);
    assert.ok(Math.abs(by.flat.change - 1) < 0.01);
    assert.equal(by.fresh.isNew, true);
    assert.deepEqual(rising(r.terms, 5).map((t) => t.term).sort(), ['fresh', 'up']);   // flat is not rising
    const none = scoreTerms({ groups: [G('x')], items: { x: 100 }, prevItems: { x: 2 }, cur: counts({ up: { x: 30 } }), prev: counts({}) });
    assert.equal(none.baselineOk, false);
    assert.equal(none.terms[0].change, null);
    assert.equal(none.terms[0].isNew, false);
  });

  test('terms below the minimum, and everything when nothing has a weight, are left out', () => {
    assert.deepEqual(scoreTerms({ groups, items, prevItems, prev: counts({}), cur: counts({ rare: { x: 2 } }) }).terms, []);
    assert.deepEqual(scoreTerms({ groups: [G('x', 0)], items, prevItems, prev: counts({}), cur: counts({ t: { x: 50 } }) }).terms, []);
  });

  test('one stray mention in a big group is not presence', () => {
    const { terms } = scoreTerms({ groups, items, prevItems, prev: counts({}), cur: counts({ t: { x: 30, news: 1, hn: 1 } }) });
    assert.equal(terms[0].breadth, 1);
    assert.equal(terms[0].kind, 'single');
  });
});

describe('dropParts and distinctive', () => {
  test('keeps the phrase when it carries almost all of the word\'s mentions', () => {
    const t = (term, docs) => ({ term, docs, groups: [] });
    assert.deepEqual(dropParts([t('interest rates', 20), t('interest', 22), t('rates', 40), t('fed', 9)]).map((x) => x.term), ['interest rates', 'rates', 'fed']);
  });
  test('what one group talks about that the others do not', () => {
    const { terms } = scoreTerms({ groups: [G('x'), G('news')], items: { x: 100, news: 100 }, prevItems: {}, prev: counts({}),
      cur: counts({ mine: { x: 30, news: 1 }, both: { x: 20, news: 20 }, theirs: { x: 1, news: 30 } }) });
    assert.deepEqual(distinctive(terms, 'x', 5).map((t) => t.term), ['mine']);
    assert.deepEqual(distinctive(terms, 'news', 5).map((t) => t.term), ['theirs']);
  });
});
