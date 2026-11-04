// Scripted X posts, for running briefings and collection locally without spending anything (SUMMARY_MOCK only exists in .dev.vars).
import type { Sources } from '../summarize/agent.ts';
import { bill, exhausted, type Meter } from '../summarize/pricing.ts';

const posts = (seed: string, n: number) => Array.from({ length: n }, (_, i) => ({
  id: `${Math.abs([...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}${i}`, text: `Mock post ${i} about ${seed}`, createdAt: new Date(Date.now() - i * 60_000).toISOString(),
  likeCount: 200 - i, retweetCount: 0, replyCount: 0, author: { userName: 'mock', name: 'Mock' },
}));
// A list has a few big posts and many small ones, and some lists are busier than others, so a likes threshold changes what comes back.
const listPosts = (listId: string) => {
  const scale = 1 + (Number(listId.slice(-2)) || 0) % 7;
  return posts(listId, 120).map((p, i) => ({ ...p, likeCount: Math.round((6000 * scale) / (i + 1)) }));
};
export const mockX = (real: Sources, meter: Meter): Sources => ({ ...real,
  async xlistTweets({ listId, pages, minFaves }) {   // page by page, stopping at a budget as the real client does
    const out: ReturnType<typeof posts> = [], all = listPosts(listId).filter((p) => p.likeCount >= (minFaves ?? 0));
    for (let i = 0; i < (pages ?? 2) && !exhausted(meter); i++) { const page = all.slice(i * 20, (i + 1) * 20); bill(meter, page.length); out.push(...page); }
    return out;
  },
  async search({ query }) { if (exhausted(meter)) return []; const p = posts(query.replace(/\s*since_time:\d+/, ''), 7); bill(meter, p.length); return p; },
});
