// Search across everything (INTENT.md sections 10 and 13): topics, items (posts, articles, videos, threads), papers and briefings.
// Pure rules shared by the Monitor and Publish objects (which find the candidates in their own databases), the page /search and the public MCP tool `search`.
// Words, not meaning: a match is a word (or the start of the last word, so a search can be typed) in a name, a title or a text. Nothing here reads a database or the network.
import type { TopicState } from '../signal/topicpage.ts';

export const SEARCH_KINDS = ['topics', 'items', 'papers', 'briefings'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const KIND_TITLE: Record<SearchKind, string> = { topics: 'Topics', items: 'Items', papers: 'Papers', briefings: 'Briefings' };
/** Days to look back for items, papers and briefings. Topics are always the ones Signal has now. */
export const SEARCH_WINDOWS = [1, 3, 7, 14, 30] as const;
export const DEFAULT_WINDOW = 14;
export const MAX_QUERY = 80, MIN_QUERY = 2;
/** With several kinds on the page each shows this many, and a link to the rest; with one kind the page shows PAGE_SIZE, a page at a time (at most MAX_PAGE pages). */
export const PREVIEW = 5, PAGE_SIZE = 20, MAX_PAGE = 5;

/** Collapses white space and control characters, and caps the length (the cache key and every database query use this form). */
export const cleanQuery = (raw: unknown): string => String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY).trim();
/** Which kinds were asked for ("topics,papers"); anything unknown is ignored and nothing valid means all of them. */
export function parseKinds(raw: unknown): SearchKind[] {
  const want = new Set(String(raw ?? '').toLowerCase().split(/[,\s]+/));
  const got = SEARCH_KINDS.filter((k) => want.has(k));
  return got.length ? got : [...SEARCH_KINDS];
}
export const windowOfSearch = (v: unknown): number => { const n = Number(v); return (SEARCH_WINDOWS as readonly number[]).includes(n) ? n : DEFAULT_WINDOW; };
export const pageOf = (v: unknown): number => Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(v)) || 1));

/** Words of a text, lower case: letters and digits stay together, and so do "+", "#" and "." inside ("c++", "gpt-5.1" is gpt, 5.1). */
export const tokens = (s: string): string[] => String(s ?? '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}+#.]+/u).map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean);
/** The words to look for: at most six, and a search needs at least one of two letters or more (a lone "a" would match everything). */
export function queryWords(q: string): string[] {
  const w = tokens(cleanQuery(q)).slice(0, 6);
  return w.some((x) => x.length >= MIN_QUERY) ? w : [];
}
export const tooShort = (q: string): boolean => queryWords(q).length === 0;
/** A SQL LIKE pattern for one word: the wildcard characters are dropped, never matched. */
export const likeOf = (w: string): string => '%' + w.replace(/[%_\\]/g, '') + '%';

const startsOrIs = (hay: string, w: string, last: boolean): boolean => hay === w || (last && hay.startsWith(w));
/** The words as a run, in order, inside `hay` (the last query word may be a start of a word). */
export function hasRun(hay: string[], needle: string[]): boolean {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => startsOrIs(hay[i + j], w, j === needle.length - 1))) return true;
  return false;
}
/** Every query word is a word of `hay`, in any order (the last may be a start of a word). */
export const hasAll = (hay: string[], words: string[]): boolean => words.length > 0 && words.every((w, j) => hay.some((h) => startsOrIs(h, w, j === words.length - 1)));
/** Every query word is somewhere in the text, even inside a word: for long texts, where "agent" should find "agents". */
export const textHasAll = (text: string, words: string[]): boolean => { const t = text.toLowerCase(); return words.length > 0 && words.every((w) => t.includes(w)); };

// ---- topics
export interface TopicCandidate { slug: string; term: string; label: string; members: string[]; signal: number; isNew: boolean; change: number | null; summary?: string; inLens?: boolean }
/** How well a topic fits: 5 its name is the search, 4 the search is a run of words in its name, 3 all words are in its name, 2 in a name counted under it, 1 in its summary, 0 not at all. */
export function topicQuality(words: string[], t: Pick<TopicCandidate, 'term' | 'label' | 'members' | 'summary'>): { quality: number; field: 'name' | 'member' | 'summary' } {
  const names = [t.label, t.term].filter(Boolean).map(tokens);
  if (names.some((n) => n.length === words.length && hasRun(n, words))) return { quality: 5, field: 'name' };
  if (names.some((n) => hasRun(n, words))) return { quality: 4, field: 'name' };
  if (names.some((n) => hasAll(n, words))) return { quality: 3, field: 'name' };
  const members = t.members.map(tokens);
  if (members.some((n) => hasRun(n, words) || hasAll(n, words))) return { quality: 2, field: 'member' };
  if (t.summary && textHasAll(t.summary, words)) return { quality: 1, field: 'summary' };
  return { quality: 0, field: 'name' };
}
/** Best fit first; a lens puts its topics ahead of others of the same fit (it never drops one); then the stronger Signal score. */
export function rankTopics<T extends { quality: number; inLens?: boolean; signal: number; label: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.quality - a.quality || Number(!!b.inLens) - Number(!!a.inLens) || b.signal - a.signal || a.label.localeCompare(b.label));
}
export interface SearchTopic { slug: string; label: string; term: string; members: string[]; state: TopicState | null; signal: number; quality: number; field: 'name' | 'member' | 'summary'; /** The name counted under it that matched, or a bit of the summary. */ because?: string; /** Lens keys (from the lens list) that hold it. */ lenses: string[]; inLens?: boolean }

// ---- items
export type ItemKind = 'x' | 'hn' | 'youtube' | 'rss';
export interface SearchItem { kind: ItemKind; title: string; url: string; discussionUrl: string; source: string; by: string; ts: number; likes: number; replies: number; views: number; quality: number; topic?: { slug: string; label: string } }
/** 2: the words are in the title; 1: only in the rest of the text (the body of a post, the summary of an article). */
export const itemQuality = (words: string[], title: string, text: string): number => (textHasAll(title, words) ? 2 : textHasAll(`${title} ${text}`, words) ? 1 : 0);
/** Title matches first, then the newest. Reactions are in different units for each kind of source, so they never order a mixed list. */
export const rankItems = <T extends { quality: number; ts: number }>(list: T[]): T[] => [...list].sort((a, b) => b.quality - a.quality || b.ts - a.ts);
/** The topic an item belongs to when it names one: the topic whose longest name appears in the item as whole words (names of under three letters are too loose to use). */
export function topicFor(text: string, topics: Array<{ slug: string; label: string; names: string[] }>): { slug: string; label: string } | undefined {
  const hay = tokens(text);
  let best: { slug: string; label: string } | undefined, len = 0;
  for (const t of topics) for (const n of t.names) {
    const w = tokens(n);
    if (n.length < 3 || w.length === 0) continue;
    const size = w.join(' ').length;
    if (size > len && hasRunExact(hay, w)) { best = { slug: t.slug, label: t.label }; len = size; }
  }
  return best;
}
function hasRunExact(hay: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return true;
  return false;
}

// ---- papers
export interface SearchPaper { id: string; title: string; published: number; authors: string[]; categories: string[]; absUrl: string; snippet: string; quality: number; score: number; inLens?: boolean; attention: { accounts: number; hf: { upvotes: number; url: string } | null; hn: { points: number; comments: number; url: string } | null } }
/** 3: the words are a run in the title; 2: all in the title; 1: in the abstract. */
export function paperQuality(words: string[], title: string, abstract: string): number {
  const t = tokens(title);
  return hasRun(t, words) ? 3 : hasAll(t, words) ? 2 : textHasAll(`${title} ${abstract}`, words) ? 1 : 0;
}
/** Best fit, then lens papers, then the ones people are paying attention to, then the newest. */
export const rankPapers = <T extends { quality: number; inLens?: boolean; score: number; published: number }>(list: T[]): T[] =>
  [...list].sort((a, b) => b.quality - a.quality || Number(!!b.inLens) - Number(!!a.inLens) || b.score - a.score || b.published - a.published);

// ---- briefings
export interface SearchBriefing { slug: string; title: string; id: string; publishedAt: number; headline: string; theme?: string; anchor?: string; quality: number }
export const rankBriefings = <T extends { quality: number; publishedAt: number }>(list: T[]): T[] => [...list].sort((a, b) => b.quality - a.quality || b.publishedAt - a.publishedAt);

/** A short piece of `text` around the first query word, whole words at the ends. */
export function snippetAround(text: string, words: string[], max = 200): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const low = flat.toLowerCase(), at = Math.max(0, ...words.map((w) => low.indexOf(w)).filter((i) => i >= 0).slice(0, 1));
  let from = Math.max(0, at - Math.floor(max / 3));
  if (from > 0) { const sp = flat.indexOf(' ', from); if (sp > 0 && sp < at) from = sp + 1; }
  let end = Math.min(flat.length, from + max);
  if (end < flat.length) { const sp = flat.lastIndexOf(' ', end); if (sp > from + max / 2) end = sp; }
  return (from > 0 ? '…' : '') + flat.slice(from, end).trim() + (end < flat.length ? '…' : '');
}

// ---- the answer, the page and the tool
export interface Part<T> { total: number; list: T[] }
export interface SearchAnswer { q: string; window: number; kinds: SearchKind[]; page: number; per: number; topics: Part<SearchTopic>; items: Part<SearchItem>; papers: Part<SearchPaper>; briefings: Part<SearchBriefing> }
export const emptyPart = <T>(): Part<T> => ({ total: 0, list: [] });
export const emptyAnswer = (q: string, window: number, kinds: SearchKind[], page = 1, per = PREVIEW): SearchAnswer =>
  ({ q, window, kinds, page, per, topics: emptyPart(), items: emptyPart(), papers: emptyPart(), briefings: emptyPart() });

/** How many to show of each kind, and from where: a short preview of each when several kinds are on the page, a page of one kind when there is just one. */
export function sliceFor(kinds: SearchKind[], page: number): { per: number; offset: number } {
  return kinds.length > 1 ? { per: PREVIEW, offset: 0 } : { per: PAGE_SIZE, offset: (Math.max(1, page) - 1) * PAGE_SIZE };
}
/** The address of a search (HTML-escaped ampersands when `html`). Defaults are left out so addresses stay short and the cache holds fewer copies. */
export function searchHref(p: { q: string; kinds?: SearchKind[]; lens?: string; window?: number; page?: number; area?: 'ai' | 'politics' }, html = true): string {
  const kinds = p.kinds && p.kinds.length && p.kinds.length < SEARCH_KINDS.length ? p.kinds.join(',') : '';
  const parts = [['q', p.q], ['kinds', kinds], ['lens', p.lens ?? ''], ['area', p.area === 'politics' ? 'politics' : ''], ['window', p.window && p.window !== DEFAULT_WINDOW ? String(p.window) : ''], ['page', p.page && p.page > 1 ? String(p.page) : '']]
    .filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return '/search' + (parts.length ? '?' + parts.join(html ? '&amp;' : '&') : '');
}
