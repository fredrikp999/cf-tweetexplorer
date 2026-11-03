// The collection layer: what is fetched, how often, what it cost and who uses it, apart from what is done with it. Briefings, Signal and feed pages
// declare what they need (uses); that gives the sources and their schedules. Free feeds are polled and back off when quiet or failing. Paid X reads run once
// per period just before the briefing, because a filter on likes only means something once posts have had time to collect them.
// Everything is stored once, so a re-run reads what was collected instead of buying it again. New items are pushed to the Monitor, which keeps
// Signal's counts and the Live feed, through an outbox: delivered at least once, and the Monitor's seen-ids make that harmless.
import { DurableObject } from 'cloudflare:workers';
import { json, OutOfCredits, search, slim, type Tweet } from '../lib/twitterapi';
import { recordCost } from '../lib/costs';
import { fetchHn, type HnTag } from '../sources/hn';
import { fetchRss } from '../sources/rss';
import { setYoutubeKey } from '../sources/youtube';
import { toFeedShape } from '../sources/types';
import { fetchSource, type Sources } from '../summarize/agent.ts';
import { bill, newMeter, tweetCallCost } from '../summarize/pricing.ts';
import { workerSources } from '../summarize/worker';
import { mockX } from '../collect/mock.ts';
import {
  allocate, BRIEFING_POLL_SEC, canReuse, compareSets, dedupeByAddress, demandsOf, hitLimit, incrementalAllowed, isPaid, matchesFeed, mergeDepth, MODES, nextDelaySec, PAGE_TWEETS, readSince, reuseMs, selectForUse, sourceKey, strategyOf,
  type CollectKind, type CollectMode, type Covered, type Demand, type Lookups, type SourceSpec, type StoredItem, type TopicLike,
} from '../collect/plan.ts';

const LEAD_MS = 15 * 60_000;       // X windows are collected this long before the briefing that reads them
const KEEP_MS = 90 * 86_400_000;   // how long items and run records are kept
const POLL_RECENT_MS = 30 * 60_000;   // a free feed read this recently is not read again for a briefing
const FIRST_CHECK_ITEMS = 10;      // a new watch shows the latest few items in the Live feed, not nothing until the next post
const OVERLAP = 90, WATCH_PAGES = 5, WIDTH = 3, POLLS_PER_ALARM = 60, OUTBOX_BATCH = 40, ITEMS_PER_FLIST = 400, BROWSE_MAX = 100;
const MAX_ITEMS_TO_MONITOR = 2000;
const today = () => new Date().toISOString().slice(0, 10);
const itemKind = (k: CollectKind) => (k === 'rss' || k === 'hn' || k === 'youtube' ? k : 'x');

export interface CollectSource {
  id: string; key: string; kind: CollectKind; spec: SourceSpec; label: string; autoLabel?: boolean; created: number;
  /** The Monitor watch it feeds, and the feed list that watch was made from. */
  watch?: string; list?: string; watchSec?: number;
  baseSec: number; pinnedSec?: number; paused?: boolean; unusedSince?: number;
  checks: number; found: number; cost: number; lastRun: number; lastError: string; errors: number; quiet: number; nextRun: number; lastCheckedTs: number;
  /** Taken over from the Monitor and not read yet: the store is empty, so everything looks new on the first read. */
  adopted?: boolean;
  etag?: string; lastModified?: string; covered?: Covered; lastCost: number; lastReturned: number; lastHitLimit?: boolean;
}
interface Use { consumer_kind: string; consumer_id: string; source: string; data: string }
interface UseData { label: string; part?: number; pages?: number; minFaves?: number; display?: boolean; intervalSec?: number }
type Consumer = TopicLike & { collectedFor?: number };
export interface WatchSync {
  id: string; source: 'x' | 'rss' | 'hn' | 'youtube'; query: string; label: string; autoLabel?: boolean; list?: string; hnTag?: string; minPoints?: number; originalsOnly?: boolean; includeRetweets?: boolean;
  intervalSec: number; enabled: boolean; created: number; lastCheckedTs: number; checks: number; found: number; cost: number; lastRun: number; lastError: string; errors: number; nextRun: number; etag?: string; lastModified?: string;
  uses: Array<{ kind: string; id: string; label: string }>;
}
interface Fetched { id: string; ts: number; json: Record<string, unknown> }

export class CollectDO extends DurableObject<Env> {
  private inFlight = new Map<string, Promise<RunResult>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    setYoutubeKey(env.YOUTUBE_API_KEY);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, published INTEGER NOT NULL, first_seen INTEGER NOT NULL, likes INTEGER NOT NULL, json TEXT NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS items_published ON items (published)');
    sql.exec('CREATE INDEX IF NOT EXISTS items_first_seen ON items (first_seen)');
    sql.exec('CREATE TABLE IF NOT EXISTS item_sources (item TEXT NOT NULL, source TEXT NOT NULL, collected_at INTEGER NOT NULL, PRIMARY KEY (item, source)) WITHOUT ROWID');
    sql.exec('CREATE INDEX IF NOT EXISTS item_sources_source ON item_sources (source, item)');
    sql.exec('CREATE TABLE IF NOT EXISTS collection_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, at INTEGER NOT NULL, returned INTEGER NOT NULL, fresh INTEGER NOT NULL, cost REAL NOT NULL, hit_limit INTEGER NOT NULL, error TEXT NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS collection_runs_source ON collection_runs (source, at)');
    sql.exec('CREATE TABLE IF NOT EXISTS uses (consumer_kind TEXT NOT NULL, consumer_id TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (consumer_kind, consumer_id, source))');
    sql.exec('CREATE INDEX IF NOT EXISTS uses_source ON uses (source)');
    sql.exec('CREATE TABLE IF NOT EXISTS consumers (id TEXT PRIMARY KEY, data TEXT NOT NULL)');   // the briefings, as Publish last described them
    sql.exec('CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS comparisons (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, slug TEXT NOT NULL, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  // ---- storage helpers
  private getMeta<T>(k: string, fallback: T): T {
    const row = this.ctx.storage.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0];
    return row ? (JSON.parse(row.v) as T) : fallback;
  }
  private setMeta(k: string, v: unknown): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, JSON.stringify(v)); }
  /** Shadow until you switch: briefings keep fetching live, and every run compares that with what the store holds. */
  private mode(): CollectMode { return this.getMeta<CollectMode>('mode', 'shadow'); }
  private spent(): number { const s = this.getMeta('spend', { day: today(), cost: 0 }); return s.day === today() ? s.cost : 0; }
  private addSpend(c: number): void { this.setMeta('spend', { day: today(), cost: this.spent() + c }); }
  private cap(): number { return this.getMeta('dailyCap', 2); }
  private sources(): CollectSource[] { return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM sources').toArray().map((r) => JSON.parse(r.data) as CollectSource); }
  private source(id: string): CollectSource | undefined {
    const r = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM sources WHERE id = ?', id).toArray()[0];
    return r ? (JSON.parse(r.data) as CollectSource) : undefined;
  }
  private byKey(key: string): CollectSource | undefined {
    const r = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM sources WHERE key = ?', key).toArray()[0];
    return r ? (JSON.parse(r.data) as CollectSource) : undefined;
  }
  private saveSource(s: CollectSource): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO sources (id, key, data) VALUES (?, ?, ?)', s.id, s.key, JSON.stringify(s)); }
  private uses(): Use[] { return this.ctx.storage.sql.exec<Use & Record<string, string>>('SELECT consumer_kind, consumer_id, source, data FROM uses').toArray(); }
  private setUses(kind: string, id: string, rows: Array<{ source: string; data: UseData }>): void {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM uses WHERE consumer_kind = ? AND consumer_id = ?', kind, id);
    for (const r of rows) sql.exec('INSERT OR REPLACE INTO uses (consumer_kind, consumer_id, source, data) VALUES (?, ?, ?, ?)', kind, id, r.source, JSON.stringify(r.data));
  }
  private topics(): Consumer[] { return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM consumers').toArray().map((r) => JSON.parse(r.data) as Consumer); }
  private topic(slug: string): Consumer | undefined {
    const r = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM consumers WHERE id = ?', slug).toArray()[0];
    return r ? (JSON.parse(r.data) as Consumer) : undefined;
  }
  private saveTopic(t: Consumer): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO consumers (id, data) VALUES (?, ?)', t.slug, JSON.stringify(t)); }
  private newSource(kind: CollectKind, spec: SourceSpec, label: string, id = crypto.randomUUID().slice(0, 8)): CollectSource {
    return { id, key: sourceKey(kind, spec), kind, spec, label, created: Math.floor(Date.now() / 1000), baseSec: BRIEFING_POLL_SEC, checks: 0, found: 0, cost: 0, lastRun: 0, lastError: '', errors: 0, quiet: 0, nextRun: 0, lastCheckedTs: Math.floor(Date.now() / 1000), lastCost: 0, lastReturned: 0 };
  }

  private async lookups(): Promise<Lookups & { listHandles: Map<string, string[]> }> {
    const ask = async <T>(p: string) => {
      const r = await this.env.LISTS.getByName('main').fetch(new Request(`https://internal/lists/${p}`));
      if (!r.ok) throw new Error(`could not read lists (${r.status})`);
      return (await r.json()) as T;
    };
    const [xlists, lists, flists] = await Promise.all([ask<Lookups['xlists']>('x-all'), ask<Array<{ id: string; name: string; members: Array<{ handle: string; missing: boolean }> }>>('all'), ask<Lookups['flists']>('f-all')]);
    return { xlists, lists, flists, listHandles: new Map(lists.map((l) => [l.id, l.members.filter((m) => !m.missing).map((m) => m.handle)])) };
  }

  // ---- what is needed
  /** Schedules follow from the uses: the tightest wins, unless you pinned one. A source nothing uses stops being collected. */
  private replan(): void {
    const uses = this.uses(), by = new Map<string, Use[]>(), now = Date.now();
    for (const u of uses) (by.get(u.source) ?? by.set(u.source, []).get(u.source)!).push(u);
    for (const s of this.sources()) {
      const mine = by.get(s.id) ?? [];
      const intervals = mine.map((u) => (JSON.parse(u.data) as UseData).intervalSec).filter((v): v is number => !!v);
      const base = s.pinnedSec ?? (intervals.length ? Math.min(...intervals) : BRIEFING_POLL_SEC);
      const unusedSince = mine.length ? undefined : s.unusedSince ?? now;
      if (base !== s.baseSec || unusedSince !== s.unusedSince) {
        if (base < s.baseSec && s.nextRun > now + base * 1000) s.nextRun = now + base * 1000;   // a new, tighter use does not wait out the old schedule
        s.baseSec = base; s.unusedSince = unusedSince; this.saveSource(s);
      }
    }
  }
  private syncBriefing(t: TopicLike, l: Lookups): void {
    const prev = this.topic(t.slug), demands = demandsOf(t, l), rows = new Map<string, { source: string; data: UseData }>();
    for (const d of demands) {
      let s = this.byKey(d.key);
      if (!s) { s = this.newSource(d.kind, d.spec, d.label); this.saveSource(s); }
      else if (s.label !== d.label && !s.watch) { s.label = d.label; this.saveSource(s); }
      const had = rows.get(s.id)?.data;
      rows.set(s.id, { source: s.id, data: { label: t.title, part: d.part, pages: Math.max(d.pages, had?.pages ?? 0), minFaves: Math.min(d.minFaves, had?.minFaves ?? d.minFaves) } });
    }
    // A "Live feed" source reads what is watched: shown as a use of each, though it reads through the Monitor.
    t.sources.forEach((f, part) => {
      if (f.type !== 'feed') return;
      for (const s of this.sources()) if (s.watch && !rows.has(s.id) && matchesFeed(f, { id: s.watch, label: s.label, kind: s.kind })) rows.set(s.id, { source: s.id, data: { label: t.title, part, display: true } });
    });
    this.setUses('briefing', t.slug, [...rows.values()]);
    // Only what planning needs: Publish's own description of a topic also holds its issues.
    this.saveTopic({ slug: t.slug, title: t.title, enabled: t.enabled, toSignal: t.toSignal, signalGroup: t.signalGroup, sources: t.sources, intervalHours: t.intervalHours, nextRun: t.nextRun, maxCost: t.maxCost, ...(prev?.collectedFor ? { collectedFor: prev.collectedFor } : {}) });
  }
  private async rebuildBriefings(): Promise<void> {
    const topics = this.topics(); if (!topics.length) return;
    const l = await this.lookups();
    this.ctx.storage.transactionSync(() => { for (const t of topics) this.syncBriefing(t, l); this.replan(); });
  }
  /** The Monitor sends all its watches after every change. The first time, this takes over their checkpoints, so nothing is bought or shown twice. */
  private async syncMonitor(b: { watches: WatchSync[]; dailyCap: number; import?: boolean }): Promise<void> {
    if (Number.isFinite(b.dailyCap)) this.setMeta('dailyCap', b.dailyCap);
    const keep = new Set<string>(), backlog: string[] = [];
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM uses WHERE consumer_kind != 'briefing'");
      for (const w of b.watches) {
        const kind: CollectKind = w.source === 'x' ? 'x_watch' : w.source;
        const spec: SourceSpec = w.source === 'x' ? { query: w.query, originalsOnly: !!w.originalsOnly, includeRetweets: !!w.includeRetweets } : w.source === 'hn' ? { query: w.query, hnTag: w.hnTag ?? 'front_page', minPoints: w.minPoints ?? 0 } : { query: w.query };
        let s = this.byKey(sourceKey(kind, spec));
        if (!s) {
          s = this.newSource(kind, spec, w.label, w.id);
          s.created = w.created; s.lastCheckedTs = w.lastCheckedTs;
          if (b.import && w.checks > 0) Object.assign(s, { adopted: true, checks: w.checks, found: w.found, cost: w.cost, lastRun: w.lastRun, lastError: w.lastError, errors: w.errors, nextRun: w.nextRun, etag: w.etag, lastModified: w.lastModified });
        } else if (s.watch !== w.id && s.checks > 0) backlog.push(s.id);   // collected for a briefing until now: show its latest in the Live feed
        if (s.paused && w.enabled) { s.errors = 0; s.lastError = ''; s.nextRun = 0; }
        Object.assign(s, { watch: w.id, label: w.label, autoLabel: w.autoLabel, list: w.list, watchSec: w.intervalSec, paused: !w.enabled });
        this.saveSource(s); keep.add(s.id);
        for (const u of w.uses) this.ctx.storage.sql.exec('INSERT OR REPLACE INTO uses (consumer_kind, consumer_id, source, data) VALUES (?, ?, ?, ?)', u.kind, u.id, s.id, JSON.stringify({ label: u.label, intervalSec: w.intervalSec } satisfies UseData));
      }
      for (const s of this.sources()) if (s.watch && !keep.has(s.id)) { delete s.watch; delete s.list; delete s.watchSec; this.saveSource(s); }
      this.replan();
      for (const id of backlog) this.enqueueBacklog(id);
    });
    if (!this.getMeta('topicsPulled', false)) {   // the first time: learn the briefings, without waiting for one to be saved or to run
      const r = await this.env.PUBLISH.getByName('main').fetch(new Request('https://internal/adm/topics'));
      if (r.ok) {
        const l = await this.lookups(), topics = (await r.json()) as TopicLike[];
        this.ctx.storage.transactionSync(() => { for (const t of topics) this.syncBriefing(t, l); this.setMeta('topicsPulled', true); });
      }
    }
    await this.rebuildBriefings();
  }

  // ---- fetching one source
  /** Reads one source and stores what it returned. One at a time per source: a second caller waits for the first and shares its result. */
  private run(s0: CollectSource, o: RunOptions = {}): Promise<RunResult> {
    const busy = this.inFlight.get(s0.id);
    if (busy) return busy;
    const p = this.doRun(s0.id, o).finally(() => this.inFlight.delete(s0.id));
    this.inFlight.set(s0.id, p);
    return p;
  }
  private xSources(meter: ReturnType<typeof newMeter>): Sources {
    const real = workerSources(this.env, meter);
    return this.env.SUMMARY_MOCK === '1' ? mockX(real, meter) : real;
  }
  private async fetchPoll(s: CollectSource, since: number): Promise<{ items: Fetched[]; cache?: { etag?: string; lastModified?: string }; title?: string }> {
    const r: { items: Parameters<typeof toFeedShape>[0][]; cache?: { etag?: string; lastModified?: string }; title?: string } = s.kind === 'hn'
      ? await fetchHn({ tag: (s.spec.hnTag ?? 'front_page') as HnTag, query: s.spec.query || undefined, minPoints: s.spec.minPoints, since })
      : await fetchRss({ url: s.spec.query ?? '', etag: s.etag, lastModified: s.lastModified });
    return { items: r.items.map((i) => ({ id: i.id, ts: Date.parse(i.at), json: toFeedShape(i) as unknown as Record<string, unknown> })), cache: r.cache, title: r.title };
  }
  /** An X search from its checkpoint, page by page; duplicates are dropped when stored. */
  private async fetchWatch(s: CollectSource, since: number, meter: ReturnType<typeof newMeter>): Promise<{ items: Fetched[]; truncated: boolean }> {
    const base = [s.spec.query, s.spec.originalsOnly && '-filter:replies', s.spec.includeRetweets && 'include:nativeretweets'].filter(Boolean).join(' ');
    const items: Fetched[] = []; let cursor = '', pages = 0, truncated = false;
    while (pages < WATCH_PAGES) {
      if (meter.cap !== undefined && meter.cost + tweetCallCost(PAGE_TWEETS) > meter.cap) { meter.capped = true; break; }
      const r = await search({ key: this.env.TWITTERAPI_IO_KEY, query: `${base} since_time:${since}`, cursor });
      const tweets = r.tweets ?? []; pages++; bill(meter, tweets.length);
      for (const t of tweets) items.push({ id: t.id, ts: Date.parse(t.createdAt), json: slim(t) as unknown as Record<string, unknown> });
      if (!r.has_next_page || !r.next_cursor || !tweets.length) break;
      if (pages === WATCH_PAGES) truncated = true;
      cursor = r.next_cursor;
    }
    return { items, truncated };
  }
  private async fetchWindow(s: CollectSource, hours: number, pages: number, minFaves: number, meter: ReturnType<typeof newMeter>): Promise<Fetched[]> {
    const sources = this.xSources(meter);
    const spec = s.kind === 'x_list' ? { type: 'xlist' as const, listIds: [s.spec.listId ?? ''], hours, pages, mode: s.spec.mode ?? 'best', minFaves }
      : s.kind === 'x_accounts' ? { type: 'list' as const, listId: s.spec.listId ?? '', hours }
      : { type: 'search' as const, query: `${s.spec.query} since_time:${Math.floor(Date.now() / 1000 - hours * 3600)}`, sort: s.spec.sort ?? 'Latest' as const, pages };
    const r = await fetchSource(sources, spec);
    return r.tweets.filter((t) => t?.id).map((t) => ({ id: String(t.id), ts: Date.parse(t.createdAt ?? ''), json: slim(t as unknown as Tweet) as unknown as Record<string, unknown> }));
  }
  private async doRun(id: string, o: RunOptions): Promise<RunResult> {
    const s0 = this.source(id);
    if (!s0) return { fresh: 0, cost: 0, tweets: 0, error: 'unknown source' };
    const paid = isPaid(s0.kind), strategy = strategyOf(s0.kind), started = Date.now(), startTs = Math.floor(started / 1000);
    const room = this.cap() - this.spent(), limit = Math.min(paid ? Math.max(0, room) : Infinity, o.budget ?? Infinity);
    const meter = newMeter(paid && Number.isFinite(limit) ? Math.max(limit, 1e-9) : undefined);
    const since = Math.max(s0.lastCheckedTs - OVERLAP, s0.created - 1);
    let items: Fetched[] = [], error = '', fatal = false, cache: { etag?: string; lastModified?: string } | undefined, title: string | undefined, outOfCredits = false;
    const hours = o.hours ?? 24, pages = o.pages ?? 1, minFaves = o.minFaves ?? 0;
    try {
      if (paid && limit <= 0) { meter.capped = true; throw new Error('the daily X data cap is reached'); }
      if (strategy === 'poll') { const r = await this.fetchPoll(s0, since); items = r.items; cache = r.cache; title = r.title; }
      else if (strategy === 'incremental') { const r = await this.fetchWatch(s0, since, meter); items = r.items; if (r.truncated) error = `burst larger than ${WATCH_PAGES * PAGE_TWEETS} tweets; some may be missed`; }
      else items = await this.fetchWindow(s0, hours, pages, minFaves, meter);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err); fatal = true;
      outOfCredits = err instanceof OutOfCredits || error.startsWith('Out of credits');
    }
    const cost = meter.cost, now = Date.now(), hit = !fatal && strategy === 'window' && hitLimit(s0.kind, s0.spec, items.length, pages);
    const sql = this.ctx.storage.sql;
    let freshCount = 0;
    this.ctx.storage.transactionSync(() => {
      const s = this.source(id) ?? s0;   // merge onto the latest copy: it may have been paused or edited while this was fetching
      const fresh: Fetched[] = [];
      for (const f of items) {
        const ts = Number.isFinite(f.ts) ? Math.min(f.ts, now) : now, likes = Number(f.json.likeCount) || 0;
        sql.exec('INSERT INTO items (id, kind, published, first_seen, likes, json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET likes = excluded.likes, json = excluded.json', f.id, itemKind(s.kind), ts, now, likes, JSON.stringify(f.json));
        if (sql.exec('SELECT 1 FROM item_sources WHERE item = ? AND source = ?', f.id, id).toArray().length) continue;
        sql.exec('INSERT INTO item_sources (item, source, collected_at) VALUES (?, ?, ?)', f.id, id, now);
        fresh.push(f);
      }
      // The first read after taking a watch over: only what appeared since its last check is news. The rest is stored, but the Live feed and Signal already have it.
      const news = s.adopted && !fatal ? fresh.filter((f) => !Number.isFinite(f.ts) || f.ts >= (s.lastCheckedTs - 3600) * 1000) : fresh;
      if (!fatal) delete s.adopted;
      freshCount = news.length;
      s.lastRun = now; s.lastError = error; s.cost += cost; s.found += news.length;
      if (fatal) { if (!meter.capped) s.errors++; if (outOfCredits) s.paused = true; }
      else {
        s.errors = 0; s.checks++; s.lastCheckedTs = startTs; s.quiet = news.length ? 0 : s.quiet + 1; s.lastReturned = items.length; s.lastHitLimit = hit;
        if (strategy === 'window') {
          s.lastCost = cost;
          // A read the cap cut short does not count as covering the period: the next run tries again.
          if (!meter.capped) s.covered = { from: started - hours * 3_600_000, to: started, pages, minFaves };
        }
        if (cache) { s.etag = cache.etag; s.lastModified = cache.lastModified; }
        if (s.autoLabel && title) { s.label = title.slice(0, 60); s.autoLabel = false; }
      }
      s.nextRun = now + nextDelaySec({ baseSec: s.baseSec, errors: fatal ? Math.max(1, s.errors) : 0, quiet: s.quiet, paid, pinned: !!s.pinnedSec }) * 1000;
      this.saveSource(s);
      sql.exec('INSERT INTO collection_runs (source, at, returned, fresh, cost, hit_limit, error) VALUES (?, ?, ?, ?, ?, ?, ?)', id, now, items.length, news.length, cost, hit ? 1 : 0, error.slice(0, 300));
      if (cost) this.addSpend(cost);
      this.enqueue(s, news.sort((a, b) => a.ts - b.ts), s0.checks === 0);
    });
    if (cost || meter.calls) await recordCost(this.env, { kind: 'collect', ref: id, label: s0.label, twitter: cost, tweets: meter.tweets, calls: meter.calls });
    return { fresh: freshCount, cost, tweets: meter.tweets, error, capped: meter.capped };
  }

  // ---- handing items on
  private annotate(s: CollectSource, j: Record<string, unknown>): Record<string, unknown> {
    return itemKind(s.kind) === 'x' ? j : { ...j, feed: s.label, feedUrl: s.kind === 'hn' ? 'https://news.ycombinator.com/' : s.spec.query };
  }
  private statusOf(s: CollectSource) {
    return { enabled: !s.paused, label: s.label, autoLabel: !!s.autoLabel, checks: s.checks, found: s.found, cost: s.cost, lastRun: s.lastRun, lastError: s.lastError, errors: s.errors, nextRun: s.nextRun, lastCheckedTs: s.lastCheckedTs };
  }
  /** Queues what the Monitor should know. Must run inside the transaction that stored the items, so a crash cannot lose them. */
  private enqueue(s: CollectSource, fresh: Fetched[], first: boolean): void {
    const sql = this.ctx.storage.sql;
    if (s.watch) {
      const shown = first && strategyOf(s.kind) === 'poll' ? fresh.slice(-FIRST_CHECK_ITEMS) : fresh;
      sql.exec('INSERT INTO outbox (data) VALUES (?)', JSON.stringify({ watch: s.watch, status: this.statusOf(s), found: shown.map((f) => ({ id: f.id, ts: f.ts, json: this.annotate(s, f.json) })) }));
    }
  }
  private enqueueBacklog(id: string): void {
    const s = this.source(id); if (!s?.watch) return;
    const rows = this.ctx.storage.sql.exec<{ id: string; published: number; json: string }>('SELECT i.id, i.published, i.json FROM items i JOIN item_sources x ON x.item = i.id WHERE x.source = ? ORDER BY i.published DESC LIMIT ?', id, FIRST_CHECK_ITEMS).toArray();
    this.enqueue(s, rows.reverse().map((r) => ({ id: r.id, ts: r.published, json: JSON.parse(r.json) as Record<string, unknown> })), false);
  }
  private async drain(): Promise<void> {
    const sql = this.ctx.storage.sql;
    for (;;) {
      const rows = sql.exec<{ seq: number; data: string }>('SELECT seq, data FROM outbox ORDER BY seq LIMIT ?', OUTBOX_BATCH).toArray();
      // Nothing to deliver, but the spend moved (a source only a briefing reads): the Monitor's spend figure still has to follow.
      if (!rows.length && this.getMeta('spendSent', -1) === this.spent()) return;
      const res = await this.env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/collected', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deliveries: rows.map((r) => JSON.parse(r.data) as unknown), spend: { day: today(), cost: this.spent() } }) }));
      if (!res.ok) throw new Error(`the Monitor refused a delivery (${res.status})`);
      this.setMeta('spendSent', this.spent());
      if (!rows.length) return;
      sql.exec('DELETE FROM outbox WHERE seq <= ?', rows[rows.length - 1].seq);
    }
  }

  // ---- a briefing's data
  /** Makes sure a briefing's sources are collected: X windows unless a recent read still covers them, free feeds unless they were just read. */
  private async collectTopic(t: Consumer, hours: number): Promise<{ capped: boolean; charged: number; tweets: number }> {
    const rows = this.ctx.storage.sql.exec<{ source: string; data: string }>("SELECT source, data FROM uses WHERE consumer_kind = 'briefing' AND consumer_id = ?", t.slug).toArray().filter((u) => !(JSON.parse(u.data) as UseData).display);
    // A shared source is read deep enough for every briefing that uses it.
    const all = this.uses().filter((u) => u.consumer_kind === 'briefing').map((u) => ({ source: u.source, ...(JSON.parse(u.data) as UseData) })).filter((u) => !u.display);
    const now = Date.now(); let capped = false, charged = 0, tweets = 0, budget = t.maxCost ? t.maxCost : Infinity;
    const jobs = rows.map((u) => this.source(u.source)).filter((s): s is CollectSource => !!s && !s.paused).filter((s) => {
      if (strategyOf(s.kind) === 'window') {
        const d = mergeDepth(all.filter((u) => u.source === s.id).map((u) => ({ pages: u.pages ?? 1, minFaves: u.minFaves ?? 0 })));
        return !canReuse(s.covered, { hours, ...d }, now);
      }
      if (s.errors > 0 && s.nextRun > now) return false;   // it failed and is backing off: what is stored is what there is
      return now - s.lastRun > POLL_RECENT_MS;
    });
    const width = t.maxCost ? 1 : WIDTH;
    for (let i = 0; i < jobs.length; i += width) {
      const results = await Promise.all(jobs.slice(i, i + width).map((s) => {
        const d = mergeDepth(all.filter((u) => u.source === s.id).map((u) => ({ pages: u.pages ?? 1, minFaves: u.minFaves ?? 0 })));
        return this.run(s, { hours, ...d, budget: strategyOf(s.kind) === 'window' ? budget : undefined });
      }));
      for (const r of results) { charged += r.cost; tweets += r.tweets; budget -= r.cost; if (r.capped) capped = true; }
    }
    return { capped, charged, tweets };
  }
  /** What a briefing reads: from each of its sources, what that use asked for, reported per topic source the way a live fetch reports it. */
  private async readTopic(t: Consumer, hours: number, l: Awaited<ReturnType<CollectDO['lookups']>>) {
    const sql = this.ctx.storage.sql, now = Date.now(), demands = demandsOf(t, l);
    const sources = new Map(demands.map((d) => [d.key, this.byKey(d.key)] as const));
    const live = [...sources.values()].filter((s): s is CollectSource => !!s && strategyOf(s.kind) === 'window').map((s) => s.covered).filter((c) => c && c.to >= now - reuseMs(hours));
    const since = readSince(live, hours, now);
    const briefingsOf = new Map<string, number>();
    for (const u of this.uses()) if (u.consumer_kind === 'briefing' && !(JSON.parse(u.data) as UseData).display) briefingsOf.set(u.source, (briefingsOf.get(u.source) ?? 0) + 1);
    const items: Array<Record<string, unknown>> = [], infos: Array<Record<string, unknown>> = [], failed: string[] = []; let allocated = 0, oldest = now;
    const counted = new Set<string>();
    t.sources.forEach((src, part) => {
      if (src.type === 'feed') return;
      const mine = demands.filter((d: Demand) => d.part === part), lists: Array<{ id?: string; label: string; count: number; mode?: string; minFaves?: number }> = [];
      let got: StoredItem[] = [];
      for (const d of mine) {
        const s = sources.get(d.key); if (!s) continue;
        if (s.lastError) failed.push(s.label);
        if (strategyOf(s.kind) === 'window') {
          oldest = Math.min(oldest, s.covered?.to ?? 0);
          if (!counted.has(s.id)) { counted.add(s.id); allocated += allocate(s.lastCost, briefingsOf.get(s.id) ?? 1); }
        }
        const rows = sql.exec<{ id: string; published: number; likes: number; json: string }>('SELECT i.id, i.published, i.likes, i.json FROM items i JOIN item_sources x ON x.item = i.id WHERE x.source = ? AND i.published >= ?', s.id, since).toArray();
        const sel = selectForUse(rows.map((r) => ({ id: r.id, ts: r.published, likes: r.likes, json: this.annotate(s, JSON.parse(r.json) as Record<string, unknown>) })), d, since);
        lists.push({ id: s.spec.listId, label: s.label, count: sel.length });
        got.push(...sel);
      }
      if (src.type === 'flist') got = dedupeByAddress(got.sort((a, b) => b.ts - a.ts)).slice(0, ITEMS_PER_FLIST);
      items.push(...got.map((g) => g.json));
      const how = src.type === 'xlist' || src.type === 'xgroup' ? { mode: src.mode ?? 'best', minFaves: src.minFaves ?? 5 } : {};
      if (src.type === 'xgroup') infos.push({ kind: 'xgroup', label: src.group, count: got.length, ...how, lists: lists.map((p) => ({ id: p.id, label: p.label, count: p.count })) });
      else if (src.type === 'xlist') infos.push({ kind: 'xlist', id: src.listId, label: lists[0]?.label ?? src.listId, count: got.length, ...how });
      else if (src.type === 'list') { const h = l.listHandles.get(src.listId) ?? []; infos.push({ kind: 'list', label: l.lists.find((x) => x.id === src.listId)?.name ?? 'List', count: got.length, accounts: h.length, handles: h.slice(0, 100) }); }
      else if (src.type === 'flist') infos.push({ kind: 'flist', label: l.flists.find((x) => x.id === src.listId)?.name ?? 'Feed list', count: got.length });
      else infos.push({ kind: 'search', label: src.query, count: got.length });
    });
    return { since, items, infos, failed: [...new Set(failed)], allocated, collectedAt: oldest };
  }

  // ---- the schedule
  private reservedToday(): number {
    const now = Date.now(); let sum = 0;
    for (const t of this.topics()) {
      if (!t.enabled || t.collectedFor === t.nextRun || t.nextRun > now + 86_400_000) continue;
      for (const u of this.ctx.storage.sql.exec<{ source: string }>("SELECT source FROM uses WHERE consumer_kind = 'briefing' AND consumer_id = ?", t.slug).toArray()) sum += this.source(u.source)?.lastCost ?? 0;
    }
    return sum;
  }
  private pollable(uses: Use[]): CollectSource[] {
    const used = new Set(uses.map((u) => u.source));
    return this.sources().filter((s) => used.has(s.id) && !s.paused && strategyOf(s.kind) !== 'window');
  }
  private windowTopics(): Consumer[] {
    if (this.mode() === 'off') return [];
    const paid = new Set(this.sources().filter((s) => strategyOf(s.kind) === 'window').map((s) => s.id));
    const has = new Set(this.uses().filter((u) => u.consumer_kind === 'briefing' && paid.has(u.source)).map((u) => u.consumer_id));
    return this.topics().filter((t) => t.enabled && has.has(t.slug) && t.collectedFor !== t.nextRun && t.nextRun > 0);
  }
  private async arm(): Promise<void> {
    const now = Date.now(), outbox = this.ctx.storage.sql.exec('SELECT 1 FROM outbox LIMIT 1').toArray().length > 0;
    const capLeft = incrementalAllowed(this.spent(), this.cap(), this.reservedToday());
    const polls = this.pollable(this.uses()).map((s) => (strategyOf(s.kind) === 'incremental' && !capLeft ? Math.max(s.nextRun, now + 600_000) : s.nextRun));
    const topics = this.windowTopics().map((t) => t.nextRun - LEAD_MS);
    const house = Date.parse(today() + 'T00:00:00Z') + 86_400_000 + 300_000;   // shortly after midnight UTC
    const next = Math.min(house, ...polls, ...topics, outbox ? now + 60_000 : Infinity);
    await this.ctx.storage.setAlarm(Math.max(next, now + 1000));
  }
  async alarm(): Promise<void> {
    try {
      const now = Date.now();
      // One briefing per alarm: each invocation has its own budget of outgoing requests. The next alarm comes a second later for whichever is still due.
      const due = this.windowTopics().filter((t) => t.nextRun - LEAD_MS <= now).sort((a, b) => a.nextRun - b.nextRun)[0];
      if (due) {
        const r = await this.collectTopic(due, due.intervalHours);
        const cur = this.topic(due.slug);
        if (cur) this.saveTopic({ ...cur, collectedFor: due.nextRun });
        if (r.capped) console.warn('collection capped', due.slug);
      } else {
        const capLeft = incrementalAllowed(this.spent(), this.cap(), this.reservedToday());
        const polls = this.pollable(this.uses()).filter((s) => s.nextRun <= now && (strategyOf(s.kind) !== 'incremental' || capLeft)).sort((a, b) => a.nextRun - b.nextRun).slice(0, POLLS_PER_ALARM);
        for (let i = 0; i < polls.length; i += WIDTH) await Promise.all(polls.slice(i, i + WIDTH).map((s) => this.run(s)));
      }
      await this.drain();
      await this.housekeeping();
    } catch (err) {
      console.error('collection alarm failed', err instanceof Error ? err.message : String(err));
    } finally {
      await this.arm();   // always re-arm, or one bad run would stop every schedule
    }
  }
  /** Once a day: forget what is past its time, and follow any changes to the lists behind the sources. */
  private async housekeeping(): Promise<void> {
    if (this.getMeta('housekept', '') === today()) return;
    const sql = this.ctx.storage.sql, floor = Date.now() - KEEP_MS;
    this.ctx.storage.transactionSync(() => {
      sql.exec('DELETE FROM item_sources WHERE item IN (SELECT id FROM items WHERE first_seen < ?)', floor);
      sql.exec('DELETE FROM items WHERE first_seen < ?', floor);
      sql.exec('DELETE FROM collection_runs WHERE at < ?', floor);
      sql.exec('DELETE FROM comparisons WHERE seq <= (SELECT MAX(seq) FROM comparisons) - 200');
      this.setMeta('housekept', today());
    });
    await this.rebuildBriefings();
  }

  // ---- what the admin sees
  private overview() {
    const sql = this.ctx.storage.sql, since = Date.now() - 7 * 86_400_000, uses = this.uses();
    const stats = new Map(sql.exec<{ source: string; runs: number; returned: number; fresh: number; cost: number; hits: number; fails: number }>(
      "SELECT source, COUNT(*) AS runs, SUM(returned) AS returned, SUM(fresh) AS fresh, SUM(cost) AS cost, SUM(hit_limit) AS hits, SUM(error != '') AS fails FROM collection_runs WHERE at >= ? GROUP BY source", since).toArray().map((r) => [r.source, r] as const));
    const stored = new Map(sql.exec<{ source: string; n: number }>('SELECT source, COUNT(*) AS n FROM item_sources GROUP BY source').toArray().map((r) => [r.source, r.n] as const));
    const byBriefing = new Map<string, number>(), usedBy = new Map<string, Array<{ kind: string; id: string; label: string }>>();
    for (const u of uses) {
      const d = JSON.parse(u.data) as UseData;
      (usedBy.get(u.source) ?? usedBy.set(u.source, []).get(u.source)!).push({ kind: u.consumer_kind, id: u.consumer_id, label: d.label });
      if (u.consumer_kind === 'briefing' && !d.display) byBriefing.set(u.source, (byBriefing.get(u.source) ?? 0) + 1);
    }
    const consumerCost = new Map<string, { kind: string; id: string; label: string; sources: number; cost7d: number; costPerRun: number }>();
    const sources = this.sources().map((s) => {
      const st = stats.get(s.id), by = usedBy.get(s.id) ?? [], cost7d = st?.cost ?? 0, users = byBriefing.get(s.id) ?? 0;
      for (const u of by) {
        const k = `${u.kind}:${u.id}`, c = consumerCost.get(k) ?? consumerCost.set(k, { kind: u.kind, id: u.id, label: u.label, sources: 0, cost7d: 0, costPerRun: 0 }).get(k)!;
        c.sources++;
        if (u.kind === 'briefing' && users) { c.cost7d += allocate(cost7d, users); c.costPerRun += allocate(s.lastCost, users); }
      }
      return { id: s.id, kind: s.kind, itemKind: itemKind(s.kind), strategy: strategyOf(s.kind), label: s.label, query: s.spec.query ?? s.spec.listId ?? '', mode: s.spec.mode, watch: s.watch ?? null,
        state: !by.length ? 'unused' : s.paused ? 'paused' : s.errors || (s.lastError && strategyOf(s.kind) === 'window') ? 'failing' : 'active',
        baseSec: s.baseSec, pinnedSec: s.pinnedSec ?? null, nextRun: s.nextRun, unusedSince: s.unusedSince ?? null,
        lastRun: s.lastRun, lastError: s.lastError, errors: s.errors, quiet: s.quiet, lastReturned: s.lastReturned, lastCost: s.lastCost, lastHitLimit: !!s.lastHitLimit,
        coveredTo: s.covered?.to ?? null, stored: stored.get(s.id) ?? 0, cost: s.cost,
        week: { runs: st?.runs ?? 0, returned: st?.returned ?? 0, fresh: st?.fresh ?? 0, cost: cost7d, hitLimit: st?.hits ?? 0, failures: st?.fails ?? 0 }, usedBy: by };
    });
    const comparisons = sql.exec<{ at: number; slug: string; data: string }>('SELECT at, slug, data FROM comparisons ORDER BY seq DESC LIMIT 40').toArray().map((r) => ({ at: r.at, slug: r.slug, ...(JSON.parse(r.data) as object) }));
    const items = sql.exec<{ n: number; oldest: number | null }>('SELECT COUNT(*) AS n, MIN(first_seen) AS oldest FROM items').one();
    return { mode: this.mode(), modes: MODES, spend: { today: this.spent(), dailyCap: this.cap(), reserved: this.reservedToday() }, keepDays: KEEP_MS / 86_400_000, items, sources, consumers: [...consumerCost.values()], comparisons };
  }
  /** Members of a feed list that has watches, which themselves have none. Shown with one click to add: a watch you removed on purpose should not come back by itself. */
  private async drift() {
    const l = await this.lookups(), sources = this.sources(), out: Array<{ list: string; listName: string; source: string; query: string; label: string; hnTag?: string; minPoints?: number }> = [];
    const watchedLists = new Set(sources.filter((s) => s.watch && s.list).map((s) => s.list));
    for (const f of l.flists) {
      if (!watchedLists.has(f.id)) continue;
      for (const m of f.members) {
        const spec: SourceSpec = m.source === 'hn' ? { query: m.query, hnTag: m.hnTag ?? 'front_page', minPoints: m.minPoints ?? 0 } : { query: m.query };
        if (!this.byKey(sourceKey(m.source, spec))?.watch) out.push({ list: f.id, listName: f.name, source: m.source, query: m.query, label: m.label, ...(m.source === 'hn' ? { hnTag: m.hnTag, minPoints: m.minPoints } : {}) });
      }
    }
    return out;
  }
  /** Everything collected, newest first, filtered by source, kind, a consumer ("briefing:ai"), words and period. */
  private browse(q: URLSearchParams) {
    const sql = this.ctx.storage.sql, limit = Math.min(BROWSE_MAX, Math.max(1, Number(q.get('limit')) || 50)), offset = Math.max(0, Number(q.get('offset')) || 0);
    const where: string[] = [], args: Array<string | number> = [];
    const source = q.get('source') ?? '', kind = q.get('kind') ?? '', text = (q.get('q') ?? '').trim().slice(0, 100), days = Math.min(KEEP_MS / 86_400_000, Number(q.get('days')) || 0), consumer = q.get('consumer') ?? '';
    if (source) { where.push('i.id IN (SELECT item FROM item_sources WHERE source = ?)'); args.push(source); }
    if (kind) { where.push('i.kind = ?'); args.push(kind); }
    if (days > 0) { where.push('i.published >= ?'); args.push(Date.now() - days * 86_400_000); }
    if (text) { where.push("i.json LIKE ? ESCAPE '\\'"); args.push(`%${text.replace(/[\\%_]/g, '\\$&')}%`); }
    if (consumer) {
      const i = consumer.indexOf(':');
      where.push('i.id IN (SELECT x.item FROM item_sources x JOIN uses u ON u.source = x.source WHERE u.consumer_kind = ? AND u.consumer_id = ?)'); args.push(consumer.slice(0, i), consumer.slice(i + 1));
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM items i ${w}`, ...args).one().n;
    const rows = sql.exec<{ id: string; kind: string; published: number; first_seen: number; likes: number; json: string }>(`SELECT i.id, i.kind, i.published, i.first_seen, i.likes, i.json FROM items i ${w} ORDER BY i.published DESC LIMIT ? OFFSET ?`, ...args, limit, offset).toArray();
    const labels = new Map(this.sources().map((s) => [s.id, s.label] as const));
    return { total, offset, limit, items: rows.map((r) => {
      const j = JSON.parse(r.json) as { url?: string; text?: string; title?: string; author?: { userName?: string; name?: string }; replyCount?: number; retweetCount?: number; viewCount?: number; discussionUrl?: string };
      const from = sql.exec<{ source: string }>('SELECT source FROM item_sources WHERE item = ?', r.id).toArray().map((x) => ({ id: x.source, label: labels.get(x.source) ?? x.source }));
      return { id: r.id, kind: r.kind, publishedAt: r.published, firstSeen: r.first_seen, likes: r.likes, replies: j.replyCount ?? 0, retweets: j.retweetCount ?? 0, views: j.viewCount ?? 0,
        title: j.title ?? '', text: String(j.text ?? '').slice(0, 600), url: j.url ?? (r.kind === 'x' && j.author?.userName ? `https://x.com/${j.author.userName}/status/${r.id}` : ''), discussionUrl: j.discussionUrl ?? '', by: j.author?.userName ?? j.author?.name ?? '', sources: from };
    }) };
  }
  /** What a briefing would add: its sources, whether each is already collected, and what the new ones cost. */
  private async estimate(b: { sources?: unknown; intervalHours?: unknown; maxCost?: unknown; slug?: unknown }) {
    const l = await this.lookups(), t = { sources: (Array.isArray(b.sources) ? b.sources : []) as TopicLike['sources'], maxCost: Number(b.maxCost) || 0 };
    const interval = Number(b.intervalHours) || 24, slug = String(b.slug ?? ''), uses = this.uses();
    const rows = demandsOf(t, l).map((d) => {
      const s = this.byKey(d.key), others = s ? uses.filter((u) => u.source === s.id && !(u.consumer_kind === 'briefing' && u.consumer_id === slug)) : [];
      const pagesCost = d.kind === 'x_list' ? d.pages * (d.spec.mode === 'latest' ? 80 : PAGE_TWEETS) * tweetCallCost(1) : isPaid(d.kind) ? d.pages * PAGE_TWEETS * tweetCallCost(1) : 0;
      const collected = others.length > 0;
      return { label: d.label, kind: d.kind, collected, usedBy: others.map((u) => (JSON.parse(u.data) as UseData).label), addedPerRun: collected || !isPaid(d.kind) ? 0 : s?.lastCost || pagesCost };
    });
    const addedPerRun = rows.reduce((n, r) => n + r.addedPerRun, 0);
    return { rows, addedPerRun, addedPerDay: (addedPerRun * 24) / interval };
  }

  // ---- HTTP (internal: the Worker, the Monitor and Publish are the only callers)
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), name = url.pathname.replace(/^\/collect\//, '');
    try {
      if (request.method === 'GET') {
        if (name === 'overview') return json({ ...this.overview(), drift: await this.drift().catch(() => []) });
        if (name === 'items') return json(this.browse(url.searchParams));
        return json({ error: 'unknown collection route' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'GET or POST required' }, 405);
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      if (name === 'sync-monitor') { await this.syncMonitor(b as unknown as Parameters<CollectDO['syncMonitor']>[0]); await this.drain().catch(() => {}); await this.arm(); return json({ ok: true }); }
      if (name === 'sync-briefing') {
        if (typeof b.delete === 'string') {
          const slug = b.delete;
          this.ctx.storage.transactionSync(() => { this.setUses('briefing', slug, []); this.ctx.storage.sql.exec('DELETE FROM consumers WHERE id = ?', slug); this.replan(); });
        } else {
          const l = await this.lookups();
          this.ctx.storage.transactionSync(() => { this.syncBriefing(b.topic as TopicLike, l); this.replan(); });
        }
        await this.arm();
        return json({ ok: true });
      }
      if (name === 'ensure') {   // a briefing is about to run
        const mode = this.mode();
        if (mode === 'off') return json({ mode });
        const l = await this.lookups(), hours = Number(b.hours) || 24, t0 = b.topic as TopicLike;
        this.ctx.storage.transactionSync(() => { this.syncBriefing(t0, l); this.replan(); });
        const t = this.topic(t0.slug)!, got = await this.collectTopic(t, hours);
        if (t.nextRun && t.nextRun - LEAD_MS <= Date.now()) this.saveTopic({ ...t, collectedFor: t.nextRun });
        const read = await this.readTopic(t, hours, l);
        // Briefings that count in Signal hand over what they read, at the moment they read it. The Monitor keeps each as one feed under the group you named, so a score does not depend on how many lists a briefing reads, and its seen ids drop what a re-run repeats.
        if (mode === 'store' && t.toSignal && read.items.length) this.ctx.storage.sql.exec('INSERT INTO outbox (data) VALUES (?)', JSON.stringify({ briefing: { slug: t.slug, title: t.title, group: t.signalGroup || t.title }, posts: read.items.slice(0, MAX_ITEMS_TO_MONITOR) }));
        await this.drain().catch((err) => console.error('delivery failed', err instanceof Error ? err.message : String(err)));
        await this.arm();
        return json({ mode, ...read, ...got });
      }
      if (name === 'compare') {   // shadow mode: what a run's live fetch found
        const live = (Array.isArray(b.live) ? b.live : []).map(String), store = (Array.isArray(b.store) ? b.store : []).map(String);
        this.ctx.storage.sql.exec('INSERT INTO comparisons (at, slug, data) VALUES (?, ?, ?)', Date.now(), String(b.slug ?? '').slice(0, 40), JSON.stringify({ ...compareSets(live, store), liveCost: Number(b.liveCost) || 0, storeCost: Number(b.storeCost) || 0 }));
        return json({ ok: true });
      }
      if (name === 'check') {   // the Live feed's "check now", by watch
        const s = this.sources().find((x) => x.watch === String(b.watch ?? ''));
        if (s) { s.nextRun = 0; s.errors = 0; this.saveSource(s); await this.arm(); }
        return json({ ok: true });
      }
      if (name === 'estimate') return json(await this.estimate(b));
      if (name === 'settings') {
        if (!MODES.includes(b.mode as CollectMode)) throw new Error('unknown mode');
        this.setMeta('mode', b.mode); await this.arm();
        return json(this.overview());
      }
      if (name === 'source') {
        const s = this.source(String(b.id ?? ''));
        if (!s) return json({ error: 'unknown source' }, 404);
        if (b.action === 'delete') {
          if (this.uses().some((u) => u.source === s.id)) throw new Error('that source is still in use');
          this.ctx.storage.transactionSync(() => { this.ctx.storage.sql.exec('DELETE FROM sources WHERE id = ?', s.id); this.ctx.storage.sql.exec('DELETE FROM item_sources WHERE source = ?', s.id); this.ctx.storage.sql.exec('DELETE FROM collection_runs WHERE source = ?', s.id); });
          return json(this.overview());
        }
        if (b.action === 'pause') s.paused = true;
        else if (b.action === 'resume') { s.paused = false; s.errors = 0; s.nextRun = 0; }
        else if (b.action === 'pin') { const v = Math.min(86_400, Math.max(15, Math.floor(Number(b.intervalSec)) || 0)); if (!Number.isFinite(Number(b.intervalSec)) || !Number(b.intervalSec)) throw new Error('interval required'); s.pinnedSec = v; s.nextRun = Math.min(s.nextRun, Date.now() + v * 1000); }
        else if (b.action === 'unpin') delete s.pinnedSec;
        else if (b.action === 'check') {
          // Now, whatever the schedule says. An X window is read for the briefings that use it, as deep as they need.
          if (strategyOf(s.kind) === 'window') {
            const mine = this.uses().filter((u) => u.source === s.id && u.consumer_kind === 'briefing'), t = mine[0] && this.topic(mine[0].consumer_id);
            if (!t) throw new Error('no briefing uses this source');
            const d = mergeDepth(mine.map((u) => JSON.parse(u.data) as UseData).filter((u) => !u.display).map((u) => ({ pages: u.pages ?? 1, minFaves: u.minFaves ?? 0 })));
            const r = await this.run(s, { hours: t.intervalHours, ...d });
            if (r.error) throw new Error(r.error);
          } else { s.nextRun = 0; s.errors = 0; this.saveSource(s); }
          await this.drain().catch(() => {}); await this.arm();
          return json(this.overview());
        } else throw new Error('unknown action');
        this.ctx.storage.transactionSync(() => { this.saveSource(s); this.replan(); this.enqueue(this.source(s.id)!, [], false); });
        await this.drain().catch(() => {}); await this.arm();
        return json(this.overview());
      }
      return json({ error: 'unknown collection route' }, 404);
    } catch (err) {
      console.error('collection request failed', name, err instanceof Error ? err.message : String(err));
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
}

interface RunOptions { hours?: number; pages?: number; minFaves?: number; budget?: number }
interface RunResult { fresh: number; cost: number; tweets: number; error: string; capped?: boolean }
