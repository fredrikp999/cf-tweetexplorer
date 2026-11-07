// The landing page at / (INTENT.md sections 5 and 6): what its blocks are made of. Pure functions (no Worker APIs), so Node can test them;
// src/site/public.ts reads the data (Signal, briefings, the Monitor's `landing-public`) and draws the HTML.
import { anchorOf } from './brief.ts';
import { lensMatch, applyLens, lensesOfTopic, LENS_PALETTE, type Lens } from '../signal/lens.ts';
import { partsAfterParents } from '../signal/topics.ts';
import { topicHref, type Area } from '../signal/area.ts';
import { topicSlug, topicState, type TopicState } from '../signal/topicpage.ts';
import type { Layout } from '../signal/landscape.ts';

/** The time windows of the page (`?window=`), in days. */
export const WINDOWS = [1, 3, 7] as const;
export type LandingWindow = (typeof WINDOWS)[number];
export const WINDOW_LABEL: Record<LandingWindow, string> = { 1: 'Today', 3: '3 days', 7: '7 days' };
export const windowOf = (v: string | null | undefined): LandingWindow => (WINDOWS.find((w) => String(w) === v) ?? 1);

/** A Signal topic, as the public Signal answer gives it (the part this module needs). */
export interface SigTopic { term: string; label: string; members: string[]; signal: number; change: number | null; isNew: boolean; kind: string; breadth: number; active: number; parts: number[]; parent?: string; related?: string[] }

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, case-insensitive: "mcp" is in "an MCP flaw", not in "mcpx". */
export const hasName = (text: string, name: string): boolean => name.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(name.toLowerCase())}($|[^\\p{L}\\p{N}])`, 'u').test(text.toLowerCase());

/** Markdown of a briefing's headline or TL;DR as plain text. */
export function plainLine(md: string): string {
  return String(md ?? '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>~]+/g, '').replace(/\s+/g, ' ').trim();
}
/** The first sentence of a text, kept to about `max` characters (cut at a word, with an ellipsis). */
export function firstLine(text: string, max = 140): string {
  const t = plainLine(text), m = /^(.+?[.!?])(\s|$)/.exec(t), s = m ? m[1] : t;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[ ,;:.-]+$/, '') + '…';
}

// ---- In brief
export interface BriefIn { slug: string; title: string; publishedAt: number; tldr: string; themes?: string[]; /** Its place in the order the owner set. */ position?: number }
export interface BriefLine { text: string; href: string; /** True when the line opens a topic page; false when no Signal topic matched and it opens the briefing. */ topic: boolean; label?: string; briefing: { slug: string; title: string } }

/** The Signal topic a piece of text is about: the strongest topic any of whose names it contains (not a part of a bigger topic when the bigger one is also named). */
export function topicFor(text: string, topics: SigTopic[]): SigTopic | undefined {
  const hits = topics.filter((t) => [t.label, t.term, ...t.members].some((n) => hasName(text, n)));
  return hits.sort((a, b) => b.signal - a.signal)[0];
}

/**
 * About `max` lines for the day, made from what the published briefings already say: each briefing's theme headings (its TL;DR when it lists none), matched to Signal topics by name.
 * A line links to the topic page. A line whose words match no topic links to its briefing instead (the page says nothing different: it is the only place that text lives), and comes after the lines that have a topic.
 * Newest briefings first (fresh ones, within 36 hours, when there are any); the first theme of each briefing before the second theme of any; one line per topic.
 */
export function inBrief(briefs: BriefIn[], topics: SigTopic[], max = 5, now = Date.now(), area: Area = 'ai'): BriefLine[] {
  const order = [...briefs].sort((a, b) => (a.position ?? 1e6) - (b.position ?? 1e6) || b.publishedAt - a.publishedAt);
  const fresh = order.filter((b) => now - b.publishedAt < 36 * 3600_000), use = fresh.length ? fresh : order.slice(0, 3);
  type Cand = BriefLine & { layer: number; key: string };
  const cands: Cand[] = [];
  use.forEach((b, bi) => {
    const heads = (b.themes ?? []).map(plainLine).filter(Boolean).slice(0, 4);
    const items = heads.length ? heads.map((h) => ({ text: h, anchor: anchorOf(h) })) : b.tldr ? [{ text: firstLine(b.tldr, 110), anchor: '' }] : [];
    items.forEach((it, layer) => {
      const t = topicFor(it.text, topics);
      cands.push({ text: it.text.length > 120 ? firstLine(it.text, 110) : it.text, topic: !!t, ...(t ? { label: t.label } : {}), briefing: { slug: b.slug, title: b.title },
        href: t ? topicHref(topicSlug(t.term), area) : `/${b.slug}${it.anchor ? '#' + it.anchor : ''}`, layer, key: t ? 't:' + t.term : `b:${b.slug}:${bi}:${layer}` });
    });
  });
  cands.sort((a, b) => a.layer - b.layer); // stable: briefing order is kept inside a layer
  const out: Cand[] = [], seen = new Set<string>();
  for (const pass of [true, false]) for (const c of cands) {
    if (out.length >= max) break;
    if (c.topic !== pass || seen.has(c.key)) continue;
    seen.add(c.key); out.push(c);
  }
  return out.map(({ layer: _l, key: _k, ...line }) => line);
}

// ---- the rising strip
export interface RiseItem { term: string; label: string; state: Extract<TopicState, 'new' | 'rising' | 'falling'>; change: number | null }
/** New, rising and falling topics, in that order (a part of a bigger topic is left to its parent), at most `max`, falling at most `maxFalling`. */
export function risingStrip(topics: SigTopic[], baselineOk: boolean, max = 8, maxFalling = 2): RiseItem[] {
  const own = topics.filter((t) => !t.parent);
  const st = (t: SigTopic) => topicState({ isNew: t.isNew, change: baselineOk || t.isNew ? t.change : null });
  const pick = (s: TopicState) => own.filter((t) => st(t) === s).sort((a, b) => (s === 'rising' ? (b.change ?? 0) - (a.change ?? 0) : b.signal - a.signal));
  const mk = (s: RiseItem['state']) => (t: SigTopic): RiseItem => ({ term: t.term, label: t.label, state: s, change: t.change });
  const falling = pick('falling').slice(0, maxFalling).map(mk('falling'));
  return [...pick('new').map(mk('new')), ...pick('rising').map(mk('rising'))].slice(0, Math.max(0, max - falling.length)).concat(falling);
}

// ---- the landscape (a ranked list for now; the graphic of step 5 replaces it)
export interface RankRow { topic: SigTopic; inLens: boolean; /** Drawn under the topic it is part of. */ part: boolean }
/** Topics ranked by Signal score, parts under their topic; with a lens its topics first (the rest stay, marked `inLens: false`). */
export function rankList(topics: SigTopic[], lens: Lens | undefined, max = 15): { rows: RankRow[]; outside: SigTopic[]; inCount: number } {
  const ranked = partsAfterParents([...topics].sort((a, b) => b.signal - a.signal));
  const ap = applyLens(ranked, lens), rows: RankRow[] = [];
  for (const x of ap.ordered.slice(0, max)) {
    const prev = rows[rows.length - 1];
    rows.push({ topic: x.topic, inLens: x.inLens, part: !!x.topic.parent && !!prev && (prev.topic.term === x.topic.parent || (prev.part && prev.topic.parent === x.topic.parent)) });
  }
  return { rows, outside: ap.outside, inCount: ap.inCount };
}

/** "Hacker News 40%, X 35%": which kinds of source the score comes from. `parts` are the shares of the score per group. */
export function mixText(parts: number[], groups: string[]): string {
  const sum = parts.reduce((a, b) => a + b, 0);
  if (!sum || groups.length < 2) return '';
  return parts.map((p, i) => ({ name: groups[i] ?? '', p: p / sum })).filter((x) => x.name && x.p >= 0.05).sort((a, b) => b.p - a.p).map((x) => `${x.name} ${Math.round(x.p * 100)}%`).join(', ');
}

/** The text on a card: the written summary's first sentence, else a line made from the numbers. */
export function cardLine(t: SigTopic, summary: string | undefined, groups: string[]): string {
  if (summary) return firstLine(summary, 150);
  const how = t.isNew ? 'is new' : t.change !== null && t.change >= 1.5 ? 'is rising' : 'is being talked about';
  const top = groups.length > 1 ? t.parts.map((p, i) => ({ p, n: groups[i] })).sort((a, b) => b.p - a.p)[0] : undefined;
  return `${t.label} ${how}${top && top.n ? `, most in ${top.n}` : ''}.`;
}

// ---- since your last visit
export interface SinceCounts { newTopics: number; rising: number; papers: number }
/** Counts for the window: new topics, rising topics and new papers, within the lens when one is chosen. */
export function sinceCounts(topics: SigTopic[], lens: Lens | undefined, papers: number): SinceCounts {
  const mine = lens ? applyLens(topics, lens).ordered.filter((x) => x.inLens).map((x) => x.topic) : topics;
  const own = mine.filter((t) => !t.parent);
  return { newTopics: own.filter((t) => t.isNew).length, rising: own.filter((t) => !t.isNew && t.change !== null && t.change >= 1.5).length, papers };
}

// ---- research strip
export interface RecentPaper { id: string; title: string; published: number; score: number; talked: boolean }
export interface ResearchStrip { newPapers: number; discussed: number; top: RecentPaper[] }
/** Papers in the window (inside the lens when one is chosen), how many of the week's are being discussed, and the three most discussed of the week. */
export function researchStrip(papers: RecentPaper[], lens: Lens | undefined, days: number, now = Date.now()): ResearchStrip {
  const mine = lens ? papers.filter((p) => lensMatch(lens, { term: p.title })) : papers;
  const talked = mine.filter((p) => p.talked);
  return { newPapers: mine.filter((p) => p.published >= now - days * 86_400_000).length, discussed: talked.length,
    top: [...talked].sort((a, b) => b.score - a.score || b.published - a.published).slice(0, 3) };
}

// ---- watch and read
export interface ReadItem { title: string; url: string; by: string; source: string; kind: string; ts: number; reactions: number }
/** Most reacted articles (blogs and news; newest when none has reactions) and Hacker News highlights. */
export function pickReads(items: ReadItem[], n = 3): { articles: ReadItem[]; reacted: boolean; hn: ReadItem[] } {
  const by = (a: ReadItem, b: ReadItem) => b.reactions - a.reactions || b.ts - a.ts;
  const rss = items.filter((i) => i.kind === 'rss' && i.title), hn = items.filter((i) => i.kind === 'hn' && i.title).sort(by).slice(0, n);
  const reacted = rss.some((i) => i.reactions > 0);
  return { articles: [...rss].sort(reacted ? by : (a, b) => b.ts - a.ts).slice(0, n), reacted, hn };
}

// ---- the small script (served at /viz/visit.js, never inline). The server always writes the counts for the window ("Today:"); a remembered last visit can only
// rename that label when the window is exactly the time since then, and otherwise points to the window that covers it. Everything is in try/catch.
export const VISIT_JS = `(function(){var el=document.getElementById('since');if(!el)return;try{var D=864e5,now=Date.now(),prev=null;
try{prev=sessionStorage.getItem('visitPrev')}catch(e){}
if(prev===null){prev=localStorage.getItem('visit')||'';try{sessionStorage.setItem('visitPrev',prev)}catch(e){}localStorage.setItem('visit',String(now))}
var t=Number(prev);if(!t||t>now||now-t<432e5)return;
var days=Math.max(1,Math.ceil((now-t)/D)),w=days<=1?1:days<=3?3:7,win=Number(el.getAttribute('data-win'))||1,
label=days<=1?'yesterday':days<=7?new Date(t).toLocaleDateString(undefined,{weekday:'long'}):new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'long'});
if(days===win){var l=el.querySelector('.sincelbl');if(l)l.textContent='Since '+label+':'}
else if(w!==win){var a=document.querySelector('a[data-win="'+w+'"]');if(a){var s=document.createElement('span');s.className='sincehint';s.appendChild(document.createTextNode(' You were last here '+label+'. '));var k=document.createElement('a');k.setAttribute('href',a.getAttribute('href'));k.textContent='See the last '+(w===1?'day':w+' days')+'.';s.appendChild(k);el.appendChild(s)}}
}catch(e){}})();`;

// ---- the landscape graphic (the view in src/apps/landscape.ts draws exactly this)
export interface LandscapeBubble { slug: string; label: string; url: string; x: number; y: number; r: number; cluster: string; state: TopicState | null; change: number | null; score: number;
  /** A lens colour name, or null (grey): with a lens chosen only its topics have a colour. */ lensColor: string | null; inLens: boolean | null; mix: string | null }
export interface LandscapeData { w: number; h: number; clusters: Array<{ id: string; name: string; x: number; y: number; r: number; members: string[] }>; bubbles: LandscapeBubble[];
  lens: { key: string; name: string } | null; lenses: Array<{ key: string; name: string; color: string; light: string; dark: string }> }

/**
 * The bubbles for the day: the layout (x, y, size, cluster) joined with what the overview knows of each topic (state, lens colour, where the score comes from). A topic the layout does not have yet
 * is left out (the ranked list still has it); a cluster whose members are all gone is dropped. With a lens chosen its topics take its colour and the rest stay grey; with none, a topic takes the colour of its first lens.
 */
export function landscapeOf(layout: Layout | null | undefined, topics: SigTopic[], o: { lens?: Lens; lenses: Lens[]; groups: string[]; baselineOk: boolean; origin: string; stateOf: (t: SigTopic) => TopicState | null; /** The area the topics are from: a politics topic's link says so. */ area?: Area }): LandscapeData | null {
  if (!layout?.bubbles.length) return null;
  const bySlug = new Map<string, SigTopic>();
  for (const t of topics) { const k = topicSlug(t.term); if (!bySlug.has(k)) bySlug.set(k, t); }
  const bubbles: LandscapeBubble[] = [];
  for (const b of layout.bubbles) {
    const t = bySlug.get(b.key);
    if (!t) continue;
    const mine = lensesOfTopic(o.lenses, t), inLens = o.lens ? mine.some((l) => l.key === o.lens!.key) : null;
    bubbles.push({ slug: b.key, label: t.label, url: o.origin + topicHref(b.key, o.area ?? 'ai'), x: b.x, y: b.y, r: b.r, cluster: b.cluster, state: o.stateOf(t), change: t.change, score: Math.round(t.signal * 10_000) / 10_000,
      lensColor: o.lens ? (inLens ? o.lens.color : null) : mine[0]?.color ?? null, inLens, mix: mixText(t.parts, o.groups) || null });
  }
  const have = new Set(bubbles.map((b) => b.slug)), withMembers = (c: Layout['clusters'][number]) => c.members.filter((k) => have.has(k));
  const clusters = layout.clusters.filter((c) => withMembers(c).length > 1).map((c) => ({ id: c.id, name: c.name, x: c.x, y: c.y, r: c.r, members: withMembers(c) }));
  const kept = new Set(clusters.map((c) => c.id));
  for (const b of bubbles) if (b.cluster && !kept.has(b.cluster)) b.cluster = '';
  return { w: layout.w, h: layout.h, clusters, bubbles, lens: o.lens ? { key: o.lens.key, name: o.lens.name } : null,
    lenses: o.lenses.map((l) => ({ key: l.key, name: l.name, color: l.color, light: LENS_PALETTE[l.color].light, dark: LENS_PALETTE[l.color].dark })) };
}
