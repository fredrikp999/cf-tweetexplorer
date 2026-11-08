// The paper constellation: projection and lines.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { constellationLines, project2d } from '../src/signal/constellation.ts';

describe('constellation', () => {
  test('two clear groups land apart, and the projection fills 0..1', () => {
    const near = (base, k) => base.map((v, j) => v + Math.sin(k * 7 + j) * 0.05);
    const A = [1, 0, 0, 0, 0, 0], B = [0, 0, 0, 0, 0, 1];
    const vs = [0, 1, 2, 3].map((k) => near(A, k)).concat([0, 1, 2, 3].map((k) => near(B, k + 9)));
    const p = project2d(vs);
    const cx = (l) => l.reduce((s, q) => s + q[0], 0) / l.length;
    assert.ok(Math.abs(cx(p.slice(0, 4)) - cx(p.slice(4))) > 0.6);
    for (const [x, y] of p) { assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1); }
    assert.deepEqual(project2d(vs), p, 'the same every time');
  });
  test('small inputs do not fail', () => {
    assert.deepEqual(project2d([]), []);
    assert.deepEqual(project2d([[1, 2]]), [[0.5, 0.5]]);
  });
  test('lines join near neighbours and leave out the longest jumps', () => {
    const pts = [[0, 0], [0.05, 0], [0.1, 0], [1, 1], [0.95, 1]];
    const lines = constellationLines(pts, 0.75);
    assert.ok(lines.length >= 3 && lines.length < 4 + 1);
    assert.ok(!lines.some(([a, b]) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) > 1), 'the jump between the groups is left out');
  });
});
