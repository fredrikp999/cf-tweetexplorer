// A topic's phase from its daily counts.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lifecycle, smooth } from '../src/signal/lifecycle.ts';

const days = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);

describe('lifecycle', () => {
  test('too few mentions or days say nothing', () => {
    assert.equal(lifecycle([0, 0, 1, 0, 2, 0, 1, 0, 0, 0, 0, 0, 0, 1]), null);
    assert.equal(lifecycle([5, 5, 5]), null);
  });
  test('silence, then a rise to the end is emerging, and names when it started', () => {
    const l = lifecycle([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 3, 6, 9, 12], days);
    assert.equal(l.phase, 'emerging');
    assert.match(l.words, /11 Nov/);
  });
  test('a topic that was always there and is highest now is at its peak', () => {
    assert.equal(lifecycle([4, 5, 4, 6, 5, 5, 6, 5, 6, 7, 8, 10, 12, 13], days).phase, 'peaking');
  });
  test('a peak a week ago with little left is fading, with the share left', () => {
    const l = lifecycle([1, 2, 6, 14, 18, 15, 9, 6, 4, 3, 2, 3, 2, 2], days);
    assert.equal(l.phase, 'fading');
    assert.equal(l.peak, 4);
    assert.match(l.words, /peaked on 5 Nov/);
    assert.ok(l.level < 0.2);
  });
  test('a peak, a quiet stretch and a return is back again', () => {
    const l = lifecycle([2, 8, 14, 12, 6, 1, 0, 0, 1, 2, 6, 10, 12, 11], days);
    assert.equal(l.phase, 'returning');
    assert.equal(l.firstPeak, 2);
  });
  test('a flat line is steady', () => {
    assert.equal(lifecycle([5, 6, 5, 4, 5, 6, 5, 5, 6, 5, 4, 5, 5, 5], days).phase, 'steady');
  });
  test('smoothing keeps the length and averages neighbours', () => {
    assert.deepEqual(smooth([0, 3, 0]), [1.5, 1, 1.5]);
  });
});
