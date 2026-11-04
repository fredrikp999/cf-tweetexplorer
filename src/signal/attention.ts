// Which new papers people are paying attention to. arXiv itself has no reactions, so this borrows them: upvotes on Hugging Face Daily Papers,
// points on Hacker News, and posts that link to the paper or use its name among what this site collects anyway.
// Most papers have none of this (measured on 3,276 topic papers over 28 days: 8.4% on Hugging Face, 1.9% on Hacker News), and a new paper has not had time to get any.
// So it lifts the few into their own section, and says nothing against the rest, which stay in date order.
// Pure functions (no Worker APIs), so Node can test them.

export interface Mention { by: string; name?: string; url: string; reactions: number }
export interface PaperSignals { hf?: { upvotes: number; url: string }; hn?: { points: number; comments: number; url: string }; mentions?: Mention[] }
export interface Attention { score: number; top: boolean; hf?: PaperSignals['hf']; hn?: PaperSignals['hn']; /** One per account: the post with the most reactions. */ mentions: Mention[] }

// These thresholds are a starting point, not a measurement of what is good: a Hugging Face median on matched papers is 12 upvotes, and only 18 of 263 arXiv papers on Hacker News reached 10 points.
const HF_TOP = 10, HN_TOP = 10, ACCOUNTS_TOP = 2, ONE_POST_TOP = 50, REACTION_CAP = 2000;
/** Accounts that post papers as their job: being on one says little about a paper, and Hugging Face's own count is already used. */
const PAPER_FEEDS = new Set(['huggingpapers', 'arxiv', 'paperswithcode', 'alphaxiv']);

const LINK = /(?:arxiv\.org\/(?:abs|pdf|html)\/|alphaxiv\.org\/(?:abs\/)?|huggingface\.co\/papers\/|\barxiv(?::\s?|\s))(\d{4}\.\d{4,5})/gi;
/** The arXiv ids a text points to, as a link or written as "arXiv 2610.26464", without their version. A number alone could be anything. */
export function arxivIdsIn(text: string): string[] { return [...new Set([...text.matchAll(LINK)].map((m) => m[1]))]; }

// ---- Papers named without a link. Tried on 1,124 real posts: meaning alone (embeddings) found papers on the same subject, not the same paper, and its one confident match was wrong.
// A name the paper made up did better: all 5 posts with a mixed-case name such as "nanoMuse" were right, against 1 post with a link. All-capitals names ("SOTA", "CASE", "PAUSE") were all wrong, as they are ordinary words.
const NOT_COINED = new Set(['ChatGPT', 'OpenAI', 'GitHub', 'DeepSeek', 'DeepMind', 'YouTube', 'LinkedIn', 'PyTorch', 'TensorFlow', 'HuggingFace', 'LangChain', 'LangGraph', 'LlamaIndex', 'JavaScript', 'TypeScript', 'AlphaGo', 'AlphaFold', 'GraphQL', 'PostgreSQL', 'MiniMax', 'xAI']);
const MAX_NAME_ACCOUNTS = 25, TOKEN = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu, DAY = 86_400_000;

/** The name a paper gave itself: one word before the colon of its title, with small letters and a capital or digit after the first letter. Empty when it has none. */
export function coinedName(title: string): string {
  const n = /^([\p{L}\p{N}-]{4,30}):\s/u.exec(title)?.[1] ?? '';
  return n && /\p{Ll}/u.test(n) && /[\p{Lu}\p{N}]/u.test(n.slice(1)) && !NOT_COINED.has(n) ? n : '';
}
/** Which of these names a text uses, exactly, as whole words. */
export function namesIn(text: string, names: ReadonlySet<string>): string[] {
  return [...new Set(text.match(TOKEN) ?? [])].filter((w) => names.has(w));
}
/**
 * The names that really mean the paper. A name in use before its paper appeared was not made up by that paper, and one that very many accounts use is more likely a product.
 * A day's grace, because a paper can be announced before its listed date.
 */
export function trustedNames(hits: Array<{ name: string; by: string; ts: number }>, published: ReadonlyMap<string, number>): Set<string> {
  const early = new Set<string>(), accounts = new Map<string, Set<string>>();
  for (const h of hits) {
    if (h.ts < (published.get(h.name) ?? Infinity) - DAY) early.add(h.name);
    (accounts.get(h.name) ?? accounts.set(h.name, new Set()).get(h.name)!).add(h.by.toLowerCase());
  }
  return new Set([...accounts].filter(([n, a]) => !early.has(n) && a.size <= MAX_NAME_ACCOUNTS).map(([n]) => n));
}

const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function attentionOf(s: PaperSignals, authors: string[] = []): Attention {
  const own = new Set(authors.map(clean)), best = new Map<string, Mention>();
  for (const m of s.mentions ?? []) {
    const key = m.by.toLowerCase();
    if (!key || PAPER_FEEDS.has(key)) continue;
    if (m.name && own.has(clean(m.name))) continue;   // an author announcing their own paper is not yet anyone else's attention
    const had = best.get(key);
    if (!had || m.reactions > had.reactions) best.set(key, m);
  }
  const mentions = [...best.values()].sort((a, b) => b.reactions - a.reactions), up = s.hf?.upvotes ?? 0, pts = s.hn?.points ?? 0;
  const reach = mentions.reduce((n, m) => n + Math.min(REACTION_CAP, m.reactions), 0);
  const top = up >= HF_TOP || pts >= HN_TOP || mentions.length >= ACCOUNTS_TOP || (mentions[0]?.reactions ?? 0) >= ONE_POST_TOP;
  const score = Math.log1p(up) + Math.log1p(pts) + 0.5 * Math.log1p(reach) + 0.5 * mentions.length;
  return { score: Math.round(score * 1000) / 1000, top, ...(s.hf ? { hf: s.hf } : {}), ...(s.hn ? { hn: s.hn } : {}), mentions };
}
