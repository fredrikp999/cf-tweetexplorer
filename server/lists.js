// Curated lists of accounts ("handles to follow for a topic"), stored as one JSON file.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const MAX_LISTS = 100, MAX_MEMBERS = 500;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const https = (v) => (/^https:\/\//i.test(String(v ?? '')) ? String(v).slice(0, 400) : '');

// Whole-list validation: anything the browser sends is reduced to known, bounded fields.
export function cleanList(raw, prev) {
  const name = str(raw?.name, 80);
  if (!name) throw new Error('list name required');
  const seen = new Set(), members = [];
  for (const m of Array.isArray(raw.members) ? raw.members.slice(0, MAX_MEMBERS) : []) {
    const handle = String(m?.handle ?? '').trim().replace(/^@/, '');
    if (!HANDLE.test(handle) || seen.has(handle.toLowerCase())) continue;
    seen.add(handle.toLowerCase());
    const p = m.profile && typeof m.profile === 'object' ? m.profile : null;
    members.push({ handle, note: str(m.note, 200), addedAt: num(m.addedAt) || Date.now(), missing: !!m.missing,
      profile: p ? { name: str(p.name, 80), avatar: https(p.avatar), followers: num(p.followers), description: str(p.description, 200) } : null });
  }
  return { id: prev?.id ?? randomUUID().slice(0, 8), name, topic: str(raw.topic, 300), members, created: prev?.created ?? Date.now(), updated: Date.now() };
}

export class Lists {
  constructor({ dir }) { this.dir = dir; this.file = join(dir, 'lists.json'); this.lists = new Map(); this.writing = Promise.resolve(); }
  async init() {
    await mkdir(this.dir, { recursive: true });
    try { for (const l of JSON.parse(await readFile(this.file, 'utf8'))) this.lists.set(l.id, l); } catch {}
  }
  all() { return [...this.lists.values()].sort((a, b) => b.updated - a.updated); }
  async #persist() {
    const tmp = this.file + '.tmp', data = JSON.stringify(this.all());
    this.writing = this.writing.then(async () => { await writeFile(tmp, data); await rename(tmp, this.file); });
    await this.writing;
  }
  async save(raw) {
    const prev = raw?.id ? this.lists.get(String(raw.id)) : undefined;
    if (raw?.id && !prev) throw new Error('unknown list');
    if (!prev && this.lists.size >= MAX_LISTS) throw new Error(`at most ${MAX_LISTS} lists`);
    const list = cleanList(raw, prev);
    this.lists.set(list.id, list); await this.#persist();
    return list;
  }
  async remove(id) { this.lists.delete(String(id)); await this.#persist(); }
}
