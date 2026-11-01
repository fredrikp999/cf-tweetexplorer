// Lists: curated groups of accounts, stored in the Durable Object's SQLite. Same rules as lists.js.
import { DurableObject } from 'cloudflare:workers';
import { json } from '../lib/twitterapi';
import { HN_TAGS, type HnTag } from '../sources/hn';
import { checkFeedUrl } from '../sources/rss';
import { setYoutubeKey } from '../sources/youtube';
import { MAX_MEMBERS as MAX_FEED_MEMBERS, memberKey, readMembers, resolveLines, type FeedMember } from '../sources/feedlist';

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const MAX_LISTS = 100, MAX_MEMBERS = 500;

interface Member {
  handle: string; note: string; addedAt: number; missing: boolean;
  profile: { name: string; avatar: string; followers: number; description: string } | null;
}
// `public` (account lists and feed lists): shown on the public Lists page. Unset counts as private: only lists you tick are shown.
interface List { id: string; name: string; topic: string; members: Member[]; created: number; updated: number; public?: boolean }

// X Lists: lists that live on x.com, kept by reference. We store the id, a name, the groups it belongs to and a note;
// the tweets are read from X's own list timeline when needed, so no accounts are copied.
// `public`: shown on the public Lists page. Unset (lists imported before this option) counts as public: they are public lists on X.
export interface XList { id: string; name: string; groups: string[]; description: string; order: number; public?: boolean }
const MAX_XLISTS = 300;

// Feed lists: curated sets of feeds (RSS, YouTube, Hacker News searches), read on demand or watched in Monitor.
export interface FeedList { id: string; name: string; topic: string; members: FeedMember[]; created: number; updated: number; public?: boolean }
const MAX_FEED_LISTS = 100;

const str = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const https = (v: unknown) => (/^https:\/\//i.test(String(v ?? '')) ? String(v).slice(0, 400) : '');

// Whole-list validation: anything the browser sends is reduced to known, bounded fields.
function cleanList(raw: Record<string, unknown>, prev?: List): List {
  const name = str(raw.name, 80);
  if (!name) throw new Error('list name required');
  const seen = new Set<string>(), members: Member[] = [];
  const incoming = Array.isArray(raw.members) ? (raw.members as Record<string, unknown>[]).slice(0, MAX_MEMBERS) : [];
  for (const m of incoming) {
    const handle = String(m?.handle ?? '').trim().replace(/^@/, '');
    if (!HANDLE.test(handle) || seen.has(handle.toLowerCase())) continue;
    seen.add(handle.toLowerCase());
    const p = m.profile && typeof m.profile === 'object' ? (m.profile as Record<string, unknown>) : null;
    members.push({
      handle, note: str(m.note, 200), addedAt: num(m.addedAt) || Date.now(), missing: !!m.missing,
      profile: p ? { name: str(p.name, 80), avatar: https(p.avatar), followers: num(p.followers), description: str(p.description, 200) } : null,
    });
  }
  return { id: prev?.id ?? crypto.randomUUID().slice(0, 8), name, topic: str(raw.topic, 300), members, created: prev?.created ?? Date.now(), updated: Date.now(), ...visibility(raw, prev) };
}

/** `public` is kept when the browser does not mention it, so an older page cannot hide a list by accident. */
const visibility = (raw: Record<string, unknown>, prev?: { public?: boolean }) => {
  const v = typeof raw.public === 'boolean' ? raw.public : prev?.public;
  return v === undefined ? {} : { public: v };
};

// Whole-list validation, as for lists above: the browser only sends what it found out by asking /lists/f-resolve, and it is checked again here.
function cleanFeedList(raw: Record<string, unknown>, prev?: FeedList): FeedList {
  const name = str(raw.name, 80);
  if (!name) throw new Error('list name required');
  const seen = new Set<string>(), members: FeedMember[] = [];
  for (const m of (Array.isArray(raw.members) ? (raw.members as Record<string, unknown>[]) : []).slice(0, MAX_FEED_MEMBERS)) {
    const source = m?.source === 'hn' || m?.source === 'youtube' || m?.source === 'rss' ? m.source : null;
    if (!source) continue;
    let query = str(m.query, 400);
    if (source !== 'hn') { try { query = checkFeedUrl(query); } catch { continue; } }
    const member: FeedMember = {
      source, query, label: str(m.label, 80) || (source === 'hn' ? 'Hacker News' : query), note: str(m.note, 200), addedAt: num(m.addedAt) || Date.now(),
      ...(source === 'hn' ? { hnTag: (HN_TAGS.includes(m.hnTag as HnTag) ? m.hnTag : 'front_page') as HnTag, minPoints: Math.min(10_000, Math.max(0, Math.floor(num(m.minPoints)))) } : {}),
    };
    const k = memberKey(member);
    if (seen.has(k)) continue;
    seen.add(k); members.push(member);
  }
  return { id: prev?.id ?? crypto.randomUUID().slice(0, 8), name, topic: str(raw.topic, 300), members, created: prev?.created ?? Date.now(), updated: Date.now(), ...visibility(raw, prev) };
}

function cleanX(raw: unknown): XList | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = String(r.id ?? '').trim();
  if (!/^\d{1,25}$/.test(id)) return null;
  const groups = [...new Set((Array.isArray(r.groups) ? r.groups : []).map((g) => str(g, 60)).filter(Boolean))].slice(0, 6);
  return { id, name: str(r.name, 80) || `List ${id}`, groups, description: str(r.description, 400), order: 0, ...(typeof r.public === 'boolean' ? { public: r.public } : {}) };
}

export class ListsDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    setYoutubeKey(env.YOUTUBE_API_KEY);   // a channel whose feed fails is read through the API
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, updated INTEGER NOT NULL, data TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS xlists (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, data TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS flists (id TEXT PRIMARY KEY, updated INTEGER NOT NULL, data TEXT NOT NULL)');
  }
  private xall(): XList[] {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM xlists ORDER BY ord').toArray().map((r) => JSON.parse(r.data) as XList);
  }
  private xput(x: XList): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO xlists (id, ord, data) VALUES (?, ?, ?)', x.id, x.order, JSON.stringify(x)); }
  private fall(): FeedList[] {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM flists ORDER BY updated DESC').toArray().map((r) => JSON.parse(r.data) as FeedList);
  }
  private all(): List[] {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM lists ORDER BY updated DESC').toArray().map((r) => JSON.parse(r.data) as List);
  }
  private get(id: string): List | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM lists WHERE id = ?', id).toArray()[0];
    return row ? (JSON.parse(row.data) as List) : undefined;
  }

  async fetch(request: Request): Promise<Response> {
    const name = new URL(request.url).pathname.replace(/^\/lists\//, '');
    try {
      if (request.method === 'GET' && name === 'all') return json(this.all());
      if (request.method === 'GET' && name === 'x-all') return json(this.xall());
      if (request.method === 'GET' && name === 'f-all') return json(this.fall());
      // What the public Lists page may show: only lists marked public, and only name, groups and description.
      if (request.method === 'GET' && name === 'x-public') return json(this.xall().filter((x) => x.public !== false).map(({ id, name, groups, description }) => ({ id, name, groups, description })));
      // Account lists and feed lists marked public: names, topic and members only (no notes, profiles or dates).
      if (request.method === 'GET' && name === 'a-public') return json(this.all().filter((l) => l.public === true && l.members.length).map((l) => ({ id: l.id, name: l.name, topic: l.topic, handles: l.members.filter((m) => !m.missing).map((m) => m.handle) })));
      if (request.method === 'GET' && name === 'f-public') return json(this.fall().filter((l) => l.public === true && l.members.length).map((l) => ({ id: l.id, name: l.name, topic: l.topic,
        feeds: l.members.map((m) => ({ source: m.source, label: m.label, query: m.query, ...(m.source === 'hn' ? { hnTag: m.hnTag, minPoints: m.minPoints } : {}) })) })));
      if (request.method !== 'POST') return json({ error: 'GET or POST required' }, 405);
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      if (name === 'save') {
        const prev = b.id ? this.get(String(b.id)) : undefined;
        if (b.id && !prev) throw new Error('unknown list');
        if (!prev) {
          const n = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM lists').one().n;
          if (n >= MAX_LISTS) throw new Error(`at most ${MAX_LISTS} lists`);
        }
        const list = cleanList(b, prev);
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO lists (id, updated, data) VALUES (?, ?, ?)', list.id, list.updated, JSON.stringify(list));
        return json(list);
      }
      if (name === 'f-resolve') {   // pasted links, handles and feed addresses → members (each one is loaded once to check it and to name it)
        const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => String(l).slice(0, 400));
        return json(await resolveLines(lines));
      }
      if (name === 'f-items') {   // what one or more feed lists published lately, optionally only items with all the given words
        const all = this.fall(), picked = [...new Set((Array.isArray(b.ids) ? b.ids : [b.id]).map(String))].slice(0, 10).map((id) => all.find((l) => l.id === id)).filter((l): l is FeedList => !!l);
        if (!picked.length) throw new Error('pick a feed list');
        const seen = new Set<string>(), members: FeedMember[] = [];
        for (const l of picked) for (const m of l.members) if (!seen.has(memberKey(m))) { seen.add(memberKey(m)); members.push(m); }
        const hours = Math.min(720, Math.max(1, Math.floor(num(b.hours)) || 24));
        const r = await readMembers(members, Date.now() - hours * 3_600_000);
        const words = str(b.q, 200).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
        const items = words.length ? r.items.filter((i) => { const t = `${i.title} ${i.text} ${i.author.name}`.toLowerCase(); return words.every((w) => t.includes(w)); }) : r.items;
        return json({ lists: picked.map((l) => l.name), total: items.length, read: r.read, failed: r.failed, items: items.slice(0, 200) });
      }
      if (name === 'f-save') {
        const prev = b.id ? this.fall().find((l) => l.id === String(b.id)) : undefined;
        if (b.id && !prev) throw new Error('unknown list');
        if (!prev && this.fall().length >= MAX_FEED_LISTS) throw new Error(`at most ${MAX_FEED_LISTS} feed lists`);
        const list = cleanFeedList(b, prev);
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO flists (id, updated, data) VALUES (?, ?, ?)', list.id, list.updated, JSON.stringify(list));
        return json(list);
      }
      if (name === 'f-delete') { this.ctx.storage.sql.exec('DELETE FROM flists WHERE id = ?', String(b.id ?? '')); return json({ ok: true }); }
      if (name === 'x-import') {
        // Adds lists we do not have yet; for one we have, only adds groups, so a rename or note you made is kept.
        const incoming = (Array.isArray(b.lists) ? b.lists : []).slice(0, MAX_XLISTS).map(cleanX).filter((x): x is XList => !!x);
        if (!incoming.length) throw new Error('no X list ids found');
        const have = new Map(this.xall().map((x) => [x.id, x]));
        let order = Math.max(0, ...[...have.values()].map((x) => x.order)), added = 0, updated = 0;
        for (const x of incoming) {
          const cur = have.get(x.id);
          if (cur) { const groups = [...new Set([...cur.groups, ...x.groups])].slice(0, 6); if (groups.length !== cur.groups.length) { this.xput({ ...cur, groups }); have.set(x.id, { ...cur, groups }); updated++; } continue; }
          if (have.size >= MAX_XLISTS) throw new Error(`at most ${MAX_XLISTS} X lists`);
          const next = { ...x, order: ++order }; this.xput(next); have.set(x.id, next); added++;
        }
        return json({ added, updated, total: have.size });
      }
      if (name === 'x-save') {
        const x = cleanX(b), cur = x && this.xall().find((y) => y.id === x.id);
        if (!x || !cur) throw new Error('unknown X list');
        this.xput({ ...x, order: cur.order, public: x.public ?? cur.public });
        return json({ ok: true });
      }
      if (name === 'x-publish') {      // show or hide several lists on the public page at once
        const ids = new Set((Array.isArray(b.ids) ? b.ids : []).map(String)), on = b.public === true;
        let n = 0;
        for (const x of this.xall()) if (ids.has(x.id)) { this.xput({ ...x, public: on }); n++; }
        return json({ ok: true, changed: n });
      }
      if (name === 'x-delete') { this.ctx.storage.sql.exec('DELETE FROM xlists WHERE id = ?', String(b.id ?? '')); return json({ ok: true }); }
      if (name === 'delete') { this.ctx.storage.sql.exec('DELETE FROM lists WHERE id = ?', String(b.id ?? '')); return json({ ok: true }); }
      return json({ error: 'unknown lists route' }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
}
