// Monitor: what is watched, the Live feed and Signal's counts. The fetching itself is done by the collection layer (collect.ts): this object tells it what
// is watched, and it delivers new items and each watch's status to /mon/collected. The browser polls /mon/state and /mon/feed (no long-lived streams to pay for).
import { constellationLines, project2d, type Star } from '../signal/constellation';
import { DurableObject } from 'cloudflare:workers';
import { json } from '../lib/twitterapi';
import { recordCost } from '../lib/costs';
import { HN_TAGS, type HnTag } from '../sources/hn';
import type { Paper } from '../sources/arxiv';
import { arxivCount, arxivPage, arxivPapers, arxivSearchQuery, arxivThroughCollect, isArxivApi, queryOfArxivUrl, useArxivGate } from '../sources/arxiv';
import { arxivIdsIn, attentionOf, coinedName, trustedNames, type PaperSignals } from '../signal/attention';
import { BASELINE_WEEKS, DEFAULT_PULSE_TOPICS, PULSE_BASE, PULSE_BASE_ID, fieldSurge, pulseOf, pulseWindows, pulseWork, windowStart, type PulseTopic } from '../signal/pulse';
import { NAME_SYSTEM, clusterPapers, nameFromTerms, nameUser, parseNames } from '../signal/paperClusters';
import { expandShorthand } from '../sources/presets';
import { checkFeedUrl } from '../sources/rss';
import { isYoutubeFeed, resolveYoutubeFeed } from '../sources/youtube';
import { isSource, type SourceKind } from '../sources/types';
import { extractTerms } from '../signal/terms';
import { distinctive, findEvergreen, notSteady, rising, scoreTerms, type Counts, type GroupInfo, type ScoredTerm } from '../signal/score';
import { boostByEngagement, indexItems, mergeTopics, nestTopics, partsAfterParents, REACTION_CAP, relatedTerms, topicEngagement, topicItems, type TopicItem } from '../signal/topics';
import { QUIET_MS, findWaves, foldTerm, publicFirst, rankWaves, watchStartMs, scoreFirsts, type FirstItem } from '../signal/first';
import { cleanTitle, isBait } from '../signal/clean';
import { cleanLayout, coCounts, layoutKeys, layoutLandscape, replayFrames, type Layout, type ReplayFrame } from '../signal/landscape';
import { DEPTH_DAYS, DEPTH_TOPICS, DEPTH_WINDOW, depthLayout, reachSeries, type DepthLayout } from '../signal/depth';
import { LADDER_DAYS, LADDER_POOL, LADDER_WINDOW, dayScores, ladderOf, type Ladder } from '../signal/ladder';
import { firstByKind, pickWatch, timelineDots, type TopicWatch } from '../signal/topicview';
import { ITEM_ID, buildCard, inTimeOrder, itemId, type CardTopic, type SourceCard } from '../signal/sourcecard';
import { brushItems, brushParams, DEFAULT_SORT, parseBrush, recentDays, TALK_CAP, TALK_CAP_NARROW, type BrushAsk } from '../signal/brush';
import { CONV_ID, PRISM_KEEP_DAYS, buildPrism, parsePrismNames, prismSystem, prismUser, ruleName, unnamed, type Prism, type PrismItem, type PrismOut, type PrismTypical, type PrismView } from '../signal/prism';
import { numbersLine, oneLine, type TopicBrief } from '../signal/trail';
import { evidenceSegments, fallbackSummary, topicSlug, topicState, usualLevel, type EvItem, type EvKind, type TopicData, type TopicPaper } from '../signal/topicpage';
import { areaHint, areaOf, parseArea, rankByArea, type Area } from '../signal/area';
import { LENS_AREAS, LENS_PALETTE, MAX_LENSES, SUGGEST_TOPICS, cleanLens, lensMatch, lensesOfTopic, paperLensMask, parseSuggestions, seedLenses, suggestSystem, suggestUser, type Lens, type LensArea } from '../signal/lens';
import { cleanQuery, itemQuality, likeOf, paperQuality, queryWords, rankItems, rankPapers, rankTopics, snippetAround, topicFor, topicQuality, windowOfSearch, type SearchItem, type SearchPaper, type SearchTopic } from '../site/search';
import { SUMMARY_ITEMS, parseSummary, pickSummaryItems, summaryFresh, summarySystem, summaryUser } from '../signal/summary';
import { setYoutubeKey } from '../sources/youtube';
import { AI_BATCH, VAGUE, estimatePer1000, parseTopics, topicSystem, topicUser } from '../signal/ai';
import { DEFAULT_FILTER, cleanFilter, makeBlocker, type FilterWord } from '../signal/filter';
import { GENERIC } from '../signal/terms';
import { STOP } from '../history/stats';
import { complete, defaultTiers, modelOptions } from '../llm/analysis';
import { embed } from '../lib/embed';
import { COPY_DAYS, EMBED_BATCH, EMBED_MODEL, EMBED_PER_M, embedText, findCopies, fromBlob, nameSuggestions, nearestNames, toBlob } from '../signal/vectors';
import { useGateway } from '../llm/gateway.ts';

const SEEN_KEEP = 1000;
const FEED_KEEP = 500;
const MAX_WATCHES = 50;
// Research map: how far it reads back and how often it is rebuilt. The embedding model (src/signal/vectors.ts) costs about $0.02 per million tokens, so a few cents for a first read of 4,000 papers.
const MAP_DAYS = 30, MAP_EVERY_MS = 24 * 3_600_000, MAP_PAGE = 500;
// Names shown to the topic model: the most used, and those closest in meaning to the batch's posts (out of a pool of the most used); new names embedded per batch at most.
const HINT_TOP = 25, HINT_MAX = 60, NAME_POOL = 400, NAME_EMBED_MAX = 200, SUGGEST_KEEP = 40, COPY_EXAMPLES = 20;
const RESEARCH_EVERY_MS = 6 * 3_600_000, RESEARCH_FIRST_DAYS = 14, RESEARCH_KEEP_DAYS = 60, RESEARCH_TOP_DAYS = 30, RESEARCH_PAGE = 25, HF_DAYS = 5, HF_FIRST_DAYS = 35;
const MIN_INTERVAL = 15, MAX_INTERVAL = 86_400;
const SIGNAL_KEEP_DAYS = 30;   // Signal keeps daily term counts this long: two windows of at most SIGNAL_MAX_DAYS, with room to spare
/** The days of the heat calendars (a topic page, the landing page): all the daily counts that are kept. */
const HEAT_DAYS = SIGNAL_KEEP_DAYS;
const SIGNAL_MAX_DAYS = 14;
const FIRST_MAX_ITEMS = 8000;   // the newest items Who Said It First reads; anything older is not judged
const BRIEF_WEIGHT = 2;    // the starting weight of a group that only holds briefing posts
const BRIEF_KEEP = 3000;   // posts from briefings kept for Signal's headlines, apart from the live feed so they never push its items out
const AI_QUEUE_MAX = 3000, AI_BACKLOG_DAYS = 14, AI_RETRY_MS = 10 * 60_000;
interface SignalAi { enabled: boolean; model: string; dailyCap: number }
/** Requests that change what is watched or who uses it: the collection layer's plan follows from these. */
const COLLECT_SYNC = new Set(['add', 'update', 'delete', 'settings', 'signal-regroup', 'signal-delete-group', 'view-save', 'view-delete', 'signal-board-save', 'signal-board-delete']);
const SOURCE_NAME: Record<SourceKind, string> = { x: 'X', rss: 'RSS and blogs', hn: 'Hacker News', youtube: 'YouTube', arxiv: 'arXiv' };

interface Watch {
  id: string; label: string; query: string; originalsOnly: boolean; includeRetweets: boolean;
  intervalSec: number; enabled: boolean; created: number; lastCheckedTs: number; nextRun: number;
  checks: number; found: number; cost: number; lastRun: number; lastError: string; errors: number;
  /** Absent on watches made before there were other sources: those are X. For `rss`, `query` is the feed address. */
  source?: SourceKind;
  hnTag?: HnTag; minPoints?: number;           // Hacker News
  etag?: string; lastModified?: string;        // RSS: conditional requests, so an unchanged feed costs nothing
  autoLabel?: boolean;                         // the label is a placeholder until the first fetch names the feed
  list?: string;                               // the list this watch was made from: a feed list id, "a:<id>" (account list) or "x:<id>" (X List)
  group?: string;                              // Signal: a name you gave, so watches with the same name vote together
  noSignal?: boolean;                          // Signal: keep watching, but leave this watch out of Signal
  briefing?: string;                           // fed by the briefing with this slug (never polled): its posts were already paid for there
}
const sourceOf = (w: Watch): SourceKind => w.source ?? 'x';
// What one check found, whatever the source: the id (for de-duplication), its time and the JSON the feed stores.
interface Found { id: string; ts: number; json: unknown }
interface Spend { day: string; cost: number }

const today = () => new Date().toISOString().slice(0, 10); // UTC day
/** A top-level Signal: a named set of groups, with its own page when published (/signal/<slug>). */
interface Board { id: string; slug: string; title: string; description: string; groups: string[]; public: boolean; /** Addresses it had before: they redirect to the current one. */ oldSlugs?: string[]; /** The public page may show the items behind each topic, with their sources. */ proof?: boolean; /** The area this Signal belongs to; none stored means AI. */ area?: Area }
/** A topic as Signal lists it (see `describeTopics`): the lead term with its names, what goes with it and the items it comes from. */
interface Described extends ScoredTerm { label: string; members: string[]; related: string[]; reactions: number; parent?: string }
/** A published Signal over its last 7 days, as the topic pages and summaries read it. */
interface BoardView {
  board: Board; shown: GroupInfo[]; bySlug: Map<string, ScoredTerm>;
  c: { terms: ScoredTerm[]; of: Map<string, string>; groups: GroupInfo[]; from: string; to: string; days: number; baselineOk: boolean; items: Record<string, number> };
  top?: { top: Described[]; describe: (t: ScoredTerm) => Described };
}
const SUMMARY_TOPICS = 24, SUMMARY_PER_BOARD = 12, SUMMARY_KEEP_DAYS = 3, SUMMARY_RETRY_MS = 10 * 60_000;
/**
 * A feed page: a public page that shows items from what is watched, defined in the admin. `source` is a list ("f:<id>" feed list, "a:<id>" account list,
 * "x:<id>" X List), a kind of source ("src:youtube"), or "all". It shows the newest, or the most reacted in the last `days`, at most `count`, and with
 * `perSource` only the newest of each source (the latest video of each channel). `layout`: "player" (the first video playing, the rest below), "cards", "list".
 */
interface FeedView {
  id: string; slug: string; title: string; description: string; source: string; kind: '' | SourceKind; show: 'latest' | 'top'; count: number; days: number;
  perSource: boolean; layout: 'player' | 'cards' | 'list'; public: boolean; listed: boolean;
}
const VIEW_LAYOUTS = ['player', 'cards', 'list'] as const;
const BOARD_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/, BOARD_RESERVED = new Set(['admin', 'custom', 'method']);
const slugify = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
/** How much people reacted to an item: likes (HN points, stars and upvotes arrive as likes), plus replies, retweets and quotes counted double. */
const reactionsOf = (j: unknown): number => { const x = j as { likeCount?: number; replyCount?: number; retweetCount?: number; quoteCount?: number }; return Math.max(0, Math.round((Number(x.likeCount) || 0) + 2 * ((Number(x.replyCount) || 0) + (Number(x.retweetCount) || 0) + (Number(x.quoteCount) || 0)))); };
/** Likes (HN: points), replies (HN: comments) and views of an item, each -1 when the source did not give it. */
const itemNumbers = (j: unknown): [number, number, number] => {
  const x = j as { likeCount?: unknown; replyCount?: unknown; viewCount?: unknown }, num = (v: unknown) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? -1 : Math.max(0, Math.round(Number(v))));
  return [num(x.likeCount), num(x.replyCount), num(x.viewCount)];
};
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Merged and renamed topics from the browser: lowercase names of at most 80 characters, chains followed to their end, no name pointing at itself. */
function cleanAliases(raw: unknown): Record<string, string> {
  const name = (v: unknown) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  const map: Record<string, string> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) { const a = name(k), b = name(v); if (a && b && a !== b) map[a] = b; }
  for (const k of Object.keys(map)) { let t = map[k]; for (let i = 0; i < 10 && map[t] && map[t] !== k; i++) t = map[t]; if (t === k) delete map[k]; else map[k] = t; }
  return map;
}
const cleanGroup = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

export class MonitorDO extends DurableObject<Env> {
  /** RPC: the size of this object's database, for the storage line in Costs. */
  storageBytes(): number { return this.ctx.storage.sql.databaseSize; }
  private pubCache = new Map<string, { at: number; v: unknown }>();   // public Signal answers, cleared by any change

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    setYoutubeKey(env.YOUTUBE_API_KEY);   // a channel whose feed fails is read through the API
    useArxivGate(arxivThroughCollect(env));   // every request to arXiv goes through one place: its limit is for all of this app together
    useGateway(env);                      // OpenRouter and Workers AI calls through AI Gateway, when AI_GATEWAY is set
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS watches (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    // Research topic pages: new papers (title, abstract, authors and categories only: their full text is never fetched), which topics they are in, and the attention they get.
    sql.exec('CREATE TABLE IF NOT EXISTS research_papers (id TEXT PRIMARY KEY, published INTEGER NOT NULL, title TEXT NOT NULL, authors TEXT NOT NULL, cats TEXT NOT NULL, abstract TEXT NOT NULL, signals TEXT NOT NULL DEFAULT \'{}\', score REAL NOT NULL DEFAULT 0, top INTEGER NOT NULL DEFAULT 0)');
    sql.exec('CREATE TABLE IF NOT EXISTS research_topic_papers (topic TEXT NOT NULL, paper TEXT NOT NULL, published INTEGER NOT NULL, PRIMARY KEY (topic, paper)) WITHOUT ROWID');
    sql.exec('CREATE INDEX IF NOT EXISTS research_topic_new ON research_topic_papers (topic, published)');
    sql.exec('CREATE TABLE IF NOT EXISTS research_vectors (paper TEXT PRIMARY KEY, v BLOB NOT NULL) WITHOUT ROWID');   // the meaning of each paper's title and abstract, for the Research map
    sql.exec('CREATE TABLE IF NOT EXISTS research_map (id INTEGER PRIMARY KEY CHECK (id = 1), built INTEGER NOT NULL, json TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS pulse (topic TEXT NOT NULL, end TEXT NOT NULL, n INTEGER NOT NULL, checked TEXT NOT NULL, PRIMARY KEY (topic, end)) WITHOUT ROWID');   // Research pulse: papers per 7-day window
    sql.exec('CREATE TABLE IF NOT EXISTS seen (watch TEXT NOT NULL, tweet TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (watch, tweet))');
    sql.exec('CREATE TABLE IF NOT EXISTS feed (seq INTEGER PRIMARY KEY AUTOINCREMENT, watch TEXT NOT NULL, label TEXT NOT NULL, seen_at INTEGER NOT NULL, json TEXT NOT NULL)');
    try { sql.exec("ALTER TABLE feed ADD COLUMN source TEXT NOT NULL DEFAULT 'x'"); } catch { /* the column is already there */ }
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    // Signal: how many items per day (per watch) mention each term. Groups and weights are applied when reading, so they can change freely.
    sql.exec('CREATE TABLE IF NOT EXISTS terms (day TEXT NOT NULL, watch TEXT NOT NULL, term TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch, term)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS day_items (day TEXT NOT NULL, watch TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch)) WITHOUT ROWID');
    // Signal topics written by a model: items waiting to be read, what each one was given, and the same counts as above for those topics.
    sql.exec('CREATE TABLE IF NOT EXISTS ai_queue (seq INTEGER PRIMARY KEY AUTOINCREMENT, watch TEXT NOT NULL, item TEXT NOT NULL, day TEXT NOT NULL, text TEXT NOT NULL, UNIQUE (watch, item))');
    sql.exec('CREATE TABLE IF NOT EXISTS ai_item (watch TEXT NOT NULL, item TEXT NOT NULL, day TEXT NOT NULL, topics TEXT NOT NULL, PRIMARY KEY (watch, item)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS ai_terms (day TEXT NOT NULL, watch TEXT NOT NULL, term TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch, term)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS ai_items (day TEXT NOT NULL, watch TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, watch)) WITHOUT ROWID');
    // Proof for Signal: the items themselves (title, link, source, date) for 30 days, so any topic can be traced back to what was published.
    sql.exec('CREATE TABLE IF NOT EXISTS item_log (watch TEXT NOT NULL, item TEXT NOT NULL, day TEXT NOT NULL, ts INTEGER NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, disc TEXT NOT NULL, by TEXT NOT NULL, match TEXT NOT NULL, PRIMARY KEY (watch, item)) WITHOUT ROWID');
    sql.exec('CREATE INDEX IF NOT EXISTS item_log_day ON item_log (day)');
    try { sql.exec('ALTER TABLE item_log ADD COLUMN eng INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }   // reactions (likes, replies, shares) when the item was logged
    for (const col of ['likes', 'replies', 'views']) { try { sql.exec(`ALTER TABLE item_log ADD COLUMN ${col} INTEGER NOT NULL DEFAULT -1`); } catch { /* already there */ } }   // the numbers behind `eng`, one by one (-1: not recorded), for the topic page's evidence strip
    // Topic summaries (section 8 of INTENT.md): one paragraph per topic per day, written by the Signal topic model from the topic's items, with the items it says it used.
    sql.exec('CREATE TABLE IF NOT EXISTS topic_summary (slug TEXT NOT NULL, day TEXT NOT NULL, term TEXT NOT NULL, text TEXT NOT NULL, items TEXT NOT NULL, n INTEGER NOT NULL, model TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (slug, day)) WITHOUT ROWID');
    // Prism (src/signal/prism.ts): the conversations inside a topic, one row per topic per day; json is a Prism with `counted` (how many items were grouped), or { none: true, counted } for a topic that was looked at and is one conversation.
    sql.exec('CREATE TABLE IF NOT EXISTS topic_prism (board TEXT NOT NULL, slug TEXT NOT NULL, day TEXT NOT NULL, json TEXT NOT NULL, model TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (board, slug, day)) WITHOUT ROWID');
    // Meaning (src/signal/vectors.ts): a vector per item Signal read, and whether it repeats an earlier one (`copy`: "watch\nitem" of the post it repeats, '' when it is its own).
    // A copy is read as "no topics" and not counted, so a post copied by many accounts counts once. Kept as long as the item log.
    sql.exec("CREATE TABLE IF NOT EXISTS item_vec (watch TEXT NOT NULL, item TEXT NOT NULL, day TEXT NOT NULL, v BLOB NOT NULL, copy TEXT NOT NULL DEFAULT '', PRIMARY KEY (watch, item)) WITHOUT ROWID");
    sql.exec('CREATE INDEX IF NOT EXISTS item_vec_day ON item_vec (day)');
    sql.exec('CREATE INDEX IF NOT EXISTS item_vec_copy ON item_vec (copy)');   // the source card counts the copies folded into a post
    // A vector per topic name in use, for the names shown to the topic model and the names suggested to the admin as one. `at`: when it was last wanted.
    sql.exec('CREATE TABLE IF NOT EXISTS name_vec (term TEXT PRIMARY KEY, v BLOB NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID');
    // The landscape of the landing page: one layout per Signal, window and day, so tomorrow's starts from today's and the picture stays steady.
    sql.exec('CREATE TABLE IF NOT EXISTS landscape (board TEXT NOT NULL, win INTEGER NOT NULL, day TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (board, win, day)) WITHOUT ROWID');
    this.backfillSignal();
    this.backfillItemLog();
    this.backfillItemNumbers();
  }

  // ---- storage helpers
  private watches(): Watch[] {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM watches').toArray().map((r) => JSON.parse(r.data) as Watch);
  }
  private watch(id: string): Watch | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM watches WHERE id = ?', id).toArray()[0];
    return row ? (JSON.parse(row.data) as Watch) : undefined;
  }
  private saveWatch(w: Watch): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO watches (id, data) VALUES (?, ?)', w.id, JSON.stringify(w));
  }
  private getMeta<T>(k: string, fallback: T): T {
    const row = this.ctx.storage.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0];
    return row ? (JSON.parse(row.v) as T) : fallback;
  }
  private setMeta(k: string, v: unknown): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, JSON.stringify(v));
  }
  private spend(): Spend {
    const s = this.getMeta<Spend>('spend', { day: today(), cost: 0 });
    return s.day === today() ? s : { day: today(), cost: 0 };
  }
  private cap(): number { return this.getMeta<{ dailyCap: number }>('settings', { dailyCap: 2 }).dailyCap; }

  private view(w: Watch) {
    const base = sourceOf(w) === 'x' ? [w.query, w.originalsOnly && '-filter:replies', w.includeRetweets && 'include:nativeretweets'].filter(Boolean).join(' ') : w.query;
    return { ...w, source: sourceOf(w), running: false, fullQuery: base };
  }
  private snapshot() {
    const spend = this.spend(), dailyCap = this.cap();
    return { watches: this.watches().map((w) => this.view(w)), settings: { dailyCap }, spend, capped: spend.cost >= dailyCap, youtubeApi: !!this.env.YOUTUBE_API_KEY };
  }

  // ---- scheduling: this object only wakes for Signal's model and its daily tidying, or until the collection layer has taken over its watches
  private collectReady(): boolean { return this.getMeta('collectReady', false); }
  private async reschedule(): Promise<void> {
    const wake = this.aiWake(), now = Date.now(), tidy = Date.parse(today() + 'T00:00:00Z') + 86_400_000 + 60_000;
    let next = wake ? Math.min(wake, tidy) : tidy;
    const sums = this.summaryWake(); if (sums) next = Math.min(next, sums);
    const prism = this.prismWake(); if (prism) next = Math.min(next, prism);
    const pulse = this.pulseWake(); if (pulse) next = Math.min(next, pulse);
    next = Math.min(next, this.researchWake());
    const map = this.mapWake(); if (map) next = Math.min(next, map);
    if (!this.collectReady()) next = Math.min(next, now + 60_000);
    await this.ctx.storage.setAlarm(Math.max(next, now + 1000));
  }

  async alarm(): Promise<void> {
    if (!this.collectReady()) await this.syncCollect();
    try { await this.summaryStep(Date.now() + 20_000); } catch (err) { console.error('topic summaries failed', err instanceof Error ? err.message : String(err)); }   // before the naming work: a day's summaries cost cents, and the cap is shared
    try { await this.prismStep(Date.now() + 15_000); } catch (err) { console.error('topic conversations failed', err instanceof Error ? err.message : String(err)); }   // after the summaries: the cap is shared, and a day's summaries matter more than a day's names
    try { await this.processAi(Date.now() + 20_000); } catch (err) { console.error('signal topics failed', err instanceof Error ? err.message : String(err)); }
    this.pruneSignal();
    const researchUntil = Date.now() + 25_000;
    try { await this.pulseStep(researchUntil); await this.researchStep(researchUntil); } catch (err) { console.error('research pulse failed', err instanceof Error ? err.message : String(err)); }
    if (this.getMeta<string>('storageDay', '') !== today()) {   // this wakes at least once a day, so the storage line in Costs has no gaps on quiet days
      this.setMeta('storageDay', today());
      try { await this.env.COST.getByName('main').measureStorage(); } catch (err) { console.error('storage measure failed', err instanceof Error ? err.message : String(err)); }
    }
    try { await this.backfillStep(researchUntil); await this.mapStep(researchUntil); } catch (err) { console.error('research map failed', err instanceof Error ? err.message : String(err)); this.setMeta('mapError', err instanceof Error ? err.message : String(err)); this.setMeta('mapRetry', Date.now() + 3_600_000); }
    await this.reschedule();
  }

  // ---- Research pulse (src/signal/pulse.ts): counts of papers per topic, read a few at a time at the pace arXiv asks for
  private pulseTopics(): PulseTopic[] { return this.getMeta<PulseTopic[]>('pulseTopics', DEFAULT_PULSE_TOPICS); }
  private pulseStored(): Map<string, string> {
    return new Map(this.ctx.storage.sql.exec<{ topic: string; end: string; checked: string }>('SELECT topic, end, checked FROM pulse').toArray().map((r) => [`${r.topic}\n${r.end}`, r.checked] as const));
  }
  private pulseTodo() { return pulseWork([PULSE_BASE_ID, ...this.pulseTopics().map((t) => t.id)], pulseWindows(Date.now()), this.pulseStored(), Date.now()); }
  private pulseWake(): number | null {
    if (!this.pulseTodo().length) return null;
    return Math.max(this.getMeta<number>('pulseRetry', 0), Date.now() + 1000);
  }
  private async pulseStep(deadline: number): Promise<void> {
    if (Date.now() < this.getMeta<number>('pulseRetry', 0)) return;
    const queries = new Map([[PULSE_BASE_ID, PULSE_BASE], ...this.pulseTopics().map((t) => [t.id, t.query] as const)]), sql = this.ctx.storage.sql;
    for (const job of this.pulseTodo()) {
      if (Date.now() > deadline) return;
      try {
        const n = await arxivCount(queries.get(job.topic)!, windowStart(job.end), job.end), today_ = today();
        sql.exec('INSERT INTO pulse (topic, end, n, checked) VALUES (?, ?, ?, ?) ON CONFLICT (topic, end) DO UPDATE SET n = excluded.n, checked = excluded.checked', job.topic, job.end, n, today_);
        this.setMeta('pulseError', ''); this.setMeta('pulseRun', Date.now()); this.pubCache.delete('pulse');
      } catch (err) {
        this.setMeta('pulseError', err instanceof Error ? err.message : String(err));
        this.setMeta('pulseRetry', Date.now() + 3_600_000);   // arXiv is down or busy: leave it alone for an hour
        return;
      }
    }
    sql.exec('DELETE FROM pulse WHERE end < ?', pulseWindows(Date.now(), 40).at(-1)!);
  }
  // ---- Research topic pages: the papers themselves, read every few hours, and who is paying attention to them
  private researchNext(): Record<string, number> { return this.getMeta<Record<string, number>>('researchNext', {}); }
  private researchWake(): number {
    const due = [...this.pulseTopics().map((t) => this.researchNext()[t.id] ?? 0), this.getMeta<number>('attentionNext', 0)];
    return Math.max(Math.min(...due), this.getMeta<number>('pulseRetry', 0), Date.now() + 1000);
  }
  private async researchStep(deadline: number): Promise<void> {
    if (Date.now() < this.getMeta<number>('pulseRetry', 0)) return;
    const sql = this.ctx.storage.sql, nowDay = today(), back = (d: number) => dayOf(Date.now() - d * 86_400_000);
    for (const t of this.pulseTopics()) {
      const next = this.researchNext();
      if ((next[t.id] ?? 0) > Date.now()) continue;
      if (Date.now() > deadline) return;
      const first = next[t.id] === undefined;
      try {
        // A paper can be listed days after its submission date, so each read looks a few days back. Its first read fills the page.
        const papers = await arxivPapers(t.query, back(first ? RESEARCH_FIRST_DAYS : 4), nowDay, first ? 1000 : 300);
        this.storePapers(t.id, papers);
        this.setMeta('researchNext', { ...this.researchNext(), [t.id]: Date.now() + RESEARCH_EVERY_MS });
        this.pubCache.clear();
      } catch (err) {
        this.setMeta('pulseError', err instanceof Error ? err.message : String(err));
        this.setMeta('pulseRetry', Date.now() + 3_600_000);
        return;
      }
    }
    if (this.getMeta<number>('attentionNext', 0) <= Date.now() && Date.now() < deadline) {
      this.setMeta('attentionNext', Date.now() + RESEARCH_EVERY_MS);
      await this.readAttention();
    }
    const old = Date.now() - RESEARCH_KEEP_DAYS * 86_400_000;
    sql.exec('DELETE FROM research_topic_papers WHERE published < ?', old); sql.exec('DELETE FROM research_papers WHERE published < ?', old);
    sql.exec('DELETE FROM research_vectors WHERE paper NOT IN (SELECT id FROM research_papers)');
  }
  private storePapers(topic: string, papers: Paper[]): void {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      for (const p of papers) {
        const at = Date.parse(p.published) || Date.now();
        sql.exec('INSERT INTO research_papers (id, published, title, authors, cats, abstract) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, authors = excluded.authors, cats = excluded.cats, abstract = excluded.abstract', p.id, at, p.title.slice(0, 400), JSON.stringify(p.authors.slice(0, 40)), JSON.stringify(p.categories.slice(0, 8)), p.abstract.slice(0, 4000));
        sql.exec('INSERT OR IGNORE INTO research_topic_papers (topic, paper, published) VALUES (?, ?, ?)', topic, p.id, at);
      }
    });
  }
  // ---- Research map (src/signal/paperClusters.ts): all papers of the last 30 days, grouped by meaning. Read once in pages, embedded a batch at a time, rebuilt once a day.
  private mapBackfill(): Record<string, { start: number; total: number; empties?: number; done?: boolean }> { return this.getMeta('mapBackfill', {}); }
  private backfillTodo(): PulseTopic[] { const b = this.mapBackfill(); return this.pulseTopics().filter((t) => !b[t.id]?.done); }
  private mapMissing(): number {
    return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM research_papers p WHERE p.published >= ? AND NOT EXISTS (SELECT 1 FROM research_vectors v WHERE v.paper = p.id)', Date.now() - MAP_DAYS * 86_400_000).one().n;
  }
  private mapWake(): number | null {
    const soon = Math.max(this.getMeta<number>('mapRetry', 0), this.getMeta<number>('pulseRetry', 0), Date.now() + 1000);
    if (this.backfillTodo().length) return soon;
    if (this.mapMissing()) return Math.max(this.getMeta<number>('mapRetry', 0), Date.now() + 1000);
    return Math.max(this.getMeta<number>('mapNext', 0), this.getMeta<number>('mapRetry', 0), Date.now() + 1000);
  }
  /** A topic's first read stops at 1,000 papers, and the busiest topics have about 2,000 a month, so the whole month is read here in pages, at arXiv's pace, over as many wake-ups as it takes. */
  private async backfillStep(deadline: number): Promise<void> {
    if (Date.now() < this.getMeta<number>('pulseRetry', 0)) return;
    const from = dayOf(Date.now() - (MAP_DAYS + 1) * 86_400_000), to = today();
    for (const t of this.backfillTodo()) {
      let st = this.mapBackfill()[t.id] ?? { start: 0, total: 0 };
      while (!st.done) {
        if (Date.now() > deadline) return;
        try {
          const { papers, total } = await arxivPage(t.query, from, to, st.start, MAP_PAGE);
          this.storePapers(t.id, papers);
          const empties = papers.length ? 0 : (st.empties ?? 0) + 1, start = st.start + papers.length;
          // arXiv now and then answers a page with nothing in it although more follow: ask again, a few times.
          st = { start, total, empties, done: start >= total || empties >= 4 };
          this.setMeta('mapBackfill', { ...this.mapBackfill(), [t.id]: st });
          this.setMeta('pulseError', '');
        } catch (err) {
          this.setMeta('pulseError', err instanceof Error ? err.message : String(err));
          this.setMeta('pulseRetry', Date.now() + 3_600_000);
          return;
        }
      }
    }
  }
  private async mapStep(deadline: number): Promise<void> {
    if (Date.now() < this.getMeta<number>('mapRetry', 0)) return;
    const sql = this.ctx.storage.sql, cutoff = Date.now() - MAP_DAYS * 86_400_000;
    while (Date.now() < deadline) {
      const rows = sql.exec<{ id: string; title: string; abstract: string }>('SELECT p.id, p.title, p.abstract FROM research_papers p WHERE p.published >= ? AND NOT EXISTS (SELECT 1 FROM research_vectors v WHERE v.paper = p.id) ORDER BY p.published DESC LIMIT ?', cutoff, EMBED_BATCH).toArray();
      if (!rows.length) break;
      const text = rows.map((r) => `${r.title}. ${r.abstract}`.slice(0, 1500));
      const out = await this.env.AI.run(EMBED_MODEL as never, { text } as never) as { data?: number[][] };
      if (out.data?.length !== rows.length) throw new Error('the embedding model gave no answer');
      this.ctx.storage.transactionSync(() => { rows.forEach((r, i) => sql.exec('INSERT OR REPLACE INTO research_vectors (paper, v) VALUES (?, ?)', r.id, Float32Array.from(out.data![i]).buffer)); });
      const tokens = Math.ceil(text.reduce((n, x) => n + x.length, 0) / 4);
      await recordCost(this.env, { kind: 'embedding', ref: 'research-map', label: 'Research map', llm: (tokens / 1_000_000) * EMBED_PER_M, tokensIn: tokens, tokensOut: 0, calls: 1, model: EMBED_MODEL });
      this.setMeta('mapError', '');
    }
    if (this.backfillTodo().length || this.mapMissing() || this.getMeta<number>('mapNext', 0) > Date.now() || Date.now() > deadline) return;
    await this.buildMap(cutoff);
  }
  private async buildMap(cutoff: number): Promise<void> {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ id: string; title: string; abstract: string; v: ArrayBuffer }>('SELECT p.id, p.title, p.abstract, v.v FROM research_papers p JOIN research_vectors v ON v.paper = p.id WHERE p.published >= ? AND EXISTS (SELECT 1 FROM research_topic_papers x WHERE x.paper = p.id) ORDER BY p.id', cutoff).toArray();
    this.setMeta('mapNext', Date.now() + MAP_EVERY_MS);
    if (!rows.length) return;
    const r = clusterPapers(rows.map((x) => ({ title: x.title, abstract: x.abstract, vector: new Float32Array(x.v) })));
    const names = new Map<number, { name: string; summary: string }>();
    const model = defaultTiers(this.env).strong;
    let problem = '';
    try {
      const groups = r.leaves.map((l) => ({ titles: l.central.map((i) => rows[i].title), terms: l.terms.map(([t]) => t) }));
      const c = await complete(this.env, model, [{ role: 'system', content: NAME_SYSTEM }, { role: 'user', content: nameUser(groups) }], { maxTokens: 5000,
        mock: () => JSON.stringify({ clusters: groups.map((g, i) => ({ i: i + 1, name: nameFromTerms(r.leaves[i].terms), summary: `Mock description: ${g.terms.slice(0, 4).join(', ')}.` })) }) });
      for (const [i, n] of parseNames(c.text, r.leaves.length)) names.set(i, n);
      if (!names.size) problem = 'the model did not return readable names';
      if (c.cost) await recordCost(this.env, { kind: 'signal', ref: 'research-map', label: 'Research map (names)', llm: c.cost, tokensIn: c.tokensIn, tokensOut: c.tokensOut, calls: 1, model });
    } catch (err) { problem = err instanceof Error ? err.message : String(err); }
    const assign: Record<string, number> = {};
    rows.forEach((x, i) => { assign[x.id] = r.assign[i]; });
    // The first whole day: the day the cutoff falls in has only part of its papers, and would look like a dip.
    const json_ = JSON.stringify({ from: dayOf(cutoff + 86_400_000), leaves: r.leaves.map((l, i) => ({ name: names.get(i)?.name ?? nameFromTerms(l.terms), summary: names.get(i)?.summary ?? '', terms: l.terms.slice(0, 8).map(([t]) => t) })), joins: r.joins, assign });
    sql.exec('INSERT OR REPLACE INTO research_map (id, built, json) VALUES (1, ?, ?)', Date.now(), json_);
    this.setMeta('mapNames', problem);
    this.pubCache.delete('map');
  }
  /** What the Research map page reads. Attention is read fresh, so it follows the six-hourly updates between rebuilds. */
  private mapView() {
    const sql = this.ctx.storage.sql, topics = this.pulseTopics(), row = sql.exec<{ built: number; json: string }>('SELECT built, json FROM research_map WHERE id = 1').toArray()[0];
    const back = this.mapBackfill(), progress = { read: topics.reduce((n, t) => n + (back[t.id]?.start ?? 0), 0), total: topics.reduce((n, t) => n + (back[t.id]?.total ?? 0), 0), toEmbed: this.mapMissing() };
    const shown = topics.map((t) => ({ id: t.id, slug: t.slug, title: t.title }));
    if (!row) return { state: 'building' as const, progress, topics: shown, error: this.getMeta<string>('mapError', '') || this.getMeta<string>('pulseError', '') };
    const m = JSON.parse(row.json) as { from: string; leaves: unknown[]; joins: unknown[]; assign: Record<string, number> };
    const bit = new Map(topics.map((t, i) => [t.id, 1 << i] as const)), masks = new Map<string, number>();
    for (const x of sql.exec<{ topic: string; paper: string }>('SELECT topic, paper FROM research_topic_papers')) masks.set(x.paper, (masks.get(x.paper) ?? 0) | (bit.get(x.topic) ?? 0));
    const start = Date.parse(m.from), papers: unknown[] = [];
    const lenses = this.lenses('ai').slice(0, MAX_LENSES);   // the lenses of the AI area; each paper carries the ones its title or abstract uses the words of
    for (const p of sql.exec<{ id: string; title: string; published: number; authors: string; signals: string; abstract: string }>('SELECT id, title, published, authors, signals, abstract FROM research_papers ORDER BY published DESC')) {
      const leaf = m.assign[p.id], mask = masks.get(p.id) ?? 0;
      if (leaf === undefined || !mask || p.published < start) continue;
      const a = attentionOf(JSON.parse(p.signals) as PaperSignals, JSON.parse(p.authors) as string[]);
      papers.push([p.id, p.title, Math.floor((p.published - start) / 86_400_000), mask, leaf, a.top ? 1 : 0, Math.round(a.score * 10) / 10, a.hf?.upvotes ?? 0, a.hn?.points ?? 0, a.mentions.length, paperLensMask(lenses, p.title, p.abstract)]);
    }
    return { state: 'ready' as const, built: row.built, from: m.from, days: Math.floor((row.built - start) / 86_400_000), lagDays: 2, topics: shown, leaves: m.leaves, joins: m.joins, papers, lenses: lenses.map((l) => ({ key: l.key, name: l.name })) };
  }
  /** Mentions per day of a topic's names (`names`, as counted in the terms table) for `days` (ISO, oldest first), from the watches `keep` allows. */
  private dailyCounts(names: string[], keep: (watch: string) => boolean, days: string[]): number[] {
    const counts = days.map(() => 0), at = new Map(days.map((d, i) => [d, i] as const));
    for (const r of this.ctx.storage.sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${this.tables().terms} WHERE term IN (SELECT value FROM json_each(?)) AND day >= ?`, JSON.stringify(names), days[0])) {
      const i = at.get(r.day);
      if (i !== undefined && keep(r.watch)) counts[i] += r.n;
    }
    return counts;
  }
  /**
   * What the landing page needs besides Signal: the latest written summaries (by topic address), the last 14 days of mentions for the topics asked for (`spark`: topic names),
   * the papers of the last week with how much attention each has had, the research topics that are rising, and the most reacted articles and Hacker News stories of public feed pages.
   * Numbers only from public Signals' groups and public feed pages, like the other public reads. Never starts a model call.
   */
  private async landingPublic(spark: string[], boardSlug = '') {
    const sql = this.ctx.storage.sql, now = Date.now(), lines: Record<string, string> = {};
    for (const r of sql.exec<{ slug: string; text: string }>('SELECT slug, text FROM topic_summary WHERE day >= ? ORDER BY day ASC', dayOf(now - 86_400_000))) lines[r.slug] = r.text.slice(0, 400);
    // The daily counts of a card: only the groups of the Signal it is on, so a politics card does not count AI sources.
    const pub = new Set(this.boards().filter((b) => b.public && (!boardSlug || b.slug === boardSlug)).flatMap((b) => b.groups)), { of } = await this.groups();
    const days = Array.from({ length: 14 }, (_, i) => dayOf(now - (13 - i) * 86_400_000)), series: Record<string, number[]> = {};
    const days30 = Array.from({ length: HEAT_DAYS }, (_, i) => dayOf(now - (HEAT_DAYS - 1 - i) * 86_400_000)), heat = days30.map(() => 0);
    for (const term of spark) {
      const c30 = this.dailyCounts(this.namesOf(term), (w) => { const g = of.get(w); return !!g && pub.has(g); }, days30);
      series[term] = c30.slice(-14);
      c30.forEach((v, i) => { heat[i] += v; });
    }
    const papers = sql.exec<{ id: string; title: string; published: number; signals: string; authors: string }>('SELECT id, title, published, signals, authors FROM research_papers WHERE published >= ? ORDER BY published DESC LIMIT 600', now - 7 * 86_400_000).toArray().map((r) => {
      const a = attentionOf(JSON.parse(r.signals) as PaperSignals, JSON.parse(r.authors) as string[]);
      return { id: r.id, title: r.title, published: r.published, score: Math.round(a.score * 10) / 10, talked: !!(a.hf || a.hn || a.mentions.length) };
    });
    const risingResearch = this.pulseView().topics.filter((t) => t.state === 'rising' || t.state === 'spike').map((t) => ({ slug: t.slug, title: t.title, state: t.state }));
    const reads = new Map<string, ReturnType<MonitorDO['viewItems']>[number]>();
    for (const v of this.views().filter((x) => x.public)) for (const i of this.viewItems({ ...v, count: 60, show: 'top', days: 7, perSource: false })) if (i.url && (i.kind === 'rss' || i.kind === 'hn') && !reads.has(i.url)) reads.set(i.url, i);
    return { lines, series, days, heat: { days: days30, counts: heat }, papers, risingResearch, reads: [...reads.values()].slice(0, 80) };
  }
  /**
   * A topic's items for the public MCP server (`get_topic_items`), 25 a page, by kind of source and newest or most reacted first. Only for a Signal that shows its sources (like the Talk angle);
   * for the others it says so. `offset` is the cursor. Read only.
   */
  private async topicItemsPublic(p: URLSearchParams) {
    const found = await this.findTopic((p.get('slug') ?? '').toLowerCase().slice(0, 64), areaHint(p.get('area')));
    if (!found) return { found: false as const };
    const { v, topic } = found, slug = topicSlug(topic.term), proof = v.board.proof === true;
    if (!proof) return { found: true as const, slug, label: topic.label, area: areaOf(v.board), proof, total: 0, items: [] as EvItem[] };
    const offset = Math.max(0, Math.min(5000, Number(p.get('offset')) || 0)), c = v.c, got = await this.topicItems(v, [topic.term, ...topic.members]);
    // A5: the same day, kind and order as the topic page (src/signal/brush.ts); here newest is the default, and "reacted" without a kind is ordered within each kind, one kind after the other
    const { items, meta } = got, pr = this.prismOut(v.board.slug, slug, items, meta, proof);
    const brush = parseBrush({ day: p.get('day'), kind: p.get('kind'), conv: p.get('conv'), sort: p.get('sort') }, recentDays(Date.now(), 14).filter((d) => d >= c.from), 'newest', pr ? pr.out.groups.map((g) => g.id) : []);
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
    const pool = brush.conv ? items.filter((i) => i.id && pr!.of.get(i.id) === brush.conv) : items, of = brushItems(pool, brush).items, cv = brush.conv ? pr!.out.groups.find((g) => g.id === brush.conv) : undefined;
    return { found: true as const, slug, label: topic.label, area: areaOf(v.board), proof, total: of.length, counts, day: brush.day ?? null, kind: brush.kind ?? null, conv: cv ? { id: cv.id, name: cv.name } : null, sort: brush.sort, items: of.slice(offset, offset + 25) };
  }
  /** Papers of the last 30 days for the public MCP server: filtered by words (all of them, in title or abstract), by a cluster of the Research map, or by "being discussed". Attention first, then newest. */
  private papersPublic(p: URLSearchParams) {
    const sql = this.ctx.storage.sql, now = Date.now(), limit = Math.max(1, Math.min(25, Number(p.get('limit')) || 12));
    const words = (p.get('q') ?? '').toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter((w) => w.length >= 2).slice(0, 6);
    const cluster = p.get('cluster') === null || p.get('cluster') === '' ? -1 : Number(p.get('cluster')), discussed = p.get('discussed') === '1';
    const row = sql.exec<{ built: number; json: string }>('SELECT built, json FROM research_map WHERE id = 1').toArray()[0];
    const m = row ? (JSON.parse(row.json) as { leaves: Array<{ name: string; summary: string; terms: string[] }>; assign: Record<string, number> }) : null;
    const clusters = (m?.leaves ?? []).map((l, id) => ({ id, name: l.name, summary: l.summary, terms: l.terms.slice(0, 6), papers: 0, discussed: 0 }));
    const out: Array<ReturnType<MonitorDO['paperLine']> & { score: number; cluster?: { id: number; name: string } }> = [];
    let total = 0;
    for (const r of sql.exec<{ id: string; published: number; title: string; authors: string; cats: string; abstract: string; signals: string }>('SELECT id, published, title, authors, cats, abstract, signals FROM research_papers WHERE published >= ? ORDER BY published DESC LIMIT 3000', now - 30 * 86_400_000)) {
      const authors = JSON.parse(r.authors) as string[], a = attentionOf(JSON.parse(r.signals) as PaperSignals, authors), talked = !!(a.hf || a.hn || a.mentions.length), leaf = m?.assign[r.id];
      if (leaf !== undefined && clusters[leaf]) { clusters[leaf].papers++; if (talked) clusters[leaf].discussed++; }
      if (cluster >= 0 && leaf !== cluster) continue;
      if (discussed && !talked) continue;
      if (words.length) { const text = (r.title + ' ' + r.abstract).toLowerCase(); if (!words.every((w) => text.includes(w))) continue; }
      total++;
      out.push({ ...this.paperLine(r, authors, a), ...(leaf !== undefined && clusters[leaf] ? { cluster: { id: leaf, name: clusters[leaf].name } } : {}), score: a.score });
    }
    out.sort((x, y) => y.score - x.score || y.published - x.published);
    return { built: row?.built ?? 0, total, clusters: clusters.filter((c) => c.papers > 0), papers: out.slice(0, limit).map(({ score: _s, ...x }) => x) };
  }
  /**
   * Search for the public site (/search) and the public MCP server (`search`): topics, items and papers. Only what the public pages already show:
   * topics of published Signals, items of the groups of a published Signal that shows its sources and of public feed pages (a feed page only as far back as it shows), papers of the last 30 days.
   * Every query is bounded (a day range, a row limit); the ranking is in src/site/search.ts. Read only.
   */
  private async searchPublic(q: string, window: number, lensKey: string, kinds: Set<string>, per: number, offset: number, area: Area = 'ai') {
    const words = queryWords(q), empty = { topics: { total: 0, list: [] as SearchTopic[] }, items: { total: 0, list: [] as SearchItem[] }, papers: { total: 0, list: [] as SearchPaper[] } };
    if (!words.length) return empty;
    const lens = this.lenses(area).find((l) => l.key === lensKey), all = this.lenses(area);
    const out = { ...empty };
    const named: Array<{ slug: string; label: string; names: string[] }> = [];   // for linking an item to its topic page
    if (kinds.has('topics') || kinds.has('items')) {
      const summaries = new Map<string, string>(), day = dayOf(Date.now() - 86_400_000);
      for (const r of this.ctx.storage.sql.exec<{ slug: string; day: string; text: string }>('SELECT slug, day, text FROM topic_summary WHERE day >= ? ORDER BY day ASC', day)) summaries.set(r.slug, r.text);
      const found = new Map<string, SearchTopic>();
      for (const b of this.boards().filter((x) => x.public && areaOf(x) === area)) {
        const v = await this.boardView(b);
        if (!v.shown.length) continue;
        const tops = this.boardTop(v).top, covered = new Set<string>();
        const put = (t: { term: string; label: string; members: string[]; signal: number; isNew: boolean; change: number | null }, summary?: string) => {
          const slug = topicSlug(t.term);
          if (v.bySlug.get(slug)?.term !== t.term && !tops.some((x) => x.term === t.term)) return;
          named.push({ slug, label: t.label, names: [t.label, t.term, ...t.members] });
          const m = topicQuality(words, { term: t.term, label: t.label, members: t.members, summary });
          if (!m.quality) return;
          const because = m.field === 'member' ? t.members.find((x) => topicQuality(words, { term: x, label: x, members: [], summary: '' }).quality) : m.field === 'summary' && summary ? snippetAround(summary, words, 160) : undefined;
          const row: SearchTopic = { slug, label: t.label, term: t.term, members: t.members.slice(0, 6), state: topicState(t), signal: t.signal, quality: m.quality, field: m.field, ...(because ? { because } : {}),
            lenses: lensesOfTopic(all, { term: t.term, label: t.label, members: t.members }).map((l) => l.key), ...(lens ? { inLens: lensMatch(lens, { term: t.term, label: t.label, members: t.members }) } : {}) };
          const prev = found.get(slug);
          if (!prev || row.signal > prev.signal) found.set(slug, row);
        };
        for (const t of tops) { covered.add(t.term); for (const m of t.members) covered.add(m); put({ term: t.term, label: t.label ?? t.term, members: t.members ?? [], signal: t.signal, isNew: t.isNew, change: t.change }, summaries.get(topicSlug(t.term))); }
        // The topics below the top: only those whose own name fits, so a page of thousands of names costs a scan and no more.
        for (const raw of v.c.terms) {
          if (covered.has(raw.term)) continue;
          if (!topicQuality(words, { term: raw.term, label: raw.term, members: [], summary: '' }).quality) continue;
          put({ term: raw.term, label: raw.term, members: [], signal: raw.signal, isNew: raw.isNew, change: raw.change });
        }
      }
      const ranked = rankTopics([...found.values()]);
      out.topics = { total: ranked.length, list: kinds.has('topics') ? ranked.slice(offset, offset + per) : [] };
    }
    if (kinds.has('items')) {
      const DAY = 86_400_000, now = Date.now(), from = dayOf(now - (Math.min(window, SIGNAL_MAX_DAYS) - 1) * DAY), allowed = new Map<string, number>();   // source -> the oldest time it may show an item from
      const { of } = await this.groups(), watches = this.watches().filter((w) => !w.briefing && sourceOf(w) !== 'arxiv');
      for (const b of this.boards().filter((x) => x.public && x.proof === true && areaOf(x) === area)) {
        const keys = new Set((await this.boardView(b)).shown.map((g) => g.key));
        for (const w of watches) if (keys.has(of.get(w.id) ?? '')) allowed.set(w.id, 0);
      }
      if (area === 'ai') for (const fv of this.views().filter((x) => x.public)) for (const w of this.viewWatches(fv))   /* feed pages and papers are not tagged with an area: they belong to AI */ if (sourceOf(w) !== 'arxiv' && allowed.get(w.id) !== 0) allowed.set(w.id, Math.min(allowed.get(w.id) ?? Infinity, now - fv.days * DAY));
      const kindOf = new Map(watches.map((w) => [w.id, w] as const));
      if (allowed.size) {
        const rows = this.ctx.storage.sql.exec<{ watch: string; ts: number; title: string; url: string; disc: string; by: string; match: string; likes: number; replies: number; views: number }>(
          `SELECT watch, ts, title, url, disc, by, match, likes, replies, views FROM item_log WHERE day >= ? AND watch IN (SELECT value FROM json_each(?)) AND ${words.map(() => "(lower(title) || ' ' || lower(match)) LIKE ? ESCAPE '\\'").join(' AND ')} ORDER BY ts DESC LIMIT 400`,
          from, JSON.stringify([...allowed.keys()]), ...words.map(likeOf)).toArray();
        const seen = new Set<string>(), hits: Array<SearchItem & { text: string }> = [];
        for (const r of rows) {
          const w = kindOf.get(r.watch);
          if (!w || r.ts < (allowed.get(r.watch) ?? 0) || (!r.url && !r.title)) continue;
          const key = r.url || `${r.watch}|${r.title}`;
          if (seen.has(key)) continue;
          const title = cleanTitle(r.title, 200), quality = itemQuality(words, title, r.match);
          if (!quality) continue;
          seen.add(key);
          hits.push({ kind: sourceOf(w) as SearchItem['kind'], title, url: r.url, discussionUrl: r.disc, source: w.label, by: r.by.replace(/^@$/, ''), ts: r.ts, likes: r.likes, replies: r.replies, views: r.views, quality, text: `${title} ${r.match.slice(0, 600)}` });
        }
        const ranked = rankItems(hits);
        out.items = { total: ranked.length, list: ranked.slice(offset, offset + per).map(({ text, ...i }) => { const topic = topicFor(text, named); return topic ? { ...i, topic } : i; }) };
      }
    }
    if (kinds.has('papers') && area === 'ai') {
      const sql = this.ctx.storage.sql, since = Date.now() - Math.min(window, 30) * 86_400_000;
      const rows = sql.exec<{ id: string; published: number; title: string; authors: string; cats: string; abstract: string; signals: string }>(
        `SELECT id, published, title, authors, cats, abstract, signals FROM research_papers WHERE published >= ? AND ${words.map(() => "(lower(title) || ' ' || lower(abstract)) LIKE ? ESCAPE '\\'").join(' AND ')} ORDER BY published DESC LIMIT 300`, since, ...words.map(likeOf)).toArray();
      const hits: SearchPaper[] = [];
      for (const r of rows) {
        const quality = paperQuality(words, r.title, r.abstract);
        if (!quality) continue;
        const authors = JSON.parse(r.authors) as string[], a = attentionOf(JSON.parse(r.signals) as PaperSignals, authors);
        hits.push({ id: r.id, title: r.title, published: r.published, authors: authors.slice(0, 4), categories: (JSON.parse(r.cats) as string[]).slice(0, 3), absUrl: `https://arxiv.org/abs/${r.id}`, snippet: snippetAround(r.abstract, words, 240), quality, score: a.score,
          ...(lens ? { inLens: paperLensMask([lens], r.title, r.abstract) !== 0 } : {}), attention: { accounts: a.mentions.length, hf: a.hf ? { upvotes: a.hf.upvotes, url: a.hf.url } : null, hn: a.hn ? { points: a.hn.points, comments: a.hn.comments, url: a.hn.url } : null } });
      }
      const ranked = rankPapers(hits);
      out.papers = { total: ranked.length, list: ranked.slice(offset, offset + per) };
    }
    return out;
  }
  private paperLine(r: { id: string; published: number; title: string; cats: string; abstract: string }, authors: string[], a: ReturnType<typeof attentionOf>) {
    return { id: r.id, published: r.published, title: r.title, authors: authors.slice(0, 6), categories: JSON.parse(r.cats) as string[], abstract: r.abstract.length > 420 ? r.abstract.slice(0, 419).replace(/\s+\S*$/, '') + '…' : r.abstract, absUrl: `https://arxiv.org/abs/${r.id}`,
      attention: { top: a.top, ...(a.hf ? { hf: a.hf } : {}), ...(a.hn ? { hn: a.hn } : {}), accounts: a.mentions.length, posts: a.mentions.length } as { top: boolean; hf?: { upvotes: number; url: string }; hn?: { points: number; comments: number; url: string }; accounts: number; posts: number } };
  }
  /** One paper for the public MCP server: the abstract (the full text is never read), the arXiv abstract page, every post that names it (not the authors' own), and the research topics and cluster it is in. */
  private paperPublic(id: string) {
    const sql = this.ctx.storage.sql, r = sql.exec<{ id: string; published: number; title: string; authors: string; cats: string; abstract: string; signals: string }>('SELECT id, published, title, authors, cats, abstract, signals FROM research_papers WHERE id = ?', id).toArray()[0];
    if (!r) return null;
    const authors = JSON.parse(r.authors) as string[], a = attentionOf(JSON.parse(r.signals) as PaperSignals, authors);
    const topics = new Map(this.pulseTopics().map((t) => [t.id, t] as const));
    const also = sql.exec<{ topic: string }>('SELECT topic FROM research_topic_papers WHERE paper = ?', id).toArray().map((x) => topics.get(x.topic)).filter((t): t is PulseTopic => !!t).map((t) => ({ slug: t.slug, title: t.title }));
    const row = sql.exec<{ json: string }>('SELECT json FROM research_map WHERE id = 1').toArray()[0], m = row ? (JSON.parse(row.json) as { leaves: Array<{ name: string }>; assign: Record<string, number> }) : null, leaf = m?.assign[id];
    return { id: r.id, published: r.published, title: r.title, authors: authors.slice(0, 20), categories: JSON.parse(r.cats) as string[], abstract: r.abstract, absUrl: `https://arxiv.org/abs/${r.id}`, also,
      ...(leaf !== undefined && m?.leaves[leaf] ? { cluster: { id: leaf, name: m.leaves[leaf].name } } : {}),
      attention: { top: a.top, ...(a.hf ? { hf: a.hf } : {}), ...(a.hn ? { hn: a.hn } : {}), accounts: a.mentions.length, mentions: a.mentions.slice(0, 40).map(({ by, url, reactions }) => ({ by, url, reactions })) } };
  }
  private mapPaper(id: string) {
    const r = this.ctx.storage.sql.exec<{ id: string; published: number; title: string; authors: string; cats: string; abstract: string; signals: string }>('SELECT id, published, title, authors, cats, abstract, signals FROM research_papers WHERE id = ?', id).toArray()[0];
    if (!r) return null;
    const a = attentionOf(JSON.parse(r.signals) as PaperSignals, JSON.parse(r.authors) as string[]);
    return { id: r.id, published: r.published, title: r.title, authors: (JSON.parse(r.authors) as string[]).slice(0, 12), categories: JSON.parse(r.cats) as string[], abstract: r.abstract, absUrl: `https://arxiv.org/abs/${r.id}`, pdfUrl: `https://arxiv.org/pdf/${r.id}`, hfUrl: a.hf?.url ?? '', hnUrl: a.hn?.url ?? '', mentions: a.mentions.slice(0, 5).map(({ by, url, reactions }) => ({ by, url, reactions })) };
  }
  /** Each source on its own: one that fails leaves what was known from it, and the rest still count. */
  private async readAttention(): Promise<void> {
    const sql = this.ctx.storage.sql, known = new Map(sql.exec<{ id: string; signals: string; authors: string }>('SELECT id, signals, authors FROM research_papers').toArray().map((r) => [r.id, { s: JSON.parse(r.signals) as PaperSignals, authors: JSON.parse(r.authors) as string[] }] as const));
    if (!known.size) return;
    const problems: string[] = [], json_ = async (url: string) => { const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'TweetExplorer/1.0 (research topic pages)' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<unknown>; };
    try {   // Upvotes keep rising for a few days after a paper is featured.
      for (let d = 0, days = this.getMeta<number>('attentionDays', 0) >= HF_FIRST_DAYS ? HF_DAYS : HF_FIRST_DAYS; d < days; d++) {
        const list = (await json_(`https://huggingface.co/api/daily_papers?date=${dayOf(Date.now() - d * 86_400_000)}&limit=100`)) as Array<{ paper?: { id?: string; upvotes?: number } }>;
        for (const x of Array.isArray(list) ? list : []) { const k = known.get(x.paper?.id ?? ''); if (k) k.s.hf = { upvotes: Math.max(0, Number(x.paper?.upvotes) || 0), url: `https://huggingface.co/papers/${x.paper!.id}` }; }
      }
      this.setMeta('attentionDays', HF_FIRST_DAYS);
    } catch (err) { problems.push(`Hugging Face: ${err instanceof Error ? err.message : String(err)}`); }
    try {
      const since = Math.floor(Date.now() / 1000) - RESEARCH_KEEP_DAYS * 86_400;
      for (let page = 0; page < 3; page++) {
        const r = (await json_(`https://hn.algolia.com/api/v1/search_by_date?query=arxiv.org&restrictSearchableAttributes=url&tags=story&hitsPerPage=200&page=${page}&numericFilters=created_at_i>${since}`)) as { nbPages?: number; hits?: Array<{ objectID: string; url?: string; points?: number; num_comments?: number }> };
        for (const h of r.hits ?? []) for (const id of arxivIdsIn(h.url ?? '')) { const k = known.get(id); if (k && (h.points ?? 0) >= (k.s.hn?.points ?? 0)) k.s.hn = { points: h.points ?? 0, comments: h.num_comments ?? 0, url: `https://news.ycombinator.com/item?id=${h.objectID}` }; }
        if (page + 1 >= (r.nbPages ?? 0)) break;
      }
    } catch (err) { problems.push(`Hacker News: ${err instanceof Error ? err.message : String(err)}`); }
    try {
      const res = await this.env.COLLECT.getByName('main').fetch(new Request(`https://internal/collect/paper-mentions?since=${Date.now() - RESEARCH_KEEP_DAYS * 86_400_000}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const found = new Map<string, Array<{ by: string; name: string; url: string; reactions: number }>>();
      for (const m of (await res.json()) as Array<{ paper: string; by: string; name: string; url: string; reactions: number }>) (found.get(m.paper) ?? found.set(m.paper, []).get(m.paper)!).push(m);
      // Posts that use the paper's own name. A failure here leaves the links, which are the surer signal.
      try {
        const named = new Map<string, { id: string; published: number } | null>();
        for (const p of sql.exec<{ id: string; title: string; published: number }>('SELECT id, title, published FROM research_papers')) { const n = coinedName(p.title); if (n) named.set(n, named.has(n) ? null : { id: p.id, published: p.published }); }   // two papers with one name: it says neither
        for (const [n, v] of named) if (!v) named.delete(n);
        const r = await this.env.COLLECT.getByName('main').fetch(new Request('https://internal/collect/paper-names', { method: 'POST', body: JSON.stringify({ names: [...named.keys()] }) }));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const hits = (await r.json()) as Array<{ name: string; by: string; author: string; url: string; reactions: number; ts: number }>;
        const good = trustedNames(hits, new Map([...named].map(([n, v]) => [n, v!.published] as const)));
        for (const h of hits) {
          if (!good.has(h.name)) continue;
          const paper = named.get(h.name)!.id, list = found.get(paper) ?? found.set(paper, []).get(paper)!;
          if (!list.some((m) => m.url === h.url)) list.push({ paper, by: h.by, name: h.author, url: h.url, reactions: h.reactions } as never);
        }
      } catch (err) { problems.push(`paper names: ${err instanceof Error ? err.message : String(err)}`); }
      for (const [id, k] of known) k.s.mentions = (found.get(id) ?? []).map(({ by, name, url, reactions }) => ({ by, name, url, reactions }));
    } catch (err) { problems.push(`collected posts: ${err instanceof Error ? err.message : String(err)}`); }
    this.ctx.storage.transactionSync(() => {
      for (const [id, k] of known) { const a = attentionOf(k.s, k.authors); sql.exec('UPDATE research_papers SET signals = ?, score = ?, top = ? WHERE id = ?', JSON.stringify(k.s), a.score, a.top ? 1 : 0, id); }
    });
    this.setMeta('attentionProblems', problems); this.setMeta('attentionRun', Date.now()); this.pubCache.clear();
  }
  /** One topic's page: its pulse, the few papers getting attention, and all of them, newest first. */
  private researchPage(slug: string, pageIn: number) {
    const topic = this.pulseTopics().find((t) => t.slug === slug);
    if (!topic) return null;
    const sql = this.ctx.storage.sql, topics = new Map(this.pulseTopics().map((t) => [t.id, t] as const));
    type Row = { id: string; published: number; title: string; authors: string; cats: string; abstract: string; signals: string };
    const shape = (r: Row) => {
      const authors = JSON.parse(r.authors) as string[], a = attentionOf(JSON.parse(r.signals) as PaperSignals, authors);
      const also = sql.exec<{ topic: string }>('SELECT topic FROM research_topic_papers WHERE paper = ? AND topic != ?', r.id, topic.id).toArray().map((x) => topics.get(x.topic)).filter((t): t is PulseTopic => !!t).map((t) => ({ slug: t.slug, title: t.title }));
      return { id: r.id, published: r.published, title: r.title, authors, categories: JSON.parse(r.cats) as string[], abstract: r.abstract, absUrl: `https://arxiv.org/abs/${r.id}`, pdfUrl: `https://arxiv.org/pdf/${r.id}`, also, attention: { top: a.top, hf: a.hf, hn: a.hn, mentions: a.mentions.slice(0, 5).map(({ by, url, reactions }) => ({ by, url, reactions })), accounts: a.mentions.length } };
    };
    const COLS = 'p.id, p.published, p.title, p.authors, p.cats, p.abstract, p.signals', FROM = 'research_topic_papers x JOIN research_papers p ON p.id = x.paper';
    const total = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM research_topic_papers WHERE topic = ?', topic.id).one().n, pages = Math.max(1, Math.ceil(total / RESEARCH_PAGE)), page = Math.min(pages, Math.max(1, Math.floor(pageIn) || 1));
    const attention = page === 1 ? sql.exec<Row>(`SELECT ${COLS} FROM ${FROM} WHERE x.topic = ? AND p.top = 1 AND x.published >= ? ORDER BY p.score DESC, x.published DESC LIMIT 10`, topic.id, Date.now() - RESEARCH_TOP_DAYS * 86_400_000).toArray().map(shape) : [];
    const papers = sql.exec<Row>(`SELECT ${COLS} FROM ${FROM} WHERE x.topic = ? ORDER BY x.published DESC, x.paper DESC LIMIT ? OFFSET ?`, topic.id, RESEARCH_PAGE, (page - 1) * RESEARCH_PAGE).toArray().map(shape);
    // The constellation (first page only): the topic's papers of the last 30 days that have a meaning vector, placed by it, with their attention.
    let sky: { stars: Star[]; lines: Array<[number, number]> } | null = null;
    if (page === 1) {
      const rows = sql.exec<{ id: string; title: string; signals: string; authors: string; v: ArrayBuffer }>(`SELECT p.id, p.title, p.signals, p.authors, v.v FROM ${FROM} JOIN research_vectors v ON v.paper = p.id WHERE x.topic = ? AND x.published >= ? ORDER BY x.published DESC LIMIT 240`, topic.id, Date.now() - 30 * 86_400_000).toArray();
      if (rows.length >= 8) {
        const pts = project2d(rows.map((r) => fromBlob(r.v)));
        const stars = rows.map((r, i) => { const a = attentionOf(JSON.parse(r.signals) as PaperSignals, JSON.parse(r.authors) as string[]); return { id: r.id, title: r.title, x: pts[i][0], y: pts[i][1], score: Math.round(a.score * 10) / 10, talked: !!(a.hf || a.hn || a.mentions.length) }; });
        sky = { stars, lines: constellationLines(pts) };
      }
    }
    return { sky, topic: this.pulseView().topics.find((t) => t.id === topic.id)!, others: this.pulseTopics().filter((t) => t.id !== topic.id).map((t) => ({ slug: t.slug, title: t.title })), attention, papers, total, page, pages, keepDays: RESEARCH_KEEP_DAYS, topDays: RESEARCH_TOP_DAYS, updated: this.getMeta<number>('attentionRun', 0) };
  }
  /** Every topic's state, from what has been read so far. The same for the admin and for readers: counts and the searches behind them, which are public anyway. */
  private pulseView() {
    const rows = this.ctx.storage.sql.exec<{ topic: string; end: string; n: number }>('SELECT topic, end, n FROM pulse').toArray(), by = new Map(rows.map((r) => [`${r.topic}\n${r.end}`, r.n] as const));
    const ends = pulseWindows(Date.now()).reverse(), baseOf = (end: string) => by.get(`${PULSE_BASE_ID}\n${end}`) ?? 0;
    const known = ends.filter((e) => by.has(`${PULSE_BASE_ID}\n${e}`));
    return {
      topics: this.pulseTopics().map((t) => ({ ...t, ...pulseOf(ends.filter((e) => by.has(`${t.id}\n${e}`) || e === ends.at(-1)).map((end) => ({ end, n: by.get(`${t.id}\n${end}`) ?? 0, base: by.has(`${t.id}\n${end}`) ? baseOf(end) : 0 }))) })),
      field: { ...fieldSurge(known.map(baseOf)), n: baseOf(ends.at(-1)!) }, baseQuery: PULSE_BASE, baselineWeeks: BASELINE_WEEKS, updated: this.getMeta<number>('pulseRun', 0),
    };
  }
  private cleanPulseTopic(raw: Record<string, unknown>, prev?: PulseTopic): PulseTopic {
    const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), query = String(raw.query ?? '').trim();
    if (!title) throw new Error('give the topic a name');
    const q = query.length <= 300 ? arxivSearchQuery(query) : null;
    if (!q) throw new Error('enter categories (cs.CL, cs.LG), words, or a search such as au:"Hinton" AND cat:cs.LG, in at most 300 characters');
    const others = this.pulseTopics().filter((t) => t.id !== prev?.id);
    const slug = prev?.slug ?? slugify(title);
    if (!slug || slug === 'map' || others.some((t) => t.slug === slug)) throw new Error('another topic already has that name');
    return { id: prev?.id ?? crypto.randomUUID().slice(0, 8), slug, title, blurb: String(raw.blurb ?? '').replace(/\s+/g, ' ').trim().slice(0, 160), query: q };
  }

  private isSeen(watch: string, item: string): boolean {
    return this.ctx.storage.sql.exec('SELECT 1 FROM seen WHERE watch = ? AND tweet = ?', watch, item).toArray().length > 0;
  }
  private markSeen(watch: string, item: string): void {
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO seen (watch, tweet, at) VALUES (?, ?, ?)', watch, item, Date.now());
  }

  // ---- the collection layer
  /** Tells it every watch and who uses it. The first successful call also hands over their checkpoints, and from then on it does the fetching. Never throws: a watch keeps its data here either way. */
  private async syncCollect(): Promise<void> {
    try {
      const names = await this.listNames(), views = this.views(), boards = this.boards();
      const watches = this.watches().filter((w) => !w.briefing).map((w) => {
        const g = this.groupOf(w, names), uses: Array<{ kind: string; id: string; label: string }> = [{ kind: 'live', id: 'feed', label: 'Live feed' }];
        if (!w.noSignal) uses.push({ kind: 'signal', id: g.key, label: boards.filter((b) => b.groups.includes(g.key)).map((b) => b.title)[0] ?? g.name });
        for (const v of views) if (v.source === 'all' || (v.source.startsWith('src:') ? sourceOf(w) === v.source.slice(4) : this.listKey(w) === v.source)) if (!v.kind || sourceOf(w) === v.kind) uses.push({ kind: 'feedpage', id: v.slug, label: v.title });
        return { ...w, source: sourceOf(w), uses };
      });
      const res = await this.env.COLLECT.getByName('main').fetch(new Request('https://internal/collect/sync-monitor', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ watches, dailyCap: this.cap(), import: !this.collectReady() }) }));
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      this.setMeta('collectReady', true);
    } catch (err) { console.error('collection sync failed', err instanceof Error ? err.message : String(err)); }
  }
  /** What was collected for a watch, and how its last check went. The status lives here too, so these pages work if the collection layer does not answer. */
  private ingestCollected(id: string, found: Found[], status: Partial<Watch>): void {
    const w = this.watch(id);
    if (!w) return;
    Object.assign(w, status);
    const source = sourceOf(w), sql = this.ctx.storage.sql;
    // Deliveries can repeat, and the first one after taking over re-reads what the feed already holds: the seen ids drop those.
    const fresh = found.filter((f) => f.id && !this.isSeen(id, f.id));
    this.ctx.storage.transactionSync(() => {
      for (const f of fresh) {
        this.markSeen(id, f.id);
        sql.exec('INSERT INTO feed (watch, label, seen_at, json, source) VALUES (?, ?, ?, ?, ?)', id, w.label, Date.now(), JSON.stringify(f.json), source);
      }
      this.countTerms(id, fresh);
      if (this.aiConfig().enabled) this.enqueueAi(id, fresh);
      // Each source keeps its own FEED_KEEP items, so a busy one cannot push the others out.
      sql.exec("DELETE FROM feed WHERE source = ?1 AND watch NOT LIKE 'brief:%' AND seq <= (SELECT MAX(seq) FROM feed WHERE source = ?1 AND watch NOT LIKE 'brief:%') - ?2", source, FEED_KEEP);
      sql.exec('DELETE FROM seen WHERE watch = ?1 AND rowid NOT IN (SELECT rowid FROM seen WHERE watch = ?1 ORDER BY at DESC LIMIT ?2)', id, SEEN_KEEP);
      this.saveWatch(w);
    });
  }

  /**
   * Posts a briefing already fetched (and paid for) go into Signal as one watch of their own, so Signal does not have to fetch them again.
   * The watch is never polled. Posts it has seen are skipped, so a later briefing that reads the same posts does not count them twice.
   */
  private ingestBriefing(slug: string, title: string, group: string, posts: Array<Record<string, unknown>>): { added: number; total: number } {
    const id = 'brief:' + slug, now = Date.now();
    const found: Found[] = [];
    for (const p of posts.slice(0, 2000)) {
      const pid = String(p.id ?? ''); if (!pid || this.isSeen(id, pid)) continue;
      const ts = Date.parse(String(p.createdAt ?? ''));
      found.push({ id: pid, ts: Number.isFinite(ts) ? ts : now, json: p });
    }
    const label = ('Briefing: ' + title).slice(0, 60), w: Watch = this.watch(id) ?? {
      id, label, query: '', originalsOnly: false, includeRetweets: false, intervalSec: 3600, enabled: false, created: now, lastCheckedTs: 0, nextRun: 0,
      checks: 0, found: 0, cost: 0, lastRun: 0, lastError: '', errors: 0, briefing: slug };
    w.label = label; w.enabled = false; w.group = cleanGroup(group) || title.slice(0, 40); w.lastRun = now; w.found += found.length; w.checks++;
    found.sort((a, b) => a.ts - b.ts);
    this.ctx.storage.transactionSync(() => {
      for (const f of found) {
        this.markSeen(id, f.id);
        const j = f.json as { source?: string };
        this.ctx.storage.sql.exec('INSERT INTO feed (watch, label, seen_at, json, source) VALUES (?, ?, ?, ?, ?)', id, label, now, JSON.stringify(f.json), j.source === 'rss' || j.source === 'hn' || j.source === 'youtube' || j.source === 'arxiv' ? j.source : 'x');
      }
      this.countTerms(id, found);
      if (this.aiConfig().enabled) this.enqueueAi(id, found);
      this.ctx.storage.sql.exec("DELETE FROM feed WHERE watch LIKE 'brief:%' AND seq <= (SELECT MAX(seq) FROM feed WHERE watch LIKE 'brief:%') - ?", BRIEF_KEEP);
      this.saveWatch(w);
    });
    return { added: found.length, total: posts.length };
  }

  // ---- Signal: counting
  /** Counts one item under each of its terms, on the day it was published. */
  private countTerms(watch: string, items: Found[]): void {
    const sql = this.ctx.storage.sql, now = Date.now(), floor = now - SIGNAL_KEEP_DAYS * 86_400_000;
    const days = new Map<string, number>(), terms = new Map<string, number>();
    for (const f of items) {
      const ts = Number.isFinite(f.ts) ? Math.min(f.ts, now) : now;
      if (ts < floor) continue;
      const j = f.json as { text?: unknown; title?: unknown; source?: unknown };
      if (isBait(`${j.title ?? ''} ${j.text ?? ''}`)) continue;   // giveaways and "like and reply to win": not counted at all
      const day = dayOf(ts);
      days.set(day, (days.get(day) ?? 0) + 1);
      this.logItem(watch, f, ts, day);
      // A video's description is mostly the channel's footer (links, sponsors, "join the Discord"), so only its title says what it is about.
      for (const t of extractTerms(String(j.source === 'youtube' && j.title ? j.title : j.text ?? ''))) terms.set(`${day}\n${t}`, (terms.get(`${day}\n${t}`) ?? 0) + 1);
    }
    for (const [day, n] of days) sql.exec('INSERT INTO day_items (day, watch, n) VALUES (?, ?, ?) ON CONFLICT (day, watch) DO UPDATE SET n = n + excluded.n', day, watch, n);
    for (const [k, n] of terms) {
      const i = k.indexOf('\n');
      sql.exec('INSERT INTO terms (day, watch, term, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, watch, term) DO UPDATE SET n = n + excluded.n', k.slice(0, i), watch, k.slice(i + 1), n);
    }
  }
  /** Keeps what is needed to show an item as proof of a topic. `match` is the text its terms were counted from. */
  private logItem(watch: string, f: Found, ts: number, day: string): void {
    const j = f.json as { id?: unknown; text?: unknown; title?: unknown; url?: unknown; discussionUrl?: unknown; source?: unknown; author?: { userName?: unknown } };
    const id = String(j.id ?? f.id ?? ''); if (!id) return;
    const x = !j.source, text = String(j.text ?? ''), user = String(j.author?.userName ?? '');
    const safe = (u: unknown) => (/^https:\/\//.test(String(u ?? '')) ? String(u).slice(0, 400) : '');
    const url = safe(j.url) || (x && /^\d+$/.test(id) ? `https://x.com/${user || 'i'}/status/${id}` : '');
    const [likes, replies, views] = itemNumbers(f.json);
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO item_log (watch, item, day, ts, title, url, disc, by, match, eng, likes, replies, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', watch, id, day, ts,
      cleanTitle(x ? text : String(j.title ?? '') || text.split('\n')[0], 200), url, safe(j.discussionUrl), (x ? '@' : '') + user.slice(0, 60),
      String(j.source === 'youtube' && j.title ? j.title : text).slice(0, 600), reactionsOf(f.json), likes, replies, views);
  }
  /** Once: the separate numbers for the items the live feed still holds (older logged items keep -1, "not recorded"). */
  private backfillItemNumbers(): void {
    if (this.getMeta('itemNumbers1', false)) return;
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      for (const r of sql.exec<{ watch: string; json: string }>('SELECT watch, json FROM feed').toArray()) {
        const j = JSON.parse(r.json) as { id?: unknown }, [likes, replies, views] = itemNumbers(j);
        if (j.id) sql.exec('UPDATE item_log SET likes = ?, replies = ?, views = ? WHERE watch = ? AND item = ? AND likes < 0', likes, replies, views, r.watch, String(j.id));
      }
      this.setMeta('itemNumbers1', true);
    });
  }
  /** Once: log what the live feed already holds. */
  private backfillItemLog(): void {
    if (this.getMeta('itemLogBackfill', false)) return;
    const rows = this.ctx.storage.sql.exec<{ watch: string; seen_at: number; json: string }>('SELECT watch, seen_at, json FROM feed').toArray(), floor = Date.now() - SIGNAL_KEEP_DAYS * 86_400_000;
    this.ctx.storage.transactionSync(() => {
      for (const r of rows) {
        const j = JSON.parse(r.json) as { createdAt?: string }, ts = Date.parse(j.createdAt ?? '') || r.seen_at;
        if (ts >= floor) this.logItem(r.watch, { id: '', ts, json: j }, Math.min(ts, Date.now()), dayOf(Math.min(ts, Date.now())));
      }
      this.setMeta('itemLogBackfill', true);
    });
  }
  /** Once: count what the feed already holds, so Signal has something to show the day it is first opened. */
  private backfillSignal(): void {
    if (this.getMeta('signalBackfill2', false)) return;
    this.ctx.storage.sql.exec('DELETE FROM terms'); this.ctx.storage.sql.exec('DELETE FROM day_items');   // counted again below, under the rules of today
    const rows = this.ctx.storage.sql.exec<{ watch: string; seen_at: number; json: string }>('SELECT watch, seen_at, json FROM feed').toArray();
    const by = new Map<string, Found[]>();
    for (const r of rows) {
      const j = JSON.parse(r.json) as { createdAt?: string };
      const ts = Date.parse(j.createdAt ?? '');
      (by.get(r.watch) ?? by.set(r.watch, []).get(r.watch)!).push({ id: '', ts: Number.isFinite(ts) ? ts : r.seen_at, json: j });
    }
    this.ctx.storage.transactionSync(() => { for (const [watch, items] of by) this.countTerms(watch, items); this.setMeta('signalBackfill2', true); });
  }
  /** Once a day: drop what is older than the window, and terms mentioned a single time after a week (most of the rows, none of the signal). */
  private pruneSignal(): void {
    if (this.getMeta('signalPruned', '') === today()) return;
    const sql = this.ctx.storage.sql, now = Date.now();
    sql.exec('DELETE FROM terms WHERE day < ?', dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    sql.exec('DELETE FROM day_items WHERE day < ?', dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    sql.exec('DELETE FROM terms WHERE n = 1 AND day < ?', dayOf(now - 7 * 86_400_000));
    sql.exec('DELETE FROM item_log WHERE day < ?', dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    for (const t of ['ai_terms', 'ai_items', 'ai_item']) sql.exec(`DELETE FROM ${t} WHERE day < ?`, dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    sql.exec('DELETE FROM ai_terms WHERE n = 1 AND day < ?', dayOf(now - 7 * 86_400_000));
    sql.exec('DELETE FROM item_vec WHERE day < ?', dayOf(now - SIGNAL_KEEP_DAYS * 86_400_000));
    sql.exec('DELETE FROM name_vec WHERE at < ?', now - SIGNAL_KEEP_DAYS * 86_400_000);
    this.setMeta('signalPruned', today());
  }

  // ---- Signal: reading
  /** Names of the feed lists, for the groups made from them. */
  private async listNames(): Promise<Map<string, string>> {
    try {
      const r = await this.env.LISTS.getByName('main').fetch(new Request('https://internal/lists/f-all'));
      return new Map(((await r.json()) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name]));
    } catch { return new Map(); }
  }
  /** Which group a watch votes in: a name you gave, else the feed list it came from, else its kind of source. */
  private groupOf(w: Watch, names: Map<string, string>): { key: string; name: string } {
    if (w.group) return { key: 'g:' + w.group.toLowerCase(), name: w.group };
    if (w.list && !w.list.includes(':')) return { key: 'list:' + w.list, name: names.get(w.list) ?? 'Feed list' };   // account lists and X Lists vote as X, as before
    return { key: 'src:' + sourceOf(w), name: SOURCE_NAME[sourceOf(w)] };
  }
  private async groups() {
    const names = await this.listNames(), weights = this.getMeta<Record<string, number>>('signalWeights', {});
    const excluded: Array<{ id: string; label: string; source: SourceKind; enabled: boolean }> = [];
    const of = new Map<string, string>(), groups = new Map<string, GroupInfo & { watches: Array<{ id: string; label: string; source: SourceKind; enabled: boolean; group?: string; error?: string; briefing?: string }> }>();
    for (const w of this.watches()) {
      if (w.noSignal) { excluded.push({ id: w.id, label: w.label, source: sourceOf(w), enabled: w.enabled }); continue; }
      const g = this.groupOf(w, names);
      of.set(w.id, g.key);
      const cur = groups.get(g.key) ?? groups.set(g.key, { key: g.key, name: g.name, weight: weights[g.key] ?? 1, watches: [] }).get(g.key)!;
      cur.watches.push({ id: w.id, label: w.label, source: sourceOf(w), enabled: w.enabled, group: w.group, error: w.lastError || undefined, briefing: w.briefing });
    }
    // A group made only of briefing posts has a head start: those posts were already picked and combined from many sources. A weight you set wins.
    for (const g of groups.values()) if (!(g.key in weights) && g.watches.length && g.watches.every((x) => this.watch(x.id)?.briefing)) g.weight = BRIEF_WEIGHT;
    return { of, groups: [...groups.values()], excluded };
  }
  /** Items per group over the days from..to (UTC, inclusive). */
  private itemsIn(of: Map<string, string>, from: string, to: string): Record<string, number> {
    const out: Record<string, number> = {}, T = this.tables();
    for (const r of this.ctx.storage.sql.exec<{ watch: string; n: number }>(`SELECT watch, SUM(n) AS n FROM ${T.items} WHERE day >= ? AND day <= ? GROUP BY watch`, from, to)) {
      const g = of.get(r.watch); if (g) out[g] = (out[g] ?? 0) + r.n;
    }
    return out;
  }
  /**
   * Terms that are one source's own signature rather than a topic: in at least 30% of its items over the kept period, on three or more different days
   * (a channel's footer, an account's catchphrase). Those mentions are left out for that source. As "watch\nterm".
   */
  private boilerplate(candFrom: string, candTo: string): Set<string> {
    const sql = this.ctx.storage.sql, from = dayOf(Date.now() - SIGNAL_KEEP_DAYS * 86_400_000), T = this.tables();
    const total = new Map<string, number>();
    for (const r of sql.exec<{ watch: string; n: number }>(`SELECT watch, SUM(n) AS n FROM ${T.items} WHERE day >= ? GROUP BY watch`, from)) total.set(r.watch, r.n);
    const out = new Set<string>();
    const rows = sql.exec<{ term: string; watch: string; n: number; days: number }>(
      `SELECT term, watch, SUM(n) AS n, COUNT(*) AS days FROM ${T.terms} WHERE day >= ?1 AND term IN
         (SELECT term FROM ${T.terms} WHERE day >= ?2 AND day <= ?3 GROUP BY term HAVING SUM(n) >= 2 ORDER BY SUM(n) DESC LIMIT 3000) GROUP BY term, watch`, from, candFrom, candTo);
    for (const r of rows) { const t = total.get(r.watch) ?? 0; if (t >= 6 && r.days >= 3 && r.n / t >= 0.3) out.add(`${r.watch}\n${r.term}`); }
    return out;
  }
  /** Per group, the number of items mentioning each term over from..to, for the terms mentioned at least 3 times in candFrom..candTo; and how many different sources mention it. */
  private countsIn(of: Map<string, string>, allow: Set<string>, boiler: Set<string>, blocked: (t: string) => boolean, perGroup: Map<string, number>, from: string, to: string, candFrom: string, candTo: string): { counts: Counts; voices: Map<string, number> } {
    const counts: Counts = new Map(), seen = new Map<string, Set<string>>(), T = this.tables();
    const rows = this.ctx.storage.sql.exec<{ term: string; watch: string; n: number }>(
      `SELECT term, watch, SUM(n) AS n FROM ${T.terms} WHERE day >= ?1 AND day <= ?2 AND term IN
         (SELECT term FROM ${T.terms} WHERE day >= ?3 AND day <= ?4 GROUP BY term HAVING SUM(n) >= 2 ORDER BY SUM(n) DESC LIMIT 3000)
       GROUP BY term, watch`, from, to, candFrom, candTo);
    const alias = this.aliasFn();
    for (const r of rows) {
      const g = of.get(r.watch), term = alias(r.term);
      if (!g || !allow.has(g) || boiler.has(`${r.watch}\n${r.term}`) || blocked(term)) continue;
      const c = counts.get(term) ?? counts.set(term, {}).get(term)!;
      c[g] = (c[g] ?? 0) + r.n;
      (seen.get(term) ?? seen.set(term, new Set()).get(term)!).add(r.watch);
    }
    // A term heard from one source only is not corroborated, unless that source is the only one its group has: then there is no one to ask.
    const heard = (w: Set<string>) => (w.size === 1 && (perGroup.get(of.get([...w][0]) ?? '') ?? 0) <= 1 ? 2 : w.size);
    return { counts, voices: new Map([...seen].map(([t, w]) => [t, heard(w)] as const)) };
  }
  /** Terms mentioned on most of the days there is data for, over the whole kept history. */
  private evergreen(candFrom: string, candTo: string): Set<string> {
    const sql = this.ctx.storage.sql, T = this.tables(), keepFrom = dayOf(Date.now() - SIGNAL_KEEP_DAYS * 86_400_000);
    const withData = sql.exec<{ n: number }>(`SELECT COUNT(DISTINCT day) AS n FROM ${T.items} WHERE day >= ?`, keepFrom).one().n;
    const present = new Map<string, number>(), alias = this.aliasFn();
    for (const r of sql.exec<{ term: string; d: number }>(
      `SELECT term, COUNT(DISTINCT day) AS d FROM ${T.terms} WHERE day >= ?1 AND term IN
         (SELECT term FROM ${T.terms} WHERE day >= ?2 AND day <= ?3 GROUP BY term HAVING SUM(n) >= 2 ORDER BY SUM(n) DESC LIMIT 3000) GROUP BY term`, keepFrom, candFrom, candTo)) { const t = alias(r.term); present.set(t, Math.max(present.get(t) ?? 0, r.d)); }
    return findEvergreen(present, withData);
  }
  private async compute(daysIn: number, only?: Set<string>) {
    const days = Math.min(SIGNAL_MAX_DAYS, Math.max(1, Math.floor(daysIn) || 7)), now = Date.now(), DAY = 86_400_000;
    const to = dayOf(now), from = dayOf(now - (days - 1) * DAY), prevTo = dayOf(now - days * DAY), prevFrom = dayOf(now - (2 * days - 1) * DAY);
    const all = await this.groups(), of = all.of, excluded = all.excluded, groups = only ? all.groups.filter((g) => only.has(g.key)) : all.groups;
    const items = this.itemsIn(of, from, to), prevItems = this.itemsIn(of, prevFrom, prevTo);
    const allow = new Set(groups.filter((g) => g.weight > 0).map((g) => g.key)), boiler = this.boilerplate(from, to);
    const blocked = makeBlocker(this.filterWords());
    // The sources that have items in the window, and how many each group has.
    const sources = new Set<string>(), perGroup = new Map<string, number>();
    for (const r of this.ctx.storage.sql.exec<{ watch: string }>(`SELECT DISTINCT watch FROM ${this.tables().items} WHERE day >= ? AND day <= ?`, from, to)) {
      const g = of.get(r.watch) ?? '';
      if (allow.has(g)) { sources.add(r.watch); perGroup.set(g, (perGroup.get(g) ?? 0) + 1); }
    }
    const cur = this.countsIn(of, allow, boiler, blocked, perGroup, from, to, from, to), prev = this.countsIn(of, allow, boiler, blocked, perGroup, prevFrom, prevTo, from, to);
    // With more than one source to hear from, a topic needs two of them: one source repeating itself is not a signal.
    const scored = scoreTerms({ groups, items, prevItems, cur: cur.counts, prev: prev.counts, voices: cur.voices, evergreen: this.evergreen(from, to), minVoices: sources.size >= 2 ? 2 : 1 });
    return { days, from, to, of, groups, excluded, everyGroup: all.groups.map((g) => ({ key: g.key, name: g.name })), items, prevItems, ...scored };
  }
  /** Items per day for the last SIGNAL_MAX_DAYS days, per group (oldest first). */
  private volume(of: Map<string, string>, groups: GroupInfo[]) {
    const now = Date.now(), days = Array.from({ length: SIGNAL_MAX_DAYS }, (_, i) => dayOf(now - (SIGNAL_MAX_DAYS - 1 - i) * 86_400_000));
    const by: Record<string, number[]> = Object.fromEntries(groups.map((g) => [g.key, days.map(() => 0)]));
    for (const r of this.ctx.storage.sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${this.tables().items} WHERE day >= ?`, days[0])) {
      const g = of.get(r.watch), i = days.indexOf(r.day);
      if (g && by[g] && i >= 0) by[g][i] += r.n;   // groups outside the list (another Signal's, or muted) are not drawn
    }
    return { days, by };
  }
  // ---- The words you left out of Signal
  private filterWords(): FilterWord[] {
    const have = this.getMeta<FilterWord[] | null>('signalFilter', null);
    if (have) return have;
    this.setMeta('signalFilter', DEFAULT_FILTER);   // a new setup starts with "ai" on the list, and it can be taken off
    return DEFAULT_FILTER;
  }
  /** Topic names you merged or renamed: old name -> the name it is counted under. Applied when reading, so it also covers what was counted before. */
  private aliases(): Record<string, string> { return this.getMeta<Record<string, string>>('signalAliases', {}); }
  private aliasFn(): (t: string) => string { const a = this.aliases(); return (t) => a[t] ?? t; }
  /** A topic and every name that is counted under it. */
  private namesOf(term: string): string[] { const a = this.aliases(); return [term, ...Object.keys(a).filter((k) => a[k] === term)]; }
  private filterInfo() {
    return { words: this.filterWords(), aliases: this.aliases(), builtIn: { generic: [...GENERIC].filter(Boolean).sort(), vague: [...VAGUE].sort(), stopCount: STOP.size } };
  }

  // ---- Signal topics written by a model (optional; the setting is on the Signal tab)
  private aiConfig(): SignalAi {
    const c = this.getMeta<Partial<SignalAi>>('signalAi', {});
    return { enabled: !!c.enabled, model: c.model ?? '', dailyCap: Number.isFinite(c.dailyCap) ? Number(c.dailyCap) : 0.25 };
  }
  /** A setup that never chose starts with model topics on (when a model is available): words alone rank "model" and "project" above real topics. Turning it off sticks. */
  private ensureAiDefault(): void {
    if (this.getMeta<unknown>('signalAi', null)) return;
    const model = defaultTiers(this.env).cheap;
    if (!model || !modelOptions(this.env).some((m) => m.id === model)) return;
    this.setMeta('signalAi', { enabled: true, model, dailyCap: 0.25 } satisfies SignalAi);
    this.enqueueBacklog();
  }
  /** The topic names already in use over the last two weeks, most mentioned first: the model is told to reuse them, so one thing keeps one name. */
  private knownTopics(n = 60): string[] {
    const alias = this.aliasFn();
    return this.ctx.storage.sql.exec<{ term: string }>('SELECT term FROM ai_terms WHERE day >= ? GROUP BY term ORDER BY SUM(n) DESC LIMIT ?', dayOf(Date.now() - AI_BACKLOG_DAYS * 86_400_000), Math.ceil(n * 1.4)).toArray().map((r) => alias(r.term)).filter((t, i, a) => a.indexOf(t) === i).slice(0, n);
  }
  private aiSpend(): { day: string; cost: number } {
    const s = this.getMeta<{ day: string; cost: number }>('aiSpend', { day: today(), cost: 0 });
    return s.day === today() ? s : { day: today(), cost: 0 };
  }
  /** The tables Signal reads: the model's topics once it has read something, otherwise the words. */
  private tables(): { terms: string; items: string; ai: boolean } {
    const on = this.aiConfig().enabled && this.ctx.storage.sql.exec('SELECT 1 FROM ai_items LIMIT 1').toArray().length > 0;
    return on ? { terms: 'ai_terms', items: 'ai_items', ai: true } : { terms: 'terms', items: 'day_items', ai: false };
  }
  /** What the model gave each item since `from`, as "watch\nitem" -> topics; null when Signal is counting words. */
  private aiTopics(from: string): Map<string, string[]> | null {
    if (!this.tables().ai) return null;
    return new Map(this.ctx.storage.sql.exec<{ watch: string; item: string; topics: string }>('SELECT watch, item, topics FROM ai_item WHERE day >= ?', from).toArray().map((r) => [`${r.watch}\n${r.item}`, (JSON.parse(r.topics) ?? []) as string[]]));   // 'null': the model failed on it (not read), counted as no topics
  }
  private aiQueued(): number { return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM ai_queue').one().n; }
  /** When to wake up for items waiting for the model: now, after an error, or when the day's cap is fresh again. 0 when there is nothing to do. */
  private aiWake(): number {
    this.ensureAiDefault();
    const c = this.aiConfig();
    if (!c.enabled || !c.model || !this.aiQueued()) return 0;
    const st = this.getMeta<{ retryAt?: number }>('aiStatus', {});
    if (st.retryAt && st.retryAt > Date.now()) return st.retryAt;
    if (this.aiSpend().cost >= c.dailyCap) return Date.parse(today() + 'T00:00:00Z') + 86_400_000 + 60_000;
    return Date.now() + 2000;
  }
  private enqueueAi(watch: string, items: Found[]): void {
    const sql = this.ctx.storage.sql, now = Date.now(), floor = now - SIGNAL_KEEP_DAYS * 86_400_000;
    for (const f of items) {
      const ts = Number.isFinite(f.ts) ? Math.min(f.ts, now) : now;
      if (ts < floor || !f.id) continue;
      const j = f.json as { text?: unknown; title?: unknown; source?: unknown };
      if (isBait(`${j.title ?? ''} ${j.text ?? ''}`)) continue;
      sql.exec('INSERT OR IGNORE INTO ai_queue (watch, item, day, text) VALUES (?, ?, ?, ?)', watch, String(f.id), dayOf(ts), String(j.source === 'youtube' && j.title ? j.title : j.text ?? '').slice(0, 600));
    }
    sql.exec('DELETE FROM ai_queue WHERE seq <= (SELECT MAX(seq) FROM ai_queue) - ?', AI_QUEUE_MAX);
  }
  /** Turning it on: queue what the live feed already holds from the last two weeks, so the first view is not empty. */
  private enqueueBacklog(): void {
    const floor = Date.now() - AI_BACKLOG_DAYS * 86_400_000, byWatch = new Map<string, Found[]>();
    const have = this.ctx.storage.sql.exec<{ watch: string; item: string }>('SELECT watch, item FROM ai_item').toArray().reduce((s, r) => s.add(`${r.watch}\n${r.item}`), new Set<string>());
    for (const r of this.ctx.storage.sql.exec<{ watch: string; seen_at: number; json: string }>('SELECT watch, seen_at, json FROM feed ORDER BY seq DESC LIMIT 1500')) {
      const j = JSON.parse(r.json) as { id?: string; createdAt?: string };
      const ts = Date.parse(j.createdAt ?? '') || r.seen_at;
      if (ts < floor || !j.id || have.has(`${r.watch}\n${j.id}`)) continue;
      (byWatch.get(r.watch) ?? byWatch.set(r.watch, []).get(r.watch)!).push({ id: j.id, ts, json: j });
    }
    this.ctx.storage.transactionSync(() => { for (const [w, items] of byWatch) this.enqueueAi(w, items); });
  }
  /** Reads queued items in batches until the time or the day's spending cap runs out. An error is shown on the Signal tab and retried later. */
  private async processAi(deadline: number): Promise<void> {
    const cfg = this.aiConfig(), sql = this.ctx.storage.sql;
    if (!cfg.enabled || !cfg.model) return;
    const st = this.getMeta<{ retryAt?: number }>('aiStatus', {});
    if (st.retryAt && st.retryAt > Date.now()) return;
    while (Date.now() < deadline) {
      if (this.aiSpend().cost >= cfg.dailyCap) { this.setMeta('aiStatus', { error: 'The daily spending cap is reached; it continues tomorrow.', at: Date.now() }); return; }
      const rows = sql.exec<{ seq: number; watch: string; item: string; day: string; text: string }>('SELECT seq, watch, item, day, text FROM ai_queue ORDER BY seq LIMIT ?', AI_BATCH).toArray();
      if (!rows.length) { this.setMeta('aiStatus', {}); return; }
      // Copies of an earlier post are not read: they count once, as the post they repeat. The rest is read with the names in use closest to it.
      const meaning = await this.batchMeaning(rows), keyOf = (r: { watch: string; item: string }) => `${r.watch}\n${r.item}`;
      const read = rows.filter((r) => !meaning.copies.has(keyOf(r))), at = new Map(read.map((r, i) => [r.seq, i] as const));
      let topics = new Map<number, string[]>(), cost = 0, tin = 0, tout = 0, failed = '', gaveUp = false;
      if (read.length) try {
        const texts = read.map((r) => r.text);
        const r = await complete(this.env, cfg.model, [topicSystem(meaning.hints), topicUser(texts)], { maxTokens: 1800,
          mock: () => JSON.stringify({ items: texts.map((t, i) => ({ i: i + 1, t: extractTerms(t).filter((x) => x.includes(' ')).slice(0, 2) })) }) });
        topics = parseTopics(r.text, read.length); cost = r.cost; tin = r.tokensIn; tout = r.tokensOut;
        if (!topics.size) failed = 'the model did not return readable topics';
      } catch (err) { failed = err instanceof Error ? err.message : String(err); }
      if (cost) { this.setMeta('aiSpend', { day: today(), cost: this.aiSpend().cost + cost }); await recordCost(this.env, { kind: 'signal', ref: 'topics', label: 'Signal topics (AI)', llm: cost, tokensIn: tin, tokensOut: tout, calls: 1, model: cfg.model }); }
      if (failed) {
        // The same batch is tried again later; after three failures in a row it is given up (read as "no topic") so it cannot block the rest.
        const fails = this.getMeta<number>('aiFails', 0) + 1;
        this.setMeta('aiFails', fails);
        if (fails < 3) { this.setMeta('aiStatus', { error: failed.slice(0, 200), at: Date.now(), retryAt: Date.now() + AI_RETRY_MS }); return; }
        this.setMeta('aiFails', 0); topics = new Map(); gaveUp = true;
      } else this.setMeta('aiFails', 0);
      this.ctx.storage.transactionSync(() => {
        for (const row of rows) {
          const copy = meaning.copies.get(keyOf(row)) ?? '', v = meaning.vecs.get(keyOf(row));
          if (v) sql.exec('INSERT OR REPLACE INTO item_vec (watch, item, day, v, copy) VALUES (?, ?, ?, ?, ?)', row.watch, row.item, row.day, toBlob(v), copy);
          sql.exec('DELETE FROM ai_queue WHERE seq = ?', row.seq);
          // A copy is read as "nothing specific" and not counted: not as an item of its day, not under any topic.
          if (copy) { sql.exec('INSERT OR REPLACE INTO ai_item (watch, item, day, topics) VALUES (?, ?, ?, ?)', row.watch, row.item, row.day, '[]'); continue; }
          const t = topics.get(at.get(row.seq)!) ?? [];
          // Items of a batch that failed three times are kept as 'null' (not read), so they can be retried; an empty list means read, nothing specific.
          sql.exec('INSERT OR REPLACE INTO ai_item (watch, item, day, topics) VALUES (?, ?, ?, ?)', row.watch, row.item, row.day, gaveUp ? 'null' : JSON.stringify(t));
          sql.exec('INSERT INTO ai_items (day, watch, n) VALUES (?, ?, 1) ON CONFLICT (day, watch) DO UPDATE SET n = n + 1', row.day, row.watch);
          for (const x of t) sql.exec('INSERT INTO ai_terms (day, watch, term, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, watch, term) DO UPDATE SET n = n + 1', row.day, row.watch, x);
        }
      });
      this.noteCopies(rows.filter((r) => meaning.copies.has(keyOf(r))).map((r) => ({ text: r.text, of: meaning.copies.get(keyOf(r))! })));
      if (!gaveUp) await this.suggestNames([...new Set([...topics.values()].flat())], meaning.names);
      if (!failed) this.setMeta('aiStatus', {});
    }
  }
  // ---- meaning (src/signal/vectors.ts): copies, and the names shown to the topic model
  /**
   * What a batch the topic model is about to read means: a vector per item (the one kept from an earlier read when there is one), which items repeat a
   * post of the last COPY_DAYS days, the names in use to show the model, and the vectors of the names in use. Never stops the reading: when the embedding
   * model fails, nothing is a copy and the most used names are shown, as before there were vectors.
   */
  private async batchMeaning(rows: Array<{ watch: string; item: string; day: string; text: string }>) {
    const sql = this.ctx.storage.sql, keyOf = (r: { watch: string; item: string }) => `${r.watch}\n${r.item}`, top = this.knownTopics();
    try {
      const vecs = new Map<string, Float32Array>();
      for (const r of rows) { const kept = sql.exec<{ v: ArrayBuffer }>('SELECT v FROM item_vec WHERE watch = ? AND item = ?', r.watch, r.item).toArray()[0]; if (kept) vecs.set(keyOf(r), fromBlob(kept.v)); }
      const need = rows.filter((r) => !vecs.has(keyOf(r)));
      if (need.length) {
        const e = await embed(this.env, need.map((r) => embedText(r.text)));
        need.forEach((r, i) => vecs.set(keyOf(r), e.vectors[i]));
        await this.embedCost(e.tokens, e.cost, 'signal-items', 'Signal items (meaning)');
      }
      const earlier = sql.exec<{ watch: string; item: string; v: ArrayBuffer }>("SELECT watch, item, v FROM item_vec WHERE day >= ? AND copy = ''", dayOf(Date.now() - COPY_DAYS * 86_400_000)).toArray()
        .map((x) => ({ key: keyOf(x), v: fromBlob(x.v) }));
      const copies = findCopies(rows.map((r) => ({ key: keyOf(r), v: vecs.get(keyOf(r))! })), earlier);
      const names = await this.nameVectors(this.knownTopics(NAME_POOL));
      const near = nearestNames(rows.filter((r) => !copies.has(keyOf(r))).map((r) => vecs.get(keyOf(r))!), [...names].map(([name, v]) => ({ name, v })));
      const hints = [...new Set([...top.slice(0, HINT_TOP), ...near, ...top.slice(HINT_TOP)])].slice(0, HINT_MAX);
      this.setMeta('embedError', '');
      return { vecs, copies, hints, names };
    } catch (err) {
      this.setMeta('embedError', (err instanceof Error ? err.message : String(err)).slice(0, 200));
      return { vecs: new Map<string, Float32Array>(), copies: new Map<string, string>(), hints: top, names: new Map<string, Float32Array>() };
    }
  }
  /** The vectors of these topic names, embedding the ones not seen before (at most NAME_EMBED_MAX at a time; the rest come in later batches). */
  private async nameVectors(names: string[]): Promise<Map<string, Float32Array>> {
    const sql = this.ctx.storage.sql, now = Date.now(), list = JSON.stringify(names);
    const have = new Map(sql.exec<{ term: string; v: ArrayBuffer }>('SELECT term, v FROM name_vec WHERE term IN (SELECT value FROM json_each(?))', list).toArray().map((r) => [r.term, fromBlob(r.v)] as const));
    const missing = names.filter((n) => !have.has(n)).slice(0, NAME_EMBED_MAX);
    if (missing.length) {
      const e = await embed(this.env, missing);
      await this.embedCost(e.tokens, e.cost, 'signal-names', 'Signal topic names (meaning)');
      this.ctx.storage.transactionSync(() => missing.forEach((n, i) => { have.set(n, e.vectors[i]); sql.exec('INSERT OR REPLACE INTO name_vec (term, v, at) VALUES (?, ?, ?)', n, toBlob(e.vectors[i]), now); }));
    }
    sql.exec('UPDATE name_vec SET at = ? WHERE at < ? AND term IN (SELECT value FROM json_each(?))', now, now - 86_400_000, list);   // still wanted: kept
    return have;
  }
  private async embedCost(tokens: number, cost: number, ref: string, label: string): Promise<void> {
    await recordCost(this.env, { kind: 'embedding', ref, label, llm: cost, tokensIn: tokens, tokensOut: 0, calls: 1, model: EMBED_MODEL });
  }
  /** The newest copies found, with the post each repeats, so the admin can see what is folded and judge the threshold. */
  private noteCopies(found: Array<{ text: string; of: string }>): void {
    if (!found.length) return;
    const sql = this.ctx.storage.sql, now = Date.now(), cut = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 140);
    const fresh = found.map((f) => {
      const [watch, item] = f.of.split('\n'), o = sql.exec<{ title: string }>('SELECT title FROM item_log WHERE watch = ? AND item = ?', watch, item).toArray()[0];
      return { at: now, copy: cut(f.text), of: cut(o?.title ?? '') };
    });
    this.setMeta('copyExamples', [...fresh, ...this.getMeta<Array<{ at: number; copy: string; of: string }>>('copyExamples', [])].slice(0, COPY_EXAMPLES));
  }
  /** New topic names that are probably another name for one in use, kept for the admin to merge or dismiss. Nothing is merged without the admin. */
  private async suggestNames(given: string[], known: Map<string, Float32Array>): Promise<void> {
    if (!known.size) return;
    const fresh = given.filter((n) => !known.has(n));
    if (!fresh.length) return;
    try {
      const vs = await this.nameVectors(fresh);
      const found = nameSuggestions(fresh.filter((n) => vs.has(n)).map((name) => ({ name, v: vs.get(name)! })), [...known].map(([name, v]) => ({ name, v })));
      if (!found.length) return;
      const old = this.getMeta<Array<{ name: string; like: string; sim: number; at: number }>>('nameSuggestions', []).filter((s) => !found.some((f) => f.name === s.name));
      this.setMeta('nameSuggestions', [...found.map((f) => ({ ...f, at: Date.now() })), ...old].slice(0, SUGGEST_KEEP));
    } catch { /* suggestions are a help, never a reason to stop reading */ }
  }
  /** The suggestions still open: not merged since, not dismissed, and the name they are like is still a name of its own. */
  private openSuggestions() {
    const a = this.aliases(), gone = new Set(this.getMeta<string[]>('nameDismissed', []));
    return this.getMeta<Array<{ name: string; like: string; sim: number; at: number }>>('nameSuggestions', []).map((s) => ({ ...s, like: a[s.like] ?? s.like }))
      .filter((s) => !a[s.name] && s.like !== s.name && !gone.has(`${s.name}\n${s.like}`));
  }
  /** For the settings panel: what is on, what it costs, and how far it has got. */
  private aiStatus() {
    const c = this.aiConfig(), models = modelOptions(this.env).filter((m) => !m.decider), st = this.getMeta<{ error?: string; retryAt?: number }>('aiStatus', {});
    const read = this.ctx.storage.sql.exec<{ n: number }>('SELECT COALESCE(SUM(n), 0) AS n FROM ai_items WHERE day >= ?', dayOf(Date.now() - AI_BACKLOG_DAYS * 86_400_000)).one().n;
    const failedItems = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM ai_item WHERE topics = 'null'").one().n;
    const rereadable = Math.min(AI_QUEUE_MAX - 200, this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM item_log WHERE day >= ?', dayOf(Date.now() - (AI_BACKLOG_DAYS - 1) * 86_400_000)).one().n);
    return {
      available: models.length > 0, enabled: c.enabled, model: c.model || defaultTiers(this.env).cheap, dailyCap: c.dailyCap, spentToday: this.aiSpend().cost, using: this.tables().ai,
      queued: this.aiQueued(), read, failedItems, rereadable, error: st.error ?? '',
      // Meaning: how many posts were folded as copies of another, examples of them, and topic names that are probably one.
      copies: this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM item_vec WHERE copy != '' AND day >= ?", dayOf(Date.now() - AI_BACKLOG_DAYS * 86_400_000)).one().n,
      copyExamples: this.getMeta<Array<{ at: number; copy: string; of: string }>>('copyExamples', []), embedError: this.getMeta<string>('embedError', ''), suggestions: this.openSuggestions(),
      models: models.map((m) => ({ id: m.id, label: m.label, per1000: estimatePer1000(m.inPrice, m.outPrice), note: m.note })),
    };
  }

  /** The items of the live feed that fall in the window and belong to the counted groups: what they were counted under, and what to show for them. */
  private windowItems(of: Map<string, string>, allow: Set<string>, from: string, to: string) {
    const fromMs = Date.parse(from + 'T00:00:00Z'), toMs = Date.parse(to + 'T00:00:00Z') + 86_400_000;
    const items: TopicItem[] = [], meta: Array<{ title: string; url: string; by: string; group: string; ts: number }> = [], ai = this.aiTopics(from), blocked = makeBlocker(this.filterWords()), alias = this.aliasFn();
    for (const r of this.ctx.storage.sql.exec<{ watch: string; label: string; seen_at: number; json: string; source: string }>('SELECT watch, label, seen_at, json, source FROM feed ORDER BY seq DESC LIMIT 2500')) {
      const g = of.get(r.watch);
      if (!g || !allow.has(g)) continue;
      const j = JSON.parse(r.json) as { text?: string; title?: string; url?: string; id?: string; createdAt?: string; feed?: string; author?: { userName?: string }; likeCount?: number; replyCount?: number; retweetCount?: number; quoteCount?: number };
      const ts = Date.parse(j.createdAt ?? '') || r.seen_at;
      if (ts < fromMs || ts >= toMs) continue;
      const text = String(j.text ?? ''), x = r.source === 'x';
      if (isBait(`${j.title ?? ''} ${text}`)) continue;
      const eng = reactionsOf(j);
      items.push({ ts, eng, terms: new Set((ai ? ai.get(`${r.watch}\n${j.id}`) ?? [] : extractTerms(r.source === 'youtube' && j.title ? j.title : text)).map(alias).filter((t) => !blocked(t))) });
      const url = /^https:\/\//.test(j.url ?? '') ? j.url! : x && /^\d+$/.test(j.id ?? '') ? `https://x.com/${j.author?.userName ?? 'i'}/status/${j.id}` : '';
      meta.push({ title: cleanTitle(x ? text : j.title || text.split('\n')[0]), url, by: x ? '@' + (j.author?.userName ?? '') : j.feed || r.label, group: g, ts });
    }
    return { items, meta };
  }
  /** Topics for the lists: words from the same items merged into one, each with a name, what goes with it and the items it comes from. */
  private describeTopics(c: { of: Map<string, string>; groups: GroupInfo[]; from: string; to: string }, pool: ScoredTerm[], nTop: number) {
    const { items, meta } = this.windowItems(c.of, new Set(c.groups.filter((g) => g.weight > 0).map((g) => g.key)), c.from, c.to), post = indexItems(items);
    const describe = (t: ScoredTerm, label?: string, members: string[] = [t.term]) => ({ ...t, label: label ?? t.term, members: members.filter((m) => m !== t.term),
      related: relatedTerms(members, items, post), reactions: topicEngagement(members, items, post), headlines: topicItems(members, items, post, 2).map((i) => ({ ...meta[i], reactions: items[i].eng ?? 0 })) });
    const clusters = mergeTopics(pool.slice(0, 60), post, nTop);
    const ordered = boostByEngagement(clusters, clusters.map((cl) => topicEngagement(cl.members.map((m) => m.term), items, post, REACTION_CAP)));
    const described = ordered.map((cl) => describe(cl.lead, cl.label, cl.members.map((m) => m.term))), parents = nestTopics(described);
    return { top: partsAfterParents(described.map((t) => ({ ...t, parent: parents.get(t.term) }))), describe, items };
  }
  /**
   * The landscape of a published Signal for a window of 1, 3 or 7 days: a bubble for each of the biggest topics (not the ones that are part of a bigger one), grouped by which topics share items.
   * The layout is kept per day: it is drawn again (starting from the last one kept) when it is three hours old or the topics changed, never more often. No model is involved.
   */
  private async landscapePublic(slug: string, daysIn: number): Promise<Layout | null> {
    const board = this.boards().find((b) => b.public && b.slug === slug), win = daysIn === 3 || daysIn === 7 ? daysIn : 1;
    if (!board) return null;
    const c = await this.compute(win, new Set(board.groups)), shown = c.groups.filter((g) => g.weight > 0 && (c.items[g.key] ?? 0) > 0);
    if (!shown.length) return null;
    const { top, items } = this.describeTopics({ ...c, groups: shown }, c.terms.filter(notSteady), 30);
    const seen = new Set<string>(), own = top.filter((t) => !t.parent).sort((a, b) => b.signal - a.signal).filter((t) => { const k = topicSlug(t.term); return seen.has(k) ? false : (seen.add(k), true); }).slice(0, 24);
    if (!own.length) return null;
    const sql = this.ctx.storage.sql, day = today(), now = Date.now(), want = own.map((t) => topicSlug(t.term)).sort().join('|');
    const read = (q: string, ...a: Array<string | number>) => { const r = sql.exec<{ at: number; json: string }>(q, ...a).toArray()[0]; try { return r ? { at: r.at, layout: cleanLayout(JSON.parse(r.json)) } : null; } catch { return null; } };
    const kept = read('SELECT at, json FROM landscape WHERE board = ? AND win = ? AND day = ?', board.id, win, day);
    if (kept?.layout && now - kept.at < 3 * 3_600_000 && layoutKeys(kept.layout) === want) return kept.layout;
    const prev = kept?.layout ?? read('SELECT at, json FROM landscape WHERE board = ? AND win = ? AND day < ? ORDER BY day DESC LIMIT 1', board.id, win, day)?.layout ?? null;
    const topics = own.map((t) => ({ key: topicSlug(t.term), label: t.label, score: t.signal }));
    const layout = layoutLandscape(topics, coCounts(own.map((t) => ({ key: topicSlug(t.term), names: [t.term, ...t.members] })), items), prev);
    sql.exec('INSERT OR REPLACE INTO landscape (board, win, day, at, json) VALUES (?, ?, ?, ?, ?)', board.id, win, day, now, JSON.stringify(layout));
    sql.exec('DELETE FROM landscape WHERE day < ?', dayOf(now - 14 * 86_400_000));
    return layout;
  }
  /**
   * The Depth chart of a published Signal (src/signal/depth.ts): for each of the biggest topics of the week, which kinds of source, groups and sources mentioned it on each of the last 14 days,
   * as breadth and a place in the picture. Sources that had nothing in those days are not counted as watched, and briefing posts are left out: they are written from the other sources.
   * Counts only: no items, names of sources or handles. No model is involved.
   */
  private async depthPublic(slug: string): Promise<(DepthLayout & { days: string[]; baselineOk: boolean; meta: Array<{ key: string; term: string; members: string[]; isNew: boolean; change: number | null }> }) | null> {
    const board = this.boards().find((b) => b.public && b.slug === slug);
    if (!board) return null;
    const c = await this.compute(7, new Set(board.groups)), shown = c.groups.filter((g) => g.weight > 0 && (c.items[g.key] ?? 0) > 0);
    if (!shown.length) return null;
    const { top } = this.describeTopics({ ...c, groups: shown }, c.terms.filter(notSteady), 30);
    const seen = new Set<string>(), own = top.filter((t) => !t.parent).sort((a, b) => b.signal - a.signal).filter((t) => { const k = topicSlug(t.term); return seen.has(k) ? false : (seen.add(k), true); }).slice(0, DEPTH_TOPICS);
    if (!own.length) return null;
    const sql = this.ctx.storage.sql, T = this.tables(), now = Date.now(), all = Array.from({ length: DEPTH_DAYS + DEPTH_WINDOW - 1 }, (_, i) => dayOf(now - (DEPTH_DAYS + DEPTH_WINDOW - 2 - i) * 86_400_000)), at = new Map(all.map((d, i) => [d, i] as const));
    // what is watched: the sources of the Signal's groups that had anything in these days
    const on = new Set(shown.map((g) => g.key)), had = new Set(sql.exec<{ watch: string }>(`SELECT DISTINCT watch FROM ${T.items} WHERE day >= ?`, all[0]).toArray().map((r) => r.watch)), info = new Map<string, { kind: string; group: string }>();
    for (const w of this.watches()) { const g = c.of.get(w.id); if (g && on.has(g) && !w.briefing && had.has(w.id)) info.set(w.id, { kind: sourceOf(w), group: g }); }
    const kinds = (['x', 'hn', 'youtube', 'rss', 'arxiv'] as string[]).filter((k) => [...info.values()].some((x) => x.kind === k));
    const owner = new Map<string, number[]>();
    own.forEach((t, i) => { for (const name of new Set([t.term, ...t.members].flatMap((x) => this.namesOf(x)))) (owner.get(name) ?? owner.set(name, []).get(name)!).push(i); });
    const daily = own.map(() => all.map(() => new Map<string, number>()));
    for (const r of sql.exec<{ day: string; watch: string; term: string; n: number }>(`SELECT day, watch, term, n FROM ${T.terms} WHERE term IN (SELECT value FROM json_each(?)) AND day >= ?`, JSON.stringify([...owner.keys()]), all[0])) {
      const d = at.get(r.day);
      if (d === undefined || !info.has(r.watch)) continue;
      for (const i of owner.get(r.term) ?? []) daily[i][d].set(r.watch, (daily[i][d].get(r.watch) ?? 0) + r.n);
    }
    const layout = depthLayout(own.map((t, i) => ({ key: topicSlug(t.term), label: t.label, score: t.signal, reach: reachSeries(daily[i].map((m) => [...m]), info, kinds) })),
      kinds, { kinds: kinds.length, groups: new Set([...info.values()].map((x) => x.group)).size, sources: info.size });
    return { ...layout, days: all.slice(DEPTH_WINDOW - 1), baselineOk: c.baselineOk, meta: own.map((t) => ({ key: topicSlug(t.term), term: t.term, members: t.members, isNew: t.isNew, change: t.change })) };
  }
  /**
   * The Ladder of a published Signal (src/signal/ladder.ts): the rank of its biggest topics on each of the last 14 days, by the score Signal gives (the share of each group's items that mention
   * the topic, groups weighted), worked out per day over three days. Counts only. No model is involved.
   */
  private async ladderPublic(slug: string): Promise<(Ladder & { days: string[]; baselineOk: boolean; meta: Array<{ key: string; term: string; members: string[]; isNew: boolean; change: number | null }> }) | null> {
    const board = this.boards().find((b) => b.public && b.slug === slug);
    if (!board) return null;
    const c = await this.compute(LADDER_DAYS, new Set(board.groups)), shown = c.groups.filter((g) => g.weight > 0 && (c.items[g.key] ?? 0) > 0);
    if (!shown.length) return null;
    const { top } = this.describeTopics({ ...c, groups: shown }, c.terms.filter(notSteady), LADDER_POOL + 10);
    const seen = new Set<string>(), own = top.filter((t) => !t.parent).sort((a, b) => b.signal - a.signal).filter((t) => { const k = topicSlug(t.term); return seen.has(k) ? false : (seen.add(k), true); }).slice(0, LADDER_POOL);
    if (!own.length) return null;
    const sql = this.ctx.storage.sql, T = this.tables(), now = Date.now(), all = Array.from({ length: LADDER_DAYS + LADDER_WINDOW - 1 }, (_, i) => dayOf(now - (LADDER_DAYS + LADDER_WINDOW - 2 - i) * 86_400_000)), at = new Map(all.map((d, i) => [d, i] as const));
    const gi = new Map(shown.map((g, i) => [g.key, i] as const)), items = shown.map(() => all.map(() => 0));
    for (const r of sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${T.items} WHERE day >= ?`, all[0])) {
      const g = gi.get(c.of.get(r.watch) ?? ''), d = at.get(r.day);
      if (g !== undefined && d !== undefined) items[g][d] += r.n;
    }
    const owner = new Map<string, number[]>();
    own.forEach((t, i) => { for (const name of new Set([t.term, ...t.members].flatMap((x) => this.namesOf(x)))) (owner.get(name) ?? owner.set(name, []).get(name)!).push(i); });
    const mentions = own.map(() => shown.map(() => all.map(() => 0)));
    for (const r of sql.exec<{ day: string; watch: string; term: string; n: number }>(`SELECT day, watch, term, n FROM ${T.terms} WHERE term IN (SELECT value FROM json_each(?)) AND day >= ?`, JSON.stringify([...owner.keys()]), all[0])) {
      const g = gi.get(c.of.get(r.watch) ?? ''), d = at.get(r.day);
      if (g === undefined || d === undefined) continue;
      for (const i of owner.get(r.term) ?? []) mentions[i][g][d] += r.n;
    }
    const weights = shown.map((g) => g.weight), ladder = ladderOf(own.map((t, i) => ({ key: topicSlug(t.term), label: t.label, scores: dayScores(mentions[i], items, weights) })));
    const on = new Set(ladder.topics.map((t) => t.key));
    return { ...ladder, days: all.slice(LADDER_WINDOW - 1), baselineOk: c.baselineOk, meta: own.filter((t) => on.has(topicSlug(t.term))).map((t) => ({ key: topicSlug(t.term), term: t.term, members: t.members, isNew: t.isNew, change: t.change })) };
  }
  /** The layouts kept for the days before today (at most a week), for the landscape's replay. Read only: a day nobody opened the page has no layout and is simply missing. */
  private landscapeReplay(slug: string, daysIn: number): ReplayFrame[] {
    const board = this.boards().find((b) => b.public && b.slug === slug), win = daysIn === 3 || daysIn === 7 ? daysIn : 1;
    if (!board) return [];
    const rows = this.ctx.storage.sql.exec<{ day: string; json: string }>('SELECT day, json FROM landscape WHERE board = ? AND win = ? AND day >= ? ORDER BY day', board.id, win, dayOf(Date.now() - 8 * 86_400_000)).toArray();
    return replayFrames(rows, today());
  }
  private async signalOverview(daysIn: number, boardRef = '', hideSteady = true) {
    const board = boardRef ? this.findBoard(boardRef) : undefined;
    if (boardRef && !board) throw new Error('unknown Signal');
    const c = await this.compute(daysIn, board && new Set(board.groups));
    const pick = (list: Array<{ term: string }>) => list.map((t) => t.term);
    // Topics at the same level as in the period before are background: left out of the lists unless asked for. Rising always looks at all of them.
    const pool = hideSteady ? c.terms.filter(notSteady) : c.terms;
    const { top, describe } = this.describeTopics(c, pool, 40), rise = rising(c.terms, 25);
    const shared = pool.filter((t) => t.kind === 'shared').slice(0, 15), single = pool.filter((t) => t.kind === 'single').slice(0, 20);
    const terms: Record<string, ReturnType<typeof describe> & { parent?: string }> = {};
    for (const t of [...rise, ...shared, ...single]) terms[t.term] = describe(t);
    for (const t of top) terms[t.term] = t;   // a topic's own description wins
    const { days, by } = this.volume(c.of, c.groups);
    return {
      days: c.days, from: c.from, to: c.to, baselineOk: c.baselineOk,
      groups: c.groups.map((g) => ({ ...g, items: c.items[g.key] ?? 0, prevItems: c.prevItems[g.key] ?? 0, perDay: by[g.key] })),
      ai: this.aiStatus(), filter: this.filterInfo(), boards: this.boards(), board: board?.id ?? '', everyGroup: c.everyGroup, excluded: c.excluded, volumeDays: days, lists: { top: pick(top), rising: pick(rise), shared: pick(shared), single: pick(single) }, terms,
      scored: c.terms.length, steadyHidden: hideSteady ? c.terms.length - pool.length : 0,
    };
  }
  // ---- Signal boards: top-level Signals, each a named set of groups that can be published on its own page
  // ---- Feed pages
  private views(): FeedView[] { return this.getMeta<FeedView[]>('feedViews', []); }
  private cleanView(raw: Record<string, unknown>, prev?: FeedView): FeedView {
    const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!title) throw new Error('give the page a name');
    const slug = String(raw.slug ?? '').trim().toLowerCase() || prev?.slug || slugify(title);
    if (!BOARD_SLUG.test(slug)) throw new Error('address: lowercase letters, digits and dashes, at most 40');
    if (this.views().some((v) => v.slug === slug && v.id !== prev?.id)) throw new Error('another feed page already has that address');
    const source = /^(all|src:(x|rss|hn|youtube)|[fax]:[A-Za-z0-9-]{1,40})$/.test(String(raw.source ?? '')) ? String(raw.source) : 'all';
    const kind = isSource(String(raw.kind ?? '')) ? (String(raw.kind) as SourceKind) : '';
    const int = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.floor(Number(v)) || d));
    return { id: prev?.id ?? crypto.randomUUID().slice(0, 8), slug, title, description: String(raw.description ?? '').trim().slice(0, 300), source, kind,
      show: raw.show === 'top' ? 'top' : 'latest', count: int(raw.count, 1, 50, 12), days: int(raw.days, 1, 30, 7), perSource: raw.perSource === true,
      layout: (VIEW_LAYOUTS as readonly string[]).includes(String(raw.layout)) ? (raw.layout as FeedView['layout']) : 'cards', public: raw.public === true, listed: raw.listed !== false };
  }
  /** Which list a watch belongs to, in the keys a feed page uses (the same as the admin's Sources). */
  private listKey(w: Watch): string {
    if (w.list) return w.list.includes(':') ? w.list : 'f:' + w.list;
    const x = /^list:(\d+)$/.exec(w.query); if (x) return 'x:' + x[1];
    return 'src:' + sourceOf(w);
  }
  /** The items a feed page shows, from the item log (30 days): newest or most reacted, filtered by its source and kind. */
  /** The sources a feed page draws from (briefing sources never). */
  private viewWatches(v: FeedView): Watch[] {
    const fit = (w: Watch) => (v.source === 'all' || (v.source.startsWith('src:') ? sourceOf(w) === v.source.slice(4) : this.listKey(w) === v.source)) && (!v.kind || sourceOf(w) === v.kind);
    return this.watches().filter((w) => !w.briefing && fit(w));
  }
  private viewItems(v: FeedView) {
    const from = dayOf(Date.now() - (v.days - 1) * 86_400_000), watches = new Map(this.watches().filter((w) => !w.briefing).map((w) => [w.id, w] as const));
    const ids = this.viewWatches(v).map((w) => w.id);
    if (!ids.length) return [];
    const rows = this.ctx.storage.sql.exec<{ watch: string; item: string; ts: number; title: string; url: string; by: string; eng: number }>(
      `SELECT watch, item, ts, title, url, by, eng FROM item_log WHERE day >= ? AND watch IN (SELECT value FROM json_each(?)) ORDER BY ${v.show === 'top' ? 'eng DESC, ts DESC' : 'ts DESC'} LIMIT 2000`,
      from, JSON.stringify(ids)).toArray();
    const out: Array<{ title: string; url: string; by: string; source: string; kind: SourceKind; ts: number; reactions: number; video?: string }> = [], seen = new Set<string>();
    for (const r of rows) {
      if (v.perSource && seen.has(r.watch)) continue;
      const w = watches.get(r.watch)!, kind = sourceOf(w), video = kind === 'youtube' ? /[?&]v=([\w-]{11})/.exec(r.url)?.[1] : undefined;
      if (!r.url && !r.title) continue;
      seen.add(r.watch);
      out.push({ title: cleanTitle(r.title, 200), url: r.url, by: r.by.replace(/^@$/, ''), source: w.label, kind, ts: r.ts, reactions: r.eng, ...(video ? { video } : {}) });
      if (out.length >= v.count) break;
    }
    return out;
  }
  private boards(): Board[] {
    if (!this.getMeta('signalBoardsMigrated', false)) {   // groups used to be published one by one: they become one board
      const old = this.getMeta<string[]>('signalPublic', []);
      if (old.length) this.setMeta('signalBoards', [{ id: 'main', slug: 'overview', title: 'Signal', description: '', groups: old, public: true } satisfies Board]);
      this.setMeta('signalBoardsMigrated', true);
    }
    return this.getMeta<Board[]>('signalBoards', []);
  }
  private saveBoards(boards: Board[]): void { this.setMeta('signalBoards', boards); }
  /** A group was renamed (its key changed), merged or deleted: boards follow it. */
  private boardsRekey(from: string, to?: string): void {
    const boards = this.boards();
    if (!boards.some((b) => b.groups.includes(from))) return;
    this.saveBoards(boards.map((b) => ({ ...b, groups: [...new Set(b.groups.flatMap((k) => (k !== from ? [k] : to ? [to] : [])))] })));
  }
  private findBoard(ref: string): Board | undefined { return this.boards().find((b) => b.id === ref || b.slug === ref); }
  private cleanBoard(raw: Record<string, unknown>, prev?: Board): Board {
    const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!title) throw new Error('give the Signal a name');
    const slug = String(raw.slug ?? '').trim().toLowerCase() || prev?.slug || slugify(title);
    if (!BOARD_SLUG.test(slug)) throw new Error('address: lowercase letters, digits and dashes, at most 40');
    if (BOARD_RESERVED.has(slug) || slug.startsWith('admin') || slug.startsWith('custom')) throw new Error('that address is reserved');
    if (this.boards().some((b) => b.slug === slug && b.id !== prev?.id)) throw new Error('another Signal already has that address');
    const groups = [...new Set((Array.isArray(raw.groups) ? raw.groups : []).map((g) => String(g).slice(0, 80)).filter(Boolean))].slice(0, 40);
    const oldSlugs = [...new Set([...(prev && prev.slug !== slug ? [prev.slug] : []), ...(prev?.oldSlugs ?? [])])].filter((x) => x !== slug).slice(0, 10);
    return { id: prev?.id ?? crypto.randomUUID().slice(0, 8), slug, title, description: String(raw.description ?? '').trim().slice(0, 300), groups, public: raw.public === true, proof: raw.proof === true, area: raw.area === undefined ? areaOf(prev) : parseArea(raw.area), ...(oldSlugs.length ? { oldSlugs } : {}) };
  }
  /** The published Signals, for the public rail and index: names only, and only groups that count. */
  private async publicBoards() {
    const live = new Map((await this.groups()).groups.filter((g) => g.weight > 0).map((g) => [g.key, g.name] as const));
    // The first Signal was made at /signal/overview by a migration, before old addresses were remembered: that one is known here.
    return this.boards().filter((b) => b.public).map((b) => ({ slug: b.slug, aliases: [...(b.oldSlugs ?? []), ...(b.id === 'main' && b.slug !== 'overview' ? ['overview'] : [])], title: b.title, description: b.description, proof: b.proof === true, area: areaOf(b), groups: b.groups.map((k) => live.get(k)).filter((n): n is string => !!n) })).filter((b) => b.groups.length);
  }
  /** What the public page may see: group names, weights and counts, and terms. No watch names, addresses, handles or items. */
  private async signalPublic(slug: string, daysIn: number) {
    const board = this.boards().find((b) => b.public && b.slug === slug);
    if (!board) return { groups: [] };
    const c = await this.compute(daysIn, new Set(board.groups));
    const shown = c.groups.filter((g) => g.weight > 0 && (c.items[g.key] ?? 0) > 0);
    if (!shown.length) return { groups: [] };
    const idx = new Map(shown.map((g, i) => [g.key, i] as const)), { days, by } = this.volume(c.of, shown), pool = c.terms.filter(notSteady);
    const { top, describe } = this.describeTopics({ ...c, groups: shown }, pool, 30);
    // Terms and what goes with them, never the items themselves.
    const out = (t: ScoredTerm & { parent?: string; label?: string; related?: string[]; members?: string[]; reactions?: number; headlines?: Array<{ title: string; url: string; by: string; reactions?: number }> }) => ({ term: t.term, ...(t.parent ? { parent: t.parent } : {}), label: t.label ?? t.term, related: t.related ?? [], members: t.members ?? [], signal: t.signal, change: t.change, isNew: t.isNew, kind: t.kind, breadth: t.breadth, active: t.active,
      top: idx.get(t.topGroup) ?? 0, parts: shown.map((g) => t.groups.find((x) => x.key === g.key)?.part ?? 0), shares: shown.map((g) => t.groups.find((x) => x.key === g.key)?.share ?? 0),
      // Items are shown only on a Signal that has sources switched on (its proof pages show them too).
      reactions: t.reactions ?? 0,
      ...(board.proof ? { headlines: (t.headlines ?? []).slice(0, 1).map((h) => ({ title: h.title, url: h.url, by: h.by, reactions: h.reactions ?? 0 })) } : {}) });
    return {
      slug: board.slug, title: board.title, description: board.description, proof: board.proof === true, ai: this.tables().ai,
      days: c.days, from: c.from, to: c.to, baselineOk: c.baselineOk, volumeDays: days, steadyHidden: c.terms.length - pool.length,
      groups: shown.map((g) => ({ name: g.name, weight: g.weight, items: c.items[g.key] ?? 0, perDay: by[g.key] })),
      top: top.map(out), rising: rising(c.terms, 10).map((t) => out(describe(t))),
      shared: pool.filter((t) => t.kind === 'shared').slice(0, 10).map((t) => out(describe(t))), single: pool.filter((t) => t.kind === 'single').slice(0, 10).map((t) => out(describe(t))),
    };
  }
  private async signalTerm(term: string) {
    const { of, groups } = await this.groups(), { days, by } = this.volume(of, groups);
    const docs: Record<string, number[]> = Object.fromEntries(groups.map((g) => [g.key, days.map(() => 0)]));
    for (const r of this.ctx.storage.sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${this.tables().terms} WHERE term IN (SELECT value FROM json_each(?)) AND day >= ?`, JSON.stringify(this.namesOf(term)), days[0])) {
      const g = of.get(r.watch), i = days.indexOf(r.day);
      if (g && i >= 0) docs[g][i] += r.n;
    }
    // A few recent items that mention it. The feed holds the latest items only, so older mentions are counted but not shown.
    const samples: unknown[] = [], ai = this.aiTopics(days[0]), aliasT = this.aliasFn();
    for (const r of this.ctx.storage.sql.exec<{ watch: string; label: string; seen_at: number; json: string; source: string }>('SELECT watch, label, seen_at, json, source FROM feed ORDER BY seq DESC LIMIT 2000')) {
      const tweet = JSON.parse(r.json) as { id?: string; text?: string; feed?: string; feedUrl?: string };
      if (!(ai ? ai.get(`${r.watch}\n${tweet.id}`) ?? [] : extractTerms(String(tweet.text ?? ''))).some((t) => aliasT(t) === term)) continue;
      if (r.source !== 'x') tweet.feed ??= r.label;
      samples.push({ watchId: r.watch, group: of.get(r.watch) ?? '', label: r.label, seenAt: r.seen_at, source: r.source, tweet });
      if (samples.length >= 12) break;
    }
    return { term, days, groups: groups.map((g) => ({ key: g.key, name: g.name, docs: docs[g.key], items: by[g.key] })), samples };
  }
  /**
   * The proof for a topic: every logged item in the window that mentions one of its terms, with the sources and groups they come from.
   * `filter` narrows the list (and only the list) to one group or one source; the counts always cover the whole window.
   */
  private async signalItems(q: { terms: string[]; days: number; group: string; watch: string; offset: number; limit: number; only?: Set<string>; /** Also give every matching item (for the topic page's evidence), not just the page asked for. */ all?: boolean }) {
    const days = Math.min(SIGNAL_MAX_DAYS, Math.max(1, Math.floor(q.days) || 7)), now = Date.now();
    const from = dayOf(now - (days - 1) * 86_400_000), to = dayOf(now);
    const { of, groups } = await this.groups(), names = new Map(groups.map((g) => [g.key, g.name] as const));
    const labels = new Map(this.watches().map((w) => [w.id, w.label] as const)), ai = this.aiTopics(from);
    const alias = this.aliasFn(), want = new Set(q.terms.map((t) => alias(t.toLowerCase().trim())).filter(Boolean));
    if (!want.size) throw new Error('term required');
    const rows = this.ctx.storage.sql.exec<{ watch: string; item: string; ts: number; title: string; url: string; disc: string; by: string; match: string; eng: number; likes: number; replies: number; views: number }>(
      'SELECT watch, item, ts, title, url, disc, by, match, eng, likes, replies, views FROM item_log WHERE day >= ? AND day <= ? ORDER BY ts DESC LIMIT 8000', from, to).toArray();
    const hits: Array<{ watch: string; item: string; group: string; ts: number; title: string; url: string; disc: string; by: string; match: string; eng: number; likes: number; replies: number; views: number; matched: string[] }> = [];
    for (const r of rows) {
      const g = of.get(r.watch); if (!g || (q.only && !q.only.has(g))) continue;
      const have = new Set((ai ? ai.get(`${r.watch}\n${r.item}`) ?? [] : extractTerms(r.match)).map(alias));
      const matched = [...want].filter((t) => have.has(t));
      if (matched.length) hits.push({ watch: r.watch, item: r.item, group: g, ts: r.ts, title: r.title, url: r.url, disc: r.disc, by: r.by, match: r.match, eng: r.eng, likes: r.likes, replies: r.replies, views: r.views, matched });
    }
    const tally = <K extends string>(key: (h: (typeof hits)[number]) => K) => { const m = new Map<K, number>(); for (const h of hits) m.set(key(h), (m.get(key(h)) ?? 0) + 1); return m; };
    const byGroup = tally((h) => h.group), byWatch = tally((h) => h.watch);
    const shown = hits.filter((h) => (!q.group || h.group === q.group) && (!q.watch || h.watch === q.watch));
    const limit = Math.min(50, Math.max(1, Math.floor(q.limit) || 20)), offset = Math.max(0, Math.floor(q.offset) || 0);
    return {
      terms: [...want], from, to, total: hits.length, shown: shown.length, truncated: rows.length >= 8000,
      groups: [...byGroup].map(([key, n]) => ({ key, name: names.get(key) ?? key, n })).sort((a, b) => b.n - a.n),
      sources: [...byWatch].map(([watch, n]) => ({ watch, label: labels.get(watch) ?? watch, group: of.get(watch) ?? '', n })).sort((a, b) => b.n - a.n).slice(0, 30),
      items: shown.slice(offset, offset + limit).map((h) => ({ watch: h.watch, label: labels.get(h.watch) ?? h.watch, group: h.group, ts: h.ts, title: cleanTitle(h.title, 200), url: h.url, discussionUrl: h.disc, by: h.by, reactions: h.eng, matched: h.matched,
        snippet: h.match.replace(/\s+/g, ' ').trim() === h.title ? '' : h.match.replace(/\s+/g, ' ').slice(0, 260) })),
      more: offset + limit < shown.length,
      ...(q.all ? { hits: hits.map((h) => ({ watch: h.watch, item: h.item, matched: h.matched, label: labels.get(h.watch) ?? h.watch, ts: h.ts, title: cleanTitle(h.title, 200), url: h.url, discussionUrl: h.disc, by: h.by, likes: h.likes, replies: h.replies, views: h.views })) } : {}),
    };
  }
  /** Who Said It First (src/signal/first.ts): the order Signal's topics reached the groups in, and which groups tend to be early. Briefing posts are left out, because they are written from the other sources. */
  private async whoSaidFirst(daysIn: number, boardRef = '') {
    const board = boardRef ? this.findBoard(boardRef) : undefined;
    if (boardRef && !board) throw new Error('unknown Signal');
    const c = await this.compute(daysIn, board && new Set(board.groups)), DAY = 86_400_000, now = Date.now();
    const listening = new Set(c.groups.filter((g) => g.weight > 0).map((g) => g.key));
    const watches = this.watches().filter((w) => !w.briefing && listening.has(c.of.get(w.id) ?? '')), labels = new Map(watches.map((w) => [w.id, w.label] as const));
    const since: Record<string, number> = {};
    for (const w of watches) { const g = c.of.get(w.id)!; since[g] = Math.min(since[g] ?? Infinity, watchStartMs(w.created)); }

    // Read back far enough to know that the start of the window was really quiet.
    const readFrom = dayOf(now - (c.days - 1) * DAY - QUIET_MS), rows = this.ctx.storage.sql.exec<{ watch: string; item: string; ts: number; title: string; url: string; by: string; match: string }>(
      `SELECT watch, item, ts, title, url, by, match FROM item_log WHERE day >= ? ORDER BY ts DESC LIMIT ${FIRST_MAX_ITEMS}`, readFrom).toArray();
    const pool = c.terms.filter((t) => !t.evergreen).slice(0, 150), known = new Set(pool.map((t) => t.term));
    const ai = this.aiTopics(readFrom), alias = this.aliasFn(), boiler = this.boilerplate(c.from, c.to), items: FirstItem[] = [];
    for (const r of rows) {
      if (!labels.has(r.watch)) continue;
      const terms = new Set((ai ? ai.get(`${r.watch}\n${r.item}`) ?? [] : extractTerms(r.match)).filter((t) => !boiler.has(`${r.watch}\n${t}`)).map((t) => foldTerm(alias(t), known)).filter(Boolean));
      if (terms.size) items.push({ terms, ts: r.ts, group: c.of.get(r.watch)!, watch: r.watch, title: cleanTitle(r.title, 140), url: r.url, by: r.by });
    }
    const topics = mergeTopics(pool, indexItems(items), 60).map((cl) => ({ label: cl.label, terms: cl.members.map((m) => m.term) }));
    const historyStart = rows.length ? rows[rows.length - 1].ts : now;
    const { waves, skipped, dateOnly } = findWaves(topics, items, { from: Date.parse(c.from + 'T00:00:00Z'), historyStart, since });
    const compared = c.groups.filter((g) => since[g.key] !== undefined), scores = new Map(scoreFirsts(waves, compared.map((g) => g.key)).map((s) => [s.key, s] as const));
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      days: c.days, from: c.from, to: c.to, board: board?.id ?? '', boards: this.boards().map((b) => ({ id: b.id, title: b.title })), ai: !!ai,
      groups: compared.map((g) => { const s = scores.get(g.key)!; return { key: g.key, name: g.name, joined: s.joined, first: round(s.first), expected: round(s.expected), medianLag: s.medianLag, verdict: s.verdict }; }),
      waves: rankWaves(waves).slice(0, 30).map((w) => ({ ...w, arrivals: w.arrivals.map(({ watch, ...a }) => ({ ...a, source: labels.get(watch) ?? '' })) })),
      totalWaves: waves.length, checked: topics.length, skipped, dateOnly, truncated: rows.length >= FIRST_MAX_ITEMS,
    };
  }
  /**
   * The proof the public page shows for one topic of a published Signal that has switched it on: titles, links, sources and dates of the items
   * (never their text), from that Signal's groups only. Null when the Signal is not public or does not show sources.
   */
  private async signalPublicItems(slug: string, term: string, daysIn: number) {
    const board = this.boards().find((b) => b.public && b.proof === true && b.slug === slug);
    if (!board) return null;
    const only = new Set(board.groups), c = await this.compute(daysIn, only);
    const topic = this.describeTopics(c, c.terms.filter(notSteady), 40).top.find((t) => t.term === term);
    const terms = topic ? [topic.term, ...topic.members] : [term];
    const r = await this.signalItems({ terms, days: c.days, group: '', watch: '', offset: 0, limit: 50, only });
    return { slug: board.slug, title: board.title, days: c.days, term, label: topic?.label ?? term, terms: r.terms, from: r.from, to: r.to, total: r.total,
      groups: r.groups.map((g) => ({ name: g.name, n: g.n })), sources: r.sources.map((x) => ({ label: x.label, group: this.groupName(r.groups, x.group), n: x.n })).slice(0, 15),
      items: r.items.map((i) => ({ title: i.title, url: i.url, discussionUrl: i.discussionUrl, source: i.label, by: i.by, group: this.groupName(r.groups, i.group), ts: i.ts })) };
  }
  /**
   * One topic of a published Signal, for its own public page: its numbers, where it shows up, how it moved day by day, what goes with it and, only when
   * the Signal shows its sources, the items behind it. Null when the Signal is not public or the topic is not in it.
   */
  private async signalPublicTopic(slug: string, term: string, daysIn: number) {
    const board = this.boards().find((b) => b.public && b.slug === slug);
    if (!board) return null;
    const c = await this.compute(daysIn, new Set(board.groups));
    const shown = c.groups.filter((g) => g.weight > 0 && (c.items[g.key] ?? 0) > 0);
    if (!shown.length) return null;
    const { top, describe } = this.describeTopics({ ...c, groups: shown }, c.terms.filter(notSteady), 40);
    let topic = top.find((t) => t.term === term || t.members.includes(term));
    if (!topic) { const raw = c.terms.find((t) => t.term === term); if (!raw) return null; topic = describe(raw) as (typeof top)[number]; }
    const T = this.tables(), sql = this.ctx.storage.sql, days: string[] = [];
    for (let ms = Date.parse(c.from + 'T00:00:00Z'); ms <= Date.parse(c.to + 'T00:00:00Z'); ms += 86_400_000) days.push(dayOf(ms));
    const gi = new Map(shown.map((g, i) => [g.key, i] as const)), docs = shown.map(() => days.map(() => 0)), items = shown.map(() => days.map(() => 0));
    for (const r of sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${T.terms} WHERE term IN (SELECT value FROM json_each(?)) AND day >= ? AND day <= ?`, JSON.stringify(this.namesOf(topic.term)), c.from, c.to)) {
      const g = gi.get(c.of.get(r.watch) ?? ''), d = days.indexOf(r.day); if (g !== undefined && d >= 0) docs[g][d] += r.n;
    }
    for (const r of sql.exec<{ day: string; watch: string; n: number }>(`SELECT day, watch, n FROM ${T.items} WHERE day >= ? AND day <= ?`, c.from, c.to)) {
      const g = gi.get(c.of.get(r.watch) ?? ''), d = days.indexOf(r.day); if (g !== undefined && d >= 0) items[g][d] += r.n;
    }
    const known = new Set(c.terms.map((t) => t.term));
    const out: Record<string, unknown> = {
      slug: board.slug, title: board.title, proof: board.proof === true, days: c.days, from: c.from, to: c.to, baselineOk: c.baselineOk,
      term: topic.term, label: topic.label, members: topic.members, signal: topic.signal, change: topic.change, isNew: topic.isNew, kind: topic.kind, breadth: topic.breadth, active: topic.active,
      reactions: topic.reactions, related: (topic.related ?? []).filter((r: string) => known.has(r)),
      groups: shown.map((g, i) => ({ name: g.name, weight: g.weight, items: c.items[g.key] ?? 0, part: topic!.groups.find((x) => x.key === g.key)?.part ?? 0, share: topic!.groups.find((x) => x.key === g.key)?.share ?? 0,
        docs: topic!.groups.find((x) => x.key === g.key)?.docs ?? 0, perDay: docs[i], perDayItems: items[i] })),
      days_: days,
    };
    if (board.proof) {
      const r = await this.signalItems({ terms: [topic.term, ...topic.members], days: c.days, group: '', watch: '', offset: 0, limit: 50, only: new Set(board.groups) });
      out.total = r.total;
      out.sources = r.sources.map((x) => ({ label: x.label, group: this.groupName(r.groups, x.group), n: x.n })).slice(0, 15);
      out.items = r.items.map((i) => ({ title: i.title, url: i.url, discussionUrl: i.discussionUrl, source: i.label, by: i.by, group: this.groupName(r.groups, i.group), ts: i.ts, reactions: i.reactions }));
    }
    return out;
  }
  private groupName(groups: Array<{ key: string; name: string }>, key: string): string { return groups.find((g) => g.key === key)?.name ?? ''; }
  private async signalGroup(key: string, daysIn: number) {
    const c = await this.compute(daysIn), g = c.groups.find((x) => x.key === key);
    if (!g) throw new Error('unknown group');
    const own = (t: (typeof c.terms)[number]) => t.groups.find((x) => x.key === key)?.share ?? 0;
    const strongest = c.terms.filter((t) => (t.groups.find((x) => x.key === key)?.docs ?? 0) >= 3).sort((a, b) => own(b) - own(a)).slice(0, 15);
    return { key, name: g.name, weight: g.weight, items: c.items[key] ?? 0, watches: g.watches, active: c.active.some((a) => a.key === key),
      strongest: strongest.map((t) => ({ term: t.term, docs: t.groups.find((x) => x.key === key)?.docs ?? 0, share: own(t), kind: t.kind, breadth: t.breadth, active: t.active })),
      distinctive: distinctive(c.terms, key, 15).map((t) => ({ term: t.term, docs: t.groups.find((x) => x.key === key)?.docs ?? 0, own: t.own, others: t.others, lift: t.lift })) };
  }

  // ---- The topic page /t/<slug> (src/signal/topicpage.ts): one topic of the published Signals, the one data set behind the page, /t/<slug>.json and later the MCP tool
  /** A published Signal over its last 7 days, kept for two minutes: the lookup of an address, the page and the summaries all start here. */
  private async boardView(board: Board, days: 1 | 3 | 7 = 7): Promise<BoardView> {
    const k = `bv|${board.slug}${days === 7 ? '' : '|' + days}`, hit = this.pubCache.get(k);
    if (hit && Date.now() - hit.at < 120_000) return hit.v as BoardView;
    const c = await this.compute(days, new Set(board.groups));
    const shown = c.groups.filter((g) => g.weight > 0 && (c.items[g.key] ?? 0) > 0), bySlug = new Map<string, ScoredTerm>();
    for (const t of c.terms) { const sl = topicSlug(t.term); if (!bySlug.has(sl)) bySlug.set(sl, t); }   // strongest first: when two names share an address, the stronger holds it
    const v: BoardView = { board, c, shown, bySlug };
    this.pubCache.set(k, { at: Date.now(), v });
    return v;
  }
  private boardTop(v: BoardView): NonNullable<BoardView['top']> { return (v.top ??= this.describeTopics({ ...v.c, groups: v.shown }, v.c.terms.filter(notSteady), 40)); }
  /** A topic by its address. If it is in several published Signals, the page takes the one where its score is highest and lists the others. */
  /** `hint`: the area a link came from. The same address can exist on boards in both areas: the hinted area wins, else AI, and the other one is listed in `alsoIn`. */
  private async findTopic(slug: string, hint: Area | null = null) {
    const found: Array<{ v: BoardView; raw: ScoredTerm }> = [];
    // The week first; a topic of the front page's shorter windows (today, 3 days) that the week does not have is looked for there, so its link never ends on "not found".
    for (const days of [7, 3, 1] as const) {
      for (const b of this.boards().filter((x) => x.public)) {
        const v = await this.boardView(b, days), raw = v.shown.length ? v.bySlug.get(slug) : undefined;
        if (raw) found.push({ v, raw });
      }
      if (found.length) break;
    }
    const order = rankByArea(found.map((f) => ({ area: areaOf(f.v.board), signal: f.raw.signal })), hint), ranked = order.map((i) => found[i]);
    const best = ranked[0];
    if (!best) return null;
    const { top, describe } = this.boardTop(best.v);
    const topic = top.find((t) => t.term === best.raw.term || t.members.includes(best.raw.term)) ?? describe(best.raw);   // a name counted under a bigger topic opens that topic
    return { v: best.v, topic, alsoIn: ranked.slice(1).map((f) => ({ slug: f.v.board.slug, title: f.v.board.title, area: areaOf(f.v.board) })) };
  }
  /** The items behind a topic over the last 14 days (every kind of source), with the numbers each source gave. Briefing posts are left out of the evidence: they were written from the other sources. */
  private async topicItems(v: BoardView, names: string[]) {
    const r = await this.signalItems({ terms: names, days: 14, group: '', watch: '', offset: 0, limit: 1, only: new Set(v.board.groups), all: true });
    const watches = new Map(this.watches().map((w) => [w.id, w] as const)), from = Date.parse(v.c.from + 'T00:00:00Z');
    const hits = r.hits ?? [], items: EvItem[] = [], wide: EvItem[] = [], meta = new Map<EvItem, { watch: string; item: string; matched: string[] }>();
    for (const h of hits) {
      const w = watches.get(h.watch);
      if (!w || w.briefing || sourceOf(w) === 'arxiv') continue;   // papers have their own angle
      const id = itemId(h.url), item: EvItem = { ...(id ? { id } : {}), kind: sourceOf(w) as EvKind, by: h.by, source: h.label, title: h.title, url: h.url, discussionUrl: h.discussionUrl, ts: h.ts, likes: h.likes, replies: h.replies, views: h.views };
      meta.set(item, { watch: h.watch, item: h.item, matched: h.matched });   // for the source card: which item of the log it is
      wide.push(item);   // all 14 days: the timeline and who had it first need the quiet before a wave
      if (h.ts >= from) items.push(item);
    }
    return { hits, items, wide, meta };
  }
  /** New papers (last 30 days) that are about the subject: its name in the title, or, for a name of two words or more, in the abstract. With who is paying attention to each. Abstracts only: full text is never read. */
  private topicPapers(names: string[]) {
    const words = [...new Set(names.map((n) => n.toLowerCase().trim()).filter((n) => n.length >= 3))].slice(0, 6);
    if (!words.length) return { matched: 0, mentioned: 0, list: [] as TopicPaper[] };
    const like = (w: string) => '%' + w.replace(/[%_\\]/g, '') + '%', sql = this.ctx.storage.sql;
    type Row = { id: string; published: number; title: string; authors: string; cats: string; abstract: string; signals: string };
    const rows = sql.exec<Row>(`SELECT id, published, title, authors, cats, abstract, signals FROM research_papers WHERE published >= ? AND (${words.map(() => '(lower(title) LIKE ? OR lower(abstract) LIKE ?)').join(' OR ')}) ORDER BY published DESC LIMIT 300`,
      Date.now() - 30 * 86_400_000, ...words.flatMap((w) => [like(w), like(w)])).toArray();
    const whole = words.map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u'));
    const topics = new Map(this.pulseTopics().map((t) => [t.id, t] as const));
    const hits = rows.map((r) => {
      const inTitle = whole.some((re) => re.test(r.title.toLowerCase())), inAbstract = words.some((w, i) => w.includes(' ') && whole[i].test(r.abstract.toLowerCase()));
      if (!inTitle && !inAbstract) return null;
      const authors = JSON.parse(r.authors) as string[], a = attentionOf(JSON.parse(r.signals) as PaperSignals, authors);
      const also = sql.exec<{ topic: string }>('SELECT topic FROM research_topic_papers WHERE paper = ?', r.id).toArray().map((x) => topics.get(x.topic)).filter((t): t is PulseTopic => !!t).map((t) => ({ slug: t.slug, title: t.title }));
      const paper: TopicPaper = { id: r.id, published: r.published, title: r.title, authors, categories: JSON.parse(r.cats) as string[], abstract: r.abstract, absUrl: `https://arxiv.org/abs/${r.id}`, pdfUrl: `https://arxiv.org/pdf/${r.id}`, also,
        attention: { top: a.top, hf: a.hf, hn: a.hn, mentions: a.mentions.slice(0, 5).map(({ by, url, reactions }) => ({ by, url, reactions })), accounts: a.mentions.length } };
      return { paper, inTitle, score: a.score, talked: !!(a.hf || a.hn || a.mentions.length) };
    }).filter((x): x is NonNullable<typeof x> => !!x);
    hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.score - a.score || b.paper.published - a.paper.published);
    return { matched: hits.length, mentioned: hits.filter((h) => h.talked).length, list: hits.slice(0, 12).map((h) => h.paper) };
  }
  /** Everything the topic page shows, apart from the briefings (those live in the Publish object; src/site/topicData.ts adds them). Null when no published Signal has the topic. */
  private async topicData(slug: string, hint: Area | null = null, brush: BrushAsk = {}): Promise<TopicData | null> {
    const found = await this.findTopic(slug, hint);
    if (!found) return null;
    const { v, topic, alsoIn } = found, { board, c } = v, proof = board.proof === true, names = [topic.term, ...topic.members], canonical = topicSlug(topic.term);
    const { hits, items, wide, meta } = await this.topicItems(v, names), now = Date.now();
    const days = Array.from({ length: 14 }, (_, i) => dayOf(now - (13 - i) * 86_400_000)), counts = days.map(() => 0);
    for (const h of hits) { const d = days.indexOf(dayOf(h.ts)); if (d >= 0) counts[d]++; }
    const papers = this.topicPapers(names), segments = evidenceSegments(items, papers, proof), state = topicState(topic);
    const heatDays = Array.from({ length: HEAT_DAYS }, (_, i) => dayOf(now - (HEAT_DAYS - 1 - i) * 86_400_000)), boardGroups = new Set(board.groups), { of: groupOf } = await this.groups();
    const heat = { days: heatDays, counts: this.dailyCounts([...new Set(names.flatMap((x) => this.namesOf(x)))], (w) => boardGroups.has(groupOf.get(w) ?? ''), heatDays) };
    const byKind: TopicData['counts'] = {};
    for (const i of items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
    // A5: the Talk list narrowed to a day and a kind and ordered as asked, each kind within itself (src/signal/brush.ts). The day must be one the items cover (from the start of the window).
    const pr = this.prismOut(board.slug, canonical, items, meta, proof);
    const view = parseBrush(brush, days.filter((d) => d >= c.from), DEFAULT_SORT, pr ? pr.out.groups.map((g) => g.id) : []);
    const pool = view.conv ? items.filter((i) => i.id && pr!.of.get(i.id) === view.conv) : items, brushed = brushItems(pool, view, view.day || view.kind || view.conv ? TALK_CAP_NARROW : TALK_CAP);
    const talk = !proof ? [] : brushed.items
      .map((i) => ({ ...(i.id ? { id: i.id } : {}), kind: i.kind, title: i.title, url: i.url, discussionUrl: i.discussionUrl, source: i.source, by: i.by, ts: i.ts, ...(i.likes >= 0 ? { likes: i.likes } : {}), ...(i.replies >= 0 ? { replies: i.replies } : {}), ...(i.views > 0 ? { views: i.views } : {}) }));
    const sm = this.ctx.storage.sql.exec<{ day: string; text: string; items: string; n: number; model: string }>('SELECT day, text, items, n, model FROM topic_summary WHERE slug = ? ORDER BY day DESC LIMIT 1', canonical).toArray()[0];
    const summary = sm && summaryFresh(sm.day) ? { text: sm.text, day: sm.day, model: sm.model, itemCount: sm.n, items: proof ? (JSON.parse(sm.items) as NonNullable<TopicData['summary']>['items']) : [] } : null;
    const top = this.boardTop(v).top, seen = new Set([canonical]), related: TopicData['related'] = [];
    for (const r of topic.related ?? []) {
      if (!v.bySlug.has(topicSlug(r))) continue;
      const lead = top.find((t) => t.term === r || t.members.includes(r)), rs = topicSlug(lead?.term ?? r);
      if (seen.has(rs)) continue;
      seen.add(rs);
      // A4, the neighbours strip: state, 14 days of mentions and one line, from the same tables (a cheap count and the stored summary, no item scan).
      const brief = lead ? await this.topicBrief(v, lead, rs, areaOf(board), groupOf) : null;
      related.push({ slug: rs, label: lead?.label ?? r, ...(brief ? { state: brief.state, days: brief.days, counts: brief.counts, line: brief.line } : {}) });
      if (related.length >= 6) break;
    }
    return {
      slug: canonical, term: topic.term, label: topic.label, members: topic.members, board: { slug: board.slug, title: board.title, proof }, area: areaOf(board), alsoIn,
      days: c.days, from: c.from, to: c.to, baselineOk: c.baselineOk,
      state, signal: topic.signal, change: topic.change, isNew: topic.isNew, kind: topic.kind, breadth: topic.breadth, active: topic.active, reactions: topic.reactions,
      series: { days, counts, usual: usualLevel(counts) }, counts: byKind, total: items.length, evidence: segments,
      summary, fallback: fallbackSummary({ label: topic.label, state, total: items.length, days: c.days, segments, groups: v.shown.length }),
      talk, view: { ...view, counts: proof ? brushed.counts : {} }, prism: pr?.out ?? null, papers, related,
      // Step 7: the order the kinds of source had it in, items over time, and videos. Titles and links only on a Signal that shows its sources.
      first: firstByKind(wide, { since: now - 14 * 86_400_000, hide: !proof }), timeline: timelineDots(wide, { from: now - 14 * 86_400_000, to: now, hide: !proof }),
      watch: this.topicWatch(wide, names, proof), heat,
    };
  }
  /** The small card of a topic (state, 14 days of mentions, one line): for the related topics of a page and for /t/<slug>/peek. Counts are the terms table's (as the heat calendar's), the line the stored summary's first sentence or one made from the numbers. */
  private async topicBrief(v: BoardView, t: { term: string; label: string; members: string[]; change: number | null; isNew: boolean }, slug: string, area: Area, groups?: Map<string, string>): Promise<TopicBrief> {
    const now = Date.now(), days = Array.from({ length: 14 }, (_, i) => dayOf(now - (13 - i) * 86_400_000)), boardGroups = new Set(v.board.groups), groupOf = groups ?? (await this.groups()).of;
    const counts = this.dailyCounts([...new Set([t.term, ...t.members].flatMap((x) => this.namesOf(x)))], (w) => boardGroups.has(groupOf.get(w) ?? ''), days), state = topicState(t);
    const sm = this.ctx.storage.sql.exec<{ day: string; text: string }>('SELECT day, text FROM topic_summary WHERE slug = ? ORDER BY day DESC LIMIT 1', slug).toArray()[0];
    const line = (sm && summaryFresh(sm.day) ? oneLine(sm.text) : '') || numbersLine(t.label, state, counts);
    return { slug, label: t.label, area, state, days, counts, line };
  }
  /** One topic's small card by address, for /t/<slug>/peek. Null when no published Signal has it. */
  private async topicPeek(slug: string, hint: Area | null): Promise<TopicBrief | null> {
    const found = await this.findTopic(slug, hint);
    return found ? this.topicBrief(found.v, found.topic, topicSlug(found.topic.term), areaOf(found.v.board)) : null;
  }
  /** Videos and talks on a topic: the Signal's YouTube items (when it shows its sources) and matches from the public feed pages, which are public whatever the Signal shows. */
  private topicWatch(wide: EvItem[], names: string[], proof: boolean): TopicWatch[] {
    const own = proof ? wide.filter((i) => i.kind === 'youtube' && i.url).map((i) => ({ title: i.title, url: i.url, source: i.source, by: i.by, ts: i.ts, ...(i.views > 0 ? { views: i.views } : {}) })) : [];
    const feeds = this.views().filter((x) => x.public).flatMap((v) => this.viewItems({ ...v, count: 150, show: 'top', days: 14, perSource: false }).filter((i) => i.url).map((i) => ({ via: v.title, title: i.title, url: i.url, source: i.source, by: i.by, ts: i.ts, reactions: i.reactions, video: i.video })));
    return pickWatch(own, feeds, names);
  }

  /**
   * The source card of one item of a topic (src/signal/sourcecard.ts): the item with its place among the topic's items, the names it matched, the copies folded into it and the other topics it is in.
   * Only items the topic page may show: from a Signal that shows its sources, and videos from public feed pages. `gone`: the item is in the log but no longer in the topic (or the window), and the card then
   * only leads to the original. `found: false`: no such topic, or an id nobody can tell is real. Read only.
   */
  private async topicCard(slug: string, id: string, hint: Area | null) {
    if (!ITEM_ID.test(id)) return { found: false as const };
    const found = await this.findTopic(slug, hint);
    if (!found) return { found: false as const };
    const { v, topic } = found, canonical = topicSlug(topic.term), proof = v.board.proof === true, area = areaOf(v.board), names = [topic.term, ...topic.members];
    if (slug !== canonical) return { found: true as const, redirect: canonical, area };
    const t: CardTopic = { slug: canonical, label: topic.label, term: topic.term, members: topic.members, area, board: { slug: v.board.slug, title: v.board.title } };
    const { wide, meta } = proof ? await this.topicItems(v, names) : { wide: [] as EvItem[], meta: new Map<EvItem, { watch: string; item: string; matched: string[] }>() };
    const pool: EvItem[] = [...wide];
    for (const w of this.topicWatch(wide, names, proof)) if (w.id && !pool.some((i) => i.id === w.id)) pool.push({ id: w.id, kind: 'youtube', by: w.by, source: w.source, title: w.title, url: w.url, discussionUrl: '', ts: w.ts, likes: -1, replies: -1, views: w.views ?? -1 });
    const item = inTimeOrder(pool).find((i) => i.id === id);
    const sql = this.ctx.storage.sql;
    if (!item) {   // in the log of this Signal's groups, but not in the topic now: the card is gone, the original is not
      if (!proof) return { found: false as const };
      const { of } = await this.groups(), groups = new Set(v.board.groups), plain = new Set(this.watches().filter((w) => !w.briefing && sourceOf(w) !== 'arxiv').map((w) => w.id));
      for (const r of sql.exec<{ watch: string; url: string; disc: string }>('SELECT watch, url, disc FROM item_log WHERE day >= ? ORDER BY ts DESC LIMIT 20000', dayOf(Date.now() - SIGNAL_KEEP_DAYS * 86_400_000))) {
        if (itemId(r.url) === id && plain.has(r.watch) && groups.has(of.get(r.watch) ?? '')) return { found: true as const, gone: true as const, topic: t, original: r.url, discussionUrl: r.disc };
      }
      return { found: false as const };
    }
    const m = meta.get(item), extras: { matched?: string[]; copies?: number | null; alsoIn?: Array<{ slug: string; label: string }> } = { matched: m?.matched ?? [] };
    if (m) {
      const key = `${m.watch}\n${m.item}`;
      // Said the same: the copies the meaning step folded into this post. Only known for an item that was read for its meaning (it has a vector).
      if (sql.exec('SELECT 1 FROM item_vec WHERE watch = ? AND item = ?', m.watch, m.item).toArray().length) extras.copies = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM item_vec WHERE copy = ?', key).one().n;
      // Also in: the other topics whose names the item was read to have.
      const row = sql.exec<{ day: string; match: string }>('SELECT day, match FROM item_log WHERE watch = ? AND item = ?', m.watch, m.item).toArray()[0];
      if (row) {
        const ai = this.aiTopics(row.day), alias = this.aliasFn(), have = new Set((ai ? ai.get(key) ?? [] : extractTerms(row.match)).map(alias)), seen = new Set([canonical]), also: Array<{ slug: string; label: string }> = [];
        for (const o of this.boardTop(v).top) {
          const sl = topicSlug(o.term);
          if (o.parent || seen.has(sl) || ![o.term, ...o.members].some((x) => have.has(alias(x)))) continue;
          seen.add(sl); also.push({ slug: sl, label: o.label });
        }
        extras.alsoIn = also.slice(0, 6);
      }
    }
    return { found: true as const, card: buildCard(pool, id, t, extras) as SourceCard };
  }

  // ---- Topic summaries: a model writes one paragraph per active topic per day. Run from the alarm, never from a page request.
  /** The addresses of the topics worth a summary: the strongest of each published Signal (not the parts of a bigger topic), at most SUMMARY_TOPICS in all. */
  private async activeTopics(): Promise<string[]> {
    const out: string[] = [], seen = new Set<string>();
    for (const b of this.boards().filter((x) => x.public)) {
      const v = await this.boardView(b);
      if (!v.shown.length) continue;
      let n = 0;
      for (const t of this.boardTop(v).top) {
        const sl = topicSlug(t.term);
        if (t.parent || seen.has(sl)) continue;
        if (n++ >= SUMMARY_PER_BOARD) break;
        seen.add(sl); out.push(sl);
      }
    }
    return out.slice(0, SUMMARY_TOPICS);
  }
  // ---- Lenses (src/signal/lens.ts): areas of interest the public pages order and highlight by. Stored in `meta` as { area: Lens[] }; an area that was never saved gets its starting lenses once.
  private lenses(area: LensArea): Lens[] {
    const all = this.getMeta<Partial<Record<LensArea, Lens[]>>>('lenses', {});
    if (all[area]) return all[area]!;
    all[area] = seedLenses(area);   // deleting every lens leaves an empty list, which is kept (it is not seeded again)
    this.setMeta('lenses', all);
    return all[area]!;
  }
  private saveLenses(area: LensArea, list: Lens[]): void { this.setMeta('lenses', { ...this.getMeta<Partial<Record<LensArea, Lens[]>>>('lenses', {}), [area]: list }); }
  /**
   * Asks the Signal topic model which of the current Signal topics belong to which lens. Started by the admin only, never by a public request. Nothing is saved: the admin accepts or changes the answer.
   * Stays inside the day's AI spending cap and is recorded in Costs as "Lens suggestions (AI)".
   */
  private async suggestLenses(area: LensArea) {
    const cfg = this.aiConfig(), lenses = this.lenses(area);
    if (!lenses.length) throw new Error('there are no lenses yet');
    if (!cfg.enabled || !cfg.model) throw new Error('turn on topic detection by a model first: the same model suggests the lenses');
    if (this.aiSpend().cost >= cfg.dailyCap) throw new Error('the daily spending cap is reached; try again tomorrow');
    const topics: Array<{ term: string; label: string; signal: number }> = [], seen = new Set<string>();
    for (const b of this.boards().filter((x) => x.public && areaOf(x) === area)) {
      const v = await this.boardView(b);
      if (!v.shown.length) continue;
      for (const t of this.boardTop(v).top) if (!t.parent && !seen.has(t.term)) { seen.add(t.term); topics.push({ term: t.term, label: t.label ?? t.term, signal: t.signal }); }
    }
    topics.sort((a, b) => b.signal - a.signal);
    const list = topics.slice(0, SUGGEST_TOPICS);
    if (!list.length) throw new Error('there are no published Signal topics to sort yet');
    const r = await complete(this.env, cfg.model, [suggestSystem(lenses, area), suggestUser(list.map((t) => t.label))], { maxTokens: 900,
      mock: () => JSON.stringify({ lenses: Object.fromEntries(lenses.map((l) => [l.key, list.map((t, i) => [t, i + 1] as const).filter(([t]) => lensMatch(l, t)).map(([, i]) => i)])) }) });
    if (r.cost) { this.setMeta('aiSpend', { day: today(), cost: this.aiSpend().cost + r.cost }); await recordCost(this.env, { kind: 'signal', ref: 'lens-suggest', label: 'Lens suggestions (AI)', llm: r.cost, tokensIn: r.tokensIn, tokensOut: r.tokensOut, calls: 1, model: cfg.model }); }
    const byLabel = new Map(list.map((t) => [t.label, t.term] as const));
    const got = parseSuggestions(r.text, lenses, list.map((t) => t.label));
    if (!Object.keys(got).length) throw new Error('the model did not return readable suggestions; try again');
    // The topic's own name (`term`) is what a lens stores; `label` is how Signal shows it.
    return { cost: r.cost, model: cfg.model, topics: list.length, suggestions: Object.fromEntries(Object.entries(got).map(([k, ls]) => [k, ls.map((l) => ({ term: byLabel.get(l) ?? l, label: l, already: lensMatch(lenses.find((x) => x.key === k)!, { term: byLabel.get(l) ?? l, label: l }) }))])) };
  }
  // ---- Prism (src/signal/prism.ts): the conversations inside a topic, found from the vectors of its items once a day, from the alarm, never from a page request.
  /** Forgets every kept answer of one topic (all hints and filters), after its summary or its conversations changed. */
  private dropTopicCache(slug: string): void { for (const k of [...this.pubCache.keys()]) if (k.startsWith(`topic|${slug}|`)) this.pubCache.delete(k); }
  /** The items Talk lists, as Prism needs them: only those that were read for their meaning and are not a copy of an earlier post. */
  private prismItems(items: EvItem[], meta: Map<EvItem, { watch: string; item: string }>): PrismItem[] {
    const out: PrismItem[] = [];
    for (const i of items) {
      const m = meta.get(i);
      if (!m) continue;
      const r = this.ctx.storage.sql.exec<{ v: ArrayBuffer; copy: string }>('SELECT v, copy FROM item_vec WHERE watch = ? AND item = ?', m.watch, m.item).toArray()[0];
      if (!r || r.copy !== '') continue;
      out.push({ key: m.watch + '\n' + m.item, v: fromBlob(r.v), ts: i.ts, kind: i.kind, title: i.title });
    }
    return out;
  }
  /** When to wake for conversations: 0 when there is nothing to do (no vectors are being made, no published Signal, or done for today). Not held back by the daily cap: the grouping costs no money, only the names do. */
  private prismWake(): number {
    if (!this.tables().ai || !this.boards().some((b) => b.public) || this.getMeta('prismDay', '') === today()) return 0;
    return Date.now() + 1000;
  }
  /**
   * Finds today's conversations of each active topic and names the new ones, one model call per topic with the Signal topic model, inside its daily cap, recorded in Costs as "Topic conversations (AI)".
   * It stops at the deadline and carries on at the next wake-up. A name the model did not give (cap reached, call failed) is made by rule, and asked for again tomorrow.
   */
  private async prismStep(deadline: number): Promise<void> {
    const cfg = this.aiConfig(), sql = this.ctx.storage.sql, day = today();
    if (!this.tables().ai || !this.boards().some((b) => b.public) || this.getMeta('prismDay', '') === day) return;
    const done = new Set(sql.exec<{ board: string; slug: string }>('SELECT board, slug FROM topic_prism WHERE day = ?', day).toArray().map((r) => r.board + '\n' + r.slug));
    for (const slug of await this.activeTopics()) {
      if (Date.now() > deadline) return;   // carries on at the next wake-up; prismDay is not set
      const found = await this.findTopic(slug);
      if (!found) continue;
      const board = found.v.board.slug, canonical = topicSlug(found.topic.term);
      if (done.has(board + '\n' + canonical)) continue;
      const names = [found.topic.term, ...found.topic.members], { items, meta } = await this.topicItems(found.v, names), pis = this.prismItems(items, meta);
      let prev: Prism | null = null;   // the newest earlier day that had groups: a day with none in between does not break the line
      for (const r of sql.exec<{ json: string }>('SELECT json FROM topic_prism WHERE board = ? AND slug = ? AND day < ? ORDER BY day DESC LIMIT 3', board, canonical, day)) {
        const j = JSON.parse(r.json) as Partial<Prism>;
        if (Array.isArray(j.groups)) { prev = j as Prism; break; }
      }
      const p = buildPrism(pis, prev, day);
      let named = false;
      if (p && unnamed(p).length) {
        const need = unnamed(p), titleOf = new Map(pis.map((i) => [i.key, i.title] as const)), titlesOf = (g: { typical: string[] }) => g.typical.map((k) => titleOf.get(k) ?? '').filter(Boolean);
        const taken = p.groups.filter((g) => g.by === 'model').map((g) => g.name);
        if (cfg.enabled && cfg.model && this.aiSpend().cost < cfg.dailyCap) {
          try {
            const r = await complete(this.env, cfg.model, [prismSystem(), prismUser(found.topic.label, need.map(titlesOf), taken)], { maxTokens: 200,
              mock: () => JSON.stringify({ names: need.map((_, i) => ({ i: i + 1, name: 'conversation ' + (i + 1) })) }) });
            if (r.cost) { this.setMeta('aiSpend', { day, cost: this.aiSpend().cost + r.cost }); await recordCost(this.env, { kind: 'signal', ref: 'topic-prism', label: 'Topic conversations (AI)', llm: r.cost, tokensIn: r.tokensIn, tokensOut: r.tokensOut, calls: 1, model: cfg.model }); }
            for (const [i, name] of parsePrismNames(r.text, need.length, taken)) { need[i].name = name; need[i].by = 'model'; named = true; }
          } catch (err) { console.error('topic conversation names failed', slug, err instanceof Error ? err.message : String(err)); }
        }
        // The rule: a group still without a name takes its most typical title; one that has a rule-made name from yesterday keeps it
        for (const g of need) if (g.by !== 'model') { if (!g.name) g.name = ruleName(titlesOf(g)[0] ?? ''); g.by = 'rule'; }
      }
      sql.exec('INSERT OR REPLACE INTO topic_prism (board, slug, day, json, model, at) VALUES (?, ?, ?, ?, ?, ?)', board, canonical, day, JSON.stringify(p ? { ...p, counted: pis.length } : { none: true, counted: pis.length }), named ? cfg.model : '', Date.now());
      this.dropTopicCache(canonical);
    }
    this.setMeta('prismDay', day);
    sql.exec('DELETE FROM topic_prism WHERE day < ?', dayOf(Date.now() - PRISM_KEEP_DAYS * 86_400_000));
  }
  /** A topic's conversations as the page and the tools get them, or null: today's or yesterday's row, counted over the items the list has now. `of` (public item id to conversation id) is for the filter and never leaves the Monitor. */
  private prismOut(board: string, slug: string, items: EvItem[], meta: Map<EvItem, { watch: string; item: string }>, proof: boolean): { out: PrismOut; of: Map<string, string> } | null {
    const row = this.ctx.storage.sql.exec<{ day: string; json: string }>('SELECT day, json FROM topic_prism WHERE board = ? AND slug = ? ORDER BY day DESC LIMIT 1', board, slug).toArray()[0];
    if (!row || !summaryFresh(row.day)) return null;
    const stored = JSON.parse(row.json) as Partial<Prism>;
    if (!Array.isArray(stored.groups)) return null;   // a newest row that says none means none
    const byKey = new Map<string, EvItem>();
    for (const i of items) { const m = meta.get(i); if (m) byKey.set(m.watch + '\n' + m.item, i); }
    const of = new Map<string, string>(), groups: PrismView[] = [];
    for (const g of stored.groups) {
      const here = g.items.map((k) => byKey.get(k)).filter((i): i is EvItem => !!i);
      if (!here.length) continue;
      const ts = here.map((i) => i.ts), tally = new Map<EvKind, number>();
      for (const i of here) { tally.set(i.kind, (tally.get(i.kind) ?? 0) + 1); if (i.id) of.set(i.id, g.id); }
      const top = [...tally].sort((a, b) => b[1] - a[1]), kind: EvKind | 'mixed' = top.length > 1 && top[0][1] === top[1][1] ? 'mixed' : top[0][0];
      const typical: PrismTypical[] = !proof ? [] : g.typical.map((k) => byKey.get(k)).filter((i): i is EvItem => !!i && !!i.id).map((i) => ({ id: i.id!, kind: i.kind, title: i.title, url: i.url, by: i.by, source: i.source, ts: i.ts }));
      groups.push({ id: g.id, name: g.name, by: g.by === 'model' ? 'model' : 'rule', n: here.length, kind, began: Math.min(...ts), last: Math.max(...ts), typical,
        dots: !proof ? [] : here.filter((i) => i.id).map((i) => ({ id: i.id!, ts: i.ts })) });
    }
    if (groups.length < 2) return null;   // a picture of one petal says nothing
    const all = [...byKey.values()].map((i) => i.ts);
    return { out: { day: row.day, groups, other: (stored.other ?? []).filter((k) => byKey.has(k)).length, from: Math.min(...all), to: Math.max(...all) }, of };
  }
  /** What the owner reads to check the numbers (section 12 of docs/SPEC-B6-prism.md): today's rows, no item. */
  private prismStatus() {
    const rows = this.ctx.storage.sql.exec<{ board: string; slug: string; json: string }>('SELECT board, slug, json FROM topic_prism WHERE day = ? ORDER BY board, slug', today()).toArray();
    return { day: today(), topics: rows.map((r) => {
      const j = JSON.parse(r.json) as Partial<Prism> & { counted?: number }, gs = Array.isArray(j.groups) ? j.groups : [], by = new Set(gs.map((g) => g.by));
      return { board: r.board, slug: r.slug, items: j.counted ?? 0, groups: gs.length, stable: gs.length && typeof j.stable === 'number' ? j.stable : null, names: (by.has('model') && by.has('rule') ? 'mixed' : by.has('model') ? 'model' : by.has('rule') ? 'rule' : '') as 'model' | 'rule' | 'mixed' | '' };
    }) };
  }
  /** When to wake for summaries: 0 when there is nothing to do (off, no published Signal, or done for today), the next midnight when the day's cap is used up. */
  private summaryWake(): number {
    const c = this.aiConfig();
    if (!c.enabled || !c.model || this.getMeta('summaryDay', '') === today() || !this.boards().some((b) => b.public)) return 0;
    if (this.aiSpend().cost >= c.dailyCap) return Date.parse(today() + 'T00:00:00Z') + 86_400_000 + 60_000;
    return Math.max(this.getMeta<number>('summaryRetry', 0), Date.now() + 1000);
  }
  /**
   * Writes today's summaries, one model call per topic, with the Signal topic model, inside its daily spending cap, and records every call in Costs as "Topic summaries (AI)".
   * It stops at the deadline and carries on at the next wake-up; a topic that fails three times in a row ends the day's run (the page then shows the line built from the numbers).
   */
  private async summaryStep(deadline: number): Promise<void> {
    const cfg = this.aiConfig(), sql = this.ctx.storage.sql, day = today();
    if (!cfg.enabled || !cfg.model || this.getMeta('summaryDay', '') === day || Date.now() < this.getMeta<number>('summaryRetry', 0) || !this.boards().some((b) => b.public)) return;
    const have = new Set(sql.exec<{ slug: string }>('SELECT slug FROM topic_summary WHERE day = ?', day).toArray().map((r) => r.slug));
    for (const slug of await this.activeTopics()) {
      if (have.has(slug)) continue;
      if (Date.now() > deadline) return;
      if (this.aiSpend().cost >= cfg.dailyCap) break;
      const found = await this.findTopic(slug);
      if (!found) continue;
      const names = [found.topic.term, ...found.topic.members], { items } = await this.topicItems(found.v, names), picked = pickSummaryItems(items).slice(0, SUMMARY_ITEMS);
      if (picked.length < 2) continue;   // too little to write from
      const papers = this.topicPapers(names).list.slice(0, 3).map((p) => p.title);
      let cost = 0, tin = 0, tout = 0, parsed: ReturnType<typeof parseSummary> = null, failed = '';
      try {
        const r = await complete(this.env, cfg.model, [summarySystem(), summaryUser({ label: found.topic.label, names, state: topicState(found.topic), items: picked, papers })], { maxTokens: 400,
          mock: () => JSON.stringify({ summary: `${found.topic.label} came up in ${picked.length} posts and articles over the last week.`, used: [1, 2] }) });
        cost = r.cost; tin = r.tokensIn; tout = r.tokensOut;
        parsed = parseSummary(r.text, picked.length);
        if (!parsed) failed = 'the model did not return a usable summary';
      } catch (err) { failed = err instanceof Error ? err.message : String(err); }
      if (cost) { this.setMeta('aiSpend', { day, cost: this.aiSpend().cost + cost }); await recordCost(this.env, { kind: 'signal', ref: 'topic-summaries', label: 'Topic summaries (AI)', llm: cost, tokensIn: tin, tokensOut: tout, calls: 1, model: cfg.model }); }
      if (!parsed) {
        const fails = this.getMeta<number>('summaryFails', 0) + 1;
        console.error('topic summary failed', slug, failed);
        if (fails >= 3) { this.setMeta('summaryFails', 0); this.setMeta('summaryDay', day); } else { this.setMeta('summaryFails', fails); this.setMeta('summaryRetry', Date.now() + SUMMARY_RETRY_MS); }
        return;
      }
      this.setMeta('summaryFails', 0);
      const used = (parsed.used.length ? parsed.used : picked.map((_, k) => k + 1)).slice(0, 8).map((k) => picked[k - 1]).filter(Boolean);
      sql.exec('INSERT OR REPLACE INTO topic_summary (slug, day, term, text, items, n, model, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', slug, day, found.topic.term, parsed.text,
        JSON.stringify(used.map((i) => ({ title: i.title, url: i.url, by: i.by, kind: i.kind }))), used.length, cfg.model, Date.now());
      this.dropTopicCache(slug);
    }
    this.setMeta('summaryDay', day);
    sql.exec('DELETE FROM topic_summary WHERE day < ?', dayOf(Date.now() - SUMMARY_KEEP_DAYS * 86_400_000));
  }

  private removeWatch(id: string): void {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM watches WHERE id = ?', id);
    sql.exec('DELETE FROM seen WHERE watch = ?', id);
    sql.exec('DELETE FROM terms WHERE watch = ?', id);
    sql.exec('DELETE FROM day_items WHERE watch = ?', id);
    for (const t of ['ai_queue', 'ai_item', 'ai_terms', 'ai_items', 'item_log', 'item_vec']) sql.exec(`DELETE FROM ${t} WHERE watch = ?`, id);
  }

  // ---- HTTP API (same routes and JSON as the local server)
  async fetch(request: Request): Promise<Response> {
    const res = await this.handle(request), name = new URL(request.url).pathname.replace(/^\/mon\//, '');
    if (request.method === 'POST' && res.ok && COLLECT_SYNC.has(name)) await this.syncCollect();   // what is watched, or who uses it, changed
    return res;
  }
  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = url.pathname.replace(/^\/mon\//, '');
    try {
      if (request.method === 'GET') {
        if (name === 'state') return json(this.snapshot());
        if (name === 'feed') {
          const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
          const source = url.searchParams.get('source') ?? ''; // '' = every source, combined
          if (source && !isSource(source)) throw new Error('unknown source');
          const list = url.searchParams.get('list') ?? '';     // only the watches made from one feed list
          const ofList = JSON.stringify(this.watches().filter((w) => w.list === list).map((w) => w.id));
          const rows = this.ctx.storage.sql.exec<{ watch: string; label: string; seen_at: number; json: string; source: string }>(
            "SELECT watch, label, seen_at, json, source FROM feed WHERE watch NOT LIKE 'brief:%' AND (?1 = '' OR source = ?1) AND (?3 = '' OR watch IN (SELECT value FROM json_each(?4))) ORDER BY seq DESC LIMIT ?2", source, limit, list, ofList).toArray();
          // Items saved before they carried the name of their feed get it from the watch they came from.
          const queries = new Map(this.watches().map((w) => [w.id, w] as const));
          return json(rows.map((r) => {
            const tweet = JSON.parse(r.json) as Record<string, unknown>;
            if (r.source !== 'x') { tweet.feed ??= r.label; tweet.feedUrl ??= r.source === 'hn' ? 'https://news.ycombinator.com/' : r.source === 'arxiv' ? 'https://arxiv.org/' : queries.get(r.watch)?.query; }
            return { watchId: r.watch, label: r.label, seenAt: r.seen_at, source: r.source, tweet };
          }));
        }
        if (name === 'signal') return json(await this.signalOverview(Number(url.searchParams.get('days')), url.searchParams.get('board') ?? '', url.searchParams.get('steady') !== '1'));
        if (name === 'who-first') return json(await this.whoSaidFirst(Number(url.searchParams.get('days')), url.searchParams.get('board') ?? ''));
        if (name === 'signal-term') {
          const term = (url.searchParams.get('term') ?? '').trim().toLowerCase().slice(0, 80);
          if (!term) throw new Error('term required');
          return json(await this.signalTerm(term));
        }
        if (name === 'signal-public') {   // read by every public page that shows Signal topics: kept for two minutes
          const k = `${url.searchParams.get('slug')}|${url.searchParams.get('days')}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = await this.signalPublic(url.searchParams.get('slug') ?? '', Number(url.searchParams.get('days')));
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'landscape-public') {   // the layout of the landing page's bubbles: kept for two minutes here, and for the day in the database
          const slug = url.searchParams.get('slug') ?? '', days = Number(url.searchParams.get('days')), k = `land|${slug}|${days}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = await this.landscapePublic(slug, days);
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'depth-public') {   // the Depth chart of a published Signal: kept for two minutes
          const slug = url.searchParams.get('slug') ?? '', k = `depth|${slug}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = await this.depthPublic(slug);
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'ladder-public') {   // the Ladder of a published Signal: kept for two minutes
          const slug = url.searchParams.get('slug') ?? '', k = `ladder|${slug}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = await this.ladderPublic(slug);
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'landscape-replay-public') {   // the layouts of the last days, for the replay on the landing page: kept for two minutes
          const slug = url.searchParams.get('slug') ?? '', days = Number(url.searchParams.get('days')), k = `landr|${slug}|${days}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = this.landscapeReplay(slug, days);
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'first-public') {   // reads thousands of items, for an address anyone can open: kept for two minutes like the other public Signal reads
          const slug = url.searchParams.get('slug') ?? '', days = Number(url.searchParams.get('days')), board = this.boards().find((b) => b.public && b.slug === slug);
          if (!board) return json({ error: 'not found' }, 404);
          const k = `first|${slug}|${days}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = publicFirst(await this.whoSaidFirst(days, board.id), board.proof === true);
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'signal-ai') return json(this.aiStatus());
        if (name === 'prism-status') return json(this.prismStatus());
        if (name === 'signal-filter') return json(this.filterInfo());
        if (name === 'signal-public-items') {
          const out = await this.signalPublicItems(url.searchParams.get('slug') ?? '', (url.searchParams.get('term') ?? '').toLowerCase().slice(0, 80), Number(url.searchParams.get('days')));
          return out ? json(out) : json({ error: 'not shown' }, 404);
        }
        if (name === 'signal-public-topic') {
          const out = await this.signalPublicTopic(url.searchParams.get('slug') ?? '', (url.searchParams.get('term') ?? '').toLowerCase().slice(0, 80), Number(url.searchParams.get('days')));
          return out ? json(out) : json({ error: 'not shown' }, 404);
        }
        if (name === 'signal-public-boards') return json(await this.publicBoards());
        if (name === 'topic-public') {   // the topic page and /t/<slug>.json: kept for two minutes
          const slug = (url.searchParams.get('slug') ?? '').toLowerCase().slice(0, 64), hint = areaHint(url.searchParams.get('area'));
          // the day, kind and order of the Talk list (A5), checked before they become part of the cache key, so odd values share the plain list's entry
          const rawConv = url.searchParams.get('conv') ?? '', bq = parseBrush({ day: url.searchParams.get('day'), kind: url.searchParams.get('kind'), conv: rawConv, sort: url.searchParams.get('sort') }, recentDays(Date.now(), 14), DEFAULT_SORT, CONV_ID.test(rawConv) ? [rawConv] : []), bk = brushParams(bq).map(([a, b]) => `${a}=${b}`).join('&');
          const k = `topic|${slug}|${hint ?? ''}|${bk}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return hit.v ? json(hit.v) : json({ error: 'not found' }, 404);
          const v = await this.topicData(slug, hint, bq);
          if (bk && this.pubCache.size > 300) this.pubCache.delete(this.pubCache.keys().next().value as string);
          this.pubCache.set(k, { at: Date.now(), v });
          if (url.searchParams.get('quiet') !== '1' && (this.summaryWake() || this.prismWake())) await this.reschedule();   // summaries or conversations are due: start writing them (a page never waits for one). `quiet`: the public MCP server only reads
          return v ? json(v) : json({ error: 'not found' }, 404);
        }
        if (name === 'topic-peek') {   // the small card of a topic, for /t/<slug>/peek: kept for two minutes
          const slug = (url.searchParams.get('slug') ?? '').toLowerCase().slice(0, 64), hint = areaHint(url.searchParams.get('area')), k = `peek|${slug}|${hint ?? ''}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return hit.v ? json(hit.v) : json({ error: 'not found' }, 404);
          const v = await this.topicPeek(slug, hint);
          if (this.pubCache.size > 300) this.pubCache.delete(this.pubCache.keys().next().value as string);
          this.pubCache.set(k, { at: Date.now(), v });
          return v ? json(v) : json({ error: 'not found' }, 404);
        }
        if (name === 'topic-item-public') {   // the source card /t/<slug>/i/<id> and the get_item tool: kept for two minutes
          const slug = (url.searchParams.get('slug') ?? '').toLowerCase().slice(0, 64), id = (url.searchParams.get('item') ?? '').slice(0, 20), hint = areaHint(url.searchParams.get('area')), k = `card|${slug}|${id}|${hint ?? ''}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = await this.topicCard(slug, id, hint);
          if (this.pubCache.size > 300) this.pubCache.delete(this.pubCache.keys().next().value as string);   // anyone can ask for any id: the cache stays small
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'research-page') {   // a topic's page: kept for two minutes
          const slug = url.searchParams.get('slug') ?? '', page = Number(url.searchParams.get('page')) || 1, key = `research\n${slug}\n${page}`, hit = this.pubCache.get(key);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = this.researchPage(slug, page);
          if (!v) return json({ error: 'no such topic' }, 404);
          this.pubCache.set(key, { at: Date.now(), v });
          await this.reschedule();
          return json(v);
        }
        if (name === 'research-map') {   // the Research map: kept for two minutes
          const lens = url.searchParams.get('lens') ?? '', hit = this.pubCache.get('map'), pick = (v: ReturnType<MonitorDO['mapView']>) => (v.state === 'ready' && v.lenses.some((l) => l.key === lens) ? { ...v, lens } : v);   // ?lens= preselects a lens in the view
          if (hit && Date.now() - hit.at < 120_000) return json(pick(hit.v as ReturnType<MonitorDO['mapView']>));
          const v = this.mapView();
          if (v.state === 'ready') this.pubCache.set('map', { at: Date.now(), v }); else await this.reschedule();
          return json(pick(v));
        }
        if (name === 'topic-items-public') return json(await this.topicItemsPublic(url.searchParams));   // the public MCP server: a topic's items, a page at a time
        if (name === 'papers-public') {   // the public MCP server: papers of the last 30 days, by words, cluster of the Research map or attention; kept for two minutes
          const p = url.searchParams, k = `papers|${p.get('q')}|${p.get('cluster')}|${p.get('discussed')}|${p.get('limit')}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = this.papersPublic(p);
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'search-public') {   // search across topics, items and papers for the public site and the public MCP server: bounded, public data only, kept for two minutes
          const p = url.searchParams, q = cleanQuery(p.get('q')), window = windowOfSearch(p.get('window')), lens = (p.get('lens') ?? '').slice(0, 20), kinds = (p.get('kinds') ?? '').split(',');
          const per = Math.max(1, Math.min(25, Number(p.get('per')) || 5)), offset = Math.max(0, Math.min(400, Number(p.get('offset')) || 0)), area = parseArea(p.get('area'));
          const k = `search|${area}|${q.toLowerCase()}|${window}|${lens}|${kinds.join(',')}|${per}|${offset}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = await this.searchPublic(q, window, lens, new Set(kinds), per, offset, area);
          if (this.pubCache.size > 300) this.pubCache.delete(this.pubCache.keys().next().value as string);   // anyone can ask anything: the cache stays small
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'paper-public') { const v = this.paperPublic(url.searchParams.get('id') ?? ''); return v ? json(v) : json({ error: 'no such paper' }, 404); }
        if (name === 'research-map-paper') { const v = this.mapPaper(url.searchParams.get('id') ?? ''); return v ? json(v) : json({ error: 'no such paper' }, 404); }
        if (name === 'pulse-public') {   // the public page: kept for two minutes
          const hit = this.pubCache.get('pulse');
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = this.pulseView(); this.pubCache.set('pulse', { at: Date.now(), v });
          if (this.pulseTodo().length) await this.reschedule();   // a new day, or the first visit after a deploy: start reading
          return json(v);
        }
        if (name === 'pulse') {
          const todo = this.pulseTodo().length;
          if (todo) await this.reschedule();
          const built = this.ctx.storage.sql.exec<{ built: number }>('SELECT built FROM research_map WHERE id = 1').toArray()[0]?.built ?? 0, back = this.mapBackfill();
          return json({ ...this.pulseView(), todo, error: this.getMeta<string>('pulseError', ''), retryAt: this.getMeta<number>('pulseRetry', 0), map: { built, toRead: this.backfillTodo().length, read: Object.values(back).reduce((n, b) => n + b.start, 0), toEmbed: this.mapMissing(), error: this.getMeta<string>('mapError', ''), namesProblem: this.getMeta<string>('mapNames', ''), retryAt: this.getMeta<number>('mapRetry', 0) } });
        }
        if (name === 'signal-public-terms') {   // every topic of a published Signal in the last two weeks, for the public Topics page; kept for two minutes
          const slug = url.searchParams.get('slug') ?? '', k = `terms|${slug}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const board = this.boards().find((b) => b.public && b.slug === slug);
          if (!board) return json({ error: 'not found' }, 404);
          const c = await this.compute(14, new Set(board.groups));
          const v = { slug: board.slug, title: board.title, days: c.days, baselineOk: c.baselineOk,
            terms: c.terms.slice(0, 400).map((t) => ({ term: t.term, signal: t.signal, docs: t.docs, isNew: t.isNew, change: t.change, evergreen: t.evergreen, kind: t.kind, breadth: t.breadth })) };
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'landing-public') {   // the extras of the landing page (summaries, daily counts of the cards, recent papers, what was read most): kept for two minutes
          const spark = (url.searchParams.get('spark') ?? '').split('|').map((x) => x.trim().toLowerCase().slice(0, 80)).filter(Boolean).slice(0, 12), board = (url.searchParams.get('board') ?? '').slice(0, 40), k = `landing|${board}|${spark.join('|')}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = await this.landingPublic(spark, board);
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'lenses-public') {   // read by every public page that applies a lens: kept for two minutes
          const area = url.searchParams.get('area') ?? 'ai';
          if (!LENS_AREAS.includes(area as LensArea)) return json({ error: 'unknown area' }, 404);
          const k = `lenses|${area}`, hit = this.pubCache.get(k);
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = this.lenses(area as LensArea);
          this.pubCache.set(k, { at: Date.now(), v });
          return json(v);
        }
        if (name === 'lenses') return json({ areas: LENS_AREAS, max: MAX_LENSES, palette: LENS_PALETTE, lenses: Object.fromEntries(LENS_AREAS.map((a) => [a, this.lenses(a)])) });
        if (name === 'views') return json(this.views());
        if (name === 'view-items') { const v = this.views().find((x) => x.id === url.searchParams.get('id')); if (!v) throw new Error('unknown feed page'); return json(this.viewItems(v)); }
        // Public: the published feed pages (for the menu and Today, with each one's newest item), and one page with its items.
        if (name === 'views-public') {   // read by every public page (the menu): kept for two minutes like the Signal answers
          const hit = this.pubCache.get('views');
          if (hit && Date.now() - hit.at < 120_000) return json(hit.v);
          const v = this.views().filter((x) => x.public).map((x) => ({ slug: x.slug, title: x.title, description: x.description, listed: x.listed, layout: x.layout, first: this.viewItems({ ...x, count: 1 })[0] ?? null }));
          this.pubCache.set('views', { at: Date.now(), v });
          return json(v);
        }
        if (name === 'view-public') {
          const v = this.views().find((x) => x.public && x.slug === url.searchParams.get('slug'));
          if (!v) return json({ error: 'not found' }, 404);
          return json({ slug: v.slug, title: v.title, description: v.description, layout: v.layout, show: v.show, days: v.days, perSource: v.perSource, items: this.viewItems(v) });
        }
        if (name === 'signal-items') {
          const p = url.searchParams;
          return json(await this.signalItems({ terms: (p.get('terms') ?? p.get('term') ?? '').split('|').slice(0, 12), days: Number(p.get('days')), group: p.get('group') ?? '', watch: p.get('watch') ?? '', offset: Number(p.get('offset')), limit: Number(p.get('limit')) }));
        }
        if (name === 'signal-group') return json(await this.signalGroup(url.searchParams.get('key') ?? '', Number(url.searchParams.get('days'))));
        return json({ error: 'unknown monitor route' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'GET or POST required' }, 405);
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      this.pubCache.clear();

      if (name === 'add') {
        if (this.watches().length >= MAX_WATCHES) throw new Error(`at most ${MAX_WATCHES} watches`);
        let source = isSource(b.source) ? b.source : 'x';
        if (source === 'rss') b.query = expandShorthand(String(b.query ?? '')) ?? b.query;   // r/rust, github:owner/repo, … → the feed they stand for
        if (source === 'rss' && isArxivApi(String(b.query ?? ''))) { b.query = queryOfArxivUrl(String(b.query)); source = 'arxiv'; }   // arxiv:cs.AI with words, or an arXiv API address pasted as a feed
        if (source === 'rss' && isYoutubeFeed(String(b.query ?? '').trim())) source = 'youtube';   // a YouTube feed address pasted as a plain feed
        // The list it came from: a feed list's id, or "a:<id>" for an account list and "x:<id>" for an X List (so Sources can manage it as one).
        const listId = /^(?:[ax]:)?[A-Za-z0-9-]{1,40}$/.test(String(b.list ?? '')) ? String(b.list) : undefined;
        // Already watched: from a feed list that is fine (the watch just remembers it belongs to the list too); otherwise it is a mistake.
        const repeat = (had: Watch, message: string): Response => {
          if (!listId) throw new Error(message);
          if (!had.list) { had.list = listId; this.saveWatch(had); }
          return json({ ...this.view(had), existing: true });
        };
        const intervalSec = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(Number(b.intervalSec)) || 60));
        const now = Math.floor(Date.now() / 1000);
        const w: Watch = {
          id: crypto.randomUUID().slice(0, 8), label: '', query: '', originalsOnly: !!b.originalsOnly, includeRetweets: !!b.includeRetweets, intervalSec, enabled: true,
          created: now, lastCheckedTs: now, nextRun: 0, checks: 0, found: 0, cost: 0, lastRun: 0, lastError: '', errors: 0, source,
        };
        const given = String(b.label ?? '').trim().slice(0, 60);
        if (source === 'rss' || source === 'youtube') {
          w.query = source === 'youtube' ? await resolveYoutubeFeed(String(b.query ?? '')) : checkFeedUrl(String(b.query ?? ''));
          const had = this.watches().find((x) => x.query === w.query && (sourceOf(x) === 'rss' || sourceOf(x) === 'youtube'));
          if (had) return repeat(had, 'that feed is already watched');
          w.label = given || new URL(w.query).hostname; w.autoLabel = !given; w.originalsOnly = false; w.includeRetweets = false;
        } else if (source === 'arxiv') {
          w.query = String(b.query ?? '').trim().slice(0, 300);
          if (!arxivSearchQuery(w.query)) throw new Error('enter categories (cs.CL, cs.LG), words, or a search such as au:"Hinton" AND cat:cs.LG');
          const hadArxiv = this.watches().find((x) => sourceOf(x) === 'arxiv' && x.query.toLowerCase() === w.query.toLowerCase());
          if (hadArxiv) return repeat(hadArxiv, 'that search is already watched');
          w.label = given || `arXiv: ${w.query}`.slice(0, 60); w.originalsOnly = false; w.includeRetweets = false;
        } else if (source === 'hn') {
          w.hnTag = HN_TAGS.includes(b.hnTag as HnTag) ? (b.hnTag as HnTag) : 'front_page';
          w.query = String(b.query ?? '').trim().slice(0, 200);
          w.minPoints = Math.min(10_000, Math.max(0, Math.floor(Number(b.minPoints)) || 0));
          const hadHn = this.watches().find((x) => sourceOf(x) === 'hn' && (x.hnTag ?? 'front_page') === w.hnTag && x.query === w.query && (x.minPoints ?? 0) === w.minPoints);
          if (hadHn) return repeat(hadHn, 'that search is already watched');
          const kind = { front_page: 'front page', story: 'new stories', show_hn: 'Show HN', ask_hn: 'Ask HN' }[w.hnTag];
          w.label = given || `HN ${kind}${w.query ? ` · ${w.query}` : ''}${w.minPoints ? ` · ${w.minPoints}+ points` : ''}`.slice(0, 60);
          w.originalsOnly = false; w.includeRetweets = false;
        } else {
          let query = String(b.query ?? '').trim();
          if (b.kind === 'account') query = 'from:' + query.replace(/^@/, '');
          if (!query || query.length > 400 || (b.kind === 'account' && !/^from:\w{1,15}$/.test(query))) throw new Error('invalid account or query');
          w.query = query; w.label = b.kind === 'account' ? '@' + query.slice(5) : given || query;
        }
        if (listId) w.list = listId;
        const group = cleanGroup(b.group); if (group) w.group = group;   // Signal: the group this watch votes in
        this.saveWatch(w); await this.reschedule();
        return json(this.view(w));
      }
      if (name === 'pulse-topic-save') {
        const list = this.pulseTopics(), prev = list.find((t) => t.id === b.id);
        if (!prev && list.length >= 12) throw new Error('at most 12 topics');
        const t = this.cleanPulseTopic(b, prev);
        this.setMeta('pulseTopics', prev ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]);
        if (prev && prev.query !== t.query) {   // another search has another history and other papers: start them again
          this.ctx.storage.sql.exec('DELETE FROM pulse WHERE topic = ?', t.id); this.ctx.storage.sql.exec('DELETE FROM research_topic_papers WHERE topic = ?', t.id);
          const next = this.researchNext(); delete next[t.id]; this.setMeta('researchNext', next);
          const back = this.mapBackfill(); delete back[t.id]; this.setMeta('mapBackfill', back); this.setMeta('mapNext', 0);
        }
        if (!prev) this.setMeta('mapNext', 0);   // the next build takes it in, once its month has been read
        this.setMeta('pulseRetry', 0); await this.reschedule();
        return json(t);
      }
      if (name === 'pulse-topic-delete') {
        this.setMeta('pulseTopics', this.pulseTopics().filter((t) => t.id !== b.id));
        this.ctx.storage.sql.exec('DELETE FROM pulse WHERE topic = ?', String(b.id ?? '')); this.ctx.storage.sql.exec('DELETE FROM research_topic_papers WHERE topic = ?', String(b.id ?? ''));
        this.setMeta('mapNext', 0); await this.reschedule();
        return json({ ok: true });
      }
      if (name === 'settings') {
        const cap = Number(b.dailyCap);
        if (cap >= 0) this.setMeta('settings', { dailyCap: Math.min(1000, cap) });
        await this.reschedule();
        return json(this.snapshot());
      }
      if (name === 'signal-weight') {
        const key = String(b.key ?? '').slice(0, 80), weight = Math.round(Math.min(3, Math.max(0, Number(b.weight))) * 100) / 100;
        if (!key || !Number.isFinite(weight)) throw new Error('key and weight required');
        this.setMeta('signalWeights', { ...this.getMeta<Record<string, number>>('signalWeights', {}), [key]: weight });
        return json({ ok: true });
      }
      if (name === 'signal-alias-set') {   // merged and renamed topics, as the whole map old name -> new name
        this.setMeta('signalAliases', cleanAliases(b.aliases));
        return json(this.filterInfo());
      }
      if (name === 'signal-name-dismiss') {   // a suggested pair of topic names that are not one: not suggested again
        const pair = `${String(b.name ?? '').toLowerCase().trim()}\n${String(b.like ?? '').toLowerCase().trim()}`;
        this.setMeta('nameDismissed', [pair, ...this.getMeta<string[]>('nameDismissed', []).filter((x) => x !== pair)].slice(0, 300));
        return json(this.aiStatus());
      }
      if (name === 'signal-filter-set') {   // the whole list of words to leave out
        this.setMeta('signalFilter', cleanFilter(b.words));
        return json(this.filterInfo());
      }
      if (name === 'collected') {   // from the collection layer: new items and statuses, for watches and for briefings that count in Signal
        if (b.spend && typeof b.spend === 'object') this.setMeta('spend', b.spend);
        const deliveries = (Array.isArray(b.deliveries) ? b.deliveries : []) as Array<{ watch?: string; found?: Found[]; status?: Partial<Watch>; briefing?: { slug: string; title: string; group: string }; posts?: Array<Record<string, unknown>> }>;
        for (const d of deliveries) {
          if (d.briefing) this.ingestBriefing(String(d.briefing.slug).slice(0, 40), String(d.briefing.title ?? d.briefing.slug).slice(0, 50), String(d.briefing.group ?? ''), d.posts ?? []);
          else if (d.watch) this.ingestCollected(d.watch, d.found ?? [], d.status ?? {});
        }
        await this.reschedule();
        return json({ ok: true });
      }
      if (name === 'signal-ingest') {   // a briefing hands over the posts it fetched
        const posts = (Array.isArray(b.posts) ? b.posts : []).filter((p): p is Record<string, unknown> => !!p && typeof p === 'object');
        const slug = String(b.slug ?? '').slice(0, 40);
        if (!slug) throw new Error('slug required');
        return json(this.ingestBriefing(slug, String(b.title ?? slug).slice(0, 50), String(b.group ?? ''), posts));
      }
      if (name === 'signal-ai-retry') {   // the items the model gave up on, and a waiting error: read them again now
        const sql = this.ctx.storage.sql;
        this.ctx.storage.transactionSync(() => {
          for (const r of sql.exec<{ watch: string; item: string; day: string }>("SELECT watch, item, day FROM ai_item WHERE topics = 'null'").toArray()) {
            sql.exec('UPDATE ai_items SET n = MAX(0, n - 1) WHERE day = ? AND watch = ?', r.day, r.watch);
            sql.exec('DELETE FROM ai_item WHERE watch = ? AND item = ?', r.watch, r.item);
            sql.exec('INSERT OR IGNORE INTO ai_queue (watch, item, day, text) SELECT watch, item, day, match FROM item_log WHERE watch = ? AND item = ?', r.watch, r.item);
          }
        });
        this.setMeta('aiStatus', {}); this.setMeta('aiFails', 0);
        await this.reschedule();
        return json(this.aiStatus());
      }
      if (name === 'signal-ai-reread') {   // after a change of model or prompt: forget what the model gave the last two weeks and read it all again
        // The queue keeps at most AI_QUEUE_MAX items, so only the newest that fit are read again, and only their days are forgotten.
        const sql = this.ctx.storage.sql, floor = dayOf(Date.now() - (AI_BACKLOG_DAYS - 1) * 86_400_000), cap = AI_QUEUE_MAX - 200;
        const oldest = sql.exec<{ day: string }>('SELECT MIN(day) AS day FROM (SELECT day FROM item_log WHERE day >= ? ORDER BY ts DESC LIMIT ?)', floor, cap).one().day;
        if (!oldest) return json(this.aiStatus());
        this.ctx.storage.transactionSync(() => {
          for (const t of ['ai_item', 'ai_terms', 'ai_items']) sql.exec(`DELETE FROM ${t} WHERE day >= ?`, oldest);
          sql.exec('DELETE FROM ai_queue WHERE day >= ?', oldest);
          sql.exec('INSERT OR IGNORE INTO ai_queue (watch, item, day, text) SELECT watch, item, day, match FROM item_log WHERE day >= ? ORDER BY ts', oldest);
        });
        this.setMeta('aiStatus', {}); this.setMeta('aiFails', 0);
        await this.reschedule();
        return json(this.aiStatus());
      }
      if (name === 'signal-ai-set') {   // topics written by a model: on or off, which model, and the most it may spend in a day
        const prev = this.aiConfig(), models = modelOptions(this.env).filter((m) => !m.decider);
        const model = String(b.model ?? '') || prev.model || defaultTiers(this.env).cheap;
        if (b.enabled === true && !models.some((m) => m.id === model)) throw new Error('topics by a model need the OPENROUTER_API_KEY secret and a model from the list');
        const cap = b.dailyCap === undefined ? prev.dailyCap : Math.min(10, Math.max(0, Number(b.dailyCap)));
        if (!Number.isFinite(cap)) throw new Error('daily cap must be a number');
        this.setMeta('signalAi', { enabled: b.enabled === undefined ? prev.enabled : b.enabled === true, model, dailyCap: cap } satisfies SignalAi);
        this.setMeta('aiStatus', {}); this.setMeta('aiFails', 0);
        if (b.enabled === true) this.enqueueBacklog();
        await this.reschedule();
        return json(this.aiStatus());
      }
      if (name === 'lens-save') {   // create or change a lens (by its key and area)
        const area = LENS_AREAS.includes(b.area as LensArea) ? (b.area as LensArea) : 'ai', list = this.lenses(area);
        const lens = cleanLens({ ...b, area }, list), prev = list.find((x) => x.key === lens.key);
        if (!prev && list.length >= MAX_LENSES) throw new Error(`at most ${MAX_LENSES} lenses in an area`);
        this.saveLenses(area, prev ? list.map((x) => (x.key === lens.key ? lens : x)) : [...list, lens]);
        return json(lens);
      }
      if (name === 'lens-delete') {
        const area = LENS_AREAS.includes(b.area as LensArea) ? (b.area as LensArea) : 'ai';
        this.saveLenses(area, this.lenses(area).filter((x) => x.key !== String(b.key ?? '')));
        return json({ ok: true });
      }
      if (name === 'lens-suggest') return json(await this.suggestLenses(LENS_AREAS.includes(b.area as LensArea) ? (b.area as LensArea) : 'ai'));
      if (name === 'view-save') {   // create or change a feed page
        const all = this.views(), prev = b.id ? all.find((x) => x.id === String(b.id)) : undefined;
        if (b.id && !prev) throw new Error('unknown feed page');
        if (!prev && all.length >= 30) throw new Error('at most 30 feed pages');
        const v = this.cleanView(b, prev);
        this.setMeta('feedViews', prev ? all.map((x) => (x.id === v.id ? v : x)) : [...all, v]);
        return json(v);
      }
      if (name === 'view-delete') { this.setMeta('feedViews', this.views().filter((x) => x.id !== String(b.id ?? ''))); return json({ ok: true }); }
      if (name === 'signal-board-save') {   // create or change a top-level Signal
        const boards = this.boards(), prev = b.id ? boards.find((x) => x.id === String(b.id)) : undefined;
        if (b.id && !prev) throw new Error('unknown Signal');
        if (!prev && boards.length >= 20) throw new Error('at most 20 Signals');
        const board = this.cleanBoard(b, prev);
        this.saveBoards(prev ? boards.map((x) => (x.id === prev.id ? board : x)) : [...boards, board]);
        return json(board);
      }
      if (name === 'signal-board-delete') { this.saveBoards(this.boards().filter((x) => x.id !== String(b.id ?? ''))); return json({ ok: true }); }
      if (name === 'signal-regroup') {   // every watch in one group moves to a name you give (an existing group's name merges them); no name puts them back
        const key = String(b.key ?? ''), group = cleanGroup(b.group), names = await this.listNames();
        let n = 0, to = '';
        for (const w of this.watches()) {
          if (w.noSignal || this.groupOf(w, names).key !== key) continue;
          if (group) w.group = group; else delete w.group;
          to = this.groupOf(w, names).key;
          this.saveWatch(w); n++;
        }
        // The weight you set follows the group to its new name, unless that name already has one (a merge).
        const weights = this.getMeta<Record<string, number>>('signalWeights', {});
        if (n && to !== key) this.boardsRekey(key, to);
        if (n && to !== key && key in weights) { if (!(to in weights)) weights[to] = weights[key]; delete weights[key]; this.setMeta('signalWeights', weights); }
        return json({ ok: true, moved: n });
      }
      if (name === 'signal-delete-group') {   // stops watching every source in the group
        const key = String(b.key ?? ''), names = await this.listNames();
        const ids = this.watches().filter((w) => !w.noSignal && this.groupOf(w, names).key === key).map((w) => w.id);
        this.ctx.storage.transactionSync(() => { for (const id of ids) this.removeWatch(id); });
        const weights = this.getMeta<Record<string, number>>('signalWeights', {});
        if (key in weights) { delete weights[key]; this.setMeta('signalWeights', weights); }
        this.boardsRekey(key);
        await this.reschedule();
        return json({ ok: true, deleted: ids.length });
      }
      if (name === 'clear') { this.ctx.storage.sql.exec('DELETE FROM feed'); return json({ ok: true }); }

      const w = this.watch(String(b.id ?? ''));
      if (!w) return json({ error: 'unknown watch' }, 404);
      if (name === 'update') {
        if (b.enabled !== undefined) { w.enabled = !!b.enabled; if (w.enabled) { w.errors = 0; w.lastError = ''; w.nextRun = 0; } }
        if (b.signal !== undefined) { if (b.signal) delete w.noSignal; else w.noSignal = true; }
        if (b.group !== undefined) { const g = cleanGroup(b.group); if (g) w.group = g; else delete w.group; }
        if (b.intervalSec !== undefined) w.intervalSec = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(Number(b.intervalSec)) || w.intervalSec));
        this.saveWatch(w); await this.reschedule();
        return json(this.view(w));
      }
      if (name === 'delete') {
        this.removeWatch(w.id);
        await this.reschedule();
        return json({ ok: true });
      }
      if (name === 'check') {
        await this.env.COLLECT.getByName('main').fetch(new Request('https://internal/collect/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ watch: w.id }) }));
        return json({ ok: true });
      }
      return json({ error: 'unknown monitor route' }, 404);
    } catch (err) {
      console.error('monitor request failed', name, err instanceof Error ? err.message : String(err));
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
}
