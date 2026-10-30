// Near-real-time monitoring by polling advanced_search with since_time, as described in
// twitterapi.io's "monitor Twitter accounts" guide. Differences from the guide's sample script:
//  - the checkpoint and seen-ids are persisted (a restart neither misses nor repeats tweets)
//  - each window overlaps the previous one slightly; duplicates are removed by tweet id
//  - failures keep the old checkpoint, retry with backoff, and never lose the window
//  - a daily spend cap stops runaway polling costs
import { EventEmitter } from 'node:events';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { search } from './twitterapi.js';

const COST = 0.00015;          // USD per returned tweet; an empty call is billed as one tweet
const OVERLAP = 90;            // seconds: re-read a little before the checkpoint to catch late-indexed tweets
const MAX_PAGES = 5;           // per check; a burst larger than 100 tweets is flagged
const SEEN_KEEP = 1000;
const FEED_KEEP = 500;
const MAX_WATCHES = 25;
const MIN_INTERVAL = 15, MAX_INTERVAL = 86400;
const MAX_INFLIGHT = 3;
const today = () => new Date().toLocaleDateString('sv');

export class Monitor extends EventEmitter {
  constructor({ dir, key, upstream }) {
    super();
    this.dir = dir; this.key = key; this.upstream = upstream;
    this.watches = new Map(); this.feed = []; this.running = new Set();
    this.settings = { dailyCap: 2 };       // USD
    this.spend = { day: today(), cost: 0 };
    this.timer = null; this.saveTimer = null;
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    try {
      const d = JSON.parse(await readFile(join(this.dir, 'monitor.json'), 'utf8'));
      this.settings = { ...this.settings, ...d.settings };
      if (d.spend?.day === today()) this.spend = d.spend;
      for (const w of d.watches ?? []) { w.seen = new Set(w.seen ?? []); w.nextRun = 0; this.watches.set(w.id, w); }
    } catch {}
    try {
      const lines = (await readFile(join(this.dir, 'feed.jsonl'), 'utf8')).split('\n').filter(Boolean);
      this.feed = lines.slice(-FEED_KEEP).map((l) => JSON.parse(l)).reverse(); // newest first
      if (lines.length > FEED_KEEP * 4) await writeFile(join(this.dir, 'feed.jsonl'), lines.slice(-FEED_KEEP).join('\n') + '\n');
    } catch {}
    this.timer = setInterval(() => this.#tick(), 1000);
  }

  #queryOf(w) {
    return [w.query, w.originalsOnly && '-filter:replies', w.includeRetweets && 'include:nativeretweets'].filter(Boolean).join(' ');
  }
  view(w) { const { seen, ...r } = w; return { ...r, running: this.running.has(w.id), fullQuery: this.#queryOf(w) }; }
  snapshot() {
    this.#rollDay();
    return { watches: [...this.watches.values()].map((w) => this.view(w)), settings: this.settings, spend: this.spend,
      capped: this.spend.cost >= this.settings.dailyCap };
  }
  #rollDay() { if (this.spend.day !== today()) this.spend = { day: today(), cost: 0 }; }

  #save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => writeFile(join(this.dir, 'monitor.json'), JSON.stringify({
      settings: this.settings, spend: this.spend,
      watches: [...this.watches.values()].map((w) => ({ ...w, seen: [...w.seen].slice(-SEEN_KEEP), running: undefined })),
    })).catch(() => {}), 300);
  }

  add(p) {
    if (this.watches.size >= MAX_WATCHES) throw new Error(`at most ${MAX_WATCHES} watches`);
    let query = String(p.query ?? '').trim();
    if (p.kind === 'account') query = 'from:' + query.replace(/^@/, '');
    if (!query || query.length > 400 || (p.kind === 'account' && !/^from:\w{1,15}$/.test(query))) throw new Error('invalid account or query');
    const intervalSec = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(Number(p.intervalSec)) || 60));
    const now = Math.floor(Date.now() / 1000);
    const w = { id: randomUUID().slice(0, 8), label: p.kind === 'account' ? '@' + query.slice(5) : String(p.label ?? '').trim().slice(0, 60) || query, query,
      originalsOnly: !!p.originalsOnly, includeRetweets: !!p.includeRetweets, intervalSec, enabled: true,
      created: now, lastCheckedTs: now, seen: new Set(), nextRun: 0, checks: 0, found: 0, cost: 0,
      lastRun: 0, lastError: '', errors: 0 };
    this.watches.set(w.id, w); this.#save();
    return this.view(w);
  }

  update(id, p) {
    const w = this.watches.get(id); if (!w) throw new Error('unknown watch');
    if (p.enabled !== undefined) { w.enabled = !!p.enabled; if (w.enabled) { w.errors = 0; w.lastError = ''; w.nextRun = 0; } }
    if (p.intervalSec !== undefined) w.intervalSec = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(Number(p.intervalSec)) || w.intervalSec));
    this.#save(); return this.view(w);
  }
  remove(id) { this.watches.delete(id); this.#save(); }
  setSettings(p) { if (Number(p.dailyCap) >= 0) this.settings.dailyCap = Math.min(1000, Number(p.dailyCap)); this.#save(); }
  checkNow(id) { const w = this.watches.get(id); if (!w) throw new Error('unknown watch'); w.nextRun = 0; }
  async clearFeed() { this.feed = []; await writeFile(join(this.dir, 'feed.jsonl'), ''); }

  #tick() {
    this.#rollDay();
    if (this.spend.cost >= this.settings.dailyCap) return;
    const now = Date.now();
    for (const w of this.watches.values()) {
      if (this.running.size >= MAX_INFLIGHT) break;
      if (!w.enabled || this.running.has(w.id) || now < w.nextRun) continue;
      this.running.add(w.id);
      this.#check(w).finally(() => { this.running.delete(w.id); this.emit('state'); });
    }
  }

  async #check(w) {
    const startTs = Math.floor(Date.now() / 1000), base = this.#queryOf(w);
    const since = Math.max(w.lastCheckedTs - OVERLAP, w.created - 1);
    const found = []; let cursor = '', pages = 0, truncated = false;
    try {
      while (pages < MAX_PAGES) {
        const r = await search({ upstream: this.upstream, key: this.key, query: `${base} since_time:${since}`, cursor });
        const tweets = r.tweets ?? []; pages++;
        const c = Math.max(1, tweets.length) * COST; w.cost += c; this.spend.cost += c;
        const fresh = tweets.filter((t) => !w.seen.has(t.id));
        fresh.forEach((t) => w.seen.add(t.id)); found.push(...fresh);
        if (!r.has_next_page || !r.next_cursor || !tweets.length) break;
        if (pages === MAX_PAGES) truncated = true;
        cursor = r.next_cursor;
      }
      w.lastCheckedTs = startTs; w.checks++; w.errors = 0; w.lastError = truncated ? `burst larger than ${MAX_PAGES * 20} tweets; some may be missed` : '';
      w.nextRun = Date.now() + w.intervalSec * 1000;
    } catch (e) {
      w.errors++; w.lastError = String(e.message ?? e); // checkpoint untouched: the same window is retried
      if (e.code === 402) { w.enabled = false; }
      else w.nextRun = Date.now() + Math.min(600, w.intervalSec * 2 ** Math.min(w.errors, 6)) * 1000;
    }
    w.lastRun = Date.now();
    if (w.seen.size > SEEN_KEEP * 2) w.seen = new Set([...w.seen].slice(-SEEN_KEEP));
    found.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)); // oldest first, so the feed ends newest
    const items = found.map((t) => ({ watchId: w.id, label: w.label, seenAt: Date.now(), tweet: slim(t) }));
    if (items.length) {
      w.found += items.length;
      await appendFile(join(this.dir, 'feed.jsonl'), items.map((i) => JSON.stringify(i) + '\n').join('')).catch(() => {});
      for (const i of items) { this.feed.unshift(i); this.emit('tweet', i); }
      this.feed.length = Math.min(this.feed.length, FEED_KEEP);
    }
    this.#save();
  }
}

const slim = (t) => ({ id: t.id, url: t.url, text: t.text, createdAt: t.createdAt, lang: t.lang, isReply: !!t.isReply,
  likeCount: t.likeCount ?? 0, retweetCount: t.retweetCount ?? 0, replyCount: t.replyCount ?? 0, quoteCount: t.quoteCount ?? 0,
  viewCount: t.viewCount ?? 0, isRetweet: !!t.retweeted_tweet,
  author: { id: t.author?.id, userName: t.author?.userName, name: t.author?.name, profilePicture: t.author?.profilePicture },
  entities: { hashtags: (t.entities?.hashtags ?? []).map((h) => ({ text: h.text })),
    urls: (t.entities?.urls ?? []).map((u) => ({ url: u.url, expanded_url: u.expanded_url })) } });
