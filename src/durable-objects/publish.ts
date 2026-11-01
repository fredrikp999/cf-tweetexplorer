// Publishing: topics that are summarized on a schedule and shown to the public at /<slug>.
// A topic is a set of sources (searches, lists, the monitor feed) plus an instruction and a schedule. Each run
// fetches the tweets from the last interval, has the summarizer write an issue, and stores it as a draft (or
// publishes it straight away if the topic is set to auto-publish). Runs come from a Durable Object alarm, so
// they survive eviction and deploys. Public reads go through /pub/*, admin changes through /adm/*; the Worker
// decides who may reach which (src/index.ts).
import { DurableObject } from 'cloudflare:workers';
import { json } from '../lib/twitterapi';
import { fetchSource, streamSummary } from '../summarize/agent.ts';
import { llmCost, newMeter, TWEET_PRICE } from '../summarize/pricing.ts';
import type { Meter } from '../summarize/pricing.ts';
import { recordCost } from '../lib/costs';
import { buildScript, cleanStyle } from '../media/audio-script.ts';
import type { Pause } from '../media/audio-script.ts';
import { ASPECTS, IMAGE_MODELS, isImageModel, isTtsModel, mockImage, mockMp3, replicateImage, replicateTts, TTS_MODELS, ttsCost, usdPerChar, VOICES, VOICE_NAMES } from '../media/replicate.ts';
import type { Aspect, ImageModel, TtsModel } from '../media/replicate.ts';
import { imagePrompt } from '../media/image-prompt.ts';
import type { Length, SourceSpec, XMode } from '../summarize/agent.ts';
import { compact, dedupeSort, type RawTweet } from '../summarize/tweets.ts';
import { INSTRUCTION_MAX } from '../summarize/request.ts';
import { MockModel } from '../summarize/mock-model.ts';
import { openrouterModelInfo } from '../summarize/openrouter.ts';
import { modelFor, workerSources } from '../summarize/worker';
import { screenTweets } from '../summarize/screen.ts';
import { sectionsOf, themesOf } from '../site/brief.ts';
import { setYoutubeKey } from '../sources/youtube';

export type TopicSource =
  | { type: 'search'; query: string; sort: 'Latest' | 'Top' }
  | { type: 'list'; listId: string }
  | { type: 'flist'; listId: string }     // a feed list (RSS, YouTube, Hacker News), read when the briefing runs
  | { type: 'feed'; watch?: string; source?: 'x' | 'rss' | 'hn' | 'youtube' }
  | { type: 'xlist'; listId: string; mode?: XMode; minFaves?: number; pages?: number }     // one list on x.com
  | { type: 'xgroup'; group: string; mode?: XMode; minFaves?: number; pages?: number };    // every X list in a group, read together; membership is looked up at run time
// mode: 'best' (default) = the period's top posts per list, cheap; 'latest' = timeline, newest first. pages: per list (20 posts a page in best, 80 in latest).

/** A delivery style for audio versions: a voice plus how it is read. Shared by all topics; each topic picks one. */
export interface AudioTemplate {
  id: string; name: string; builtin?: string; order: number;
  model: TtsModel;                                              // 'flash' (most expressive) or 'lite' (cheaper)
  voice: string;                                                // one of Gemini TTS's voice names (see VOICES)
  style: string;                                                // short plain-language direction for every line, e.g. "warm and calm"; '' = natural
  intro: string; outro: string;                                 // spoken first and last; {title} {date} {posts} {accounts}
  pause: Pause;                                                 // tag put between sections
}
/** A look for a briefing's picture: an image model and a prompt that is combined with the briefing text. Shared by all topics. */
export interface ImageTemplate {
  id: string; name: string; builtin?: string; order: number;
  model: ImageModel;                                            // 'best' | 'cheaper' | 'cheapest' (see IMAGE_MODELS)
  aspect: Aspect;
  prompt: string;                                               // {title} {date} {tldr} {briefing}; without {tldr}/{briefing} the briefing excerpt is added after it
}
export interface IssueImage {
  status: 'pending' | 'ready' | 'failed'; template: string; templateName: string; created: number;
  key?: string; type?: string; bytes?: number; cost?: number; model?: string; aspect?: Aspect; prompt?: string; error?: string; stale?: boolean;
}
export interface IssueAudio {
  status: 'pending' | 'ready' | 'failed'; template: string; templateName: string; created: number;
  key?: string; bytes?: number; seconds?: number; chars?: number; cost?: number; error?: string; stale?: boolean;
}
export interface Topic {
  slug: string; title: string; description: string; instruction: string; length: Length; model: string;
  imageTemplate?: string; imageAuto?: boolean;   // the same for the briefing's picture
  audioTemplate?: string; audioAuto?: boolean;   // the delivery template for this topic's audio ('' = the first one), and whether to make audio when a briefing is written
  toSignal?: boolean; signalGroup?: string;    // hand the posts this briefing fetches to Signal (free: already paid for), as a group of this name
  maxCost?: number;                            // data budget per run in USD; 0 or unset = no limit. The run stops fetching when it is spent.
  fallback?: string;                           // OpenRouter model to use if `model` cannot start; '' = none; unset (older topics) = the site default
  sources: TopicSource[];
  intervalHours: number; hourUtc: number;      // runs at hourUtc, then every intervalHours
  enabled: boolean; autoPublish: boolean; listed: boolean;
  nextRun: number; lastRun: number; lastError: string;
  pending: boolean; running: number;           // pending: "run now" was requested; running: start time of a run in flight
  replaceId?: string;                          // the requested run writes over this issue (same address) instead of adding one; cleared when it ends
  created: number; updated: number;
}
export type IssueStatus = 'draft' | 'published' | 'hidden';
/** What a run spent. Visible to the admin only. */
export interface IssueCost { twitter: number; llm: number | null; audio?: number; image?: number; total: number; calls: number; fetched: number; tokensIn: number; tokensOut: number; capped?: boolean }
/** Where a briefing's tweets came from. Shown to readers, so it never holds cost. */
export interface SourceInfo { kind: 'search' | 'list' | 'flist' | 'xlist' | 'xgroup' | 'feed'; label: string; count: number; id?: string; accounts?: number; handles?: string[]; lists?: Array<{ id?: string; label: string; count: number }>; mode?: XMode; minFaves?: number }
export interface Provenance { from: number; to: number; fetched: number; used: number; accounts: number; topAccounts: Array<{ handle: string; count: number }>; sources: SourceInfo[]; truncated: boolean; partial?: boolean;
  /** RSS feeds and Hacker News watches the posts came from, with how many items each gave. Absent on issues that used none. */
  feeds?: Array<{ source: 'rss' | 'hn' | 'youtube'; label: string; url?: string; count: number }> }
interface Spend { meter: Meter; tokensIn: number; tokensOut: number; model: string; screen: number; /** Dollars for the briefing model, priced per call: a retry on a stronger model is not priced at the first model's rate. */ text: number; priced: boolean }     // screen: dollars spent by the decision model that screens the tweets
export interface Issue {
  id: string; topic: string; status: IssueStatus; created: number; publishedAt: number;
  markdown: string; tldr: string; tweets: number; model: string; tokens: number; windowHours: number;
  cost?: IssueCost; provenance?: Provenance; audio?: IssueAudio; image?: IssueImage;      // absent on issues written before these were tracked
  /** Links to RSS articles and Hacker News pages among the posts the writer was given. The public page links only these (and x.com), never an address the model made up. */
  links?: string[];
}

export const RESERVED = new Set(['admin', 'custom', 'lists', 'signal', 'report', 'audio', 'image', 'history', 'api', 'static', 'assets', 'feed', 'rss', 'sitemap', 'robots', 'favicon', 'health', 'ai-plugin']);
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const INTERVALS = [6, 12, 24, 48, 168];
const MAX_TOPICS = 40, MAX_SOURCES = 8, MAX_TWEETS = 150, STALE_RUN_MS = 20 * 60_000;
// Stronger model for the last retry when a summary keeps hitting the output cap (must be listed in OPENROUTER_MODELS).
const ESCALATION_MODEL = 'anthropic/claude-sonnet-5.5';
const HOUR = 3_600_000;

const str = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

export const slugProblem = (slug: string): string =>
  !SLUG.test(slug) ? 'slug: lowercase letters, digits and dashes, at most 40' :
  RESERVED.has(slug) || slug.startsWith('admin') || slug.startsWith('custom') ? 'that slug is reserved' : '';

/** The next run slot after `now`: slots are hourUtc + k * interval, counted from the start of today (UTC). */
export function nextSlot(t: Pick<Topic, 'hourUtc' | 'intervalHours'>, now: number): number {
  const anchor = Math.floor(now / 86_400_000) * 86_400_000 + t.hourUtc * HOUR, step = t.intervalHours * HOUR;
  return anchor + (Math.floor((now - anchor) / step) + 1) * step;
}

function cleanSources(raw: unknown): TopicSource[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('add at least one source');
  if (raw.length > MAX_SOURCES) throw new Error(`at most ${MAX_SOURCES} sources`);
  return raw.map((r): TopicSource => {
    const s = (r ?? {}) as Record<string, unknown>;
    if (s.type === 'search') {
      const query = str(s.query, 400);
      if (!query) throw new Error('a search source needs a query');
      return { type: 'search', query, sort: s.sort === 'Top' ? 'Top' : 'Latest' };
    }
    if (s.type === 'list') {
      if (typeof s.listId !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(s.listId)) throw new Error('pick a list');
      return { type: 'list', listId: s.listId };
    }
    if (s.type === 'flist') {
      if (typeof s.listId !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(s.listId)) throw new Error('pick a feed list');
      return { type: 'flist', listId: s.listId };
    }
    // How an X list is read. Unset (topics from before this option) means the default: best posts.
    const xopts = () => ({
      mode: (s.mode === 'latest' ? 'latest' : 'best') as XMode,
      minFaves: Math.min(1000, Math.max(0, Math.floor(Number(s.minFaves)) || (s.minFaves === 0 || s.minFaves === '0' ? 0 : 5))),
      pages: Math.min(5, Math.max(1, Math.floor(Number(s.pages)) || 2)),
    });
    if (s.type === 'xlist') {
      if (typeof s.listId !== 'string' || !/^\d{1,25}$/.test(s.listId)) throw new Error('pick an X list');
      return { type: 'xlist', listId: s.listId, ...xopts() };
    }
    if (s.type === 'xgroup') {
      const group = str(s.group, 60);
      if (!group) throw new Error('pick an X list group');
      return { type: 'xgroup', group, ...xopts() };
    }
    if (s.type === 'feed') return { type: 'feed', ...(str(s.watch, 60) ? { watch: str(s.watch, 60) } : {}), ...(s.source === 'x' || s.source === 'rss' || s.source === 'hn' || s.source === 'youtube' ? { source: s.source } : {}) };
    throw new Error('unknown source type');
  });
}

function cleanTopic(b: Record<string, unknown>, prev: Topic | undefined, env: Env): Topic {
  const slug = prev?.slug ?? str(b.slug, 40);
  const problem = prev ? '' : slugProblem(slug);
  if (problem) throw new Error(problem);
  const title = str(b.title, 80);
  if (!title) throw new Error('title required');
  const intervalHours = INTERVALS.includes(Number(b.intervalHours)) ? Number(b.intervalHours) : 24;
  const hourUtc = Math.min(23, Math.max(0, Math.floor(Number(b.hourUtc)) || 0));
  const model = typeof b.model === 'string' && /^[\w@./:-]{1,120}$/.test(b.model) ? b.model : '';
  // Fallback: only a listed OpenRouter model (a cost guard), or the site's own default. Not sent: keep what the topic had.
  const fb = typeof b.fallback === 'string' ? b.fallback : undefined;
  const fallback = fb === undefined ? prev?.fallback : fb === '' || openrouterModelInfo(fb) || fb === env.SUMMARY_FALLBACK_MODEL ? fb : '';
  const now = Date.now();
  const t: Topic = {
    slug, title, description: str(b.description, 300), instruction: str(b.instruction, INSTRUCTION_MAX),
    length: b.length === 'brief' || b.length === 'detailed' ? b.length : 'standard', model, ...(fallback === undefined ? {} : { fallback }),
    toSignal: typeof b.toSignal === 'boolean' ? b.toSignal : prev?.toSignal === true, signalGroup: typeof b.signalGroup === 'string' ? str(b.signalGroup, 40) : prev?.signalGroup ?? '',
    audioTemplate: str(b.audioTemplate, 40), audioAuto: b.audioAuto === true, imageTemplate: str(b.imageTemplate, 40), imageAuto: b.imageAuto === true,
    sources: cleanSources(b.sources), intervalHours, hourUtc, maxCost: Math.min(5, Math.max(0, Math.round((Number(b.maxCost) || 0) * 1000) / 1000)),
    enabled: b.enabled !== false, autoPublish: b.autoPublish === true, listed: b.listed !== false,
    nextRun: 0, lastRun: prev?.lastRun ?? 0, lastError: prev?.lastError ?? '',
    pending: prev?.pending ?? false, running: prev?.running ?? 0, created: prev?.created ?? now, updated: now,
  };
  // Only move the schedule when it changed, so saving a typo fix does not skip a run.
  t.nextRun = prev && prev.intervalHours === intervalHours && prev.hourUtc === hourUtc && prev.nextRun > now ? prev.nextRun : nextSlot(t, now);
  return t;
}

const tldrOf = (md: string) => (/\*\*([^*\n]{8,400})\*\*/.exec(md)?.[1] ?? '').trim();
const engagement = (t: RawTweet) => (t.likeCount ?? 0) + 3 * (t.retweetCount ?? 0) + (t.replyCount ?? 0);

// Starter templates, editable once created. The voices are Gemini TTS's own studio voices.
const BUILTIN: Array<Omit<AudioTemplate, 'id' | 'order'>> = [
  { builtin: 'news', name: 'News anchor', model: 'flash', voice: 'Charon', style: 'calm, clear and confident, like a news anchor', intro: '{title}. Your briefing for {date}.',
    outro: 'That was the {title} briefing. The sources are listed on the page.', pause: 'short' },
  { builtin: 'conversational', name: 'Conversational', model: 'flash', voice: 'Achird', style: 'warm, relaxed and conversational', intro: 'Hi! Here is what is happening in {title}, {date}.',
    outro: 'That is it for now. See you next time.', pause: 'short' },
  { builtin: 'documentary', name: 'Documentary', model: 'flash', voice: 'Gacrux', style: 'calm and soft, unhurried, like a documentary narrator', intro: '{title}. {date}.',
    outro: '', pause: 'long' },
  { builtin: 'upbeat', name: 'Upbeat', model: 'flash', voice: 'Puck', style: 'confident and energetic', intro: 'It is {date}, and this is {title}.',
    outro: 'Thanks for listening!', pause: 'short' },
  { builtin: 'quick', name: 'Quick read (cheaper model)', model: 'lite', voice: 'Kore', style: '', intro: '{title}, {date}.',
    outro: '', pause: 'short' },
];
const MAX_TEMPLATES = 20;

const voiceOf = (v: unknown, d = 'Kore') => (VOICE_NAMES.includes(String(v)) ? String(v) : d);
function cleanTemplate(b: Record<string, unknown>, prev?: AudioTemplate): AudioTemplate {
  const name = str(b.name, 60);
  if (!name) throw new Error('template name required');
  return {
    id: prev?.id ?? crypto.randomUUID().slice(0, 8), order: prev?.order ?? 0, ...(prev?.builtin ? { builtin: prev.builtin } : {}), name,
    model: isTtsModel(b.model) ? b.model : 'flash', voice: voiceOf(b.voice), style: cleanStyle(String(b.style ?? '')),
    intro: str(b.intro, 300), outro: str(b.outro, 300),
    pause: b.pause === 'none' || b.pause === 'long' ? b.pause : 'short',
  };
}
/** Templates saved while audio came from Fish Audio have another shape (voice ids, bracketed cues, models): map them onto this one. */
function upgradeTemplate(raw: Record<string, any>): AudioTemplate {
  if (VOICE_NAMES.includes(raw.voice) && typeof raw.pause === 'string' && ['none', 'short', 'long'].includes(raw.pause)) return { ...raw, model: isTtsModel(raw.model) ? raw.model : 'flash' } as AudioTemplate;
  const starter = BUILTIN.find((x) => x.builtin === raw.builtin || (raw.builtin === 'quick-free' && x.builtin === 'quick'));
  return {
    id: raw.id, order: raw.order ?? 0, ...(starter ? { builtin: starter.builtin } : {}), name: raw.name,
    model: 'flash', voice: starter?.voice ?? 'Kore', style: starter ? starter.style : cleanStyle(String(raw.style ?? '').replace(/\]\[/g, ', ')),
    intro: raw.intro ?? '', outro: raw.outro ?? '', pause: raw.pause === 'none' ? 'none' : raw.pause === 'long-break' || raw.pause === 'long' ? 'long' : 'short',
  };
}
const IMAGE_BUILTIN: Array<Omit<ImageTemplate, 'id' | 'order'>> = [
  { builtin: 'editorial', name: 'Editorial illustration (best)', model: 'best', aspect: '16:9',
    prompt: 'A striking editorial illustration for a news briefing titled "{title}". It captures the main themes of the briefing: {tldr} Painterly, rich colour, one clear focal point, cinematic composition. No text, no letters, no logos and no recognizable real people.' },
  { builtin: 'flat', name: 'Flat illustration (cheaper)', model: 'cheaper', aspect: '16:9',
    prompt: 'A clean, modern flat vector-style illustration for the briefing "{title}", showing its key theme: {tldr} Bold simple shapes, a limited colour palette, generous empty space. No text, no logos, no real people.' },
  { builtin: 'abstract', name: 'Abstract header (very cheap)', model: 'cheapest', aspect: '16:9',
    prompt: 'An abstract, atmospheric header image for "{title}". Mood and themes of the briefing: {briefing} Purely abstract: soft gradients, flowing light and geometric shapes.' },
];
function cleanImageTemplate(b: Record<string, unknown>, prev?: ImageTemplate): ImageTemplate {
  const name = str(b.name, 60), prompt = str(b.prompt, 1000);
  if (!name) throw new Error('template name required');
  if (!prompt) throw new Error('the prompt cannot be empty');
  return {
    id: prev?.id ?? crypto.randomUUID().slice(0, 8), order: prev?.order ?? 0, ...(prev?.builtin ? { builtin: prev.builtin } : {}), name,
    model: isImageModel(b.model) ? b.model : 'cheaper', aspect: (ASPECTS as readonly string[]).includes(String(b.aspect)) ? (b.aspect as Aspect) : '16:9', prompt,
  };
}
/** An issue's cost with its total recomputed from the parts. */
const withTotal = (c: IssueCost): IssueCost => ({ ...c, total: c.twitter + (c.llm ?? 0) + (c.audio ?? 0) + (c.image ?? 0) });
const concat = (parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const dateLabel = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

export class PublishDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    setYoutubeKey(env.YOUTUBE_API_KEY);   // a channel whose feed fails is read through the API
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS topics (slug TEXT PRIMARY KEY, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS issues (topic TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (topic, id))');
    sql.exec('CREATE INDEX IF NOT EXISTS issues_by_status ON issues (topic, status, created)');
    sql.exec('CREATE TABLE IF NOT EXISTS audio_templates (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS audio_jobs (topic TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (topic, id))');
    sql.exec('CREATE TABLE IF NOT EXISTS image_templates (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS image_jobs (topic TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (topic, id))');
    // Errors readers reported on a briefing (one theme of it, or all of it). `who` is a hash of the address and the day, only to limit how many one reader can send.
    sql.exec("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, topic TEXT NOT NULL, issue TEXT NOT NULL, theme TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', who TEXT NOT NULL)");
    if (sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM audio_templates').one().n === 0) this.restoreBuiltins();
    if (sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM image_templates').one().n === 0) this.restoreImageBuiltins();
  }

  // ---- storage
  private topics(): Topic[] {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM topics ORDER BY slug').toArray().map((r) => JSON.parse(r.data) as Topic);
  }
  private topic(slug: string): Topic | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM topics WHERE slug = ?', slug).toArray()[0];
    return row ? (JSON.parse(row.data) as Topic) : undefined;
  }
  private saveTopic(t: Topic): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO topics (slug, data) VALUES (?, ?)', t.slug, JSON.stringify(t)); }
  private issues(slug: string, status?: IssueStatus, limit = 60): Issue[] {
    const rows = status
      ? this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM issues WHERE topic = ? AND status = ? ORDER BY created DESC LIMIT ?', slug, status, limit)
      : this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM issues WHERE topic = ? ORDER BY created DESC LIMIT ?', slug, limit);
    return rows.toArray().map((r) => JSON.parse(r.data) as Issue);
  }
  private issue(slug: string, id: string): Issue | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM issues WHERE topic = ? AND id = ?', slug, id).toArray()[0];
    return row ? (JSON.parse(row.data) as Issue) : undefined;
  }
  private saveIssue(i: Issue): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO issues (topic, id, status, created, data) VALUES (?, ?, ?, ?, ?)', i.topic, i.id, i.status, i.created, JSON.stringify(i));
  }
  // ---- audio templates
  private templates(): AudioTemplate[] {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM audio_templates ORDER BY ord, id').toArray().map((r) => upgradeTemplate(JSON.parse(r.data)));
  }
  private putTemplate(t: AudioTemplate): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO audio_templates (id, ord, data) VALUES (?, ?, ?)', t.id, t.order, JSON.stringify(t)); }
  /** Adds any starter template that is missing (matched by its builtin key). Returns how many were added. */
  private restoreBuiltins(): number {
    const have = new Set(this.templates().map((t) => t.builtin)), top = Math.max(0, ...this.templates().map((t) => t.order));
    let n = 0;
    for (const b of BUILTIN) if (!have.has(b.builtin)) this.putTemplate({ ...b, id: crypto.randomUUID().slice(0, 8), order: top + ++n });
    return n;
  }
  private imageTemplates(): ImageTemplate[] {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM image_templates ORDER BY ord, id').toArray().map((r) => JSON.parse(r.data) as ImageTemplate);
  }
  private putImageTemplate(t: ImageTemplate): void { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO image_templates (id, ord, data) VALUES (?, ?, ?)', t.id, t.order, JSON.stringify(t)); }
  private restoreImageBuiltins(): number {
    const have = new Set(this.imageTemplates().map((t) => t.builtin)), top = Math.max(0, ...this.imageTemplates().map((t) => t.order));
    let n = 0;
    for (const b of IMAGE_BUILTIN) if (!have.has(b.builtin)) this.putImageTemplate({ ...b, id: crypto.randomUUID().slice(0, 8), order: top + ++n });
    return n;
  }
  private imageTemplateFor(t: Topic): ImageTemplate | undefined {
    const all = this.imageTemplates();
    return all.find((x) => x.id === t.imageTemplate) ?? all[0];
  }
  private templateFor(t: Topic): AudioTemplate | undefined {
    const all = this.templates();
    return all.find((x) => x.id === t.audioTemplate) ?? all[0];
  }
  // REPLICATE_API_TOKEN is a secret; AUDIO_MOCK=1 (only in .dev.vars, never deployed) makes local runs use a silent MP3.
  private ttsKey(): string | undefined {
    const e = this.env as { REPLICATE_API_TOKEN?: string; AUDIO_MOCK?: string };
    return e.AUDIO_MOCK === '1' ? 'mock' : e.REPLICATE_API_TOKEN || undefined;
  }

  /** Reads a briefing aloud with the topic's template and stores the MP3 in R2. Never throws: the outcome is on the issue. */
  private async makeAudio(slug: string, id: string): Promise<void> {
    const t = this.topic(slug); let issue = this.issue(slug, id);
    if (!t || !issue) { this.ctx.storage.sql.exec('DELETE FROM audio_jobs WHERE topic = ? AND id = ?', slug, id); return; }
    const tpl = this.templateFor(t), started = Date.now();
    const save = (audio: IssueAudio) => { issue = { ...(this.issue(slug, id) ?? issue!), audio }; this.saveIssue(issue); };
    save({ status: 'pending', template: tpl?.id ?? '', templateName: tpl?.name ?? '', created: started });
    let chars = 0, spent = 0, error = '';
    try {
      if (!tpl) throw new Error('create an audio template first');
      const key = this.ttsKey(), mock = key === 'mock';
      if (!key) throw new Error('Audio is not configured: add the REPLICATE_API_TOKEN secret');
      const chunks = buildScript(issue.markdown, tpl, { title: t.title, date: dateLabel(issue.publishedAt || issue.created), posts: issue.tweets, accounts: issue.provenance?.accounts ?? 0 });
      if (!chunks.length) throw new Error('there is nothing to read');
      const parts: Uint8Array[] = [];
      for (const c of chunks) {
        if (mock) parts.push(mockMp3(Math.min(6, c.length / 20)));
        else { const r = await replicateTts(key, tpl, c); parts.push(r.audio); spent += ttsCost(tpl.model, r.tokensIn, r.tokensOut); }
        chars += c.length;
      }
      const mp3 = concat(parts), objectKey = `audio/${slug}/${id}.mp3`;
      await this.env.AUDIO.put(objectKey, mp3, { httpMetadata: { contentType: 'audio/mpeg' } });
      const cost = spent, seconds = Math.round((mp3.length * 8) / (128 * 1000));     // Gemini's MP3s are about 128 kbps; close enough for a player label
      save({ status: 'ready', template: tpl.id, templateName: tpl.name, created: Date.now(), key: objectKey, bytes: mp3.length, seconds, chars, cost });
      const cur = this.issue(slug, id);
      if (cur?.cost) this.saveIssue({ ...cur, cost: withTotal({ ...cur.cost, audio: cost }) });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error('audio failed', slug, id, error);
      save({ status: 'failed', template: tpl?.id ?? '', templateName: tpl?.name ?? '', created: Date.now(), error: error.slice(0, 240) });
    }
    this.ctx.storage.sql.exec('DELETE FROM audio_jobs WHERE topic = ? AND id = ?', slug, id);
    if (spent && tpl) await recordCost(this.env, { kind: 'audio', ref: slug, label: `${t.title} · audio`, llm: spent, model: TTS_MODELS[tpl.model].slug, run: { ok: !error, note: error || `${id} · ${chars} characters` } });
  }

  /** Draws a picture for a briefing with the topic's image template and stores it in R2. Never throws: the outcome is on the issue. */
  private async makeImage(slug: string, id: string): Promise<void> {
    const t = this.topic(slug); let issue = this.issue(slug, id);
    if (!t || !issue) { this.ctx.storage.sql.exec('DELETE FROM image_jobs WHERE topic = ? AND id = ?', slug, id); return; }
    const tpl = this.imageTemplateFor(t), started = Date.now();
    const save = (image: IssueImage) => { issue = { ...(this.issue(slug, id) ?? issue!), image }; this.saveIssue(issue); };
    save({ status: 'pending', template: tpl?.id ?? '', templateName: tpl?.name ?? '', created: started });
    let spent = 0, error = '';
    try {
      if (!tpl) throw new Error('create an image template first');
      const key = this.ttsKey(), mock = key === 'mock';
      if (!key) throw new Error('Images are not configured: add the REPLICATE_API_TOKEN secret');
      const prompt = imagePrompt(issue.markdown, tpl.prompt, { title: t.title, date: dateLabel(issue.publishedAt || issue.created), tldr: issue.tldr });
      const img = mock ? mockImage(t.title, tpl.aspect) : await replicateImage(key, tpl.model, prompt, tpl.aspect);
      spent = img.cost;
      const objectKey = `image/${slug}/${id}`;
      await this.env.AUDIO.put(objectKey, img.bytes, { httpMetadata: { contentType: img.type } });     // the AUDIO bucket holds the pictures too
      save({ status: 'ready', template: tpl.id, templateName: tpl.name, created: Date.now(), key: objectKey, type: img.type, bytes: img.bytes.length, cost: spent, model: IMAGE_MODELS[tpl.model].slug, aspect: tpl.aspect, prompt });
      const cur = this.issue(slug, id);
      if (cur?.cost) this.saveIssue({ ...cur, cost: withTotal({ ...cur.cost, image: spent }) });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error('image failed', slug, id, error);
      save({ status: 'failed', template: tpl?.id ?? '', templateName: tpl?.name ?? '', created: Date.now(), error: error.slice(0, 240) });
    }
    this.ctx.storage.sql.exec('DELETE FROM image_jobs WHERE topic = ? AND id = ?', slug, id);
    if (spent && tpl) await recordCost(this.env, { kind: 'image', ref: slug, label: `${t.title} · image`, llm: spent, model: IMAGE_MODELS[tpl.model].slug, run: { ok: !error, note: error || `${id} · ${tpl.name}` } });
  }

  // Public view of an issue's list entry (no body).
  private brief = (i: Issue) => ({ id: i.id, status: i.status, created: i.created, publishedAt: i.publishedAt, tldr: i.tldr, tweets: i.tweets, accounts: i.provenance?.accounts ?? null, themes: themesOf(i.markdown) });
  // Admin list entry: adds the cost. The public routes use brief() and pubIssue(), which never carry it.
  private admBrief = (i: Issue) => ({ ...this.brief(i), cost: i.cost?.total ?? null, audio: i.audio ? { status: i.audio.status, seconds: i.audio.seconds ?? 0, cost: i.audio.cost ?? 0, stale: !!i.audio.stale, error: i.audio.error ?? '', templateName: i.audio.templateName } : null,
    image: i.image ? { status: i.image.status, cost: i.image.cost ?? 0, stale: !!i.image.stale, error: i.image.error ?? '', templateName: i.image.templateName } : null });
  // What the public may know of an issue: never cost, and only the audio's length and a version stamp (not where it is stored).
  private pubIssue = (i: Issue): Omit<Issue, 'cost' | 'audio' | 'image'> & { audio?: { seconds: number; v: number }; image?: { v: number; aspect: string } } => {
    const { cost: _c, audio, image, ...rest } = i;
    return { ...rest, ...(audio?.status === 'ready' ? { audio: { seconds: audio.seconds ?? 0, v: audio.created } } : {}), ...(image?.status === 'ready' ? { image: { v: image.created, aspect: image.aspect ?? '16:9' } } : {}) };
  };
  private publicTopic = (t: Topic) => ({ slug: t.slug, title: t.title, description: t.description, intervalHours: t.intervalHours });

  // ---- scheduling
  private async arm(): Promise<void> {
    const jobs = this.ctx.storage.sql.exec<{ n: number }>('SELECT (SELECT COUNT(*) FROM audio_jobs) + (SELECT COUNT(*) FROM image_jobs) AS n').one().n;
    if (jobs) { await this.ctx.storage.setAlarm(Date.now() + 1000); return; }
    const live = this.topics().filter((t) => t.pending || t.enabled);
    if (!live.length) { await this.ctx.storage.deleteAlarm(); return; }
    const when = live.some((t) => t.pending) ? Date.now() : Math.min(...live.map((t) => t.nextRun));
    await this.ctx.storage.setAlarm(Math.max(when, Date.now() + 1000));
  }

  async alarm(): Promise<void> {
    try {
      const now = Date.now();
      // One topic per alarm: every invocation has its own subrequest budget, so a heavy topic cannot starve the next one.
      // runTopic moves nextRun on, and arm() fires again a second later for whichever topic is still due.
      const due = this.topics().find((t) => t.pending || (t.enabled && t.nextRun <= now));
      if (due) { await this.runTopic(due.slug); return; }
      for (const j of this.ctx.storage.sql.exec<{ topic: string; id: string }>('SELECT topic, id FROM image_jobs').toArray()) await this.makeImage(j.topic, j.id);
      for (const j of this.ctx.storage.sql.exec<{ topic: string; id: string }>('SELECT topic, id FROM audio_jobs').toArray()) await this.makeAudio(j.topic, j.id);
    } catch (err) {
      console.error('publish alarm failed', err instanceof Error ? err.message : String(err));
    } finally {
      await this.arm();   // always re-arm, or one bad run would stop every schedule
    }
  }

  private async runTopic(slug: string): Promise<void> {
    let t = this.topic(slug);
    if (!t) return;
    if (t.running && Date.now() - t.running < STALE_RUN_MS) return;
    const scheduled = !t.pending;
    t = { ...t, running: Date.now(), pending: false };
    this.saveTopic(t);
    let error = '', issueId = '';
    const spend: Spend = { meter: newMeter(), tokensIn: 0, tokensOut: 0, model: '', screen: 0, text: 0, priced: true };
    try {
      issueId = await this.generate(t, spend);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error('topic run failed', slug, error);
    }
    // Money was spent even when the run failed (the tweets were fetched), so the ledger gets it either way.
    if (spend.meter.calls || spend.tokensIn) {
      await recordCost(this.env, { kind: 'publish', ref: slug, label: t.title, twitter: spend.meter.cost, tweets: spend.meter.tweets, calls: spend.meter.calls,
        llm: spend.text + spend.screen, tokensIn: spend.tokensIn, tokensOut: spend.tokensOut, model: spend.model, run: { ok: !error, note: error || issueId } });
    }
    if (!error && issueId && t.imageAuto) await this.makeImage(slug, issueId);   // likewise
    if (!error && issueId && t.audioAuto) await this.makeAudio(slug, issueId);   // its outcome is recorded on the issue, it cannot fail the briefing
    const cur = this.topic(slug) ?? t;   // the admin may have edited it meanwhile
    this.saveTopic({ ...cur, running: 0, replaceId: undefined, lastRun: Date.now(), lastError: error, ...(scheduled || cur.nextRun <= Date.now() ? { nextRun: nextSlot(cur, Date.now()) } : {}) });
  }

  private async generate(t: Topic, spend: Spend): Promise<string> {
    if (t.maxCost) spend.meter.cap = t.maxCost;
    const sources = workerSources(this.env, spend.meter);
    // SUMMARY_MOCK only exists in .dev.vars (local `wrangler dev`); it is not a deployed variable.
    const built = this.env.SUMMARY_MOCK === '1' ? { model: new MockModel(), id: 'mock' } : modelFor(this.env, t.model || undefined, t.fallback);
    if (!built) throw new Error('no AI provider is configured');
    const windowHours = t.intervalHours, since = Date.now() - windowHours * HOUR;

    const got: RawTweet[] = [], paid: RawTweet[] = [], notes: string[] = [], infos: SourceInfo[] = [];
    // With a data budget, give every X list the same share of it (pages per list), so the first lists cannot use it all up.
    const xl = (await sources.xlists?.().catch(() => [])) ?? [];
    const idsOf = (s: TopicSource) => (s.type === 'xgroup' ? xl.filter((l) => l.groups.includes(s.group)).map((l) => l.id) : s.type === 'xlist' ? [s.listId] : []);
    const listReads = t.sources.reduce((n, s) => n + idsOf(s).length, 0);
    const pagesFor = (s: TopicSource & { type: 'xlist' | 'xgroup' }) => {
      const want = s.pages ?? 2, perPage = (s.mode === 'latest' ? 80 : 20) * TWEET_PRICE;
      return t.maxCost && listReads ? Math.max(1, Math.min(want, Math.floor((t.maxCost * 0.85) / (listReads * perPage)))) : want;
    };
    for (const s of t.sources) {
      try {
        let spec: Exclude<SourceSpec, { type: 'free' }>;
        if (s.type === 'xgroup') {
          const ids = idsOf(s);
          if (!ids.length) throw new Error(`the X list group "${s.group}" has no lists`);
          spec = { type: 'xlist', listIds: ids, hours: windowHours, pages: pagesFor(s), mode: s.mode ?? 'best', minFaves: s.minFaves ?? 5, sequential: !!t.maxCost };
        } else spec =
          s.type === 'search' ? { type: 'search', query: `${s.query} since_time:${Math.floor(since / 1000)}`, sort: s.sort, pages: 3 }
          : s.type === 'list' ? { type: 'list', listId: s.listId, hours: windowHours }
          : s.type === 'flist' ? { type: 'flist', listId: s.listId, hours: windowHours }
          : s.type === 'xlist' ? { type: 'xlist', listIds: [s.listId], hours: windowHours, pages: pagesFor(s), mode: s.mode ?? 'best', minFaves: s.minFaves ?? 5 }
          : { type: 'feed', limit: 200, ...(s.watch ? { watch: s.watch } : {}), ...(s.source ? { source: s.source } : {}) };
        const r = await fetchSource(sources, spec), parts = r.parts ?? [];
        got.push(...r.tweets);
        if (s.type !== 'feed') paid.push(...r.tweets);   // the Monitor feed is Signal's own data already
        const how = spec.type === 'xlist' ? { mode: spec.mode, minFaves: spec.minFaves } : {};
        if (s.type === 'xgroup') infos.push({ kind: 'xgroup', label: s.group, count: parts.reduce((n, p) => n + p.count, 0), ...how, lists: parts.map((p) => ({ id: p.id, label: p.label, count: p.count })) });
        else for (const p of parts) infos.push({ kind: p.kind, label: p.label, id: p.id, count: p.count, accounts: p.accounts, handles: p.handles, ...how });
      } catch (err) { notes.push(err instanceof Error ? err.message : String(err)); }
    }
    const recent = dedupeSort(got).filter((x) => !x.createdAt || Date.parse(x.createdAt) >= since);
    if (!recent.length) throw new Error(spend.meter.capped ? 'the data budget was reached before any tweets were collected; raise it' : notes.length ? `no tweets: ${notes.join('; ')}` : 'no tweets matched in this period');
    // The posts are paid for: Signal can count them too, so it does not have to fetch them again. Never fails the briefing.
    if (t.toSignal) {
      try {
        await this.env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/signal-ingest', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: t.slug, title: t.title, group: t.signalGroup || t.title, posts: dedupeSort(paid) }) }));
      } catch (err) { console.error('signal hand-over failed', t.slug, err instanceof Error ? err.message : String(err)); }
    }
    // Too many: keep the ones people reacted to most, then restore chronological order.
    const used = recent.length <= MAX_TWEETS ? recent : dedupeSort([...recent].sort((a, b) => engagement(b) - engagement(a)).slice(0, MAX_TWEETS));

    const instruction = `This is the "${t.title}" briefing, published to the public. Write for readers who have not seen these tweets. ` +
      `Cover the last ${windowHours} hours.${t.description ? ' Scope: ' + t.description + '.' : ''} ${t.instruction}`.trim();
    let markdown = '', tokens = 0, fail = '', usedModel = built.id;
    spend.model = built.id;
    // A run that hits the output cap or loses the connection is nondeterministic: retry once on the same model, then escalate to a stronger one.
    // Only the model call repeats; the tweets are already fetched, so a retry costs no more Twitter data.
    // Screening is the most call-heavy step (one request per tweet), so run it once and let every attempt reuse the result.
    let screened: ReturnType<typeof screenTweets> | undefined;
    const screen = (tweets: Parameters<typeof screenTweets>[1], instr?: string) => (screened ??= screenTweets(this.env, tweets, instr).then((r) => { if (r) spend.screen += r.cost; return r; }));
    const tries = [built, built, ...(this.env.SUMMARY_MOCK === '1' ? [] : [modelFor(this.env, ESCALATION_MODEL, '')])];
    for (const [n, attempt] of tries.entries()) {
      if (!attempt) continue;
      markdown = ''; fail = '';
      for await (const ev of streamSummary({ req: { instruction, length: t.length, tweets: used.map(compact) }, sources, model: attempt.model, modelId: attempt.id,
        screen })) {
        if (ev.type === 'text') markdown += ev.delta;
        else if (ev.type === 'usage') { tokens = ev.inputTokens + ev.outputTokens; usedModel = ev.model ?? usedModel; spend.tokensIn += ev.inputTokens; spend.tokensOut += ev.outputTokens; spend.model = usedModel;
          const c = llmCost(usedModel, ev.inputTokens, ev.outputTokens, { read: ev.cacheRead, write: ev.cacheWrite }); if (c === null) spend.priced = false; else spend.text += c; }
        else if (ev.type === 'error') fail = ev.message;
      }
      if (!fail || !/maximum token limit|connection error/i.test(fail) || n === tries.length - 1) break;
      console.warn('summary failed in a retryable way, retrying', t.slug, attempt.id);
    }
    if (fail) throw new Error(fail);
    markdown = markdown.trim();
    if (!markdown) throw new Error('the model returned no text');

    const day = new Date().toISOString().slice(0, 10), old = t.replaceId ? this.issue(t.slug, t.replaceId) : undefined;
    let id = day;
    if (old) id = old.id;   // a re-run that replaces an issue keeps its address, so links to it still work
    else for (let n = 2; this.issue(t.slug, id); n++) id = `${day}-${n}`;
    // A replaced issue that was published stays published: replacing it was asked for by hand.
    const now = Date.now(), live = t.autoPublish || old?.status === 'published';
    const byAccount = new Map<string, { handle: string; count: number }>();
    const byFeed = new Map<string, { source: 'rss' | 'hn' | 'youtube'; label: string; url?: string; count: number }>();
    for (const x of used) {
      if (x.source === 'rss' || x.source === 'hn' || x.source === 'youtube') {   // not an X account: counted per feed instead
        // Items stored before feeds were named share one entry, not one per author.
        const label = x.feed || (x.source === 'hn' ? 'Hacker News' : 'RSS items'), k = `${x.source}\n${x.feedUrl ?? ''}\n${label}`;
        const e = byFeed.get(k) ?? { source: x.source, label, ...(x.feedUrl ? { url: x.feedUrl } : {}), count: 0 }; e.count++; byFeed.set(k, e);
        continue;
      }
      const h = x.author?.userName; if (!h) continue;
      const e = byAccount.get(h.toLowerCase()) ?? { handle: h, count: 0 }; e.count++; byAccount.set(h.toLowerCase(), e);
    }
    const llm = !spend.priced && !spend.text && !spend.screen ? null : spend.text + spend.screen;
    const links = [...new Set(used.flatMap((x) => (x.source && x.source !== 'x' ? [x.url, x.discussionUrl] : [])).filter((u): u is string => /^https?:\/\//.test(u ?? '')))].slice(0, 400);
    this.saveIssue({
      id, topic: t.slug, status: live ? 'published' : 'draft', created: now, publishedAt: live ? now : 0,
      markdown, tldr: tldrOf(markdown), tweets: used.length, model: usedModel, tokens, windowHours, ...(links.length ? { links } : {}),
      cost: { twitter: spend.meter.cost, llm, total: spend.meter.cost + (llm ?? 0), calls: spend.meter.calls, fetched: spend.meter.tweets, tokensIn: spend.tokensIn, tokensOut: spend.tokensOut, ...(spend.meter.capped ? { capped: true } : {}) },
      provenance: {
        from: since, to: now, fetched: recent.length, used: used.length, accounts: byAccount.size, sources: infos, truncated: recent.length > used.length, ...(spend.meter.capped ? { partial: true } : {}),
        topAccounts: [...byAccount.values()].sort((a, b) => b.count - a.count).slice(0, 10),
        ...(byFeed.size ? { feeds: [...byFeed.values()].sort((a, b) => b.count - a.count).slice(0, 40) } : {}),
      },
    });
    return id;
  }

  // ---- HTTP (internal: the Worker is the only caller)
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname, q = url.searchParams;
    try {
      // Public reads: only what has been published.
      if (path === '/pub/topics') {
        const out = this.topics().filter((t) => t.listed).flatMap((t) => {
          const latest = this.issues(t.slug, 'published', 1)[0];
          return latest ? [{ ...this.publicTopic(t), latest: this.brief(latest) }] : [];
        });
        return json(out);
      }
      if (path === '/pub/topic' || path === '/pub/issue') {
        const t = this.topic(q.get('slug') ?? '');
        if (!t) return json({ error: 'not found' }, 404);
        const published = this.issues(t.slug, 'published', 90);
        const issue = path === '/pub/issue' ? published.find((i) => i.id === q.get('id')) : published[0];
        if (!issue) return json({ error: 'not found' }, 404);   // a topic with nothing published does not exist, publicly
        return json({ topic: this.publicTopic(t), issue: this.pubIssue(issue), archive: published.map(this.brief) });
      }

      // Which recent published briefings mention any of these names (a Signal topic and the names counted under it), newest first.
      if (path === '/pub/mentions') {
        const names = (q.get('q') ?? '').split('|').map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3).slice(0, 8);
        const since = Date.now() - 14 * 86_400_000, out: Array<{ slug: string; title: string; id: string; publishedAt: number; tldr: string; theme?: string; anchor?: string }> = [];
        const has = (text: string, n: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(text);
        if (names.length) for (const t of this.topics().filter((x) => x.listed)) {
          for (const i of this.issues(t.slug, 'published', 14)) {
            if (i.publishedAt < since) break;
            const text = i.markdown.toLowerCase();
            if (!names.some((n) => has(text, n))) continue;
            const sec = sectionsOf(i.markdown).find((x) => names.some((n) => has(`${x.title}\n${x.body}`.toLowerCase(), n)));   // the theme that mentions it, to link straight to
            out.push({ slug: t.slug, title: t.title, id: i.id, publishedAt: i.publishedAt, tldr: i.tldr, ...(sec ? { theme: sec.title, anchor: sec.anchor } : {}) });
          }
        }
        return json(out.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 6));
      }
      if (path === '/pub/report' && request.method === 'POST') {   // from the public report form (the Worker checked the form and hashed the address)
        const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const slug = str(b.slug, 40), id = str(b.id, 20), theme = str(b.theme, 120), message = str(b.message, 1000), who = str(b.who, 64);
        const t = this.topic(slug), issue = t ? this.issues(slug, 'published', 90).find((i) => i.id === id) : undefined;
        if (!t || !issue || message.length < 5) return json({ error: 'not found' }, 404);
        const sql = this.ctx.storage.sql;
        if (sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE who = ?', who).one().n >= 5) return json({ error: 'too many' }, 429);
        if (sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE status = 'new'").one().n >= 500) return json({ error: 'too many' }, 429);
        sql.exec('INSERT INTO reports (created, topic, issue, theme, message, who) VALUES (?, ?, ?, ?, ?, ?)', Date.now(), slug, id, theme, message, who);
        return json({ ok: true });
      }
      if (path === '/pub/feed') {   // the newest published issues in full, for the topic's RSS feed
        const t = this.topic(q.get('slug') ?? '');
        if (!t || !t.listed) return json({ error: 'not found' }, 404);
        return json({ topic: this.publicTopic(t), issues: this.issues(t.slug, 'published', 20).map(this.pubIssue) });
      }
      if (path === '/pub/archive') {
        const t = this.topic(q.get('slug') ?? '');
        const [latest, ...older] = t ? this.issues(t.slug, 'published', 31) : [];
        if (!t || !latest) return json({ error: 'not found' }, 404);
        return json({ topic: this.publicTopic(t), latest: this.brief(latest), issues: older.map(this.pubIssue) });   // full text of the last 30 earlier days
      }

      // The audio file's location, for the Worker to serve: only for a published issue that has audio.
      if (path === '/pub/audio') {
        const i = this.issue(q.get('slug') ?? '', q.get('id') ?? '');
        return i?.status === 'published' && i.audio?.status === 'ready' && i.audio.key ? json({ key: i.audio.key }) : json({ error: 'not found' }, 404);
      }

      // The picture's location, for the Worker to serve: only for a published issue that has one.
      if (path === '/pub/image') {
        const i = this.issue(q.get('slug') ?? '', q.get('id') ?? '');
        return i?.status === 'published' && i.image?.status === 'ready' && i.image.key ? json({ key: i.image.key }) : json({ error: 'not found' }, 404);
      }

      // Admin.
      if (path === '/adm/image-templates') {
        const key = this.ttsKey();
        return json({ templates: this.imageTemplates(), configured: !!key, mock: key === 'mock', aspects: ASPECTS, models: Object.entries(IMAGE_MODELS).map(([id, m]) => ({ id, label: m.label, usd: m.usd })) });
      }
      if (path === '/adm/audio-templates') {
        const key = this.ttsKey();
        return json({ templates: this.templates(), configured: !!key, mock: key === 'mock', voices: VOICES, models: Object.entries(TTS_MODELS).map(([id, m]) => ({ id, label: m.label, perChar: usdPerChar(id as TtsModel) })) });
      }
      if (path === '/adm/reports') {   // what readers reported: new first, then the last ones handled
        const rows = this.ctx.storage.sql.exec<{ id: number; created: number; topic: string; issue: string; theme: string; message: string; status: string }>(
          "SELECT id, created, topic, issue, theme, message, status FROM reports ORDER BY status = 'new' DESC, created DESC LIMIT 60").toArray();
        return json(rows.map((r) => ({ ...r, title: this.topic(r.topic)?.title ?? r.topic })));
      }
      if (path === '/adm/report-done') {
        const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        this.ctx.storage.sql.exec("UPDATE reports SET status = 'done' WHERE id = ?", Number(b.id) || 0);
        return json({ ok: true });
      }
      if (path === '/adm/topics') {
        const stats = await this.env.COST.getByName('main').topicStats().catch(() => ({}) as Record<string, never>);
        return json(this.topics().map((t) => ({ ...t, stats: stats[t.slug] ?? null, issues: this.issues(t.slug, undefined, 30).map(this.admBrief) })));
      }
      if (path === '/adm/issue') {
        const i = this.issue(q.get('slug') ?? '', q.get('id') ?? '');
        return i ? json(i) : json({ error: 'not found' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'not found' }, 404);
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const slug = str(b.slug, 40);

      if (path === '/adm/save-topic') {
        const prev = this.topic(slug);
        if (b.isNew && prev) throw new Error('a topic with that slug already exists');
        if (!b.isNew && !prev) throw new Error('unknown topic');
        if (!prev && this.topics().length >= MAX_TOPICS) throw new Error(`at most ${MAX_TOPICS} topics`);
        const t = cleanTopic(b, prev, this.env);
        this.saveTopic(t);
        await this.arm();
        return json(t);
      }
      if (path === '/adm/delete-topic') {
        this.ctx.storage.sql.exec('DELETE FROM topics WHERE slug = ?', slug);
        for (const i of this.issues(slug, undefined, 100_000)) { if (i.audio?.key) await this.env.AUDIO.delete(i.audio.key); if (i.image?.key) await this.env.AUDIO.delete(i.image.key); }
        this.ctx.storage.sql.exec('DELETE FROM issues WHERE topic = ?', slug);
        this.ctx.storage.sql.exec('DELETE FROM audio_jobs WHERE topic = ?', slug); this.ctx.storage.sql.exec('DELETE FROM image_jobs WHERE topic = ?', slug);
        await this.arm();
        return json({ ok: true });
      }
      if (path === '/adm/image-template-save') {
        const all = this.imageTemplates(), prev = all.find((x) => x.id === str(b.id, 20));
        if (b.id && !prev) throw new Error('unknown template');
        if (!prev && all.length >= MAX_TEMPLATES) throw new Error(`at most ${MAX_TEMPLATES} templates`);
        const t = cleanImageTemplate(b, prev); if (!prev) t.order = Math.max(0, ...all.map((x) => x.order)) + 1;
        this.putImageTemplate(t);
        return json(t);
      }
      if (path === '/adm/image-template-delete') { this.ctx.storage.sql.exec('DELETE FROM image_templates WHERE id = ?', str(b.id, 20)); return json({ ok: true }); }
      if (path === '/adm/image-templates-restore') return json({ added: this.restoreImageBuiltins() });
      // A sample picture with the (possibly unsaved) template and a made-up briefing, so a model and prompt can be tried. Costs one picture; not stored.
      if (path === '/adm/image-preview') {
        const key = this.ttsKey();
        if (!key) throw new Error('Images are not configured: add the REPLICATE_API_TOKEN secret');
        const tpl = cleanImageTemplate({ ...b, name: b.name || 'Preview' });
        const sample = 'A new open model has topped the leaderboard, and developers are already comparing notes.\n\nResearchers praise its reasoning, while some question the benchmark.\n\nThat is the picture so far.';
        const prompt = imagePrompt(sample, tpl.prompt, { title: str(b.title, 80) || 'AI News', date: dateLabel(Date.now()), tldr: 'A new open model tops the leaderboard; developers compare notes.' });
        const img = key === 'mock' ? mockImage('Sample', tpl.aspect) : await replicateImage(key, tpl.model, prompt, tpl.aspect);
        await recordCost(this.env, { kind: 'image', ref: 'preview', label: 'Template preview', llm: img.cost, model: IMAGE_MODELS[tpl.model].slug, run: { ok: true, note: tpl.name } });
        return new Response(img.bytes, { headers: { 'content-type': img.type, 'cache-control': 'no-store', 'x-prompt': encodeURIComponent(prompt.slice(0, 600)) } });
      }
      if (path === '/adm/image-create') {
        const id = str(b.id, 20), i = this.issue(slug, id);
        if (!i) throw new Error('unknown issue');
        if (!this.ttsKey()) throw new Error('Images are not configured: add the REPLICATE_API_TOKEN secret');
        if (!this.imageTemplateFor(this.topic(slug)!)) throw new Error('create an image template first');
        if (i.image?.status === 'pending') throw new Error('an image is already being created');
        this.saveIssue({ ...i, image: { status: 'pending', template: '', templateName: '', created: Date.now() } });
        this.ctx.storage.sql.exec('INSERT OR IGNORE INTO image_jobs (topic, id) VALUES (?, ?)', slug, id);
        await this.arm();
        return json({ ok: true });
      }
      if (path === '/adm/image-delete') {
        const id = str(b.id, 20), i = this.issue(slug, id);
        if (!i) throw new Error('unknown issue');
        if (i.image?.key) await this.env.AUDIO.delete(i.image.key);
        const { image: _gone, ...rest } = i;
        this.saveIssue(rest);
        this.ctx.storage.sql.exec('DELETE FROM image_jobs WHERE topic = ? AND id = ?', slug, id);
        return json({ ok: true });
      }
      if (path === '/adm/audio-template-save') {
        const all = this.templates(), prev = all.find((x) => x.id === str(b.id, 20));
        if (b.id && !prev) throw new Error('unknown template');
        if (!prev && all.length >= MAX_TEMPLATES) throw new Error(`at most ${MAX_TEMPLATES} templates`);
        const t = cleanTemplate(b, prev); if (!prev) t.order = Math.max(0, ...all.map((x) => x.order)) + 1;
        this.putTemplate(t);
        return json(t);
      }
      if (path === '/adm/audio-template-delete') { this.ctx.storage.sql.exec('DELETE FROM audio_templates WHERE id = ?', str(b.id, 20)); return json({ ok: true }); }
      if (path === '/adm/audio-templates-restore') return json({ added: this.restoreBuiltins() });
      // A short sample with the (possibly unsaved) template, so a voice and style can be tried before it is used. Not stored.
      if (path === '/adm/audio-preview') {
        const key = this.ttsKey();
        if (!key) throw new Error('Audio is not configured: add the REPLICATE_API_TOKEN secret');
        const tpl = cleanTemplate({ ...b, name: b.name || 'Preview' });
        const sample = 'The big story today: a new open model has topped the leaderboard, and developers are already comparing notes.\n\n- Researchers praise its reasoning.\n- Some question the benchmark.\n\nThat is the picture so far.';
        const text = buildScript(sample, tpl, { title: 'Sample briefing', date: dateLabel(Date.now()), posts: 150, accounts: 87 }).join('\n');
        const r = key === 'mock' ? { audio: mockMp3(3), tokensIn: 0, tokensOut: 0 } : await replicateTts(key, tpl, text);
        await recordCost(this.env, { kind: 'audio', ref: 'preview', label: 'Template preview', llm: ttsCost(tpl.model, r.tokensIn, r.tokensOut), model: TTS_MODELS[tpl.model].slug, run: { ok: true, note: tpl.name } });
        const mp3 = r.audio;
        return new Response(mp3, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
      }
      if (path === '/adm/audio-create') {
        const id = str(b.id, 20), i = this.issue(slug, id);
        if (!i) throw new Error('unknown issue');
        if (!this.ttsKey()) throw new Error('Audio is not configured: add the REPLICATE_API_TOKEN secret');
        if (!this.templateFor(this.topic(slug)!)) throw new Error('create an audio template first');
        if (i.audio?.status === 'pending') throw new Error('audio is already being created');
        this.saveIssue({ ...i, audio: { status: 'pending', template: '', templateName: '', created: Date.now() } });
        this.ctx.storage.sql.exec('INSERT OR IGNORE INTO audio_jobs (topic, id) VALUES (?, ?)', slug, id);
        await this.arm();
        return json({ ok: true });
      }
      if (path === '/adm/audio-delete') {
        const id = str(b.id, 20), i = this.issue(slug, id);
        if (!i) throw new Error('unknown issue');
        if (i.audio?.key) await this.env.AUDIO.delete(i.audio.key);
        const { audio: _gone, ...rest } = i;
        this.saveIssue(rest);
        this.ctx.storage.sql.exec('DELETE FROM audio_jobs WHERE topic = ? AND id = ?', slug, id);
        return json({ ok: true });
      }
      if (path === '/adm/run') {
        const t = this.topic(slug);
        if (!t) throw new Error('unknown topic');
        if (t.running && Date.now() - t.running < STALE_RUN_MS) throw new Error('a run is already in progress');
        // `replace`: write over that issue (a re-run after a change in the settings, or after a bad result) instead of adding a new one.
        const replaceId = typeof b.replace === 'string' && this.issue(slug, b.replace) ? b.replace : undefined;
        this.saveTopic({ ...t, pending: true, replaceId });
        await this.arm();
        return json({ ok: true });
      }
      if (path === '/adm/issue-status' || path === '/adm/issue-save' || path === '/adm/issue-delete') {
        const id = str(b.id, 20), i = this.issue(slug, id);
        if (!i) throw new Error('unknown issue');
        if (path === '/adm/issue-delete') {
          if (i.audio?.key) await this.env.AUDIO.delete(i.audio.key);
          if (i.image?.key) await this.env.AUDIO.delete(i.image.key);
          this.ctx.storage.sql.exec('DELETE FROM issues WHERE topic = ? AND id = ?', slug, id); this.ctx.storage.sql.exec('DELETE FROM audio_jobs WHERE topic = ? AND id = ?', slug, id); this.ctx.storage.sql.exec('DELETE FROM image_jobs WHERE topic = ? AND id = ?', slug, id);
          return json({ ok: true });
        }
        if (path === '/adm/issue-save') {
          const markdown = String(b.markdown ?? '').trim().slice(0, 30_000);
          if (!markdown) throw new Error('the text cannot be empty');
          const next: Issue = { ...i, markdown, tldr: tldrOf(markdown), ...(i.audio?.status === 'ready' ? { audio: { ...i.audio, stale: true } } : {}), ...(i.image?.status === 'ready' ? { image: { ...i.image, stale: true } } : {}) };
          this.saveIssue(next);
          return json(next);
        }
        const status = b.status;
        if (status !== 'draft' && status !== 'published' && status !== 'hidden') throw new Error('bad status');
        const next: Issue = { ...i, status, publishedAt: status === 'published' ? (i.publishedAt || Date.now()) : i.publishedAt };
        this.saveIssue(next);
        return json(next);
      }
      return json({ error: 'unknown route' }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
}
