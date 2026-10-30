// History: time-sharded since_time/until_time collection, stored in the Durable Object's SQLite.
// Jobs run from alarms in time-boxed slices, so they survive eviction and deploys, and resume where
// each shard stopped (shard progress is persisted, so no tweet is bought twice).
import { DurableObject } from 'cloudflare:workers';
import { COST_PER_TWEET, json, search, Stopped, type Tweet } from '../lib/twitterapi';
import { recordCost } from '../lib/costs';
import { computeStats, epochOf } from '../history/stats';
import type { Stats } from '../history/stats';
import { complete, costOf, defaultTiers, modelOptions } from '../llm/analysis';
import { decide, decideAll, isDecider } from '../llm/decisions';
import { aggregate, BATCH, cleanSubjects, cleanThemes, decisionQuestions, decisionState, KINDS, labelSystem, labelTokens, labelUser, narrativeMessages, normKey, isTrivial, packStance, parseDecision, parseJson, parseLabels, parseLines, parseProposal, proposeMessages, STRONG_BATCH, unpackStance } from '../history/analysis';
import type { Label, Results, Subject, Theme } from '../history/analysis';

const PAGE = 20;
const SHARDS_ALLOWED = [900, 1800, 3600, 21_600, 86_400, 604_800];
const MAX_SHARDS = 20_000;
const SLICE_MS = 10 * 60_000; // one alarm run; well inside the 15 minute alarm limit
const epoch = (t: Tweet) => Math.floor(Date.parse(t.createdAt) / 1000);
const REPORT_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PAGE_SIZE = 50;        // tweets per page on a public report

/** The AI analysis of a job's tweets: themes, stance toward named subjects, and a written summary. Cheap model for the bulk, a stronger one only where needed. */
interface AnalysisConfig { themes: Theme[]; subjects: Subject[]; cheap: string; strong: string; budget: number; maxLabel: number; escalate: number }
interface Analysis {
  status: 'draft' | 'running' | 'paused' | 'done' | 'error'; phase: string; error: string; config: AnalysisConfig; public: boolean; stale?: boolean;
  progress: { toLabel: number; labelled: number; escalated: number; copied: number; trivial: number; sampledOut: number };
  spend: { cheap: number; strong: number; tokensIn: number; tokensOut: number; calls: number };
  results?: Results; narrative?: string; startedAt: number; finishedAt: number;
}
const MAX_BATCH_FAILS = 2, ANALYSIS_SLICE_MS = 8 * 60_000, PARALLEL = 3;
// A decision model labels one tweet per request, so a slice stops after this many requests and the next alarm carries on.
const SLICE_REQUESTS = 700, DECIDER_CONCURRENCY = 10;     // well under the 1000 subrequests one invocation may make: a batch in flight and the later steps need room
const OUT_OF_REQUESTS = /too many subrequests/i;
/** A stable number in [0, 1) for an id, so the same tweets are sampled every time. */
const frac = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100_000) / 100_000; };

/** A job saved as a named report, optionally published at /history/<slug>. The statistics live in report_stats; the tweets stay in the job. */
interface Report { slug: string; title: string; description: string; listed: boolean; published: boolean; publishedAt: number; statsAt: number; stale?: boolean }

interface Filters { excludeReplies: boolean; excludeRetweets: boolean; minFaves: number; lang: string }
interface Job {
  id: string; created: number; status: 'running' | 'paused' | 'done' | 'capped' | 'error';
  query: string; queries?: string[]; fromTs: number; toTs: number; shardSec: number; filters: Filters;
  concurrency: number; maxTweets: number; tweets: number; calls: number; cost: number;
  error: string; startedAt: number; finishedAt: number; report?: Report;
}

// `query` is the base query for one group (words + a group of accounts); operators are added per window.
const queryFor = (query: string, f: Filters, a: number, b: number) =>
  [query, `since_time:${a}`, `until_time:${b}`, f.excludeReplies && '-filter:replies', f.minFaves > 0 && `min_faves:${f.minFaves}`, f.lang && `lang:${f.lang}`]
    .filter(Boolean).join(' ');

export class HistoryDO extends DurableObject<Env> {
  private runtime = new Map<string, { abort: boolean }>();
  /** Set when a call failed because this invocation has used all its subrequests: the slice ends and the next one carries on. Those failures are not the tweets' fault. */
  private outOfRequests = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS tweets (job TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (job, id))');
    sql.exec('CREATE TABLE IF NOT EXISTS report_stats (job TEXT PRIMARY KEY, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS tweet_index (job TEXT NOT NULL, id TEXT NOT NULL, ts INTEGER NOT NULL, likes INTEGER NOT NULL, PRIMARY KEY (job, id))');   // what a public page sorts and pages by
    sql.exec('CREATE INDEX IF NOT EXISTS tweet_index_ts ON tweet_index (job, ts, id)');
    sql.exec('CREATE INDEX IF NOT EXISTS tweet_index_likes ON tweet_index (job, likes, ts, id)');
    sql.exec('CREATE TABLE IF NOT EXISTS analysis (job TEXT PRIMARY KEY, data TEXT NOT NULL)');
    // theme: >= 0 labelled (themes.length = other); -2 waiting for the cheap model; -3 left out by the sample; -4 needs the strong model; -5 a duplicate waiting for its original
    sql.exec('CREATE TABLE IF NOT EXISTS labels (job TEXT NOT NULL, id TEXT NOT NULL, key TEXT NOT NULL, likes INTEGER NOT NULL DEFAULT 0, theme INTEGER NOT NULL, kind INTEGER NOT NULL DEFAULT 7, stance TEXT NOT NULL DEFAULT \'\', unsure INTEGER NOT NULL DEFAULT 0, tier INTEGER NOT NULL DEFAULT 0, rep TEXT NOT NULL DEFAULT \'\', PRIMARY KEY (job, id))');
    sql.exec('CREATE INDEX IF NOT EXISTS labels_by_theme ON labels (job, theme)');
    sql.exec('CREATE TABLE IF NOT EXISTS shards (job TEXT NOT NULL, idx INTEGER NOT NULL, until_ts INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (job, idx))');
    // A collection or analysis that was running when this object was restarted (a deploy, an eviction) carries on: make sure a timer is set.
    ctx.blockConcurrencyWhile(async () => {
      const analysing = sql.exec<{ data: string }>('SELECT data FROM analysis').toArray().some((r) => (JSON.parse(r.data) as Analysis).status === 'running');
      if ((analysing || this.jobs().some((x) => x.status === 'running')) && (await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 1000);
    });
  }

  // ---- storage helpers
  private job(id: string): Job | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM jobs WHERE id = ?', id).toArray()[0];
    return row ? (JSON.parse(row.data) as Job) : undefined;
  }
  private jobs(): Job[] {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM jobs').toArray().map((r) => JSON.parse(r.data) as Job);
  }
  private saveJob(j: Job): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO jobs (id, data) VALUES (?, ?)', j.id, JSON.stringify(j)); }
  // A job may hold several queries (a long list split into groups); shard i = (time window, query).
  private nq = (j: Job) => j.queries?.length || 1;
  private shardCount = (j: Job) => Math.ceil((j.toTs - j.fromTs) / j.shardSec) * this.nq(j);
  private shardOf(j: Job, i: number): { a: number; b: number; base: string } {
    const q = this.nq(j), t = Math.floor(i / q), a = j.fromTs + t * j.shardSec;
    return { a, b: Math.min(a + j.shardSec, j.toTs), base: j.queries?.[i % q] ?? j.query };
  }
  private view(j: Job) {
    const done = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM shards WHERE job = ? AND done = 1', j.id).one().n;
    const an = this.analysisOf(j.id);
    return { ...j, shardsDone: done, shardsTotal: this.shardCount(j), ...(an ? { analysis: { status: an.status, phase: an.phase, error: an.error, stale: !!an.stale, public: an.public, progress: an.progress, cost: an.spend.cheap + an.spend.strong, hasResults: !!an.results } } : {}) };
  }

  // ---- reports
  /** Every stored tweet of a job, one row at a time. */
  private *tweetsOf(id: string): Generator<Tweet> {
    for (const r of this.ctx.storage.sql.exec<{ json: string }>('SELECT json FROM tweets WHERE job = ?', id)) yield JSON.parse(r.json) as Tweet;
  }
  /** Computes the report's statistics and the index its public pages page by, in one pass over the tweets. */
  private buildReport(j: Job): void {
    const sql = this.ctx.storage.sql, self = this;
    sql.exec('DELETE FROM tweet_index WHERE job = ?', j.id);
    const indexed = function* (): Generator<Tweet> {
      for (const t of self.tweetsOf(j.id)) {
        const ts = epochOf(t);
        sql.exec('INSERT OR REPLACE INTO tweet_index (job, id, ts, likes) VALUES (?, ?, ?, ?)', j.id, t.id, Number.isFinite(ts) ? ts : 0, t.likeCount ?? 0);
        yield t;
      }
    };
    const stats = computeStats(indexed(), { fromTs: j.fromTs, toTs: j.toTs });
    sql.exec('INSERT OR REPLACE INTO report_stats (job, data) VALUES (?, ?)', j.id, JSON.stringify(stats));
  }
  private dropReport(id: string): void {
    this.ctx.storage.sql.exec('DELETE FROM report_stats WHERE job = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM tweet_index WHERE job = ?', id);
  }
  private publishedReport(slug: string): Job | undefined { return this.jobs().find((j) => j.report?.published && j.report.slug === slug); }

  // ---- AI analysis
  private analysisOf(id: string): Analysis | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM analysis WHERE job = ?', id).toArray()[0];
    return row ? (JSON.parse(row.data) as Analysis) : undefined;
  }
  private saveAnalysis(id: string, a: Analysis): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO analysis (job, data) VALUES (?, ?)', id, JSON.stringify(a)); }
  private dropAnalysis(id: string): void {
    this.ctx.storage.sql.exec('DELETE FROM analysis WHERE job = ?', id); this.ctx.storage.sql.exec('DELETE FROM labels WHERE job = ?', id);
  }
  private emptyAnalysis(config: AnalysisConfig): Analysis {
    return { status: 'draft', phase: '', error: '', config, public: false, progress: { toLabel: 0, labelled: 0, escalated: 0, copied: 0, trivial: 0, sampledOut: 0 },
      spend: { cheap: 0, strong: 0, tokensIn: 0, tokensOut: 0, calls: 0 }, startedAt: 0, finishedAt: 0 };
  }
  /** Settings from the admin: themes and subjects as lists or "Name: description" lines, models only from those on offer, numbers kept in range. */
  private cleanConfig(b: Record<string, unknown>, prev?: AnalysisConfig): AnalysisConfig {
    const options = modelOptions(this.env), ids = options.map((m) => m.id), writers = options.filter((m) => !m.decider).map((m) => m.id), def = defaultTiers(this.env);
    const pick = (v: unknown, d: string, from = ids) => (typeof v === 'string' && from.includes(v) ? v : d);
    const list = (v: unknown, clean: (r: unknown) => Array<{ name: string; description: string }>, old: Array<{ name: string; description: string }> | undefined) =>
      v === undefined ? old ?? [] : clean(Array.isArray(v) ? v : parseLines(String(v)));
    const num = (v: unknown, lo: number, hi: number, d: number) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Math.min(hi, Math.max(lo, Number(v))));
    return {
      themes: list(b.themes, cleanThemes, prev?.themes), subjects: list(b.subjects, cleanSubjects, prev?.subjects),
      cheap: pick(b.cheap, prev?.cheap && ids.includes(prev.cheap) ? prev.cheap : def.cheap), strong: pick(b.strong, prev?.strong && writers.includes(prev.strong) ? prev.strong : def.strong, writers),
      budget: num(b.budget, 0.05, 20, prev?.budget ?? 2), maxLabel: Math.round(num(b.maxLabel, 100, 100_000, prev?.maxLabel ?? 20_000)), escalate: num(b.escalate, 0, 0.3, prev?.escalate ?? 0.1),
    };
  }

  /** A sample of the tweets for proposing themes: the best liked ones and a random handful. */
  private sampleTweets(id: string): Array<{ id: string; handle: string; text: string; likes: number }> {
    type S = { id: string; handle: string; text: string; likes: number };
    const top: S[] = [], rand: S[] = []; let seen = 0;
    for (const t of this.tweetsOf(id)) {
      const it: S = { id: t.id, handle: t.author?.userName ?? '', text: t.text ?? '', likes: t.likeCount ?? 0 };
      if (it.text.trim().length < 12) continue;
      seen++;
      if (rand.length < 60) rand.push(it); else { const j = Math.floor(Math.random() * seen); if (j < 60) rand[j] = it; }
      if (top.length < 100) { top.push(it); top.sort((a, b) => b.likes - a.likes); } else if (it.likes > top[99].likes) { top[99] = it; top.sort((a, b) => b.likes - a.likes); }
    }
    const have = new Set(top.map((x) => x.id));
    return [...top, ...rand.filter((x) => !have.has(x.id))].slice(0, 150);
  }

  /** What labelling would involve and cost, from the stored tweets, before anything is spent. */
  private estimate(j: Job, c: AnalysisConfig) {
    const keys = new Map<string, number>(); let tweets = 0, trivial = 0, dups = 0, chars = 0;
    for (const t of this.tweetsOf(j.id)) {
      tweets++;
      const k = normKey(t.text ?? '');
      if (isTrivial(k)) { trivial++; continue; }
      if (keys.has(k)) { dups++; continue; }
      keys.set(k, 1); chars += (t.text ?? '').length;
    }
    const unique = keys.size, toLabel = Math.min(unique, c.maxLabel), avg = unique ? chars / unique : 0;
    const cheap = labelTokens({ texts: toLabel, avgChars: avg, themes: c.themes.length, subjects: c.subjects.length }, isDecider(c.cheap) ? 1 : BATCH);   // a decision model takes one tweet per request
    const cheapCost = costOf(c.cheap, cheap.tokensIn, cheap.tokensOut);
    const re = Math.ceil(toLabel * (c.escalate + 0.02)), strong = labelTokens({ texts: re, avgChars: avg, themes: c.themes.length, subjects: c.subjects.length }, STRONG_BATCH);
    const strongLabel = costOf(c.strong, strong.tokensIn, strong.tokensOut), narrative = costOf(c.strong, 9000, 2400), propose = costOf(c.strong, 12_000, 3000);
    return { tweets, trivial, duplicates: dups, unique, toLabel, sampledOut: unique - toLabel, calls: cheap.calls + strong.calls + 1,
      cheapCost, escalateCost: strongLabel, narrativeCost: narrative, proposeCost: propose, total: cheapCost + strongLabel + narrative };
  }

  /** Prepares the work: trivial and duplicate tweets are labelled without a model, a sample is chosen if there are too many, the rest wait for the cheap model. */
  private prepareLabels(j: Job, a: Analysis): void {
    const sql = this.ctx.storage.sql, have = new Set<string>(), reps = new Map<string, string>();
    for (const r of sql.exec<{ id: string; key: string; tier: number; theme: number }>('SELECT id, key, tier, theme FROM labels WHERE job = ?', j.id)) { have.add(r.id); if (r.tier < 2 && r.theme !== -5) reps.set(r.key, r.id); }
    let fresh = 0; const seen = new Set<string>(reps.keys());
    for (const t of this.tweetsOf(j.id)) { if (have.has(t.id)) continue; const k = normKey(t.text ?? ''); if (!isTrivial(k) && !seen.has(k)) { seen.add(k); fresh++; } }
    const already = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM labels WHERE job = ? AND theme <> -5 AND tier < 2 AND theme <> -3', j.id).one().n;
    const room = Math.max(0, a.config.maxLabel - already), p = fresh <= room ? 1 : room / Math.max(1, fresh), other = a.config.themes.length, dash = '.'.repeat(a.config.subjects.length);
    const insert = (t: Tweet, key: string, theme: number, kind: number, stance: string, tier: number, rep: string) =>
      sql.exec('INSERT OR REPLACE INTO labels (job, id, key, likes, theme, kind, stance, unsure, tier, rep) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)', j.id, t.id, key, t.likeCount ?? 0, theme, kind, stance, tier, rep);
    for (const t of this.tweetsOf(j.id)) {
      if (have.has(t.id)) continue;
      const k = normKey(t.text ?? '');
      if (isTrivial(k)) { insert(t, k, other, 7, dash, 2, ''); continue; }
      const rep = reps.get(k);
      if (rep) { insert(t, k, -5, 7, '', 2, rep); continue; }
      reps.set(k, t.id);
      insert(t, k, frac(t.id) < p ? -2 : -3, 7, '', 0, '');
    }
    const n = (where: string) => sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM labels WHERE job = ? AND ${where}`, j.id).one().n;
    a.progress = { toLabel: n('tier < 2 AND theme <> -3 AND theme <> -5'), labelled: n('tier < 2 AND theme >= 0'), escalated: n('tier = 1'), copied: n('tier = 2 AND rep <> \'\''), trivial: n('tier = 2 AND rep = \'\''), sampledOut: n('theme = -3') };
  }

  private refreshProgress(id: string, a: Analysis): void {
    const sql = this.ctx.storage.sql, n = (where: string) => sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM labels WHERE job = ? AND ${where}`, id).one().n;
    a.progress.labelled = n('tier < 2 AND theme >= 0'); a.progress.escalated = n('tier = 1');
  }

  /** Labels one batch with a model. Returns the valid labels by position; a failure to parse is not an error (those tweets just stay waiting). */
  private async labelBatch(model: string, a: Analysis, texts: string[], spend: 'cheap' | 'strong'): Promise<Map<number, Label>> {
    const c = a.config, other = c.themes.length;
    if (isDecider(model)) return this.decideBatch(model, a, texts, spend);
    const mock = () => JSON.stringify({ labels: texts.map((t, i) => { const h = Math.floor(frac(t) * 1000); return { i: i + 1, t: h % (other + 1), k: h % KINDS.length, s: c.subjects.map((_, j) => ((h + j) % 4 === 3 ? null : [1, -1, 0][(h + j) % 3])), u: h % 12 === 0 ? 1 : 0 }; }) });
    const r = await complete(this.env, model, [labelSystem(c.themes, c.subjects), labelUser(texts)], { maxTokens: 4000, mock });
    a.spend[spend] += r.cost; a.spend.tokensIn += r.tokensIn; a.spend.tokensOut += r.tokensOut; a.spend.calls++;
    let got = new Map<number, Label>();
    try { got = parseLabels(parseJson(r.text), texts.length, other, c.subjects.length); } catch { /* counted below */ }
    if (got.size < texts.length) console.warn(`analysis: ${model} gave ${got.size} usable labels for ${texts.length} tweets (${r.tokensOut} tokens out). Answer began: ${r.text.slice(0, 240).replace(/\s+/g, ' ')}`);
    return got;
  }
  /** The same, with a decision model: one request per tweet (a few at a time), typed answers instead of JSON. A failed request leaves that tweet waiting, as a failed batch does. */
  private async decideBatch(model: string, a: Analysis, texts: string[], spend: 'cheap' | 'strong'): Promise<Map<number, Label>> {
    const c = a.config, other = c.themes.length, questions = decisionQuestions(c.themes, c.subjects), got = new Map<number, Label>();
    const mock = (t: string) => () => {
      const h = Math.floor(frac(t) * 1000);
      return { theme: { type: 'choice' as const, choice: `t${h % (other + 1)}`, confidence: h % 12 === 0 ? 0.3 : 0.9 }, kind: { type: 'choice' as const, choice: KINDS[h % KINDS.length] },
        ...Object.fromEntries(c.subjects.map((_, j) => [`s${j}`, { type: 'choice' as const, choice: ['for', 'against', 'neutral', 'none'][(h + j) % 4] }])) };
    };
    let firstError = '';
    const out = await decideAll(texts, DECIDER_CONCURRENCY, (t) => decide(this.env, model, decisionState(t), questions, { mock: mock(t) }), () => false, (err) => { firstError ||= String((err as Error)?.message ?? err); });
    out.forEach((d, i) => {
      a.spend.calls++;
      if (!d) return;
      a.spend[spend] += d.cost; a.spend.tokensIn += d.tokensIn;
      const l = parseDecision(d.answers, other, c.subjects.length);
      if (l) got.set(i, l);
    });
    if (OUT_OF_REQUESTS.test(firstError)) this.outOfRequests = true;       // the tweets without a label wait for the next slice
    if (got.size < texts.length) console.warn(`analysis: ${model} gave ${got.size} usable labels for ${texts.length} tweets.${firstError ? ' First error: ' + firstError.slice(0, 200) : ''}`);
    return got;
  }
  private textsOf(job: string, ids: string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      for (const r of this.ctx.storage.sql.exec<{ id: string; json: string }>(`SELECT id, json FROM tweets WHERE job = ? AND id IN (${part.map(() => '?').join(',')})`, job, ...part)) out.set(r.id, (JSON.parse(r.json) as Tweet).text ?? '');
    }
    return out;
  }
  private applyLabel(job: string, id: string, l: Label, tier: number): void {
    this.ctx.storage.sql.exec('UPDATE labels SET theme = ?, kind = ?, stance = ?, unsure = ?, tier = ? WHERE job = ? AND id = ?', l.theme, l.kind, packStance(l.stance), l.unsure ? 1 : 0, tier, job, id);
  }

  /** One time-boxed run of an analysis: label (cheap model), re-check what needs it (strong model), then aggregate and write the summary (strong model, once). */
  private async runAnalysis(id: string, deadline: number): Promise<void> {
    const key = 'a:' + id, job = this.job(id); let a = this.analysisOf(id);
    if (!job || !a || a.status !== 'running' || this.runtime.has(key)) return;
    const rt = { abort: false }; this.runtime.set(key, rt);
    const sql = this.ctx.storage.sql, before = { ...a.spend }, c = a.config, other = c.themes.length, fails = new Map<string, number>();
    const persist = () => { const cur = this.analysisOf(id); if (!cur) { rt.abort = true; return; } if (cur.status !== 'running') a!.status = cur.status; this.saveAnalysis(id, a!); };
    const overBudget = () => a!.spend.cheap + a!.spend.strong >= c.budget;
    this.outOfRequests = false;
    const sliceFull = () => this.outOfRequests || a!.spend.calls - before.calls >= SLICE_REQUESTS;
    const stop = () => rt.abort || Date.now() > deadline || overBudget() || sliceFull();
    try {
      // 1. the cheap model labels everything that is waiting
      a.phase = 'labelling';
      while (!stop()) {
        const ids = sql.exec<{ id: string }>('SELECT id FROM labels WHERE job = ? AND theme = -2 LIMIT ?', id, BATCH * PARALLEL).toArray().map((r) => r.id);
        if (!ids.length) break;
        const texts = this.textsOf(id, ids);
        const chunks: string[][] = []; for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
        await Promise.all(chunks.map(async (chunk) => {
          let got = new Map<number, Label>();
          try { got = await this.labelBatch(c.cheap, a!, chunk.map((x) => texts.get(x) ?? ''), 'cheap'); }
          catch (err) { if (/\b(401|402|403)\b|credit/i.test(String((err as Error)?.message))) throw err; if (OUT_OF_REQUESTS.test(String((err as Error)?.message))) this.outOfRequests = true; console.warn('analysis: batch failed:', (err as Error)?.message); /* the tweets are tried again */ }
          chunk.forEach((tid, i) => {
            const l = got.get(i);
            if (l) this.applyLabel(id, tid, l, 0);
            else if (!this.outOfRequests) { const n = (fails.get(tid) ?? 0) + 1; fails.set(tid, n); if (n >= MAX_BATCH_FAILS) sql.exec('UPDATE labels SET theme = -4 WHERE job = ? AND id = ?', id, tid); }
          });
        }));
        this.refreshProgress(id, a); persist();
        if (rt.abort) return;
      }
      // 2. the stronger model re-checks only what the cheap one could not do or was unsure about, within a cap
      if (!stop() && !sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM labels WHERE job = ? AND theme = -2', id).one().n) {
        a.phase = 're-checking';
        const labelled = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM labels WHERE job = ? AND tier = 0 AND theme >= 0', id).one().n;
        const cap = Math.ceil((labelled + sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM labels WHERE job = ? AND theme = -4', id).one().n) * c.escalate);
        const hard = sql.exec<{ id: string }>('SELECT id FROM labels WHERE job = ? AND theme = -4', id).toArray().map((r) => r.id);
        if (hard.length > 20 && hard.length > 0.3 * (labelled + hard.length)) {      // a model that cannot do this would make the strong model redo everything
          a.status = 'error'; a.error = `The cheap model could not label ${Math.round((100 * hard.length) / (labelled + hard.length))}% of the tweets in a usable form. Pick another cheap model (see the list), and run again.`;
          this.ctx.storage.sql.exec('UPDATE labels SET theme = -2 WHERE job = ? AND theme = -4', id);
          return;
        }
        const unsure = c.escalate > 0 ? sql.exec<{ id: string }>('SELECT id FROM labels WHERE job = ? AND unsure = 1 AND tier = 0 AND theme >= 0 ORDER BY likes DESC LIMIT ?', id, cap).toArray().map((r) => r.id) : [];
        const todo = [...new Set([...hard, ...unsure])];
        for (let i = 0; i < todo.length && !stop(); i += STRONG_BATCH * PARALLEL) {
          const part = todo.slice(i, i + STRONG_BATCH * PARALLEL), texts = this.textsOf(id, part);
          const chunks: string[][] = []; for (let k = 0; k < part.length; k += STRONG_BATCH) chunks.push(part.slice(k, k + STRONG_BATCH));
          await Promise.all(chunks.map(async (chunk) => {
            let got = new Map<number, Label>();
            try { got = await this.labelBatch(c.strong, a!, chunk.map((x) => texts.get(x) ?? ''), 'strong'); }
            catch (err) { if (/\b(401|402|403|429)\b|credit/i.test(String((err as Error)?.message))) throw err; if (OUT_OF_REQUESTS.test(String((err as Error)?.message))) this.outOfRequests = true; }
            chunk.forEach((tid, k) => {
              const l = got.get(k);
              if (l) this.applyLabel(id, tid, { ...l, unsure: false }, 1);
              else if (!this.outOfRequests) sql.exec('UPDATE labels SET unsure = 0, theme = CASE WHEN theme = -4 THEN ? ELSE theme END, kind = CASE WHEN theme = -4 THEN 7 ELSE kind END, stance = CASE WHEN theme = -4 THEN ? ELSE stance END, tier = CASE WHEN theme = -4 THEN 1 ELSE tier END WHERE job = ? AND id = ?', other, '.'.repeat(c.subjects.length), id, tid);
            });
          }));
          this.refreshProgress(id, a); persist();
          if (rt.abort) return;
        }
        if (!stop()) sql.exec('UPDATE labels SET unsure = 0 WHERE job = ? AND unsure = 1', id);      // anything beyond the cap keeps its cheap label
      }
      if (rt.abort) return;
      if (overBudget()) { a.status = 'paused'; a.error = `The budget of ${c.budget} USD is used up. Raise it and resume to carry on.`; return; }
      if (Date.now() > deadline || sliceFull()) return;        // the next slice carries on
      // 3. copy each duplicate's label from its original, then count
      a.phase = 'counting';
      sql.exec(`UPDATE labels SET theme = (SELECT r.theme FROM labels r WHERE r.job = labels.job AND r.id = labels.rep), kind = (SELECT r.kind FROM labels r WHERE r.job = labels.job AND r.id = labels.rep),
        stance = (SELECT r.stance FROM labels r WHERE r.job = labels.job AND r.id = labels.rep) WHERE job = ? AND theme = -5`, id);
      const map = new Map<string, Label>();
      for (const r of sql.exec<{ id: string; theme: number; kind: number; stance: string }>('SELECT id, theme, kind, stance FROM labels WHERE job = ? AND theme >= 0', id)) map.set(r.id, { theme: r.theme, kind: r.kind, stance: unpackStance(r.stance), unsure: false });
      const self = this, authors = new Map<string, number>();
      const items = function* () { for (const t of self.tweetsOf(id)) { if (t.author?.userName) authors.set(t.author.userName, (authors.get(t.author.userName) ?? 0) + 1); yield { tweet: t, label: map.get(t.id) ?? null }; } };
      a.results = aggregate(items(), c.themes, c.subjects, { fromTs: job.fromTs, toTs: job.toTs });
      this.refreshProgress(id, a); persist();
      // 4. the summary: one call to the stronger model, from the numbers and a few top tweets
      a.phase = 'writing';
      await this.writeNarrative(job, a, [...authors].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([h, n]) => `@${h} (${n})`));
      a.status = 'done'; a.phase = ''; a.finishedAt = Date.now(); a.stale = false;
    } catch (err) {
      a.status = 'error'; a.error = err instanceof Error ? err.message : String(err); console.error('analysis failed', id, a.error);
    } finally {
      this.runtime.delete(key);
      if (this.analysisOf(id)) { const cur = this.analysisOf(id)!; if (cur.status === 'paused' && a.status === 'running') a.status = 'paused'; this.saveAnalysis(id, a); }
      await this.recordAnalysisCost(job, before, a);
    }
  }

  private async writeNarrative(job: Job, a: Analysis, topAccounts: string[]): Promise<void> {
    if (!a.results) return;
    const period = `${new Date(job.fromTs * 1000).toISOString().slice(0, 10)} to ${new Date((job.toTs - 1) * 1000).toISOString().slice(0, 10)}`;
    const mock = () => `## Summary\nMock summary of ${a.results!.labelled} tweets.\n\n## Storylines\n${a.results!.themes.filter((t) => t.count).map((t) => `${t.name}: ${t.count} tweets${t.top[0] ? ` ([@${t.top[0].handle}](${t.top[0].url}))` : ''}.`).join('\n\n')}\n\n## Caveats\nMock.`;
    try {
      const r = await complete(this.env, a.config.strong, narrativeMessages(job.query, period, a.config.themes, a.config.subjects, a.results, topAccounts), { maxTokens: 2500, mock });
      a.spend.strong += r.cost; a.spend.tokensIn += r.tokensIn; a.spend.tokensOut += r.tokensOut; a.spend.calls++;
      a.narrative = r.text.replace(/<[^>]*>/g, '').trim().slice(0, 6000); a.error = '';
    } catch (err) { a.error = `The numbers are ready but the summary could not be written: ${err instanceof Error ? err.message : String(err)}`; }
  }

  private async recordAnalysisCost(job: Job, before: Analysis['spend'], a: Analysis): Promise<void> {
    for (const tier of ['cheap', 'strong'] as const) {
      const d = a.spend[tier] - before[tier];
      if (d > 0) await recordCost(this.env, { kind: 'analysis', ref: job.id, label: `${job.query.slice(0, 80)} · analysis (${tier} model)`, llm: d, model: a.config[tier], run: { ok: a.status !== 'error', note: `${a.progress.labelled} labelled` } });
    }
  }

  // ---- collection
  async alarm(): Promise<void> {
    for (const j of this.jobs().filter((x) => x.status === 'running')) {
      try { await this.runSlice(j.id, Date.now() + SLICE_MS); }
      catch (err) { console.error('history slice failed', err instanceof Error ? err.message : String(err)); }
    }
    for (const x of this.ctx.storage.sql.exec<{ job: string; data: string }>('SELECT job, data FROM analysis').toArray()) {
      if ((JSON.parse(x.data) as Analysis).status !== 'running') continue;
      try { await this.runAnalysis(x.job, Date.now() + ANALYSIS_SLICE_MS); }
      catch (err) { console.error('analysis slice failed', err instanceof Error ? err.message : String(err)); }
    }
    const analysing = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM analysis').toArray().some((r) => (JSON.parse(r.data) as Analysis).status === 'running');
    if (analysing || this.jobs().some((x) => x.status === 'running')) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  private async runSlice(id: string, deadline: number): Promise<void> {
    const first = this.job(id);
    if (!first || first.status !== 'running' || this.runtime.has(id)) return;
    const rt = { abort: false }; this.runtime.set(id, rt);
    const sql = this.ctx.storage.sql;
    let job = first;
    if (!job.startedAt) job.startedAt = Date.now();
    const total = this.shardCount(job);
    const doneSet = new Set(sql.exec<{ idx: number }>('SELECT idx FROM shards WHERE job = ? AND done = 1', id).toArray().map((r) => r.idx));
    const queue: number[] = [];
    for (let i = total - 1; i >= 0; i--) if (!doneSet.has(i)) queue.push(i); // newest first
    // Save progress without clobbering a stop() or delete that happened while we were awaiting.
    const persist = (): void => {
      const cur = this.job(id);
      if (!cur) { rt.abort = true; return; }       // deleted meanwhile
      if (cur.status !== 'running') job.status = cur.status;
      this.saveJob(job);
    };
    const capReached = () => job.tweets >= job.maxTweets;
    const stopNow = () => rt.abort || capReached() || Date.now() > deadline;

    const scan = async (idx: number): Promise<void> => {
      const { a, b, base } = this.shardOf(job, idx);
      const saved = sql.exec<{ until_ts: number }>('SELECT until_ts FROM shards WHERE job = ? AND idx = ?', id, idx).toArray()[0];
      let until = saved?.until_ts ?? b;
      while (!stopNow()) {
        const r = await search({ key: this.env.TWITTERAPI_IO_KEY, query: queryFor(base, job.filters, a, until), signal: rt });
        if (rt.abort) return;                            // stopped or deleted while the request was in flight
        const got = r.tweets ?? [];
        let fresh = 0;
        for (const t of got) {
          if (job.filters.excludeRetweets && (t.retweeted_tweet || /^RT @/.test(t.text ?? ''))) continue;
          const c = sql.exec('INSERT OR IGNORE INTO tweets (job, id, json) VALUES (?, ?, ?)', id, t.id, JSON.stringify(t));
          fresh += c.rowsWritten > 0 ? 1 : 0;
        }
        job.calls++; job.cost += Math.max(1, got.length) * COST_PER_TWEET; job.tweets += fresh;
        await recordCost(this.env, { kind: 'history', ref: id, label: job.query.slice(0, 100), twitter: Math.max(1, got.length) * COST_PER_TWEET, tweets: got.length, calls: 1 });
        let finished = got.length < PAGE;
        if (!finished) {
          const earliest = Math.min(...got.map(epoch));
          if (!Number.isFinite(earliest)) finished = true;
          else {
            let next = earliest + 1;            // +1 so tweets sharing the earliest second aren't skipped
            if (next >= until) next = earliest; // a whole page in one second: still make progress
            if (next >= until) finished = true; else until = next;
          }
        }
        sql.exec('INSERT OR REPLACE INTO shards (job, idx, until_ts, done) VALUES (?, ?, ?, ?)', id, idx, until, finished ? 1 : 0);
        persist();
        if (finished) return;
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(job.concurrency, queue.length) }, async () => {
        while (queue.length && !stopNow()) await scan(queue.shift() as number);
      }));
      const latest = this.job(id);                  // stop() may have changed the status meanwhile
      if (!latest) return;                          // job was deleted
      job.status = latest.status === 'paused' ? 'paused' : capReached() ? 'capped'
        : this.view(job).shardsDone >= total ? 'done' : 'running';
    } catch (err) {
      if (err instanceof Stopped) job.status = 'paused';
      else { job.status = 'error'; job.error = err instanceof Error ? err.message : String(err); }
    } finally {
      this.runtime.delete(id);
      if (job.status !== 'running') job.finishedAt = Date.now();
      if (this.job(id)) this.saveJob(job);
    }
  }

  // ---- probe (one sample day, <= 3 calls)
  private async probe(b: Record<string, unknown>) {
    const groups = this.queryList(b.queries);
    const query = groups[0] ?? String(b.query ?? '').trim();
    const fromTs = Math.floor(Number(b.fromTs)), toTs = Math.floor(Number(b.toTs));
    const f = this.filters(b.filters);
    if (!query || !(toTs > fromTs)) throw new Error('invalid probe request');
    const day = Math.min(86_400, toTs - fromTs);
    const a = fromTs + Math.floor((toTs - fromTs - day) / 2);
    let until = a + day, capped = false; const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = await search({ key: this.env.TWITTERAPI_IO_KEY, query: queryFor(query, f, a, until) });
      const ts = r.tweets ?? [];
      ts.forEach((t) => ids.add(t.id));
      if (ts.length < PAGE) break;
      if (i === 2) { capped = true; break; }
      const earliest = Math.min(...ts.map(epoch));
      until = earliest + 1 >= until ? earliest : earliest + 1;
    }
    const sampled = ids.size, perDay = sampled * (86_400 / day);
    return { sampleDayStart: a, sampled, capped, perDay, suggestedShardSec: perDay >= 50 ? 3600 : 86_400,
      estTweets: Math.round((perDay * (toTs - fromTs)) / 86_400) * Math.max(1, groups.length), samplingCost: Math.max(1, sampled) * COST_PER_TWEET };
  }

  private queryList(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.map((q) => String(q).trim()).filter((q) => q && q.length <= 480).slice(0, 40) : [];
  }

  private filters(raw: unknown): Filters {
    const f = (raw ?? {}) as Record<string, unknown>;
    return {
      excludeReplies: !!f.excludeReplies, excludeRetweets: !!f.excludeRetweets, minFaves: Math.max(0, Number(f.minFaves) || 0),
      lang: /^[a-z]{2,3}$/i.test(String(f.lang ?? '')) ? String(f.lang).toLowerCase() : '',
    };
  }

  // ---- streaming the stored tweets
  private stream(id: string, mapRow: (json: string) => string, header: string, footer: string): ReadableStream<Uint8Array> {
    const cursor = this.ctx.storage.sql.exec<{ json: string }>('SELECT json FROM tweets WHERE job = ?', id);
    const enc = new TextEncoder(); let first = true, started = false;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!started) { started = true; if (header) controller.enqueue(enc.encode(header)); }
        let out = '', n = 0;
        for (const row of cursor) {
          const piece = mapRow(row.json);
          out += (first || !header ? '' : ',') + piece; first = false;
          if (++n >= 500) break;
        }
        if (out) controller.enqueue(enc.encode(out));
        if (n < 500) { if (footer) controller.enqueue(enc.encode(footer)); controller.close(); }
      },
    });
  }

  // ---- HTTP API (same routes and JSON as the local server)
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = url.pathname.replace(/^\/hist\//, '');
    const id = url.searchParams.get('id') ?? '';
    try {
      if (request.method === 'GET') {
        if (name === 'jobs') return json(this.jobs().sort((a, b) => b.created - a.created).map((j) => this.view(j)));
        // What the public site reads (only published reports; never cost). Reached by the Worker's public pages, not by a browser.
        if (name === 'pub-reports') {
          return json(this.jobs().filter((x) => x.report?.published && x.report.listed).sort((a, b) => b.report!.publishedAt - a.report!.publishedAt)
            .map((x) => ({ slug: x.report!.slug, title: x.report!.title, description: x.report!.description, tweets: x.tweets, fromTs: x.fromTs, toTs: x.toTs, publishedAt: x.report!.publishedAt })));
        }
        if (name === 'pub-report' || name === 'pub-tweets') {
          const pj = this.publishedReport(url.searchParams.get('slug') ?? '');
          if (!pj?.report) return json({ error: 'not found' }, 404);
          if (name === 'pub-report') {
            const stats = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM report_stats WHERE job = ?', pj.id).toArray()[0], an = this.analysisOf(pj.id);
            if (!stats) return json({ error: 'not found' }, 404);
            return json({ report: { slug: pj.report.slug, title: pj.report.title, description: pj.report.description, publishedAt: pj.report.publishedAt },
              job: { query: pj.query, fromTs: pj.fromTs, toTs: pj.toTs, filters: pj.filters, status: pj.status, maxTweets: pj.maxTweets }, stats: JSON.parse(stats.data) as Stats,
              ...(an?.public && an.status === 'done' && an.results ? { analysis: { narrative: an.narrative ?? '', results: an.results, themes: an.config.themes, subjects: an.config.subjects } } : {}) });
          }
          const sort = url.searchParams.get('sort') === 'top' ? 'top' : 'new', page = Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1);
          const total = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM tweet_index WHERE job = ?', pj.id).one().n;
          const order = sort === 'top' ? 'i.likes DESC, i.ts DESC, i.id DESC' : 'i.ts DESC, i.id DESC';
          const rows = this.ctx.storage.sql.exec<{ json: string }>(`SELECT t.json FROM tweet_index i JOIN tweets t ON t.job = i.job AND t.id = i.id WHERE i.job = ? ORDER BY ${order} LIMIT ? OFFSET ?`, pj.id, PAGE_SIZE, (page - 1) * PAGE_SIZE).toArray();
          return json({ total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page, sort, tweets: rows.map((r) => publicTweet(JSON.parse(r.json) as Tweet)) });
        }
        const j = this.job(id);
        if (!j) return json({ error: 'unknown job' }, 404);
        if (name === 'analysis') return json({ analysis: this.analysisOf(id) ?? null, defaults: defaultTiers(this.env), models: modelOptions(this.env), kinds: KINDS });
        if (name === 'job') return json(this.view(j));
        if (name === 'data') {
          return new Response(this.stream(id, (s) => JSON.stringify(normalize(JSON.parse(s) as Tweet)), '[', ']'),
            { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        }
        if (name === 'raw') {
          return new Response(this.stream(id, (s) => s + '\n', '', ''),
            { headers: { 'content-type': 'application/x-ndjson', 'content-disposition': `attachment; filename="tweets-${id}.jsonl"` } });
        }
        return json({ error: 'unknown history route' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'GET or POST required' }, 405);
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

      if (name === 'probe') return json(await this.probe(b));
      if (name === 'start') {
        const query = String(b.query ?? '').trim();
        if (!query || query.length > 500) throw new Error('query required (max 500 chars)');
        const fromTs = Math.floor(Number(b.fromTs)), toTs = Math.floor(Number(b.toTs));
        if (!(fromTs > 1.1e9 && toTs > fromTs)) throw new Error('invalid date range');
        const shardSec = SHARDS_ALLOWED.includes(Number(b.shardSec)) ? Number(b.shardSec) : 86_400;
        const queries = this.queryList(b.queries);
        if (Math.ceil((toTs - fromTs) / shardSec) * Math.max(1, queries.length) > MAX_SHARDS) throw new Error(`too many shards (max ${MAX_SHARDS}); use bigger shards or a shorter range`);
        const job: Job = {
          id: crypto.randomUUID().slice(0, 8), created: Date.now(), status: 'running', query, queries: queries.length ? queries : undefined, fromTs, toTs, shardSec,
          filters: this.filters(b.filters), concurrency: Math.min(12, Math.max(1, Number(b.concurrency) || 4)),
          maxTweets: Math.min(1_000_000, Math.max(1, Number(b.maxTweets) || 50_000)),
          tweets: 0, calls: 0, cost: 0, error: '', startedAt: 0, finishedAt: 0,
        };
        this.saveJob(job);
        await this.ctx.storage.setAlarm(Date.now() + 500);
        return json(this.view(job));
      }

      const j = this.job(String(b.id ?? ''));
      if (!j) return json({ error: 'unknown job' }, 404);
      if (name === 'stop') {
        const rt = this.runtime.get(j.id);
        if (rt) rt.abort = true;
        if (j.status === 'running') { j.status = 'paused'; this.saveJob(j); }
        return json({ ok: true });
      }
      if (name === 'analysis-save') {
        if (j.status === 'running') throw new Error('wait for the collection to finish, or stop it, before analysing');
        const prev = this.analysisOf(j.id);
        if (prev?.status === 'running') throw new Error('stop the analysis before changing it');
        const config = this.cleanConfig(b, prev?.config);
        const a = prev ?? this.emptyAnalysis(config);
        const changed = !!prev && JSON.stringify([prev.config.themes, prev.config.subjects]) !== JSON.stringify([config.themes, config.subjects]);
        if (changed) { this.ctx.storage.sql.exec('DELETE FROM labels WHERE job = ?', j.id); Object.assign(a, this.emptyAnalysis(config), { public: a.public }); }
        a.config = config; if (typeof b.public === 'boolean') a.public = b.public;
        this.saveAnalysis(j.id, a);
        return json({ analysis: a, reset: changed });
      }
      if (name === 'analysis-propose') {
        if (!j.tweets) throw new Error('nothing was collected');
        const ids = modelOptions(this.env).filter((m) => !m.decider).map((m) => m.id), model = typeof b.model === 'string' && ids.includes(b.model) ? b.model : defaultTiers(this.env).strong;
        if (!model) throw new Error('no language model is available: add the OPENROUTER_API_KEY secret');
        const period = `${new Date(j.fromTs * 1000).toISOString().slice(0, 10)} to ${new Date((j.toTs - 1) * 1000).toISOString().slice(0, 10)}`;
        const mock = () => JSON.stringify({ themes: [{ name: 'News and releases', description: 'Announcements and coverage.' }, { name: 'Opinion and debate', description: 'People arguing a position.' }, { name: 'Questions and help', description: 'People asking for advice.' }], subjects: [{ name: 'The main topic', description: 'Whatever the search is about.' }] });
        const messages = proposeMessages(j.query, period, this.sampleTweets(j.id));
        let cost = 0, proposal: ReturnType<typeof parseProposal> | undefined, failure: unknown;
        for (let attempt = 0; attempt < 3 && !proposal; attempt++) {         // models now and then answer in prose or run out of room: ask again
          try { const r = await complete(this.env, model, messages, { maxTokens: 3000 + 1000 * attempt, mock }); cost += r.cost; proposal = parseProposal(parseJson(r.text)); }
          catch (err) { failure = err; if (/\b(401|402|403)\b|credit/i.test(String((err as Error)?.message))) break; }
        }
        if (cost) await recordCost(this.env, { kind: 'analysis', ref: j.id, label: `${j.query.slice(0, 80)} · analysis (proposing subjects)`, llm: cost, model, run: { ok: !!proposal, note: 'themes and subjects' } });
        if (!proposal) throw failure instanceof Error ? failure : new Error('the model proposed nothing usable');
        return json({ ...proposal, model, cost });
      }
      if (name === 'analysis-estimate') {
        const config = this.cleanConfig(b, this.analysisOf(j.id)?.config);
        return json({ config, estimate: this.estimate(j, config) });
      }
      if (name === 'analysis-start') {
        const a = this.analysisOf(j.id);
        if (!a || !a.config.themes.length) throw new Error('add at least one theme first (write them, or let the AI propose them)');
        if (j.status === 'running') throw new Error('wait for the collection to finish, or stop it, before analysing');
        if (a.status === 'running') throw new Error('already running');
        if (a.status === 'done' && !a.stale) throw new Error('this analysis is finished: change the themes or subjects to run it again, or write the summary again');
        if (!a.config.cheap || !a.config.strong) throw new Error('no language model is available: add the OPENROUTER_API_KEY secret');
        this.prepareLabels(j, a);
        a.status = 'running'; a.error = ''; a.phase = 'labelling'; a.startedAt = a.startedAt || Date.now(); a.finishedAt = 0;
        this.saveAnalysis(j.id, a);
        await this.ctx.storage.setAlarm(Date.now() + 500);
        return json({ analysis: a });
      }
      if (name === 'analysis-stop') {
        const a = this.analysisOf(j.id), rt = this.runtime.get('a:' + j.id);
        if (rt) rt.abort = true;
        if (a?.status === 'running') { a.status = 'paused'; this.saveAnalysis(j.id, a); }
        return json({ ok: true });
      }
      if (name === 'analysis-narrative') {
        const a = this.analysisOf(j.id);
        if (!a?.results || a.status === 'running') throw new Error('nothing to summarise yet');
        const before = { ...a.spend };
        await this.writeNarrative(j, a, []);
        this.saveAnalysis(j.id, a); await this.recordAnalysisCost(j, before, a);
        return json({ analysis: a });
      }
      if (name === 'analysis-reset') {
        if (this.analysisOf(j.id)?.status === 'running') throw new Error('stop the analysis first');
        this.dropAnalysis(j.id);
        return json({ ok: true });
      }
      if (name === 'report-save') {
        if (j.status === 'running') throw new Error('wait for the collection to finish, or stop it, before saving a report');
        if (!j.tweets) throw new Error('nothing was collected, so there is nothing to report');
        const slug = String(b.slug ?? '').trim().toLowerCase(), title = String(b.title ?? '').trim().slice(0, 120);
        if (!title) throw new Error('give the report a title');
        if (!REPORT_SLUG.test(slug)) throw new Error('the address may use lowercase letters, digits and hyphens (up to 40)');
        if (this.jobs().some((x) => x.id !== j.id && x.report?.slug === slug)) throw new Error('another report already has that address');
        if (j.report?.published && j.report.slug !== slug) throw new Error('unpublish the report before changing its address');
        this.buildReport(j);
        j.report = { slug, title, description: String(b.description ?? '').trim().slice(0, 400), listed: b.listed !== false, published: j.report?.published ?? false, publishedAt: j.report?.publishedAt ?? 0, statsAt: Date.now() };
        this.saveJob(j);
        return json(this.view(j));
      }
      if (name === 'report-publish') {
        if (!j.report) throw new Error('save the report first');
        if (b.published === true) {
          if (j.report.stale || j.status === 'running') throw new Error('the collection changed after the report was saved: save the report again first');
          j.report.published = true; j.report.publishedAt = j.report.publishedAt || Date.now();
        } else j.report.published = false;
        this.saveJob(j);
        return json(this.view(j));
      }
      if (name === 'report-delete') {
        delete j.report; this.dropReport(j.id); this.saveJob(j);
        return json(this.view(j));
      }
      if (name === 'resume') {
        if (this.runtime.has(j.id)) return json({ ok: false });
        if (j.report?.published) throw new Error('unpublish the report before resuming: the public page would change while it grows');
        if (j.report) j.report.stale = true;
        const an = this.analysisOf(j.id); if (an) { an.stale = true; this.saveAnalysis(j.id, an); }
        if (Number(b.maxTweets) > 0) j.maxTweets = Math.min(1_000_000, Number(b.maxTweets));
        j.status = 'running'; j.error = ''; j.finishedAt = 0; this.saveJob(j);
        await this.ctx.storage.setAlarm(Date.now() + 500);
        return json({ ok: true });
      }
      if (name === 'delete') {
        if (j.report?.published) throw new Error('unpublish the report before deleting this job');
        const rt = this.runtime.get(j.id); if (rt) rt.abort = true;
        this.dropReport(j.id); this.dropAnalysis(j.id);
        const sql = this.ctx.storage.sql;
        sql.exec('DELETE FROM tweets WHERE job = ?', j.id); sql.exec('DELETE FROM shards WHERE job = ?', j.id); sql.exec('DELETE FROM jobs WHERE id = ?', j.id);
        return json({ ok: true });
      }
      console.error('unknown history route', request.method, name, url.pathname);
      return json({ error: `unknown history route: ${request.method} ${name} (job ${j.id}, status ${j.status})` }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
}

/** What a public report shows of a tweet: the text, who wrote it, when, and the counts. No profile pictures (the public pages load nothing from elsewhere). */
const publicTweet = (t: Tweet) => ({
  id: t.id, url: /^https:\/\/(x|twitter)\.com\//.test(t.url ?? '') ? t.url : t.author?.userName ? `https://x.com/${t.author.userName}/status/${t.id}` : '',
  text: t.text ?? '', createdAt: t.createdAt, lang: t.lang ?? '', isReply: !!t.isReply,
  likeCount: t.likeCount ?? 0, retweetCount: t.retweetCount ?? 0, replyCount: t.replyCount ?? 0, viewCount: t.viewCount ?? 0,
  author: { userName: t.author?.userName ?? '', name: t.author?.name ?? '' },
});

const normalize = (t: Tweet) => ({
  id: t.id, url: t.url, text: t.text, createdAt: t.createdAt, lang: t.lang, isReply: !!t.isReply,
  likeCount: t.likeCount ?? 0, retweetCount: t.retweetCount ?? 0, replyCount: t.replyCount ?? 0, quoteCount: t.quoteCount ?? 0,
  viewCount: t.viewCount ?? 0,
  author: { id: t.author?.id, userName: t.author?.userName, name: t.author?.name, profilePicture: t.author?.profilePicture },
  entities: {
    hashtags: (t.entities?.hashtags ?? []).map((h) => ({ text: h.text })),
    urls: (t.entities?.urls ?? []).map((u) => ({ url: u.url, expanded_url: u.expanded_url })),
  },
});
