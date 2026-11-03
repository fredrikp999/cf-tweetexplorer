// The collection layer's decisions, without any storage or network: what a briefing needs (demands), when a stored collection can be
// reused instead of bought again, how often a free feed is polled, and what a briefing reads from what was collected.
// Imported by the Durable Object and by the tests, so: `.ts` extensions, and no TypeScript-only runtime syntax.

export type CollectKind = 'x_list' | 'x_accounts' | 'x_search' | 'x_watch' | 'rss' | 'youtube' | 'hn';
/** poll: free feeds, on a schedule that backs off. window: paid X reads, once per period, just before the briefing. incremental: an X search from a checkpoint. */
export type Strategy = 'poll' | 'window' | 'incremental';
export type CollectMode = 'off' | 'shadow' | 'store';
export const MODES: CollectMode[] = ['off', 'shadow', 'store'];

export interface SourceSpec {
  listId?: string; mode?: 'best' | 'latest';        // x_list, x_accounts
  query?: string; sort?: 'Latest' | 'Top';          // x_search, x_watch, rss, youtube, hn
  originalsOnly?: boolean; includeRetweets?: boolean;   // x_watch
  hnTag?: string; minPoints?: number;               // hn
}

export const strategyOf = (kind: CollectKind): Strategy => (kind === 'x_watch' ? 'incremental' : kind === 'x_list' || kind === 'x_accounts' || kind === 'x_search' ? 'window' : 'poll');
export const isPaid = (kind: CollectKind): boolean => strategyOf(kind) !== 'poll';

/** Two uses of the same thing get the same key, so they share one source. Depth (pages) and likes are not part of it: they are merged across uses. */
export function sourceKey(kind: CollectKind, s: SourceSpec): string {
  if (kind === 'x_list') return `x_list\n${s.listId}\n${s.mode ?? 'best'}`;
  if (kind === 'x_accounts') return `x_accounts\n${s.listId}`;
  if (kind === 'x_search') return `x_search\n${s.query}\n${s.sort ?? 'Latest'}`;
  if (kind === 'x_watch') return `x_watch\n${s.query}\n${s.originalsOnly ? 1 : 0}${s.includeRetweets ? 1 : 0}`;
  if (kind === 'hn') return `hn\n${s.hnTag ?? 'front_page'}\n${String(s.query ?? '').toLowerCase()}\n${s.minPoints ?? 0}`;
  return `rss\n${s.query}`;   // a YouTube feed is a feed: the same address is the same source
}

// ---- what a briefing needs
export type TopicSourceLike =
  | { type: 'search'; query: string; sort: 'Latest' | 'Top' }
  | { type: 'list'; listId: string }
  | { type: 'flist'; listId: string }
  | { type: 'feed'; watch?: string; source?: string }
  | { type: 'xlist'; listId: string; mode?: 'best' | 'latest'; minFaves?: number; pages?: number }
  | { type: 'xgroup'; group: string; mode?: 'best' | 'latest'; minFaves?: number; pages?: number };
export interface TopicLike { slug: string; title: string; enabled: boolean; toSignal?: boolean; signalGroup?: string; sources: TopicSourceLike[]; intervalHours: number; nextRun: number; maxCost?: number }
export interface Lookups {
  xlists: Array<{ id: string; name: string; groups: string[] }>;
  lists: Array<{ id: string; name: string }>;
  flists: Array<{ id: string; name: string; members: Array<{ source: 'rss' | 'youtube' | 'hn'; query: string; hnTag?: string; minPoints?: number; label: string }> }>;
}
/** One thing a briefing asks the collection layer for. `part` is the index of the topic source it came from, so its results can be reported per source. */
export interface Demand { key: string; kind: CollectKind; spec: SourceSpec; label: string; part: number; pages: number; minFaves: number }

export const PAGE_TWEETS = 20, LATEST_PAGE_TWEETS = 80, MAX_LISTS_PER_SOURCE = 20, SEARCH_PAGES = 3, ACCOUNT_PAGES = 2;
const TWEET_PRICE = 0.00015;

/** A data budget is shared out between the X lists, so the first lists cannot use it all up. */
export function pagesWithin(want: number, mode: 'best' | 'latest' | undefined, maxCost: number | undefined, listReads: number): number {
  if (!maxCost || !listReads) return want;
  const perPage = (mode === 'latest' ? LATEST_PAGE_TWEETS : PAGE_TWEETS) * TWEET_PRICE;
  return Math.max(1, Math.min(want, Math.floor((maxCost * 0.85) / (listReads * perPage))));
}

export function demandsOf(t: Pick<TopicLike, 'sources' | 'maxCost'>, l: Lookups): Demand[] {
  const out: Demand[] = [];
  const idsOf = (s: TopicSourceLike) => (s.type === 'xgroup' ? l.xlists.filter((x) => x.groups.includes(s.group)).map((x) => x.id).slice(0, MAX_LISTS_PER_SOURCE) : s.type === 'xlist' ? [s.listId] : []);
  const listReads = t.sources.reduce((n, s) => n + idsOf(s).length, 0);
  t.sources.forEach((s, part) => {
    if (s.type === 'xlist' || s.type === 'xgroup') {
      const mode = s.mode ?? 'best', pages = pagesWithin(s.pages ?? 2, mode, t.maxCost, listReads), minFaves = mode === 'best' ? s.minFaves ?? 5 : 0;
      for (const id of idsOf(s)) {
        const spec: SourceSpec = { listId: id, mode };
        out.push({ key: sourceKey('x_list', spec), kind: 'x_list', spec, label: l.xlists.find((x) => x.id === id)?.name ?? id, part, pages, minFaves });
      }
    } else if (s.type === 'list') {
      const spec: SourceSpec = { listId: s.listId };
      out.push({ key: sourceKey('x_accounts', spec), kind: 'x_accounts', spec, label: l.lists.find((x) => x.id === s.listId)?.name ?? 'List', part, pages: ACCOUNT_PAGES, minFaves: 0 });
    } else if (s.type === 'search') {
      const spec: SourceSpec = { query: s.query, sort: s.sort };
      out.push({ key: sourceKey('x_search', spec), kind: 'x_search', spec, label: s.query, part, pages: SEARCH_PAGES, minFaves: 0 });
    } else if (s.type === 'flist') {
      for (const m of l.flists.find((x) => x.id === s.listId)?.members ?? []) {
        const kind: CollectKind = m.source, spec: SourceSpec = m.source === 'hn' ? { query: m.query, hnTag: m.hnTag ?? 'front_page', minPoints: m.minPoints ?? 0 } : { query: m.query };
        out.push({ key: sourceKey(kind, spec), kind, spec, label: m.label, part, pages: 0, minFaves: 0 });
      }
    }
    // A 'feed' source is what the Live feed already collects: it adds nothing to collect, and is matched by matchesFeed below.
  });
  return out;
}

/** Whether a watched source is read by a briefing's "Live feed" source: all of them, one kind, or one watch (by id or by name). */
export function matchesFeed(f: { watch?: string; source?: string }, w: { id: string; label: string; kind: CollectKind }): boolean {
  const k = w.kind === 'x_watch' ? 'x' : w.kind;
  if (f.source && f.source !== k) return false;
  if (!f.watch) return true;
  return w.id === f.watch || w.label.toLowerCase().includes(f.watch.toLowerCase());
}

/** Several uses share one fetch, so it must satisfy the most demanding: the most pages and the fewest likes. */
export function mergeDepth(uses: Array<{ pages: number; minFaves: number }>): { pages: number; minFaves: number } {
  return { pages: Math.max(1, ...uses.map((u) => u.pages || 1)), minFaves: Math.min(...(uses.length ? uses.map((u) => u.minFaves) : [0])) };
}

// ---- when something already collected can be used again
const HOUR = 3_600_000;
/** How old a window's collection may be and still count: a quarter of the period, at most six hours. So a re-run the same morning costs no data. */
export const reuseMs = (hours: number): number => Math.min(6 * HOUR, (hours * HOUR) / 4);
export interface Covered { from: number; to: number; pages: number; minFaves: number }
export function canReuse(c: Covered | undefined, need: { hours: number; pages: number; minFaves: number }, now: number): boolean {
  if (!c) return false;
  return c.to >= now - reuseMs(need.hours) && c.to <= now && c.to - c.from >= need.hours * HOUR - 60_000 && c.pages >= need.pages && c.minFaves <= need.minFaves;
}
/** Runs read from the moment the oldest of their sources was collected, one period back: a re-run reads the same posts as the run before it. */
export function readSince(covered: Array<Covered | undefined>, hours: number, now: number): number {
  const tos = covered.filter((c): c is Covered => !!c).map((c) => c.to);
  return (tos.length ? Math.min(now, ...tos) : now) - hours * HOUR;
}

// ---- how often a free feed is read
export const BRIEFING_POLL_SEC = 6 * 3600;   // a feed only a briefing reads: often enough not to miss items that scroll off a busy feed
const MAX_BACKOFF_SEC = 6 * 3600;
/** Seconds to the next check. Failures back off quickly and quiet free feeds slowly, both to at most six hours; an interval you pinned is left alone unless it fails. */
export function nextDelaySec(o: { baseSec: number; errors: number; quiet: number; paid: boolean; pinned: boolean }): number {
  if (o.errors > 0) return Math.max(o.baseSec, Math.min(MAX_BACKOFF_SEC, o.baseSec * 2 ** Math.min(o.errors, 8)));
  if (o.paid || o.pinned || o.quiet < 3) return o.baseSec;
  return Math.max(o.baseSec, Math.min(MAX_BACKOFF_SEC, o.baseSec * 2 ** Math.min(o.quiet - 2, 4)));
}

/** Recurring X collection that nothing is waiting for must leave room for the briefings still to come today. */
export const incrementalAllowed = (spent: number, cap: number, reserved: number): boolean => spent + reserved < cap;

/** Whether a fetch stopped because of its page limit rather than running out of posts. An estimate: a full last page may also be the last one. */
export function hitLimit(kind: CollectKind, spec: SourceSpec, returned: number, pages: number): boolean {
  if (kind === 'x_list') return spec.mode !== 'latest' && returned >= pages * PAGE_TWEETS;
  if (kind === 'x_search') return returned >= pages * PAGE_TWEETS;
  return false;
}

// ---- what a briefing reads
export interface StoredItem { id: string; ts: number; likes: number; json: Record<string, unknown> }
/** The items of one source that a use of it wants: in the period, with enough likes, and no deeper than it asked for (a deeper use may share the source). */
export function selectForUse(items: StoredItem[], use: { kind: CollectKind; spec: SourceSpec; pages: number; minFaves: number }, since: number): StoredItem[] {
  const inPeriod = items.filter((i) => !Number.isFinite(i.ts) || i.ts >= since);
  if (use.kind !== 'x_list' || use.spec.mode === 'latest') return inPeriod;
  return inPeriod.filter((i) => i.likes >= use.minFaves).sort((a, b) => b.likes - a.likes).slice(0, Math.max(1, use.pages) * PAGE_TWEETS);
}
/** One story carried by two feeds has two ids but one address. */
export function dedupeByAddress<T extends { id: string; json: Record<string, unknown> }>(items: T[]): T[] {
  const seen = new Set<string>(), out: T[] = [];
  for (const i of items) {
    const url = String(i.json.url ?? '').replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(i.id) || (url && seen.has(url))) continue;
    seen.add(i.id); if (url) seen.add(url);
    out.push(i);
  }
  return out;
}
/** A shared source's cost is split evenly between the briefings that read it. */
export const allocate = (cost: number, briefings: number): number => cost / Math.max(1, briefings);

/** Shadow mode: what the live fetch found against what the store holds for the same run. */
export function compareSets(live: string[], store: string[]): { live: number; store: number; both: number; onlyLive: number; onlyStore: number } {
  const a = new Set(live), b = new Set(store);
  const both = [...a].filter((x) => b.has(x)).length;
  return { live: a.size, store: b.size, both, onlyLive: a.size - both, onlyStore: b.size - both };
}
