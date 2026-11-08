// Readers (src/users/model.ts): everyone the site's Access login lets in, by their e-mail address. What each keeps (a default lens and window, own
// lenses, followed topics), their role and extra features, and their questions to Ask Claude with what each cost. Called over RPC: the public site
// for the signed-in reader (src/site/me.ts), the admin's Readers tab (/admin/users/*) for everyone. Nothing here is ever shown to another reader.
import { DurableObject } from 'cloudflare:workers';
import type { Lens, LensArea } from '../signal/lens';
import { DEFAULT_ROLES, MAX_FOLLOWS, NO_PREFS, READER, accessOf, cleanEmail, cleanFollow, cleanOwnLens, cleanPrefs, cleanRoles, isFeature, type Access, type Feature, type Follow, type Prefs, type Role, type UserRow } from '../users/model';

const TOUCH_MS = 5 * 60_000, ASK_KEEP_DAYS = 90, DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

export interface Me { email: string; access: Access; prefs: Prefs; lenses: Lens[]; follows: Follow[]; asksToday: number; askLeft: number }
export type AskRow = { id: number; at: number; slug: string; area: 'ai' | 'politics'; label: string; question: string; answer: string; model: string; cost: number };
export interface ReaderRow extends UserRow { asksToday: number; asks7: number; cost7: number; lenses: number; follows: number }

export class UsersDO extends DurableObject<Env> {
  storageBytes(): number { return this.ctx.storage.sql.databaseSize; }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'reader', extra TEXT NOT NULL DEFAULT '[]', first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)");
    sql.exec('CREATE TABLE IF NOT EXISTS prefs (email TEXT PRIMARY KEY, json TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS lenses (email TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (email, key)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS follows (email TEXT NOT NULL, slug TEXT NOT NULL, area TEXT NOT NULL, label TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (email, slug, area)) WITHOUT ROWID');
    // A question is stored before the model answers (answer ''), so it counts against the day at once and two quick ones cannot both pass the limit.
    sql.exec("CREATE TABLE IF NOT EXISTS asks (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, day TEXT NOT NULL, at INTEGER NOT NULL, slug TEXT NOT NULL, area TEXT NOT NULL, label TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', cost REAL NOT NULL DEFAULT 0)");
    sql.exec('CREATE INDEX IF NOT EXISTS asks_email_day ON asks (email, day)');
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  private getMeta<T>(k: string, d: T): T { const r = this.ctx.storage.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]; return r ? (JSON.parse(r.v) as T) : d; }
  private setMeta(k: string, v: unknown): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, JSON.stringify(v)); }
  private must(email: string): string { const e = cleanEmail(email); if (!e) throw new Error('not a reader address'); return e; }
  private row(email: string): UserRow | null {
    const r = this.ctx.storage.sql.exec<{ email: string; role: string; extra: string; first_seen: number; last_seen: number }>('SELECT * FROM users WHERE email = ?', email).toArray()[0];
    return r ? { email: r.email, role: r.role, extra: (JSON.parse(r.extra) as unknown[]).filter(isFeature), firstSeen: r.first_seen, lastSeen: r.last_seen } : null;
  }
  private asksOn(email: string, day: string): number { return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM asks WHERE email = ? AND day = ?', email, day).one().n; }

  roles(): Role[] { return this.getMeta<Role[]>('roles', DEFAULT_ROLES); }
  setRoles(raw: unknown): Role[] { const roles = cleanRoles(raw); this.setMeta('roles', roles); return roles; }

  /** The signed-in reader, as the pages use them; marks them seen (at most every few minutes). A reader seen for the first time is a Reader. */
  me(emailIn: string): Me {
    const email = this.must(emailIn), sql = this.ctx.storage.sql, now = Date.now();
    let u = this.row(email);
    if (!u) { sql.exec('INSERT OR IGNORE INTO users (email, role, extra, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)', email, READER, '[]', now, now); u = this.row(email)!; }
    else if (now - u.lastSeen > TOUCH_MS) sql.exec('UPDATE users SET last_seen = ? WHERE email = ?', now, email);
    const access = accessOf(u, this.roles()), asksToday = this.asksOn(email, today());
    return {
      email, access, asksToday, askLeft: Math.max(0, access.askPerDay - asksToday),
      prefs: this.getPrefs(email),
      lenses: sql.exec<{ json: string }>('SELECT json FROM lenses WHERE email = ? ORDER BY key', email).toArray().map((r) => JSON.parse(r.json) as Lens),
      follows: sql.exec<{ slug: string; area: string; label: string; at: number }>('SELECT slug, area, label, at FROM follows WHERE email = ? ORDER BY at DESC', email).toArray()
        .map((r) => ({ slug: r.slug, area: r.area === 'politics' ? 'politics' : 'ai', label: r.label, at: r.at })),
    };
  }
  private getPrefs(email: string): Prefs { const r = this.ctx.storage.sql.exec<{ json: string }>('SELECT json FROM prefs WHERE email = ?', email).toArray()[0]; return r ? cleanPrefs(JSON.parse(r.json)) : NO_PREFS; }
  setPrefs(emailIn: string, raw: unknown): Prefs {
    const email = this.must(emailIn), p = cleanPrefs(raw);
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO prefs (email, json) VALUES (?, ?)', email, JSON.stringify(p));
    return p;
  }

  saveLens(emailIn: string, raw: unknown, area: LensArea = 'ai'): Lens {
    const email = this.must(emailIn), sql = this.ctx.storage.sql;
    const mine = sql.exec<{ json: string }>('SELECT json FROM lenses WHERE email = ?', email).toArray().map((r) => JSON.parse(r.json) as Lens);
    const lens = cleanOwnLens(raw, mine, area);
    sql.exec('INSERT OR REPLACE INTO lenses (email, key, json) VALUES (?, ?, ?)', email, lens.key, JSON.stringify(lens));
    return lens;
  }
  deleteLens(emailIn: string, key: string): void {
    const email = this.must(emailIn);
    this.ctx.storage.sql.exec('DELETE FROM lenses WHERE email = ? AND key = ?', email, String(key));
    const p = this.getPrefs(email);
    if (p.lens === key) this.setPrefs(email, { ...p, lens: '' });   // the default lens went with it
  }

  follow(emailIn: string, raw: unknown): void {
    const email = this.must(emailIn), f = cleanFollow(raw), sql = this.ctx.storage.sql;
    if (!f) throw new Error('not a topic');
    if (sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM follows WHERE email = ?', email).one().n >= MAX_FOLLOWS) throw new Error(`at most ${MAX_FOLLOWS} followed topics`);
    sql.exec('INSERT OR REPLACE INTO follows (email, slug, area, label, at) VALUES (?, ?, ?, ?, ?)', email, f.slug, f.area, f.label, Date.now());
  }
  unfollow(emailIn: string, slug: string, area: string): void {
    this.ctx.storage.sql.exec('DELETE FROM follows WHERE email = ? AND slug = ? AND area = ?', this.must(emailIn), String(slug), area === 'politics' ? 'politics' : 'ai');
  }

  /** Takes one of today's questions for Ask Claude, or says why not. The caller fills in the answer (finishAsk) or gives the question back (dropAsk). */
  startAsk(emailIn: string, q: { slug: string; area: string; label: string; question: string }): { ok: true; id: number } | { ok: false; reason: string } {
    const email = this.must(emailIn), sql = this.ctx.storage.sql, access = accessOf(this.row(email), this.roles());
    if (!access.features.includes('ask')) return { ok: false, reason: 'Ask Claude is not part of your role.' };
    if (this.asksOn(email, today()) >= access.askPerDay) return { ok: false, reason: `You have asked your ${access.askPerDay} questions for today. More tomorrow (the day turns at 00:00 UTC).` };
    sql.exec('DELETE FROM asks WHERE at < ?', Date.now() - ASK_KEEP_DAYS * DAY);
    const id = sql.exec<{ id: number }>('INSERT INTO asks (email, day, at, slug, area, label, question) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      email, today(), Date.now(), q.slug, q.area === 'politics' ? 'politics' : 'ai', q.label.slice(0, 80), q.question.slice(0, 500)).one().id;
    return { ok: true, id };
  }
  finishAsk(emailIn: string, id: number, answer: string, model: string, cost: number): void {
    this.ctx.storage.sql.exec('UPDATE asks SET answer = ?, model = ?, cost = ? WHERE id = ? AND email = ?', answer.slice(0, 20_000), model, cost, id, this.must(emailIn));
  }
  dropAsk(emailIn: string, id: number): void { this.ctx.storage.sql.exec("DELETE FROM asks WHERE id = ? AND email = ? AND answer = ''", id, this.must(emailIn)); }
  /** One of the reader's own questions (never another reader's). */
  ask(emailIn: string, id: number): AskRow | null {
    const r = this.ctx.storage.sql.exec<AskRow>('SELECT id, at, slug, area, label, question, answer, model, cost FROM asks WHERE id = ? AND email = ?', id, this.must(emailIn)).toArray()[0];
    return r ?? null;
  }
  asks(emailIn: string, limit = 20): AskRow[] {
    return this.ctx.storage.sql.exec<AskRow>("SELECT id, at, slug, area, label, question, answer, model, cost FROM asks WHERE email = ? AND answer != '' ORDER BY at DESC LIMIT ?", this.must(emailIn), Math.min(100, limit)).toArray();
  }

  // ---- the admin
  list(): ReaderRow[] {
    const sql = this.ctx.storage.sql, d = today(), week = new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10);
    return sql.exec<{ email: string; role: string; extra: string; first_seen: number; last_seen: number; today: number; week: number; cost: number; lenses: number; follows: number }>(
      `SELECT u.email, u.role, u.extra, u.first_seen, u.last_seen,
        (SELECT COUNT(*) FROM asks a WHERE a.email = u.email AND a.day = ?) AS today,
        (SELECT COUNT(*) FROM asks a WHERE a.email = u.email AND a.day >= ?) AS week,
        (SELECT COALESCE(SUM(cost), 0) FROM asks a WHERE a.email = u.email AND a.day >= ?) AS cost,
        (SELECT COUNT(*) FROM lenses l WHERE l.email = u.email) AS lenses,
        (SELECT COUNT(*) FROM follows f WHERE f.email = u.email) AS follows
      FROM users u ORDER BY u.last_seen DESC LIMIT 1000`, d, week, week).toArray()
      .map((r) => ({ email: r.email, role: r.role, extra: (JSON.parse(r.extra) as unknown[]).filter(isFeature), firstSeen: r.first_seen, lastSeen: r.last_seen, asksToday: r.today, asks7: r.week, cost7: r.cost, lenses: r.lenses, follows: r.follows }));
  }
  /** A role and extra features for an address; one not seen yet is added, so access can be given before the first visit. */
  setUser(emailIn: string, role: string, extra: unknown): void {
    const email = this.must(emailIn), roles = this.roles();
    if (!roles.some((r) => r.key === role)) throw new Error(`no role ${role}`);
    const ex = [...new Set((Array.isArray(extra) ? extra : []).filter(isFeature))] as Feature[];
    this.ctx.storage.sql.exec('INSERT INTO users (email, role, extra, first_seen, last_seen) VALUES (?, ?, ?, 0, 0) ON CONFLICT (email) DO UPDATE SET role = excluded.role, extra = excluded.extra', email, role, JSON.stringify(ex));
  }
  /** Everything kept about a reader. They are added again, as a Reader, if they visit again. */
  removeUser(emailIn: string): void {
    const email = this.must(emailIn), sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => { for (const t of ['users', 'prefs', 'lenses', 'follows', 'asks']) sql.exec(`DELETE FROM ${t} WHERE email = ?`, email); });
  }
}
