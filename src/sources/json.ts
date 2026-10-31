// Public JSON APIs that are read as feeds: GitHub repository search, Hugging Face papers and models, npm releases,
// CISA's exploited-vulnerability list and Mastodon's trending posts. Each becomes the same items an RSS feed does.
import type { SourceItem } from './types';

type Hash = (s: string) => Promise<string>;
type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const MAX = 50;
const str = (v: unknown, n = 600) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const plain = (html: unknown) => str(String(html ?? '').replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
const iso = (v: unknown) => { const t = Date.parse(String(v ?? '')); return new Date(Number.isNaN(t) ? Date.now() : Math.min(t, Date.now())).toISOString(); };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** `{7d}` in a feed address stands for the date seven days ago, so a saved search keeps asking for "recent". */
export const withDates = (url: string): string => url.replace(/(?:%7B|\{)(\d{1,3})d(?:%7D|\})/g, (_, d: string) => new Date(Date.now() - Number(d) * 86_400_000).toISOString().slice(0, 10));

/** Whether this address is one the JSON reader knows. */
export const isJsonFeed = (url: string): boolean => { try { return !!kind(new URL(url)); } catch { return false; } };

function kind(u: URL): string | null {
  if (u.hostname === 'api.github.com' && u.pathname === '/search/repositories') return 'github';
  if (u.hostname === 'huggingface.co' && u.pathname === '/api/daily_papers') return 'hfpapers';
  if (u.hostname === 'huggingface.co' && /^\/api\/(models|spaces)$/.test(u.pathname)) return 'hfrepos';
  if (u.hostname === 'registry.npmjs.org' && /^\/(@[\w.-]+\/)?[\w.-]+$/.test(u.pathname)) return 'npm';
  if (u.hostname === 'www.cisa.gov' && u.pathname.endsWith('/known_exploited_vulnerabilities.json')) return 'kev';
  if (u.pathname === '/api/v1/trends/statuses') return 'mastodon';
  return null;
}

/** Null when the address is not a JSON feed this reader knows; throws when it is but the answer is not what it expects. */
export async function parseJsonFeed(body: string, feedUrl: string, hash: Hash): Promise<{ title: string; items: SourceItem[] } | null> {
  const u = new URL(feedUrl), k = kind(u);
  if (!k) return null;
  let data: any; try { data = JSON.parse(body); } catch { throw new Error('that address did not answer with JSON'); }   // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Array<Omit<SourceItem, 'source' | 'id'> & { key: string }> = [];
  let title = '';
  if (k === 'github') {
    title = `GitHub repositories: ${u.searchParams.get('q')?.replace(/\s*created:\S+/, '') ?? ''}`;
    for (const r of (data.items ?? []) as Obj[]) out.push({ key: `gh:${r.id}`, url: str(r.html_url), title: str(r.full_name, 200), text: str(r.description), by: str(r.owner?.login, 80), at: iso(r.created_at), points: num(r.stargazers_count), comments: num(r.open_issues_count) });
  } else if (k === 'hfpapers') {
    title = 'Hugging Face daily papers';
    for (const r of (Array.isArray(data) ? data : []) as Obj[]) out.push({ key: `hfp:${r.paper?.id}`, url: `https://huggingface.co/papers/${r.paper?.id}`, title: str(r.title ?? r.paper?.title, 300), text: str(r.paper?.ai_summary || r.summary), by: str(r.organization?.fullname ?? r.submittedBy?.fullname, 80) || 'Hugging Face', at: iso(r.publishedAt ?? r.paper?.publishedAt), points: num(r.paper?.upvotes), comments: num(r.numComments) });
  } else if (k === 'hfrepos') {
    const spaces = u.pathname.endsWith('spaces'); title = `Hugging Face ${spaces ? 'spaces' : 'models'}`;
    for (const r of (Array.isArray(data) ? data : []) as Obj[]) out.push({ key: `hf:${r.id}`, url: `https://huggingface.co/${spaces ? 'spaces/' : ''}${r.id}`, title: str(r.id, 200), text: str([r.pipeline_tag, r.sdk, r.downloads ? `${r.downloads} downloads` : ''].filter(Boolean).join(' · ')), by: str(String(r.id).split('/')[0], 80), at: iso(r.lastModified ?? r.createdAt), points: num(r.likes) });
  } else if (k === 'npm') {
    title = `npm: ${str(data.name, 100)}`;
    const t = (data.time ?? {}) as Record<string, string>;
    for (const [v, at] of Object.entries(t).filter(([v]) => v !== 'created' && v !== 'modified').sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, 20))
      out.push({ key: `npm:${data.name}@${v}`, url: `https://www.npmjs.com/package/${data.name}/v/${v}`, title: `${data.name} ${v}`, text: str(data.description), by: str(data.name, 80), at: iso(at) });
  } else if (k === 'kev') {
    title = 'CISA known exploited vulnerabilities';
    for (const r of ((data.vulnerabilities ?? []) as Obj[]).sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded)))) out.push({ key: `kev:${r.cveID}`, url: `https://nvd.nist.gov/vuln/detail/${r.cveID}`, title: `${r.cveID}: ${str(r.vulnerabilityName, 200)}`, text: str(r.shortDescription), by: str(`${r.vendorProject} ${r.product}`, 80), at: iso(r.dateAdded) });
  } else {
    title = `Trending on ${u.hostname}`;
    for (const r of (Array.isArray(data) ? data : []) as Obj[]) out.push({ key: `masto:${r.id}`, url: str(r.url), title: '', text: plain(r.content), by: str(r.account?.display_name || r.account?.acct, 80), at: iso(r.created_at), points: num(r.favourites_count), comments: num(r.replies_count) });
  }
  const items: SourceItem[] = [];
  for (const { key, ...it } of out.filter((o) => o.url.startsWith('https://')).slice(0, MAX)) items.push({ source: 'rss', id: `rss:${await hash(`${feedUrl}\n${key}`)}`, ...it, title: it.title || it.text.slice(0, 120) });
  return { title, items };
}
