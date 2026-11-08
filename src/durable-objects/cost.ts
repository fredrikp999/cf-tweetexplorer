// The cost ledger: what each activity has cost, by day. Everything that spends money (explorer calls, History,
// Monitor, Summarize, scheduled publishing) reports here through recordCost(), so one place can answer "what did
// this cost?". Amounts are estimates: twitterapi.io at its list price from response sizes, models at list price
// from token counts. This is shown only in /admin, never on the public pages.
import { DurableObject } from 'cloudflare:workers';
import { llmCost } from '../summarize/pricing';
import { storageDayCost, storageMonth, type StoreKind } from '../lib/storagePrices';

export type CostKind = 'explore' | 'history' | 'monitor' | 'summarize' | 'publish' | 'audio' | 'image' | 'analysis' | 'signal' | 'collect' | 'embedding' | 'storage' | 'ask';
export interface CostEntry {
  kind: CostKind; ref?: string; label?: string;
  twitter?: number; llm?: number; tweets?: number; calls?: number; tokensIn?: number; tokensOut?: number; model?: string;
  run?: { ok: boolean; note?: string };      // a single report/summary: also kept as its own row
  /** A briefing's share of what collecting its data cost. Already in the ledger under 'collect', so it only counts in what a run is said to cost. */
  allocated?: number;
}

const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export class CostDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, label TEXT NOT NULL,
      twitter REAL NOT NULL DEFAULT 0, llm REAL NOT NULL DEFAULT 0, tweets INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0,
      tin INTEGER NOT NULL DEFAULT 0, tout INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, ref))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, label TEXT NOT NULL,
      twitter REAL NOT NULL, llm REAL NOT NULL, tweets INTEGER NOT NULL, tin INTEGER NOT NULL, tout INTEGER NOT NULL, model TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT NOT NULL)`);
    sql.exec('CREATE INDEX IF NOT EXISTS runs_by_ref ON runs (kind, ref, ts)');
    try { sql.exec('ALTER TABLE runs ADD COLUMN allocated REAL NOT NULL DEFAULT 0'); } catch { /* already there */ }
    // Entries that used a model but could not be priced (a model missing from the price tables): counted, so the Costs tab can say its numbers are low.
    try { sql.exec('ALTER TABLE daily ADD COLUMN unpriced INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }
    sql.exec('CREATE TABLE IF NOT EXISTS storage (store TEXT PRIMARY KEY, kind TEXT NOT NULL, bytes INTEGER NOT NULL, objects INTEGER NOT NULL DEFAULT 0, measured INTEGER NOT NULL)');
    this.repriceOld();
    sql.exec('DELETE FROM daily WHERE day < ?', day(Date.now() - 800 * DAY));
    sql.exec('DELETE FROM runs WHERE ts < ?', Date.now() - 400 * DAY);
  }

  /**
   * Briefings and summaries written through Anthropic directly were recorded at 0 for the model (its id had no price). Those runs kept their
   * tokens and model, so they are priced now; a run that also paid a screening model (its llm is not 0) cannot be told apart and stays as it was.
   */
  private repriceOld(): void {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ id: number; ts: number; kind: string; ref: string; tin: number; tout: number; model: string }>(
      "SELECT id, ts, kind, ref, tin, tout, model FROM runs WHERE kind IN ('publish', 'summarize') AND llm = 0 AND (tin > 0 OR tout > 0) AND model != '' AND model != 'mock'").toArray();
    for (const r of rows) {
      const c = llmCost(r.model, r.tin, r.tout);
      if (c === null || c <= 0) continue;
      sql.exec('UPDATE runs SET llm = ? WHERE id = ?', c, r.id);
      sql.exec('UPDATE daily SET llm = llm + ? WHERE day = ? AND kind = ? AND ref = ?', c, day(r.ts), r.kind, r.ref);
    }
  }

  /** RPC: add one entry. */
  add(e: CostEntry): void {
    const now = Date.now(), ref = String(e.ref ?? '').slice(0, 80), label = String(e.label ?? ref).slice(0, 120);
    const twitter = num(e.twitter), llm = num(e.llm), tweets = Math.round(num(e.tweets)), calls = Math.round(num(e.calls)), tin = Math.round(num(e.tokensIn)), tout = Math.round(num(e.tokensOut));
    // Tokens went to a text model but no money was counted for them: the model has no price in our tables.
    const unpriced = (tin > 0 || e.tokensOut) && llm === 0 && e.kind !== 'audio' && e.kind !== 'image' && e.kind !== 'embedding' && e.kind !== 'storage' && String(e.model ?? '') !== 'mock' ? 1 : 0;
    this.ctx.storage.sql.exec(
      `INSERT INTO daily (day, kind, ref, label, twitter, llm, tweets, calls, tin, tout, n, unpriced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT (day, kind, ref) DO UPDATE SET label = excluded.label, twitter = twitter + excluded.twitter, llm = llm + excluded.llm,
         tweets = tweets + excluded.tweets, calls = calls + excluded.calls, tin = tin + excluded.tin, tout = tout + excluded.tout, n = n + 1, unpriced = unpriced + excluded.unpriced`,
      day(now), e.kind, ref, label, twitter, llm, tweets, calls, tin, tout, unpriced);
    if (e.run) {
      this.ctx.storage.sql.exec('INSERT INTO runs (ts, kind, ref, label, twitter, llm, tweets, tin, tout, model, ok, note, allocated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        now, e.kind, ref, label, twitter, llm, tweets, tin, tout, String(e.model ?? '').slice(0, 120), e.run.ok ? 1 : 0, String(e.run.note ?? '').slice(0, 200), num(e.allocated));
    }
  }

  /** RPC: everything the Costs tab shows. */
  summary(days: number) {
    const sql = this.ctx.storage.sql, n = Math.min(400, Math.max(1, Math.floor(days) || 30));
    const since = day(Date.now() - (n - 1) * DAY);
    const rows = <T extends Record<string, string | number | null>>(q: string, ...b: (string | number)[]) => sql.exec<T>(q, ...b).toArray();
    // `llm` is the text models only; speech models (kind 'audio'), image models (kind 'image'), embeddings and Cloudflare storage are summed separately, though all live in the llm column.
    const EMBED = "SUM(CASE WHEN kind = 'embedding' THEN llm ELSE 0 END)", STORE = "SUM(CASE WHEN kind = 'storage' THEN llm ELSE 0 END)";
    const LLM = "SUM(CASE WHEN kind IN ('audio', 'image', 'embedding', 'storage') THEN 0 ELSE llm END)", AUDIO = "SUM(CASE WHEN kind = 'audio' THEN llm ELSE 0 END)", IMAGE = "SUM(CASE WHEN kind = 'image' THEN llm ELSE 0 END)";
    const totals = rows<{ twitter: number; llm: number; audio: number; image: number; embedding: number; storage: number; tweets: number; calls: number; tin: number; tout: number }>(
      `SELECT COALESCE(SUM(twitter),0) AS twitter, COALESCE(${LLM},0) AS llm, COALESCE(${AUDIO},0) AS audio, COALESCE(${IMAGE},0) AS image, COALESCE(${EMBED},0) AS embedding, COALESCE(${STORE},0) AS storage, COALESCE(SUM(tweets),0) AS tweets, COALESCE(SUM(calls),0) AS calls, COALESCE(SUM(tin),0) AS tin, COALESCE(SUM(tout),0) AS tout FROM daily WHERE day >= ?`, since)[0];
    return {
      days: n, since, totals, storage: this.storageView(),
      byDay: rows(`SELECT day, SUM(twitter) AS twitter, ${LLM} AS llm, ${AUDIO} AS audio, ${IMAGE} AS image, ${EMBED} AS embedding, ${STORE} AS storage FROM daily WHERE day >= ? GROUP BY day ORDER BY day`, since),
      byKind: rows(`SELECT kind, SUM(twitter) AS twitter, ${LLM} AS llm, ${AUDIO} AS audio, ${IMAGE} AS image, ${EMBED} AS embedding, ${STORE} AS storage, SUM(tweets) AS tweets, SUM(calls) AS calls, SUM(tin) AS tin, SUM(tout) AS tout, SUM(n) AS n, SUM(unpriced) AS unpriced FROM daily WHERE day >= ? GROUP BY kind ORDER BY SUM(twitter) + SUM(llm) DESC`, since),
      byRef: rows(`SELECT kind, ref, MAX(label) AS label, SUM(twitter) AS twitter, ${LLM} AS llm, ${AUDIO} AS audio, ${IMAGE} AS image, ${EMBED} AS embedding, ${STORE} AS storage, SUM(tweets) AS tweets, SUM(n) AS n, SUM(unpriced) AS unpriced FROM daily WHERE day >= ? AND kind IN ('publish', 'monitor', 'history', 'audio', 'image', 'analysis', 'signal', 'summarize', 'embedding', 'storage') GROUP BY kind, ref ORDER BY SUM(twitter) + SUM(llm) DESC LIMIT 40`, since),
      runs: rows('SELECT ts, kind, ref, label, twitter, CASE WHEN kind IN (\'audio\', \'image\') THEN 0 ELSE llm END AS llm, CASE WHEN kind = \'audio\' THEN llm ELSE 0 END AS audio, CASE WHEN kind = \'image\' THEN llm ELSE 0 END AS image, tweets, tin, tout, model, ok, note FROM runs WHERE ts >= ? ORDER BY ts DESC LIMIT 80', Date.now() - n * DAY),
    };
  }

  /**
   * RPC: measures what is stored and adds one day of it to the ledger. Once a day, whoever asks first: Monitor's daily wake-up, or someone opening the costs.
   * It measures this app's six databases and its bucket by asking them, so it needs no API token. A store that cannot be read keeps its last size and is not charged today.
   */
  async measureStorage(): Promise<void> {
    const sql = this.ctx.storage.sql, today = day(Date.now());
    if (sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM daily WHERE day = ? AND kind = 'storage'", today).one().n) return;
    const e = this.env, found: Array<{ store: string; kind: StoreKind; bytes: number; objects: number }> = [];
    const stores: Array<[string, () => Promise<number> | number]> = [
      ['Monitor', () => e.MONITOR.getByName('main').storageBytes()], ['History', () => e.HISTORY.getByName('main').storageBytes()], ['Lists', () => e.LISTS.getByName('main').storageBytes()],
      ['Publish', () => e.PUBLISH.getByName('main').storageBytes()], ['Collect', () => e.COLLECT.getByName('main').storageBytes()], ['Readers', () => e.USERS.getByName('main').storageBytes()], ['Costs', () => sql.databaseSize],
    ];
    for (const [store, read] of stores) {
      try { found.push({ store, kind: 'do', bytes: Number(await read()) || 0, objects: 0 }); }
      catch (err) { console.error('storage size failed', store, err instanceof Error ? err.message : String(err)); }
    }
    try {
      let bytes = 0, objects = 0, cursor: string | undefined;
      do {
        const page = await e.AUDIO.list({ cursor, limit: 1000 });
        for (const o of page.objects) { bytes += o.size; objects++; }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      found.push({ store: 'Audio and pictures (R2)', kind: 'r2', bytes, objects });
    } catch (err) { console.error('storage size failed', 'R2', err instanceof Error ? err.message : String(err)); }
    const now = Date.now();
    for (const f of found) {
      sql.exec('INSERT OR REPLACE INTO storage (store, kind, bytes, objects, measured) VALUES (?, ?, ?, ?, ?)', f.store, f.kind, f.bytes, f.objects, now);
      this.add({ kind: 'storage', ref: f.store.slice(0, 80), label: f.kind === 'r2' ? f.store : `${f.store} database`, llm: storageDayCost(f.kind, f.bytes), calls: 0 });
    }
  }
  /** What is stored now, and what a month at this size costs: at list price, and after what the plan includes. */
  private storageView() {
    const rows = this.ctx.storage.sql.exec<{ store: string; kind: StoreKind; bytes: number; objects: number; measured: number }>('SELECT store, kind, bytes, objects, measured FROM storage ORDER BY bytes DESC').toArray();
    const sum = (k: StoreKind) => rows.filter((r) => r.kind === k).reduce((n, r) => n + r.bytes, 0), months = (['do', 'r2'] as const).map((k) => storageMonth(k, sum(k)));
    return { measured: rows.reduce((n, r) => Math.max(n, r.measured), 0), bytes: rows.reduce((n, r) => n + r.bytes, 0), monthList: months[0].list + months[1].list, monthBilled: months[0].billed + months[1].billed,
      stores: rows.map((r) => ({ store: r.store, kind: r.kind, bytes: r.bytes, objects: r.objects, monthList: storageMonth(r.kind, r.bytes).list })) };
  }

  /** RPC: what each scheduled topic has really cost per run, for the admin's estimate to be checked against. */
  topicStats(): Record<string, { runs: number; avg: number; total30: number; last: number }> {
    const out: Record<string, { runs: number; avg: number; total30: number; last: number }> = {};
    const r = this.ctx.storage.sql.exec<{ ref: string; runs: number; avg: number; total30: number; last: number }>(
      `SELECT ref, COUNT(*) AS runs, AVG(twitter + llm + allocated) AS avg, SUM(CASE WHEN ts >= ? THEN twitter + llm + allocated ELSE 0 END) AS total30, MAX(ts) AS last FROM runs WHERE kind = 'publish' AND ok = 1 GROUP BY ref`, Date.now() - 30 * DAY).toArray();
    for (const x of r) out[x.ref] = { runs: x.runs, avg: x.avg, total30: x.total30, last: x.last };
    return out;
  }
}
