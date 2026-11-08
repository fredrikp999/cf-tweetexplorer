// The paper constellation of a research topic page: each new paper a star, placed by what it is about (its embedding, projected to two dimensions), brighter the more attention it has had,
// with faint lines joining each paper to its nearest neighbours so groups read as constellations. Pure functions (no Worker APIs), so Node can test them.
// The projection is the first two principal components (power iteration, deterministic start), so the same papers always give the same sky.

export interface Star { id: string; title: string; x: number; y: number; score: number; talked: boolean }

/** The first two principal components of `vs` (all the same length), as points scaled to 0..1 on both axes. Fewer than three vectors: spread on a line. */
export function project2d(vs: Array<ArrayLike<number>>): Array<[number, number]> {
  const n = vs.length;
  if (!n) return [];
  if (n < 3) return vs.map((_, i) => [n === 1 ? 0.5 : i, 0.5] as [number, number]);
  const d = vs[0].length, mean = new Float64Array(d);
  for (const v of vs) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  const X = vs.map((v) => { const r = new Float64Array(d); for (let j = 0; j < d; j++) r[j] = v[j] - mean[j]; return r; });
  const comp = (avoid?: Float64Array): Float64Array => {
    let w = new Float64Array(d);
    for (let j = 0; j < d; j++) w[j] = Math.sin(j * 12.9898 + (avoid ? 4.1 : 1.3)) + 0.01;   // a fixed start: same input, same sky
    for (let it = 0; it < 60; it++) {
      const next = new Float64Array(d);
      for (const r of X) { let p = 0; for (let j = 0; j < d; j++) p += r[j] * w[j]; for (let j = 0; j < d; j++) next[j] += p * r[j]; }
      if (avoid) { let p = 0; for (let j = 0; j < d; j++) p += next[j] * avoid[j]; for (let j = 0; j < d; j++) next[j] -= p * avoid[j]; }
      let norm = 0; for (let j = 0; j < d; j++) norm += next[j] * next[j];
      norm = Math.sqrt(norm);
      if (norm < 1e-12) break;
      for (let j = 0; j < d; j++) next[j] /= norm;
      w = next;
    }
    return w;
  };
  const a = comp(), b = comp(a);
  const pts = X.map((r) => { let p = 0, q = 0; for (let j = 0; j < d; j++) { p += r[j] * a[j]; q += r[j] * b[j]; } return [p, q] as [number, number]; });
  const scale = (k: 0 | 1) => { const lo = Math.min(...pts.map((p) => p[k])), hi = Math.max(...pts.map((p) => p[k])); return (v: number) => (hi - lo < 1e-12 ? 0.5 : (v - lo) / (hi - lo)); };
  const sx = scale(0), sy = scale(1);
  return pts.map(([p, q]) => [+sx(p).toFixed(4), +sy(q).toFixed(4)]);
}

/**
 * The lines of the constellations: the minimum spanning tree of the points (Prim), keeping only edges no longer than `keep` of the way up the sorted edge lengths,
 * so near neighbours are joined and far ones are not. Pairs of indexes.
 */
export function constellationLines(pts: Array<[number, number]>, keep = 0.7): Array<[number, number]> {
  const n = pts.length;
  if (n < 2) return [];
  const inTree = new Array<boolean>(n).fill(false), best = new Array<number>(n).fill(Infinity), from = new Array<number>(n).fill(-1), edges: Array<[number, number, number]> = [];
  best[0] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = true;
    if (from[u] >= 0) edges.push([from[u], u, best[u]]);
    for (let i = 0; i < n; i++) if (!inTree[i]) { const dd = Math.hypot(pts[i][0] - pts[u][0], pts[i][1] - pts[u][1]); if (dd < best[i]) { best[i] = dd; from[i] = u; } }
  }
  const sorted = edges.map((e) => e[2]).sort((x, y) => x - y), cut = sorted[Math.max(0, Math.floor((sorted.length - 1) * keep))];
  return edges.filter((e) => e[2] <= cut).map((e) => [e[0], e[1]]);
}
