// Read-only helpers behind the summarizer's read_article and get_hn_comments tools. Everything they return was written by
// strangers, so it is capped, flattened to plain text, and handed to the model as data.
import { decode } from './rss.ts';
import { stripHtml } from './hn.ts';

const MAX_BYTES = 2_000_000;
const MAX_HOPS = 3;

/** Refuses what the tool must never fetch: other schemes, credentials, odd ports, and local or private hosts. */
export function checkReadableUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('not a valid address'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('only http and https addresses can be read');
  if (u.username || u.password) throw new Error('addresses with a username or password are not read');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('addresses with an unusual port are not read');
  const h = u.hostname.toLowerCase();
  const ip4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(h), ip6 = h.startsWith('[');
  if (ip4 || ip6 || h === 'localhost' || !h.includes('.') || /\.(local|localhost|internal|lan|home|corp|test)$/.test(h)) throw new Error('local and numeric hosts are not read');
  return u;
}

export interface Article { url: string; title: string; text: string; truncated: boolean }

/** The readable text of an HTML page: the <article> or <main> if there is one, else the body, without chrome. */
export function extractArticle(html: string, url: string, maxChars: number): Article {
  const title = decode((/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()).replace(/\s+/g, ' ').slice(0, 200);
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(head|title|script|style|noscript|svg|template|iframe|form|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(body) ?? /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(body);
  if (main && main[1].replace(/<[^>]*>/g, '').trim().length > 500) body = main[1];
  const text = decode(body.replace(/<\/(p|div|section|li|h[1-6]|tr|blockquote|pre)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { url, title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.byteLength;
    if (n > MAX_BYTES) { await reader.cancel(); break; }   // a page that long is cut off, not refused
  }
  const all = new Uint8Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? 'utf-8';
  try { return new TextDecoder(charset).decode(all); } catch { return new TextDecoder().decode(all); }
}

export async function readArticle(raw: string, maxChars = 8000): Promise<Article> {
  let u = checkReadableUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(u.href, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { accept: 'text/html, application/xhtml+xml, text/plain;q=0.8', 'user-agent': 'TweetExplorer/1.0 (article reader)' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      if (hop >= MAX_HOPS) throw new Error('too many redirects');
      u = checkReadableUrl(new URL(res.headers.get('location')!, u).href);   // every hop is checked again
      continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`the page answered HTTP ${res.status}`); }
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type && !/^(text\/(html|plain)|application\/xhtml)/.test(type)) { await res.body?.cancel(); throw new Error(`cannot read ${type.split(';')[0]}; only web pages and plain text`); }
    const body = await readCapped(res);
    return type.startsWith('text/plain') ? { url: u.href, title: '', text: body.slice(0, maxChars), truncated: body.length > maxChars } : extractArticle(body, u.href, maxChars);
  }
}

export interface HnComment { by: string; text: string; depth: number }
interface Node { id?: number; title?: string; author?: string; points?: number | null; text?: string | null; children?: Node[] }

export async function readHnComments(id: string, limit = 30): Promise<{ title: string; points: number; total: number; shown: number; comments: HnComment[] }> {
  if (!/^\d{1,12}$/.test(id)) throw new Error('not a Hacker News item id');
  const res = await fetch(`https://hn.algolia.com/api/v1/items/${id}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`Hacker News answered HTTP ${res.status}`); }
  const root = (await res.json()) as Node;
  const out: HnComment[] = []; let total = 0;
  // Depth first in HN's own order (best first), two levels deep: the top comments and the main replies to them.
  const walk = (kids: Node[] | undefined, depth: number) => {
    for (const k of kids ?? []) {
      if (!k.text) continue;
      total++;
      if (out.length < limit) out.push({ by: k.author ?? '', text: stripHtml(k.text).slice(0, 600), depth });
      if (depth < 1) walk(k.children, depth + 1);
    }
  };
  walk(root.children, 0);
  return { title: root.title ?? '', points: root.points ?? 0, total, shown: out.length, comments: out };
}
