// Monitor: polling watches stored in the Durable Object's SQLite, checked from alarms.
// Same behaviour as the local server: persisted checkpoint + seen ids, overlap window, backoff,
// daily spend cap. The browser polls /mon/state and /mon/feed (no long-lived streams to pay for).
import { DurableObject } from 'cloudflare:workers';
import { COST_PER_TWEET, OutOfCredits, json, search, slim, type Tweet } from '../lib/twitterapi';
import { recordCost } from '../lib/costs';

const OVERLAP = 90;        // seconds re-read before the checkpoint; duplicates removed by id
const MAX_PAGES = 5;
const SEEN_KEEP = 1000;
const FEED_KEEP = 500;
const MAX_WATCHES = 25;
const MIN_INTERVAL = 15, MAX_INTERVAL = 86_400;
const MAX_INFLIGHT = 3;

interface Watch {
  id: string; label: string; query: string; originalsOnly: boolean; includeRetweets: boolean;
  intervalSec: number; enabled: boolean; created: number; lastCheckedTs: number; nextRun: number;
  checks: number; found: number; cost: number; lastRun: number; lastError: string; errors: number;
}
interface Spend { day: string; cost: number }

const today = () => new Date().toISOString().slice(0, 10); // UTC day

export class MonitorDO extends DurableObject<Env> {
  private running = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS watches (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS seen (watch TEXT NOT NULL, tweet TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (watch, tweet))');
    sql.exec('CREATE TABLE IF NOT EXISTS feed (seq INTEGER PRIMARY KEY AUTOINCREMENT, watch TEXT NOT NULL, label TEXT NOT NULL, seen_at INTEGER NOT NULL, json TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
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
    const base = [w.query, w.originalsOnly && '-filter:replies', w.includeRetweets && 'include:nativeretweets'].filter(Boolean).join(' ');
    return { ...w, running: this.running.has(w.id), fullQuery: base };
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
    if (this.spend().cost >= this.cap()) next = Math.max(next, Date.now() + 600_000); // capped: look again in 10 min
    await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }

  async alarm(): Promise<void> {
    try {
      if (this.spend().cost < this.cap()) {
        const now = Date.now();
        const due = this.watches().filter((w) => w.enabled && w.nextRun <= now && !this.running.has(w.id));
        for (let i = 0; i < due.length; i += MAX_INFLIGHT) {
          await Promise.all(due.slice(i, i + MAX_INFLIGHT).map((w) => this.check(w.id)));
        }
      }
    } catch (err) {
      console.error('monitor alarm failed', err instanceof Error ? err.message : String(err));
    }
    await this.reschedule();
  }

  private async check(id: string): Promise<void> {
    const w0 = this.watch(id);
    if (!w0) return;
    this.running.add(id);
    const sql = this.ctx.storage.sql;
    const startTs = Math.floor(Date.now() / 1000);
    const base = [w0.query, w0.originalsOnly && '-filter:replies', w0.includeRetweets && 'include:nativeretweets'].filter(Boolean).join(' ');
    const since = Math.max(w0.lastCheckedTs - OVERLAP, w0.created - 1);
    const found: Tweet[] = [];
    let cursor = '', pages = 0, truncated = false, cost = 0, error = '', fatal = false;
    try {
      while (pages < MAX_PAGES) {
        const r = await search({ key: this.env.TWITTERAPI_IO_KEY, query: `${base} since_time:${since}`, cursor });
        const tweets = r.tweets ?? []; pages++;
        const c = Math.max(1, tweets.length) * COST_PER_TWEET; cost += c; this.addSpend(c);
        await recordCost(this.env, { kind: 'monitor', ref: id, label: w0.label, twitter: c, tweets: tweets.length, calls: 1 });
        for (const t of tweets) {
          const seen = sql.exec('SELECT 1 FROM seen WHERE watch = ? AND tweet = ?', id, t.id).toArray().length > 0;
          if (seen) continue;
          sql.exec('INSERT OR IGNORE INTO seen (watch, tweet, at) VALUES (?, ?, ?)', id, t.id, Date.now());
          found.push(t);
        }
        if (!r.has_next_page || !r.next_cursor || !tweets.length) break;
        if (pages === MAX_PAGES) truncated = true;
        cursor = r.next_cursor;
      }
      if (truncated) error = `burst larger than ${MAX_PAGES * 20} tweets; some may be missed`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      fatal = true; // checkpoint stays put so the same window is retried
      if (err instanceof OutOfCredits) error = err.message;
    }

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
      }
      found.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)); // oldest first, feed ends newest
      w.found += found.length;
      this.ctx.storage.transactionSync(() => {
        for (const t of found) {
          sql.exec('INSERT INTO feed (watch, label, seen_at, json) VALUES (?, ?, ?, ?)', id, w.label, Date.now(), JSON.stringify(slim(t)));
        }
        sql.exec('DELETE FROM feed WHERE seq <= (SELECT MAX(seq) FROM feed) - ?', FEED_KEEP);
        sql.exec('DELETE FROM seen WHERE watch = ?1 AND rowid NOT IN (SELECT rowid FROM seen WHERE watch = ?1 ORDER BY at DESC LIMIT ?2)', id, SEEN_KEEP);
        this.saveWatch(w);
      });
    }
    this.running.delete(id);
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
          const rows = this.ctx.storage.sql.exec<{ watch: string; label: string; seen_at: number; json: string }>(
            'SELECT watch, label, seen_at, json FROM feed ORDER BY seq DESC LIMIT ?', limit).toArray();
          return json(rows.map((r) => ({ watchId: r.watch, label: r.label, seenAt: r.seen_at, tweet: JSON.parse(r.json) as unknown })));
        }
        return json({ error: 'unknown monitor route' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'GET or POST required' }, 405);
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

      if (name === 'add') {
        if (this.watches().length >= MAX_WATCHES) throw new Error(`at most ${MAX_WATCHES} watches`);
        let query = String(b.query ?? '').trim();
        if (b.kind === 'account') query = 'from:' + query.replace(/^@/, '');
        if (!query || query.length > 400 || (b.kind === 'account' && !/^from:\w{1,15}$/.test(query))) throw new Error('invalid account or query');
        const intervalSec = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(Number(b.intervalSec)) || 60));
        const now = Math.floor(Date.now() / 1000);
        const w: Watch = {
          id: crypto.randomUUID().slice(0, 8), label: b.kind === 'account' ? '@' + query.slice(5) : String(b.label ?? '').trim().slice(0, 60) || query, query,
          originalsOnly: !!b.originalsOnly, includeRetweets: !!b.includeRetweets, intervalSec, enabled: true,
          created: now, lastCheckedTs: now, nextRun: 0, checks: 0, found: 0, cost: 0, lastRun: 0, lastError: '', errors: 0,
        };
        this.saveWatch(w); await this.reschedule();
        return json(this.view(w));
      }
      if (name === 'settings') {
        const cap = Number(b.dailyCap);
        if (cap >= 0) this.setMeta('settings', { dailyCap: Math.min(1000, cap) });
        await this.reschedule();
        return json(this.snapshot());
      }
      if (name === 'clear') { this.ctx.storage.sql.exec('DELETE FROM feed'); return json({ ok: true }); }

      const w = this.watch(String(b.id ?? ''));
      if (!w) return json({ error: 'unknown watch' }, 404);
      if (name === 'update') {
        if (b.enabled !== undefined) { w.enabled = !!b.enabled; if (w.enabled) { w.errors = 0; w.lastError = ''; w.nextRun = 0; } }
        if (b.intervalSec !== undefined) w.intervalSec = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(Number(b.intervalSec)) || w.intervalSec));
        this.saveWatch(w); await this.reschedule();
        return json(this.view(w));
      }
      if (name === 'delete') {
        this.ctx.storage.sql.exec('DELETE FROM watches WHERE id = ?', w.id);
        this.ctx.storage.sql.exec('DELETE FROM seen WHERE watch = ?', w.id);
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
