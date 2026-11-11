// "Rising from the deep": what the page /rising, its JSON and the MCP tool `get_rising` all show, so the three cannot drift apart.
// Pure functions (no Worker APIs), so Node can test them. The Monitor gives the layout (src/signal/depth.ts); here it is joined with the lenses and put into words.
import { AREA_LABEL, topicHref, type Area } from '../signal/area.ts';
import { KIND_NAME, MIN_CLIMB, ZONE_LABEL, reachWords, zoneOf, type DepthLayout, type Reach, type Zone } from '../signal/depth.ts';
import { LENS_PALETTE, lensesOfTopic, type Lens } from '../signal/lens.ts';
import { topicState, type TopicState } from '../signal/topicpage.ts';

/** What the Monitor answers (`/mon/depth-public`). */
export type DepthRaw = DepthLayout & { days: string[]; baselineOk: boolean; meta: Array<{ key: string; term: string; members: string[]; isNew: boolean; change: number | null }> };

export interface RisingTopic {
  slug: string; label: string; url: string; state: TopicState | null; change: number | null; score: number; r: number; first: number;
  /** A lens colour name, or null: with a lens chosen only its topics have a colour. */ lensColor: string | null; inLens: boolean | null;
  b: number[]; x: Array<number | null>; y: Array<number | null>; k: number[]; g: number[]; s: number[]; m: number[];
  /** Breadth today against `span` days ago. */ rise: number;
  zone: Zone | null;
  /** Today's reach in words; null when no source had it in the last days. */ reach: string | null;
}
export interface RisingData {
  area: Area; lens: { key: string; name: string } | null; lenses: Array<{ key: string; name: string; color: string; light: string; dark: string }>;
  days: string[]; w: number; h: number; surfaceY: number; floorY: number; window: number; span: number;
  kinds: string[]; kindNames: string[]; watched: Reach; topics: RisingTopic[]; rising: string[];
  breadthIs: string;
}

export const BREADTH_IS = 'the mean of three shares over the last 3 days: kinds of source that had the topic, groups of sources, and single sources (log scale). Reach, not reactions.';

/** The layout joined with the lenses and the links. Null when there is nothing to draw. */
export function risingOf(raw: DepthRaw | null | undefined, o: { area: Area; lens?: Lens; lenses: Lens[]; origin: string }): RisingData | null {
  if (!raw?.topics?.length || !raw.days?.length) return null;
  const meta = new Map(raw.meta.map((m) => [m.key, m] as const)), last = raw.days.length - 1;
  const topics: RisingTopic[] = raw.topics.map((t) => {
    const m = meta.get(t.key), mine = lensesOfTopic(o.lenses, { term: m?.term ?? t.label, label: t.label, members: m?.members ?? [] }), inLens = o.lens ? mine.some((l) => l.key === o.lens!.key) : null;
    const state = m ? (m.isNew ? 'new' : raw.baselineOk ? topicState(m) : m.change !== null && m.change >= 1.5 ? 'rising' : null) : null, now = t.b[last] ?? 0;
    return { slug: t.key, label: t.label, url: o.origin + topicHref(t.key, o.area), state, change: m?.change ?? null, score: Math.round(t.score * 10_000) / 10_000, r: t.r, first: t.first,
      lensColor: o.lens ? (inLens ? o.lens.color : null) : mine[0]?.color ?? null, inLens, b: t.b, x: t.x, y: t.y, k: t.k, g: t.g, s: t.s, m: t.m, rise: t.rise,
      zone: now > 0 ? zoneOf(now) : null, reach: now > 0 ? reachWords({ k: t.k[last], g: t.g[last], s: t.s[last], m: t.m[last] }, raw.kinds, raw.watched) : null };
  });
  return { area: o.area, lens: o.lens ? { key: o.lens.key, name: o.lens.name } : null,
    lenses: o.lenses.map((l) => ({ key: l.key, name: l.name, color: l.color, light: LENS_PALETTE[l.color].light, dark: LENS_PALETTE[l.color].dark })),
    days: raw.days, w: raw.w, h: raw.h, surfaceY: raw.surfaceY, floorY: raw.floorY, window: raw.window, span: raw.span,
    kinds: raw.kinds, kindNames: raw.kinds.map((k) => KIND_NAME[k] ?? k), watched: raw.watched, topics, rising: raw.rising, breadthIs: BREADTH_IS };
}

export const pctOf = (v: number): string => Math.round(v * 100) + '%';
const dayWords = (iso: string): string => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** One climb in words: where it was `span` days ago and where it is now. */
export function climbWords(t: RisingTopic, d: Pick<RisingData, 'days' | 'span'>): string {
  const last = d.days.length - 1, then = t.b[Math.max(0, last - d.span)] ?? 0, now = t.b[last] ?? 0, was = then > 0 ? ZONE_LABEL[zoneOf(then)].toLowerCase() : 'not there';
  return `${was} on ${dayWords(d.days[Math.max(0, last - d.span)])} (${pctOf(then)}), ${ZONE_LABEL[zoneOf(now)].toLowerCase()} now (${pctOf(now)})`;
}
/** The topics of one zone today, the widest first; with a lens, its topics first. */
export const inZone = (d: RisingData, z: Zone): RisingTopic[] => d.topics.filter((t) => t.zone === z).sort((a, b) => Number(b.inLens === true) - Number(a.inLens === true) || (b.b[b.b.length - 1] ?? 0) - (a.b[a.b.length - 1] ?? 0));
/** The climbs worth naming, steepest first; with a lens, only its topics unless it has none. */
export function climbs(d: RisingData): RisingTopic[] {
  const by = new Map(d.topics.map((t) => [t.slug, t] as const)), all = d.rising.map((k) => by.get(k)).filter((t): t is RisingTopic => !!t && t.rise >= MIN_CLIMB);
  const mine = d.lens ? all.filter((t) => t.inLens) : all;
  return mine.length ? mine : all;
}

const flat = (s: string, max = 160): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; };
const link = (text: string, url: string): string => `[${flat(text).replace(/[[\]]/g, '')}](${url})`;
const code = (s: string): string => '`' + s + '`';

/** The answer of `get_rising`: the climbs first, then every topic by zone, each with its reach in its own words. `data` is what the view draws. */
export function risingOut(d: RisingData | null, origin: string, area: Area = 'ai'): { text: string; data: Record<string, unknown>; error?: boolean } {
  const page = origin + '/rising' + (area === 'politics' ? '?area=politics' : '');
  if (!d) return { text: `There is nothing to place yet in ${AREA_LABEL[area]}: no published Signal has topics for the last days. ${code('get_overview')} shows what there is.`, data: { area, topics: [], rising: [] } };
  const up = climbs(d), lensNote = d.lens ? ` Lens: ${d.lens.name} (its topics first; nothing is hidden).` : '';
  const lead = [`**Rising from the deep** (${AREA_LABEL[d.area]}, ${dayWords(d.days[0])} to ${dayWords(d.days[d.days.length - 1])}).${lensNote}`,
    `Depth is breadth, not loudness: a topic is at the surface when every kind of source and most groups have it, and in the deep when it lives in one place. Watched: ${d.kindNames.join(', ')}; ${d.watched.groups} groups; ${d.watched.sources} sources.`,
    up.length ? `Steepest climb: ${link(up[0].label, up[0].url)}, ${climbWords(up[0], d)}.` : 'Nothing climbed much in the last days.'];
  const row = (t: RisingTopic, i: number) => `${i + 1}. ${link(t.label, t.url)} ${code(t.slug)}${t.state ? ` (${t.state})` : ''}: breadth ${pctOf(t.b[t.b.length - 1] ?? 0)}, ${t.reach ?? 'no source had it in the last days'}${d.lens && t.inLens === false ? ' [outside lens]' : ''}`;
  const secs = [up.length ? `## Rising from the deep\n${up.map((t, i) => `${i + 1}. ${link(t.label, t.url)} ${code(t.slug)}: ${climbWords(t, d)}. Now ${t.reach}.`).join('\n')}` : '',
    ...(['surface', 'mid', 'deep'] as Zone[]).map((z) => { const l = inZone(d, z); return l.length ? `## ${ZONE_LABEL[z]}\n${l.map(row).join('\n')}` : ''; })].filter(Boolean);
  const text = `${lead.join('\n')}\n\n${secs.join('\n\n')}\n\n_Breadth is ${BREADTH_IS} The picture: ${page}_\n\n**Next:** ${code('get_topic')} with a topic address for the summary and evidence; ${code('get_who_said_first')} for the order the sources had it in.`;
  return { text, data: d as unknown as Record<string, unknown> };
}
