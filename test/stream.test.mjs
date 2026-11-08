// Streams: bands around a moving centre.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { perDay, soften, streamLayout } from '../src/signal/stream.ts';

describe('streamLayout', () => {
  test('each band is as thick as its count, and the bands touch', () => {
    const l = streamLayout([{ key: 'a', values: [1, 2, 3] }, { key: 'b', values: [0, 4, 1] }], { smooth: false });
    assert.equal(l.layers.length, 2);
    for (const layer of l.layers) for (let i = 0; i < 3; i++) assert.ok(layer.y1[i] >= layer.y0[i]);
    const a = l.layers.find((x) => x.key === 'a'), b = l.layers.find((x) => x.key === 'b');
    assert.deepEqual(a.y1.map((v, i) => +(v - a.y0[i]).toFixed(6)), [1, 2, 3]);
    assert.deepEqual(b.y1.map((v, i) => +(v - b.y0[i]).toFixed(6)), [0, 4, 1]);
    const [lo, hi] = l.layers;   // bottom to top: the top band starts where the bottom one ends
    assert.deepEqual(hi.y0.map((v) => +v.toFixed(6)), lo.y1.map((v) => +v.toFixed(6)));
    assert.equal(b.start, 1);
    assert.equal(b.peak, 1);
  });
  test('the picture is centred on zero, and empty series are left out', () => {
    const l = streamLayout([{ key: 'a', values: [3, 3, 3] }, { key: 'z', values: [0, 0, 0] }]);
    assert.equal(l.layers.length, 1);
    assert.ok(Math.abs(l.max + l.min) < 1e-9);
  });
  test('inside-out puts the earliest starter in the middle', () => {
    const l = streamLayout([{ key: 'late1', values: [0, 0, 5, 5] }, { key: 'early', values: [5, 5, 5, 5] }, { key: 'late2', values: [0, 0, 0, 5] }], { smooth: false });
    assert.equal(l.layers[1].key, 'early');
  });
  test('softening keeps the total', () => {
    const v = [0, 10, 0, 0, 4];
    assert.ok(Math.abs(soften(v).reduce((a, b) => a + b, 0) - 14) < 3);
  });
  test('perDay counts timestamps into their UTC day', () => {
    assert.deepEqual(perDay([Date.parse('2026-11-01T10:00Z'), Date.parse('2026-11-01T23:59Z'), Date.parse('2026-11-03T00:00Z'), 0], ['2026-11-01', '2026-11-02', '2026-11-03']), [2, 0, 1]);
  });
});
