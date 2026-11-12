// Suggested questions (A10): written by rule, at most three, names cleaned.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { overviewQuestions, papersQuestions, risingQuestions, topicQuestions } from '../src/site/questions.ts';

const days = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'];
const base = { label: 'X', state: null, phase: null, peakDay: null, days, papers: 0, firstOrder: [] };

describe('topicQuestions', () => {
  test('peaking with papers and two kinds: peak, papers, from-to, with the weekday', () => {
    const q = topicQuestions({ ...base, phase: 'peaking', peakDay: '2026-11-10', papers: 2, firstOrder: ['Hacker News', 'X'] });
    assert.deepEqual(q, ['Why did X peak on Tuesday?', 'Which papers are behind X?', 'How did X get from Hacker News to X?']);
  });
  test('a peak day 10 days back gives no peak question', () => {
    const long = ['2026-10-25', '2026-10-26', ...days];
    const q = topicQuestions({ ...base, days: long, phase: 'peaking', peakDay: '2026-10-25', papers: 1 });
    assert.ok(!q.some((x) => /peak/.test(x)));
  });
  test('a steady phase gives no peak question', () => {
    assert.ok(!topicQuestions({ ...base, phase: 'steady', peakDay: '2026-11-10' }).some((x) => /peak/.test(x)));
  });
  test('a new topic', () => { assert.deepEqual(topicQuestions({ ...base, state: 'new' }), ['What is X, in two sentences?']); });
  test('returning', () => { assert.ok(topicQuestions({ ...base, phase: 'returning' }).includes('Why is X back?')); });
  test('every rule true gives exactly three', () => {
    assert.equal(topicQuestions({ ...base, state: 'new', phase: 'peaking', peakDay: '2026-11-10', papers: 3, firstOrder: ['A', 'B'] }).length, 3);
  });
  test('a messy label is made one clean line of at most 60 letters', () => {
    const q = topicQuestions({ ...base, label: '"Quoted"\nname ' + 'z'.repeat(100), papers: 1 });
    assert.equal(q.length, 1); assert.ok(!/["“”\n]/.test(q[0]));
    assert.ok(q[0].replace('Which papers are behind ', '').replace('?', '').length <= 60);
  });
  test('an empty label gives none', () => { assert.deepEqual(topicQuestions({ ...base, label: '', state: 'new' }), []); });
});

describe('the other views', () => {
  test('overview: only doubled topics, strongest first', () => {
    const q = overviewQuestions([{ label: 'A', change: 3 }, { label: 'B', change: 1.9 }, { label: 'C', change: null }, { label: 'D', change: 2 }]);
    assert.deepEqual(q, ['What is driving A this week?', 'What is driving D this week?']);
  });
  test('rising: none for a topic at the surface', () => {
    const q = risingQuestions([{ label: 'A', zone: 'deep' }, { label: 'B', zone: 'surface' }, { label: 'C', zone: 'mid' }]);
    assert.equal(q.length, 2); assert.ok(!q.some((x) => x.includes('B')));
  });
  test('papers: none for no uptake, most uptake first', () => {
    const q = papersQuestions([{ name: 'A', discussed: 0 }, { name: 'B', discussed: 4 }, { name: 'C', discussed: 2 }]);
    assert.deepEqual(q, ['What are people saying about the B papers?', 'What are people saying about the C papers?']);
  });
});
