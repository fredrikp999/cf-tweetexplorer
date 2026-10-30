// Historical tweet collection, following twitterapi.io's "scrape twitter history" approach:
//  - bound each query with since_time / until_time (unix seconds)
//  - never use cursors; slide until_time backwards inside independent time shards
//  - dedupe by tweet id, checkpoint finished shards, keep raw JSONL for re-analysis
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { search } from './twitterapi.js';

const PAGE = 20;                       // tweets per advanced_search call
const COST_PER_TWEET = 0.00015;        // USD; every call is billed for at least one tweet
const SHARDS_ALLOWED = [900, 1800, 3600, 21600, 86400, 604800];
const MAX_SHARDS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const epoch = (t) => Math.floor(Date.parse(t.createdAt) / 1000);

export class History {
  constructor({ dir, key, upstream }) {
    this.dir = dir; this.key = key; this.upstream = upstream;
    this.jobs = new Map(); this.runs = new Map(); // runs: id -> {abort:boolean}
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    for (const id of await readdir(this.dir)) {
      try {
        const j = JSON.parse(await readFile(join(this.dir, id, 'job.json'), 'utf8'));
        j.done = new Set(j.done);
        if (j.status === 'running') j.status = 'paused'; // server restarted mid-run
        this.jobs.set(j.id, j);
      } catch {}
    }
  }

  view(j) {
    const { done, ...rest } = j;
    return { ...rest, shardsDone: done.size, shardsTotal: this.#shardCount(j) };
  }
  list() { return [...this.jobs.values()].sort((a, b) => b.created - a.created).map((j) => this.view(j)); }
  get(id) { return this.jobs.get(id); }

  // A job may hold several queries; shard i is (time window, query) so progress/resume work unchanged.
  #queries(j) { return j.queries?.length || 1; }
  #shardCount(j) { return Math.ceil((j.toTs - j.fromTs) / j.shardSec) * this.#queries(j); }
  #shard(j, i) { const q = this.#queries(j), t = Math.floor(i / q), a = j.fromTs + t * j.shardSec; return [a, Math.min(a + j.shardSec, j.toTs), i % q]; }
  #file(j) { return join(this.dir, j.id, 'tweets.jsonl'); }

  #queryFor(j, a, b, qi = 0) {
    const f = j.filters;
    return [j.queries?.[qi] ?? j.query, `since_time:${a}`, `until_time:${b}`, f.excludeReplies && '-filter:replies', f.minFaves > 0 && `min_faves:${f.minFaves}`, f.lang && `lang:${f.lang}`]
      .filter(Boolean).join(' ');
  }

  #search(query, signal) { return search({ upstream: this.upstream, key: this.key, query, signal }); }

  // Estimate density from the middle day of the range: up to 3 sliding calls (<= 60 tweets).
  async probe({ query, queries, fromTs, toTs, filters }) {
    const day = Math.min(86400, toTs - fromTs);
    const a = fromTs + Math.floor((toTs - fromTs - day) / 2), b = a + day;
    const j = { query: (Array.isArray(queries) && queries[0]) || query, filters };
    const signal = { abort: false };
    let until = b, n = 0, capped = false; const ids = new Set();
    for (let i = 0; i < 3; i++) {
      const r = await this.#search(this.#queryFor(j, a, until), signal);
      const ts = r.tweets ?? [];
      ts.forEach((t) => ids.add(t.id)); n = ids.size;
      if (ts.length < PAGE) break;
      if (i === 2) { capped = true; break; }
      const earliest = Math.min(...ts.map(epoch));
      until = earliest + 1 >= until ? earliest : earliest + 1;
    }
    const perDay = n * (86400 / day);
    return { sampleDayStart: a, sampled: n, capped, perDay, suggestedShardSec: perDay >= 50 ? 3600 : 86400,
      estTweets: Math.round(perDay * (toTs - fromTs) / 86400) * (Array.isArray(queries) && queries.length ? queries.length : 1), samplingCost: Math.max(1, n) * COST_PER_TWEET };
  }

  async start(p) {
    const query = String(p.query ?? '').trim();
    if (!query || query.length > 500) throw new Error('query required (max 500 chars)');
    const fromTs = Math.floor(Number(p.fromTs)), toTs = Math.floor(Number(p.toTs));
    if (!(fromTs > 1.1e9 && toTs > fromTs)) throw new Error('invalid date range');
    const shardSec = SHARDS_ALLOWED.includes(Number(p.shardSec)) ? Number(p.shardSec) : 86400;
    const queries = Array.isArray(p.queries) ? p.queries.map((q) => String(q).trim()).filter((q) => q && q.length <= 480).slice(0, 40) : [];
    if (Math.ceil((toTs - fromTs) / shardSec) * Math.max(1, queries.length) > MAX_SHARDS) throw new Error(`too many shards (max ${MAX_SHARDS}); use bigger shards or a shorter range`);
    const f = p.filters ?? {};
    const job = {
      id: randomUUID().slice(0, 8), created: Date.now(), status: 'queued', query, queries: queries.length ? queries : undefined, fromTs, toTs, shardSec,
      filters: { excludeReplies: !!f.excludeReplies, excludeRetweets: !!f.excludeRetweets, minFaves: Math.max(0, Number(f.minFaves) || 0),
        lang: /^[a-z]{2,3}$/i.test(f.lang ?? '') ? f.lang.toLowerCase() : '' },
      concurrency: Math.min(12, Math.max(1, Number(p.concurrency) || 4)),
      maxTweets: Math.min(1_000_000, Math.max(1, Number(p.maxTweets) || 50_000)),
      done: new Set(), tweets: 0, calls: 0, cost: 0, error: '', startedAt: 0, finishedAt: 0,
    };
    await mkdir(join(this.dir, job.id), { recursive: true });
    this.jobs.set(job.id, job);
    await this.#save(job);
    this.run(job.id);
    return this.view(job);
  }

  async #save(j) { await writeFile(join(this.dir, j.id, 'job.json'), JSON.stringify({ ...j, done: [...j.done] })); }

  async run(id) {
    const job = this.jobs.get(id);
    if (!job || this.runs.has(id)) return;
    const signal = { abort: false }; this.runs.set(id, signal);
    job.status = 'running'; job.error = ''; job.startedAt = Date.now(); job.finishedAt = 0;

    // Rebuild the dedupe set (and tweet count) from what's already on disk.
    const seen = new Set();
    try {
      for await (const line of createInterface({ input: createReadStream(this.#file(job)) })) {
        const m = line.match(/"id":"(\d+)"/); if (m) seen.add(m[1]);
      }
    } catch {}
    job.tweets = seen.size;

    let writes = Promise.resolve();
    const append = (lines) => (writes = writes.then(() => appendFile(this.#file(job), lines.join(''))));
    const saver = setInterval(() => this.#save(job).catch(() => {}), 2000);

    const total = this.#shardCount(job);
    const order = []; for (let i = total - 1; i >= 0; i--) if (!job.done.has(i)) order.push(i); // newest first
    const capReached = () => job.tweets >= job.maxTweets;

    const scan = async (i) => {
      const [a, b, qi] = this.#shard(job, i);
      let until = b;
      while (!signal.abort && !capReached()) {
        const r = await this.#search(this.#queryFor(job, a, until, qi), signal);
        const got = r.tweets ?? [], fresh = [];
        for (const t of got) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          if (job.filters.excludeRetweets && (t.retweeted_tweet || /^RT @/.test(t.text ?? ''))) continue;
          fresh.push(JSON.stringify(t) + '\n');
        }
        job.calls++; job.cost += Math.max(1, got.length) * COST_PER_TWEET; job.tweets += fresh.length;
        if (fresh.length) await append(fresh);
        if (got.length < PAGE) break;
        const earliest = Math.min(...got.map(epoch));
        if (!Number.isFinite(earliest)) break;
        let next = earliest + 1;        // +1 so tweets sharing the earliest second aren't skipped (dedupe handles repeats)
        if (next >= until) next = earliest; // whole page in one second: still make progress
        if (next >= until) break;
        until = next;
      }
      if (!signal.abort && !capReached()) job.done.add(i);
    };

    try {
      const queue = [...order];
      await Promise.all(Array.from({ length: Math.min(job.concurrency, queue.length) }, async () => {
        while (queue.length && !signal.abort && !capReached()) await scan(queue.shift());
      }));
      await writes;
      job.status = signal.abort ? 'paused' : capReached() ? 'capped' : 'done';
    } catch (e) {
      signal.abort = true; await writes.catch(() => {});
      job.status = 'error'; job.error = String(e.message ?? e);
    } finally {
      clearInterval(saver); job.finishedAt = Date.now(); this.runs.delete(id);
      await this.#save(job).catch(() => {});
    }
  }

  stop(id) { const r = this.runs.get(id); if (r) r.abort = true; return !!r; }
  resume(id, maxTweets) {
    const j = this.jobs.get(id); if (!j || this.runs.has(id)) return false;
    if (Number(maxTweets) > 0) j.maxTweets = Math.min(1_000_000, Number(maxTweets));
    this.run(id); return true;
  }

  async remove(id) {
    this.stop(id);
    while (this.runs.has(id)) await sleep(100);
    this.jobs.delete(id);
    await rm(join(this.dir, id), { recursive: true, force: true });
  }

  // Compact tweet objects in the same shape the UI already renders.
  async *normalized(id) {
    const j = this.jobs.get(id); if (!j) return;
    try {
      for await (const line of createInterface({ input: createReadStream(this.#file(j)) })) {
        let t; try { t = JSON.parse(line); } catch { continue; }
        yield { id: t.id, url: t.url, text: t.text, createdAt: t.createdAt, lang: t.lang, isReply: !!t.isReply,
          likeCount: t.likeCount ?? 0, retweetCount: t.retweetCount ?? 0, replyCount: t.replyCount ?? 0, quoteCount: t.quoteCount ?? 0,
          viewCount: t.viewCount ?? 0, author: { id: t.author?.id, userName: t.author?.userName, name: t.author?.name, profilePicture: t.author?.profilePicture },
          entities: { hashtags: (t.entities?.hashtags ?? []).map((h) => ({ text: h.text })),
            urls: (t.entities?.urls ?? []).map((u) => ({ url: u.url, expanded_url: u.expanded_url })) } };
      }
    } catch {}
  }
  rawStream(id) { const j = this.jobs.get(id); return j ? createReadStream(this.#file(j)) : null; }
}
