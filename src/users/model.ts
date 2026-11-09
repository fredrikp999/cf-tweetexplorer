// Readers: who is signed in (by the Google login of Cloudflare Access), what each keeps (a default lens and window, lenses of their own, topics they follow, saved lists),
// and which extra features a role gives (Ask Claude with a daily number of questions, Publish lists). Pure functions (no Worker APIs), so Node can test them.
// The UsersDO (src/durable-objects/users.ts) stores it all; the public site reads it per request (src/site/me.ts); the admin manages roles (Readers tab).
import { LENS_COLORS, cleanLens, type Lens, type LensArea } from '../signal/lens.ts';
import type { TopicData } from '../signal/topicpage.ts';

/** The features a role can give. One entry per feature: its key, its name and what it does, as the admin shows it. */
export const FEATURES = [
  { key: 'ask', name: 'Ask Claude', description: 'Ask a question on a topic page; a language model answers from the topic’s items, briefings and summary. Each question costs a little and counts against the role’s daily number.' },
  { key: 'publish', name: 'Publish lists', description: 'Make a saved list public on the site (/saved), or open it to the analysts only: everyone whose role or extras give this feature. Taking the feature away makes their lists private again.' },
] as const;
export type Feature = (typeof FEATURES)[number]['key'];
const FEATURE_KEYS = new Set<string>(FEATURES.map((f) => f.key));
export const isFeature = (v: unknown): v is Feature => FEATURE_KEYS.has(String(v));

export interface Role { key: string; name: string; features: Feature[]; /** Ask Claude: questions a day for each user of this role. */ askPerDay: number }
/** Everyone the login lets in is a reader; the role cannot be removed or given features, so a reader is never more than the site without an account. */
export const READER = 'reader';
export const DEFAULT_ROLES: Role[] = [
  { key: READER, name: 'Reader', features: [], askPerDay: 0 },
  { key: 'analyst', name: 'Analyst', features: ['ask', 'publish'], askPerDay: 20 },
];
/** The questions a day a user gets for a feature given on its own (not by the role) when the role gives none. */
export const EXTRA_ASK_PER_DAY = 10;
export const MAX_ROLES = 10, MAX_ASK_PER_DAY = 200, MAX_OWN_LENSES = 6, MAX_FOLLOWS = 100;
/** Own lenses are chosen with ?lens=my-<key>, so they never clash with a lens of the site. */
export const OWN_PREFIX = 'my-';

const ROLE_KEY = /^[a-z][a-z0-9-]{1,23}$/;
const oneLine = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** An address from the login: lowercase, one @, no spaces; null when it is not one. */
export function cleanEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** The roles as the admin sent them: Reader always first and without features, keys unique, at most MAX_ROLES. Throws a plain message the admin can show. */
export function cleanRoles(raw: unknown): Role[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Role[] = [{ ...DEFAULT_ROLES[0] }], seen = new Set([READER]);
  for (const r of list as Array<Record<string, unknown>>) {
    const key = oneLine(r?.key, 24).toLowerCase();
    if (key === READER) { out[0].name = oneLine(r.name, 30) || 'Reader'; continue; }
    if (!ROLE_KEY.test(key)) throw new Error(`a role key is 2 to 24 letters, digits or hyphens, starting with a letter (${key || 'empty'})`);
    if (seen.has(key)) throw new Error(`two roles have the key ${key}`);
    seen.add(key);
    const features = [...new Set((Array.isArray(r.features) ? r.features : []).filter(isFeature))];
    const n = Math.round(Number(r.askPerDay));
    out.push({ key, name: oneLine(r.name, 30) || key, features, askPerDay: features.includes('ask') ? Math.min(MAX_ASK_PER_DAY, Math.max(1, Number.isFinite(n) ? n : 20)) : 0 });
  }
  if (out.length > MAX_ROLES) throw new Error(`at most ${MAX_ROLES} roles`);
  return out;
}

export interface UserRow { email: string; role: string; /** Features given on top of the role. */ extra: Feature[]; firstSeen: number; lastSeen: number }
export interface Access { role: Role; features: Feature[]; askPerDay: number }

/** What a user may do: the role's features (Reader when the role is gone) plus their own extras, and their questions a day. */
export function accessOf(user: Pick<UserRow, 'role' | 'extra'> | null | undefined, roles: Role[]): Access {
  const role = roles.find((r) => r.key === user?.role) ?? roles.find((r) => r.key === READER) ?? DEFAULT_ROLES[0];
  const features = [...new Set([...role.features, ...(user?.extra ?? []).filter(isFeature)])];
  const askPerDay = !features.includes('ask') ? 0 : role.features.includes('ask') ? role.askPerDay : EXTRA_ASK_PER_DAY;
  return { role, features, askPerDay };
}

// ---- what a reader keeps
export const WINDOWS = [1, 3, 7] as const;
export interface Prefs { /** The lens the front page opens on ('' for all, or a key, own lenses too). */ lens: string; /** The window it opens on. */ window: 1 | 3 | 7 }
export const NO_PREFS: Prefs = { lens: '', window: 1 };
export function cleanPrefs(raw: unknown): Prefs {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lens = oneLine(b.lens, 24).toLowerCase(), w = Number(b.window);
  return { lens: /^[a-z][a-z0-9-]{1,23}$/.test(lens) ? lens : '', window: (WINDOWS as readonly number[]).includes(w) ? (w as 1 | 3 | 7) : 1 };
}
/** Whether a bare front page should open elsewhere for this reader: their window and lens, when either is not the default. Null: stay. */
export function homeFor(p: Prefs, known: (key: string) => boolean): { lens: string; window: number } | null {
  const lens = p.lens && known(p.lens) ? p.lens : '';
  return lens || p.window !== 1 ? { lens, window: p.window } : null;
}

/**
 * A lens of the reader's own, from the form: the rules of a site lens (src/signal/lens.ts cleanLens), its key made from the name and starting with
 * OWN_PREFIX, and a colour of its own among the reader's lenses (not among the site's: the two are told apart by the "yours" mark).
 */
export function cleanOwnLens(raw: unknown, mine: Lens[], area: LensArea = 'ai'): Lens {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const given = oneLine(b.key, 24).toLowerCase();
  const base = given.startsWith(OWN_PREFIX) ? given : OWN_PREFIX + oneLine(b.name, 40).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const key = base.slice(0, 20).replace(/-+$/, '');
  if (!mine.some((l) => l.key === key) && mine.length >= MAX_OWN_LENSES) throw new Error(`at most ${MAX_OWN_LENSES} lenses of your own`);
  const finalKey = key.length > OWN_PREFIX.length + 1 ? key : OWN_PREFIX + 'lens', others = mine.filter((l) => l.key !== finalKey);
  const color = LENS_COLORS.includes(b.color as never) ? b.color : LENS_COLORS.find((c) => !others.some((l) => l.color === c)) ?? LENS_COLORS[0];
  return cleanLens({ ...b, key: finalKey, color, area }, others.map((l) => ({ ...l, area })));
}

export interface Follow { slug: string; area: 'ai' | 'politics'; label: string; at: number }
export const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
export function cleanFollow(raw: unknown): Omit<Follow, 'at'> | null {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const slug = String(b.slug ?? '').toLowerCase();
  return TOPIC_SLUG.test(slug) ? { slug, area: b.area === 'politics' ? 'politics' : 'ai', label: oneLine(b.label, 80) || slug.replace(/-/g, ' ') } : null;
}

// ---- saved lists: posts, videos and papers a reader keeps, private unless a reader with Publish lists opens them to the analysts or to everyone
export const VISIBILITIES = ['private', 'analysts', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABEL: Record<Visibility, string> = { private: 'Only you', analysts: 'Analysts', public: 'Everyone' };
export const MAX_SAVED_LISTS = 20, MAX_SAVED_ITEMS = 200;
/** A list's address (/saved/<id>): random, so a list open to analysts cannot be found by counting. */
export const LIST_ID = /^[a-z0-9]{10}$/;
export function newListId(): string { const b = crypto.getRandomValues(new Uint8Array(10)); return [...b].map((x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join(''); }

export interface SavedList { id: string; name: string; description: string; visibility: Visibility; count: number; created: number; updated: number }
/** A saved item: a copy of what the topic page showed when it was saved (items leave the site after 90 days; the list keeps them). */
export interface SavedItem { url: string; kind: 'x' | 'hn' | 'youtube' | 'rss' | 'arxiv'; title: string; source: string; by: string; ts: number; slug: string; area: 'ai' | 'politics'; label: string; note: string; at: number }

export const canPublish = (a: Pick<Access, 'features'> | null | undefined): boolean => !!a?.features.includes('publish');
/** The visibility asked for, or private when the reader may not publish. */
export function visibilityFor(raw: unknown, a: Pick<Access, 'features'> | null | undefined): Visibility {
  const v = VISIBILITIES.find((x) => x === raw) ?? 'private';
  return canPublish(a) ? v : 'private';
}
/** The name, description and visibility of a list from the form. Throws a plain message when there is no name. */
export function cleanListForm(raw: unknown, a: Pick<Access, 'features'> | null | undefined): { name: string; description: string; visibility: Visibility } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = oneLine(b.name, 60);
  if (!name) throw new Error('give the list a name');
  return { name, description: oneLine(b.description, 280), visibility: visibilityFor(b.visibility, a) };
}
/** A note on a saved item: one line, at most 280 characters. */
export const cleanNote = (raw: unknown): string => oneLine(raw, 280);
/**
 * Whether a viewer may open a list. The owner always; otherwise only while the owner may still publish (taking Publish lists away makes their
 * lists private again), and then everyone for a public list, readers who may publish for an analysts' list.
 */
export function mayView(list: Pick<SavedList, 'visibility'>, o: { owner: boolean; ownerAccess: Pick<Access, 'features'>; viewerAccess: Pick<Access, 'features'> | null }): boolean {
  if (o.owner) return true;
  if (list.visibility === 'private' || !canPublish(o.ownerAccess)) return false;
  return list.visibility === 'public' || canPublish(o.viewerAccess);
}

/** The item behind an address on a topic page (src/site/me.ts itemOnTopic): a post from Talk (only when its Signal shows sources), a video from Watch, or a paper. */
export function findItem(d: TopicData, url: string): Omit<SavedItem, 'note' | 'at'> | null {
  const at = { slug: d.slug, area: d.area, label: d.label };
  const talk = d.board.proof ? d.talk.find((i) => i.url === url) : undefined;
  if (talk && talk.kind !== 'arxiv') return { url, kind: talk.kind, title: talk.title || url, source: talk.source, by: talk.by, ts: talk.ts, ...at };
  const v = (d.watch ?? []).find((w) => w.url === url);
  if (v) return { url, kind: 'youtube', title: v.title, source: v.source, by: v.by, ts: v.ts, ...at };
  const p = d.papers.list.find((x) => x.absUrl === url);
  if (p) return { url, kind: 'arxiv', title: p.title, source: 'arXiv', by: p.authors.slice(0, 3).join(', ') + (p.authors.length > 3 ? ' et al.' : ''), ts: p.published, ...at };
  return null;
}

/** A question to Ask Claude: one line or a few, at most 500 characters; null when empty. */
export function cleanQuestion(raw: unknown): string | null {
  const q = String(raw ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, 500);
  return q.length >= 3 ? q : null;
}

/**
 * Links in an answer: only those that are in the topic's data stay links; any other becomes its plain text. The model reads posts by strangers,
 * so a link it was talked into writing must not reach the reader as a link.
 */
export function keepLinks(answer: string, allowed: Set<string>): string {
  return answer.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (all, text: string, href: string) => (allowed.has(href) ? all : text))
    .replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, (all, pre: string, href: string) => (allowed.has(href) ? all : pre + href.replace(/^https?:\/\//, '')));
}

// ---- the avatar in the top bar (src/site/me.ts avatarResponse)
/** Hosts a picture may come from: Google's account pictures. Anything else is not fetched (the Worker fetches it, so it must not be any address). */
const PICTURE_HOST = /(^|\.)googleusercontent\.com$/;
/** The name and picture in what Access says about the login (get-identity). Where the picture sits depends on the login: a few known places are tried. */
export function profileOf(identity: unknown): { name: string; picture: string } {
  const o = (identity && typeof identity === 'object' ? identity : {}) as Record<string, unknown>;
  const sub = (k: string) => (o[k] && typeof o[k] === 'object' ? (o[k] as Record<string, unknown>) : {});
  const pic = [o.picture, sub('oidc_fields').picture, sub('custom').picture, sub('idp').picture].map((v) => String(v ?? '')).find((v) => {
    try { const u = new URL(v); return u.protocol === 'https:' && PICTURE_HOST.test(u.hostname); } catch { return false; }
  }) ?? '';
  const name = [o.name, sub('oidc_fields').name, sub('custom').name].map((v) => oneLine(v, 80)).find(Boolean) ?? '';
  return { name, picture: pic };
}
/** A round avatar with the first letter of the name (or the address), in a colour that stays the same for the same reader. */
export function initialSvg(name: string, email: string): string {
  const letter = ([...(name || email).trim()][0] ?? '?').toUpperCase().replace(/[<>&"']/g, '?');
  let h = 0; for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="hsl(${hue},55%,42%)"/><text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="system-ui,-apple-system,sans-serif" font-size="30" font-weight="600" fill="#fff">${letter}</text></svg>`;
}
