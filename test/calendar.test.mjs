// The heat calendar.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { calendar, levelOf } from '../src/signal/calendar.ts';

const days = (n, start = '2026-10-12') => Array.from({ length: n }, (_, i) => new Date(Date.parse(start + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));

describe('calendar', () => {
  test('weeks start on Monday, and cells sit in their weekday row', () => {
    const c = calendar(days(30, '2026-10-14'), new Array(30).fill(1));   // 14 Oct 2026 is a Wednesday
    assert.equal(c.cells[0].row, 2);
    assert.equal(c.cells[0].col, 0);
    assert.equal(c.cells[5].row, 0);   // the Monday after
    assert.equal(c.cells[5].col, 1);
    assert.equal(c.weeks, 5);
  });
  test('levels rise with the share of the busiest day, zero is blank', () => {
    assert.equal(levelOf(0, 10), 0);
    assert.equal(levelOf(10, 10), 4);
    assert.ok(levelOf(1, 100) >= 1);
  });
  test('names the busiest day and a weekday that stands out', () => {
    const d = days(28), counts = d.map((x) => (new Date(x + 'T00:00:00Z').getUTCDay() === 2 ? 10 : 3));   // Tuesdays
    counts[15] = 12;
    const c = calendar(d, counts);
    assert.match(c.busiest, /Tuesday 27 Oct, with 12 mentions/);
    assert.match(c.pattern, /^Tuesdays are busiest/);
  });
  test('a quiet weekend is said, too little says nothing', () => {
    const d = days(28), counts = d.map((x) => ([0, 6].includes(new Date(x + 'T00:00:00Z').getUTCDay()) ? 1 : 5));
    assert.match(calendar(d, counts).pattern, /weekends/);
    assert.equal(calendar(days(10), new Array(10).fill(1)).pattern, '');
    assert.equal(calendar([], []).weeks, 0);
  });
});
