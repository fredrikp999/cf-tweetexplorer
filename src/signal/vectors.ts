// Meaning as numbers: what Signal and the briefings do with embeddings of items and topic names. Pure functions (no Worker APIs), so Node can test them;
// src/lib/embed.ts calls the model. The vectors come back unit length, so the dot product is the cosine similarity.
//
// The thresholds were set on the model itself (bge-small-en-v1.5, mean pooling, as Workers AI gives it), 2026-11-08:
//   the same post copied or reposted (a link or an emoji added, a source named) .... 0.97 to 0.99, a headline against the headline plus a sentence 0.92
//   the same story told by different people in their own words ..................... 0.73 to 0.89
//   unrelated posts on the same broad subject ...................................... 0.45 to 0.60
// So COPY_SIM sits between copies and coverage: a story many people write about still counts many times, a post copied many times counts once.
// Topic names do not separate like that: names for one thing scored 0.78 to 0.94 and names for different things 0.52 to 0.88 ("gpt-6 release" and
// "gpt-5 release" 0.88, "kimi k2" and "kimi k3" 0.83). So names are never merged by meaning alone: close names are shown to the model as names in use,
// and the closest new ones are suggested to the admin, who decides.

export const EMBED_MODEL = '@cf/baai/bge-small-en-v1.5', EMBED_PER_M = 0.02, EMBED_BATCH = 50;
/** At least this alike, and it is the same post: counted once. */
export const COPY_SIM = 0.95;
/** At least this alike, a new topic name is suggested as another name for one in use. */
export const NAME_SIM = 0.9;
/** How far back a post is compared for copies. */
export const COPY_DAYS = 3;

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
/** Unit length, so a dot product is the cosine. A vector of zeros stays zeros. */
export function unit(v: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(v), n = Math.sqrt(dot(out, out));
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}
export const toBlob = (v: ArrayLike<number>): ArrayBuffer => Float32Array.from(v).buffer;
export const fromBlob = (b: ArrayBuffer): Float32Array => new Float32Array(b);

/** The words of a post that say what it is: no links, no "Continue reading on Medium »" or "submitted by /u/…" that every post of a feed has. */
export function embedText(raw: string): string {
  return String(raw ?? '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/Continue reading on [^»]*»/gi, ' ')
    .replace(/submitted by \/u\/\S+(\s*\[link\])?(\s*\[comments\])?/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 500);
}

/**
 * Which new posts repeat an earlier one: key of the new post -> key of the post it repeats. A new post is compared with the earlier ones and with the new
 * ones before it, so the first of several copies in one batch is the one that counts. Only posts that are not copies themselves are compared with, so a
 * chain of small changes does not drift away from the original.
 */
export function findCopies(fresh: Array<{ key: string; v: ArrayLike<number> }>, earlier: Array<{ key: string; v: ArrayLike<number> }>, min = COPY_SIM): Map<string, string> {
  const out = new Map<string, string>(), originals = [...earlier];
  for (const f of fresh) {
    let best = '', top = min;
    for (const e of originals) { if (e.key === f.key) continue; const s = dot(f.v, e.v); if (s >= top) { top = s; best = e.key; } }
    if (best) out.set(f.key, best); else originals.push(f);
  }
  return out;
}

/**
 * Copies folded together: the most weighty of each set is kept (ties: the first), with how many others said the same. The order of `items` is kept.
 * Items without a vector are always kept on their own.
 */
export function foldCopies<T>(items: T[], vec: (t: T) => ArrayLike<number> | undefined, weight: (t: T) => number, min = COPY_SIM): Array<{ item: T; copies: number }> {
  const order = items.map((t, i) => i).sort((a, b) => weight(items[b]) - weight(items[a]) || a - b);
  const keep: number[] = [], copies = new Map<number, number>();
  for (const i of order) {
    const v = vec(items[i]);
    const home = v ? keep.find((k) => { const w = vec(items[k]); return !!w && dot(v, w) >= min; }) : undefined;
    if (home === undefined) { keep.push(i); copies.set(i, 0); } else copies.set(home, copies.get(home)! + 1);
  }
  return keep.sort((a, b) => a - b).map((i) => ({ item: items[i], copies: copies.get(i)! }));
}

/**
 * `k` items that matter and differ (maximal marginal relevance): each next pick is the one with the best mix of its own weight and how unlike it is to the
 * picks so far. `lambda` 1 is weight only (the old "most reactions first"); lower spreads the picks over more stories. Weights are scaled to 0..1 first.
 * Items without a vector count as unlike everything. The picks come back in the order of `items`.
 * 0.5 because with this model even unrelated posts on one broad subject are about 0.5 alike: a weaker pull towards variety lets near-copies through.
 */
export function pickVaried<T>(items: T[], vec: (t: T) => ArrayLike<number> | undefined, weight: (t: T) => number, k: number, lambda = 0.5): T[] {
  if (items.length <= k) return items.slice();
  const w = items.map(weight), hi = Math.max(...w), lo = Math.min(...w), rel = w.map((x) => (hi > lo ? (x - lo) / (hi - lo) : 1));
  const vs = items.map(vec), picked: number[] = [], near = new Float64Array(items.length).fill(0), left = new Set(items.map((_, i) => i));
  while (picked.length < k && left.size) {
    let best = -1, top = -Infinity;
    for (const i of left) { const s = lambda * rel[i] - (1 - lambda) * near[i]; if (s > top) { top = s; best = i; } }
    picked.push(best); left.delete(best);
    const b = vs[best];
    if (b) for (const i of left) { const v = vs[i]; if (v) near[i] = Math.max(near[i], dot(v, b)); }
  }
  return picked.sort((a, b) => a - b).map((i) => items[i]);
}

/**
 * The names in use that are closest to these posts: for each post its `perItem` nearest names at least `floor` alike, ranked by how often they came up
 * and then how close. What the topic model is shown as "names already in use", next to the most used ones.
 */
export function nearestNames(posts: Array<ArrayLike<number>>, names: Array<{ name: string; v: ArrayLike<number> }>, perItem = 3, floor = 0.72): string[] {
  const score = new Map<string, number>();
  for (const p of posts) {
    const near = names.map((n) => ({ name: n.name, s: dot(p, n.v) })).filter((x) => x.s >= floor).sort((a, b) => b.s - a.s).slice(0, perItem);
    for (const x of near) score.set(x.name, (score.get(x.name) ?? 0) + 1 + x.s);
  }
  return [...score].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

const numbers = (name: string) => (name.match(/\d+(?:\.\d+)?/g) ?? []).join(' ');
/** Two names that differ in a number are different things ("gpt-5" and "gpt-6", "kimi k2" and "kimi k3", "2025" and "2026"), however alike they read. */
export const versionClash = (a: string, b: string): boolean => numbers(a) !== numbers(b);

/**
 * New topic names that are probably another name for one in use: for each new name, the closest name in use when at least `min` alike, the two do not differ
 * in a number, and neither contains the other as a whole (a part of a topic, "claude code backdoor" under "claude code", is a topic of its own).
 */
export function nameSuggestions(fresh: Array<{ name: string; v: ArrayLike<number> }>, known: Array<{ name: string; v: ArrayLike<number> }>, min = NAME_SIM): Array<{ name: string; like: string; sim: number }> {
  const out: Array<{ name: string; like: string; sim: number }> = [];
  const within = (a: string, b: string) => ` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `);
  for (const f of fresh) {
    let like = '', top = min;
    for (const k of known) {
      if (k.name === f.name || versionClash(f.name, k.name) || within(f.name, k.name)) continue;
      const s = dot(f.v, k.v); if (s >= top) { top = s; like = k.name; }
    }
    if (like) out.push({ name: f.name, like, sim: Math.round(top * 1000) / 1000 });
  }
  return out;
}
