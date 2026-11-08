// The landscape (INTENT.md sections 6, 9 and 13): one bubble per Signal topic, bubble size = its score, topics that are talked about together drawn close and named as a cluster.
// Pure functions (no Worker APIs), so Node can test them. The Monitor counts which topics share items, calls `layoutLandscape` once a day per window and keeps the result, so the picture
// the view draws is only x, y and r. No model is involved: clusters come from counting, names from the strongest topic of each cluster.
// Steady from day to day: a layout starts from the previous one (same topics stay where they were, a cluster keeps its id and its name while its lead topic is still in it), so a day's
// news moves a few bubbles, not the whole picture.

export const LAND_W = 1000, LAND_H = 640;
/** The biggest group of topics that is called a cluster: more than this and the name stops saying anything. */
export const MAX_CLUSTER = 6;
/** The smallest part of the items of two topics that must be shared (shared / either) for them to be talked about together, and the least number of shared items. */
const MIN_AFFINITY = 0.08, MIN_SHARED = 2;
/** What two topics that sat in one cluster yesterday get extra, so a cluster does not fall apart over a few items. */
const STAY_BONUS = 0.15;
const R_MIN = 15, R_MAX = 64;

/** Words that name the whole field rather than a subject in it. A topic made only of these ("AI agent", "AI", "LLM models") is too broad to group others under or to name a group. */
const BROAD = new Set('ai artificial intelligence agent agents agentic model models llm llms tool tools tech technology data new app apps software system systems chatbot chatbots generative genai gen'.split(' '));
export const isBroadTopic = (label: string): boolean => { const w = String(label).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); return !w.length || w.every((x) => BROAD.has(x)); };

export interface LandTopic { key: string; label: string; score: number }
export interface LandBubble { key: string; x: number; y: number; r: number; /** The cluster's id; '' for a topic that has no partner. */ cluster: string }
export interface LandCluster { id: string; name: string; x: number; y: number; r: number; /** The key of its strongest topic. */ lead: string; members: string[] }
export interface Layout { w: number; h: number; clusters: LandCluster[]; bubbles: LandBubble[] }

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** How many items mention each topic, and each pair of topics. `names` of a topic are all the terms it is counted under. */
export function coCounts(topics: Array<{ key: string; names: string[] }>, items: Array<{ terms: Iterable<string> }>): { n: Map<string, number>; pair: Map<string, number> } {
  const owner = new Map<string, string[]>();
  for (const t of topics) for (const name of t.names) (owner.get(name) ?? owner.set(name, []).get(name)!).push(t.key);
  const n = new Map<string, number>(), pair = new Map<string, number>();
  for (const it of items) {
    const here = new Set<string>();
    for (const term of it.terms) for (const k of owner.get(term) ?? []) here.add(k);
    const ks = [...here].sort();
    for (const k of ks) n.set(k, (n.get(k) ?? 0) + 1);
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) pair.set(pairKey(ks[i], ks[j]), (pair.get(pairKey(ks[i], ks[j])) ?? 0) + 1);
  }
  return { n, pair };
}

/**
 * Groups of topics talked about together: the pairs with the most shared items (shared over either's) join first, a group never grows past MAX_CLUSTER. Every topic is in exactly one group
 * (alone when it has no partner). `before` is the cluster each topic was in the last time, which makes a pair that sat together stay together. Strongest topic first in each group.
 */
export function clusterTopics(topics: LandTopic[], co: { n: Map<string, number>; pair: Map<string, number> }, before: Map<string, string> = new Map()): string[][] {
  const score = new Map(topics.map((t) => [t.key, t.score] as const)), keys = topics.map((t) => t.key), broad = new Set(topics.filter((t) => isBroadTopic(t.label)).map((t) => t.key));
  const edges: Array<{ a: string; b: string; w: number }> = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j], both = co.pair.get(pairKey(a, b)) ?? 0;
    if (both < MIN_SHARED || broad.has(a) || broad.has(b)) continue;   // a topic as broad as "AI agent" is talked about with everything: it would pull unrelated topics into one group
    const w = both / Math.max(1, (co.n.get(a) ?? 0) + (co.n.get(b) ?? 0) - both) + (before.get(a) && before.get(a) === before.get(b) ? STAY_BONUS : 0);
    if (w >= MIN_AFFINITY) edges.push({ a, b, w });
  }
  edges.sort((x, y) => y.w - x.w || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
  const group = new Map<string, string[]>(keys.map((k) => [k, [k]]));
  for (const e of edges) {
    const ga = group.get(e.a)!, gb = group.get(e.b)!;
    if (ga === gb || ga.length + gb.length > MAX_CLUSTER) continue;
    const merged = [...ga, ...gb];
    for (const k of merged) group.set(k, merged);
  }
  const rank = (k: string) => score.get(k) ?? 0;
  return [...new Set(group.values())].map((g) => [...g].sort((a, b) => rank(b) - rank(a) || (a < b ? -1 : 1))).sort((a, b) => rank(b[0]) - rank(a[0]) || (a[0] < b[0] ? -1 : 1));
}

/** A small stable number from a text (for the direction a new bubble starts in). */
function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

interface Disc { x: number; y: number; r: number }
/** The first free place (golden-angle spiral out from `c`) where a disc of radius `r` touches nothing in `taken` and stays inside the box. */
function freeSpot(taken: Disc[], r: number, c: { x: number; y: number }, gap = 8): { x: number; y: number } {
  for (let i = 0; i < 6000; i++) {
    const a = i * 2.399963, d = 4 * Math.sqrt(i), x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
    if (x < r || y < r || x > LAND_W - r || y > LAND_H - r) continue;
    if (taken.every((t) => Math.hypot(t.x - x, t.y - y) >= t.r + r + gap)) return { x, y };
  }
  return { x: Math.min(LAND_W - r, Math.max(r, c.x)), y: Math.min(LAND_H - r, Math.max(r, c.y)) };
}

/**
 * The layout for today. `prev` is the last layout (yesterday's, or earlier today's): topics in it start where they were. Same input always gives the same layout.
 * At most about 30 topics fit with room to read; the circles shrink together if they ever would not.
 */
export function layoutLandscape(topics: LandTopic[], co: { n: Map<string, number>; pair: Map<string, number> }, prev?: Layout | null): Layout {
  const list = [...topics].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  if (!list.length) return { w: LAND_W, h: LAND_H, clusters: [], bubbles: [] };
  const byKey = new Map(list.map((t) => [t.key, t] as const)), top = Math.max(1e-9, list[0].score);
  const prevAt = new Map((prev?.bubbles ?? []).map((b) => [b.key, b] as const));
  const before = new Map((prev?.bubbles ?? []).filter((b) => b.cluster).map((b) => [b.key, b.cluster] as const));

  // ---- clusters, and which earlier cluster each one is (keeps its id, its place and, while its lead is still in it, its name)
  const groups = clusterTopics(list, co, before);
  const taken = new Set<string>(), match = new Map<string[], LandCluster>();
  const cands: Array<{ g: string[]; p: LandCluster; over: number }> = [];
  for (const g of groups) if (g.length > 1) for (const p of prev?.clusters ?? []) {
    const over = g.filter((k) => p.members.includes(k)).length;
    if (over && (g.includes(p.lead) || over * 2 >= g.length)) cands.push({ g, p, over });
  }
  cands.sort((a, b) => b.over - a.over || (a.p.id < b.p.id ? -1 : 1));
  for (const c of cands) if (!match.has(c.g) && !taken.has(c.p.id)) { match.set(c.g, c.p); taken.add(c.p.id); }
  const clusters: Array<LandCluster & { g: string[]; fromPrev: boolean }> = [];
  for (const g of groups) {
    if (g.length < 2) continue;
    const p = match.get(g), lead = g[0];
    let id = p ? p.id : 'c-' + lead;
    for (let n = 2; !p && (taken.has(id) || clusters.some((c) => c.id === id)); n++) id = `c-${lead}-${n}`;
    taken.add(id);
    clusters.push({ id, name: p && g.includes(p.lead) ? p.name : byKey.get(lead)!.label, x: p?.x ?? 0, y: p?.y ?? 0, r: 0, lead, members: g, g, fromPrev: !!p });
  }
  const clusterOf = new Map<string, (typeof clusters)[number]>();
  for (const c of clusters) for (const k of c.g) clusterOf.set(k, c);

  // ---- circles: area follows the score, so a topic twice as big has a bubble 1.4 times as wide
  let scale = 1;
  const radius = (k: string) => (R_MIN + (R_MAX - R_MIN) * Math.sqrt(byKey.get(k)!.score / top)) * scale;
  const pos = new Map<string, Disc>();
  const placed = (): Disc[] => [...pos.values()];
  // known bubbles first (they keep their place), then clusters that have no place, then what is new in them, then the rest
  for (const t of list) { const p = prevAt.get(t.key); if (p) pos.set(t.key, { x: Math.min(LAND_W - 10, Math.max(10, p.x)), y: Math.min(LAND_H - 10, Math.max(10, p.y)), r: radius(t.key) }); }
  for (const c of clusters) {
    const known = c.g.filter((k) => pos.has(k));
    const centre = known.length ? { x: known.reduce((s, k) => s + pos.get(k)!.x, 0) / known.length, y: known.reduce((s, k) => s + pos.get(k)!.y, 0) / known.length }
      : c.fromPrev ? { x: c.x, y: c.y } : freeSpot(placed(), 70 + 20 * c.g.length, { x: LAND_W / 2, y: LAND_H / 2 }, 20);
    for (const k of c.g) if (!pos.has(k)) { const r = radius(k), a = hash(k) * Math.PI * 2; pos.set(k, { ...freeSpot(placed(), r, { x: centre.x + Math.cos(a) * 12, y: centre.y + Math.sin(a) * 12 }, 4), r }); }
  }
  for (const t of list) if (!pos.has(t.key)) { const r = radius(t.key); pos.set(t.key, { ...freeSpot(placed(), r, { x: LAND_W / 2, y: LAND_H / 2 }, 10), r }); }
  const start = new Map([...pos].map(([k, d]) => [k, { x: d.x, y: d.y }] as const));

  // ---- settle: partners are pulled together, everything is pushed apart, clusters keep a gap between them
  const keys = list.map((t) => t.key);
  const clamp = (d: Disc) => { d.x = Math.min(LAND_W - d.r, Math.max(d.r, d.x)); d.y = Math.min(LAND_H - d.r, Math.max(d.r, d.y)); };
  const separate = (gapIn: number, gapOut: number, k: number): number => {
    let worst = 0;
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = pos.get(keys[i])!, b = pos.get(keys[j])!, ca = clusterOf.get(keys[i]), cb = clusterOf.get(keys[j]);
      const need = a.r + b.r + (ca && ca === cb ? gapIn : ca || cb ? gapOut : gapIn + 4);
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= need) continue;
      if (d < 1e-6) { const ang = hash(keys[i] + keys[j]) * Math.PI * 2; dx = Math.cos(ang); dy = Math.sin(ang); d = 1; }
      const push = ((need - d) / 2) * k, ux = dx / d, uy = dy / d;
      a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      worst = Math.max(worst, need - d);
    }
    for (const kk of keys) clamp(pos.get(kk)!);
    return worst;
  };
  const centroid = (c: (typeof clusters)[number]) => ({ x: c.g.reduce((s, k) => s + pos.get(k)!.x, 0) / c.g.length, y: c.g.reduce((s, k) => s + pos.get(k)!.y, 0) / c.g.length });
  const extent = (c: (typeof clusters)[number]) => { const m = centroid(c); return { ...m, r: Math.max(...c.g.map((k) => Math.hypot(pos.get(k)!.x - m.x, pos.get(k)!.y - m.y) + pos.get(k)!.r)) }; };

  for (let attempt = 0; attempt < 10; attempt++) {
    for (const t of keys) pos.get(t)!.r = radius(t);
    for (let it = 0; it < 220; it++) {
      const cool = 1 - it / 260;
      for (const c of clusters) {
        const m = centroid(c);
        for (const k of c.g) { const d = pos.get(k)!; d.x += (m.x - d.x) * 0.05 * cool; d.y += (m.y - d.y) * 0.05 * cool; }
      }
      for (const k of keys) if (!clusterOf.has(k)) { const d = pos.get(k)!, s = start.get(k)!; d.x += (s.x - d.x) * 0.02; d.y += (s.y - d.y) * 0.02; }   // a lone topic stays near where it was
      for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {   // clusters keep apart
        const a = extent(clusters[i]), b = extent(clusters[j]), need = a.r + b.r + 18, d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d >= need) continue;
        const ux = d > 1e-6 ? (b.x - a.x) / d : 1, uy = d > 1e-6 ? (b.y - a.y) / d : 0, push = ((need - d) / 2) * 0.25;
        for (const k of clusters[i].g) { const q = pos.get(k)!; q.x -= ux * push; q.y -= uy * push; }
        for (const k of clusters[j].g) { const q = pos.get(k)!; q.x += ux * push; q.y += uy * push; }
      }
      separate(6, 22, 0.6);
    }
    let worst = 0;
    for (let it = 0; it < 80; it++) worst = separate(3, 3, 1);
    if (worst < 0.4) break;
    scale *= 0.92;   // no room: all circles a little smaller, from where they are
  }

  const round = (v: number) => Math.round(v * 10) / 10;
  const bubbles: LandBubble[] = list.map((t) => { const d = pos.get(t.key)!; return { key: t.key, x: round(d.x), y: round(d.y), r: round(d.r), cluster: clusterOf.get(t.key)?.id ?? '' }; });
  return {
    w: LAND_W, h: LAND_H, bubbles,
    clusters: clusters.map((c) => { const e = extent(c); return { id: c.id, name: c.name, x: round(e.x), y: round(e.y), r: round(e.r + 8), lead: c.lead, members: c.g }; }),
  };
}

/** The topics a layout holds, as a sorted text: the Monitor draws the layout again when this differs from today's topics. */
export const layoutKeys = (l: Pick<Layout, 'bubbles'>): string => l.bubbles.map((b) => b.key).sort().join('|');

/** Checks the pieces of a stored layout before it is used as the start of a new one (it comes from the database as text). */
export function cleanLayout(raw: unknown): Layout | null {
  const l = raw as Layout | null;
  if (!l || !Array.isArray(l.bubbles) || !Array.isArray(l.clusters)) return null;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const bubbles = l.bubbles.filter((b) => typeof b?.key === 'string' && num(b.x) && num(b.y) && num(b.r) && typeof b.cluster === 'string');
  const clusters = l.clusters.filter((c) => typeof c?.id === 'string' && typeof c.name === 'string' && num(c.x) && num(c.y) && num(c.r) && typeof c.lead === 'string' && Array.isArray(c.members));
  return { w: LAND_W, h: LAND_H, bubbles, clusters };
}

/**
 * The picture for one lens: only the topics of the lens, drawn as large as the box allows, so a lens looks different from the whole landscape instead of the same bubbles with other colours.
 * A topic that is part of a bigger topic in the list sits against it and they share a ring. No history and no co-counts are needed, so it is made on the spot; the same input gives the same picture.
 * Bubble area follows the score, as in layoutLandscape.
 */
export function layoutLens(topics: Array<LandTopic & { parent?: string }>): Layout {
  const list = [...topics].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).slice(0, 30);
  if (!list.length) return { w: LAND_W, h: LAND_H, clusters: [], bubbles: [] };
  const have = new Set(list.map((t) => t.key)), top = Math.max(1e-9, list[0].score);
  const kids = new Map<string, string[]>();
  const broadKey = new Set(list.filter((t) => isBroadTopic(t.label)).map((t) => t.key));
  for (const t of list) if (t.parent && have.has(t.parent) && t.parent !== t.key && !broadKey.has(t.parent)) (kids.get(t.parent) ?? kids.set(t.parent, []).get(t.parent)!).push(t.key);
  const child = new Set([...kids.values()].flat());
  const heads = list.filter((t) => !child.has(t.key));
  const cx = LAND_W / 2, cy = LAND_H / 2;

  const tryPlace = (k: number): Map<string, Disc> | null => {
    const radius = (key: string) => Math.max(16, k * Math.sqrt(list.find((t) => t.key === key)!.score / top));
    const pos = new Map<string, Disc>(), taken: Disc[] = [];
    const spot = (r: number, c: { x: number; y: number }, gap: number): Disc | null => {
      for (let i = 0; i < 4000; i++) {
        const a = i * 2.399963, d = 3 * Math.sqrt(i), x = c.x + Math.cos(a) * d * 1.55, y = c.y + Math.sin(a) * d;
        if (x < r + 4 || y < r + 4 || x > LAND_W - r - 4 || y > LAND_H - r - 4) continue;
        if (taken.every((t) => Math.hypot(t.x - x, t.y - y) >= t.r + r + gap)) return { x, y, r };
      }
      return null;
    };
    for (const h of heads) {
      const d = spot(radius(h.key), { x: cx, y: cy }, 14);
      if (!d) return null;
      pos.set(h.key, d); taken.push(d);
      for (const kid of kids.get(h.key) ?? []) {
        const e = spot(radius(kid), { x: d.x, y: d.y }, 5);
        if (!e) return null;
        pos.set(kid, e); taken.push(e);
      }
    }
    return pos;
  };
  let k = 230, pos = tryPlace(k);
  while (!pos && k > 20) { k *= 0.94; pos = tryPlace(k); }
  const at = pos ?? new Map<string, Disc>();
  const round = (v: number) => Math.round(v * 10) / 10;
  const clusters: LandCluster[] = [];
  for (const [head, ks] of kids) {
    const members = [head, ...ks].filter((x) => at.has(x));
    if (members.length < 2) continue;
    const mx = members.reduce((s, x) => s + at.get(x)!.x, 0) / members.length, my = members.reduce((s, x) => s + at.get(x)!.y, 0) / members.length;
    const r = Math.max(...members.map((x) => Math.hypot(at.get(x)!.x - mx, at.get(x)!.y - my) + at.get(x)!.r)) + 8;
    clusters.push({ id: 'c-' + head, name: list.find((t) => t.key === head)!.label, x: round(mx), y: round(my), r: round(r), lead: head, members });
  }
  const inCluster = new Map<string, string>();
  for (const c of clusters) for (const m of c.members) inCluster.set(m, c.id);
  return { w: LAND_W, h: LAND_H, clusters, bubbles: list.filter((t) => at.has(t.key)).map((t) => ({ key: t.key, x: round(at.get(t.key)!.x), y: round(at.get(t.key)!.y), r: round(at.get(t.key)!.r), cluster: inCluster.get(t.key) ?? '' })) };
}
