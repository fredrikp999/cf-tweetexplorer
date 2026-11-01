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
import { distinctive, findEvergreen, notSteady, rising, scoreTerms, type Counts, type GroupInfo, type ScoredTerm } from '../signal/score';
import { boostByEngagement, indexItems, mergeTopics, REACTION_CAP, relatedTerms, topicEngagement, topicItems, type TopicItem } from '../signal/topics';
import { cleanTitle, isBait } from '../signal/clean';
import { setYoutubeKey } from '../sources/youtube';
import { AI_BATCH, VAGUE, estimatePer1000, parseTopics, topicSystem, topicUser } from '../signal/ai';
import { DEFAULT_FILTER, cleanFilter, makeBlocker, type FilterWord } from '../signal/filter';
import { GENERIC } from '../signal/terms';
import { STOP } from '../history/stats';
import { complete, defaultTiers, modelOptions } from '../llm/analysis';

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
const BRIEF_WEIGHT = 2;    // the starting weight of a group that only holds briefing posts
const BRIEF_KEEP = 3000;   // posts from briefings kept for Signal's headlines, apart from the live feed so they never push its items out
const AI_QUEUE_MAX = 3000, AI_BACKLOG_DAYS = 14, AI_RETRY_MS = 10 * 60_000;
interface SignalAi { enabled: boolean; model: string; dailyCap: number }
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
  noSignal?: boolean;                          // Signal: keep watching, but leave this watch out of Signal
  briefing?: string;                           // fed by the briefing with this slug (never polled): its posts were already paid for there
}
const sourceOf = (w: Watch): SourceKind => w.source ?? 'x';
// What one check found, whatever the source: the id (for de-duplication), its time and the JSON the feed stores.
interface Found { id: string; ts: number; json: unknown }
interface Spend { day: string; cost: number }

const today = () => new Date().toISOString().slice(0, 10); // UTC day
/** A top-level Signal: a named set of groups, with its own page when published (/signal/<slug>). */
interface Board { id: string; slug: string; title: string; description: string; groups: string[]; public: boolean; /** Addresses it had before: they redirect to the current one. */ oldSlugs?: string[]; /** The public page may show the items behind each topic, with their sources. */ proof?: boolean }
const BOARD_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/, BOARD_RESERVED = new Set(['admin', 'custom', 'method']);
const slugify = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
/** How much people reacted to an item: likes (HN points, stars and upvotes arrive as likes), plus replies, retweets and quotes counted double. */
const reactionsOf = (j: unknown): number => { const x = j as { likeCount?: number; replyCount?: number; retweetCount?: number; quoteCount?: number }; return Math.max(0, Math.round((Number(x.likeCount) || 0) + 2 * ((Number(x.replyCount) || 0) + (Number(x.retweetCount) || 0) + (Number(x.quoteCount) || 0)))); };
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Merged and renamed topics from the browser: lowercase names of at most 80 characters, chains followed to their end, no name pointing at itself. */
function cleanAliases(raw: unknown): Record<string, string> {
  const name = (v: unknown) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  const map: Record<string, string> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) { const a = name(k), b = name(v); if (a && b && a !== b) map[a] = b; }
  for (const k of Object.keys(map)) { let t = map[k]; for (let i = 0; i < 10 && map[t] && map[t] !== k; i++) t = map[t]; if (t === k) delete map[k]; else map[k] = t; }
  return map;
}
const cleanGroup = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

export class MonitorDO extends DurableObject<Env> {
  private running = new Set<string>();
  private pubCache = new Map<string, { at: number; v: unknown }>();   // public Signal answers, cleared by any change

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    setYoutubeKey(env.YOUTUBE_API_KEY);   // a channel whose feed fails is read through the API
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS watches (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS seen (watch TEXT NOT NULL, tweet TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (watch, tweet))');
    sql.exec('CREATE TABLE IF NOT EXISTS feed (seq INTEGER PRIMARY KEY AUTOINCREMENT, watch TEXT NOT NULL, label TEXT NOT NULL, seen_at INTEGER NOT NULL, json TEXT NOT NULL)');
    try { sql.exec("ALTER TABLE feed ADD COLUMN source TEXT NOT NULL DEFAULT 'x'"); } catch { /* the column is already there */ }
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    // Signal: how many items per day (per watch) mention each term. Groups and weights are applied when reading, so they can change freely.
    sql.exec('CREATE TABLE IF NOT EXISTS terms (day TEXT NOT NULL, watch TEXT NOT NULL, term TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch, term)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS day_items (day TEXT NOT NULL, watch TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch)) WITHOUT ROWID');
    // Signal topics written by a model: items waiting to be read, what each one was given, and the same counts as above for those topics.
    sql.exec('CREATE TABLE IF NOT EXISTS ai_queue (seq INTEGER PRIMARY KEY AUTOINCREMENT, watch TEXT NOT NULL, item TEXT NOT NULL, day TEXT NOT NULL, text TEXT NOT NULL, UNIQUE (watch, item))');
    sql.exec('CREATE TABLE IF NOT EXISTS ai_item (watch TEXT NOT NULL, item TEXT NOT NULL, day TEXT NOT NULL, topics TEXT NOT NULL, PRIMARY KEY (watch, item)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS ai_terms (day TEXT NOT NULL, watch TEXT NOT NULL, term TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch, term)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS ai_items (day TEXT NOT NULL, watch TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch)) WITHOUT ROWID');
    // Proof for Signal: the items themselves (title, link, source, date) for 30 days, so any topic can be traced back to what was published.
    sql.exec('CREATE TABLE IF NOT EXISTS item_log (watch TEXT NOT NULL, item TEXT NOT NULL, day TEXT NOT NULL, ts INTEGER NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, disc TEXT NOT NULL, by TEXT NOT NULL, match TEXT NOT NULL, PRIMARY KEY (watch, item)) WITHOUT ROWID');
    sql.exec('CREATE INDEX IF NOT EXISTS item_log_day ON item_log (day)');
    try { sql.exec('ALTER TABLE item_log ADD COLUMN eng INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }   // reactions (likes, replies, shares) when the item was logged
    this.backfillSignal();
    this.backfillItemLog();
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
    return { watches: this.watches().map((w) => this.view(w)), settings: { dailyCap }, spend, capped: spend.cost >= dailyCap, youtubeApi: !!this.env.YOUTUBE_API_KEY };
  }

  // ---- scheduling
  private async reschedule(): Promise<void> {
    const active = this.watches().filter((w) => w.enabled && !w.briefing), wake = this.aiWake();
    if (!active.length) { if (wake) await this.ctx.storage.setAlarm(wake); else await this.ctx.storage.deleteAlarm(); return; }
    let next = Math.min(...active.map((w) => w.nextRun));
    // Capped: X watches wait, free sources carry on. If only X watches are left, look again in 10 min.
    if (this.spend().cost >= this.cap()) {
      const free = active.filter((w) => sourceOf(w) !== 'x').map((w) => w.nextRun);
      next = free.length ? Math.min(...free) : Math.max(next, Date.now() + 600_000);
    }
    if (wake) next = Math.min(next, wake);   // items are waiting for the model
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
    try { await this.processAi(Date.now() + 20_000); } catch (err) { console.error('signal topics failed', err instanceof Error ? err.message : String(err)); }
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
    if (!w0 || w0.briefing) return;
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
        if (this.aiConfig().enabled) this.enqueueAi(id, found);
        // Each source keeps its own FEED_KEEP items, so a busy one cannot push the others out.
        sql.exec("DELETE FROM feed WHERE source = ?1 AND watch NOT LIKE 'brief:%' AND seq <= (SELECT MAX(seq) FROM feed WHERE source = ?1 AND watch NOT LIKE 'brief:%') - ?2", source, FEED_KEEP);
        sql.exec('DELETE FROM seen WHERE watch = ?1 AND rowid NOT IN (SELECT rowid FROM seen WHERE watch = ?1 ORDER BY at DESC LIMIT ?2)', id, SEEN_KEEP);
        this.saveWatch(w);
      });
    }
    this.running.delete(id);
  }

  /**
   * Posts a briefing already fetched (and paid for) go into Signal as one watch of their own, so Signal does not have to fetch them again.
   * The watch is never polled. Posts it has seen are skipped, so a later briefing that reads the same posts does not count them twice.
   */
  private ingestBriefing(slug: string, title: string, group: string, posts: Array<Record<string, unknown>>): { added: number; total: number } {
    const id = 'brief:' + slug, now = Date.now();
    const found: Found[] = [];
    for (const p of posts.slice(0, 2000)) {
      const pid = String(p.id ?? ''); if (!pid || this.isSeen(id, pid)) continue;
      const ts = Date.parse(String(p.createdAt ?? ''));
      found.push({ id: pid, ts: Number.isFinite(ts) ? ts : now, json: p });
    }
    const label = ('Briefing: ' + title).slice(0, 60), w: Watch = this.watch(id) ?? {
      id, label, query: '', originalsOnly: false, includeRetweets: false, intervalSec: 3600, enabled: false, created: now, lastCheckedTs: 0, nextRun: 0,
      checks: 0, found: 0, cost: 0, lastRun: 0, lastError: '', errors: 0, briefing: slug };
    w.label = label; w.enabled = false; w.group = cleanGroup(group) || title.slice(0, 40); w.lastRun = now; w.found += found.length; w.checks++;
    found.sort((a, b) => a.ts - b.ts);
    this.ctx.storage.transactionSync(() => {
      for (const f of found) {
        this.markSeen(id, f.id);
        const j = f.json as { source?: string };
        this.ctx.storage.sql.exec('INSERT INTO feed (watch, label, seen_at, json, source) VALUES (?, ?, ?, ?, ?)', id, label, now, JSON.stringify(f.json), j.source === 'rss' || j.source === 'hn' || j.source === 'youtube' ? j.source : 'x');
      }
      this.countTerms(id, found);
      if (this.aiConfig().enabled) this.enqueueAi(id, found);
      this.ctx.storage.sql.exec("DELETE FROM feed WHERE watch LIKE 'brief:%' AND seq <= (SELECT MAX(seq) FROM feed WHERE watch LIKE 'brief:%') - ?", BRIEF_KEEP);
      this.saveWatch(w);
    });
    return { added: found.length, total: posts.length };
  }

  // ---- Signal: counting
  /** Counts one item under each of its terms, on the day it was published. */
  private countTerms(watch: string, items: Found[]): void {
    const sql = this.ctx.storage.sql, now = Date.now(), floor = now - SIGNAL_KEEP_DAYS * 86_400_000;
    const days = new Map<string, number>(), terms = new Map<string, number>();
    for (const f of items) {
      const ts = Number.isFinite(f.ts) ? Math.min(f.ts, now) : now;
      if (ts < floor) continue;
      const j = f.json as { text?: unknown; title?: unknown; source?: unknown };
      if (isBait(`${j.title ?? ''} ${j.text ?? ''}`)) continue;   // giveaways and "like and reply to win": not counted at all
      const day = dayOf(ts);
      days.set(day, (days.get(day) ?? 0) + 1);
      this.logItem(watch, f, ts, day);
      // A video's description is mostly the channel's footer (links, sponsors, "join the Discord"), so only its title says what it is about.
      for (const t of extractTerms(String(j.source === 'youtube' && j.title ? j.title : j.text ?? ''))) terms.set(`${day}\n${t}`, (terms.get(`${day}\n${t}`) ?? 0) + 1);
    }
    for (const [day, n] of days) sql.exec('INSERT INTO day_items (day, watch, n) VALUES (?, ?, ?) ON CONFLICT (day, watch) DO UPDATE SET n = n + excluded.n', day, watch, n);
    for (const [k, n] of terms) {
      const i = k.indexOf('\n');
      sql.exec('INSERT INTO terms (day, watch, term, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, watch, term) DO UPDATE SET n = n + excluded.n', k.slice(0, i), watch, k.slice(i + 1), n);
    }
  }
  /** Keeps what is needed to show an item as proof of a topic. `match` is the text its terms were counted from. */
  private logItem(watch: string, f: Found, ts: number, day: string): void {
    const j = f.json as { id?: unknown; text?: unknown; title?: unknown; url?: unknown; discussionUrl?: unknown; source?: unknown; author?: { userName?: unknown } };
    const id = String(j.id ?? f.id ?? ''); if (!id) return;
    const x = !j.source, text = String(j.text ?? ''), user = String(j.author?.userName ?? '');
    const safe = (u: unknown) => (/^https:\/\//.test(String(u ?? '')) ? String(u).slice(0, 400) : '');
    const url = safe(j.url) || (x && /^\d+$/.test(id) ? `https://x.com/${user || 'i'}/status/${id}` : '');
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO item_log (watch, item, day, ts, title, url, disc, by, match, eng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', watch, id, day, ts,
      cleanTitle(x ? text : String(j.title ?? '') || text.split('\n')[0], 200), url, safe(j.discussionUrl), (x ? '@' : '') + user.slice(0, 60),
      String(j.source === 'youtube' && j.title ? j.title : text).slice(0, 600), reactionsOf(f.json));
  }
  /** Once: log what the live feed already holds. */
  private backfillItemLog(): void {
    if (this.getMeta('itemLogBackfill', false)) return;
    const rows = this.ctx.storage.sql.exec<{ watch: string; seen_at: number; json: string }>('SELECT watch, seen_at, json FROM feed').toArray(), floor = Date.now() - SIGNAL_KEEP_DAYS * 86_400_000;
    this.ctx.storage.transactionSync(() => {
      for (const r of rows) {
        const j = JSON.parse(r.json) as { createdAt?: string }, ts = Date.parse(j.createdAt ?? '') || r.seen_at;
        if (ts >= floor) this.logItem(r.watch, { id: '', ts, json: j }, Math.min(ts, Date.now()), dayOf(Math.min(ts, Date.now())));
      }
      this.setMeta('itemLogBackfill', true);
    });
  }
  /** Once: count what the feed already holds, so Signal has something to show the day it is first opened. */
  private backfillSignal(): void {
    if (this.getMeta('signalBackfill2', false)) return;
    this.ctx.storage.sql.exec('DELETE FROM terms'); this.ctx.storage.sql.exec('DELETE FROM day_items');   // counted again below, under the rules of today
    const rows = this.ctx.storage.sql.exec<{ watch: string; seen_at: number; json: string }>('SELECT watch, seen_at, json FROM feed').toArray();
    const by = new Map<string, Found[]>();
    for (const r of rows) {
      const j = JSON.parse(r.json) as { createdAt?: string };
      const ts = Date.parse(j.createdAt ?? '');
      (by.get(r.watch) ?? by.set(r.watch, []).get(r.watch)!).push({ id: '', ts: Number.isFinite(ts) ? ts : r.seen_at, json: j });
    }
    this.ctx.storage.transactionSync(() => { for (const [watch, items] of by) this.countTerms(watch, items); this.setMeta('signalBackfill2', true); });
  }
  /** Once a day: drop what is older than the window, and terms mentioned a single time after a week (most of the rows, none of the signal). */
  private pruneSignal(): void {
    if (this.getMeta('signalPruned', '') === today()) return;
    const sql = this.ctx.storage.sql, now = Date.now();
    sql.exec('DELETE FROM terms WHERE day < ?', dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    sql.exec('DELETE FROM day_items WHERE day < ?', dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    sql.exec('DELETE FROM terms WHERE n = 1 AND day < ?', dayOf(now - 7 * 86_400_000));
    sql.exec('DELETE FROM item_log WHERE day < ?', dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    for (const t of ['ai_terms', 'ai_items', 'ai_item']) sql.exec(`DELETE FROM ${t} WHERE day < ?`, dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    sql.exec('DELETE FROM ai_terms WHERE n = 1 AND day < ?', dayOf(now - 7 * 86_400_000));
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
    const excluded: Array<{ id: string; label: string; source: SourceKind; enabled: boolean }> = [];
    const of = new Map<string, string>(), groups = new Map<string, GroupInfo & { watches: Array<{ id: string; label: string; source: SourceKind; enabled: boolean; group?: string; error?: string; briefing?: string }> }>();
    for (const w of this.watches()) {
      if (w.noSignal) { excluded.push({ id: w.id, label: w.label, source: sourceOf(w), enabled: w.enabled }); continue; }
      const g = this.groupOf(w, names);
      of.set(w.id, g.key);
      const cur = groups.get(g.key) ?? groups.set(g.key, { key: g.key, name: g.name, weight: weights[g.key] ?? 1, watches: [] }).get(g.key)!;
      cur.watches.push({ id: w.id, label: w.label, source: sourceOf(w), enabled: w.enabled, group: w.group, error: w.lastError || undefined, briefing: w.briefing });
    }
    // A group made only of briefing posts has a head start: those posts were already picked and combined from many sources. A weight you set wins.
    for (const g of groups.values()) if (!(g.key in weights) && g.watches.length && g.watches.every((x) => this.watch(x.id)?.briefing)) g.weight = BRIEF_WEIGHT;
    return { of, groups: [...groups.values()], excluded };
  }
  /** Items per group over the days from..to (UTC, inclusive). */
  private itemsIn(of: Map<string, string>, from: string, to: string): Record<string, number> {
    const out: Record<string, number> = {}, T = this.tables();
    for (const r of this.ctx.storage.sql.exec<{ watch: string; n: number }>(`SELECT watch, SUM(n) AS n FROM ${T.items} WHERE day >= ? AND day <= ? GROUP BY watch`, from, to)) {
      const g = of.get(r.watch); if (g) out[g] = (out[g] ?? 0) + r.n;
    }
    return out;
  }
  /**
   * Terms that are one source's own signature rather than a topic: in at least 30% of its items over the kept period, on three or more different days
   * (a channel's footer, an account's catchphrase). Those mentions are left out for that source. As "watch\nterm".
   */
  private boilerplate(candFrom: string, candTo: string): Set<string> {
    const sql = this.ctx.storage.sql, from = dayOf(Date.now() - SIGNAL_KEEP_DAYS * 86_400_000), T = this.tables();
    const total = new Map<string, number>();
    for (const r of sql.exec<{ watch: string; n: number }>(`SELECT watch, SUM(n) AS n FROM ${T.items} WHERE day >= ? GROUP BY watch`, from)) total.set(r.watch, r.n);
    const out = new Set<string>();
    const rows = sql.exec<{ term: string; watch: string; n: number; days: number }>(
      `SELECT term, watch, SUM(n) AS n, COUNT(*) AS days FROM ${T.terms} WHERE day >= ?1 AND term IN
         (SELECT term FROM ${T.terms} WHERE day >= ?2 AND day <= ?3 GROUP BY term HAVING SUM(n) >= 2 ORDER BY SUM(n) DESC LIMIT 3000) GROUP BY term, watch`, from, candFrom, candTo);
    for (const r of rows) { const t = total.get(r.watch) ?? 0; if (t >= 6 && r.days >= 3 && r.n / t >= 0.3) out.add(`${r.watch}\n${r.term}`); }
    return out;
  }
  /** Per group, the number of items mentioning each term over from..to, for the terms mentioned at least 3 times in candFrom..candTo; and how many different sources mention it. */
  private countsIn(of: Map<string, string>, allow: Set<string>, boiler: Set<string>, blocked: (t: string) => boolean, perGroup: Map<string, number>, from: string, to: string, candFrom: string, candTo: string): { counts: Counts; voices: Map<string, number> } {
    const counts: Counts = new Map(), seen = new Map<string, Set<string>>(), T = this.tables();
    const rows = this.ctx.storage.sql.exec<{ term: string; watch: string; n: number }>(
      `SELECT term, watch, SUM(n) AS n FROM ${T.terms} WHERE day >= ?1 AND day <= ?2 AND term IN
         (SELECT term FROM ${T.terms} WHERE day >= ?3 AND day <= ?4 GROUP BY term HAVING SUM(n) >= 2 ORDER BY SUM(n) DESC LIMIT 3000)
       GROUP BY term, watch`, from, to, candFrom, candTo);
    const alias = this.aliasFn();
    for (const r of rows) {
      const g = of.get(r.watch), term = alias(r.term);
      if (!g || !allow.has(g) || boiler.has(`${r.watch}\n${r.term}`) || blocked(term)) continue;
      const c = counts.get(term) ?? counts.set(term, {}).get(term)!;
      c[g] = (c[g] ?? 0) + r.n;
      (seen.get(term) ?? seen.set(term, new Set()).get(term)!).add(r.watch);
    }
    // A term heard from one source only is not corroborated, unless that source is the only one its group has: then there is no one to ask.
    const heard = (w: Set<string>) => (w.size === 1 && (perGroup.get(of.get([...w][0]) ?? '') ?? 0) <= 1 ? 2 : w.size);
    return { counts, voices: new Map([...seen].map(([t, w]) => [t, heard(w)] as const)) };
  }
  /** Terms mentioned on most of the days there is data for, over the whole kept history. */
  private evergreen(candFrom: string, candTo: string): Set<string> {
    const sql = this.ctx.storage.sql, T = this.tables(), keepFrom = dayOf(Date.now() - SIGNAL_KEEP_DAYS * 86_400_000);
    const withData = sql.exec<{ n: number }>(`SELECT COUNT(DISTINCT day) AS n FROM ${T.items} WHERE day >= ?`, keepFrom).one().n;
    const present = new Map<string, number>(), alias = this.aliasFn();
    for (const r of sql.exec<{ term: string; d: number }>(
      `SELECT term, COUNT(DISTINCT day) AS d FROM ${T.terms} WHERE day >= ?1 AND term IN
         (SELECT term FROM ${T.terms} WHERE day >= ?2 AND day <= ?3 GROUP BY term HAVING SUM(n) >= 2 ORDER BY SUM(n) DESC LIMIT 3000) GROUP BY term`, keepFrom, candFrom, candTo)) { const t = alias(r.term); present.set(t, Math.max(present.get(t) ?? 0, r.d)); }
    return findEvergreen(present, withData);
  }
  private async compute(daysIn: number, only?: Set<string>) {
    const days = Math.min(SIGNAL_MAX_DAYS, Math.max(1, Math.floor(daysIn) || 7)), now = Date.now(), DAY = 86_400_000;
    const to = dayOf(now), from = dayOf(now - (days - 1) * DAY), prevTo = dayOf(now - days * DAY), prevFrom = dayOf(now - (2 * days - 1) * DAY);
    const all = await this.groups(), of = all.of, excluded = all.excluded, groups = only ? all.groups.filter((g) => only.has(g.key)) : all.groups;
    const items = this.itemsIn(of, from, to), prevItems = this.itemsIn(of, prevFrom, prevTo);
    const allow = new Set(groups.filter((g) => g.weight > 0).map((g) => g.key)), boiler = this.boilerplate(from, to);
    const blocked = makeBlocker(this.filterWords());
    // The sources that have items in the window, and how many each group has.
    const sources = new Set<string>(), perGroup = new Map<string, number>();
    for (const r of this.ctx.storage.sql.exec<{ watch: string }>(`SELECT DISTINCT watch FROM ${this.tables().items} WHERE day >= ? AND day <= ?`, from, to)) {
      const g = of.get(r.watch) ?? '';
      if (allow.has(g)) { sources.add(r.watch); perGroup.set(g, (perGroup.get(g) ?? 0) + 1); }
    }
    const cur = this.countsIn(of, allow, boiler, blocked, perGroup, from, to, from, to), prev = this.countsIn(of, allow, boiler, blocked, perGroup, prevFrom, prevTo, from, to);
    // With more than one source to hear from, a topic needs two of them: one source repeating itself is not a signal.
    const scored = scoreTerms({ groups, items, prevItems, cur: cur.counts, prev: prev.counts, voices: cur.voices, evergreen: this.evergreen(from, to), minVoices: sources.size >= 2 ? 2 : 1 });
    return { days, from, to, of, groups, excluded, everyGroup: all.groups.map((g) => ({ key: g.key, name: g.name })), items, prevItems, ...scored };
  }
  /** Items per day for the last SIGNAL_MAX_DAYS days, per group (oldest first). */
  private volume(of: Map<string, string>, groups: GroupInfo[]) {
    const now = Date.now(), days = Array.from({ length: SIGNAL_MAX_DAYS }, (_, i) => dayOf(now - (SIGNAL_MAX_DAYS - 1 - i) * 86_400_000));
    const by: Record<string, number[]> = Object.fromEntries(groups.map((g) => [g.key, days.map(() => 0)]));
    for (const r of this.ctx.storage.sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${this.tables().items} WHERE day >= ?`, days[0])) {
      const g = of.get(r.watch), i = days.indexOf(r.day);
      if (g && by[g] && i >= 0) by[g][i] += r.n;   // groups outside the list (another Signal's, or muted) are not drawn
    }
    return { days, by };
  }
  // ---- The words you left out of Signal
  private filterWords(): FilterWord[] {
    const have = this.getMeta<FilterWord[] | null>('signalFilter', null);
    if (have) return have;
    this.setMeta('signalFilter', DEFAULT_FILTER);   // a new setup starts with "ai" on the list, and it can be taken off
    return DEFAULT_FILTER;
  }
  /** Topic names you merged or renamed: old name -> the name it is counted under. Applied when reading, so it also covers what was counted before. */
  private aliases(): Record<string, string> { return this.getMeta<Record<string, string>>('signalAliases', {}); }
  private aliasFn(): (t: string) => string { const a = this.aliases(); return (t) => a[t] ?? t; }
  /** A topic and every name that is counted under it. */
  private namesOf(term: string): string[] { const a = this.aliases(); return [term, ...Object.keys(a).filter((k) => a[k] === term)]; }
  private filterInfo() {
    return { words: this.filterWords(), aliases: this.aliases(), builtIn: { generic: [...GENERIC].filter(Boolean).sort(), vague: [...VAGUE].sort(), stopCount: STOP.size } };
  }

  // ---- Signal topics written by a model (optional; the setting is on the Signal tab)
  private aiConfig(): SignalAi {
    const c = this.getMeta<Partial<SignalAi>>('signalAi', {});
    return { enabled: !!c.enabled, model: c.model ?? '', dailyCap: Number.isFinite(c.dailyCap) ? Number(c.dailyCap) : 0.25 };
  }
  /** A setup that never chose starts with model topics on (when a model is available): words alone rank "model" and "project" above real topics. Turning it off sticks. */
  private ensureAiDefault(): void {
    if (this.getMeta<unknown>('signalAi', null)) return;
    const model = defaultTiers(this.env).cheap;
    if (!model || !modelOptions(this.env).some((m) => m.id === model)) return;
    this.setMeta('signalAi', { enabled: true, model, dailyCap: 0.25 } satisfies SignalAi);
    this.enqueueBacklog();
  }
  /** The topic names already in use over the last two weeks, most mentioned first: the model is told to reuse them, so one thing keeps one name. */
  private knownTopics(): string[] {
    return this.ctx.storage.sql.exec<{ term: string }>('SELECT term FROM ai_terms WHERE day >= ? GROUP BY term ORDER BY SUM(n) DESC LIMIT 80', dayOf(Date.now() - AI_BACKLOG_DAYS * 86_400_000)).toArray().map((r) => this.aliasFn()(r.term)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 60);
  }
  private aiSpend(): { day: string; cost: number } {
    const s = this.getMeta<{ day: string; cost: number }>('aiSpend', { day: today(), cost: 0 });
    return s.day === today() ? s : { day: today(), cost: 0 };
  }
  /** The tables Signal reads: the model's topics once it has read something, otherwise the words. */
  private tables(): { terms: string; items: string; ai: boolean } {
    const on = this.aiConfig().enabled && this.ctx.storage.sql.exec('SELECT 1 FROM ai_items LIMIT 1').toArray().length > 0;
    return on ? { terms: 'ai_terms', items: 'ai_items', ai: true } : { terms: 'terms', items: 'day_items', ai: false };
  }
  /** What the model gave each item since `from`, as "watch\nitem" -> topics; null when Signal is counting words. */
  private aiTopics(from: string): Map<string, string[]> | null {
    if (!this.tables().ai) return null;
    return new Map(this.ctx.storage.sql.exec<{ watch: string; item: string; topics: string }>('SELECT watch, item, topics FROM ai_item WHERE day >= ?', from).toArray().map((r) => [`${r.watch}\n${r.item}`, (JSON.parse(r.topics) ?? []) as string[]]));   // 'null': the model failed on it (not read), counted as no topics
  }
  private aiQueued(): number { return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM ai_queue').one().n; }
  /** When to wake up for items waiting for the model: now, after an error, or when the day's cap is fresh again. 0 when there is nothing to do. */
  private aiWake(): number {
    this.ensureAiDefault();
    const c = this.aiConfig();
    if (!c.enabled || !c.model || !this.aiQueued()) return 0;
    const st = this.getMeta<{ retryAt?: number }>('aiStatus', {});
    if (st.retryAt && st.retryAt > Date.now()) return st.retryAt;
    if (this.aiSpend().cost >= c.dailyCap) return Date.parse(today() + 'T00:00:00Z') + 86_400_000 + 60_000;
    return Date.now() + 2000;
  }
  private enqueueAi(watch: string, items: Found[]): void {
    const sql = this.ctx.storage.sql, now = Date.now(), floor = now - SIGNAL_KEEP_DAYS * 86_400_000;
    for (const f of items) {
      const ts = Number.isFinite(f.ts) ? Math.min(f.ts, now) : now;
      if (ts < floor || !f.id) continue;
      const j = f.json as { text?: unknown; title?: unknown; source?: unknown };
      if (isBait(`${j.title ?? ''} ${j.text ?? ''}`)) continue;
      sql.exec('INSERT OR IGNORE INTO ai_queue (watch, item, day, text) VALUES (?, ?, ?, ?)', watch, String(f.id), dayOf(ts), String(j.source === 'youtube' && j.title ? j.title : j.text ?? '').slice(0, 600));
    }
    sql.exec('DELETE FROM ai_queue WHERE seq <= (SELECT MAX(seq) FROM ai_queue) - ?', AI_QUEUE_MAX);
  }
  /** Turning it on: queue what the live feed already holds from the last two weeks, so the first view is not empty. */
  private enqueueBacklog(): void {
    const floor = Date.now() - AI_BACKLOG_DAYS * 86_400_000, byWatch = new Map<string, Found[]>();
    const have = this.ctx.storage.sql.exec<{ watch: string; item: string }>('SELECT watch, item FROM ai_item').toArray().reduce((s, r) => s.add(`${r.watch}\n${r.item}`), new Set<string>());
    for (const r of this.ctx.storage.sql.exec<{ watch: string; seen_at: number; json: string }>('SELECT watch, seen_at, json FROM feed ORDER BY seq DESC LIMIT 1500')) {
      const j = JSON.parse(r.json) as { id?: string; createdAt?: string };
      const ts = Date.parse(j.createdAt ?? '') || r.seen_at;
      if (ts < floor || !j.id || have.has(`${r.watch}\n${j.id}`)) continue;
      (byWatch.get(r.watch) ?? byWatch.set(r.watch, []).get(r.watch)!).push({ id: j.id, ts, json: j });
    }
    this.ctx.storage.transactionSync(() => { for (const [w, items] of byWatch) this.enqueueAi(w, items); });
  }
  /** Reads queued items in batches until the time or the day's spending cap runs out. An error is shown on the Signal tab and retried later. */
  private async processAi(deadline: number): Promise<void> {
    const cfg = this.aiConfig(), sql = this.ctx.storage.sql;
    if (!cfg.enabled || !cfg.model) return;
    const st = this.getMeta<{ retryAt?: number }>('aiStatus', {});
    if (st.retryAt && st.retryAt > Date.now()) return;
    while (Date.now() < deadline) {
      if (this.aiSpend().cost >= cfg.dailyCap) { this.setMeta('aiStatus', { error: 'The daily spending cap is reached; it continues tomorrow.', at: Date.now() }); return; }
      const rows = sql.exec<{ seq: number; watch: string; item: string; day: string; text: string }>('SELECT seq, watch, item, day, text FROM ai_queue ORDER BY seq LIMIT ?', AI_BATCH).toArray();
      if (!rows.length) { this.setMeta('aiStatus', {}); return; }
      let topics = new Map<number, string[]>(), cost = 0, tin = 0, tout = 0, failed = '', gaveUp = false;
      try {
        const texts = rows.map((r) => r.text);
        const r = await complete(this.env, cfg.model, [topicSystem(this.knownTopics()), topicUser(texts)], { maxTokens: 1800,
          mock: () => JSON.stringify({ items: texts.map((t, i) => ({ i: i + 1, t: extractTerms(t).filter((x) => x.includes(' ')).slice(0, 2) })) }) });
        topics = parseTopics(r.text, rows.length); cost = r.cost; tin = r.tokensIn; tout = r.tokensOut;
        if (!topics.size) failed = 'the model did not return readable topics';
      } catch (err) { failed = err instanceof Error ? err.message : String(err); }
      if (cost) { this.setMeta('aiSpend', { day: today(), cost: this.aiSpend().cost + cost }); await recordCost(this.env, { kind: 'signal', ref: 'topics', label: 'Signal topics (AI)', llm: cost, tokensIn: tin, tokensOut: tout, calls: 1, model: cfg.model }); }
      if (failed) {
        // The same batch is tried again later; after three failures in a row it is given up (read as "no topic") so it cannot block the rest.
        const fails = this.getMeta<number>('aiFails', 0) + 1;
        this.setMeta('aiFails', fails);
        if (fails < 3) { this.setMeta('aiStatus', { error: failed.slice(0, 200), at: Date.now(), retryAt: Date.now() + AI_RETRY_MS }); return; }
        this.setMeta('aiFails', 0); topics = new Map(); gaveUp = true;
      } else this.setMeta('aiFails', 0);
      this.ctx.storage.transactionSync(() => {
        for (const [i, row] of rows.entries()) {
          const t = topics.get(i) ?? [];
          // Items of a batch that failed three times are kept as 'null' (not read), so they can be retried; an empty list means read, nothing specific.
          sql.exec('INSERT OR REPLACE INTO ai_item (watch, item, day, topics) VALUES (?, ?, ?, ?)', row.watch, row.item, row.day, gaveUp ? 'null' : JSON.stringify(t));
          sql.exec('INSERT INTO ai_items (day, watch, n) VALUES (?, ?, 1) ON CONFLICT (day, watch) DO UPDATE SET n = n + 1', row.day, row.watch);
          for (const x of t) sql.exec('INSERT INTO ai_terms (day, watch, term, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, watch, term) DO UPDATE SET n = n + 1', row.day, row.watch, x);
          sql.exec('DELETE FROM ai_queue WHERE seq = ?', row.seq);
        }
      });
      if (!failed) this.setMeta('aiStatus', {});
    }
  }
  /** For the settings panel: what is on, what it costs, and how far it has got. */
  private aiStatus() {
    const c = this.aiConfig(), models = modelOptions(this.env).filter((m) => !m.decider), st = this.getMeta<{ error?: string; retryAt?: number }>('aiStatus', {});
    const read = this.ctx.storage.sql.exec<{ n: number }>('SELECT COALESCE(SUM(n), 0) AS n FROM ai_items WHERE day >= ?', dayOf(Date.now() - AI_BACKLOG_DAYS * 86_400_000)).one().n;
    const failedItems = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM ai_item WHERE topics = 'null'").one().n;
    const rereadable = Math.min(AI_QUEUE_MAX - 200, this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM item_log WHERE day >= ?', dayOf(Date.now() - (AI_BACKLOG_DAYS - 1) * 86_400_000)).one().n);
    return {
      available: models.length > 0, enabled: c.enabled, model: c.model || defaultTiers(this.env).cheap, dailyCap: c.dailyCap, spentToday: this.aiSpend().cost, using: this.tables().ai,
      queued: this.aiQueued(), read, failedItems, rereadable, error: st.error ?? '',
      models: models.map((m) => ({ id: m.id, label: m.label, per1000: estimatePer1000(m.inPrice, m.outPrice), note: m.note })),
    };
  }

  /** The items of the live feed that fall in the window and belong to the counted groups: what they were counted under, and what to show for them. */
  private windowItems(of: Map<string, string>, allow: Set<string>, from: string, to: string) {
    const fromMs = Date.parse(from + 'T00:00:00Z'), toMs = Date.parse(to + 'T00:00:00Z') + 86_400_000;
    const items: TopicItem[] = [], meta: Array<{ title: string; url: string; by: string; group: string; ts: number }> = [], ai = this.aiTopics(from), blocked = makeBlocker(this.filterWords()), alias = this.aliasFn();
    for (const r of this.ctx.storage.sql.exec<{ watch: string; label: string; seen_at: number; json: string; source: string }>('SELECT watch, label, seen_at, json, source FROM feed ORDER BY seq DESC LIMIT 2500')) {
      const g = of.get(r.watch);
      if (!g || !allow.has(g)) continue;
      const j = JSON.parse(r.json) as { text?: string; title?: string; url?: string; id?: string; createdAt?: string; feed?: string; author?: { userName?: string }; likeCount?: number; replyCount?: number; retweetCount?: number; quoteCount?: number };
      const ts = Date.parse(j.createdAt ?? '') || r.seen_at;
      if (ts < fromMs || ts >= toMs) continue;
      const text = String(j.text ?? ''), x = r.source === 'x';
      if (isBait(`${j.title ?? ''} ${text}`)) continue;
      const eng = reactionsOf(j);
      items.push({ ts, eng, terms: new Set((ai ? ai.get(`${r.watch}\n${j.id}`) ?? [] : extractTerms(r.source === 'youtube' && j.title ? j.title : text)).map(alias).filter((t) => !blocked(t))) });
      const url = /^https:\/\//.test(j.url ?? '') ? j.url! : x && /^\d+$/.test(j.id ?? '') ? `https://x.com/${j.author?.userName ?? 'i'}/status/${j.id}` : '';
      meta.push({ title: cleanTitle(x ? text : j.title || text.split('\n')[0]), url, by: x ? '@' + (j.author?.userName ?? '') : j.feed || r.label, group: g, ts });
    }
    return { items, meta };
  }
  /** Topics for the lists: words from the same items merged into one, each with a name, what goes with it and the items it comes from. */
  private describeTopics(c: { of: Map<string, string>; groups: GroupInfo[]; from: string; to: string }, pool: ScoredTerm[], nTop: number) {
    const { items, meta } = this.windowItems(c.of, new Set(c.groups.filter((g) => g.weight > 0).map((g) => g.key)), c.from, c.to), post = indexItems(items);
    const describe = (t: ScoredTerm, label?: string, members: string[] = [t.term]) => ({ ...t, label: label ?? t.term, members: members.filter((m) => m !== t.term),
      related: relatedTerms(members, items, post), reactions: topicEngagement(members, items, post), headlines: topicItems(members, items, post, 2).map((i) => ({ ...meta[i], reactions: items[i].eng ?? 0 })) });
    const clusters = mergeTopics(pool.slice(0, 60), post, nTop);
    const ordered = boostByEngagement(clusters, clusters.map((cl) => topicEngagement(cl.members.map((m) => m.term), items, post, REACTION_CAP)));
    return { top: ordered.map((cl) => describe(cl.lead, cl.label, cl.members.map((m) => m.term))), describe };
  }
  private async signalOverview(daysIn: number, boardRef = '', hideSteady = true) {
    const board = boardRef ? this.findBoard(boardRef) : undefined;
    if (boardRef && !board) throw new Error('unknown Signal');
    const c = await this.compute(daysIn, board && new Set(board.groups));
    const pick = (list: Array<{ term: string }>) => list.map((t) => t.term);
    // Topics at the same level as in the period before are background: left out of the lists unless asked for. Rising always looks at all of them.
    const pool = hideSteady ? c.terms.filter(notSteady) : c.terms;
    const { top, describe } = this.describeTopics(c, pool, 40), rise = rising(c.terms, 25);
    const shared = pool.filter((t) => t.kind === 'shared').slice(0, 15), single = pool.filter((t) => t.kind === 'single').slice(0, 20);
    const terms: Record<string, ReturnType<typeof describe>> = {};
    for (const t of [...rise, ...shared, ...single]) terms[t.term] = describe(t);
    for (const t of top) terms[t.term] = t;   // a topic's own description wins
    const { days, by } = this.volume(c.of, c.groups);
    return {
      days: c.days, from: c.from, to: c.to, baselineOk: c.baselineOk,
      groups: c.groups.map((g) => ({ ...g, items: c.items[g.key] ?? 0, prevItems: c.prevItems[g.key] ?? 0, perDay: by[g.key] })),
      ai: this.aiStatus(), filter: this.filterInfo(), boards: this.boards(), board: board?.id ?? '', everyGroup: c.everyGroup, excluded: c.excluded, volumeDays: days, lists: { top: pick(top), rising: pick(rise), shared: pick(shared), single: pick(single) }, terms,
      scored: c.terms.length, steadyHidden: hideSteady ? c.terms.length - pool.length : 0,
    };
  }
  // ---- Signal boards: top-level Signals, each a named set of groups that can be published on its own page
  private boards(): Board[] {
    if (!this.getMeta('signalBoardsMigrated', false)) {   // groups used to be published one by one: they become one board
      const old = this.getMeta<string[]>('signalPublic', []);
      if (old.length) this.setMeta('signalBoards', [{ id: 'main', slug: 'overview', title: 'Signal', description: '', groups: old, public: true } satisfies Board]);
      this.setMeta('signalBoardsMigrated', true);
    }
    return this.getMeta<Board[]>('signalBoards', []);
  }
  private saveBoards(boards: Board[]): void { this.setMeta('signalBoards', boards); }
  /** A group was renamed (its key changed), merged or deleted: boards follow it. */
  private boardsRekey(from: string, to?: string): void {
    const boards = this.boards();
    if (!boards.some((b) => b.groups.includes(from))) return;
    this.saveBoards(boards.map((b) => ({ ...b, groups: [...new Set(b.groups.flatMap((k) => (k !== from ? [k] : to ? [to] : [])))] })));
  }
  private findBoard(ref: string): Board | undefined { return this.boards().find((b) => b.id === ref || b.slug === ref); }
  private cleanBoard(raw: Record<string, unknown>, prev?: Board): Board {
    const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!title) throw new Error('give the Signal a name');
    const slug = String(raw.slug ?? '').trim().toLowerCase() || prev?.slug || slugify(title);
    if (!BOARD_SLUG.test(slug)) throw new Error('address: lowercase letters, digits and dashes, at most 40');
    if (BOARD_RESERVED.has(slug) || slug.startsWith('admin') || slug.startsWith('custom')) throw new Error('that address is reserved');
    if (this.boards().some((b) => b.slug === slug && b.id !== prev?.id)) throw new Error('another Signal already has that address');
    const groups = [...new Set((Array.isArray(raw.groups) ? raw.groups : []).map((g) => String(g).slice(0, 80)).filter(Boolean))].slice(0, 40);
    const oldSlugs = [...new Set([...(prev && prev.slug !== slug ? [prev.slug] : []), ...(prev?.oldSlugs ?? [])])].filter((x) => x !== slug).slice(0, 10);
    return { id: prev?.id ?? crypto.randomUUID().slice(0, 8), slug, title, description: String(raw.description ?? '').trim().slice(0, 300), groups, public: raw.public === true, proof: raw.proof === true, ...(oldSlugs.length ? { oldSlugs } : {}) };
  }
  /** The published Signals, for the public rail and index: names only, and only groups that count. */
  private async publicBoards() {
    const live = new Map((await this.groups()).groups.filter((g) => g.weight > 0).map((g) => [g.key, g.name] as const));
    // The first Signal was made at /signal/overview by a migration, before old addresses were remembered: that one is known here.
    return this.boards().filter((b) => b.public).map((b) => ({ slug: b.slug, aliases: [...(b.oldSlugs ?? []), ...(b.id === 'main' && b.slug !== 'overview' ? ['overview'] : [])], title: b.title, description: b.description, proof: b.proof === true, groups: b.groups.map((k) => live.get(k)).filter((n): n is string => !!n) })).filter((b) => b.groups.length);
  }
  /** What the public page may see: group names, weights and counts, and terms. No watch names, addresses, handles or items. */
  private async signalPublic(slug: string, daysIn: number) {
    const board = this.boards().find((b) => b.public && b.slug === slug);
    if (!board) return { groups: [] };
    const c = await this.compute(daysIn, new Set(board.groups));
    const shown = c.groups.filter((g) => g.weight > 0 && (c.items[g.key] ?? 0) > 0);
    if (!shown.length) return { groups: [] };
    const idx = new Map(shown.map((g, i) => [g.key, i] as const)), { days, by } = this.volume(c.of, shown), pool = c.terms.filter(notSteady);
    const { top, describe } = this.describeTopics({ ...c, groups: shown }, pool, 30);
    // Terms and what goes with them, never the items themselves.
    const out = (t: ScoredTerm & { label?: string; related?: string[]; members?: string[]; reactions?: number; headlines?: Array<{ title: string; url: string; by: string; reactions?: number }> }) => ({ term: t.term, label: t.label ?? t.term, related: t.related ?? [], members: t.members ?? [], signal: t.signal, change: t.change, isNew: t.isNew, kind: t.kind, breadth: t.breadth, active: t.active,
      top: idx.get(t.topGroup) ?? 0, parts: shown.map((g) => t.groups.find((x) => x.key === g.key)?.part ?? 0), shares: shown.map((g) => t.groups.find((x) => x.key === g.key)?.share ?? 0),
      // Items are shown only on a Signal that has sources switched on (its proof pages show them too).
      reactions: t.reactions ?? 0,
      ...(board.proof ? { headlines: (t.headlines ?? []).slice(0, 1).map((h) => ({ title: h.title, url: h.url, by: h.by, reactions: h.reactions ?? 0 })) } : {}) });
    return {
      slug: board.slug, title: board.title, description: board.description, proof: board.proof === true, ai: this.tables().ai,
      days: c.days, from: c.from, to: c.to, baselineOk: c.baselineOk, volumeDays: days, steadyHidden: c.terms.length - pool.length,
      groups: shown.map((g) => ({ name: g.name, weight: g.weight, items: c.items[g.key] ?? 0, perDay: by[g.key] })),
      top: top.map(out), rising: rising(c.terms, 10).map((t) => out(describe(t))),
      shared: pool.filter((t) => t.kind === 'shared').slice(0, 10).map((t) => out(describe(t))), single: pool.filter((t) => t.kind === 'single').slice(0, 10).map((t) => out(describe(t))),
    };
  }
  private async signalTerm(term: string) {
    const { of, groups } = await this.groups(), { days, by } = this.volume(of, groups);
    const docs: Record<string, number[]> = Object.fromEntries(groups.map((g) => [g.key, days.map(() => 0)]));
    for (const r of this.ctx.storage.sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${this.tables().terms} WHERE term IN (SELECT value FROM json_each(?)) AND day >= ?`, JSON.stringify(this.namesOf(term)), days[0])) {
      const g = of.get(r.watch), i = days.indexOf(r.day);
      if (g && i >= 0) docs[g][i] += r.n;
    }
    // A few recent items that mention it. The feed holds the latest items only, so older mentions are counted but not shown.
    const samples: unknown[] = [], ai = this.aiTopics(days[0]), aliasT = this.aliasFn();
    for (const r of this.ctx.storage.sql.exec<{ watch: string; label: string; seen_at: number; json: string; source: string }>('SELECT watch, label, seen_at, json, source FROM feed ORDER BY seq DESC LIMIT 2000')) {
      const tweet = JSON.parse(r.json) as { id?: string; text?: string; feed?: string; feedUrl?: string };
      if (!(ai ? ai.get(`${r.watch}\n${tweet.id}`) ?? [] : extractTerms(String(tweet.text ?? ''))).some((t) => aliasT(t) === term)) continue;
      if (r.source !== 'x') tweet.feed ??= r.label;
      samples.push({ watchId: r.watch, group: of.get(r.watch) ?? '', label: r.label, seenAt: r.seen_at, source: r.source, tweet });
      if (samples.length >= 12) break;
    }
    return { term, days, groups: groups.map((g) => ({ key: g.key, name: g.name, docs: docs[g.key], items: by[g.key] })), samples };
  }
  /**
   * The proof for a topic: every logged item in the window that mentions one of its terms, with the sources and groups they come from.
   * `filter` narrows the list (and only the list) to one group or one source; the counts always cover the whole window.
   */
  private async signalItems(q: { terms: string[]; days: number; group: string; watch: string; offset: number; limit: number; only?: Set<string> }) {
    const days = Math.min(SIGNAL_MAX_DAYS, Math.max(1, Math.floor(q.days) || 7)), now = Date.now();
    const from = dayOf(now - (days - 1) * 86_400_000), to = dayOf(now);
    const { of, groups } = await this.groups(), names = new Map(groups.map((g) => [g.key, g.name] as const));
    const labels = new Map(this.watches().map((w) => [w.id, w.label] as const)), ai = this.aiTopics(from);
    const alias = this.aliasFn(), want = new Set(q.terms.map((t) => alias(t.toLowerCase().trim())).filter(Boolean));
    if (!want.size) throw new Error('term required');
    const rows = this.ctx.storage.sql.exec<{ watch: string; item: string; ts: number; title: string; url: string; disc: string; by: string; match: string; eng: number }>(
      'SELECT watch, item, ts, title, url, disc, by, match, eng FROM item_log WHERE day >= ? AND day <= ? ORDER BY ts DESC LIMIT 8000', from, to).toArray();
    const hits: Array<{ watch: string; group: string; ts: number; title: string; url: string; disc: string; by: string; match: string; eng: number; matched: string[] }> = [];
    for (const r of rows) {
      const g = of.get(r.watch); if (!g || (q.only && !q.only.has(g))) continue;
      const have = new Set((ai ? ai.get(`${r.watch}\n${r.item}`) ?? [] : extractTerms(r.match)).map(alias));
      const matched = [...want].filter((t) => have.has(t));
      if (matched.length) hits.push({ watch: r.watch, group: g, ts: r.ts, title: r.title, url: r.url, disc: r.disc, by: r.by, match: r.match, eng: r.eng, matched });
    }
    const tally = <K extends string>(key: (h: (typeof hits)[number]) => K) => { const m = new Map<K, number>(); for (const h of hits) m.set(key(h), (m.get(key(h)) ?? 0) + 1); return m; };
    const byGroup = tally((h) => h.group), byWatch = tally((h) => h.watch);
    const shown = hits.filter((h) => (!q.group || h.group === q.group) && (!q.watch || h.watch === q.watch));
    const limit = Math.min(50, Math.max(1, Math.floor(q.limit) || 20)), offset = Math.max(0, Math.floor(q.offset) || 0);
    return {
      terms: [...want], from, to, total: hits.length, shown: shown.length, truncated: rows.length >= 8000,
      groups: [...byGroup].map(([key, n]) => ({ key, name: names.get(key) ?? key, n })).sort((a, b) => b.n - a.n),
      sources: [...byWatch].map(([watch, n]) => ({ watch, label: labels.get(watch) ?? watch, group: of.get(watch) ?? '', n })).sort((a, b) => b.n - a.n).slice(0, 30),
      items: shown.slice(offset, offset + limit).map((h) => ({ watch: h.watch, label: labels.get(h.watch) ?? h.watch, group: h.group, ts: h.ts, title: cleanTitle(h.title, 200), url: h.url, discussionUrl: h.disc, by: h.by, reactions: h.eng, matched: h.matched,
        snippet: h.match.replace(/\s+/g, ' ').trim() === h.title ? '' : h.match.replace(/\s+/g, ' ').slice(0, 260) })),
      more: offset + limit < shown.length,
    };
  }
  /**
   * The proof the public page shows for one topic of a published Signal that has switched it on: titles, links, sources and dates of the items
   * (never their text), from that Signal's groups only. Null when the Signal is not public or does not show sources.
   */
  private async signalPublicItems(slug: string, term: string, daysIn: number) {
    const board = this.boards().find((b) => b.public && b.proof === true && b.slug === slug);
    if (!board) return null;
    const only = new Set(board.groups), c = await this.compute(daysIn, only);
    const topic = this.describeTopics(c, c.terms.filter(notSteady), 40).top.find((t) => t.term === term);
    const terms = topic ? [topic.term, ...topic.members] : [term];
    const r = await this.signalItems({ terms, days: c.days, group: '', watch: '', offset: 0, limit: 50, only });
    return { slug: board.slug, title: board.title, days: c.days, term, label: topic?.label ?? term, terms: r.terms, from: r.from, to: r.to, total: r.total,
      groups: r.groups.map((g) => ({ name: g.name, n: g.n })), sources: r.sources.map((x) => ({ label: x.label, group: this.groupName(r.groups, x.group), n: x.n })).slice(0, 15),
      items: r.items.map((i) => ({ title: i.title, url: i.url, discussionUrl: i.discussionUrl, source: i.label, by: i.by, group: this.groupName(r.groups, i.group), ts: i.ts })) };
  }
  /**
   * One topic of a published Signal, for its own public page: its numbers, where it shows up, how it moved day by day, what goes with it and, only when
   * the Signal shows its sources, the items behind it. Null when the Signal is not public or the topic is not in it.
   */
  private async signalPublicTopic(slug: string, term: string, daysIn: number) {
    const board = this.boards().find((b) => b.public && b.slug === slug);
    if (!board) return null;
    const c = await this.compute(daysIn, new Set(board.groups));
    const shown = c.groups.filter((g) => g.weight > 0 && (c.items[g.key] ?? 0) > 0);
    if (!shown.length) return null;
    const { top, describe } = this.describeTopics({ ...c, groups: shown }, c.terms.filter(notSteady), 40);
    let topic = top.find((t) => t.term === term || t.members.includes(term));
    if (!topic) { const raw = c.terms.find((t) => t.term === term); if (!raw) return null; topic = describe(raw) as (typeof top)[number]; }
    const T = this.tables(), sql = this.ctx.storage.sql, days: string[] = [];
    for (let ms = Date.parse(c.from + 'T00:00:00Z'); ms <= Date.parse(c.to + 'T00:00:00Z'); ms += 86_400_000) days.push(dayOf(ms));
    const gi = new Map(shown.map((g, i) => [g.key, i] as const)), docs = shown.map(() => days.map(() => 0)), items = shown.map(() => days.map(() => 0));
    for (const r of sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${T.terms} WHERE term IN (SELECT value FROM json_each(?)) AND day >= ? AND day <= ?`, JSON.stringify(this.namesOf(topic.term)), c.from, c.to)) {
      const g = gi.get(c.of.get(r.watch) ?? ''), d = days.indexOf(r.day); if (g !== undefined && d >= 0) docs[g][d] += r.n;
    }
    for (const r of sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${T.items} WHERE day >= ? AND day <= ?`, c.from, c.to)) {
      const g = gi.get(c.of.get(r.watch) ?? ''), d = days.indexOf(r.day); if (g !== undefined && d >= 0) items[g][d] += r.n;
    }
    const known = new Set(c.terms.map((t) => t.term));
    const out: Record<string, unknown> = {
      slug: board.slug, title: board.title, proof: board.proof === true, days: c.days, from: c.from, to: c.to, baselineOk: c.baselineOk,
      term: topic.term, label: topic.label, members: topic.members, signal: topic.signal, change: topic.change, isNew: topic.isNew, kind: topic.kind, breadth: topic.breadth, active: topic.active,
      reactions: topic.reactions, related: (topic.related ?? []).filter((r: string) => known.has(r)),
      groups: shown.map((g, i) => ({ name: g.name, weight: g.weight, items: c.items[g.key] ?? 0, part: topic!.groups.find((x) => x.key === g.key)?.part ?? 0, share: topic!.groups.find((x) => x.key === g.key)?.share ?? 0,
        docs: topic!.groups.find((x) => x.key === g.key)?.docs ?? 0, perDay: docs[i], perDayItems: items[i] })),
      days_: days,
    };
    if (board.proof) {
      const r = await this.signalItems({ terms: [topic.term, ...topic.members], days: c.days, group: '', watch: '', offset: 0, limit: 50, only: new Set(board.groups) });
      out.total = r.total;
      out.sources = r.sources.map((x) => ({ label: x.label, group: this.groupName(r.groups, x.group), n: x.n })).slice(0, 15);
      out.items = r.items.map((i) => ({ title: i.title, url: i.url, discussionUrl: i.discussionUrl, source: i.label, by: i.by, group: this.groupName(r.groups, i.group), ts: i.ts, reactions: i.reactions }));
    }
    return out;
  }
  private groupName(groups: Array<{ key: string; name: string }>, key: string): string { return groups.find((g) => g.key === key)?.name ?? ''; }
  private async signalGroup(key: string, daysIn: number) {
    const c = await this.compute(daysIn), g = c.groups.find((x) => x.key === key);
    if (!g) throw new Error('unknown group');
    const own = (t: (typeof c.terms)[number]) => t.groups.find((x) => x.key === key)?.share ?? 0;
    const strongest = c.terms.filter((t) => (t.groups.find((x) => x.key === key)?.docs ?? 0) >= 3).sort((a, b) => own(b) - own(a)).slice(0, 15);
    return { key, name: g.name, weight: g.weight, items: c.items[key] ?? 0, watches: g.watches, active: c.active.some((a) => a.key === key),
      strongest: strongest.map((t) => ({ term: t.term, docs: t.groups.find((x) => x.key === key)?.docs ?? 0, share: own(t), kind: t.kind, breadth: t.breadth, active: t.active })),
      distinctive: distinctive(c.terms, key, 15).map((t) => ({ term: t.term, docs: t.groups.find((x) => x.key === key)?.docs ?? 0, own: t.own, others: t.others, lift: t.lift })) };
  }

  private removeWatch(id: string): void {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM watches WHERE id = ?', id);
    sql.exec('DELETE FROM seen WHERE watch = ?', id);
    sql.exec('DELETE FROM terms WHERE watch = ?', id);
    sql.exec('DELETE FROM day_items WHERE watch = ?', id);
    for (const t of ['ai_queue', 'ai_item', 'ai_terms', 'ai_items', 'item_log']) sql.exec(`DELETE FROM ${t} WHERE watch = ?`, id);
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
            "SELECT watch, label, seen_at, json, source FROM feed WHERE watch NOT LIKE 'brief:%' AND (?1 = '' OR source = ?1) AND (?3 = '' OR watch IN (SELECT value FROM json_each(?4))) ORDER BY seq DESC LIMIT ?2", source, limit, list, ofList).toArray();
          // Items saved before they carried the name of their feed get it from the watch they came from.
          const queries = new Map(this.watches().map((w) => [w.id, w] as const));
          return json(rows.map((r) => {
            const tweet = JSON.parse(r.json) as Record<string, unknown>;
            if (r.source !== 'x') { tweet.feed ??= r.label; tweet.feedUrl ??= r.source === 'hn' ? 'https://news.ycombinator.com/' : queries.get(r.watch)?.query; }
            return { watchId: r.watch, label: r.label, seenAt: r.seen_at, source: r.source, tweet };
          }));
        }
        if (name === 'signal') return json(await this.signalOverview(Number(url.searchParams.get('days')), url.searchParams.get('board') ?? '', url.searchParams.get('steady') !== '1'));
        if (name === 'signal-term') {
          const term = (url.searchParams.get('term') ?? '').trim().toLowerCase().slice(0, 80);
          if (!term) throw new Error('term required');
          return json(await this.signalTerm(term));
        }
        if (name === 'signal-public') {   // read by every public page that shows Signal topics: kept for two minutes
          const k = `${url.searchParams.get('slug')}|${url.searchParams.get('days')}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = await this.signalPublic(url.searchParams.get('slug') ?? '', Number(url.searchParams.get('days')));
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'signal-ai') return json(this.aiStatus());
        if (name === 'signal-filter') return json(this.filterInfo());
        if (name === 'signal-public-items') {
          const out = await this.signalPublicItems(url.searchParams.get('slug') ?? '', (url.searchParams.get('term') ?? '').toLowerCase().slice(0, 80), Number(url.searchParams.get('days')));
          return out ? json(out) : json({ error: 'not shown' }, 404);
        }
        if (name === 'signal-public-topic') {
          const out = await this.signalPublicTopic(url.searchParams.get('slug') ?? '', (url.searchParams.get('term') ?? '').toLowerCase().slice(0, 80), Number(url.searchParams.get('days')));
          return out ? json(out) : json({ error: 'not shown' }, 404);
        }
        if (name === 'signal-public-boards') return json(await this.publicBoards());
        if (name === 'signal-items') {
          const p = url.searchParams;
          return json(await this.signalItems({ terms: (p.get('terms') ?? p.get('term') ?? '').split('|').slice(0, 12), days: Number(p.get('days')), group: p.get('group') ?? '', watch: p.get('watch') ?? '', offset: Number(p.get('offset')), limit: Number(p.get('limit')) }));
        }
        if (name === 'signal-group') return json(await this.signalGroup(url.searchParams.get('key') ?? '', Number(url.searchParams.get('days'))));
        return json({ error: 'unknown monitor route' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'GET or POST required' }, 405);
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      this.pubCache.clear();

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
      if (name === 'signal-alias-set') {   // merged and renamed topics, as the whole map old name -> new name
        this.setMeta('signalAliases', cleanAliases(b.aliases));
        return json(this.filterInfo());
      }
      if (name === 'signal-filter-set') {   // the whole list of words to leave out
        this.setMeta('signalFilter', cleanFilter(b.words));
        return json(this.filterInfo());
      }
      if (name === 'signal-ingest') {   // a briefing hands over the posts it fetched
        const posts = (Array.isArray(b.posts) ? b.posts : []).filter((p): p is Record<string, unknown> => !!p && typeof p === 'object');
        const slug = String(b.slug ?? '').slice(0, 40);
        if (!slug) throw new Error('slug required');
        return json(this.ingestBriefing(slug, String(b.title ?? slug).slice(0, 50), String(b.group ?? ''), posts));
      }
      if (name === 'signal-ai-retry') {   // the items the model gave up on, and a waiting error: read them again now
        const sql = this.ctx.storage.sql;
        this.ctx.storage.transactionSync(() => {
          for (const r of sql.exec<{ watch: string; item: string; day: string }>("SELECT watch, item, day FROM ai_item WHERE topics = 'null'").toArray()) {
            sql.exec('UPDATE ai_items SET n = MAX(0, n - 1) WHERE day = ? AND watch = ?', r.day, r.watch);
            sql.exec('DELETE FROM ai_item WHERE watch = ? AND item = ?', r.watch, r.item);
            sql.exec('INSERT OR IGNORE INTO ai_queue (watch, item, day, text) SELECT watch, item, day, match FROM item_log WHERE watch = ? AND item = ?', r.watch, r.item);
          }
        });
        this.setMeta('aiStatus', {}); this.setMeta('aiFails', 0);
        await this.reschedule();
        return json(this.aiStatus());
      }
      if (name === 'signal-ai-reread') {   // after a change of model or prompt: forget what the model gave the last two weeks and read it all again
        // The queue keeps at most AI_QUEUE_MAX items, so only the newest that fit are read again, and only their days are forgotten.
        const sql = this.ctx.storage.sql, floor = dayOf(Date.now() - (AI_BACKLOG_DAYS - 1) * 86_400_000), cap = AI_QUEUE_MAX - 200;
        const oldest = sql.exec<{ day: string }>('SELECT MIN(day) AS day FROM (SELECT day FROM item_log WHERE day >= ? ORDER BY ts DESC LIMIT ?)', floor, cap).one().day;
        if (!oldest) return json(this.aiStatus());
        this.ctx.storage.transactionSync(() => {
          for (const t of ['ai_item', 'ai_terms', 'ai_items']) sql.exec(`DELETE FROM ${t} WHERE day >= ?`, oldest);
          sql.exec('DELETE FROM ai_queue WHERE day >= ?', oldest);
          sql.exec('INSERT OR IGNORE INTO ai_queue (watch, item, day, text) SELECT watch, item, day, match FROM item_log WHERE day >= ? ORDER BY ts', oldest);
        });
        this.setMeta('aiStatus', {}); this.setMeta('aiFails', 0);
        await this.reschedule();
        return json(this.aiStatus());
      }
      if (name === 'signal-ai-set') {   // topics written by a model: on or off, which model, and the most it may spend in a day
        const prev = this.aiConfig(), models = modelOptions(this.env).filter((m) => !m.decider);
        const model = String(b.model ?? '') || prev.model || defaultTiers(this.env).cheap;
        if (b.enabled === true && !models.some((m) => m.id === model)) throw new Error('topics by a model need the OPENROUTER_API_KEY secret and a model from the list');
        const cap = b.dailyCap === undefined ? prev.dailyCap : Math.min(10, Math.max(0, Number(b.dailyCap)));
        if (!Number.isFinite(cap)) throw new Error('daily cap must be a number');
        this.setMeta('signalAi', { enabled: b.enabled === undefined ? prev.enabled : b.enabled === true, model, dailyCap: cap } satisfies SignalAi);
        this.setMeta('aiStatus', {}); this.setMeta('aiFails', 0);
        if (b.enabled === true) this.enqueueBacklog();
        await this.reschedule();
        return json(this.aiStatus());
      }
      if (name === 'signal-board-save') {   // create or change a top-level Signal
        const boards = this.boards(), prev = b.id ? boards.find((x) => x.id === String(b.id)) : undefined;
        if (b.id && !prev) throw new Error('unknown Signal');
        if (!prev && boards.length >= 20) throw new Error('at most 20 Signals');
        const board = this.cleanBoard(b, prev);
        this.saveBoards(prev ? boards.map((x) => (x.id === prev.id ? board : x)) : [...boards, board]);
        return json(board);
      }
      if (name === 'signal-board-delete') { this.saveBoards(this.boards().filter((x) => x.id !== String(b.id ?? ''))); return json({ ok: true }); }
      if (name === 'signal-regroup') {   // every watch in one group moves to a name you give (an existing group's name merges them); no name puts them back
        const key = String(b.key ?? ''), group = cleanGroup(b.group), names = await this.listNames();
        let n = 0, to = '';
        for (const w of this.watches()) {
          if (w.noSignal || this.groupOf(w, names).key !== key) continue;
          if (group) w.group = group; else delete w.group;
          to = this.groupOf(w, names).key;
          this.saveWatch(w); n++;
        }
        // The weight you set follows the group to its new name, unless that name already has one (a merge).
        const weights = this.getMeta<Record<string, number>>('signalWeights', {});
        if (n && to !== key) this.boardsRekey(key, to);
        if (n && to !== key && key in weights) { if (!(to in weights)) weights[to] = weights[key]; delete weights[key]; this.setMeta('signalWeights', weights); }
        return json({ ok: true, moved: n });
      }
      if (name === 'signal-delete-group') {   // stops watching every source in the group
        const key = String(b.key ?? ''), names = await this.listNames();
        const ids = this.watches().filter((w) => !w.noSignal && this.groupOf(w, names).key === key).map((w) => w.id);
        this.ctx.storage.transactionSync(() => { for (const id of ids) this.removeWatch(id); });
        const weights = this.getMeta<Record<string, number>>('signalWeights', {});
        if (key in weights) { delete weights[key]; this.setMeta('signalWeights', weights); }
        this.boardsRekey(key);
        await this.reschedule();
        return json({ ok: true, deleted: ids.length });
      }
      if (name === 'clear') { this.ctx.storage.sql.exec('DELETE FROM feed'); return json({ ok: true }); }

      const w = this.watch(String(b.id ?? ''));
      if (!w) return json({ error: 'unknown watch' }, 404);
      if (name === 'update') {
        if (b.enabled !== undefined) { w.enabled = !!b.enabled; if (w.enabled) { w.errors = 0; w.lastError = ''; w.nextRun = 0; } }
        if (b.signal !== undefined) { if (b.signal) delete w.noSignal; else w.noSignal = true; }
        if (b.group !== undefined) { const g = cleanGroup(b.group); if (g) w.group = g; else delete w.group; }
        if (b.intervalSec !== undefined) w.intervalSec = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(Number(b.intervalSec)) || w.intervalSec));
        this.saveWatch(w); await this.reschedule();
        return json(this.view(w));
      }
      if (name === 'delete') {
        this.removeWatch(w.id);
        await this.reschedule();
        return json({ ok: true });
      }
      if (name === 'check') { w.nextRun = 0; this.saveWatch(w); await this.reschedule(); return json({ ok: true }); }
      return json({ error: 'unknown monitor route' }, 404);
    } catch (err) {
      console.error('monitor request failed', name, err instanceof Error ? err.message : String(err));
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
}
