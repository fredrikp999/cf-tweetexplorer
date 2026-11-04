// arXiv through its public API (https://info.arxiv.org/help/api/index.html): an Atom feed of papers, searched by field,
// and single papers by id. Everything in it was written by strangers, so it is capped and flattened to plain text.
import { decode } from './rss.ts';
import { readArticle } from './read.ts';
import type { FetchResult, SourceItem } from './types';

const HOST = 'export.arxiv.org';
const MAX_RESULTS = 100;
const GAP_MS = 3_000;   // the API terms ask for one request every three seconds
const UA = 'TweetExplorer/1.0 (arXiv reader; https://github.com/fredrikp999)';

export const isArxivApi = (url: string): boolean => { try { const u = new URL(url); return u.hostname === HOST && u.pathname === '/api/query'; } catch { return false; } };

// ---- queries --------------------------------------------------------------------------------
const FIELD = /\b(all|ti|au|abs|co|jr|cat|rn|id):/i;
const CATEGORY = /^[a-z-]+(\.[A-Za-z-]+)?$/;

/**
 * What people type after `arxiv:` → arXiv's `search_query`.
 * `cs.CL, cs.LG` → several categories; `au:"Hinton" AND cat:cs.LG` → used as written (fields au ti abs cat all co jr id, AND OR ANDNOT);
 * plain words → searched in every field.
 */
export function arxivSearchQuery(arg: string): string | null {
  const a = arg.trim();
  if (!a || a.length > 300) return null;
  const cats = a.split(/\s*,\s*/);
  if (cats.length > 1 && cats.every((c) => CATEGORY.test(c))) return cats.map((c) => `cat:${c}`).join(' OR ');
  if (CATEGORY.test(a) && a.includes('.')) return `cat:${a}`;
  if (FIELD.test(a)) return a;
  return `all:${a}`;
}

export function arxivApiUrl(searchQuery: string, maxResults = 50): string {
  return `https://${HOST}/api/query?search_query=${encodeURIComponent(searchQuery).replace(/%3A/gi, ':')}&sortBy=submittedDate&sortOrder=descending&max_results=${Math.min(MAX_RESULTS, maxResults)}`;
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 12);   // YYYYMMDDHHMM, GMT

/** The same query restricted to papers first submitted after `sinceSec`, so a poll asks only for what is new. */
export function withWindow(url: string, sinceSec: number): string {
  const u = new URL(url);
  const q = u.searchParams.get('search_query');
  if (!q || !(sinceSec > 0) || /submittedDate:/.test(q)) return u.href;
  u.searchParams.set('search_query', `(${q}) AND submittedDate:[${stamp(sinceSec * 1000)} TO ${stamp(Date.now() + 86_400_000)}]`);
  u.searchParams.set('max_results', String(MAX_RESULTS));
  return u.href;
}

// ---- politeness: one request at a time, three seconds apart --------------------------------------
let chain: Promise<unknown> = Promise.resolve(), last = 0;
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { last = Date.now(); }
  });
  chain = run.catch(() => undefined);
  return run;
}

// ---- parsing --------------------------------------------------------------------------------
const flat = (s: string) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const el = (b: string, n: string) => { const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(b); return m ? flat(m[1]) : ''; };

/** `http://arxiv.org/abs/2401.00001v2` → `2401.00001`; old style `hep-th/9901001v1` → `hep-th/9901001`. */
export const arxivId = (s: string): string | null => {
  const m = /(?:abs\/|^)((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v\d+)?\/?$/.exec(s.trim());
  return m ? m[1] : null;
};

export interface Paper { id: string; title: string; abstract: string; authors: string[]; categories: string[]; primary: string; published: string; updated: string; absUrl: string; pdfUrl: string }

export function parsePapers(xml: string): Paper[] {
  const out: Paper[] = [];
  for (const m of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)) {
    const b = m[1], id = arxivId(el(b, 'id'));
    if (!id) continue;   // the API answers an error as an entry whose id is not a paper
    const cats = [...b.matchAll(/<category\b[^>]*\bterm="([^"]+)"/gi)].map((c) => c[1]);
    const authors = [...b.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map((a) => flat(a[1]));
    out.push({
      id, title: el(b, 'title'), abstract: el(b, 'summary'), authors, categories: cats,
      primary: /<arxiv:primary_category\b[^>]*\bterm="([^"]+)"/i.exec(b)?.[1] ?? cats[0] ?? '',
      published: el(b, 'published'), updated: el(b, 'updated'),
      absUrl: `https://arxiv.org/abs/${id}`, pdfUrl: `https://arxiv.org/pdf/${id}`,
    });
  }
  return out;
}

const who = (a: string[]) => (a.length > 2 ? `${a[0]} et al.` : a.join(' & ')).slice(0, 80);

export function paperToItem(p: Paper): SourceItem {
  const t = Date.parse(p.published);
  return {
    source: 'arxiv', id: `arxiv:${p.id}`, url: p.absUrl, title: p.title,
    text: `${p.authors.slice(0, 6).join(', ')}${p.authors.length > 6 ? ' et al.' : ''} · ${p.categories.slice(0, 4).join(' ')}\n${p.abstract}`.slice(0, 900),
    by: who(p.authors) || 'arXiv', at: new Date(Number.isNaN(t) ? Date.now() : Math.min(t, Date.now())).toISOString(),
    pdfUrl: p.pdfUrl, categories: p.categories.slice(0, 6),
  };
}

// ---- fetching -------------------------------------------------------------------------------
async function get(url: string): Promise<string> {
  return paced(async () => {
    const res = await fetch(url, { headers: { accept: 'application/atom+xml, application/xml;q=0.9', 'user-agent': UA }, signal: AbortSignal.timeout(25_000), redirect: 'follow' });
    if (res.status === 429 || res.status === 503) { await res.body?.cancel(); throw new Error('arXiv is asking for fewer requests; try again in a few minutes'); }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`arXiv answered HTTP ${res.status}`); }
    const xml = await res.text();
    if (xml.length > 6_000_000) throw new Error('the arXiv answer is larger than 6 MB');
    return xml;
  });
}

/** An arXiv API address (see `isArxivApi`), read as papers. `since` (unix seconds) keeps it to what was submitted after that. */
export async function fetchArxiv(opts: { url: string; since?: number }): Promise<FetchResult & { title: string }> {
  const xml = await get(withWindow(opts.url, opts.since ?? 0));
  if (!/<feed[\s>]/i.test(xml.slice(0, 2000))) throw new Error('arXiv did not answer with a feed');
  const err = /<entry>(?:(?!<\/entry>)[\s\S])*?<id>[^<]*\/api\/errors[^<]*<\/id>(?:(?!<\/entry>)[\s\S])*?<summary>([\s\S]*?)<\/summary>/i.exec(xml);
  const papers = parsePapers(xml);
  if (err && !papers.length) throw new Error(`arXiv rejected the search: ${flat(err[1]).slice(0, 160)}`);
  const q = new URL(opts.url).searchParams.get('search_query') ?? '';
  return { items: papers.map(paperToItem), title: `arXiv: ${q.replace(/\bcat:/g, '').slice(0, 70)}` };
}

/** A watch's own words (`cs.CL, cs.LG`, `au:"Hinton"`, `diffusion models`) → what the API is asked, or an error the person can read. */
export async function fetchArxivQuery(opts: { query: string; since?: number }): Promise<FetchResult & { title: string }> {
  const q = arxivSearchQuery(opts.query);
  if (!q) throw new Error('enter categories (cs.CL, cs.LG), words, or a search such as au:"Hinton" AND cat:cs.LG');
  return fetchArxiv({ url: arxivApiUrl(q), since: opts.since });
}

/** The words of a search behind an arXiv API address, so a pasted address becomes an arXiv source. */
export const queryOfArxivUrl = (url: string): string => {
  const q = new URL(url).searchParams.get('search_query') ?? '';
  const cats = q.split(' OR ');
  return cats.length > 0 && cats.every((c) => /^cat:[a-z-]+(\.[A-Za-z-]+)?$/.test(c)) ? cats.map((c) => c.slice(4)).join(', ') : q.replace(/^all:/, '');
};

/** One paper for the summarizer: its abstract, and with `full` its full text when arXiv has an HTML version of it. */
export async function readArxivPaper(rawId: string, full = false, maxChars = 12_000): Promise<Paper & { fullText?: string; truncated?: boolean; note?: string }> {
  const id = arxivId(rawId.replace(/^arxiv:/i, ''));
  if (!id) throw new Error('not an arXiv id');
  const p = parsePapers(await get(`https://${HOST}/api/query?id_list=${encodeURIComponent(id)}&max_results=1`))[0];
  if (!p) throw new Error('arXiv has no paper with that id');
  if (!full) return p;
  try {
    const a = await readArticle(`https://arxiv.org/html/${id}`, maxChars);
    return { ...p, fullText: a.text, truncated: a.truncated };
  } catch {
    return { ...p, note: 'arXiv has no readable HTML version of this paper; only the abstract is available' };
  }
}
