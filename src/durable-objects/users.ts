// Readers (src/users/model.ts): everyone the site's Access login lets in, by their e-mail address. What each keeps (a default lens and window, own
// lenses, followed topics), their role and extra features, and their questions to Ask Claude with what each cost. Called over RPC: the public site
// for the signed-in reader (src/site/me.ts), the admin's Readers tab (/admin/users/*) for everyone. Nothing here is ever shown to another reader,
// except a saved list its owner opened to the analysts or to everyone (mayView in src/users/model.ts), with the owner's name for analysts only.
import { DurableObject } from 'cloudflare:workers';
import type { Lens, LensArea } from '../signal/lens';
import { DEFAULT_ROLES, LIST_ID, MAX_FOLLOWS, MAX_SAVED_ITEMS, MAX_SAVED_LISTS, NO_PREFS, READER, accessOf, cleanEmail, cleanFollow, cleanListForm, cleanNote, cleanOwnLens, cleanPrefs, cleanRoles, isFeature, mayView, newListId, type Access, type Feature, type Follow, type Prefs, type Role, type SavedItem, type SavedList, type UserRow } from '../users/model';

const TOUCH_MS = 5 * 60_000, ASK_KEEP_DAYS = 90, DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

export interface Me { email: string; access: Access; prefs: Prefs; lenses: Lens[]; follows: Follow[]; asksToday: number; askLeft: number; /** Their saved lists, most recently changed first. */ lists: SavedList[] }
/** A list as another reader may see it: the owner's name only for an analysts' list, never their address. */
export interface ListView { list: SavedList; items: SavedItem[]; mine: boolean; owner: string }
export interface ListBrief extends SavedList { owner: string }
export type AskRow = { id: number; at: number; slug: string; area: 'ai' | 'politics'; label: string; question: string; answer: string; model: string; cost: number };
export interface ReaderRow extends UserRow { asksToday: number; asks7: number; cost7: number; lenses: number; follows: number }

export class UsersDO extends DurableObject<Env> {
  storageBytes(): number { return this.ctx.storage.sql.databaseSize; }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'reader', extra TEXT NOT NULL DEFAULT '[]', first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)");
    // The name and picture from the login's identity (src/site/me.ts avatar), and when they were read: read again after a week.
    for (const col of ["name TEXT NOT NULL DEFAULT ''", "picture TEXT NOT NULL DEFAULT ''", 'profile_at INTEGER NOT NULL DEFAULT 0']) { try { sql.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* already there */ } }
    sql.exec('CREATE TABLE IF NOT EXISTS prefs (email TEXT PRIMARY KEY, json TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS lenses (email TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (email, key)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS follows (email TEXT NOT NULL, slug TEXT NOT NULL, area TEXT NOT NULL, label TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (email, slug, area)) WITHOUT ROWID');
    // A question is stored before the model answers (answer ''), so it counts against the day at once and two quick ones cannot both pass the limit.
    sql.exec("CREATE TABLE IF NOT EXISTS asks (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, day TEXT NOT NULL, at INTEGER NOT NULL, slug TEXT NOT NULL, area TEXT NOT NULL, label TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', cost REAL NOT NULL DEFAULT 0)");
    sql.exec('CREATE INDEX IF NOT EXISTS asks_email_day ON asks (email, day)');
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    // Saved lists and what is in them: a copy of each item as the topic page showed it, so a list outlives the 90 days items are kept.
    sql.exec("CREATE TABLE IF NOT EXISTS saved_lists (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'private', created INTEGER NOT NULL, updated INTEGER NOT NULL)");
    sql.exec('CREATE INDEX IF NOT EXISTS saved_lists_email ON saved_lists (email)');
    sql.exec("CREATE TABLE IF NOT EXISTS saved_items (list_id TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, by_name TEXT NOT NULL, ts INTEGER NOT NULL, slug TEXT NOT NULL, area TEXT NOT NULL, label TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, PRIMARY KEY (list_id, url)) WITHOUT ROWID");
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
      lists: this.listsOf(email),
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

  // ---- saved lists
  private static LIST_COLS = 'l.id, l.name, l.description, l.visibility, l.created, l.updated, (SELECT COUNT(*) FROM saved_items i WHERE i.list_id = l.id) AS count';
  private listsOf(email: string): SavedList[] {
    return this.ctx.storage.sql.exec<SavedList & Record<string, SqlStorageValue>>(`SELECT ${UsersDO.LIST_COLS} FROM saved_lists l WHERE l.email = ? ORDER BY l.updated DESC`, email).toArray().map((r) => ({ ...r }));
  }
  private ownList(email: string, id: string): { email: string; visibility: string } {
    const r = this.ctx.storage.sql.exec<{ email: string; visibility: string }>('SELECT email, visibility FROM saved_lists WHERE id = ?', String(id)).toArray()[0];
    if (!r || r.email !== email) throw new Error('not one of your lists');
    return r;
  }
  private touchList(id: string): void { this.ctx.storage.sql.exec('UPDATE saved_lists SET updated = ? WHERE id = ?', Date.now(), id); }
  private accessFor(email: string): Access { return accessOf(this.row(email), this.roles()); }

  /** A new list, or a change to one of the reader's own (name, description, who may see it; only a reader who may publish can open it to others). */
  saveList(emailIn: string, raw: unknown, id?: string): SavedList {
    const email = this.must(emailIn), sql = this.ctx.storage.sql, f = cleanListForm(raw, this.accessFor(email)), now = Date.now();
    if (id) { this.ownList(email, id); sql.exec('UPDATE saved_lists SET name = ?, description = ?, visibility = ?, updated = ? WHERE id = ?', f.name, f.description, f.visibility, now, id); }
    else {
      if (sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM saved_lists WHERE email = ?', email).one().n >= MAX_SAVED_LISTS) throw new Error(`at most ${MAX_SAVED_LISTS} lists`);
      id = newListId();
      sql.exec('INSERT INTO saved_lists (id, email, name, description, visibility, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)', id, email, f.name, f.description, f.visibility, now, now);
    }
    return this.listsOf(email).find((l) => l.id === id)!;
  }
  deleteList(emailIn: string, id: string): void {
    const email = this.must(emailIn);
    this.ownList(email, id);
    this.ctx.storage.transactionSync(() => { this.ctx.storage.sql.exec('DELETE FROM saved_items WHERE list_id = ?', id); this.ctx.storage.sql.exec('DELETE FROM saved_lists WHERE id = ?', id); });
  }
  /** Keeps an item in a list of the reader's: the one named, else the one they changed last, else a new private list "Saved". Saving it again keeps its note. */
  saveItem(emailIn: string, listId: string, item: Omit<SavedItem, 'note' | 'at'>): SavedList {
    const email = this.must(emailIn), sql = this.ctx.storage.sql;
    const id = listId ? (this.ownList(email, listId), listId) : this.listsOf(email)[0]?.id ?? this.saveList(email, { name: 'Saved' }).id;
    const has = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM saved_items WHERE list_id = ? AND url = ?', id, item.url).one().n > 0;
    if (!has && sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM saved_items WHERE list_id = ?', id).one().n >= MAX_SAVED_ITEMS) throw new Error(`a list holds at most ${MAX_SAVED_ITEMS} items`);
    sql.exec(`INSERT INTO saved_items (list_id, url, kind, title, source, by_name, ts, slug, area, label, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (list_id, url) DO UPDATE SET title = excluded.title, source = excluded.source, by_name = excluded.by_name`,
      id, item.url, item.kind, item.title.slice(0, 300), item.source.slice(0, 80), item.by.slice(0, 80), item.ts, item.slug, item.area, item.label.slice(0, 80), Date.now());
    this.touchList(id);
    return this.listsOf(email).find((l) => l.id === id)!;
  }
  unsaveItem(emailIn: string, listId: string, url: string): void {
    const email = this.must(emailIn);
    this.ownList(email, listId);
    this.ctx.storage.sql.exec('DELETE FROM saved_items WHERE list_id = ? AND url = ?', listId, String(url));
    this.touchList(listId);
  }
  setNote(emailIn: string, listId: string, url: string, note: unknown): void {
    const email = this.must(emailIn);
    this.ownList(email, listId);
    this.ctx.storage.sql.exec('UPDATE saved_items SET note = ? WHERE list_id = ? AND url = ?', cleanNote(note), listId, String(url));
    this.touchList(listId);
  }
  /** Which of the reader's lists hold each of these addresses (for the Save buttons on a topic page). */
  savedAmong(emailIn: string, urls: string[]): Record<string, string[]> {
    const email = this.must(emailIn), out: Record<string, string[]> = {}, want = new Set(urls.slice(0, 500));
    for (const r of this.ctx.storage.sql.exec<{ url: string; list_id: string }>('SELECT i.url, i.list_id FROM saved_items i JOIN saved_lists l ON l.id = i.list_id WHERE l.email = ?', email)) {
      if (want.has(r.url)) (out[r.url] ??= []).push(r.list_id);
    }
    return out;
  }
  /** One list with its items, newest saved first, if the viewer (an address, or null for someone not signed in) may see it. */
  listView(id: string, viewerIn: string | null): ListView | null {
    if (!LIST_ID.test(String(id))) return null;
    const sql = this.ctx.storage.sql;
    const r = sql.exec<SavedList & { email: string } & Record<string, SqlStorageValue>>(`SELECT l.email, ${UsersDO.LIST_COLS} FROM saved_lists l WHERE l.id = ?`, id).toArray()[0];
    if (!r) return null;
    const viewer = viewerIn ? cleanEmail(viewerIn) : null, mine = viewer === r.email, viewerAccess = viewer ? this.accessFor(viewer) : null;
    const { email, ...list } = r;
    if (!mayView(list, { owner: mine, ownerAccess: this.accessFor(email), viewerAccess })) return null;
    const items = sql.exec<{ url: string; kind: SavedItem['kind']; title: string; source: string; by_name: string; ts: number; slug: string; area: string; label: string; note: string; at: number }>(
      'SELECT url, kind, title, source, by_name, ts, slug, area, label, note, at FROM saved_items WHERE list_id = ? ORDER BY at DESC', id).toArray()
      .map(({ by_name, area, ...i }) => ({ ...i, by: by_name, area: area === 'politics' ? 'politics' as const : 'ai' as const }));
    return { list: { ...list }, items, mine, owner: !mine && list.visibility === 'analysts' ? this.ownerName(email) : '' };
  }
  /** The lists open to this viewer, besides their own: public ones for everyone, analysts' ones for a reader who may publish. Empty lists are left out. */
  openLists(viewerIn: string | null): ListBrief[] {
    const viewer = viewerIn ? cleanEmail(viewerIn) : null, viewerAccess = viewer ? this.accessFor(viewer) : null, owners = new Map<string, Access>();
    return this.ctx.storage.sql.exec<SavedList & { email: string } & Record<string, SqlStorageValue>>(`SELECT l.email, ${UsersDO.LIST_COLS} FROM saved_lists l WHERE l.visibility != 'private' AND l.email != ? ORDER BY l.updated DESC LIMIT 500`, viewer ?? '').toArray()
      .filter((r) => {
        if (!owners.has(r.email)) owners.set(r.email, this.accessFor(r.email));
        return r.count > 0 && mayView(r, { owner: false, ownerAccess: owners.get(r.email)!, viewerAccess });
      })
      .map(({ email, ...l }) => ({ ...l, owner: l.visibility === 'analysts' ? this.ownerName(email) : '' }));
  }
  /** How a list's owner is named to the analysts: their name from the login, else the part of the address before the @. */
  private ownerName(email: string): string { return this.profile(email).name || email.split('@')[0]; }

  /** The name and picture kept from the login, and when they were read (0: never). */
  profile(emailIn: string): { name: string; picture: string; at: number } {
    const r = this.ctx.storage.sql.exec<{ name: string; picture: string; profile_at: number }>('SELECT name, picture, profile_at FROM users WHERE email = ?', this.must(emailIn)).toArray()[0];
    return { name: r?.name ?? '', picture: r?.picture ?? '', at: r?.profile_at ?? 0 };
  }
  setProfile(emailIn: string, name: string, picture: string): void {
    this.ctx.storage.sql.exec('UPDATE users SET name = ?, picture = ?, profile_at = ? WHERE email = ?', name.slice(0, 80), picture.slice(0, 500), Date.now(), this.must(emailIn));
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
    this.ctx.storage.transactionSync(() => { for (const t of ['users', 'prefs', 'lenses', 'follows', 'asks']) sql.exec(`DELETE FROM ${t} WHERE email = ?`, email);
      sql.exec('DELETE FROM saved_items WHERE list_id IN (SELECT id FROM saved_lists WHERE email = ?)', email); sql.exec('DELETE FROM saved_lists WHERE email = ?', email); });
  }
}
