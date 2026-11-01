// Signal: items that should not count, and titles fit to show. Pure functions (no Worker APIs), so Node can test them.

// Engagement bait: giveaways and "like and reply to win" posts. They collect reactions without saying anything, so they would rise on reactions alone.
const BAIT = [
  /\bgiv(?:e|ing)\s*away\b|\bgiveaway\b/i,
  /\b(?:like|rt|retweet|repost|follow)\b[^.!?\n]{0,30}\b(?:and|&|\+)\s*(?:comment|reply|retweet|rt|repost|follow|tag)\b/i,
  /\b(?:comment|reply)\s+["“']?[\w ]{1,20}["”']?\s+(?:to|and)\s+(?:win|get|receive)\b/i,
  /\b(?:pick|choose|select)\s+\d+\s+(?:random\s+)?(?:people|winners|followers)\b/i,
  /\bto\s+win\b[^.!?\n]{0,40}\b(?:like|follow|retweet|comment|reply)\b/i,
  /\bairdrop\b|\bdm\s+me\s+(?:for|to)\b/i,
];
/** True for a giveaway or "like and reply to win" post. */
export const isBait = (text: string): boolean => BAIT.some((r) => r.test(text));

/** A title fit to show: no links, one line, cut at a word (with an ellipsis) when longer than `max`. */
export function cleanTitle(raw: string, max = 140): string {
  const t = String(raw ?? '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().replace(/[\s:–—-]+$/, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max), sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:–—-]+$/, '') + '…';
}
