// Meaning: copies, varied picks, the names shown to the topic model and the names suggested as one. The thresholds are checked on real vectors from the model.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COPY_SIM, NAME_SIM, dot, embedText, findCopies, foldCopies, fromBlob, nameSuggestions, nearestNames, pickVaried, toBlob, unit, versionClash } from '../src/signal/vectors.ts';
import real from './helpers/vectors-fixture.mjs';

const R = Object.fromEntries(Object.entries(real.texts).map(([k, v]) => [k, unit(v)]));
const names = (...ks) => ks.map((name) => ({ name, v: unit(real.names[name]) }));
// Small hand-made vectors: a, a2 (a copy of a), b and c far from both.
const a = unit([1, 0, 0, 0]), a2 = unit([1, 0.05, 0, 0]), b = unit([0, 1, 0, 0]), c = unit([0, 0, 1, 0]), bc = unit([0, 1, 0.2, 0]);

describe('the thresholds, on the real model', () => {
  test('a reposted post is a copy', () => assert.ok(dot(R.copyA, R.copyB) >= COPY_SIM, String(dot(R.copyA, R.copyB))));
  test('the same story in other words is not', () => {
    assert.ok(dot(R.copyA, R.sameStory) < COPY_SIM);
    assert.ok(dot(R.raiseA, R.raiseB) < COPY_SIM, String(dot(R.raiseA, R.raiseB)));
  });
  test('an unrelated post is far from both', () => assert.ok(dot(R.copyA, R.other) < 0.7));
  test('names that differ in a number are never suggested, however close', () => {
    const s = nameSuggestions(names('gpt-6 release', 'kimi k3'), names('gpt-5 release', 'kimi k2'), 0.5);
    assert.deepEqual(s, []);
  });
  test('a part of a topic is not suggested as the topic', () => assert.deepEqual(nameSuggestions(names('claude code cli'), names('claude code'), 0.5), []));
  test('two wordings of one thing are suggested', () => {
    const s = nameSuggestions(names('ai in education', 'openssh flaw'), names('ai education', 'openssh vulnerability', 'claude code'));
    assert.deepEqual(s.map((x) => [x.name, x.like]), [['ai in education', 'ai education'], ['openssh flaw', 'openssh vulnerability']]);
    assert.ok(s.every((x) => x.sim >= NAME_SIM));
  });
});

describe('copies', () => {
  test('a new post that repeats an earlier one points at it', () => {
    assert.deepEqual([...findCopies([{ key: 'n1', v: a2 }, { key: 'n2', v: b }], [{ key: 'old', v: a }])], [['n1', 'old']]);
  });
  test('the first of two copies in one batch is the one that counts', () => {
    assert.deepEqual([...findCopies([{ key: 'x', v: a }, { key: 'y', v: a2 }], [])], [['y', 'x']]);
  });
  test('a post is never a copy of itself (read again)', () => assert.equal(findCopies([{ key: 'k', v: a }], [{ key: 'k', v: a }]).size, 0));
  test('folding keeps the most reacted of each set, in the given order, with the count', () => {
    const items = [{ id: 1, v: a, w: 5 }, { id: 2, v: b, w: 1 }, { id: 3, v: a2, w: 9 }, { id: 4, v: undefined, w: 0 }];
    const out = foldCopies(items, (x) => x.v, (x) => x.w);
    assert.deepEqual(out.map((x) => [x.item.id, x.copies]), [[2, 0], [3, 1], [4, 0]]);
  });
});

describe('varied picks', () => {
  const items = [{ id: 'a', v: a, w: 10 }, { id: 'a2', v: a2, w: 9 }, { id: 'b', v: b, w: 5 }, { id: 'c', v: c, w: 1 }];
  test('weight only is the old "most reacted first"', () => assert.deepEqual(pickVaried(items, (x) => x.v, (x) => x.w, 2, 1).map((x) => x.id), ['a', 'a2']));
  test('with variety, a second story beats a near-copy of the first', () => assert.deepEqual(pickVaried(items, (x) => x.v, (x) => x.w, 2).map((x) => x.id), ['a', 'b']));
  test('fewer items than asked: all of them', () => assert.equal(pickVaried(items, (x) => x.v, (x) => x.w, 9).length, 4));
});

describe('names for the topic model', () => {
  test('the names nearest the posts, the most wanted first', () => {
    const pool = [{ name: 'about a', v: a }, { name: 'about b', v: bc }, { name: 'about c', v: c }];
    assert.deepEqual(nearestNames([a, a2, b], pool, 1, 0.5), ['about a', 'about b']);
  });
  test('a name too far from every post is not shown', () => assert.deepEqual(nearestNames([a], [{ name: 'far', v: b }]), []));
});

describe('helpers', () => {
  test('a vector survives storage', () => assert.deepEqual([...fromBlob(toBlob([0.5, -1, 2]))], [0.5, -1, 2]));
  test('unit length', () => assert.ok(Math.abs(dot(unit([3, 4]), unit([3, 4])) - 1) < 1e-6));
  test('version numbers', () => { assert.ok(versionClash('gpt-5', 'gpt-6')); assert.ok(!versionClash('gpt-5 launch', 'gpt-5 release')); });
  test('the text compared leaves out links and feed boilerplate', () => {
    assert.equal(embedText('Big news https://t.co/x Continue reading on Medium »'), 'Big news');
    assert.equal(embedText('Agentic soc help submitted by /u/someone [link] [comments]'), 'Agentic soc help');
    assert.equal(embedText('Beating the frontier on NetHack\nComments'), 'Beating the frontier on NetHack');
    assert.equal(embedText('Comments on the new policy'), 'Comments on the new policy');
  });
});
