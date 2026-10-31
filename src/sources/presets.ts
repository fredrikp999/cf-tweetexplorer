// Shorthand for places that already publish a feed: `r/rust`, `lobsters:rust`, `github:owner/repo`, `arxiv:cs.AI`, `news: climate`, …
// Each one is turned into the feed address it stands for, so the rest of the app sees an ordinary RSS or Atom feed.
const e = encodeURIComponent;
const NAME = /^[\w.-]{1,60}$/;

type Preset = (arg: string) => string | null;

const PRESETS: Record<string, Preset> = {
  reddit: (a) => {
    const sub = /^\/?r\/([\w]{2,21})(\/(?:top|new|hot|rising))?\/?$/i.exec(a);
    if (sub) return `https://www.reddit.com/r/${sub[1]}${sub[2] ?? ''}/.rss`;
    if (/^[\w]{2,21}$/.test(a)) return `https://www.reddit.com/r/${a}/.rss`;
    return a ? `https://www.reddit.com/search.rss?q=${e(a)}&sort=new` : null;   // anything else is a search across Reddit
  },
  lobsters: (a) => (!a ? 'https://lobste.rs/rss' : NAME.test(a) ? `https://lobste.rs/t/${a}.rss` : null),
  github: (a) => { const m = /^([\w.-]+)\/([\w.-]+)$/.exec(a.replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '')); return m ? `https://github.com/${m[1]}/${m[2]}/releases.atom` : null; },
  arxiv: (a) => /^[a-z-]+(\.[A-Za-z-]+)?$/.test(a) ? `https://rss.arxiv.org/rss/${a}`
    : a ? `https://export.arxiv.org/api/query?search_query=all:${e(a)}&sortBy=submittedDate&sortOrder=descending&max_results=50` : null,
  news: (a) => (a ? `https://news.google.com/rss/search?q=${e(a)}&hl=en-US&gl=US&ceid=US:en` : null),
  stackoverflow: (a) => (NAME.test(a) ? `https://stackoverflow.com/feeds/tag?tagnames=${e(a)}&sort=newest` : null),
  producthunt: () => 'https://www.producthunt.com/feed',
  substack: (a) => (/^[a-z0-9-]{1,60}$/i.test(a) ? `https://${a}.substack.com/feed` : null),
  medium: (a) => (/^@[\w.-]{1,60}$/.test(a) ? `https://medium.com/feed/${a}` : NAME.test(a) ? `https://medium.com/feed/tag/${a}` : null),
  wikipedia: (a) => (a ? `https://en.wikipedia.org/w/index.php?title=${e(a.replace(/ /g, '_'))}&action=history&feed=atom` : 'https://en.wikipedia.org/w/index.php?title=Special:RecentChanges&feed=atom&days=1&limit=50'),
  wikinews: () => 'https://en.wikinews.org/w/index.php?title=Special:NewPages&feed=atom&namespace=0',
  bluesky: (a) => { const h = a.replace(/^@/, '').replace(/^https?:\/\/bsky\.app\/profile\//i, '').replace(/\/+$/, ''); return /^[\w.-]+\.[a-z]{2,}$/i.test(h) || /^did:plc:\w+$/.test(h) ? `https://bsky.app/profile/${h}/rss` : null; },
  redditsearch: (a) => (a ? `https://www.reddit.com/search.rss?q=${e(a)}&sort=new` : null),
  arxivsearch: (a) => (a ? `https://export.arxiv.org/api/query?search_query=all:${e(a)}&sortBy=submittedDate&sortOrder=descending&max_results=50` : null),
  mastodon: (a) => mastodon(a),
};
// Spellings that mean the same.
const ALIAS: Record<string, string> = { r: 'reddit', so: 'stackoverflow', gh: 'github', bsky: 'bluesky', gnews: 'news', ph: 'producthunt', fediverse: 'mastodon' };

/** `#tag@instance` → the tag's feed; `@user@instance` → the account's feed. */
function mastodon(a: string): string | null {
  const t = /^#([\w]{1,60})@([\w.-]+\.[a-z]{2,})$/i.exec(a); if (t) return `https://${t[2]}/tags/${t[1]}.rss`;
  const u = /^@?([\w.-]{1,60})@([\w.-]+\.[a-z]{2,})$/i.exec(a); if (u) return `https://${u[2]}/@${u[1]}.rss`;
  return null;
}

/** Feed addresses that are one small step from the page people actually copy (a subreddit, a repository, a profile). */
function fromLink(raw: string): string | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^(www|old|new|m)\./, ''), p = u.pathname.replace(/\/+$/, '');
  if (host === 'reddit.com' && /^\/(r|user)\/[\w-]+(\/(top|new|hot|rising))?$/.test(p)) return `https://www.reddit.com${p}/.rss`;
  if (host === 'github.com' && /^\/[\w.-]+\/[\w.-]+$/.test(p)) return `https://github.com${p}/releases.atom`;
  if (host === 'bsky.app' && /^\/profile\/[^/]+$/.test(p)) return `https://bsky.app${p}/rss`;
  if (host === 'news.ycombinator.com' || host === 'x.com' || host === 'twitter.com') return null;
  // A Mastodon profile link looks like https://instance/@name; every Mastodon server serves it as a feed with .rss added.
  if (/^\/@[\w.-]+$/.test(p) && !host.endsWith('medium.com') && !host.endsWith('youtube.com') && !host.endsWith('substack.com')) return `${u.origin}${p}.rss`;
  return null;
}

/**
 * The feed address a shorthand stands for, or null when `input` is not one (a plain address is left to the caller).
 * Throws when the kind is recognised but the rest is not usable, so the person is told what to fix.
 */
export function expandShorthand(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return fromLink(s);
  const bare = /^(?:\/?r\/)([\w]{2,21}(?:\/(?:top|new|hot|rising))?)\/?$/i.exec(s);
  if (bare) return PRESETS.reddit(`r/${bare[1]}`);
  const fedi = mastodon(s); if (fedi) return fedi;
  const m = /^([a-z]{1,14})\s*:\s*(.*)$/i.exec(s);
  if (!m) return null;
  const kind = ALIAS[m[1].toLowerCase()] ?? m[1].toLowerCase();
  const preset = PRESETS[kind];
  if (!preset) return null;
  const url = preset(m[2].trim());
  if (!url) throw new Error(`could not read “${s}” as ${kind}; try ${EXAMPLES[kind] ?? `${kind}:…`}`);
  return url;
}

const EXAMPLES: Record<string, string> = {
  reddit: 'r/rust or reddit: some keywords', lobsters: 'lobsters:rust', github: 'github:owner/repo', arxiv: 'arxiv:cs.AI or arxiv: diffusion models',
  news: 'news: climate policy', stackoverflow: 'stackoverflow:rust', substack: 'substack:name', medium: 'medium:@name or medium:tag',
  bluesky: 'bluesky:name.bsky.social', mastodon: 'mastodon:#rust@mastodon.social or @name@mastodon.social',
};

/** What the Monitor and the feed lists accept in the feed box, for the hint under it. */
export const SHORTHAND_HINT = 'r/rust · lobsters:rust · github:owner/repo · arxiv:cs.AI · news: climate · bluesky:name.bsky.social · @name@mastodon.social · stackoverflow:rust · substack:name · medium:@name · producthunt: · wikipedia:Page · wikinews:';
