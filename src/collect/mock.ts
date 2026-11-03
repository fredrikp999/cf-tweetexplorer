// Scripted X posts, for running briefings and collection locally without spending anything (SUMMARY_MOCK only exists in .dev.vars).
import type { Sources } from '../summarize/agent.ts';
import { bill, exhausted, type Meter } from '../summarize/pricing.ts';

const posts = (seed: string, n: number) => Array.from({ length: n }, (_, i) => ({
  id: `${Math.abs([...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}${i}`, text: `Mock post ${i} about ${seed}`, createdAt: new Date(Date.now() - i * 60_000).toISOString(),
  likeCount: 200 - i, retweetCount: 0, replyCount: 0, author: { userName: 'mock', name: 'Mock' },
}));
export const mockX = (real: Sources, meter: Meter): Sources => ({ ...real,
  async xlistTweets({ listId, pages }) {   // page by page, stopping at a budget as the real client does
    const out: ReturnType<typeof posts> = [], all = posts(listId, (pages ?? 2) * 20);
    for (let i = 0; i < (pages ?? 2) && !exhausted(meter); i++) { const page = all.slice(i * 20, (i + 1) * 20); bill(meter, page.length); out.push(...page); }
    return out;
  },
  async search({ query }) { if (exhausted(meter)) return []; const p = posts(query.replace(/\s*since_time:\d+/, ''), 7); bill(meter, p.length); return p; },
});
