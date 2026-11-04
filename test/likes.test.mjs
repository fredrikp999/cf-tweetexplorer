import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { countAtLeast, findFit, historyRows, LIKE_RUNGS, liveRows, MAX_CHECKS, propose, startFrom, worstCost } from '../src/collect/likes.ts';

/** A list as X would answer it: the posts over the threshold, cut off at one page. */
const listOf = (all) => {
  const reads = [];
  const check = async (min) => { reads.push(min); return all.filter((l) => l >= min).slice(0, 20); };
  return { check, reads };
};
const many = (n, likes) => Array.from({ length: n }, () => likes);

describe('finding the lowest setting that fits', () => {
  test('finds the lowest rung with room left, and knows every post at it', async () => {
    const all = [...many(100, 120), ...many(30, 600), ...many(10, 3000)], { check } = listOf(all);
    const r = await findFit(check, 20);
    assert.equal(r.fit, 1000);      // 500 still has 40 posts over it; 1000 has only the 10 at 3000
    assert.equal(r.likes.length, 10);
    assert.equal(r.complete, true);
  });
  test('a quiet list fits at no threshold at all', async () => {
    const r = await findFit(listOf(many(3, 2)).check, 20);
    assert.equal(r.fit, 0);
  });
  test('a list too busy for every rung has no fit', async () => {
    const r = await findFit(listOf(many(40, 90000)).check, 20);
    assert.equal(r.fit, null);
  });
  test('stays within the reads the cost estimate promises, wherever it starts', async () => {
    for (const start of [undefined, ...LIKE_RUNGS.keys()]) for (const likes of [2, 300, 7000, 90000]) {
      const { check, reads } = listOf(many(40, likes));
      await findFit(check, 20, start);
      assert.ok(reads.length <= MAX_CHECKS, `${reads.length} reads from ${start}`);
    }
  });
  test('a start from history is read first', async () => {
    const { check, reads } = listOf(many(30, 600));
    await findFit(check, 20, 8);
    assert.equal(reads[0], LIKE_RUNGS[8]);
  });
  test('a full read rules out the higher rungs it already proves too low', async () => {
    const { check, reads } = listOf([...many(30, 6000)]);
    await findFit(check, 20);
    assert.ok(!reads.includes(1000) || reads.indexOf(1000) === 0);
    assert.ok(!reads.includes(5000));
  });
  test('a search the budget stops is not reported as finished', async () => {
    let n = 0;
    const r = await findFit(async (min) => (++n > 1 ? null : many(20, min)), 20);
    assert.deepEqual([r.fit, r.complete], [null, false]);
  });
  test('the worst case is every check reading full pages', () => {
    assert.ok(Math.abs(worstCost(2, 1) - 2 * MAX_CHECKS * 20 * 0.00015) < 1e-9);
  });
});

describe('what each setting would buy', () => {
  const row = (rows, min) => rows.find((r) => r?.minFaves === min);
  test('under its fit a list fills its pages; at or above it the count is exact', () => {
    const rows = liveRows([{ fit: 1000, likes: [1500, 3000, 6000] }], 20);
    assert.deepEqual(row(rows, 500), { minFaves: 500, posts: 20, cost: 20 * 0.00015, over: 1, thin: 0 });
    assert.equal(row(rows, 1000).posts, 3);
    assert.equal(row(rows, 1000).over, 0);
    assert.equal(row(rows, 1000).thin, 1);
    assert.equal(row(rows, 5000).posts, 1);
  });
  test('an empty read still costs one tweet', () => {
    assert.ok(Math.abs(row(liveRows([{ fit: 0, likes: [] }], 20), 100).cost - 0.00015) < 1e-9);
  });
  test('a list with no fit is over the limit everywhere', () => {
    assert.ok(liveRows([{ fit: null, likes: [] }], 20).every((r) => r.over === 1 && r.posts === 20));
  });
  test('history cannot speak below what was read', () => {
    const rows = historyRows([{ floor: 100, runs: [many(20, 500)] }], 20);
    assert.equal(row(rows, 50), undefined);
    assert.equal(rows[LIKE_RUNGS.indexOf(50)], null);
    assert.equal(row(rows, 100).posts, 20);
  });
  test('history averages over the runs, and a run that filled its pages is over the limit', () => {
    const rows = historyRows([{ floor: 100, runs: [many(20, 150), [...many(10, 150), ...many(10, 2000)]] }], 20);
    assert.equal(row(rows, 100).posts, 20);
    assert.equal(row(rows, 100).over, 1);
    assert.equal(row(rows, 1000).posts, 5);
    assert.equal(row(rows, 1000).over, 0);
  });
  test('no history: every rung is unknown', () => {
    assert.ok(historyRows([{ floor: 0, runs: [] }], 20).every((r) => r === null));
    assert.equal(propose(historyRows([{ floor: 0, runs: [] }], 20), 1), null);
  });
  test('counts at or above the threshold', () => assert.equal(countAtLeast([1, 5, 9], 5), 2));
});

describe('the proposal', () => {
  test('one list: the lowest rung where it fits', () => {
    assert.equal(propose(liveRows([{ fit: 1000, likes: [1500, 3000] }], 20), 1), 1000);
  });
  test('a group need not wait for its one busiest list', () => {
    const quiet = Array.from({ length: 4 }, () => ({ fit: 100, likes: many(10, 400) })), busy = { fit: 10000, likes: [12000] };
    assert.equal(propose(liveRows([...quiet, busy], 20), 5), 100);
  });
  test('never proposes a rung that leaves nothing', () => {
    const rows = liveRows([{ fit: 0, likes: [] }], 20);
    assert.equal(propose(rows, 1), null);
  });
  test('history gives the live search its first guess', () => {
    assert.equal(LIKE_RUNGS[startFrom({ floor: 100, runs: [[...many(13, 2000), ...many(7, 150)]] }, 20)], 250);
    assert.equal(startFrom({ floor: 100, runs: [] }, 20), undefined);
    assert.equal(startFrom(undefined, 20), undefined);
  });
});
