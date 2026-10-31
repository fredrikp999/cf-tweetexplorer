// The neutral shape every non-X source (RSS, Hacker News, …) is turned into before it reaches the Monitor feed.
export type SourceKind = 'x' | 'rss' | 'hn' | 'youtube';
export const SOURCES: SourceKind[] = ['x', 'rss', 'hn', 'youtube'];
export const isSource = (s: unknown): s is SourceKind => SOURCES.includes(s as SourceKind);

export interface SourceItem {
  source: Exclude<SourceKind, 'x'>;
  /** Namespaced and stable, e.g. `hn:123` or `rss:<hash>`. */
  id: string;
  /** The article or post itself. */
  url: string;
  /** Where people discuss it (Hacker News); absent when it is the same as `url`. */
  discussionUrl?: string;
  title: string;
  /** A plain-text snippet. */
  text: string;
  /** Author, or the feed or site name when the item has none. */
  by: string;
  /** ISO time. */
  at: string;
  points?: number;
  comments?: number;
  /** YouTube. */
  views?: number;
}

export interface FetchResult { items: SourceItem[]; /** True when the server said nothing changed (HTTP 304). */ unchanged?: boolean; cache?: { etag?: string; lastModified?: string } }

// The tweet-shaped JSON the feed stores and the admin app, the summarizer and MCP already understand,
// so a combined feed needs no second code path. `source` and `title` are the additions.
export function toFeedShape(i: SourceItem) {
  return {
    id: i.id, url: i.url, text: i.title && i.text ? `${i.title}\n${i.text}` : i.title || i.text, createdAt: i.at, isReply: false, isRetweet: false,
    likeCount: i.points ?? 0, retweetCount: 0, replyCount: i.comments ?? 0, quoteCount: 0, viewCount: i.views ?? 0,
    author: { userName: i.by, name: i.by },
    entities: { hashtags: [] as { text: string }[], urls: [] as { url: string; expanded_url?: string }[] },
    source: i.source, title: i.title, discussionUrl: i.discussionUrl,
  };
}
