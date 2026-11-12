// Trails (A4): where a reader came from, so a page can show the way back and the way on. Pure functions (no Worker APIs), so Node can test them.
// The address carries the origin: `?from=lens:security[@3]` (the lens's ranking, over 1, 3 or 7 days; `lens:all` is the ranking without a lens), `from=search:<words>` or
// `from=briefing:<slug>/<id>`. The topic page asks src/site/trailData.ts for the ordered list of that origin and shows "previous, n of N, next" with `from` kept on the links.
// What is not understood is left out, so a wrong address gives the plain page, never an error.
import { AREA_HOME, AREA_LABEL, topicHref, type Area } from './area.ts';
import type { TopicState } from './topicpage.ts';

export type From =
  | { kind: 'lens'; key: string; window: 1 | 3 | 7 }
  | { kind: 'search'; q: string }
  | { kind: 'briefing'; slug: string; id: string };

const LENS_KEY = /^[a-z0-9][a-z0-9_-]{0,40}$/, BRIEF_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/, BRIEF_ID = /^\d{4}-\d{2}-\d{2}(?:-\d+)?$/;
/** The longest `from` the site reads: a search is at most 80 letters. */
export const FROM_MAX = 100;
/** How many topics an origin gives (the landing page lists 15 of a lens; a search's topics are few). */
export const FROM_LIST = 40;

/** `from=` as the site writes it, or null for anything else. */
export function parseFrom(raw: string | null | undefined): From | null {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (!s || s.length > FROM_MAX) return null;
  const c = s.indexOf(':');
  if (c < 1) return null;
  const kind = s.slice(0, c), rest = s.slice(c + 1);
  if (kind === 'lens') {
    const m = /^([^@]+)(?:@([137]))?$/.exec(rest);
    return m && LENS_KEY.test(m[1]) ? { kind: 'lens', key: m[1], window: (m[2] ? Number(m[2]) : 1) as 1 | 3 | 7 } : null;
  }
  if (kind === 'search') {
    const q = rest.replace(/\s+/g, ' ').trim().slice(0, 80);
    return q.length >= 2 ? { kind: 'search', q } : null;
  }
  if (kind === 'briefing') {
    const m = /^([^/]+)\/([^/]+)$/.exec(rest);
    return m && BRIEF_SLUG.test(m[1]) && BRIEF_ID.test(m[2]) ? { kind: 'briefing', slug: m[1], id: m[2] } : null;
  }
  return null;
}
/** The value of `from=` for an origin (parseFrom reads it back). */
export function fromValue(f: From): string {
  return f.kind === 'lens' ? `lens:${f.key}${f.window === 1 ? '' : '@' + f.window}` : f.kind === 'search' ? `search:${f.q}` : `briefing:${f.slug}/${f.id}`;
}
/** The origin of a lens ranking on the landing page: the lens (or `all`) and the window it was read in. */
export const lensFrom = (key: string | undefined, window: number): From => ({ kind: 'lens', key: key || 'all', window: (window === 3 || window === 7 ? window : 1) as 1 | 3 | 7 });
/** `from=…` ready for an address (colons and slashes stay readable). */
export const fromQuery = (f: From): string => 'from=' + encodeURIComponent(fromValue(f)).replace(/%3A/gi, ':').replace(/%2F/gi, '/').replace(/%40/g, '@');
/** An address with `from` added (before any #); unchanged when there is no origin. The caller escapes it for HTML. */
export function withFrom(href: string, f: From | null | undefined): string {
  if (!f) return href;
  const hash = href.indexOf('#'), base = hash >= 0 ? href.slice(0, hash) : href, tail = hash >= 0 ? href.slice(hash) : '';
  return base + (base.includes('?') ? '&' : '?') + fromQuery(f) + tail;
}

// ---- previous and next
export interface Neighbours<T> { index: number; total: number; prev?: T; next?: T }
/** Where `slug` stands in the ordered list of an origin, with the topic before and after. Null when the list does not have it (then there is no previous or next, and no error). */
export function neighbours<T extends { slug: string }>(list: T[], slug: string): Neighbours<T> | null {
  const i = list.findIndex((x) => x.slug === slug);
  if (i < 0 || list.length < 2) return null;
  return { index: i + 1, total: list.length, ...(i > 0 ? { prev: list[i - 1] } : {}), ...(i < list.length - 1 ? { next: list[i + 1] } : {}) };
}
/** The same list without repeats, in order (a ranking can list a topic under its parent too). */
export function uniqueTopics<T extends { slug: string }>(list: T[], max = FROM_LIST): T[] {
  const seen = new Set<string>(), out: T[] = [];
  for (const x of list) if (!seen.has(x.slug)) { seen.add(x.slug); out.push(x); if (out.length >= max) break; }
  return out;
}

// ---- the trail line
export interface TrailPart { label: string; /** Absent on the page itself (the last part). */ href?: string; kind: 'area' | 'lens' | 'search' | 'briefing' | 'section' | 'topic' | 'angle' | 'item' }
export interface TrailIn {
  area: Area;
  /** Names of the lenses of the area, to put the lens of a `from=lens:` into words. */
  lenses?: Array<{ key: string; name: string }>;
  from?: From | null;
  /** The title of a briefing origin. */
  briefingTitle?: string;
  /** A page that is not a topic: its parts after the area (the research pulse). */
  section?: Array<{ label: string; href?: string }>;
  topic?: { slug: string; label: string };
  /** The angle of a topic page, when it is not the first (Talk). */
  angle?: { key: string; label: string } | null;
  /** The title of an item, on its source card. */
  item?: string;
}
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** The parts of a trail: `AI › Security › MCP auth bypass › Papers`. The last is the page itself and has no address; the lens part keeps the lens. */
export function trailParts(o: TrailIn): TrailPart[] {
  const { area, from } = o, parts: TrailPart[] = [{ label: AREA_LABEL[area], href: AREA_HOME[area], kind: 'area' }];
  if (from?.kind === 'lens' && from.key !== 'all') {
    const name = o.lenses?.find((l) => l.key === from.key)?.name;
    if (name) parts.push({ label: name, href: AREA_HOME[area] + '?lens=' + encodeURIComponent(from.key) + (from.window !== 1 ? '&window=' + from.window : ''), kind: 'lens' });
  } else if (from?.kind === 'search') {
    parts.push({ label: `Search “${cut(from.q, 30)}”`, href: `/search?q=${encodeURIComponent(from.q)}${area === 'politics' ? '&area=politics' : ''}`, kind: 'search' });
  } else if (from?.kind === 'briefing') {
    parts.push({ label: cut(o.briefingTitle || from.slug, 36), href: `/${from.slug}/${from.id}`, kind: 'briefing' });
  }
  for (const s of o.section ?? []) parts.push({ ...s, kind: 'section' });
  if (o.topic) {
    parts.push({ label: cut(o.topic.label, 44), href: withFrom(topicHref(o.topic.slug, area), from), kind: 'topic' });
    if (o.angle) parts.push({ label: o.angle.label, href: withFrom(topicHref(o.topic.slug, area, o.angle.key), from), kind: 'angle' });
  }
  if (o.item) parts.push({ label: cut(o.item, 50), kind: 'item' });
  const last = parts[parts.length - 1];
  delete last.href;   // the page itself is not a link
  return parts;
}

/** schema.org BreadcrumbList for the trail (JSON, escaped so it cannot close its own script tag). Addresses are absolute, from `origin`; the last part has none, as search engines allow. */
export function trailJsonLd(parts: TrailPart[], origin: string): string {
  const list = parts.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.label, ...(p.href ? { item: origin + p.href } : {}) }));
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: list }).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
}

// ---- the small card of a topic (neighbours strip, peek, and the text of get_topic)
/** What a card says of a topic: its state, 14 days of mentions and one line. */
export interface TopicBrief { slug: string; label: string; area: Area; state: TopicState | null; days: string[]; counts: number[]; line: string }
/** The first sentence of a written summary, cut to fit a card. */
export function oneLine(text: string, max = 150): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = /^.+?[.!?](?=\s|$)/.exec(t), s = m && m[0].length >= 30 ? m[0] : t;
  return cut(s, max);
}
/** The line for a topic without a written summary: from the numbers alone. */
export function numbersLine(label: string, state: TopicState | null, counts: number[]): string {
  const total = counts.reduce((a, b) => a + b, 0), how = state === 'new' ? 'is new' : state === 'rising' ? 'is rising' : state === 'falling' ? 'is fading' : 'is being talked about';
  return `${label} ${how}: ${total.toLocaleString('en-GB')} ${total === 1 ? 'mention' : 'mentions'} in the last ${counts.length} days.`;
}
