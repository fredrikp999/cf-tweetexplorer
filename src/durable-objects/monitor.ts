// Monitor: polling watches stored in the Durable Object's SQLite, checked from alarms.
// Same behaviour as the local server: persisted checkpoint + seen ids, overlap window, backoff,
// daily spend cap. The browser polls /mon/state and /mon/feed (no long-lived streams to pay for).
import { DurableObject } from 'cloudflare:workers';
import { COST_PER_TWEET, OutOfCredits, json, search, slim, type Tweet } from '../lib/twitterapi';
import { recordCost } from '../lib/costs';
import { fetchHn, HN_TAGS, type HnTag } from '../sources/hn';
import { expandShorthand } from '../sources/presets';
import { checkFeedUrl, fetchRss } from '../sources/rss';
import { isYoutubeFeed, resolveYoutubeFeed } from '../sources/youtube';
import { isSource, toFeedShape, type FetchResult, type SourceKind } from '../sources/types';
import { extractTerms } from '../signal/terms';
import { distinctive, rising, scoreTerms, type Counts, type GroupInfo } from '../signal/score';

const OVERLAP = 90;        // seconds re-read before the checkpoint; duplicates removed by id
const MAX_PAGES = 5;
const SEEN_KEEP = 1000;
const FEED_KEEP = 500;
const MAX_WATCHES = 50;
const FIRST_CHECK_ITEMS = 10; // a new RSS or Hacker News watch shows the latest few items, not nothing until the next post
const MIN_INTERVAL = 15, MAX_INTERVAL = 86_400;
const MAX_INFLIGHT = 3;
const SIGNAL_KEEP_DAYS = 30;   // Signal keeps daily term counts this long: two windows of at most SIGNAL_MAX_DAYS, with room to spare
const SIGNAL_MAX_DAYS = 14;
const SOURCE_NAME: Record<SourceKind, string> = { x: 'X', rss: 'RSS and blogs', hn: 'Hacker News', youtube: 'YouTube' };

interface Watch {
  id: string; label: string; query: string; originalsOnly: boolean; includeRetweets: boolean;
  intervalSec: number; enabled: boolean; created: number; lastCheckedTs: number; nextRun: number;
  checks: number; found: number; cost: number; lastRun: number; lastError: string; errors: number;
  /** Absent on watches made before there were other sources: those are X. For `rss`, `query` is the feed address. */
  source?: SourceKind;
  hnTag?: HnTag; minPoints?: number;           // Hacker News
  etag?: string; lastModified?: string;        // RSS: conditional requests, so an unchanged feed costs nothing
  autoLabel?: boolean;                         // the label is a placeholder until the first fetch names the feed
  list?: string;                               // the feed list this watch was made from, so the feed can be shown per list
  group?: string;                              // Signal: a name you gave, so watches with the same name vote together
}
const sourceOf = (w: Watch): SourceKind => w.source ?? 'x';
// What one check found, whatever the source: the id (for de-duplication), its time and the JSON the feed stores.
interface Found { id: string; ts: number; json: unknown }
interface Spend { day: string; cost: number }

const today = () => new Date().toISOString().slice(0, 10); // UTC day
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const cleanGroup = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

export class MonitorDO extends DurableObject<Env> {
  private running = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS watches (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS seen (watch TEXT NOT NULL, tweet TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (watch, tweet))');
    sql.exec('CREATE TABLE IF NOT EXISTS feed (seq INTEGER PRIMARY KEY AUTOINCREMENT, watch TEXT NOT NULL, label TEXT NOT NULL, seen_at INTEGER NOT NULL, json TEXT NOT NULL)');
    try { sql.exec("ALTER TABLE feed ADD COLUMN source TEXT NOT NULL DEFAULT 'x'"); } catch { /* the column is already there */ }
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    // Signal: how many items per day (per watch) mention each term. Groups and weights are applied when reading, so they can change freely.
    sql.exec('CREATE TABLE IF NOT EXISTS terms (day TEXT NOT NULL, watch TEXT NOT NULL, term TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch, term)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS day_items (day TEXT NOT NULL, watch TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch)) WITHOUT ROWID');
    this.backfillSignal();
  }

  // ---- storage helpers
  private watches(): Watch[] {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM watches').toArray().map((r) => JSON.parse(r.data) as Watch);
  }
  private watch(id: string): Watch | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM watches WHERE id = ?', id).toArray()[0];
    return row ? (JSON.parse(row.data) as Watch) : undefined;
  }
  private saveWatch(w: Watch): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO watches (id, data) VALUES (?, ?)', w.id, JSON.stringify(w));
  }
  private getMeta<T>(k: string, fallback: T): T {
    const row = this.ctx.storage.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0];
    return row ? (JSON.parse(row.v) as T) : fallback;
  }
  private setMeta(k: string, v: unknown): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, JSON.stringify(v));
  }
  private spend(): Spend {
    const s = this.getMeta<Spend>('spend', { day: today(), cost: 0 });
    return s.day === today() ? s : { day: today(), cost: 0 };
  }
  private addSpend(c: number): void { const s = this.spend(); this.setMeta('spend', { day: s.day, cost: s.cost + c }); }
  private cap(): number { return this.getMeta<{ dailyCap: number }>('settings', { dailyCap: 2 }).dailyCap; }

  private view(w: Watch) {
    const base = sourceOf(w) === 'x' ? [w.query, w.originalsOnly && '-filter:replies', w.includeRetweets && 'include:nativeretweets'].filter(Boolean).join(' ') : w.query;
    return { ...w, source: sourceOf(w), running: this.running.has(w.id), fullQuery: base };
  }
  private snapshot() {
    const spend = this.spend(), dailyCap = this.cap();
    return { watches: this.watches().map((w) => this.view(w)), settings: { dailyCap }, spend, capped: spend.cost >= dailyCap };
  }

  // ---- scheduling
  private async reschedule(): Promise<void> {
    const active = this.watches().filter((w) => w.enabled);
    if (!active.length) { await this.ctx.storage.deleteAlarm(); return; }
    let next = Math.min(...active.map((w) => w.nextRun));
    // Capped: X watches wait, free sources carry on. If only X watches are left, look again in 10 min.
    if (this.spend().cost >= this.cap()) {
      const free = active.filter((w) => sourceOf(w) !== 'x').map((w) => w.nextRun);
      next = free.length ? Math.min(...free) : Math.max(next, Date.now() + 600_000);
    }
    await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }

  async alarm(): Promise<void> {
    try {
      const capped = this.spend().cost >= this.cap(), now = Date.now();
      const due = this.watches().filter((w) => w.enabled && w.nextRun <= now && !this.running.has(w.id) && (!capped || sourceOf(w) !== 'x'));
      for (let i = 0; i < due.length; i += MAX_INFLIGHT) {
        await Promise.all(due.slice(i, i + MAX_INFLIGHT).map((w) => this.check(w.id)));
      }
    } catch (err) {
      console.error('monitor alarm failed', err instanceof Error ? err.message : String(err));
    }
    this.pruneSignal();
    await this.reschedule();
  }

  private isSeen(watch: string, item: string): boolean {
    return this.ctx.storage.sql.exec('SELECT 1 FROM seen WHERE watch = ? AND tweet = ?', watch, item).toArray().length > 0;
  }
  private markSeen(watch: string, item: string): void {
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO seen (watch, tweet, at) VALUES (?, ?, ?)', watch, item, Date.now());
  }

  // X: pages of advanced_search since the checkpoint, billed per tweet.
  private async checkX(w: Watch, since: number, out: { found: Found[]; cost: number; error: string }): Promise<void> {
    const base = [w.query, w.originalsOnly && '-filter:replies', w.includeRetweets && 'include:nativeretweets'].filter(Boolean).join(' ');
    let cursor = '', pages = 0, truncated = false;
    while (pages < MAX_PAGES) {
      const r = await search({ key: this.env.TWITTERAPI_IO_KEY, query: `${base} since_time:${since}`, cursor });
      const tweets = r.tweets ?? []; pages++;
      const c = Math.max(1, tweets.length) * COST_PER_TWEET; out.cost += c; this.addSpend(c);
      await recordCost(this.env, { kind: 'monitor', ref: w.id, label: w.label, twitter: c, tweets: tweets.length, calls: 1 });
      for (const t of tweets) {
        if (this.isSeen(w.id, t.id)) continue;
        this.markSeen(w.id, t.id);
        out.found.push({ id: t.id, ts: Date.parse(t.createdAt), json: slim(t) });
      }
      if (!r.has_next_page || !r.next_cursor || !tweets.length) break;
      if (pages === MAX_PAGES) truncated = true;
      cursor = r.next_cursor;
    }
    if (truncated) out.error = `burst larger than ${MAX_PAGES * 20} tweets; some may be missed`;
  }

  // RSS and Hacker News: free, so nothing is added to the spend. Everything on the first check is marked seen,
  // but only the newest few are shown, so a new watch is not empty.
  private async checkOther(w: Watch, since: number, out: { found: Found[]; cache?: FetchResult['cache']; title?: string }): Promise<void> {
    let r: FetchResult & { title?: string };
    if (sourceOf(w) === 'rss' || sourceOf(w) === 'youtube') r = await fetchRss({ url: w.query, etag: w.etag, lastModified: w.lastModified });
    else r = await fetchHn({ tag: w.hnTag ?? 'front_page', query: w.query || undefined, minPoints: w.minPoints, since });
    out.cache = r.cache; out.title = r.title;
    const fresh = r.items.filter((i) => !this.isSeen(w.id, i.id));
    for (const i of fresh) this.markSeen(w.id, i.id);
    fresh.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    for (const i of w.checks === 0 ? fresh.slice(0, FIRST_CHECK_ITEMS) : fresh) out.found.push({ id: i.id, ts: Date.parse(i.at), json: toFeedShape(i) });
  }

  private async check(id: string): Promise<void> {
    const w0 = this.watch(id);
    if (!w0) return;
    this.running.add(id);
    const sql = this.ctx.storage.sql;
    const source = sourceOf(w0);
    const startTs = Math.floor(Date.now() / 1000);
    const since = Math.max(w0.lastCheckedTs - OVERLAP, w0.created - 1);
    const out: { found: Found[]; cost: number; error: string; cache?: FetchResult['cache']; title?: string } = { found: [], cost: 0, error: '' };
    let fatal = false;
    try {
      if (source === 'x') await this.checkX(w0, since, out);
      else await this.checkOther(w0, since, out);
    } catch (err) {
      out.error = err instanceof Error ? err.message : String(err);
      fatal = true; // checkpoint stays put so the same window is retried
      if (err instanceof OutOfCredits) out.error = err.message;
    }
    const { found, cost, error } = out;

    // Merge onto the latest copy: the user may have paused or edited the watch while we were fetching.
    const w = this.watch(id);
    if (w) {
      w.cost += cost; w.lastRun = Date.now(); w.lastError = error;
      if (fatal) {
        w.errors++;
        if (error.startsWith('Out of credits')) w.enabled = false;
        else w.nextRun = Date.now() + Math.min(600, w.intervalSec * 2 ** Math.min(w.errors, 6)) * 1000;
      } else {
        w.lastCheckedTs = startTs; w.checks++; w.errors = 0; w.nextRun = Date.now() + w.intervalSec * 1000;
        if (out.cache) { w.etag = out.cache.etag; w.lastModified = out.cache.lastModified; }
        if (w.autoLabel && out.title) { w.label = out.title.slice(0, 60); w.autoLabel = false; }
      }
      found.sort((a, b) => a.ts - b.ts); // oldest first, feed ends newest
      w.found += found.length;
      this.ctx.storage.transactionSync(() => {
        for (const f of found) {
          // Items that are not tweets remember which feed they came from, so a briefing can say what it drew on.
          const json = source === 'x' ? f.json : { ...(f.json as object), feed: w.label, feedUrl: source === 'hn' ? 'https://news.ycombinator.com/' : w.query };
          sql.exec('INSERT INTO feed (watch, label, seen_at, json, source) VALUES (?, ?, ?, ?, ?)', id, w.label, Date.now(), JSON.stringify(json), source);
        }
        this.countTerms(id, found);
        // Each source keeps its own FEED_KEEP items, so a busy one cannot push the others out.
        sql.exec('DELETE FROM feed WHERE source = ?1 AND seq <= (SELECT MAX(seq) FROM feed WHERE source = ?1) - ?2', source, FEED_KEEP);
        sql.exec('DELETE FROM seen WHERE watch = ?1 AND rowid NOT IN (SELECT rowid FROM seen WHERE watch = ?1 ORDER BY at DESC LIMIT ?2)', id, SEEN_KEEP);
        this.saveWatch(w);
      });
    }
    this.running.delete(id);
  }

  // ---- Signal: counting
  /** Counts one item under each of its terms, on the day it was published. */
  private countTerms(watch: string, items: Found[]): void {
    const sql = this.ctx.storage.sql, now = Date.now(), floor = now - SIGNAL_KEEP_DAYS * 86_400_000;
    const days = new Map<string, number>(), terms = new Map<string, number>();
    for (const f of items) {
      const ts = Number.isFinite(f.ts) ? Math.min(f.ts, now) : now;
      if (ts < floor) continue;
      const day = dayOf(ts);
      days.set(day, (days.get(day) ?? 0) + 1);
      for (const t of extractTerms(String((f.json as { text?: unknown }).text ?? ''))) terms.set(`${day}\n${t}`, (terms.get(`${day}\n${t}`) ?? 0) + 1);
    }
    for (const [day, n] of days) sql.exec('INSERT INTO day_items (day, watch, n) VALUES (?, ?, ?) ON CONFLICT (day, watch) DO UPDATE SET n = n + excluded.n', day, watch, n);
    for (const [k, n] of terms) {
      const i = k.indexOf('\n');
      sql.exec('INSERT INTO terms (day, watch, term, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, watch, term) DO UPDATE SET n = n + excluded.n', k.slice(0, i), watch, k.slice(i + 1), n);
    }
  }
  /** Once: count what the feed already holds, so Signal has something to show the day it is first opened. */
  private backfillSignal(): void {
    if (this.getMeta('signalBackfill', false)) return;
    const rows = this.ctx.storage.sql.exec<{ watch: string; seen_at: number; json: string }>('SELECT watch, seen_at, json FROM feed').toArray();
    const by = new Map<string, Found[]>();
    for (const r of rows) {
      const j = JSON.parse(r.json) as { createdAt?: string };
      const ts = Date.parse(j.createdAt ?? '');
      (by.get(r.watch) ?? by.set(r.watch, []).get(r.watch)!).push({ id: '', ts: Number.isFinite(ts) ? ts : r.seen_at, json: j });
    }
    this.ctx.storage.transactionSync(() => { for (const [watch, items] of by) this.countTerms(watch, items); this.setMeta('signalBackfill', true); });
  }
  /** Once a day: drop what is older than the window, and terms mentioned a single time after a week (most of the rows, none of the signal). */
  private pruneSignal(): void {
    if (this.getMeta('signalPruned', '') === today()) return;
    const sql = this.ctx.storage.sql, now = Date.now();
    sql.exec('DELETE FROM terms WHERE day < ?', dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    sql.exec('DELETE FROM day_items WHERE day < ?', dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    sql.exec('DELETE FROM terms WHERE n = 1 AND day < ?', dayOf(now - 7 * 86_400_000));
    this.setMeta('signalPruned', today());
  }

  // ---- Signal: reading
  /** Names of the feed lists, for the groups made from them. */
  private async listNames(): Promise<Map<string, string>> {
    try {
      const r = await this.env.LISTS.getByName('main').fetch(new Request('https://internal/lists/f-all'));
      return new Map(((await r.json()) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name]));
    } catch { return new Map(); }
  }
  /** Which group a watch votes in: a name you gave, else the feed list it came from, else its kind of source. */
  private groupOf(w: Watch, names: Map<string, string>): { key: string; name: string } {
    if (w.group) return { key: 'g:' + w.group.toLowerCase(), name: w.group };
    if (w.list) return { key: 'list:' + w.list, name: names.get(w.list) ?? 'Feed list' };
    return { key: 'src:' + sourceOf(w), name: SOURCE_NAME[sourceOf(w)] };
  }
  private async groups() {
    const names = await this.listNames(), weights = this.getMeta<Record<string, number>>('signalWeights', {});
    const of = new Map<string, string>(), groups = new Map<string, GroupInfo & { watches: Array<{ id: string; label: string; source: SourceKind; enabled: boolean; group?: string }> }>();
    for (const w of this.watches()) {
      const g = this.groupOf(w, names);
      of.set(w.id, g.key);
      const cur = groups.get(g.key) ?? groups.set(g.key, { key: g.key, name: g.name, weight: weights[g.key] ?? 1, watches: [] }).get(g.key)!;
      cur.watches.push({ id: w.id, label: w.label, source: sourceOf(w), enabled: w.enabled, group: w.group });
    }
    return { of, groups: [...groups.values()] };
  }
  /** Items per group over the days from..to (UTC, inclusive). */
  private itemsIn(of: Map<string, string>, from: string, to: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.ctx.storage.sql.exec<{ watch: string; n: number }>('SELECT watch, SUM(n) AS n FROM day_items WHERE day >= ? AND day <= ? GROUP BY watch', from, to)) {
      const g = of.get(r.watch); if (g) out[g] = (out[g] ?? 0) + r.n;
    }
    return out;
  }
  /** Per group, the number of items mentioning each term over from..to, for the terms mentioned at least 3 times in candFrom..candTo. */
  private countsIn(of: Map<string, string>, from: string, to: string, candFrom: string, candTo: string): Counts {
    const out: Counts = new Map();
    const rows = this.ctx.storage.sql.exec<{ term: string; watch: string; n: number }>(
      `SELECT term, watch, SUM(n) AS n FROM terms WHERE day >= ?1 AND day <= ?2 AND term IN
         (SELECT term FROM terms WHERE day >= ?3 AND day <= ?4 GROUP BY term HAVING SUM(n) >= 3 ORDER BY SUM(n) DESC LIMIT 3000)
       GROUP BY term, watch`, from, to, candFrom, candTo);
    for (const r of rows) {
      const g = of.get(r.watch); if (!g) continue;
      const c = out.get(r.term) ?? out.set(r.term, {}).get(r.term)!;
      c[g] = (c[g] ?? 0) + r.n;
    }
    return out;
  }
  private async compute(daysIn: number) {
    const days = Math.min(SIGNAL_MAX_DAYS, Math.max(1, Math.floor(daysIn) || 7)), now = Date.now(), DAY = 86_400_000;
    const to = dayOf(now), from = dayOf(now - (days - 1) * DAY), prevTo = dayOf(now - days * DAY), prevFrom = dayOf(now - (2 * days - 1) * DAY);
    const { of, groups } = await this.groups();
    const items = this.itemsIn(of, from, to), prevItems = this.itemsIn(of, prevFrom, prevTo);
    const scored = scoreTerms({ groups, items, prevItems, cur: this.countsIn(of, from, to, from, to), prev: this.countsIn(of, prevFrom, prevTo, from, to) });
    return { days, from, to, of, groups, items, prevItems, ...scored };
  }
  /** Items per day for the last SIGNAL_MAX_DAYS days, per group (oldest first). */
  private volume(of: Map<string, string>, groups: GroupInfo[]) {
    const now = Date.now(), days = Array.from({ length: SIGNAL_MAX_DAYS }, (_, i) => dayOf(now - (SIGNAL_MAX_DAYS - 1 - i) * 86_400_000));
    const by: Record<string, number[]> = Object.fromEntries(groups.map((g) => [g.key, days.map(() => 0)]));
    for (const r of this.ctx.storage.sql.exec<{ day: string; watch: string; n: number }>('SELECT day, watch, n FROM day_items WHERE day >= ?', days[0])) {
      const g = of.get(r.watch), i = days.indexOf(r.day);
      if (g && i >= 0) by[g][i] += r.n;
    }
    return { days, by };
  }
  private async signalOverview(daysIn: number) {
    const c = await this.compute(daysIn);
    const pick = (list: ReturnType<typeof rising>) => list.map((t) => t.term);
    const top = c.terms.slice(0, 40), rise = rising(c.terms, 25);
    const shared = c.terms.filter((t) => t.kind === 'shared').slice(0, 15), single = c.terms.filter((t) => t.kind === 'single').slice(0, 20);
    const terms: Record<string, (typeof c.terms)[number]> = {};
    for (const t of [...top, ...rise, ...shared, ...single]) terms[t.term] = t;
    const { days, by } = this.volume(c.of, c.groups);
    return {
      days: c.days, from: c.from, to: c.to, baselineOk: c.baselineOk,
      groups: c.groups.map((g) => ({ ...g, items: c.items[g.key] ?? 0, prevItems: c.prevItems[g.key] ?? 0, perDay: by[g.key] })),
      volumeDays: days, lists: { top: pick(top), rising: pick(rise), shared: pick(shared), single: pick(single) }, terms,
      scored: c.terms.length,
    };
  }
  private async signalTerm(term: string) {
    const { of, groups } = await this.groups(), { days, by } = this.volume(of, groups);
    const docs: Record<string, number[]> = Object.fromEntries(groups.map((g) => [g.key, days.map(() => 0)]));
    for (const r of this.ctx.storage.sql.exec<{ day: string; watch: string; n: number }>('SELECT day, watch, n FROM terms WHERE term = ? AND day >= ?', term, days[0])) {
      const g = of.get(r.watch), i = days.indexOf(r.day);
      if (g && i >= 0) docs[g][i] += r.n;
    }
    // A few recent items that mention it. The feed holds the latest items only, so older mentions are counted but not shown.
    const samples: unknown[] = [];
    for (const r of this.ctx.storage.sql.exec<{ watch: string; label: string; seen_at: number; json: string; source: string }>('SELECT watch, label, seen_at, json, source FROM feed ORDER BY seq DESC LIMIT 2000')) {
      const tweet = JSON.parse(r.json) as { text?: string; feed?: string; feedUrl?: string };
      if (!extractTerms(String(tweet.text ?? '')).includes(term)) continue;
      if (r.source !== 'x') tweet.feed ??= r.label;
      samples.push({ watchId: r.watch, group: of.get(r.watch) ?? '', label: r.label, seenAt: r.seen_at, source: r.source, tweet });
      if (samples.length >= 12) break;
    }
    return { term, days, groups: groups.map((g) => ({ key: g.key, name: g.name, docs: docs[g.key], items: by[g.key] })), samples };
  }
  private async signalGroup(key: string, daysIn: number) {
    const c = await this.compute(daysIn), g = c.groups.find((x) => x.key === key);
    if (!g) throw new Error('unknown group');
    const own = (t: (typeof c.terms)[number]) => t.groups.find((x) => x.key === key)?.share ?? 0;
    const strongest = c.terms.filter((t) => (t.groups.find((x) => x.key === key)?.docs ?? 0) >= 3).sort((a, b) => own(b) - own(a)).slice(0, 15);
    return { key, name: g.name, weight: g.weight, items: c.items[key] ?? 0, watches: g.watches, active: c.active.some((a) => a.key === key),
      strongest: strongest.map((t) => ({ term: t.term, docs: t.groups.find((x) => x.key === key)?.docs ?? 0, share: own(t), kind: t.kind, breadth: t.breadth, active: t.active })),
      distinctive: distinctive(c.terms, key, 15).map((t) => ({ term: t.term, docs: t.groups.find((x) => x.key === key)?.docs ?? 0, own: t.own, others: t.others, lift: t.lift })) };
  }

  // ---- HTTP API (same routes and JSON as the local server)
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = url.pathname.replace(/^\/mon\//, '');
    try {
      if (request.method === 'GET') {
        if (name === 'state') return json(this.snapshot());
        if (name === 'feed') {
          const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
          const source = url.searchParams.get('source') ?? ''; // '' = every source, combined
          if (source && !isSource(source)) throw new Error('unknown source');
          const list = url.searchParams.get('list') ?? '';     // only the watches made from one feed list
          const ofList = JSON.stringify(this.watches().filter((w) => w.list === list).map((w) => w.id));
          const rows = this.ctx.storage.sql.exec<{ watch: string; label: string; seen_at: number; json: string; source: string }>(
            "SELECT watch, label, seen_at, json, source FROM feed WHERE (?1 = '' OR source = ?1) AND (?3 = '' OR watch IN (SELECT value FROM json_each(?4))) ORDER BY seq DESC LIMIT ?2", source, limit, list, ofList).toArray();
          // Items saved before they carried the name of their feed get it from the watch they came from.
          const queries = new Map(this.watches().map((w) => [w.id, w] as const));
          return json(rows.map((r) => {
            const tweet = JSON.parse(r.json) as Record<string, unknown>;
            if (r.source !== 'x') { tweet.feed ??= r.label; tweet.feedUrl ??= r.source === 'hn' ? 'https://news.ycombinator.com/' : queries.get(r.watch)?.query; }
            return { watchId: r.watch, label: r.label, seenAt: r.seen_at, source: r.source, tweet };
          }));
        }
        if (name === 'signal') return json(await this.signalOverview(Number(url.searchParams.get('days'))));
        if (name === 'signal-term') {
          const term = (url.searchParams.get('term') ?? '').trim().toLowerCase().slice(0, 80);
          if (!term) throw new Error('term required');
          return json(await this.signalTerm(term));
        }
        if (name === 'signal-group') return json(await this.signalGroup(url.searchParams.get('key') ?? '', Number(url.searchParams.get('days'))));
        return json({ error: 'unknown monitor route' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'GET or POST required' }, 405);
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

      if (name === 'add') {
        if (this.watches().length >= MAX_WATCHES) throw new Error(`at most ${MAX_WATCHES} watches`);
        let source = isSource(b.source) ? b.source : 'x';
        if (source === 'rss') b.query = expandShorthand(String(b.query ?? '')) ?? b.query;   // r/rust, github:owner/repo, … → the feed they stand for
        if (source === 'rss' && isYoutubeFeed(String(b.query ?? '').trim())) source = 'youtube';   // a YouTube feed address pasted as a plain feed
        const listId = /^[A-Za-z0-9-]{1,40}$/.test(String(b.list ?? '')) ? String(b.list) : undefined;
        // Already watched: from a feed list that is fine (the watch just remembers it belongs to the list too); otherwise it is a mistake.
        const repeat = (had: Watch, message: string): Response => {
          if (!listId) throw new Error(message);
          if (!had.list) { had.list = listId; this.saveWatch(had); }
          return json({ ...this.view(had), existing: true });
        };
        const intervalSec = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(Number(b.intervalSec)) || 60));
        const now = Math.floor(Date.now() / 1000);
        const w: Watch = {
          id: crypto.randomUUID().slice(0, 8), label: '', query: '', originalsOnly: !!b.originalsOnly, includeRetweets: !!b.includeRetweets, intervalSec, enabled: true,
          created: now, lastCheckedTs: now, nextRun: 0, checks: 0, found: 0, cost: 0, lastRun: 0, lastError: '', errors: 0, source,
        };
        const given = String(b.label ?? '').trim().slice(0, 60);
        if (source === 'rss' || source === 'youtube') {
          w.query = source === 'youtube' ? await resolveYoutubeFeed(String(b.query ?? '')) : checkFeedUrl(String(b.query ?? ''));
          const had = this.watches().find((x) => x.query === w.query && (sourceOf(x) === 'rss' || sourceOf(x) === 'youtube'));
          if (had) return repeat(had, 'that feed is already watched');
          w.label = given || new URL(w.query).hostname; w.autoLabel = !given; w.originalsOnly = false; w.includeRetweets = false;
        } else if (source === 'hn') {
          w.hnTag = HN_TAGS.includes(b.hnTag as HnTag) ? (b.hnTag as HnTag) : 'front_page';
          w.query = String(b.query ?? '').trim().slice(0, 200);
          w.minPoints = Math.min(10_000, Math.max(0, Math.floor(Number(b.minPoints)) || 0));
          const hadHn = this.watches().find((x) => sourceOf(x) === 'hn' && (x.hnTag ?? 'front_page') === w.hnTag && x.query === w.query && (x.minPoints ?? 0) === w.minPoints);
          if (hadHn) return repeat(hadHn, 'that search is already watched');
          const kind = { front_page: 'front page', story: 'new stories', show_hn: 'Show HN', ask_hn: 'Ask HN' }[w.hnTag];
          w.label = given || `HN ${kind}${w.query ? ` · ${w.query}` : ''}${w.minPoints ? ` · ${w.minPoints}+ points` : ''}`.slice(0, 60);
          w.originalsOnly = false; w.includeRetweets = false;
        } else {
          let query = String(b.query ?? '').trim();
          if (b.kind === 'account') query = 'from:' + query.replace(/^@/, '');
          if (!query || query.length > 400 || (b.kind === 'account' && !/^from:\w{1,15}$/.test(query))) throw new Error('invalid account or query');
          w.query = query; w.label = b.kind === 'account' ? '@' + query.slice(5) : given || query;
        }
        if (listId) w.list = listId;
        const group = cleanGroup(b.group); if (group) w.group = group;   // Signal: the group this watch votes in
        this.saveWatch(w); await this.reschedule();
        return json(this.view(w));
      }
      if (name === 'settings') {
        const cap = Number(b.dailyCap);
        if (cap >= 0) this.setMeta('settings', { dailyCap: Math.min(1000, cap) });
        await this.reschedule();
        return json(this.snapshot());
      }
      if (name === 'signal-weight') {
        const key = String(b.key ?? '').slice(0, 80), weight = Math.round(Math.min(3, Math.max(0, Number(b.weight))) * 100) / 100;
        if (!key || !Number.isFinite(weight)) throw new Error('key and weight required');
        this.setMeta('signalWeights', { ...this.getMeta<Record<string, number>>('signalWeights', {}), [key]: weight });
        return json({ ok: true });
      }
      if (name === 'signal-regroup') {   // every watch in one group moves to a name you give (an existing group's name merges them); no name puts them back
        const key = String(b.key ?? ''), group = cleanGroup(b.group), names = await this.listNames();
        let n = 0;
        for (const w of this.watches()) {
          if (this.groupOf(w, names).key !== key) continue;
          if (group) w.group = group; else delete w.group;
          this.saveWatch(w); n++;
        }
        return json({ ok: true, moved: n });
      }
      if (name === 'clear') { this.ctx.storage.sql.exec('DELETE FROM feed'); return json({ ok: true }); }

      const w = this.watch(String(b.id ?? ''));
      if (!w) return json({ error: 'unknown watch' }, 404);
      if (name === 'update') {
        if (b.enabled !== undefined) { w.enabled = !!b.enabled; if (w.enabled) { w.errors = 0; w.lastError = ''; w.nextRun = 0; } }
        if (b.group !== undefined) { const g = cleanGroup(b.group); if (g) w.group = g; else delete w.group; }
        if (b.intervalSec !== undefined) w.intervalSec = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(Number(b.intervalSec)) || w.intervalSec));
        this.saveWatch(w); await this.reschedule();
        return json(this.view(w));
      }
      if (name === 'delete') {
        this.ctx.storage.sql.exec('DELETE FROM watches WHERE id = ?', w.id);
        this.ctx.storage.sql.exec('DELETE FROM seen WHERE watch = ?', w.id);
        this.ctx.storage.sql.exec('DELETE FROM terms WHERE watch = ?', w.id);
        this.ctx.storage.sql.exec('DELETE FROM day_items WHERE watch = ?', w.id);
        await this.reschedule();
        return json({ ok: true });
      }
      if (name === 'check') { w.nextRun = 0; this.saveWatch(w); await this.reschedule(); return json({ ok: true }); }
      return json({ error: 'unknown monitor route' }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
}
