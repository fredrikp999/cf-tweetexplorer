// Streams: several series over the same days drawn as bands stacked around a moving centre line, so each band's thickness is its count and the whole is the total.
// Pure functions (no Worker APIs), so Node can test them. Two pictures use it: the streamgraph of a lens (or the whole area) on the landing page, where each band is a topic,
// and "How it spread" on a topic page, where each band is a kind of source, starting where that kind first had the topic.
// The layout is the "inside-out" order and the "wiggle" baseline of Byron and Wattenberg (2008): bands that start late go to the outside, and the centre moves so bands bend as little as they can.

export interface StreamLayer { key: string; /** Bottom and top of the band at each point, in counts; the picture scales them. */ y0: number[]; y1: number[]; /** The point where the band is thickest (where its name goes). */ peak: number; /** The first point the band has anything. -1 when it never does. */ start: number; total: number }
export interface StreamLayout { layers: StreamLayer[]; /** The lowest y0 and the highest y1 over all layers and points: the picture's vertical extent. */ min: number; max: number }

/** A light smoothing, so a band does not jump from one point to the next: each point takes a quarter of each neighbour (the ends a quarter of their one neighbour). */
export function soften(v: number[]): number[] {
  if (v.length < 3) return [...v];
  return v.map((x, i) => (i === 0 ? x * 0.75 + v[1] * 0.25 : i === v.length - 1 ? x * 0.75 + v[i - 1] * 0.25 : x * 0.5 + (v[i - 1] + v[i + 1]) * 0.25));
}

/**
 * The bands. `series` are counts per point, all the same length; `order: 'given'` keeps the order they come in (the first at the centre, the rest alternating outwards),
 * 'inside-out' puts the earliest starters in the middle. The centre follows the wiggle rule, then is shifted so the picture is centred on zero overall.
 */
export function streamLayout(series: Array<{ key: string; values: number[] }>, o: { order?: 'given' | 'inside-out'; smooth?: boolean } = {}): StreamLayout {
  const list = series.map((s) => ({ key: s.key, v: (o.smooth === false ? s.values : soften(s.values)).map((x) => Math.max(0, Number(x) || 0)) })).filter((s) => s.v.some((x) => x > 0));
  const n = Math.max(0, ...list.map((s) => s.v.length));
  if (!list.length || !n) return { layers: [], min: 0, max: 0 };
  for (const s of list) while (s.v.length < n) s.v.push(0);
  const startOf = (v: number[]) => v.findIndex((x) => x > 0), sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  // inside-out: sort by when they start (then by size), and deal them to the bottom and the top in turn, so the earliest sit in the middle
  const sorted = o.order === 'given' ? list : [...list].sort((a, b) => startOf(a.v) - startOf(b.v) || sum(b.v) - sum(a.v) || (a.key < b.key ? -1 : 1));
  const below: typeof list = [], above: typeof list = [];
  sorted.forEach((s, i) => (i % 2 ? below : above).push(s));
  const ordered = [...below.reverse(), ...above];   // bottom to top
  // the wiggle baseline (as d3's stackOffsetWiggle): at each step the centre moves against the weighted slope of the bands, so the bands bend as little as they can
  const total = (i: number) => ordered.reduce((a, s) => a + s.v[i], 0);
  const g0 = new Array<number>(n).fill(0);
  let y = 0;
  for (let i = 1; i < n; i++) {
    let s1 = 0, s2 = 0;
    ordered.forEach((s, j) => {
      let s3 = (s.v[i] - s.v[i - 1]) / 2;
      for (let k = 0; k < j; k++) s3 += ordered[k].v[i] - ordered[k].v[i - 1];
      s1 += s.v[i]; s2 += s3 * s.v[i];
    });
    if (s1) y -= s2 / s1;
    g0[i] = y;
  }
  // half wiggle, half silhouette (centred on a line): pure wiggle can drift far from the middle over two weeks
  for (let i = 0; i < n; i++) g0[i] = 0.5 * g0[i] + 0.5 * (-total(i) / 2);
  const layers: StreamLayer[] = [];
  const base = [...g0];
  for (const s of ordered) {
    const y0 = [...base], y1 = base.map((b, i) => b + s.v[i]);
    let peak = 0;
    for (let i = 0; i < n; i++) if (s.v[i] > s.v[peak]) peak = i;
    layers.push({ key: s.key, y0, y1, peak, start: startOf(s.v), total: sum(s.v) });
    for (let i = 0; i < n; i++) base[i] = y1[i];
  }
  let min = Infinity, max = -Infinity;
  for (const l of layers) for (let i = 0; i < n; i++) { min = Math.min(min, l.y0[i]); max = Math.max(max, l.y1[i]); }
  const mid = (min + max) / 2;
  for (const l of layers) for (let i = 0; i < n; i++) { l.y0[i] -= mid; l.y1[i] -= mid; }
  return { layers, min: min - mid, max: max - mid };
}

/** Counts per day from timestamped items (ms): `days` ISO dates, oldest first. Items outside them are left out. */
export function perDay(ts: number[], days: string[]): number[] {
  const at = new Map(days.map((d, i) => [d, i] as const)), out = days.map(() => 0);
  for (const t of ts) { const i = at.get(new Date(t).toISOString().slice(0, 10)); if (i !== undefined) out[i]++; }
  return out;
}
