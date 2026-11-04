// The search query for one time window of a History job.
export interface Filters { excludeReplies: boolean; excludeRetweets: boolean; minFaves: number; lang: string }

// `query` is the base query for one group (words + a group of accounts); operators are added per window.
// Filters go in the query, not only on what comes back: every returned tweet is paid for, kept or not.
export const queryFor = (query: string, f: Filters, a: number, b: number): string =>
  [query, `since_time:${a}`, `until_time:${b}`, f.excludeReplies && '-filter:replies', f.excludeRetweets && '-filter:retweets', f.minFaves > 0 && `min_faves:${f.minFaves}`, f.lang && `lang:${f.lang}`]
    .filter(Boolean).join(' ');
