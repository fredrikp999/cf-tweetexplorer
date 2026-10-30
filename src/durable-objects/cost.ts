// The cost ledger: what each activity has cost, by day. Everything that spends money (explorer calls, History,
// Monitor, Summarize, scheduled publishing) reports here through recordCost(), so one place can answer "what did
// this cost?". Amounts are estimates: twitterapi.io at its list price from response sizes, models at list price
// from token counts. This is shown only in /admin, never on the public pages.
import { DurableObject } from 'cloudflare:workers';

export type CostKind = 'explore' | 'history' | 'monitor' | 'summarize' | 'publish' | 'audio' | 'image' | 'analysis';
export interface CostEntry {
  kind: CostKind; ref?: string; label?: string;
  twitter?: number; llm?: number; tweets?: number; calls?: number; tokensIn?: number; tokensOut?: number; model?: string;
  run?: { ok: boolean; note?: string };      // a single report/summary: also kept as its own row
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
    sql.exec('DELETE FROM daily WHERE day < ?', day(Date.now() - 800 * DAY));
    sql.exec('DELETE FROM runs WHERE ts < ?', Date.now() - 400 * DAY);
  }

  /** RPC: add one entry. */
  add(e: CostEntry): void {
    const now = Date.now(), ref = String(e.ref ?? '').slice(0, 80), label = String(e.label ?? ref).slice(0, 120);
    const twitter = num(e.twitter), llm = num(e.llm), tweets = Math.round(num(e.tweets)), calls = Math.round(num(e.calls)), tin = Math.round(num(e.tokensIn)), tout = Math.round(num(e.tokensOut));
    this.ctx.storage.sql.exec(
      `INSERT INTO daily (day, kind, ref, label, twitter, llm, tweets, calls, tin, tout, n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (day, kind, ref) DO UPDATE SET label = excluded.label, twitter = twitter + excluded.twitter, llm = llm + excluded.llm,
         tweets = tweets + excluded.tweets, calls = calls + excluded.calls, tin = tin + excluded.tin, tout = tout + excluded.tout, n = n + 1`,
      day(now), e.kind, ref, label, twitter, llm, tweets, calls, tin, tout);
    if (e.run) {
      this.ctx.storage.sql.exec('INSERT INTO runs (ts, kind, ref, label, twitter, llm, tweets, tin, tout, model, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        now, e.kind, ref, label, twitter, llm, tweets, tin, tout, String(e.model ?? '').slice(0, 120), e.run.ok ? 1 : 0, String(e.run.note ?? '').slice(0, 200));
    }
  }

  /** RPC: everything the Costs tab shows. */
  summary(days: number) {
    const sql = this.ctx.storage.sql, n = Math.min(400, Math.max(1, Math.floor(days) || 30));
    const since = day(Date.now() - (n - 1) * DAY);
    const rows = <T extends Record<string, string | number | null>>(q: string, ...b: (string | number)[]) => sql.exec<T>(q, ...b).toArray();
    // `llm` is the text models only; speech models (kind 'audio') and image models (kind 'image') are summed separately, though all live in the llm column.
    const LLM = "SUM(CASE WHEN kind IN ('audio', 'image') THEN 0 ELSE llm END)", AUDIO = "SUM(CASE WHEN kind = 'audio' THEN llm ELSE 0 END)", IMAGE = "SUM(CASE WHEN kind = 'image' THEN llm ELSE 0 END)";
    const totals = rows<{ twitter: number; llm: number; audio: number; image: number; tweets: number; calls: number; tin: number; tout: number }>(
      `SELECT COALESCE(SUM(twitter),0) AS twitter, COALESCE(${LLM},0) AS llm, COALESCE(${AUDIO},0) AS audio, COALESCE(${IMAGE},0) AS image, COALESCE(SUM(tweets),0) AS tweets, COALESCE(SUM(calls),0) AS calls, COALESCE(SUM(tin),0) AS tin, COALESCE(SUM(tout),0) AS tout FROM daily WHERE day >= ?`, since)[0];
    return {
      days: n, since, totals,
      byDay: rows(`SELECT day, SUM(twitter) AS twitter, ${LLM} AS llm, ${AUDIO} AS audio, ${IMAGE} AS image FROM daily WHERE day >= ? GROUP BY day ORDER BY day`, since),
      byKind: rows(`SELECT kind, SUM(twitter) AS twitter, ${LLM} AS llm, ${AUDIO} AS audio, ${IMAGE} AS image, SUM(tweets) AS tweets, SUM(calls) AS calls, SUM(tin) AS tin, SUM(tout) AS tout, SUM(n) AS n FROM daily WHERE day >= ? GROUP BY kind ORDER BY SUM(twitter) + SUM(llm) DESC`, since),
      byRef: rows(`SELECT kind, ref, MAX(label) AS label, SUM(twitter) AS twitter, ${LLM} AS llm, ${AUDIO} AS audio, ${IMAGE} AS image, SUM(tweets) AS tweets, SUM(n) AS n FROM daily WHERE day >= ? AND kind IN ('publish', 'monitor', 'history', 'audio', 'image', 'analysis') GROUP BY kind, ref ORDER BY SUM(twitter) + SUM(llm) DESC LIMIT 40`, since),
      runs: rows('SELECT ts, kind, ref, label, twitter, CASE WHEN kind IN (\'audio\', \'image\') THEN 0 ELSE llm END AS llm, CASE WHEN kind = \'audio\' THEN llm ELSE 0 END AS audio, CASE WHEN kind = \'image\' THEN llm ELSE 0 END AS image, tweets, tin, tout, model, ok, note FROM runs WHERE ts >= ? ORDER BY ts DESC LIMIT 80', Date.now() - n * DAY),
    };
  }

  /** RPC: what each scheduled topic has really cost per run, for the admin's estimate to be checked against. */
  topicStats(): Record<string, { runs: number; avg: number; total30: number; last: number }> {
    const out: Record<string, { runs: number; avg: number; total30: number; last: number }> = {};
    const r = this.ctx.storage.sql.exec<{ ref: string; runs: number; avg: number; total30: number; last: number }>(
      `SELECT ref, COUNT(*) AS runs, AVG(twitter + llm) AS avg, SUM(CASE WHEN ts >= ? THEN twitter + llm ELSE 0 END) AS total30, MAX(ts) AS last FROM runs WHERE kind = 'publish' AND ok = 1 GROUP BY ref`, Date.now() - 30 * DAY).toArray();
    for (const x of r) out[x.ref] = { runs: x.runs, avg: x.avg, total30: x.total30, last: x.last };
    return out;
  }
}
