// The topic page /t/<slug>: the address of a topic, its state, and the evidence strip (what each kind of source has to say, each in its own unit).
// Pure functions (no Worker APIs), so Node can test them. The Monitor Durable Object gathers the data (`/mon/topic-public`), src/site/topicData.ts adds the briefings,
// and src/site/public.ts draws the page. The same data is public JSON at /t/<slug>.json, and later steps (the MCP `get_topic` tool, the topic hub view) read it too.

import type { TimelineDot, TopicFirst, TopicWatch } from './topicview.ts';
import type { Brush } from './brush.ts';
import type { PrismOut } from './prism.ts';

// ---- the address
/** FNV-1a, 32 bits, in base 36: a few letters that tell two odd names apart. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(5, '0').slice(-5);
}
/** What a slug looks like (the route checks this before asking anyone). */
export const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The address of a Signal topic: `/t/<slug>`, from its `term` (the lead name of the topic, as Signal lists it).
 * A plain name of letters, digits and spaces ("mcp auth bypass", "gpt-5") keeps its words: `mcp-auth-bypass`, readable and guessable.
 * Anything else ("c++", "#rust", "kimi k2's", non-Latin letters) gets what ASCII can say of it plus five letters from a hash of the whole name,
 * so "c++" and "c" are different addresses. The same term always gives the same slug; two terms can only share one if they differ by a space and a hyphen
 * ("gpt 5" and "gpt-5"), and then the stronger topic holds it (the Monitor resolves that).
 */
export function topicSlug(term: string): string {
  const t = String(term ?? '').toLowerCase().normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (/^[a-z0-9]+(?:[ -][a-z0-9]+)*$/.test(t) && t.length <= 60) return t.replace(/ /g, '-');
  const base = t.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return `${base || 't'}-${shortHash(t)}`;
}

// ---- state
export type TopicState = 'new' | 'rising' | 'steady' | 'falling';
const RISING = 1.5, FALLING = 0.67;   // the same bar as Signal's "rising"; a drop to two thirds is a clear fall
/** Where the topic is going, from the change against the period before. Null when there was no earlier period to compare with: better no word than a guess. */
export function topicState(t: { isNew: boolean; change: number | null }): TopicState | null {
  if (t.isNew) return 'new';
  if (t.change === null || !Number.isFinite(t.change)) return null;
  return t.change >= RISING ? 'rising' : t.change <= FALLING ? 'falling' : 'steady';
}
export const STATE_LABEL: Record<TopicState, string> = { new: 'New', rising: 'Rising', steady: 'Steady', falling: 'Falling' };
/** A mark that says the same thing as the word, for a glance. */
export const STATE_MARK: Record<TopicState, string> = { new: '●', rising: '▲', steady: '–', falling: '▼' };

/** The usual level of a daily series: the median of the days before the last three (the recent days are what is being judged). Zero when there is too little to say. */
export function usualLevel(series: number[]): number {
  const base = series.length > 6 ? series.slice(0, -3) : series.slice(0, Math.max(0, series.length - 1));
  if (base.length < 3) return 0;
  const a = [...base].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---- the evidence strip
export type EvKind = 'x' | 'hn' | 'youtube' | 'rss' | 'arxiv';
export const EV_LABEL: Record<EvKind, string> = { x: 'X', hn: 'Hacker News', youtube: 'YouTube', rss: 'Blogs and news', arxiv: 'Research papers' };
const EV_ORDER: EvKind[] = ['x', 'hn', 'youtube', 'rss', 'arxiv'];

/** One item of a topic, as the kinds of evidence need it. A number of -1 was not recorded for that item (items logged before the numbers were kept). */
/** `id`: the public id of the item's card (src/signal/sourcecard.ts), only for an item with a web address. */
export interface EvItem { id?: string; kind: EvKind; by: string; source: string; title: string; url: string; discussionUrl: string; ts: number; likes: number; replies: number; views: number }
/** One segment of the strip: a kind of source, with what it can honestly say. `lines` are plain text (the page escapes them); `names` only when the Signal shows its sources. */
export interface EvSegment { kind: EvKind; label: string; count: number; lines: string[]; names?: string[] }

/** A count as people say it: exact under ten, then rounded ("about 350", "about 2.5k", "about 12k"). Reactions on X can be inflated, so a range says no more than we know. */
export function roughly(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 10) return String(v);
  const step = v < 100 ? 5 : v < 1000 ? 50 : v < 10_000 ? 500 : v < 1_000_000 ? 1000 : 100_000;
  const r = Math.round(v / step) * step;
  const short = r >= 1_000_000 ? `${+(r / 1_000_000).toFixed(1)}M` : r >= 1000 ? `${+(r / 1000).toFixed(1)}k` : String(r);
  return `about ${short}`;
}
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
/** The sum of a number over the items that have it, and how many do. */
function sumKnown(items: EvItem[], key: 'likes' | 'replies' | 'views'): { sum: number; known: number } {
  let sum = 0, known = 0;
  for (const i of items) if (i[key] >= 0) { sum += i[key]; known++; }
  return { sum, known };
}
const coverage = (known: number, total: number) => (known && known < total ? ` (counted on ${known} of ${total})` : '');

/**
 * One segment per kind of source that has something, each in its own unit and never added to another's (section 7 of INTENT.md):
 * X as reactions in a range and how many different accounts posted (breadth counts more than one viral post), Hacker News as points and comments,
 * YouTube as views from channels chosen for this site, blogs and news as which outlets covered it, papers as uptake. `papers.mentioned` is how many of
 * the matched papers are named in posts. Names of outlets, channels and accounts are given only when `proof` (the Signal shows its sources).
 */
export function evidenceSegments(items: EvItem[], papers: { matched: number; mentioned: number }, proof: boolean): EvSegment[] {
  const out: EvSegment[] = [];
  for (const kind of EV_ORDER) {
    if (kind === 'arxiv') {
      if (!papers.matched) continue;
      out.push({ kind, label: EV_LABEL.arxiv, count: papers.matched, lines: [`${plural(papers.matched, 'paper')} on the subject in the last 30 days`,
        papers.mentioned ? `${papers.mentioned} named in posts or on Hacker News` : 'not discussed in posts yet'] });
      continue;
    }
    const of = items.filter((i) => i.kind === kind);
    if (!of.length) continue;
    const accounts = new Set(of.map((i) => i.by.toLowerCase()).filter(Boolean)), outlets = [...new Set(of.map((i) => i.source).filter(Boolean))];
    const lines: string[] = [];
    let names: string[] | undefined;
    if (kind === 'x') {
      lines.push(`${plural(of.length, 'post')}${accounts.size ? ` from ${plural(accounts.size, 'account')}` : ''}`);
      const likes = sumKnown(of, 'likes');
      if (likes.known) lines.push(`${roughly(likes.sum)} ${likes.sum === 1 ? 'like' : 'likes'}${coverage(likes.known, of.length)}`);
    } else if (kind === 'hn') {
      lines.push(plural(of.length, 'thread'));
      const pts = sumKnown(of, 'likes'), cmt = sumKnown(of, 'replies');
      if (pts.known) lines.push(`${pts.sum.toLocaleString('en-GB')} ${pts.sum === 1 ? 'point' : 'points'}, ${cmt.sum.toLocaleString('en-GB')} ${cmt.sum === 1 ? 'comment' : 'comments'}${coverage(pts.known, of.length)}`);
    } else if (kind === 'youtube') {
      lines.push(`${plural(of.length, 'video')} from chosen channels`);
      const views = sumKnown(of, 'views');
      if (views.known && views.sum > 0) lines.push(`${roughly(views.sum)} views${coverage(views.known, of.length)}`);
      if (proof) names = outlets.slice(0, 6);
    } else {
      lines.push(`${plural(of.length, 'article')}${outlets.length ? ` from ${plural(outlets.length, 'outlet')}` : ''}`);
      if (proof) names = outlets.slice(0, 8);
    }
    out.push({ kind, label: EV_LABEL[kind], count: of.length, lines, ...(names?.length ? { names } : {}) });
  }
  return out;
}

/** A line built from the numbers alone, for a topic without a written summary yet (the page must work before the first summary exists). */
export function fallbackSummary(t: { label: string; state: TopicState | null; total: number; days: number; segments: EvSegment[]; groups: number }): string {
  const how = t.state === 'new' ? 'is new' : t.state === 'rising' ? 'is rising' : t.state === 'falling' ? 'is fading' : 'is being talked about';
  const by = t.segments.filter((s) => s.kind !== 'arxiv').sort((a, b) => b.count - a.count);
  const where = by.length ? `, most on ${by[0].label}${by.length > 1 ? ` and ${by[1].label}` : ''}` : '';
  return `${t.label} ${how}: ${plural(t.total, 'item')} in the last ${t.days} days${t.groups > 1 ? ` across ${t.groups} groups of sources` : ''}${where}.`;
}

// ---- the data (one shape for the page, the JSON and later the MCP tool)
export interface TopicPaper { id: string; published: number; title: string; authors: string[]; categories: string[]; abstract: string; absUrl: string; pdfUrl: string; also: Array<{ slug: string; title: string }>;
  attention: { top: boolean; hf?: { upvotes: number; url: string }; hn?: { points: number; comments: number; url: string }; mentions: Array<{ by: string; url: string; reactions: number }>; accounts: number } }
/** An item in the Talk angle. Present only when the Signal shows its sources. */
export interface TopicTalkItem { id?: string; kind: EvKind; title: string; url: string; discussionUrl: string; source: string; by: string; ts: number; likes?: number; replies?: number; views?: number }
export interface TopicSummary { text: string; /** The day it was written (UTC). */ day: string; model: string; /** How many items it was read from, and, when the Signal shows sources, which. */ itemCount: number; items: Array<{ title: string; url: string; by: string; kind: EvKind }> }
export interface TopicBriefing { slug: string; title: string; id: string; publishedAt: number; tldr: string; theme?: string; anchor?: string }
export interface TopicData {
  slug: string; term: string; label: string; /** The other names counted under this topic. */ members: string[];
  /** The Signal this page takes its numbers from, and the other published Signals that also have it. */
  board: { slug: string; title: string; proof: boolean }; /** The area of that Signal: a politics topic leads back to /politics. */ area: 'ai' | 'politics'; alsoIn: Array<{ slug: string; title: string; area?: 'ai' | 'politics' }>;
  days: number; from: string; to: string; baselineOk: boolean;
  state: TopicState | null; signal: number; change: number | null; isNew: boolean; kind: 'shared' | 'single' | 'mixed'; breadth: number; active: number; reactions: number;
  /** Items per day over the last 14 days, oldest first, and the usual level. */
  series: { days: string[]; counts: number[]; usual: number };
  /** Items in the window per kind of source, and the evidence strip. */
  counts: Partial<Record<EvKind, number>>; total: number; evidence: EvSegment[];
  summary: TopicSummary | null; fallback: string;
  talk: TopicTalkItem[];
  /** How `talk` was narrowed and ordered (A5: `?day=`, `?kind=`, `?sort=`), and how many items match per kind before the cut. Always the plain list in /t/<slug>.json. */
  view?: Brush & { counts: Partial<Record<EvKind, number>> };
  papers: { matched: number; mentioned: number; list: TopicPaper[] };
  /** Step 7 angles (src/signal/topicview.ts): the order the kinds of source had it in, items over time, and videos. Titles and links only when the Signal shows its sources (videos from feed pages are public anyway). */
  first: TopicFirst; timeline: TimelineDot[]; watch: TopicWatch[];
  /** Related topics, each with its state, 14 days of mentions and one line when the Monitor could give them (A4, the neighbours strip). */
  related: Array<{ slug: string; label: string; state?: TopicState | null; days?: string[]; counts?: number[]; line?: string }>;
  /** Mentions per day for the heat calendar: the 30 days the counts are kept, from the terms table (names as Signal counts them, so they can differ a little from the items above). */
  heat?: { days: string[]; counts: number[] };
  /** Prism (src/signal/prism.ts): the conversations inside the topic, counted over the items Talk lists; null or absent when it has none. */
  prism?: PrismOut | null;
  /** Added by src/site/topicData.ts (they live in the Publish object). */
  briefings?: TopicBriefing[];
  /**
   * Set when the topic is a story (docs/grouping-proposal.md): a group of items found by meaning, with an id that stays when it is renamed. `term` is then its address and
   * `members` the names its items were tagged with most. `isNew`: born unlike every story of the 30 days before it. `theme`: the theme it is in (null: none).
   * Section 5 marks: `newIn`, a new story inside its theme (this week); `uncharted`, in no theme while the area has themes.
   */
  story?: { id: string; first: number; last: number; n: number; state: 'live' | 'dormant' | 'closed'; isNew: boolean; theme: { id: string; slug: string; name: string; lens: string | null } | null; newIn: boolean; uncharted: boolean };
}
