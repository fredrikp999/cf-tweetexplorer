import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionQuestions, parseDecision, parseLabels } from '../src/history/analysis.ts';

const themes = [{ name: 'A', description: 'a' }, { name: 'B', description: '' }];
const subjects = [{ name: 'S', description: '' }];
const choice = (c, extra = {}) => ({ type: 'choice', choice: c, ...extra });

describe('decision-model labelling', () => {
  test('asks one question for the theme, one for the kind, one per subject', () => {
    const q = decisionQuestions(themes, subjects);
    assert.deepEqual(Object.keys(q), ['theme', 'kind', 's0']);
    assert.deepEqual(Object.keys(q.theme.criteria), ['t0', 't1', 't2']);       // the last is "Other"
  });
  test('turns answers into a label, and flags a low-confidence theme as unsure', () => {
    assert.deepEqual(parseDecision({ theme: choice('t1', { confidence: 0.3 }), kind: choice('news'), s0: choice('against') }, 2, 1), { theme: 1, kind: 0, stance: [-1], unsure: true });
    assert.deepEqual(parseDecision({ theme: choice('t2', { probabilities: { t2: 0.9, t0: 0.1 } }), kind: choice('humor'), s0: choice('none') }, 2, 1), { theme: 2, kind: 5, stance: [null], unsure: false });
  });
  test('rejects an answer that is not one of the options', () => {
    assert.equal(parseDecision({ theme: choice('t9'), kind: choice('news') }, 2, 1), null);
    assert.equal(parseDecision({ theme: choice('t0'), kind: choice('nope') }, 2, 1), null);
    assert.equal(parseDecision({}, 2, 1), null);
  });
});

describe('chat-model labelling', () => {
  test('keeps valid labels by position and drops malformed ones', () => {
    const got = parseLabels({ labels: [{ i: 1, t: 0, k: 1, s: [1], u: 0 }, { i: 2, t: 99, k: 1, s: [1] }, { i: 3, t: 1, k: 0, s: ['-1'], u: 1 }] }, 3, 2, 1);
    assert.deepEqual([...got.keys()], [0, 2]);
    assert.deepEqual(got.get(2), { theme: 1, kind: 0, stance: [-1], unsure: true });
  });
});
