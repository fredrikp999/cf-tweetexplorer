// Hacker News through the free Algolia search API (https://hn.algolia.com/api). No key, no cost.
import { decode } from './rss.ts';
import type { FetchResult, SourceItem } from './types';

export type HnTag = 'front_page' | 'story' | 'show_hn' | 'ask_hn';
export const HN_TAGS: HnTag[] = ['front_page', 'story', 'show_hn', 'ask_hn'];
const API = 'https://hn.algolia.com/api/v1';
const DAY = 86_400;

interface Hit { objectID: string; title?: string; url?: string | null; author?: string; points?: number | null; num_comments?: number | null; created_at_i: number; story_text?: string | null }

export const stripHtml = (s: string) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Stories for one watch. The front page is ranked, so it is read as it is and de-duplicated by the caller.
 * Anything else is read newest first since `since` (unix seconds); with a points threshold the window is the
 * last day instead, because a story only crosses the threshold some time after it was posted.
 */
export async function fetchHn(opts: { tag: HnTag; query?: string; minPoints?: number; since: number }): Promise<FetchResult> {
  const p = new URLSearchParams({ tags: opts.tag, hitsPerPage: '50' });
  if (opts.query) p.set('query', opts.query);
  const minPoints = Math.max(0, Math.floor(opts.minPoints ?? 0));
  const filters: string[] = [];
  if (opts.tag !== 'front_page') {
    const day = Math.floor(Date.now() / 1000) - DAY;
    filters.push(`created_at_i>${minPoints > 1 ? Math.max(day, opts.since) : opts.since}`);
  }
  if (minPoints > 0) filters.push(`points>=${minPoints}`);
  if (filters.length) p.set('numericFilters', filters.join(','));
  const res = await fetch(`${API}/${opts.tag === 'front_page' ? 'search' : 'search_by_date'}?${p}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`Hacker News search failed (HTTP ${res.status})`); }
  const body = (await res.json()) as { hits?: Hit[] };
  const items: SourceItem[] = (body.hits ?? []).filter((h) => h.title).map((h) => {
    const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
    return {
      source: 'hn', id: `hn:${h.objectID}`, url: h.url || discussion, discussionUrl: h.url ? discussion : undefined,
      title: h.title!, text: h.story_text ? stripHtml(h.story_text).slice(0, 600) : '', by: h.author ?? '',
      at: new Date(h.created_at_i * 1000).toISOString(), points: h.points ?? 0, comments: h.num_comments ?? 0,
    };
  });
  return { items };
}
