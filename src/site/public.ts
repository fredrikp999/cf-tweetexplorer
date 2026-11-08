// The public side of the site: the landing page at / and one page per topic at /<slug>. Rendered here as plain
// HTML (no client script, except the two picture pages in site/viz.ts), from issues the admin has published. Model output is untrusted, so the Markdown
// renderer escapes everything first and only ever emits links to posts on x.com / twitter.com.
import { SLUG } from '../durable-objects/publish';
import { ARXIV_THANKS } from '../sources/arxiv';
import { KIND_TITLE as SEARCH_TITLE, SEARCH_KINDS, SEARCH_WINDOWS, MAX_PAGE, PAGE_SIZE, parseKinds, pageOf, searchHref, tooShort, windowOfSearch, type SearchAnswer, type SearchKind } from './search';
import { loadSearch } from './searchData';
import { reactionText } from './agentText';
import { esc, inline, markdown } from './markdown';
import { anchorOf as anchorOfTheme, continuity, inOrder, isMeta, langOf, normalizeThemes, readingMinutes, sectionsOf } from './brief';
import { pageOfFeed } from '../sources/youtube';
export { markdown };
import { serveAudio, serveImage } from '../media/audio-serve';
import type { Provenance } from '../durable-objects/publish';
import type { Stats } from '../history/stats.ts';
import type { Results, Subject, Theme } from '../history/analysis.ts';
import { GALAXY_PAGE, MAX_GALAXY_POINTS } from '../history/galaxy.ts';
import { partsAfterParents } from '../signal/topics';
import { STATE_LABEL, STATE_MARK, topicSlug, TOPIC_SLUG, roughly, type EvKind, type TopicData, type TopicTalkItem } from '../signal/topicpage';
import { TIE_MS } from '../signal/first';
import { KIND_MARK, KIND_TITLE as KIND_NAME, firstCaveat, firstSentence, lagWords, stampUtc, timelineWords, type TimelineDot } from '../signal/topicview';
import { loadTopic } from './topicData';
import { CARD_FONT, CARD_W, shareCardSvg } from './shareCard';
import { svgToPng } from '../media/png';
import { PHASE_LABEL, PHASE_MARK, PHASE_TRACK, lifecycle, smooth, type Lifecycle } from '../signal/lifecycle';
import { soften, streamLayout, type StreamLayer } from '../signal/stream';
import { STREAM_TOPICS, loadOverview } from './overview';
import { overviewOut } from './agentText';
import type { Layout } from '../signal/landscape';
import { AREA_BRIEFINGS, AREA_HOME, AREA_LABEL, areaHint, areaOfRequest, areaOf, boardsOfArea, parseArea, publishedAreas, topicHref, topicsOfArea, type Area } from '../signal/area';
import { LENS_COLORS, LENS_JS, applyLens, lensMatch, chosenLens, lensColorCss, lensesOfTopic, type Lens } from '../signal/lens';
import { avatarResponse, isOwnLens, isPersonal, mePost, ownLenses, viewerOf, type Viewer } from './me';
import type { AskRow, Me } from '../durable-objects/users';
import { FEATURES, MAX_FOLLOWS, MAX_OWN_LENSES, homeFor } from '../users/model';
import { VISIT_JS, WINDOWS, WINDOW_LABEL, cardLine, inBrief, mixText, pickReads, rankList, researchStrip, risingStrip, sinceCounts, windowOf, type LandingWindow, type ReadItem, type RecentPaper, type SigTopic } from './landing';
import { HOST_JS, VIZ_CSS, VIZ_VIEWS, vizFrame, viewCsp } from './viz';
import { openrouterModelInfo } from '../summarize/openrouter.ts';
import { aiModelInfo } from '../summarize/workers-ai.ts';

export interface Brief { id: string; tldr: string; publishedAt: number; tweets: number; accounts?: number | null; /** Its theme headings (absent on answers from before themes were listed). */ themes?: string[] }
export interface TopicInfo { slug: string; title: string; description: string; intervalHours: number; /** The area of the site it belongs to (none: AI). */ area?: Area }
export interface IssueFull extends Brief { markdown: string; links?: string[]; windowHours: number; model: string; provenance?: Provenance; audio?: { seconds: number; v: number }; image?: { v: number; aspect: string } }
export type PubTopic = TopicInfo & { latest: Brief; /** Its place in the order you set; absent when it has none. */ position?: number; /** Its newest published picture (/image/<slug>/<id>.jpg?v=), for its card on the landing page. */ pic?: { id: string; v: number } };
/** The picture at the top of Today (publish.ts decides which). */
interface PubHero { slug: string; title: string; id: string; v: number }
interface PubXList { id: string; name: string; groups: string[]; description: string }
interface PubReportBrief { slug: string; title: string; description: string; tweets: number; fromTs: number; toTs: number; publishedAt: number }
interface PubReport { report: { slug: string; title: string; description: string; publishedAt: number }; job: { query: string; fromTs: number; toTs: number; filters: { excludeReplies: boolean; excludeRetweets: boolean; minFaves: number; lang: string }; status: string; maxTweets: number }; stats: Stats; analysis?: { narrative: string; results: Results; themes: Theme[]; subjects: Subject[] } }
interface PubTweet { id: string; url: string; text: string; createdAt: string; lang: string; isReply: boolean; likeCount: number; retweetCount: number; replyCount: number; viewCount: number; author: { userName: string; name: string } }
interface PubTweets { total: number; pages: number; page: number; sort: 'new' | 'top'; tweets: PubTweet[] }
/** What every page needs for the rail. */
interface PubAList { id: string; name: string; topic: string; handles: string[] }
interface PubFList { id: string; name: string; topic: string; feeds: { source: 'rss' | 'youtube' | 'hn' | 'arxiv'; label: string; query: string; hnTag?: string; minPoints?: number }[] }
// lists: X lists (live on x.com); alists: curated sets of X accounts; flists: curated sets of feeds (RSS, YouTube, Hacker News)
/** One item on a feed page. `video`: a YouTube video id, for its picture and the player. */
export interface ViewItem { title: string; url: string; by: string; source: string; kind: string; ts: number; reactions: number; video?: string }
export interface PubView { slug: string; title: string; description: string; listed: boolean; layout: 'player' | 'cards' | 'list'; first: ViewItem | null }
interface PubViewPage { slug: string; title: string; description: string; layout: 'player' | 'cards' | 'list'; show: 'latest' | 'top'; days: number; perSource: boolean; items: ViewItem[] }
/** Every topic of one published Signal in the last two weeks. */
interface PubTerms { slug: string; title: string; days: number; baselineOk: boolean; terms: Array<{ term: string; signal: number; docs: number; isNew: boolean; change: number | null; evergreen: boolean; kind: string; breadth: number }> }
interface Ctx { /** The area this page belongs to: its topics, boards and menu are the area's own (render() builds one Ctx per area). */ area: Area; /** The areas with something published: the area chooser shows only when there is more than AI. */ areas: Area[]; topics: PubTopic[]; /** Published feed pages. */ views: PubView[]; lists: PubXList[]; alists: PubAList[]; flists: PubFList[]; reports: PubReportBrief[]; /** The published Signals (top-level sets of source groups). */ boards: PubBoard[]; /** The lenses of the area, for the lens chooser of the top bar (none: the chooser is left out); a reader's own lenses come last. */ lenses?: Lens[]; /** Readers are on (the site knows who is signed in): pages offer Follow and the settings page. */ users?: boolean; /** The signed-in reader, only on a page made for them (never on a page in the shared cache). */ me?: Me | null; /** A line to show once, after a change (?msg=), on a page made for the reader. */ msg?: string }
export interface PubBoard { slug: string; title: string; description: string; groups: string[]; proof?: boolean; /** The area it belongs to (none: AI). */ area?: Area; /** Addresses it had before: they redirect here. */ aliases?: string[] }
interface PubProof { slug: string; title: string; days: number; term: string; label: string; terms: string[]; from: string; to: string; total: number; groups: Array<{ name: string; n: number }>; sources: Array<{ label: string; group: string; n: number }>; items: Array<{ title: string; url: string; discussionUrl: string; source: string; by: string; group: string; ts: number }> }
// Signal, as the Monitor gives it for the public page: group names and counts, and terms. `parts` is each group's share of a term's score, in the order of `groups`.
export interface PubSigTerm { /** The bigger topic this one is part of. */ parent?: string; term: string; label: string; related: string[]; members: string[]; signal: number; change: number | null; isNew: boolean; kind: 'shared' | 'single' | 'mixed'; breadth: number; active: number; top: number; parts: number[]; /** Each group's own share of its items that mention the topic, in the order of `groups`. */ shares?: number[]; /** Only on a Signal with sources shown. */ reactions?: number; headlines?: Array<{ title: string; url: string; by: string; reactions?: number }> }
export interface PubSignal { slug: string; title: string; description: string; proof?: boolean; /** Topics were named by a language model. */ ai?: boolean; /** Topics left out because they are always around at the same level. */ steadyHidden?: number; days: number; from: string; to: string; baselineOk: boolean; volumeDays: string[]; groups: Array<{ name: string; weight: number; items: number; perDay: number[] }>;
  top: PubSigTerm[]; rising: PubSigTerm[]; shared: PubSigTerm[]; single: PubSigTerm[] }
const listTotal = (c: Ctx) => c.lists.length + c.alists.length + c.flists.length;
type PubPage = { topic: TopicInfo; issue: IssueFull; archive: Brief[] };
/** A Signal's top topics, as a strip on other pages: a name and its link. */
interface SigStrip { slug: string; title: string; area?: Area; topics: Array<{ term: string; label: string; isNew: boolean; change: number | null }> }

const ISSUE_ID = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;

// ---- pages
const date = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const every = (h: number) => (h < 24 ? `every ${h} hours` : h === 24 ? 'daily' : h === 48 ? 'every other day' : h === 168 ? 'weekly' : `every ${h} hours`);

const CSS = `
:root{--bg:#f6f5f1;--card:#fff;--text:#16201f;--muted:#5d6b6a;--line:#e0ddd4;--accent:#b0214f;--on-accent:#fff;--soft:#f9e9ee;--bar:#1f7a8c;--link:#0f6474;--amber:#e09a00;--amber-bg:#fde7a6;--amber-ink:#5c3300;
--sh1:0 1px 2px rgba(16,32,31,.06),0 1px 1px rgba(16,32,31,.04);--sh2:0 14px 30px -14px rgba(16,32,31,.38),0 2px 4px rgba(16,32,31,.05);--rail:#0c2a31;--rail-text:#b7cfd2;--rail-dim:#7b9ca1;--rail-on:rgba(255,255,255,.1);
--ui:"Bricolage Grotesque",system-ui,-apple-system,"Segoe UI",sans-serif;--read:Newsreader,"Iowan Old Style",Georgia,serif}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d1718;--card:#162a2d;--text:#e8efee;--muted:#93a8a6;--line:#263d40;--accent:#ff7aa1;--on-accent:#2a0614;--soft:#3a1626;--bar:#4cb5c6;--link:#7fd3df;--amber:#f5b93a;--amber-bg:#f5b93a;--amber-ink:#2a1700;--sh1:inset 0 1px 0 rgba(255,255,255,.04),0 1px 2px rgba(0,0,0,.45);--sh2:inset 0 1px 0 rgba(255,255,255,.07),0 16px 34px -14px rgba(0,0,0,.85);--rail:#06151a;--rail-on:rgba(255,255,255,.08);color-scheme:dark}}
:root[data-theme=dark]{--bg:#0d1718;--card:#162a2d;--text:#e8efee;--muted:#93a8a6;--line:#263d40;--accent:#ff7aa1;--on-accent:#2a0614;--soft:#3a1626;--bar:#4cb5c6;--link:#7fd3df;--amber:#f5b93a;--amber-bg:#f5b93a;--amber-ink:#2a1700;--sh1:inset 0 1px 0 rgba(255,255,255,.04),0 1px 2px rgba(0,0,0,.45);--sh2:inset 0 1px 0 rgba(255,255,255,.07),0 16px 34px -14px rgba(0,0,0,.85);--rail:#06151a;--rail-on:rgba(255,255,255,.08);color-scheme:dark}
:root[data-theme=light]{color-scheme:light}
.themebar{padding:0 10px}.themebtn{margin-top:10px;background:none;border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:8px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer}.themebtn:hover{background:var(--rail-on);color:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 var(--ui)}
a{color:var(--link);text-decoration-color:color-mix(in srgb,currentColor 40%,transparent);text-underline-offset:2px}a:hover{color:var(--accent)}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.app{min-height:calc(100vh - 56px)}
.brand{display:flex;align-items:center;gap:10px;color:#fff!important;font-weight:700;font-size:18px;letter-spacing:-.01em;text-decoration:none}
.brand svg{width:32px;height:32px;flex:none}.brand small{display:block;font-weight:500;font-size:12px;color:var(--rail-dim);letter-spacing:0;line-height:1.25}
.railfoot{margin:10px 0 0;padding:10px 10px 0;border-top:1px solid rgba(255,255,255,.12);font-size:12.5px;line-height:1.45;color:var(--rail-dim)}
.page{max-width:60rem;width:100%;margin:0 auto;padding:30px 16px 72px;min-width:0}
.pagehead{margin:0 0 26px}.eyebrow{font-size:12.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
h1{font-size:clamp(28px,5vw,40px);line-height:1.1;letter-spacing:-.025em;margin:0 0 8px}
.lede{color:var(--muted);margin:0 0 6px;font-size:17px;max-width:40rem}.meta{color:var(--muted);font-size:14px;margin:0 0 24px}
.topics{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px;padding:0;margin:0;list-style:none}
.topics li{display:flex}.topics a.card{display:flex;flex-direction:column;width:100%;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;text-decoration:none;color:inherit;transition:border-color .12s,transform .12s}
.topics a.card:hover{border-color:var(--accent);transform:translateY(-1px)}.topics h2{margin:0 0 4px;font-size:21px;letter-spacing:-.01em}
.topics p{margin:0;color:var(--muted)}.topics .tldr{color:var(--text);font-family:var(--read);font-size:17px;margin-top:10px}
.topics .foot{display:flex;justify-content:space-between;gap:10px;margin-top:auto;padding-top:14px;color:var(--muted);font-size:13px}.topics .tldr+.foot,.topics .foot{border-top:0}
.topics .card .eyebrow{margin-bottom:8px}
h2.sect{font-size:20px;margin:30px 0 12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:18px 0}.kpis div{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.kpis b{display:block;font-size:22px;letter-spacing:-.01em;font-variant-numeric:tabular-nums}.kpis span{font-size:13px;color:var(--muted)}
.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin:0 0 8px}.panel,.rank{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}.panel.wide{grid-column:1/-1}
.panels h3{margin:0 0 10px;font-size:15px}.panels h3 small{font-weight:400;color:var(--muted)}
.act{display:flex;align-items:flex-end;gap:2px;height:120px}.act i{flex:1;min-width:1px;background:var(--bar);border-radius:2px 2px 0 0}.axis{display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted);margin-top:4px}
.heat{display:grid;grid-template-columns:2.4rem repeat(24,minmax(0,1fr));gap:2px;font-size:11px;color:var(--muted)}.heat i{aspect-ratio:1.3;border-radius:2px;background:var(--bar)}.heat .h{text-align:center}
.rank div{display:grid;grid-template-columns:minmax(0,1fr) 5rem 4.5rem;align-items:center;gap:8px;margin:4px 0;font-size:14px}.rank span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rank i{display:block;height:10px;background:var(--bar);border-radius:3px}
.rank b{font-weight:600;text-align:right;font-variant-numeric:tabular-nums}.rank small{font-weight:400;color:var(--muted)}
.an{max-width:44rem}.an h2{font-size:18px;margin:1.2em 0 .3em}
.split{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--line)}.split i{display:block;height:100%}.for{background:#2f9e6e}.neu{background:#8a9a98}.against{background:var(--accent)}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px;margin:6px 0}.legend span{border-left:10px solid;padding-left:6px}.legend .for{border-color:#2f9e6e;background:none}.legend .neu{border-color:#8a9a98;background:none}.legend .against{border-color:var(--accent);background:none}.legend .dim{border:0;padding:0;color:var(--muted)}
.act.stack>div{flex:1;min-width:1px;display:flex;flex-direction:column;border-radius:2px 2px 0 0;overflow:hidden}.act.stack>div i{display:block;min-height:0;border-radius:0}
.tws{display:grid;gap:10px;margin:12px 0}.tw{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}.tw header{font-size:14px}.tw .dim{color:var(--muted)}.tw p{margin:6px 0 8px;overflow-wrap:anywhere}
.tw footer{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;color:var(--muted)}.tw footer a{margin-left:auto}
.pager{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:12px 0;font-size:14px;color:var(--muted)}
@media(max-width:520px){.rank div{grid-template-columns:minmax(0,1fr) 3.5rem 4rem}}
.hero{margin:0 0 22px}.hero img{display:block;width:100%;height:auto;border-radius:12px;background:var(--card)}.hero figcaption{margin-top:6px;font-size:12.5px;color:var(--muted)}
.hero.lead img{aspect-ratio:21/9;object-fit:cover}@media (max-width:640px){.hero.lead img{aspect-ratio:16/9}}.hero.lead figcaption a{color:inherit}
.listen{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 24px;padding:10px 14px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.listen .lbl{font-size:12.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}.listen audio{flex:1 1 260px;min-width:0;height:38px}.listen .dur{color:var(--muted);font-size:14px;font-variant-numeric:tabular-nums}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 28px}.chips a{padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--text);text-decoration:none;font-size:13.5px}.chips a:hover{border-color:var(--accent)}
.lgroup{margin:0 0 28px;scroll-margin-top:20px}.lgroup h3{font-size:17px;letter-spacing:-.01em;margin:0 0 10px}.lgroup h3 small,.sect small{color:var(--muted);font-weight:400;font-size:14px}
.lists .k{color:var(--muted);font-size:13px}.lists details{margin-top:6px;font-size:14px}.lists summary{cursor:pointer;color:var(--muted)}.lists ul.srcs{margin:6px 0 0;padding-left:1.2em}
.gnote{margin:-4px 0 12px;color:var(--muted);font-size:14.5px;max-width:44rem}
.lists{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px}
.lists li{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.lists .lname{font-weight:600;color:var(--text);text-decoration:none}.lists .lname:hover{color:var(--accent)}
.lists p{margin:4px 0 0;color:var(--muted);font-size:14px;line-height:1.45}
.views{display:none;gap:8px;margin:0 0 22px}.views a{padding:7px 14px;border:1px solid var(--line);border-radius:999px;color:var(--text);text-decoration:none;font-size:14px;background:var(--card)}
.views a[aria-current=page]{border-color:var(--accent);color:var(--accent);font-weight:600}
article{font-family:var(--read);font-size:19px;line-height:1.6}article h2,article h3,article h4{font-family:var(--ui);letter-spacing:-.01em;line-height:1.2;margin:1.6em 0 .4em}
article h2{font-size:24px}article h3{font-size:20px}article h4{font-size:17px}article p{margin:0 0 1em}article li{margin:.3em 0}
article code,article pre{font-size:.85em;background:color-mix(in srgb,var(--text) 7%,transparent);border-radius:5px;padding:1px 5px}article pre{padding:12px;overflow:auto}
article hr{border:0;border-top:1px solid var(--line);margin:1.8em 0}
.tw{overflow-x:auto;margin:1.2em 0}article table{border-collapse:collapse;width:100%;font:15px/1.45 var(--ui)}
article th{text-align:left;font-size:12.5px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--line);padding:6px 12px 6px 0}
article td{padding:9px 12px 9px 0;border-bottom:1px solid var(--line);vertical-align:top}article tr:last-child td{border-bottom:0}
article .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}article td:last-child,article th:last-child{padding-right:0}
figure.bars{margin:1.4em 0;font:14px var(--ui)}figure.bars figcaption{font-weight:600;margin-bottom:6px}
figure.bars div{display:grid;grid-template-columns:9rem 1fr 3rem;align-items:center;gap:8px;margin:3px 0}
figure.bars span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}figure.bars i{display:block;height:12px;background:var(--bar);border-radius:3px}figure.bars b{font-weight:600;text-align:right}
.src{margin-top:36px;padding-top:18px;border-top:1px solid var(--line);font-size:15px;color:var(--muted)}.src>summary{cursor:pointer;font-size:16px;font-weight:600;color:var(--text);margin:0 0 10px}.src>summary small{display:block;font-weight:400;font-size:14px;color:var(--muted);margin-top:2px}
.src p{margin:0 0 10px}.src ul{margin:0 0 12px;padding-left:1.2em}.src li{margin:4px 0}.src ul ul{margin:4px 0 6px}.src .c{white-space:nowrap}.src .k{opacity:.85}
.src .c::before{content:"· "}.src code{font-size:.9em;overflow-wrap:anywhere}.src details{margin:4px 0}.src summary{cursor:pointer}
.page>pre{font-size:.9em;background:var(--soft);border-radius:8px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.note{margin-top:40px;padding:14px 16px;background:var(--soft);border-radius:10px;color:var(--muted);font-size:14px}
.days{display:grid;gap:10px}.days details{background:var(--card);border:1px solid var(--line);border-radius:12px}
.days summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:8.5rem 1fr 1rem;gap:14px;align-items:baseline;padding:14px 16px}
.days summary::-webkit-details-marker{display:none}.days summary::after{content:"+";color:var(--muted);text-align:right}.days details[open] summary::after{content:"\\2212"}
.days summary time{color:var(--muted);font-size:14px;white-space:nowrap}.days summary span{font-family:var(--read);font-size:17px}
.days summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:12px}.days details[open] summary{border-bottom:1px solid var(--line)}
.days .aud{font-family:var(--ui,inherit);font-style:normal;font-size:13px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums;margin-left:6px}
.days .body{padding:6px 20px 16px}.days .perma{font-size:14px;margin:0}
@media(max-width:860px){.page{padding:24px 16px 56px}.views{display:flex}}
@media(max-width:520px){.days summary{grid-template-columns:1fr 1rem}.days summary time{grid-column:1}.days summary span{grid-column:1}.days summary::after{grid-row:1/3;grid-column:2}
figure.bars div{grid-template-columns:6rem 1fr 2.5rem}nav.archive li{grid-template-columns:1fr}}
.sgwin{display:flex;gap:4px;margin:0 0 12px;flex-wrap:wrap}.sgwin a{padding:5px 14px;border-radius:999px;border:1px solid var(--line);color:var(--text);text-decoration:none;font-size:14px;background:var(--card)}.sgwin a[aria-current=page]{border-color:var(--accent);color:var(--accent);font-weight:600}
.sglegend{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:14px;margin:6px 0 4px}.sglegend i,.sgrow .bar i{display:inline-block}.sglegend i{width:11px;height:11px;border-radius:3px;margin-right:6px}.sglegend small{color:var(--muted)}
.sgrows{display:flex;flex-direction:column;gap:6px}.sgrow.sgpart .t{padding-left:18px;position:relative;font-weight:400}.sgrow.sgpart .t::before{content:'└';position:absolute;left:3px;color:var(--muted)}.sgrow{display:grid;grid-template-columns:minmax(90px,200px) minmax(0,1fr) 3.4rem minmax(0,200px);gap:12px;align-items:center;font-size:15px}
.sgrow .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.sgrow .t small{display:block;font-weight:400;font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis}.sgrow .bar{display:flex;height:16px;border-radius:4px;overflow:hidden}.sgrow .bar i{display:block;min-width:2px}
.sgrow b{text-align:right;font-weight:500;font-variant-numeric:tabular-nums;color:var(--muted)}.sgrow .cs{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.chip{font-size:12px;padding:0 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}.chip.shared{color:#1a7f5a;border-color:#1a7f5a}.chip.single{color:#7c5cbf;border-color:#7c5cbf}.chip.up{color:var(--accent);border-color:var(--accent)}
.sglist{list-style:none;margin:0;padding:0}.sglist li{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line);font-size:14.5px}.sglist small{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.act.stack>div i{min-height:0}
.sgitems{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}.sgitems li{border-left:3px solid var(--line);padding-left:12px}.sgitems .by{font-size:13px;color:var(--muted)}.sgitems a{color:var(--text)}.sgitems a:hover{color:var(--accent)}.sgrow .t a{color:inherit;text-decoration:none}.sgrow .t a:hover{color:var(--accent);text-decoration:underline}.sglist a{color:inherit;text-decoration:none}.sglist a:hover{text-decoration:underline}
form.report{display:grid;gap:12px;max-width:640px}form.report textarea{width:100%;font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text)}form.report button{justify-self:start;padding:8px 18px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text);font:inherit;cursor:pointer}.hp{position:absolute;left:-9999px}.cites .rep{color:var(--muted)}
.meacts{margin:10px 0 0}.meform.inline{display:inline}.followbtn{font:inherit;font-size:14px;font-weight:600;padding:5px 14px;border-radius:999px;border:1px solid var(--accent);background:var(--card);color:var(--accent);cursor:pointer}.followbtn[aria-pressed=true]{background:var(--accent);color:var(--card)}
.memsg{margin:10px 0 0;padding:8px 12px;border-left:3px solid var(--accent);background:var(--card);border-radius:6px;font-size:14px}
.askbox{display:grid;gap:8px;margin:14px 0 0;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--card);max-width:720px}.askbox label{font-weight:600}.askbox textarea,.lensform textarea,.lensform input,.meform select{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg,var(--card));color:var(--text);max-width:100%}
.askrow{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.askrow small{color:var(--muted)}.meform button{font:inherit;padding:7px 16px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}.meform button[type=submit]:not(.ghost):not(.followbtn){border-color:var(--accent)}.meform button:disabled{opacity:.5;cursor:default}
.mepage{display:grid;gap:16px;max-width:760px}.mepage .card{display:block;padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:var(--card)}.mepage h3{margin:0 0 6px}.mepage label{display:inline-flex;gap:6px;align-items:center;margin:4px 10px 4px 0}
.lensform{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin:8px 0}.lensform label.wide{display:flex;flex-direction:column;align-items:stretch;width:100%}.mylens{border-top:1px solid var(--line);padding:8px 0}.mylens summary{cursor:pointer}
.mefollows,.measks,.yours ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}.mefollows li,.measks li,.yours li{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.measks small,.yours small{color:var(--muted)}
.yours{margin:18px 0;padding:14px 18px;border:1px solid var(--line);border-radius:14px;background:var(--card)}.yours .sect{margin-top:0}.askanswer{max-width:720px}
.vlead{margin:0 0 24px}.vplayer{position:relative;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000}.vplayer iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.vlead h2{font-size:20px;margin:12px 0 4px}.vlead h2 a{color:var(--text);text-decoration:none}.vlead small.out{margin-left:8px;color:var(--accent,#c9265f)}
.vcards{list-style:none;padding:0;margin:0 0 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}.vcards li{display:flex;flex-direction:column;gap:4px}.vcards a{color:var(--text);text-decoration:none}.vcards img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:10px;display:block;margin-bottom:6px;background:var(--card)}.vcards b{font-weight:600;line-height:1.3}.vcards small,.vlead small,.vlist small{color:var(--muted);font-size:13px}.vcards small a{color:var(--muted)}
.vlist{list-style:none;padding:0;margin:0;display:grid;gap:12px}.vlist li{display:flex;flex-direction:column;border-bottom:1px solid var(--line);padding-bottom:10px}.vlist a{color:var(--text);font-weight:600}
.tsearch{display:flex;gap:8px;align-items:center;margin:0 0 18px}.tsearch input{flex:1;max-width:360px;font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--text)}.tsearch button{font:inherit;padding:7px 16px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}
.az{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 10px}.az a{min-width:28px;text-align:center;padding:3px 6px;border:1px solid var(--line);border-radius:8px;text-decoration:none;color:var(--text);font-size:13px}
.azh{font-size:14px;margin:16px 0 6px;color:var(--muted)}.azl{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px}.azl li{display:flex;gap:6px;align-items:baseline;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card)}.azl a{color:var(--text);text-decoration:none}.azl small{color:var(--muted);font-size:12px}
.views a.rss{margin-left:auto;font-size:13px}
.inbrief{border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:14px 0 20px;background:var(--card)}.inbrief h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}.inbrief ol{margin:0;padding-left:20px}.inbrief li{margin:3px 0}.inbrief small.up,.today small .up{color:var(--accent,#c9265f)}
article h3[id]{scroll-margin-top:16px}.thm{display:flex;flex-wrap:wrap;gap:6px;margin:-4px 0 8px}.chip.sig{text-decoration:none;color:var(--text)}.cites{font-size:13px;color:var(--muted);margin:-4px 0 18px}
article h3[id^="notable"]+ul{list-style:none;padding:0;display:grid;gap:8px}article h3[id^="notable"]+ul li{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--card)}
.daynav{display:flex;justify-content:space-between;gap:10px;margin:22px 0}.daynav a{display:flex;flex-direction:column;padding:8px 14px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--text)}.daynav a small{color:var(--muted);font-size:12px}.daynav .next{text-align:right}
.others{list-style:none;padding:0;margin:0;display:grid;gap:10px}.others li{display:flex;flex-direction:column}.others span{color:var(--muted);font-size:14.5px}
.today{list-style:none;padding:0;margin:0 0 10px;display:grid;gap:16px}.today li{border-bottom:1px solid var(--line);padding-bottom:14px}.today .h{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.today .h a{text-decoration:none;color:var(--text);font-size:18px}.today small{color:var(--muted)}.today p{margin:6px 0}.today .th,.daylist .th{font-size:14px;color:var(--muted)}.today .th a,.daylist .th a{color:var(--muted)}
.daylist{list-style:none;padding:0;margin:0;display:grid;gap:14px}.daylist li{display:grid;grid-template-columns:9rem minmax(0,1fr);gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px}.daylist p{margin:0 0 4px}.daylist .d{text-decoration:none;font-weight:600}
@media(max-width:860px){.daylist li{grid-template-columns:1fr}}
.sgstrip{margin:18px 0 22px}.sgstrip h2{display:flex;justify-content:space-between;gap:10px;align-items:baseline;font-size:15px;margin:0 0 8px}.sgstrip h2 a{font-weight:400;font-size:13.5px;color:var(--muted)}
.sgstrip div{display:flex;flex-wrap:wrap;gap:6px}.sgstrip div a{padding:4px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--text);text-decoration:none;font-size:14px}.sgstrip small.up{color:var(--accent,#c9265f)}
.chip.react{color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.stat{border:1px solid var(--line);border-radius:12px;padding:10px 14px;background:var(--card)}.stat b{display:block;font-size:24px;letter-spacing:-.02em}.stat span{color:var(--muted);font-size:13px}
.papers{list-style:none;margin:10px 0 24px;padding:0;display:grid;gap:12px}.papers li{border:1px solid var(--line);border-radius:12px;padding:12px 16px;background:var(--card);min-width:0;overflow-wrap:anywhere}.papers h3{margin:0;font-size:17px;line-height:1.3}.papers p{margin:4px 0 0;font-size:14px}.papers .pby,.papers .plinks{color:var(--muted)}.papers .psig{display:flex;flex-wrap:wrap;gap:4px 14px}.papers details{margin-top:6px;font-size:14px}.papers summary{cursor:pointer;color:var(--muted)}
.credit{margin:40px 0 0;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.pulse{display:grid;gap:12px;margin:18px 0}.pulse article{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--card);display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,240px);gap:6px 18px;align-items:center}.pulse h2{margin:0;font-size:18px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.pulse p{margin:2px 0 0;color:var(--muted);font-size:14px}.pulse svg{width:100%;height:56px;display:block}.pstate{font-size:12px;font-weight:600;padding:1px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}.pstate.spike{color:var(--accent);border-color:var(--accent)}.pstate.rising{color:var(--accent)}@media(max-width:560px){.pulse article{grid-template-columns:1fr}}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px}
.sgrow .hl{grid-column:1/-1;font-size:13.5px;color:var(--muted);margin-top:-2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sgrow .hl a{color:var(--muted)}.sgrow .hl small{margin-left:4px}
.sgview>input{position:absolute;opacity:0;pointer-events:none}.sgtabs{display:inline-flex;gap:4px;margin:0 0 10px}.sgtabs label{padding:5px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:14px;cursor:pointer}
#sgv1:checked~.sgtabs label[for=sgv1],#sgv2:checked~.sgtabs label[for=sgv2]{border-color:#c9265f;font-weight:600}#sgv1:checked~.v2,#sgv2:checked~.v1{display:none}
.sgwhere .cells{display:grid;gap:6px}.sgwhere .cell{position:relative;height:20px;border-radius:4px;background:var(--card);overflow:hidden}.sgwhere .cell i{position:absolute;inset:0 auto 0 0;opacity:.85}.sgwhere .cell em{position:relative;font-style:normal;font-size:12px;padding-left:6px;line-height:20px;color:#fff;text-shadow:0 0 3px rgba(0,0,0,.6)}
.sgcols{display:grid;gap:6px;margin:0 0 4px calc(min(200px,30%) + 12px);margin-right:calc(3.4rem + min(200px,30%) + 24px);font-size:13px;color:var(--muted)}.sgcols span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:700px){.sgcols{display:none}.sgwhere .cells{grid-column:1/-1}.sgrow{grid-template-columns:minmax(0,1fr) 3.4rem}.sgrow .bar,.sgrow .cs{grid-column:1/-1}.sgrow .cs{justify-content:flex-start}}
.pstate.new{color:var(--accent);border-color:var(--accent)}.pstate.falling{font-style:italic}
.tophead{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:8px 24px;align-items:center;margin:0 0 4px}.tophead .spark svg{display:block;width:100%;height:64px}.tophead .meta{margin:0}
@media(max-width:700px){.tophead{grid-template-columns:minmax(0,1fr)}}
.evstrip{list-style:none;margin:0 0 8px;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.ev{display:flex;flex-direction:column;gap:2px;border:1px solid var(--line);border-left:3px solid var(--bar);border-radius:10px;padding:10px 12px;background:var(--card);min-width:0;font-size:14px;overflow-wrap:anywhere}
.ev b{font-size:13px;letter-spacing:.02em}.ev small{color:var(--muted)}.ev.score{border-left-color:var(--accent)}.ev a{font-size:13px}
.sumfrom{margin:8px 0 0;font-size:13.5px;color:var(--muted)}.sumfrom summary{cursor:pointer}.sumfrom ul{margin:6px 0 0;padding-left:1.2em}
.angles a small{color:var(--muted)}
.life{margin:6px 0 8px;padding:14px 16px 12px;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:var(--sh1)}.lifehead{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}.lifehead .sect{margin:0}
.lifeviz svg{display:block;width:100%;height:auto;overflow:visible}.lifeviz .axis{display:flex;justify-content:space-between;color:var(--muted);font-size:12.5px}
.life .lbar{fill:var(--line)}.life .lbar:hover{fill:var(--muted)}.life .lcurve{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linecap:round;vector-effect:non-scaling-stroke}.life .lus{stroke:var(--muted);stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
.life .lpk{fill:var(--accent);stroke:var(--card);stroke-width:2;vector-effect:non-scaling-stroke}.life .lnow{fill:var(--card);stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}.life .lpt{fill:var(--text);font-size:12px;font-weight:700;paint-order:stroke;stroke:var(--card);stroke-width:3px}
.lifesay{margin:8px 0 6px;font-size:15px}
.ltrack{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px;font-size:13px;color:var(--muted)}.ltrack li{display:flex;align-items:center;gap:5px;padding:3px 10px;border:1px dashed var(--line);border-radius:999px}
.ltrack li.loop{margin-left:auto}.ltrack li.on{border:1px solid currentColor;font-weight:700}
.phase{display:inline-flex;align-items:center;gap:5px;padding:2px 10px;border-radius:999px;font-weight:700;font-size:13.5px;white-space:nowrap;border:1px solid currentColor}.phase.sm{font-size:12px;padding:1px 8px;align-self:flex-start}
.ph-emerging{--ph:#1f8a5b}.ph-peaking{--ph:var(--accent)}.ph-fading{--ph:var(--muted)}.ph-returning{--ph:#7c5cbf}.ph-steady{--ph:var(--bar)}
.phase,.ltrack li.on{color:var(--ph)}.life .ltrack li.on{color:var(--ph)}.ltrack li:nth-child(1).on{--ph:#1f8a5b}.ltrack li:nth-child(2).on{--ph:var(--accent)}.ltrack li:nth-child(3).on{--ph:var(--muted)}.ltrack li.loop.on{--ph:#7c5cbf}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) .ph-emerging,:root:not([data-theme=light]) .ltrack li:nth-child(1).on{--ph:#5fd39b}:root:not([data-theme=light]) .ph-returning,:root:not([data-theme=light]) .ltrack li.loop.on{--ph:#b8a1f0}}
:root[data-theme=dark] .ph-emerging,:root[data-theme=dark] .ltrack li:nth-child(1).on{--ph:#5fd39b}:root[data-theme=dark] .ph-returning,:root[data-theme=dark] .ltrack li.loop.on{--ph:#b8a1f0}
@media(max-width:560px){.ltrack li.loop{margin-left:0}.spread .sbl{font-size:22px}.spread .sax,.tstream .sax{font-size:22px}.spin circle{r:14px}.spin text{font-size:16px}.tsl{font-size:22px}.life .lpt{font-size:20px}}
.spread{margin:0 0 4px;padding:10px 12px 4px;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:var(--sh1)}.spread svg{display:block;width:100%;height:auto}
.sb{stroke:var(--card);stroke-width:1.2;fill-opacity:.88}.sb:hover{fill-opacity:1}.sbl{fill:#fff;font-size:12.5px;font-weight:700;pointer-events:none;paint-order:stroke;stroke:rgba(0,0,0,.28);stroke-width:2.5px}
.smid{stroke:var(--line);stroke-dasharray:2 4}.sax{fill:var(--muted);font-size:12px}.srail{stroke:var(--line)}.spaper{fill:var(--k-arxiv);stroke:var(--card);stroke-width:1.5}
.spin circle{fill:var(--card);stroke:var(--text);stroke-width:2}.spin text{fill:var(--text);font-size:11.5px;font-weight:800}
.k-x{fill:var(--k-x);background:var(--k-x)}.k-hn{fill:var(--k-hn);background:var(--k-hn)}.k-youtube{fill:var(--k-youtube);background:var(--k-youtube)}.k-rss{fill:var(--k-rss);background:var(--k-rss)}
.sflow{list-style:none;margin:10px 0 4px;padding:0;display:flex;flex-wrap:wrap;gap:6px 10px;font-size:14px}.sflow li{display:flex;align-items:center;gap:6px}.sflow li+li::before{content:"→";color:var(--muted);margin-right:4px}
.sflow .sk{width:12px;height:12px;border-radius:3px;flex:none}.sflow small{color:var(--muted)}
:root{--k-x:#1f7a8c;--k-hn:#d9480f;--k-youtube:#c2255c;--k-rss:#6741d9;--k-arxiv:#2b8a3e}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--k-x:#3fa5b8;--k-hn:#f76707;--k-youtube:#e64980;--k-rss:#845ef7;--k-arxiv:#40c057}}
:root[data-theme=dark]{--k-x:#3fa5b8;--k-hn:#f76707;--k-youtube:#e64980;--k-rss:#845ef7;--k-arxiv:#40c057}
.tstream{margin:0 0 18px;padding:12px 14px 6px;border:1px solid var(--line);border-radius:16px;background:var(--card);box-shadow:var(--sh1)}.tstream svg{display:block;width:100%;height:auto}
.tsb{stroke:var(--card);stroke-width:1.2;fill-opacity:.86;transition:fill-opacity .15s}.tstream a:hover .tsb,.tstream a:focus .tsb{fill-opacity:1;stroke:var(--text);stroke-width:1.5}.tstream:hover .tsb{fill-opacity:.55}.tstream:hover a:hover .tsb{fill-opacity:1}
.tsl{fill:#fff;font-weight:700;pointer-events:none;paint-order:stroke;stroke:rgba(0,0,0,.3);stroke-width:2.5px}
.tskey{list-style:none;margin:8px 0 2px;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13.5px}.tskey li{display:flex;align-items:center;gap:6px}.tskey .sk{width:11px;height:11px;border-radius:3px}.tskey a{color:var(--text);text-decoration:none}.tskey a:hover{color:var(--accent);text-decoration:underline}
.tline{margin:0 0 6px}.tline svg{display:block;width:100%;height:auto;max-width:30rem}.tline text{fill:var(--muted);font-size:13px}.tline .base{stroke:var(--line);stroke-width:1}.tline .lane{stroke:var(--line);stroke-width:1;stroke-dasharray:2 4}.tline .dot{fill:var(--bar);stroke:var(--card);stroke-width:1.5}
.tkey{list-style:none;margin:0 0 6px;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;color:var(--muted)}.tkey b{color:var(--bar);margin-right:4px}.twords{margin:0 0 20px;padding-left:1.2em;color:var(--muted);font-size:13.5px}
.firstsay{font-size:17px;max-width:44rem;margin:0 0 12px}.firstlist{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:10px;max-width:44rem}.firstlist li{border-left:3px solid var(--bar);padding-left:12px}.firstlist .when{color:var(--muted);font-size:13.5px}.firstlist .fnum{display:inline-block;min-width:1.6em;font-weight:700;color:var(--bar)}
.watchcards small{color:var(--muted)}.watchcards .play{position:relative;display:block}.watchcards .play::after{content:'▶';position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.65);color:#fff;border-radius:6px;padding:1px 7px;font-size:12px}
${lensColorCss()}
.lenshead{margin:0 0 14px;padding:10px 14px;border-left:4px solid var(--lc);background:var(--card,rgba(127,127,127,.08));border-radius:0 8px 8px 0}.lenshead h1{margin:2px 0 4px;font-size:22px}.lenshead p{margin:0;color:var(--muted)}
.lensbar{align-items:center}.lenslbl{font-size:13px;color:var(--muted);margin-right:4px}.lensbar a .lsw{display:inline-block;width:9px;height:9px;border-radius:3px;background:var(--lc);margin-right:6px}
.lensbar a[aria-current=page]{border-color:var(--lc,var(--accent));box-shadow:inset 0 0 0 1px var(--lc,var(--accent));font-weight:600}
.lenstag{display:inline-block;font-size:12px;padding:0 8px;border-radius:999px;border:1px solid var(--lc);color:var(--lc);white-space:nowrap;text-decoration:none}
.lensin{border-left:3px solid var(--lc);padding-left:8px}li.lensin{border-left-width:3px}
.lensout{opacity:.7}.lensout:hover,.lensout:focus-within{opacity:1}
.outside{margin:0 0 14px;font-size:14.5px;border-left:3px solid var(--line);padding-left:10px}.outside b{font-weight:600}
.azl li.lensin{padding-left:8px}
.topbar{position:sticky;top:0;z-index:5;background:var(--rail);color:var(--rail-text);border-bottom:1px solid rgba(255,255,255,.1)}.topbar a{color:inherit}
.tb{position:relative;max-width:72rem;margin:0 auto;padding:10px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.tb .brand{padding:0;font-size:17px}.tb .brand svg{width:28px;height:28px}.tb .brand small{display:inline;margin-left:6px}
.tb .sgwin{margin:0}.tb .sgwin{gap:4px}.tb .sgwin a{background:transparent;color:inherit;border-color:rgba(255,255,255,.22);padding:3px 9px;font-size:13px}.tb .sgwin a[aria-current=page]{color:#fff;border-color:#fff}.tb .lenslbl{color:var(--rail-dim)}
.tb .lensbar a[aria-current=page]{border-color:#fff;box-shadow:none}
.tb form{display:flex;gap:6px;margin-left:auto}.tb input{font:inherit;font-size:14px;padding:3px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;width:8rem;max-width:100%}.tb input::placeholder{color:var(--rail-dim)}
.tb button.go{font:inherit;font-size:13.5px;padding:3px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:none;color:inherit;cursor:pointer}
.more{position:static}.more>summary{cursor:pointer;list-style:none;padding:3px 11px;border:1px solid rgba(255,255,255,.22);border-radius:999px;font-size:13.5px}.more>summary::-webkit-details-marker{display:none}
.more>div{position:absolute;right:16px;top:calc(100% - 4px);z-index:6;width:19rem;max-width:calc(100vw - 32px);max-height:70vh;overflow-y:auto;background:var(--rail);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:8px;display:flex;flex-direction:column}
.more>div a{padding:6px 10px;border-radius:8px;text-decoration:none;font-size:14.5px}.more>div a:hover{background:var(--rail-on);color:#fff}.more .grp{padding:10px 10px 2px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--rail-dim)}.more a[aria-current=page]{background:var(--rail-on);color:#fff;font-weight:600;box-shadow:inset 3px 0 0 var(--accent)}.more small{color:var(--rail-dim)}.more .themebar{padding:6px 4px 2px}
.page.wide{max-width:72rem}
.since{margin:0 0 18px;font-size:15.5px}.since .sincelbl{font-weight:700}.since .sincehint{color:var(--muted)}
.lgrid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:8px 28px;margin:0 0 6px}@media(max-width:820px){.lgrid{grid-template-columns:minmax(0,1fr)}}
.lh{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px;font-weight:600}.lh a{text-transform:none;letter-spacing:0;font-weight:400;font-size:13.5px;margin-left:8px}
.brief{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:9px}.brief li{padding-left:14px;position:relative;font-family:var(--read);font-size:17.5px;line-height:1.35}.brief li::before{content:'•';position:absolute;left:0;color:var(--accent)}.brief a{color:var(--text);text-decoration:none}.brief a:hover{color:var(--accent);text-decoration:underline}.brief small{font-family:var(--ui);font-size:12.5px;color:var(--muted);margin-left:6px}
.lrows{list-style:none;margin:0;padding:0;display:grid;gap:5px}.lrow{display:grid;grid-template-columns:minmax(0,1fr) 5.5rem 3.2rem;gap:2px 10px;align-items:center;font-size:14.5px}
.lrow .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.lrow .t a{color:inherit;text-decoration:none}.lrow .t a:hover{color:var(--accent);text-decoration:underline}.lrow.part .t{padding-left:16px;font-weight:400}
.lrow .lb{display:block;height:9px;background:var(--line);border-radius:3px;overflow:hidden}.lrow .lb i{display:block;height:100%;background:var(--bar)}.lrow b{text-align:right;font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
.lrow .tags{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px 6px;margin-bottom:3px}.lrow .tags:empty{display:none}.lrow.lensin .t{border-left:3px solid var(--lc);padding-left:7px}
.slot{min-height:0}
.rise{display:flex;flex-wrap:wrap;gap:6px 10px;margin:0;padding:10px 0;border-block:1px solid var(--line);align-items:baseline}.rise b{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}.rise a{text-decoration:none;color:var(--text);white-space:nowrap}.rise a:hover{color:var(--accent)}.rise .up{color:var(--accent)}.rise small{color:var(--muted)}
.lcards{list-style:none;margin:0 0 12px;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.lcard{border:1px solid var(--line);border-top:3px solid var(--lc,var(--line));border-radius:12px;padding:12px 14px;background:var(--card);display:flex;flex-direction:column;gap:6px;min-width:0}
.lcard h3{margin:0;font-size:16px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}.lcard h3 a{color:var(--text);text-decoration:none}.lcard h3 a:hover{color:var(--accent)}.lcard p{margin:0;font-size:14px;color:var(--muted)}.lcard svg{display:block;width:100%;height:36px}.lcard small{color:var(--muted);font-size:12.5px}
.rstrip{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:12px 16px;margin:6px 0}.rstrip p{margin:0 0 6px}.rstrip ol{margin:6px 0;padding-left:20px}.rstrip li{margin:3px 0}
.wr{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin:0 0 8px}.wr ul{list-style:none;margin:0;padding:0;display:grid;gap:9px}.wr li{display:flex;flex-direction:column}.wr a{color:var(--text);font-weight:600;text-decoration:none}.wr a:hover{color:var(--accent)}.wr small{color:var(--muted);font-size:13px}.wr h3{font-size:14px;margin:0 0 8px;color:var(--muted)}
.tb .themebtn{margin:0}.mebtn{display:inline-flex;border-radius:50%;padding:2px;border:2px solid transparent;line-height:0}.mebtn img{width:30px;height:30px;border-radius:50%;object-fit:cover;display:block}.mebtn:hover,.mebtn:focus-visible,.mebtn[aria-current=page]{border-color:var(--accent,#ff7aa1)}.more .themebtn{border-color:rgba(255,255,255,.22)}
@media(max-width:560px){.topbar{position:relative}.tb form{margin-left:0;flex:1 1 100%;min-width:0}.tb input{width:auto;flex:1;min-width:0}.more>div{left:16px;right:16px;width:auto;max-width:none}.more>div .themebtn{margin-top:0}}
/* ---- the visual layer: headings, depth, state colours, the masthead, briefing cards, motion */
h1{font-weight:800;font-variation-settings:"opsz" 72}
.topbar{border-bottom:0}.topbar::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,var(--accent),var(--amber) 45%,transparent 85%);pointer-events:none}
.lh,h2.sect{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;font-size:21px;font-weight:750;letter-spacing:-.015em;text-transform:none;color:var(--text);margin:32px 0 12px;font-variation-settings:"opsz" 48}
.lh::before,h2.sect::before{content:'';align-self:center;width:18px;height:4px;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--amber));flex:none}
.lh a{margin-left:auto;font-size:13.5px;font-weight:500;letter-spacing:0}.lgrid>div>section:first-child .lh{margin-top:6px}
.topics a.card,.lcard,.panel,.rank,.kpis div,.tw,.lists li,.rstrip,.stat,.papers li,.pulse article,.days details,.inbrief,.ev,.listen,.daynav a,.vizlink{box-shadow:var(--sh1)}
.topics a.card,.lcard,.daynav a,.vizlink,.papers li,.lists li{transition:box-shadow .18s,transform .18s,border-color .18s}
.topics a.card:hover,.lcard:hover,.daynav a:hover,.vizlink:hover,.papers li:hover,.lists li:hover{box-shadow:var(--sh2);transform:translateY(-2px)}
.pstate{border:0;padding:1px 9px;font-weight:700;letter-spacing:.01em;white-space:nowrap}
.pstate.new{background:var(--amber-bg);color:var(--amber-ink)}.pstate.rising{background:var(--accent);color:var(--on-accent)}
.pstate.spike{background:var(--accent);color:var(--on-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent),0 0 16px color-mix(in srgb,var(--accent) 45%,transparent)}
.pstate.falling{background:none;border:1px solid var(--line);color:var(--muted);font-style:normal}
.chip.up{background:var(--soft);border-color:transparent;font-weight:600}
.rise{gap:8px;padding:14px 0;margin:8px 0 0}.rise b{margin-right:4px}.rise a{padding:4px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:14.5px;transition:transform .15s}
.rise a:hover{transform:translateY(-1px);color:inherit}.rise a small{color:inherit;opacity:.75}
.rise a.new{background:var(--amber-bg);color:var(--amber-ink);border-color:transparent;font-weight:600}.rise a.rising{background:var(--soft);color:var(--accent);border-color:transparent;font-weight:600}.rise a.falling{color:var(--muted)}
.lrows{gap:7px}.lrow .lb{height:12px;border-radius:6px;background:color-mix(in srgb,var(--line) 70%,transparent)}
.lrow .lb i{border-radius:6px;background:linear-gradient(90deg,var(--bar),color-mix(in srgb,var(--bar) 55%,var(--accent)));transform-origin:left;animation:grow .8s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i,0) * 45ms)}
.lrow.st-rising .lb i{background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 60%,var(--amber)))}.lrow.st-new .lb i{background:linear-gradient(90deg,var(--amber),color-mix(in srgb,var(--amber) 55%,var(--accent)))}.lrow.lensin .lb i{background:var(--lc)}
.lrow .tags{align-items:center}.lrow .tags .meta{margin:0}.mix{display:inline-flex;width:56px;height:6px;border-radius:3px;overflow:hidden;align-self:center;background:var(--line)}.mix i{display:block;min-width:2px}
.lcard{border-top-width:4px;box-shadow:var(--sh1)}.lcard:not([class*=" lc-"]).st-rising{border-top-color:var(--accent)}.lcard:not([class*=" lc-"]).st-new{border-top-color:var(--amber)}.lcard:not([class*=" lc-"]).st-steady,.lcard:not([class*=" lc-"]).st-falling{border-top-color:var(--bar)}
.wave{display:flex;align-items:center;gap:10px;margin:44px 0 0;color:var(--line)}.wave::before,.wave::after{content:'';flex:1;height:2px;background:currentColor;border-radius:1px}.wave svg{width:36px;height:18px;flex:none;color:var(--accent)}.wave svg+span+svg{color:var(--bar)}
.wave span{flex:none;font-size:13px;font-weight:600;color:var(--muted);letter-spacing:.01em}@media(max-width:520px){.wave span{font-size:12px;white-space:normal;text-align:center;flex:0 1 auto}}.wave+.credit{border-top:0;margin-top:10px;padding-top:0}
.app{overflow-x:clip}.page.home{padding-top:0}
.mast{position:relative;isolation:isolate;overflow:hidden;margin:0 calc(50% - 50vw) 8px;padding:40px max(16px,calc(50vw - 35rem)) 36px;color:#e9f3f4;background:radial-gradient(90% 130% at 88% -10%,#17505c 0%,transparent 60%),radial-gradient(60% 90% at 0% 110%,rgba(176,33,79,.28) 0%,transparent 65%),var(--rail)}
.mast a{color:#fff;text-decoration-color:rgba(255,255,255,.4)}.mast a:hover{color:#ffc2d6}
.mastwave{position:absolute;inset:auto 0 0 0;width:100%;height:170px;z-index:-1;overflow:visible}.mastwave g{animation:drift 70s linear infinite}.mastwave path{fill:none;stroke-width:2;vector-effect:non-scaling-stroke}
.mastwave .c1 path{stroke:rgba(127,211,223,.13)}.mastwave .c2{animation-duration:110s}.mastwave .c2 path{stroke:rgba(255,143,184,.12)}.mastwave .c3{animation-duration:50s}.mastwave .c3 path{fill:rgba(127,211,223,.05);stroke:rgba(127,211,223,.09)}
@keyframes drift{to{transform:translateX(-1200px)}}
.mastlede .tagline{display:block;color:#fff;font-size:19px;font-weight:650;letter-spacing:-.01em;margin-bottom:4px}
.mastin{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:24px 36px;align-items:center}.mast.nobub .mastin{grid-template-columns:minmax(0,1fr)}.mast.nobub .masttext{max-width:46rem}
.masteye{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#9fc3c8;margin:0 0 12px}.masteye .lsw{width:10px;height:10px;border-radius:3px;background:var(--lc)}
.mast h1{font-size:clamp(32px,4.4vw,54px);line-height:1.06;letter-spacing:-.022em;margin:0 0 14px;font-variation-settings:"opsz" 60;text-wrap:balance}
.mast h1.long{font-size:clamp(28px,3.4vw,42px)}.mast h1 a{text-decoration:none;background:linear-gradient(90deg,#ff8fb8,#ffc56b);-webkit-background-clip:text;background-clip:text;color:transparent}.mast h1 a:hover{text-decoration:underline;text-decoration-color:#ff8fb8}
.mastlede{margin:0 0 20px;color:#b7cfd2;font-size:16.5px;max-width:34rem}
.lensmast{border-top:4px solid var(--lc)}
.since{display:flex;flex-wrap:wrap;gap:10px;margin:0;font-size:14px}.since .sincelbl{flex-basis:100%;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:#9fc3c8;font-weight:600}
.since .tile{display:flex;flex-direction:column;min-width:7.5rem;padding:10px 14px 11px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#b7cfd2;line-height:1.25;backdrop-filter:blur(4px)}
.since .tile b{font-size:40px;font-weight:800;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums;margin-bottom:4px;font-variation-settings:"opsz" 96}
.since .t-new b{color:#ffc56b}.since .t-rising b{color:#ff8fb8}.since .t-papers b{color:#7fd3df}
.since .sincehint{flex-basis:100%;color:#9fc3c8;font-size:14px}.since .sincehint a{color:#fff}
.mastviz .vizbox.land{margin:0;border:0;border-radius:16px;background:#142224;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 30px 60px -30px rgba(0,0,0,.7)}.mastviz .vizbox.land iframe{height:380px;animation:fade .8s .2s both}
.minibub{display:none;list-style:none;margin:18px 0 0;padding:0;flex-wrap:wrap;gap:8px;align-items:center}
.minibub li{width:var(--s);height:var(--s);border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;padding:6px;background:rgba(127,211,223,.16);border:1px solid rgba(127,211,223,.5);animation:pop .5s cubic-bezier(.2,.9,.3,1.3) both}
.minibub li.new{background:#f5b93a;border-color:#f5b93a}.minibub li.rising{background:#ff7aa1;border-color:#ff7aa1}
.minibub a{color:#e9f3f4;text-decoration:none;font-size:11.5px;font-weight:700;line-height:1.15;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow-wrap:anywhere}.minibub .new a{color:#2a1700}.minibub .rising a{color:#2a0614}
.bcards{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:12px}
.bcards li{display:grid;grid-template-columns:118px minmax(0,1fr);gap:14px;align-items:start;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px;box-shadow:var(--sh1);transition:box-shadow .18s,transform .18s,border-color .18s}
.bcards li:hover{box-shadow:var(--sh2);transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 35%,var(--line))}
.bimg{display:block;border-radius:10px;overflow:hidden;aspect-ratio:4/3;background:var(--line)}.bimg img,.bimg .ph{display:block;width:100%;height:100%;object-fit:cover;transition:transform .5s}.bcards li:hover .bimg img{transform:scale(1.05)}
.ph{display:flex!important;align-items:center;justify-content:center;color:rgba(255,255,255,.6);background:linear-gradient(135deg,hsl(var(--h) 55% 36%),hsl(calc(var(--h) + 50) 60% 18%))}.ph svg{width:55%;height:auto}
.bcards li:first-child{grid-template-columns:minmax(0,1fr);padding:0;overflow:hidden}.bcards li:first-child .bimg{aspect-ratio:16/9;border-radius:0}.bcards li:first-child .btxt{padding:4px 16px 14px}.bcards li:first-child .h a{font-size:22px;letter-spacing:-.015em}
.btxt .h{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.btxt .h a{text-decoration:none;color:var(--text);font-size:17px;line-height:1.25}.btxt .h a:hover{color:var(--accent)}
.btxt small{color:var(--muted);white-space:nowrap;font-size:12.5px}.btxt p{margin:4px 0;font-size:14.5px;line-height:1.45}.btxt .th{font-size:13px;color:var(--muted)}.btxt .th a{color:var(--muted)}
.bcards li:not(:first-child) .btxt p:not(.th){display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.btxt .up,.today small .up,.inbrief small.up{background:var(--amber-bg);color:var(--amber-ink);padding:0 7px;border-radius:999px;font-weight:700}
@keyframes grow{from{transform:scaleX(0)}}@keyframes fade{from{opacity:0}}@keyframes fadeup{from{opacity:0;transform:translateY(10px)}}@keyframes pop{from{opacity:0;transform:scale(.6)}}
.home>*{animation:fadeup .6s cubic-bezier(.2,.7,.2,1) both}.home>:nth-child(2){animation-delay:.06s}.home>:nth-child(3){animation-delay:.12s}.home>:nth-child(n+4){animation-delay:.18s}.home>.mast{animation:fade .5s both}
@media(max-width:860px){.mastin{grid-template-columns:minmax(0,1fr)}.mast{padding-top:30px}}
@media(max-width:520px){.minibub{display:flex}.mast{padding:26px 16px 24px}.since .tile{min-width:0;flex:1 1 6rem;padding:8px 10px}.since .tile b{font-size:30px}.bcards li{grid-template-columns:88px minmax(0,1fr);gap:10px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;

/** The mark: a still surface line over two currents, white on raspberry. */
const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="ucmark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d93a6c"/><stop offset="1" stop-color="#8e1645"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#ucmark)"/><path d="M7 10.5h18" stroke="#fff" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round"/><path d="M5 18.5c3.6-4.2 7.2-4.2 10.8 0s7.2 4.2 11.2 0" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M8.5 24.5c2.5-2.7 5-2.7 7.5 0s5 2.7 7.5 0" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="2" stroke-linecap="round"/></svg>';

/** The current of the mark, as a small wave: the divider at the foot of every page and the picture of a briefing that has none. */
const CURL = '<path d="M2 12c3.7-5.5 7.3-5.5 11 0s7.3 5.5 11 0 7.3-5.5 11 0 7.3 5.5 11 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
const TAGLINE = (area: Area) => `What&rsquo;s rising in ${area === 'politics' ? 'politics' : 'AI'}, before it&rsquo;s news`;
const WAVE = `<div class="wave"><svg viewBox="0 0 48 24" aria-hidden="true">${CURL}</svg><span>Undercurrent &middot; what&rsquo;s rising, before it&rsquo;s news</span><svg viewBox="0 0 48 24" aria-hidden="true">${CURL}</svg></div>`;
/** Currents under the masthead: three layers of waves, each drifting at its own pace (two copies side by side, so the drift has no seam). */
const MAST_WAVE = (() => {
  const layer = (y: number, a: number, per: number, cls: string, fill = false) => {
    let d = `M0 ${y} Q${per / 4} ${y - a} ${per / 2} ${y}`;
    for (let x = per; x <= 2400; x += per / 2) d += ` T${x} ${y}`;
    return `<g class="${cls}"><path d="${d}${fill ? ' V200 H0 Z' : ''}"/></g>`;
  };
  return `<svg class="mastwave" viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden="true">${layer(96, 16, 300, 'c1')}${layer(132, 24, 400, 'c2')}${layer(166, 12, 240, 'c3', true)}</svg>`;
})();
/** A hue of its own for a briefing without a picture, from its slug. */
const hueOf = (slug: string) => [...slug].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);

// The left rail on every public page: the brand, the topics (the one you are in opens its views), and a note.
interface Active { slug: string; title: string; view: 'latest' | 'archive' | 'issue'; earlier: number }
/** Who Said It First compares groups, so a Signal with only one has nothing to show. */
const hasFirst = (b: { groups: string[] }) => b.groups.length > 1;
const vizLink = (href: string, title: string, text: string) => `<a class="vizlink" href="${href}"><b>${title} &rarr;</b><span>${text}</span></a>`;
/** A link to one of the other reports or Signals on a picture page. Only when there is more than one to choose from. */
const vizSwitch = (label: string, items: Array<{ href: string; title: string; on: boolean }>) => (items.length > 1 ? `<nav class="chips" aria-label="${label}">${items.map((i) => `<a href="${i.href}"${i.on ? ' aria-current="page"' : ''}>${esc(i.title)}</a>`).join('')}</nav>` : '');

/** The colour theme script, served from this site (the page policy allows no inline script): applies the saved choice at once, then wires the button. */
const THEME_JS = `(function(){var r=document.documentElement,o=['auto','light','dark'],L={auto:'Theme: automatic',light:'Theme: light',dark:'Theme: dark'};
function g(){try{var t=localStorage.getItem('theme');return t==='light'||t==='dark'?t:'auto'}catch(e){return'auto'}}
function a(t,b){if(t==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',t);if(b)b.textContent=L[t]}
a(g());
document.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('themebtn');if(!b)return;a(g(),b);
b.onclick=function(){var t=o[(o.indexOf(g())+1)%3];try{if(t==='auto')localStorage.removeItem('theme');else localStorage.setItem('theme',t)}catch(e){}a(t,b)}})})();`;
const THEME_INIT = '<script src="/viz/theme.js"></script>';
/** Cycles Auto, Light, Dark; the choice is kept in this browser only. */
const THEME_BTN = '<button type="button" class="themebtn" id="themebtn" aria-label="Colour theme">Theme</button>';

/** Where a page sits in the More menu: the page kind, the feed page or Signal it is, or the briefing topic it shows. */
type Here = { page?: 'lists' | 'history' | 'signal' | 'feeds' | 'topics' | 'first' | 'galaxy' | 'research' | 'map' | 'briefings' | 'agent' | 'method' | 'me'; board?: string; slug?: string };

/** The top bar for every page that is not the landing page or the search: no lens or window of its own, so a lens link goes to the landing page of the area unless the page says otherwise (`o.href`). */
function bar(ctx: Ctx, active?: Active, page?: Here['page'], board?: string, o: { lens?: Lens; href?: (p: { lens?: string; window?: number }) => string } = {}): string {
  return topBar(ctx, { lenses: ctx.lenses ?? [], lens: o.lens, restore: !!o.href, href: o.href ?? ((p) => landingHref(p, ctx.area)), here: { page, board, slug: active?.slug } });
}

/** Cloudflare Web Analytics for the public pages, from the CF_ANALYTICS_TOKEN secret: page views without cookies. Empty: no script at all. */
let analyticsToken = '';

function shell(title: string, top: string, body: string, opts: { description?: string; canonical?: string; image?: string; lang?: string; feed?: string; feedTitle?: string; /** The wider column of the landing page and the search. */ wide?: boolean; /** The landing page: its masthead runs up to the top bar. */ home?: boolean } = {}): string {
  return `<!doctype html><html lang="${opts.lang === 'sv' ? 'sv' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${opts.description ? `<meta name="description" content="${esc(opts.description.slice(0, 200))}">` : ''}
<meta property="og:title" content="${esc(title)}">${opts.description ? `<meta property="og:description" content="${esc(opts.description.slice(0, 200))}">` : ''}
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : ''}${opts.feed ? `<link rel="alternate" type="application/rss+xml" title="${esc(opts.feedTitle ?? title)}" href="${esc(opts.feed)}">` : ''}${opts.image ? `<meta property="og:image" content="${esc(opts.image)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Newsreader:opsz,wght@6..72,400..600&display=swap" rel="stylesheet">
${THEME_INIT}<style>${CSS}${VIZ_CSS}</style>${analyticsToken ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${esc(analyticsToken)}"}'></script>` : ''}</head><body>
${top}<div class="app"><main class="page${opts.wide ? ' wide' : ''}${opts.home ? ' home' : ''}">${body}${WAVE}<p class="credit">${ARXIV_THANKS}</p></main></div></body></html>`;
}

const NOTE = '<p class="note">Written by an AI from public posts and articles. It can get things wrong: follow the links to read the originals.</p>';

/** The briefings of the day, as the old landing page was: each briefing's headline and themes, a Signal strip, feed pages and reports. Now at /briefings; the landing page is landingHtml(). */
export function briefingsHtml(ctx: Ctx, strip?: SigStrip, origin = '', lead?: PubHero | null): string {
  const topics = inOrder(ctx.topics, (a, b) => b.latest.publishedAt - a.latest.publishedAt);
  // Today: each briefing's headline and themes, in the order you set, otherwise newest first; what is from the last day is marked new.
  const today = topics.map((t) => {
    const fresh = Date.now() - t.latest.publishedAt < 26 * 3600_000, th = (t.latest.themes ?? []).slice(0, 4);
    return `<li><div class="h"><a href="/${esc(t.slug)}"><b>${esc(t.title)}</b></a><small>${fresh ? '<span class="up">new</span> ' : ''}${date(t.latest.publishedAt)}</small></div>
${t.latest.tldr ? `<p>${inline(t.latest.tldr)}</p>` : ''}${th.length ? `<p class="th">${th.map((x) => `<a href="/${esc(t.slug)}#${esc(anchorOfTheme(x))}">${esc(x)}</a>`).join(' &middot; ')}</p>` : ''}</li>`;
  }).join('');
  const leadSrc = lead ? `/image/${esc(lead.slug)}/${esc(lead.id)}.jpg?v=${lead.v}` : '';
  // The first thing on the page, so it is not lazy. Cropped to a band, so the briefings stay near the top; the briefing itself shows the whole picture.
  const hero = lead ? `<figure class="hero lead"><a href="/${esc(lead.slug)}"><img src="${leadSrc}" alt="Illustration for the ${esc(lead.title)} briefing" decoding="async" fetchpriority="high"></a><figcaption>AI-generated illustration for <a href="/${esc(lead.slug)}">${esc(lead.title)}</a></figcaption></figure>` : '';
  const ai = ctx.area === 'ai';
  return shell(`${ai ? '' : 'Politics '}Briefings · Undercurrent`, bar(ctx, undefined, 'briefings'), `${hero}<header class="pagehead"><div class="eyebrow">${date(Date.now())}</div><h1>${ai ? "Today's briefings" : 'Politics briefings'}</h1>
<p class="lede">Short briefings on what is being said online, from X, news and blog feeds, YouTube and Hacker News, and <a href="/signal">Signal</a>: what is talked about across all of it.</p></header>
${today ? `<ul class="today">${today}</ul>` : ctx.reports.length ? '' : '<p class="lede">Nothing published yet.</p>'}
${strip?.topics.length ? stripHtml(strip, 'Talked about now') : ''}
${ctx.views.some((v) => v.listed && v.first) ? `<h2 class="sect">Watch and read</h2><ul class="vcards">${ctx.views.filter((v) => v.listed && v.first).map((v) => `<li>${itemLink(v.first!, `${thumb(v.first!)}<b>${esc(v.first!.title)}</b>`)}<small><a href="/feeds/${esc(v.slug)}">${esc(v.title)} &rarr;</a> &middot; ${ago(v.first!.ts)}</small></li>`).join('')}</ul>` : ''}
${ctx.reports.length ? `<h2 class="sect">Reports</h2><ul class="topics">${reportCards(ctx.reports)}</ul>` : ''}`,
  { description: 'Short briefings on what is being said online, from X, feeds, YouTube and Hacker News, and Signal: what is talked about across all of it.', ...(leadSrc && origin ? { image: origin + leadSrc } : {}) });
}


// ---- The landing page at / (INTENT.md section 6): top bar, since your last visit, in brief, the landscape (a ranked list until step 5 draws it), rising, lens cards, research, watch and read.
/** What the landing page reads besides the briefings and Signal: the Monitor's `landing-public`. */
export interface LandingExtras { lines: Record<string, string>; series: Record<string, number[]>; days: string[]; papers: RecentPaper[]; risingResearch: Array<{ slug: string; title: string; state: string }>; reads: ReadItem[] }
export interface LandingData { /** The area of the page (default: the one of the Ctx). */ area?: Area; window: LandingWindow; lenses: Lens[]; lens?: Lens; /** Signal for the window, and for 7 days (what In brief matches against). */ sig: PubSignal | null; sig7: PubSignal | null; extras: LandingExtras | null; /** Where the bubbles of the landscape sit; the frame is drawn only when there is a layout. */ landscape?: Layout | null }

/** The address of the landing page of an area with a lens and a window. */
export const landingHref = (p: { lens?: string; window?: number }, area: Area = 'ai'): string => { const q = [p.lens ? 'lens=' + encodeURIComponent(p.lens) : '', p.window && p.window !== 1 ? 'window=' + p.window : ''].filter(Boolean).join('&amp;'); return AREA_HOME[area] + (q ? '?' + q : ''); };

/**
 * The top bar that replaces the long left menu (INTENT.md section 6): name, the lens chooser, the time window (only when `window` is given), a search box and a "More" menu with the deep pages.
 * Reusable: pass `href` to say where a lens or window link goes on the page that shows it. The area (AI / Politics) joins in step 9; there is one area now, so it is not a choice.
 */
export function topBar(ctx: Ctx, o: { lenses: Lens[]; lens?: Lens; window?: LandingWindow; href: (p: { lens?: string; window?: number }) => string; /** Whether this page filters by lens: only then does the saved lens put itself back in the address. Briefings and other pages do not, so they must not be sent away. Default yes. */ restore?: boolean; q?: string; /** Where the page sits, to mark it in the More menu. */ here?: Here }): string {
  const firstBoard = ctx.boards.find(hasFirst), area = ctx.area, ai = area === 'ai', aq = areaQs(area), h = o.here ?? {};
  // Everything the long left menu reached, in short groups. The page you are on is marked in words (aria-current), as before; a link that is only the same kind of page (a Signal) is marked when it is that one.
  const a = (href: string, text: string, on = false) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${text}</a>`;
  const lists = listTotal(ctx), topics = inOrder(ctx.topics, (x, y) => x.title.localeCompare(y.title));
  const grp = (label: string, items: string) => (items ? `<div class="grp">${label}</div>${items}` : '');
  const more = grp('Read', a(AREA_BRIEFINGS[area], ai ? "Today's briefings" : 'Briefings', h.page === 'briefings')
      + (ctx.boards.length ? a(`/signal${aq}`, `Signal${ctx.boards.length > 1 ? ` <small>${ctx.boards.length}</small>` : ''}`, h.page === 'signal' && (!h.board || ctx.boards.length === 1)) + a(`/topics${aq}`, 'All topics, A to Z', h.page === 'topics') : '')
      + (firstBoard ? a(`/signal/${esc(firstBoard.slug)}/first`, 'Who said it first', h.page === 'first') : '')
      + (ai ? a('/research', 'Research pulse', h.page === 'research') + a('/research/map', 'Research map', h.page === 'map') : ''))
    + (ctx.boards.length > 1 ? grp('Signals', ctx.boards.map((b) => a(`/signal/${esc(b.slug)}`, esc(b.title), h.page === 'signal' && h.board === b.slug)).join('')) : '')
    + grp('Briefings', topics.map((t) => a(`/${esc(t.slug)}`, esc(t.title), h.slug === t.slug)).join(''))
    + grp('Watch and read', ctx.views.map((v) => a(`/feeds/${esc(v.slug)}`, esc(v.title), h.page === 'feeds' && h.board === v.slug)).join(''))
    + grp('More', (ctx.reports.length ? a('/history', `Reports <small>${ctx.reports.length}</small>`, h.page === 'history') + a(`/history/${esc(ctx.reports[0].slug)}/galaxy`, 'Tweet Galaxy', h.page === 'galaxy') : '') + (lists ? a('/lists', `Lists <small>${lists}</small>`, h.page === 'lists') : '')
      + a('/signal/method', 'How it works', h.page === 'method') + a('/agent', 'For agents (MCP)', h.page === 'agent') + (ctx.users ? a('/me', 'Your settings', h.page === 'me') : ''))
    + grp('Feeds (RSS)', topics.map((t) => a(`/${esc(t.slug)}/feed.xml`, esc(t.title))).join(''))
    + `<p class="railfoot">Briefings written by AI from public posts and articles. Every one shows its sources.${lists ? ` <a href="/lists">The ${lists} lists behind them</a>.` : ''}</p>`;
  const win = o.window ? `<nav class="sgwin" aria-label="Time window">${WINDOWS.map((w) => `<a data-win="${w}" href="${o.href({ lens: o.lens?.key, window: w })}"${o.window === w ? ' aria-current="page"' : ''}>${WINDOW_LABEL[w]}</a>`).join('')}</nav>` : '';
  // The area chooser: plain links, shown only when there is more than AI to choose. The current area is marked in words too (aria-current), not by position.
  const chooser = ctx.areas.length > 1 ? `<nav class="sgwin areabar" aria-label="Area"><span class="lenslbl">Area</span>${ctx.areas.map((a) => `<a href="${AREA_HOME[a]}"${a === area ? ' aria-current="page"' : ''}>${AREA_LABEL[a]}</a>`).join('')}</nav>` : '';
  return `<header class="topbar"><div class="tb"><a class="brand" href="${AREA_HOME[area]}">${MARK}<span>Undercurrent<small>${esc(AREA_LABEL[area])}</small></span></a>
<nav class="sgwin tbbrief" aria-label="Briefings"><a href="${AREA_BRIEFINGS[area]}"${h.page === 'briefings' || h.slug ? ' aria-current="page"' : ''}>Briefings</a></nav>
${chooser}${lensBar(o.lenses, o.lens, (k) => o.href({ lens: k, window: o.window }), o.restore !== false)}${win}
<form action="/search" method="get" role="search"><input type="search" name="q" value="${esc(o.q ?? '')}" placeholder="Search" aria-label="Search topics, items, papers and briefings" maxlength="80">${o.lens ? `<input type="hidden" name="lens" value="${esc(o.lens.key)}">` : ''}${ai ? '' : '<input type="hidden" name="area" value="politics">'}<button class="go" type="submit">Search</button></form>
${THEME_BTN}<details class="more"><summary>More</summary><div>${more}</div></details>${ctx.users ? `<a class="mebtn" href="/me"${h.page === 'me' ? ' aria-current="page"' : ''} title="Your settings: front page, your lenses, topics you follow"><img src="/me/avatar" alt="Your settings" width="30" height="30"></a>` : ''}</div></header>`;
}

/** One block, drawn on its own: when its data is missing or its code throws, the page goes on without it. */
const guard = (f: () => string): string => { try { return f(); } catch { return ''; } };
const plural1 = (v: number, one: string, many = one + 's') => `${n(v)} ${v === 1 ? one : many}`;
const riseMark = { new: ['&#9679;', 'New'], rising: ['&#9650;', 'Rising'], falling: ['&#9660;', 'Falling'] } as const;

export function landingHtml(ctx: Ctx, d: LandingData, origin = ''): string {
  const { window: win, lens, lenses, sig, sig7, extras } = d, area = d.area ?? ctx.area, ai = area === 'ai';
  const groups = sig?.groups.map((g) => g.name) ?? [];
  const topics = (sig?.top ?? []) as SigTopic[];
  const lensName = lens ? lens.name : AREA_LABEL[area];
  const wlabel = win === 1 ? 'Today' : `Last ${win} days`;
  // Papers are listed a day or two late, so a window of one day would nearly always say none: papers count over at least three days.
  const paperDays = Math.max(win, 3), rs = researchStrip(ai ? extras?.papers ?? [] : [], lens, paperDays);   // papers and the feed pages are AI's: a politics page has no research or watch blocks
  const pop = (t: SigTopic) => (t.isNew ? 'new' : t.change !== null && t.change >= 1.5 ? 'rising' : t.change !== null && sig?.baselineOk && t.change <= 0.67 ? 'falling' : '');
  const pill = (t: SigTopic) => { const k = pop(t); return k ? `<span class="pstate ${k}">${riseMark[k][0]} ${riseMark[k][1]}</span>` : ''; };
  const sourceTitle = (t: SigTopic) => esc([`${t.label}: score ${sigPct(t.signal)} of items`, mixText(t.parts, groups) && `from ${mixText(t.parts, groups)}`, t.kind === 'shared' ? 'in most groups of sources' : t.kind === 'single' ? 'in one group only' : ''].filter(Boolean).join('; '));
  const rank = rankList(topics, lens, 15, true);   // with a lens only its topics are listed; the big ones outside it get a line of their own
  const lensTags = (t: SigTopic) => lensesOfTopic(lenses, t).slice(0, 2).map(lensTag).join('');

  const since = guard(() => {
    if (!sig?.top) return '';
    const c = sinceCounts(topics, lens, rs.newPapers);
    const tile = (k: string, v: number, one: string, many: string) => `<span class="tile t-${k}"><b>${n(v)}</b>${v === 1 ? one : many}</span>`;
    return `<div class="since" id="since" data-win="${win}"><b class="sincelbl">${wlabel}:</b>${tile('new', c.newTopics, 'new topic', 'new topics')}${tile('rising', c.rising, 'rising', 'rising')}${ai ? tile('papers', c.papers, lens ? `new paper in ${esc(lensName)}` : 'new paper', lens ? `new papers in ${esc(lensName)}` : 'new papers') : ''}</div><script src="/viz/visit.js"></script>`;
  });

  const brief = guard(() => {
    const top7 = ((sig7 ?? sig)?.top ?? []) as SigTopic[];
    const mine = lens ? new Set(applyLens(top7, lens).ordered.filter((x) => x.inLens).map((x) => x.topic.label)) : null;
    // With a lens, only lines about its topics (or whose words match it): the lines are picked from more candidates first, so five are left.
    const lines = inBrief(ctx.topics.map((t) => ({ slug: t.slug, title: t.title, publishedAt: t.latest.publishedAt, tldr: t.latest.tldr, themes: t.latest.themes, position: t.position })), top7, lens ? 30 : 5, Date.now(), area)
      .filter((l) => !lens || (l.label ? mine!.has(l.label) : lensMatch(lens, { term: l.text }))).slice(0, 5);
    if (!lines.length) return lens ? `<section aria-labelledby="h-brief"><h2 class="lh" id="h-brief">In brief: ${esc(lens.name)} <a href="${AREA_BRIEFINGS[area]}">Full briefings &rarr;</a></h2><p class="meta">No briefing line today is about ${esc(lens.name)}.</p></section>` : '';
    return `<section aria-labelledby="h-brief"><h2 class="lh" id="h-brief">In brief${lens ? ': ' + esc(lens.name) : ''} <a href="${AREA_BRIEFINGS[area]}">Full briefings &rarr;</a></h2><ul class="brief">${lines.map((l) => `<li><a href="${esc(l.href)}">${esc(l.text)}</a>${l.topic ? '' : `<small>from the ${esc(l.briefing.title)} briefing</small>`}</li>`).join('')}</ul></section>`;
  });

  // The briefings of the day, so the landing page still leads to them: each briefing's headline, short summary and themes (the same list /briefings shows, newest first).
  const today = guard(() => {
    const list = inOrder(ctx.topics, (a, b) => b.latest.publishedAt - a.latest.publishedAt).filter((t) => !lens || lensMatch(lens, { term: [t.title, t.latest.tldr, ...(t.latest.themes ?? [])].join(' . ') })).slice(0, 6);
    if (!list.length) return '';
    return `<section aria-labelledby="h-today"><h2 class="lh" id="h-today">${ai ? "Today's briefings" : 'Briefings'} <a href="${AREA_BRIEFINGS[area]}">All briefings &rarr;</a></h2><ul class="bcards">${list.map((t, i) => {
      const fresh = Date.now() - t.latest.publishedAt < 26 * 3600_000, th = (t.latest.themes ?? []).slice(0, 3);
      // The picture repeats the title link, so it is hidden from screen readers and the keyboard. Without a picture: a colour of the briefing's own and the beat of the mark.
      const pic = t.pic ? `<img src="/image/${esc(t.slug)}/${esc(t.pic.id)}.jpg?v=${t.pic.v}" alt="" loading="${i ? 'lazy' : 'eager'}" decoding="async">` : `<span class="ph" style="--h:${hueOf(t.slug)}"><svg viewBox="0 0 48 24">${CURL}</svg></span>`;
      return `<li><a class="bimg" href="/${esc(t.slug)}" tabindex="-1" aria-hidden="true">${pic}</a><div class="btxt"><div class="h"><a href="/${esc(t.slug)}"><b>${esc(t.title)}</b></a><small>${fresh ? '<span class="up">new</span> ' : ''}${date(t.latest.publishedAt)}</small></div>${t.latest.tldr ? `<p>${inline(t.latest.tldr)}</p>` : ''}${th.length ? `<p class="th">${th.map((x) => `<a href="/${esc(t.slug)}#${esc(anchorOfTheme(x))}">${esc(x)}</a>`).join(' &middot; ')}</p>` : ''}</div></li>`;
    }).join('')}</ul></section>`;
  });

  // The landscape: a ranked list. Step 5 of INTENT.md puts the bubble graphic in a sandboxed frame inside .landscape-graphic, above this list, which stays as its text form.
  const landscape = guard(() => {
    if (!rank.rows.length) return '<section aria-labelledby="h-land"><h2 class="lh" id="h-land">The landscape</h2><p class="meta">No topic is mentioned often enough yet.</p></section>';
    const max = Math.max(1e-9, ...rank.rows.map((r) => r.topic.signal));
    return `<section aria-labelledby="h-land"><h2 class="lh" id="h-land">The landscape <a href="/signal/${esc(sig!.slug)}${win === 1 ? '/1' : win === 3 ? '/3' : ''}">Signal &rarr;</a></h2>
<ol class="lrows" aria-label="Topics by Signal score">${rank.rows.map((r, i) => { const t = r.topic, mix = mixText(t.parts, groups);
      return `<li class="lrow st-${pop(t) || 'steady'}${r.part ? ' part' : ''}${lens ? (r.inLens ? ` lensin lc-${lens.color}` : ' lensout') : ''}" title="${sourceTitle(t)}" style="--i:${i}"><span class="t"><a href="${topicUrl(t.term, area)}">${esc(t.label)}</a></span><span class="lb" aria-hidden="true"><i style="width:${Math.max(2, (100 * t.signal) / max).toFixed(1)}%"></i></span><b>${sigPct(t.signal)}</b><span class="tags">${pill(t)}${lens && r.inLens ? lensTag(lens) : lens ? '' : lensTags(t)}${mix ? `${mixBar(t.parts)}<small class="meta">${esc(mix)}</small>` : ''}</span></li>`; }).join('')}</ol>
${lens ? `<p class="meta">${rank.inCount ? `${plural1(rank.inCount, 'topic')} in ${esc(lens.name)} come first; the others are dimmed, not removed.` : `No topic in ${esc(lens.name)} is big enough today.`}</p>` : ''}</section>`;
  });

  const rising = guard(() => {
    const items = risingStrip(topics, !!sig?.baselineOk);
    if (!items.length) return '';
    return `<p class="rise" aria-label="Rising and falling"><b>Rising</b>${items.map((r) => `<a href="${topicUrl(r.term, area)}" class="${r.state}"><span aria-hidden="true">${riseMark[r.state][0]}</span> ${esc(r.label)} <small>${r.state === 'new' ? 'new' : r.state === 'rising' ? `rising${r.change ? ` &times;${r.change.toFixed(1)}` : ''}` : 'falling'}</small></a>`).join('')}</p>`;
  });

  const cards = guard(() => {
    const own = rank.rows.filter((r) => !r.part || !lens);
    const list = (lens ? own.filter((r) => r.inLens) : own).slice(0, 6);
    const head = lens ? `In your lens: ${esc(lens.name)}` : 'Top topics';
    const out = lens && rank.outside.length ? outsideLine(rank.outside, area) : '';
    if (!list.length) return lens ? `<section aria-labelledby="h-cards"><h2 class="lh" id="h-cards">${head}</h2><p class="meta">No topic in ${esc(lens.name)} is big enough ${win === 1 ? 'today' : 'in this period'}.</p>${out}</section>` : '';
    return `<section aria-labelledby="h-cards"><h2 class="lh" id="h-cards">${head}</h2><ul class="lcards">${list.map(({ topic: t }) => {
      const sp = extras?.series[t.term.toLowerCase()];
      return `<li class="lcard${lens ? ` lc-${lens.color}` : ''} st-${pop(t) || 'steady'}"><h3><a href="${topicUrl(t.term, area)}">${esc(t.label)}</a> ${pill(t)}</h3><p>${esc(cardLine(t, extras?.lines[topicSlug(t.term)], groups))}</p>${sp && extras ? topicSpark({ days: extras.days, counts: sp, usual: 0 }) + phaseBadge(lifecycle(sp, extras.days), true) : ''}<small>${esc(mixText(t.parts, groups) || (t.kind === 'single' ? 'one group of sources' : ''))}</small></li>`;
    }).join('')}</ul>${out}</section>`;
  });

  // The streamgraph: the topics on this page (the lens's, with one chosen) as bands over the last 14 days, each as thick as its mentions that day. Each band links to its topic.
  const stream = guard(() => {
    const ex = extras;
    if (!ex?.days?.length) return '';
    const rows = rank.rows.filter((r) => !r.part && (!lens || r.inLens)).map((r) => r.topic).filter((t) => (ex.series[t.term.toLowerCase()] ?? []).some((v) => v > 0)).slice(0, STREAM_TOPICS);
    if (rows.length < 2) return '';
    return `<section aria-labelledby="h-stream"><h2 class="lh" id="h-stream">Two weeks of talk${lens ? ': ' + esc(lens.name) : ''}</h2>${topicStream(rows.map((t) => ({ term: t.term, label: t.label, href: topicUrl(t.term, area), values: ex.series[t.term.toLowerCase()] })), ex.days, lens?.color)}</section>`;
  });

  const research = guard(() => {
    if (!extras || !ai) return '';
    const rising = extras.risingResearch;
    return `<section aria-labelledby="h-res"><h2 class="lh" id="h-res">Research <a href="/research/map${lens ? `?lens=${encodeURIComponent(lens.key)}` : ''}">Research map &rarr;</a></h2><div class="rstrip"><p>${plural1(rs.newPapers, 'new paper')}${lens ? ` in ${esc(lensName)}` : ''} in the last ${paperDays} days &middot; ${plural1(rising.length, 'research topic')} rising &middot; ${plural1(rs.discussed, 'paper')} being discussed this week</p>
${rising.length ? `<p class="meta">Rising: ${rising.map((r) => `<a href="/research/${esc(r.slug)}">${esc(r.title)}</a>`).join(' &middot; ')}</p>` : ''}
${rs.top.length ? `<p class="meta"><b>Most discussed this week</b></p><ol>${rs.top.map((p) => `<li>${ext(`https://arxiv.org/abs/${p.id}`, esc(p.title))}</li>`).join('')}</ol>` : '<p class="meta">No paper of this week is being discussed yet.</p>'}</div></section>`;
  });

  const watch = guard(() => {
    if (!ai) return '';
    const vids = ctx.views.filter((v) => v.listed && v.first);
    const reads = pickReads(extras?.reads ?? []);
    if (!vids.length && !reads.articles.length && !reads.hn.length) return '';
    const li = (i: ReadItem) => `<li>${itemLink(i as ViewItem, esc(i.title))}<small>${esc(i.source)} &middot; ${ago(i.ts)}${i.reactions ? ` &middot; &#9650; ${kfmt(i.reactions)}` : ''}</small></li>`;
    return `<section aria-labelledby="h-wr"><h2 class="lh" id="h-wr">Watch and read</h2>${vids.length ? `<ul class="vcards">${vids.slice(0, 4).map((v) => `<li>${itemLink(v.first!, `${thumb(v.first!)}<b>${esc(v.first!.title)}</b>`)}<small><a href="/feeds/${esc(v.slug)}">${esc(v.title)} &rarr;</a> &middot; ${ago(v.first!.ts)}</small></li>`).join('')}</ul>` : ''}
<div class="wr">${reads.articles.length ? `<div><h3>${reads.reacted ? 'Most reacted articles' : 'Latest articles'}</h3><ul>${reads.articles.map(li).join('')}</ul></div>` : ''}${reads.hn.length ? `<div><h3>Hacker News highlights</h3><ul>${reads.hn.map(li).join('')}</ul></div>` : ''}</div></section>`;
  });

  // The masthead: what leads, in a sentence made from the ranked topics, the counts as tiles, and the landscape picture (on a phone, the biggest topics as plain bubbles).
  const own = rank.rows.filter((r) => !r.part && (!lens || r.inLens)).map((r) => r.topic);
  const headline = guard(() => {
    const top = own[0];
    if (!top) return '';
    const riser = risingStrip(lens ? own : topics, !!sig?.baselineOk).find((r) => r.state !== 'falling' && r.term !== top.term);
    const l = (term: string, label: string) => `<a href="${topicUrl(term, area)}">${esc(label)}</a>`;
    // What rises comes first: that is what the name promises. Without a riser, what leads.
    return riser ? `Beneath ${l(top.term, top.label)}, ${l(riser.term, riser.label)} is ${riser.state === 'new' ? 'surfacing' : 'rising'}`
      : `${l(top.term, top.label)} leads the conversation${win === 1 ? ' today' : ` over ${win} days`}`;
  });
  const mini = guard(() => {
    const big = own.slice(0, 6), mx = Math.max(1e-9, big[0]?.signal ?? 0);
    return big.length ? `<ol class="minibub" aria-label="Biggest topics">${big.map((t, i) => `<li class="${pop(t) || 'steady'}" style="--s:${Math.round(52 + 50 * Math.sqrt(t.signal / mx))}px;animation-delay:${i * 60}ms"><a href="${topicUrl(t.term, area)}">${esc(t.label)}</a></li>`).join('')}</ol>` : '';
  });
  const bubbles = !!(d.landscape?.bubbles.length && rank.rows.length);
  const graphic = bubbles ? `<div class="mastviz landscape-graphic" id="landscape-graphic">${vizFrame('landscape', `/overview.json?window=${win}${lens ? '&amp;lens=' + encodeURIComponent(lens.key) : ''}${ai ? '' : '&amp;area=politics'}`, 'The landscape: a bubble for each topic, sized by its score, grouped by topics talked about together. The ranked list on this page says the same.')}</div>` : '';
  const lede = lens ? `${lens.description ? esc(lens.description) + ' ' : ''}${headline ? headline + '. ' : rank.inCount ? '' : `No topic in ${esc(lens.name)} is big enough ${win === 1 ? 'today' : 'in this period'}. `}<a href="${landingHref({ window: win }, area)}">Show everything</a>`
    : sig || ai ? `<b class="tagline">${TAGLINE(area)}.</b> Short briefings and the topics being talked about across news, blogs, X, YouTube and Hacker News${ai ? ', with the research behind them' : ''}.` : 'Nothing is published here yet.';
  const mast = `<section class="mast${bubbles ? '' : ' nobub'}${lens ? ` lensmast lc-${lens.color}` : ''}" aria-labelledby="h-mast">${MAST_WAVE}<div class="mastin"><div class="masttext">
<div class="masteye">${lens ? `<span class="lsw" aria-hidden="true"></span>Lens &middot; ${esc(AREA_LABEL[area])}` : `${date(Date.now())} &middot; ${esc(AREA_LABEL[area])}`}</div>
<h1 id="h-mast"${!lens && headline.replace(/<[^>]+>/g, '').length > 60 ? ' class="long"' : ''}>${lens ? esc(lens.name) : headline || (ai ? 'What is going on in AI' : 'Politics')}</h1><p class="mastlede">${lede}</p>${since}${mini}</div>${graphic}</div></section>`;
  const body = `${mast}${yoursHtml(ctx, topics, pop, area, sig ? sigPct : null)}<div class="lgrid"><div>${brief}${today}</div><div>${landscape}</div></div>${rising}${stream}${cards}${research}${watch}
<p class="note">Written by an AI from public posts and articles. It can get things wrong: follow the links to read the originals. <a href="/signal/method">How the numbers are worked out</a>.</p>`;
  return shell(ai ? 'Undercurrent · What’s rising in AI, before it’s news' : 'Politics · Undercurrent', topBar(ctx, { lenses, lens, window: win, href: (p) => landingHref(p, area), here: {} }), body, { wide: true, home: true, canonical: origin ? origin + AREA_HOME[area] : undefined,
    description: ai ? 'What’s rising in AI, before it’s news: short briefings, the topics being talked about across news, blogs, X, YouTube and Hacker News, and the research behind them.'
      : 'What’s rising in politics, before it’s news: short briefings and the topics being talked about across news, blogs, X, YouTube and Hacker News.' });
}


/** /agent: the public MCP server, what it shows and does not, the limit, and the lines to copy. */
export function agentHtml(ctx: Ctx, origin: string): string {
  const mcp = `${origin}/agent/mcp`;
  const tools: Array<[string, string]> = [['list_lenses', 'The areas (AI and politics, kept apart) and their lenses, with a line each.'], ['get_overview', 'What is going on: in brief, new and rising topics, the top topics, research in short. Takes an area (AI, or politics), a lens and a window of 1, 3 or 7 days.'],
    ['get_topic', 'One topic: summary, state, evidence per kind of source, top items, papers, briefings, related topics.'], ['get_topic_items', 'The posts, threads, articles and videos behind a topic, 25 a page, with links to the originals.'], ['search', 'Find topics, items, papers and briefings by words, grouped by kind with topics first, each with a link to the original.'],
    ['get_briefing', 'A published briefing with its themes and sources.'], ['get_papers', 'Papers of the last 30 days with their abstract and how many posts name them. Filter by topic, cluster, words or "being discussed".'], ['get_paper', 'One paper: abstract, links, every post that names it.']];
  return shell('For agents · Undercurrent', bar(ctx, undefined, 'agent'), `<header class="pagehead"><h1>For agents</h1><p class="lede">The same three levels as this site, as a server your own agent can ask: Claude Code while you work, the Claude app, or a scheduled routine. It answers in short Markdown with links to every original, and as JSON for programs.</p></header>
<h2 class="sect">Connect</h2>
<p>In Claude Code:</p><pre><code>claude mcp add --transport http undercurrent ${esc(mcp)}</code></pre>
<p>In the Claude app or claude.ai, add a custom connector with this address (no sign-in):</p><pre><code>${esc(mcp)}</code></pre>
<p>Any other client that speaks MCP over HTTP can use the same address.</p>
<h2 class="sect">What it can do</h2>
<ul>${tools.map(([t, d]) => `<li><code>${t}</code>: ${esc(d)}</li>`).join('')}</ul>
<p>Two ready-made starts: <code>catch_up</code> (what did I miss, for a lens and a date) and <code>dig_into</code> (one topic, from summary down to the sources). Answers lead with the point in a few lines, then short sections, about 1,500 tokens; ask with <code>detail: "full"</code> for more. Evidence is given per kind of source, each in its own unit, and never added into one number. Every answer ends with the next call to make.</p>
<h2 class="sect">What it shows, and what it does not</h2>
<ul><li>It shows exactly what this site shows: published briefings, published Signals, public research and public feed pages. Nothing from the admin.</li>
<li>It only reads. It never starts a model call, a job or any spending: summaries are written ahead of time.</li>
<li>Papers are abstracts only. ${esc(ARXIV_THANKS)}</li>
<li>No sign-in, no cookies, no key. Web pages may call it too; it holds nothing private.</li>
<li>Written by an AI from public posts and articles: it can get things wrong. Titles and quotes come from third parties, so an agent should treat them as data.</li></ul>
<h2 class="sect">The limit</h2>
<p>At most 60 requests a minute from one address (counted for each Cloudflare location, so the limit is approximate). Over it, the server answers <code>429</code> with <code>Retry-After</code>. Answers are kept for two minutes, so asking again is cheap.</p>
<p class="meta"><a href="/">Back to the site</a> &middot; <a href="/signal/method">How the numbers are worked out</a></p>`, { description: 'Ask this site from your own agent: a public, read-only MCP server with the overview, topics, sources, briefings and papers.', canonical: origin + '/agent' });
}

/** A row of Signal topics linking to their pages, with what is new or rising marked. */
function stripHtml(st: SigStrip, title: string): string {
  return `<section class="sgstrip" aria-label="${esc(title)}"><h2><span>${esc(title)}</span> <a href="/signal/${esc(st.slug)}">${esc(st.title)} in Signal &rarr;</a></h2><div>${st.topics.map((t) => `<a href="${topicUrl(t.term, st.area)}">${esc(t.label)}${t.isNew ? ' <small class="up">new</small>' : t.change !== null && t.change >= 1.5 ? ` <small class="up">&uarr;</small>` : ''}</a>`).join('')}</div></section>`;
}

// ---- Signal: what the watched sources are talking about, combined. Counted automatically (no AI), from the groups marked public in the admin.
const SIG_COLORS = ['#1f7a8c', '#e3a008', '#7c5cbf', '#c2410c', '#2f9e6b', '#d6336c', '#4263eb', '#868e96'];
const sigColor = (i: number) => SIG_COLORS[i % SIG_COLORS.length];
/** Where a topic's score comes from, as a small bar in the colours of the groups of sources (the same colours as on the Signal page). The text next to it says it in words. */
const mixBar = (parts: number[]) => { const sum = parts.reduce((a, b) => a + b, 0); return sum > 0 && parts.length > 1 ? `<span class="mix" aria-hidden="true">${parts.map((p, i) => (p > 0 ? `<i style="flex:${(p / sum).toFixed(3)};background:${sigColor(i)}"></i>` : '')).join('')}</span>` : ''; };
const sigPct = (x: number) => { const p = x * 100; return (p < 10 ? p.toFixed(1) : String(Math.round(p))) + '%'; };

// ---- Research pulse: counts of new papers per topic. Script-free, like the other public pages.
interface PubPulseTopic { id: string; slug: string; title: string; blurb: string; query: string; state: 'building' | 'normal' | 'rising' | 'spike' | 'falling'; sustained: boolean; from: string; end: string; n: number; share: number; baseline: number; ratio: number; series: Array<{ end: string; n: number; share: number }> }
export interface PubPulse { topics: PubPulseTopic[]; field: { surge: boolean; ratio: number; n: number }; baseQuery: string; baselineWeeks: number }
const PULSE_LABEL = { building: 'Collecting history', normal: 'Usual level', rising: 'Rising', spike: 'Spike', falling: 'Falling' };
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
/** The share of each week as a line, with the usual level as a dashed one. */
function pulseSpark(t: PubPulseTopic): string {
  const s = t.series; if (s.length < 2) return '';
  const W = 240, H = 56, top = Math.max(...s.map((x) => x.share), t.baseline) * 1.1 || 1, x = (i: number) => (i / (s.length - 1)) * W, y = (v: number) => H - 3 - (v / top) * (H - 6);
  const label = `Share of AI papers per week, from ${pct1(s[0].share)} to ${pct1(s[s.length - 1].share)}`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${t.baseline ? `<line x1="0" x2="${W}" y1="${y(t.baseline).toFixed(1)}" y2="${y(t.baseline).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}<polyline fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" points="${s.map((p, i) => `${x(i).toFixed(1)},${y(p.share).toFixed(1)}`).join(' ')}"/></svg>`;
}
interface PubPaper { id: string; published: number; title: string; authors: string[]; categories: string[]; abstract: string; absUrl: string; pdfUrl: string; also: Array<{ slug: string; title: string }>;
  attention: { top: boolean; hf?: { upvotes: number; url: string }; hn?: { points: number; comments: number; url: string }; mentions: Array<{ by: string; url: string; reactions: number }>; accounts: number } }
export interface PubResearchPage { topic: PubPulseTopic; others: Array<{ slug: string; title: string }>; attention: PubPaper[]; papers: PubPaper[]; total: number; page: number; pages: number; keepDays: number; topDays: number; updated: number }
const httpsOnly = (u: string) => (/^https:\/\//.test(u) ? u : '');
const ext = (u: string, text: string) => (httpsOnly(u) ? `<a href="${esc(u)}" rel="noopener noreferrer nofollow" target="_blank">${text}</a>` : text);
function paperHtml(p: PubPaper): string {
  const a = p.attention, shown = p.authors.slice(0, 6).join(', ') + (p.authors.length > 6 ? ` and ${p.authors.length - 6} more` : '');
  const signals = [a.hf && `<span>${ext(a.hf.url, `${n(a.hf.upvotes)} upvote${a.hf.upvotes === 1 ? '' : 's'} on Hugging Face`)}</span>`, a.hn && `<span>${ext(a.hn.url, `${n(a.hn.points)} point${a.hn.points === 1 ? '' : 's'} on Hacker News`)}</span>`,
    a.accounts ? `<span>Mentioned by ${a.mentions.slice(0, 3).map((m) => ext(m.url, `@${esc(m.by)}`)).join(', ')}${a.accounts > 3 ? ` and ${a.accounts - 3} more` : ''}</span>` : ''].filter(Boolean).join('');
  return `<li><h3>${ext(p.absUrl, esc(p.title))}</h3><p class="pby">${esc(shown)} · ${esc(new Date(p.published).toISOString().slice(0, 10))} · ${esc(p.categories.slice(0, 3).join(' '))}</p>
${signals ? `<p class="psig">${signals}</p>` : ''}<details><summary>Abstract</summary><p>${esc(p.abstract)}</p></details>
<p class="plinks">${ext(p.absUrl, 'On arXiv')} · ${ext(p.pdfUrl, 'PDF')}${p.also.length ? ` · Also in ${p.also.map((t) => `<a href="/research/${esc(t.slug)}">${esc(t.title)}</a>`).join(', ')}` : ''}</p></li>`;
}
export function researchTopicHtml(d: PubResearchPage, ctx: Ctx): string {
  const t = d.topic, base = `/research/${esc(t.slug)}`;
  const facts = t.state === 'building' ? 'Collecting past weeks to compare with.' : `${n(t.n)} new papers, ${esc(t.from)} to ${esc(t.end)}: ${pct1(t.share)} of AI papers, against a usual ${pct1(t.baseline)}.`;
  const pager = d.pages > 1 ? `<nav class="pager" aria-label="Pages">${d.page > 1 ? `<a href="${base}${d.page > 2 ? `?page=${d.page - 1}` : ''}" rel="prev">&larr; Newer</a>` : '<span></span>'}<span>Page ${n(d.page)} of ${n(d.pages)}</span>${d.page < d.pages ? `<a href="${base}?page=${d.page + 1}" rel="next">Older &rarr;</a>` : '<span></span>'}</nav>` : '';
  return shell(`${t.title} · Research pulse · Undercurrent`, bar(ctx, undefined, 'research'), `<header class="pagehead"><div class="eyebrow"><a href="/research">Research pulse</a></div><h1>${esc(t.title)} <span class="pstate ${t.state}">${PULSE_LABEL[t.state]}${t.sustained ? ', second week' : ''}</span></h1>
${t.blurb ? `<p class="lede">${esc(t.blurb)}</p>` : ''}<p class="meta">${facts}${d.others.length ? ` Other topics: ${d.others.map((x) => `<a href="/research/${esc(x.slug)}">${esc(x.title)}</a>`).join(', ')}.` : ''}</p></header>
${d.attention.length ? `<h2>Getting attention</h2><p class="meta">From the last ${d.topDays} days: upvotes on Hugging Face, points on Hacker News, and posts collected on this site that link to a paper. Attention is not quality, and most new papers have not had time to get any.</p><ol class="papers">${d.attention.map(paperHtml).join('')}</ol>` : ''}
<h2>New papers</h2><p class="meta">${d.total ? `${n(d.total)} papers from the last ${d.keepDays} days at most, newest first.` : 'Reading the papers. This fills in by itself.'}</p>
<ol class="papers">${d.papers.map(paperHtml).join('')}</ol>${pager}
<p class="meta">Papers and abstracts from <a href="https://arxiv.org/" rel="noopener noreferrer">arXiv</a>, where each paper is hosted. This site is not affiliated with or endorsed by arXiv. Upvotes from <a href="https://huggingface.co/papers" rel="noopener noreferrer">Hugging Face Daily Papers</a>; points from Hacker News.</p>`, { description: `New research papers on ${t.title}, and which of them are getting attention.` });
}
function researchMapHtml(ctx: Ctx, lens?: Lens): string {
  return shell('Research map · Undercurrent', bar(ctx, undefined, 'map', undefined, { lens, href: (p) => '/research/map' + (p.lens ? '?lens=' + encodeURIComponent(p.lens) : '') }), `<header class="pagehead"><div class="eyebrow"><a href="/research">Research pulse</a></div><h1>Research map</h1>
<p class="lede">What the papers of the last 30 days in the research topics are about, grouped by subject. Choose the dates, the level of detail and the topics.</p></header>
${vizFrame('map', '/research/map', 'New research papers grouped by subject, with date, detail, topic and lens controls', lens?.key ?? '')}
<h2>How this is made</h2>
<p>Papers are grouped by the meaning of their title and abstract, using an embedding model, and a language model then names each group and describes it from its most typical titles. Names can be off, and a paper can land in a neighbouring group: this is a way to see the shape of a month, not a classification. It counts papers, which says nothing about their quality.</p>
<p>The map is rebuilt once a day, and the descriptions cover the whole 30 days whichever dates you choose. A trend compares a group's share of the papers shown in the later half of your dates with the earlier half.</p>
<p class="meta">Papers and abstracts from <a href="https://arxiv.org/" rel="noopener noreferrer">arXiv</a>, where each paper is hosted. This site is not affiliated with or endorsed by arXiv. Upvotes from <a href="https://huggingface.co/papers" rel="noopener noreferrer">Hugging Face Daily Papers</a>; points from Hacker News.</p>`, { description: 'What new AI research papers are about, grouped by subject, with controls for dates, detail and topics.' });
}
export function researchHtml(d: PubPulse, ctx: Ctx): string {
  const cards = d.topics.map((t) => {
    const building = t.state === 'building';
    const facts = building ? 'Collecting past weeks to compare with. This fills in by itself.'
      : `${n(t.n)} new papers, ${esc(t.from)} to ${esc(t.end)}: ${pct1(t.share)} of AI papers, against a usual ${pct1(t.baseline)} (${t.ratio.toFixed(2)} times).`;
    return `<article id="${esc(t.id)}"><div><h2>${esc(t.title)} <span class="pstate ${t.state}">${PULSE_LABEL[t.state]}${t.sustained ? ', second week' : ''}</span></h2>${t.blurb ? `<p>${esc(t.blurb)}</p>` : ''}<p>${facts}</p><p><a href="/research/${esc(t.slug)}">The papers &rarr;</a></p></div>${pulseSpark(t)}</article>`;
  }).join('');
  return shell('Research pulse · Undercurrent', bar(ctx, undefined, 'research'), `<header class="pagehead"><div class="eyebrow">Analysis</div><h1>Research pulse</h1>
<p class="lede">Which areas of AI research are getting more attention from researchers right now, measured by how many new papers they post.</p></header>
<p><a href="/research/map">See what the papers are about on the Research map &rarr;</a></p>
${d.field.surge ? `<p class="note">All of AI research had an unusually big week: ${n(d.field.n)} papers, ${d.field.ratio.toFixed(1)} times the usual. A topic only counts as spiking if it grew more than the field did.</p>` : ''}
<div class="pulse">${cards}</div>
<h2>How this is measured</h2>
<p>Each topic is a search of new papers on arXiv. It counts the papers from the last whole week, leaving out the newest two days because not all of their papers are listed yet, and divides by all papers in the AI categories (<code>${esc(d.baseQuery)}</code>). That share is compared with the ${d.baselineWeeks} weeks before. Using the share means a big week for the whole field does not read as a spike in every topic.</p>
<p>A <b>spike</b> is a share at least 1.25 times the usual level, unusually far from it for that topic, on at least 20 papers. This counts papers. It says nothing about their quality, and it cannot tell why a topic grew.</p>
<details><summary>The searches</summary><ul>${d.topics.map((t) => `<li><b>${esc(t.title)}</b>: <code>${esc(t.query)}</code></li>`).join('')}</ul></details>
<p class="meta">Data from <a href="https://arxiv.org/" rel="noopener noreferrer">arXiv</a>. This site is not affiliated with or endorsed by arXiv.</p>`, { description: 'Which areas of AI research are getting more attention, measured by how many new papers researchers post.' });
}

export function signalIndexHtml(ctx: Ctx): string {
  const cards = ctx.boards.map((b) => `<li class="pic"><a class="card" href="/signal/${esc(b.slug)}"><span class="eyebrow">${b.groups.length} group${b.groups.length === 1 ? '' : 's'}</span><h2>${esc(b.title)}</h2>${b.description ? `<p>${esc(b.description)}</p>` : ''}
<div class="foot"><span>${esc(b.groups.join(' · '))}</span></div></a>${hasFirst(b) ? `<a class="cardpic" href="/signal/${esc(b.slug)}/first">Who said it first &rarr;</a>` : ''}</li>`).join('');
  return shell('Signal · Undercurrent', bar(ctx, undefined, 'signal'), `<header class="pagehead"><div class="eyebrow">${ctx.boards.length} signal${ctx.boards.length === 1 ? '' : 's'}</div><h1>Signal</h1>
<p class="lede">What is being talked about across news, blogs, X and Hacker News, combined into one score per topic, and where each topic shows up. <a href="/signal/method">How it works</a>.</p></header>
<ul class="topics">${cards}</ul>`, { description: 'What is being talked about across news, blogs, X and Hacker News, combined into one score per topic.' });
}

const kfmt = (v: number) => (v >= 10000 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)));
/** Every topic opens its page at /t/<slug> (src/signal/topicpage.ts): the one hub for a subject, whichever Signal it was seen in. */
const topicUrl = (term: string, area: Area = 'ai') => topicHref(topicSlug(term), area);
/** `?area=politics` for the pages of the politics area that exist once for both (Signal index, Topics, Search); nothing for AI. */
const areaQs = (area: Area, first = '?') => (area === 'politics' ? first + 'area=politics' : '');

// ---- Lenses (src/signal/lens.ts): chosen with ?lens=<key>, so each lens page is shareable and cached on its own. They order and mark; nothing is hidden.
/** The lens chooser: plain links, one per lens, with the lens named in words (the colour is a second cue). The small script remembers the choice in this browser. */
function lensBar(lenses: Lens[], cur: Lens | undefined, href: (key: string) => string, restore = true): string {
  if (!lenses.length) return '';
  return `<nav class="sgwin lensbar" aria-label="Lens"${restore ? '' : ' data-pagelens="1" title="Briefings are not filtered by lens. Choose a lens to go back to the front page with it."'}><span class="lenslbl">Lens</span><a data-lens="" href="${href('')}"${cur ? '' : ' aria-current="page"'}>All</a>${lenses.map((l) => `<a class="lc-${l.color}" data-lens="${esc(l.key)}" href="${href(l.key)}"${l.description ? ` title="${esc(l.description)}"` : ''}${cur?.key === l.key ? ' aria-current="page"' : ''}><i class="lsw"></i>${esc(l.name)}</a>`).join('')}</nav><script src="/viz/lens.js"></script>`;
}
/** "Outside your lens, big today": one or two topics that are not in the lens but are big anyway. */
const outsideLine = (topics: Array<{ term: string; label?: string }>, area: Area = 'ai') => (topics.length
  ? `<p class="outside"><b>Outside your lens, big today:</b> ${topics.map((t) => `<a href="${topicUrl(t.term, area)}">${esc(t.label ?? t.term)}</a>`).join(' &middot; ')}</p>` : '');
const lensTag = (l: Lens) => `<span class="lenstag lc-${l.color}">${esc(l.name)}</span>`;

// ---- The topic page /t/<slug>: the hub every other page links to. Plain HTML and CSS, no script; the angles are links (?angle=) so each works on its own and is cached on its own.
// The numbers, evidence and summary come from one function (loadTopic in topicData.ts), also served as JSON at /t/<slug>.json.
// The angles of INTENT.md section 5 C, in its order: Talk, Who said it first, Papers, Watch, Briefings. One entry here, one panel in topicPanel(), one count in topicHtml().
const ANGLES = [['talk', 'Talk'], ['first', 'Who said it first'], ['papers', 'Papers'], ['watch', 'Watch'], ['briefings', 'Briefings']] as const;
type Angle = (typeof ANGLES)[number][0];
export const topicAngle = (v: string | null): Angle => ANGLES.find(([k]) => k === v)?.[0] ?? 'talk';

/** Items per day over 14 days as a line, with the usual level dashed: the approach of the Research pulse, with a text equivalent in its label. */
function topicSpark(s: TopicData['series']): string {
  const c = s.counts; if (c.length < 2) return '';
  const W = 280, H = 64, top = Math.max(1, ...c, s.usual) * 1.1, x = (i: number) => (i / (c.length - 1)) * W, y = (v: number) => H - 3 - (v / top) * (H - 6);
  const pts = c.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const label = `Items per day, ${s.days[0]} to ${s.days[s.days.length - 1]}: ${c.join(', ')}${s.usual ? `. Usual level about ${+s.usual.toFixed(1)} a day` : ''}`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${s.usual ? `<line x1="0" x2="${W}" y1="${y(s.usual).toFixed(1)}" y2="${y(s.usual).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}<polygon fill="var(--accent)" fill-opacity=".13" points="0,${H} ${pts} ${W},${H}"/><polyline fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" points="${pts}"/></svg>`;
}

/** The phase as a badge: a mark and a word, never colour alone. */
const phaseBadge = (lc: Lifecycle | null, small = false) => (lc ? `<span class="phase ph-${lc.phase}${small ? ' sm' : ''}" title="${esc(lc.words)}"><b aria-hidden="true">${PHASE_MARK[lc.phase]}</b> ${PHASE_LABEL[lc.phase]}</span>` : '');
/**
 * The life of a topic (src/signal/lifecycle.ts): the daily counts as faint bars, the smoothed curve over them, the peak (and the earlier peak of a topic that is back again) marked and named,
 * and a track that lights the phase it is in. Inline SVG, no script; the sentence beside it says the same.
 */
function lifeHtml(s: TopicData['series']): string {
  const c = s.counts, lc = lifecycle(c, s.days);
  if (c.length < 2) return '';
  const W = 560, H = 132, T = 22, B = 18, top = Math.max(1, ...c, s.usual) * 1.08, bw = W / c.length, x = (i: number) => (i + 0.5) * bw, y = (v: number) => H - B - (v / top) * (H - B - T);
  const sm = smooth(c), pts = sm.map((v, i) => [x(i), y(v)] as const);
  // a soft curve through the smoothed points (Catmull-Rom as cubic Béziers)
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${H - B} L${pts[0][0].toFixed(1)},${H - B} Z`;
  const bars = c.map((v, i) => `<rect class="lbar" x="${(i * bw + bw * 0.18).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(0, H - B - y(v)).toFixed(1)}" rx="2"><title>${esc(shortDay(s.days[i]))}: ${c[i]} ${c[i] === 1 ? 'item' : 'items'}</title></rect>`).join('');
  const mark = (i: number, text: string) => { const px = x(i), py = y(sm[i]), anchor = px < 40 ? 'start' : px > W - 40 ? 'end' : 'middle'; return `<circle class="lpk" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5"/><text class="lpt" x="${px.toFixed(1)}" y="${Math.max(12, py - 10).toFixed(1)}" text-anchor="${anchor}">${esc(text)}</text>`; };
  const marks = lc ? (lc.firstPeak !== undefined ? mark(lc.firstPeak, 'first peak') : '') + (lc.phase === 'steady' ? '' : mark(lc.peak, lc.peak >= c.length - 3 ? 'now' : 'peak')) : '';
  const end = pts[pts.length - 1], now = lc && lc.peak !== c.length - 1 ? `<circle class="lnow" cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="4"/>` : '';
  const usual = s.usual ? `<line class="lus" x1="0" x2="${W}" y1="${y(s.usual).toFixed(1)}" y2="${y(s.usual).toFixed(1)}"/>` : '';
  const label = `Items per day, ${s.days[0]} to ${s.days[s.days.length - 1]}: ${c.join(', ')}.${s.usual ? ` Usual level about ${+s.usual.toFixed(1)} a day.` : ''}${lc ? ' ' + lc.words : ''}`;
  const track = lc ? `<ol class="ltrack" aria-label="Where the topic is in its life">${PHASE_TRACK.map((p) => `<li class="${lc.phase === p ? 'on' : ''}"${lc.phase === p ? ' aria-current="step"' : ''}><b aria-hidden="true">${PHASE_MARK[p]}</b>${PHASE_LABEL[p]}</li>`).join('')}<li class="loop${lc.phase === 'returning' ? ' on' : ''}"${lc.phase === 'returning' ? ' aria-current="step"' : ''}><b aria-hidden="true">${PHASE_MARK.returning}</b>${PHASE_LABEL.returning}</li></ol>` : '';
  return `<section class="life${lc ? ' ph-' + lc.phase : ''}" aria-labelledby="h-life"><div class="lifehead"><h2 class="sect" id="h-life">Its life so far</h2>${phaseBadge(lc)}</div>
<div class="lifeviz"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><defs><linearGradient id="lifefill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${bars}${usual}<path class="larea" d="${area}" fill="url(#lifefill)"/><path class="lcurve" d="${d}"/>${marks}${now}</svg>
<div class="axis"><span>${esc(shortDay(s.days[0]))}</span><span>${esc(shortDay(s.days[s.days.length - 1]))}</span></div></div>
${lc ? `<p class="lifesay">${esc(lc.words)}</p>` : '<p class="meta">Too few mentions to tell where this topic is in its life.</p>'}${track}</section>`;
}

/** One segment per kind of source, each in its own unit, then the Signal score with the link to how it is worked out. Never one blended number. */
function evidenceHtml(d: TopicData): string {
  const seg = d.evidence.map((e) => `<li class="ev"><b>${esc(e.label)}</b>${e.lines.map((l) => `<span>${esc(l)}</span>`).join('')}${e.names?.length ? `<small>${esc(e.names.join(', '))}</small>` : ''}</li>`).join('');
  const change = d.isNew ? 'new this week' : d.change !== null && d.baselineOk ? `&times;${d.change.toFixed(1)} against the week before` : 'earlier data too thin to compare';
  return `<h2 class="sect">Evidence</h2><ul class="evstrip" aria-label="What each kind of source says">${seg}<li class="ev score"><b>Signal score</b><span>${sigPct(d.signal)} of items</span><span>${change}</span><a href="/signal/method">How this is worked out</a></li></ul>
<p class="meta">Each kind of source is counted in its own unit and never added to another. ${d.evidence.length ? '' : 'Nothing from the last week is available for this topic. '}Reactions on X are shown as rough numbers because they can be inflated.</p>`;
}

const metricOf = (i: TopicTalkItem): string => {
  if (i.kind === 'hn') return i.likes !== undefined ? `${n(i.likes)} points${i.replies !== undefined ? `, ${n(i.replies)} comments` : ''}` : '';
  if (i.kind === 'youtube') return i.views ? `${roughly(i.views)} views` : '';
  return i.likes ? `${roughly(i.likes)} likes` : '';
};
const KIND_TITLE: Record<EvKind, string> = { x: 'On X', hn: 'On Hacker News', youtube: 'On YouTube', rss: 'In blogs and news', arxiv: 'Research papers' };

const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
/** One mark per kind of source, in the shape that kind always has (circle, square, triangle, diamond), centred on x, y; r is its size. */
function kindShape(kind: EvKind, x: number, y: number, r: number, cls: string, title: string): string {
  const f = (v: number) => v.toFixed(1), shape = KIND_MARK[kind].shape, t = `<title>${esc(title)}</title>`;
  if (shape === 'circle') return `<circle class="${cls}" cx="${f(x)}" cy="${f(y)}" r="${f(r)}">${t}</circle>`;
  if (shape === 'square') return `<rect class="${cls}" x="${f(x - r)}" y="${f(y - r)}" width="${f(2 * r)}" height="${f(2 * r)}">${t}</rect>`;
  const pts = shape === 'triangle' ? [[x, y - r * 1.15], [x + r * 1.1, y + r * 0.85], [x - r * 1.1, y + r * 0.85]] : [[x, y - r * 1.2], [x + r * 1.2, y], [x, y + r * 1.2], [x - r * 1.2, y]];
  return `<polygon class="${cls}" points="${pts.map(([px, py]) => f(px) + ',' + f(py)).join(' ')}">${t}</polygon>`;
}
/** Key items over time as dots on one line: a lane for each kind of source (a shape and a name, not colour), a dot per time slot sized by how many items it stands for. Inline SVG, no script; the words under it say the same. */
function timelineHtml(d: TopicData): string {
  const dots: TimelineDot[] = d.timeline ?? [], kinds = (['x', 'hn', 'youtube', 'rss'] as EvKind[]).filter((k) => dots.some((t) => t.kind === k));
  if (!dots.length) return '';
  const W = 380, L = 74, R = 12, laneH = 28, top = 14, H = top + kinds.length * laneH + 26, x = (v: number) => L + v * (W - L - R);
  const lanes = kinds.map((k, i) => ({ k, y: top + laneH / 2 + i * laneH }));
  const marks = dots.map((t) => {
    const y = lanes.find((l) => l.k === t.kind)!.y, r = Math.min(9, 3.5 + 1.6 * Math.sqrt(t.n)), what = `${KIND_NAME[t.kind]}, ${stampUtc(t.ts).slice(0, -10).trim()}: ${t.n} ${t.n === 1 ? 'item' : 'items'}${t.item?.title ? `, most reacted: ${t.item.title}` : ''}`;
    return kindShape(t.kind, x(t.x), y, r, 'dot', what);
  }).join('');
  const days = d.series.days, ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1].map((i, j) => `<text x="${(j === 0 ? L : j === 2 ? W - R : (L + W - R) / 2).toFixed(0)}" y="${H - 6}" text-anchor="${j === 0 ? 'start' : j === 2 ? 'end' : 'middle'}">${esc(shortDay(days[i]))}</text>`).join('');
  const label = `Timeline of the last ${days.length} days. ${timelineWords(dots).join('. ')}.`;
  return `<h2 class="sect">Item by item</h2><div class="tline"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${lanes.map((l) => `<line class="lane" x1="${L}" x2="${W - R}" y1="${l.y}" y2="${l.y}"/><text x="${L - 8}" y="${l.y + 4}" text-anchor="end">${esc(KIND_MARK[l.k].short)}</text>`).join('')}<line class="base" x1="${L}" x2="${W - R}" y1="${H - 22}" y2="${H - 22}"/>${marks}${ticks}</svg></div>
<ul class="tkey" aria-hidden="true">${kinds.map((k) => `<li><b>${{ circle: '&#9679;', square: '&#9632;', triangle: '&#9650;', diamond: '&#9670;' }[KIND_MARK[k].shape]}</b>${esc(KIND_NAME[k])}</li>`).join('')}</ul>
<ul class="twords">${timelineWords(dots).map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p class="meta">Each mark stands for the items of one kind of source in a slot of the period (a bigger mark: more items). The most reacted one is named when you hover or focus the mark${d.board.proof ? '' : ', and only on Signals that show their sources'}.</p>`;
}

/** A smooth band between two edges of a stream: along the top from left to right, back along the bottom (Catmull-Rom as cubic Béziers). */
function bandPath(xs: number[], top: number[], bottom: number[]): string {
  const seg = (px: number[], py: number[], move: boolean) => {
    let d = `${move ? 'M' : 'L'}${px[0].toFixed(1)},${py[0].toFixed(1)}`;
    for (let i = 0; i < px.length - 1; i++) {
      const a = Math.max(0, i - 1), b = Math.min(px.length - 1, i + 2);
      d += ` C${(px[i] + (px[i + 1] - px[a]) / 6).toFixed(1)},${(py[i] + (py[i + 1] - py[a]) / 6).toFixed(1)} ${(px[i + 1] - (px[b] - px[i]) / 6).toFixed(1)},${(py[i + 1] - (py[b] - py[i]) / 6).toFixed(1)} ${px[i + 1].toFixed(1)},${py[i + 1].toFixed(1)}`;
    }
    return d;
  };
  return `${seg(xs, top, true)} ${seg([...xs].reverse(), [...bottom].reverse(), false)} Z`;
}
/** Where a band's name fits: the point where it is thickest, kept off the ends and away from the numbered pins (`free`). */
const bandLabelAt = (l: StreamLayer, n: number, free: (i: number) => boolean = () => true) => { let best = -1, w = 0; for (let i = 2; i < n - 2; i++) { const t = l.y1[i] - l.y0[i]; if (t > w && free(i)) { w = t; best = i; } } return { i: best < 0 ? l.peak : best, w }; };

/**
 * How a topic spread: one band per kind of source over the last 14 days, as thick as its items, starting where that kind first had it. The order the kinds had the latest wave in
 * (Who said it first) is numbered on the stream and spelled out under it, with how long after the first each came; new papers on the subject sit on a rail above.
 * Inline SVG, no script. The bands are of different units of attention and are only drawn side by side, never added into one number.
 */
function spreadHtml(d: TopicData): string {
  const dots: TimelineDot[] = d.timeline ?? [];
  if (dots.length < 2) return '';
  const S = 42, kinds = (['x', 'hn', 'youtube', 'rss'] as EvKind[]).filter((k) => dots.some((t) => t.kind === k));
  const series = kinds.map((k) => { const v = new Array<number>(S).fill(0); for (const t of dots) if (t.kind === k) v[Math.min(S - 1, Math.max(0, Math.round(t.x * S - 0.5)))] += t.n; return { key: k, values: soften(v) }; });
  const lay = streamLayout(series, { order: 'inside-out' });
  if (!lay.layers.length) return '';
  const W = 720, H = 236, L = 8, R = 8, top = 40, bottom = 26, from = d.first.since, span = 14 * 86_400_000;
  const xs = Array.from({ length: S }, (_, i) => L + ((i + 0.5) / S) * (W - L - R)), tx = (ts: number) => L + Math.min(1, Math.max(0, (ts - from) / span)) * (W - L - R);
  const room = H - top - bottom, k = Math.min((room * 0.92) / Math.max(1e-9, lay.max - lay.min), 26), mid = top + room / 2, ty = (v: number) => mid - v * k;
  const bands = lay.layers.map((l) => `<path class="sb k-${l.key}" d="${bandPath(xs, l.y1.map(ty), l.y0.map(ty))}"><title>${esc(KIND_NAME[l.key as EvKind])}: ${n(Math.round(l.total))} ${Math.round(l.total) === 1 ? 'item' : 'items'}</title></path>`).join('');
  // the order of the latest wave, numbered where each kind came in
  const arr = d.first.arrivals.filter((a) => a.ts >= from), at = (kind: EvKind) => lay.layers.find((l) => l.key === kind);
  const pins = arr.map((a, i) => { const l = at(a.kind); if (!l) return ''; const x = tx(a.ts), j = Math.min(S - 1, Math.max(0, Math.round(((a.ts - from) / span) * S - 0.5))), y = ty((l.y0[j] + l.y1[j]) / 2);
    return `<g class="spin"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${i + 1}</text><title>${esc(`${i + 1}. ${KIND_NAME[a.kind]}, ${stampUtc(a.ts)}`)}</title></g>`; }).join('');
  const pinX = arr.map((a) => tx(a.ts));
  const names = lay.layers.map((l) => { const at = bandLabelAt(l, S, (i) => pinX.every((px) => Math.abs(px - xs[i]) > 30)); return at.w * k >= 15 ? `<text class="sbl" x="${xs[at.i].toFixed(1)}" y="${(ty((l.y0[at.i] + l.y1[at.i]) / 2) + 4.5).toFixed(1)}" text-anchor="middle">${esc(KIND_MARK[l.key as EvKind].short)}</text>` : ''; }).join('');
  const papers = d.papers.list.filter((p) => p.published >= from && p.published <= from + span);
  const rail = papers.length ? `<line class="srail" x1="${L}" x2="${W - R}" y1="14" y2="14"/>${papers.map((p) => { const x = tx(p.published); return `<path class="spaper" d="M${x.toFixed(1)},7 L${(x + 6).toFixed(1)},14 L${x.toFixed(1)},21 L${(x - 6).toFixed(1)},14 Z"><title>${esc(p.title)} (${esc(date(p.published))})</title></path>`; }).join('')}<text class="sax" x="${L}" y="33">${n(papers.length)} new ${papers.length === 1 ? 'paper' : 'papers'}</text>` : '';
  const days = d.series.days, ticks = days.length ? [0, Math.floor((days.length - 1) / 2), days.length - 1].map((i, j) => `<text class="sax" x="${(j === 0 ? L : j === 2 ? W - R : W / 2).toFixed(0)}" y="${H - 6}" text-anchor="${j === 0 ? 'start' : j === 2 ? 'end' : 'middle'}">${esc(shortDay(days[i]))}</text>`).join('') : '';
  const flow = arr.length > 1 ? `<ol class="sflow" aria-label="The order the kinds of source had the latest wave in">${arr.map((a, i) => `<li><span class="sk k-${a.kind}" aria-hidden="true"></span><b>${i + 1}. ${esc(KIND_NAME[a.kind])}</b><small>${a.lag <= TIE_MS ? (i ? 'at the same time' : esc(stampUtc(a.ts))) : '+' + esc(lagWords(a.lag))}</small></li>`).join('')}</ol>` : '';
  const words = lay.layers.slice().sort((a, b) => a.start - b.start).map((l) => `${KIND_NAME[l.key as EvKind]} from ${shortDay(days[Math.min(days.length - 1, Math.floor((l.start / S) * days.length))] ?? days[0])}, most around ${shortDay(days[Math.min(days.length - 1, Math.floor((l.peak / S) * days.length))] ?? days[0])}`).join('; ');
  const label = `How it spread over ${days.length} days: ${words}.${papers.length ? ` ${papers.length} new papers on the subject.` : ''}${arr.length ? ' ' + firstSentence(d.first) : ''}`;
  return `<h2 class="sect">How it spread</h2><div class="spread"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><line class="smid" x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}"/>${rail}${bands}${names}${pins}${ticks}</svg></div>
${flow}<p class="meta">One band per kind of source, as thick as its items at the time${papers.length ? '; diamonds above are new papers on the subject' : ''}. Numbers mark the order the kinds had the latest wave in, among the sources we follow; it does not say where the story began. Each kind is shown in its own band and never added into one number.</p>`;
}

/** The colours of the streamgraph's bands, biggest topic first: distinct from each other in both themes. With a lens, its own colour leads. */
const STREAM_COLORS = ['#1f7a8c', '#d6336c', '#e3a008', '#7c5cbf', '#2f9e6b', '#c2410c', '#4263eb', '#74b816', '#ae3ec9', '#868e96'];
/**
 * Topics as a streamgraph (src/signal/stream.ts): one band per topic over `days`, as thick as its mentions each day, centred on a line that moves so the bands bend as little as they can.
 * The biggest topics are named inside their bands; every band is a link, and the list under it names them all, so nothing depends on the colours.
 */
function topicStream(topics: Array<{ term: string; label: string; href: string; values: number[] }>, days: string[], lensColor?: string): string {
  const lay = streamLayout(topics.map((t) => ({ key: t.term, values: t.values })), { order: 'inside-out' });
  if (!lay.layers.length) return '';
  const S = days.length, W = 960, H = 300, L = 4, R = 4, top = 12, bottom = 24, room = H - top - bottom;
  const xs = Array.from({ length: S }, (_, i) => L + (S > 1 ? i / (S - 1) : 0.5) * (W - L - R)), k = (room * 0.94) / Math.max(1e-9, lay.max - lay.min), mid = top + room / 2, ty = (v: number) => mid - v * k;
  const byTerm = new Map(topics.map((t, i) => [t.term, { ...t, color: i === 0 && lensColor ? `var(--lc-${lensColor}, ${STREAM_COLORS[0]})` : STREAM_COLORS[i % STREAM_COLORS.length] }] as const));
  const bands = lay.layers.map((l) => { const t = byTerm.get(l.key)!, total = Math.round(t.values.reduce((a, b) => a + b, 0));
    return `<a href="${t.href}"><path class="tsb" style="fill:${t.color}" d="${bandPath(xs, l.y1.map(ty), l.y0.map(ty))}"><title>${esc(t.label)}: ${n(total)} ${total === 1 ? 'mention' : 'mentions'} in ${S} days</title></path></a>`; }).join('');
  const names = lay.layers.map((l) => { const t = byTerm.get(l.key)!, at = bandLabelAt(l, S), w = at.w * k, size = Math.min(15, Math.max(11, w * 0.45)), max = Math.floor(150 / (size * 0.55));
    return w >= 15 ? `<text class="tsl" x="${xs[at.i].toFixed(1)}" y="${(ty((l.y0[at.i] + l.y1[at.i]) / 2) + size * 0.36).toFixed(1)}" font-size="${size.toFixed(1)}" text-anchor="middle">${esc(t.label.length > max ? t.label.slice(0, max - 1) + '…' : t.label)}</text>` : ''; }).join('');
  const ticks = [0, Math.floor((S - 1) / 2), S - 1].map((i, j) => `<text class="sax" x="${xs[i].toFixed(0)}" y="${H - 6}" text-anchor="${j === 0 ? 'start' : j === 2 ? 'end' : 'middle'}">${esc(shortDay(days[i]))}</text>`).join('');
  const label = `Mentions per day over ${S} days for ${topics.length} topics: ${lay.layers.slice().sort((a, b) => b.total - a.total).map((l) => `${byTerm.get(l.key)!.label}, most on ${shortDay(days[l.peak])}`).join('; ')}.`;
  const key = topics.map((t) => { const c = byTerm.get(t.term)!; return `<li><span class="sk" style="background:${c.color}" aria-hidden="true"></span><a href="${t.href}">${esc(t.label)}</a></li>`; }).join('');
  return `<div class="tstream"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><line class="smid" x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}"/>${bands}${names}${ticks}</svg><ul class="tskey">${key}</ul>
<p class="meta">Each band is a topic, as thick as its mentions each day across the sources this page counts; the bands are stacked around a moving centre, so a band&rsquo;s height, not its place, is what counts. Click one to open it.</p></div>`;
}

function firstPanel(d: TopicData): string {
  const f = d.first, say = firstSentence(f);
  if (!f.arrivals.length) return '<p class="meta">No mention with a time of day was logged for this topic in the last two weeks, so there is no order to show.</p>';
  const link = `/signal/${esc(d.board.slug)}/first`;
  return `<p class="firstsay">${esc(say)}</p>
<ol class="firstlist">${f.arrivals.map((a, i) => `<li><span class="fnum">${i + 1}.</span><b>${esc(KIND_NAME[a.kind])}</b> <span class="when">${a.lag <= TIE_MS ? 'first' : esc(lagWords(a.lag)) + ' later'}, ${esc(stampUtc(a.ts))} &middot; ${n(a.n)} ${a.n === 1 ? 'item' : 'items'}</span>${a.item ? `<br>${a.item.url ? `<a href="${esc(a.item.url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(a.item.title || a.item.url)}</a>` : esc(a.item.title)}${a.item.by || a.item.source ? ` <small class="dim">${esc(a.item.by && a.item.by !== a.item.source ? a.item.by : a.item.source)}</small>` : ''}` : ''}</li>`).join('')}</ol>
<p class="meta">${esc(firstCaveat(f))}${d.board.proof ? '' : ' This Signal shows scores only, so the first items are not named.'}</p>
<p class="meta">Which kinds of source tend to be early across all topics, as a picture: <a href="${link}">Who said it first</a>.</p>`;
}

function watchPanel(d: TopicData): string {
  const w = d.watch ?? [];
  if (!w.length) return `<p class="meta">No video on this subject in the last two weeks${d.board.proof ? '' : ' (this Signal does not show the items it counts, so only videos on public feed pages are looked for)'}. Videos come from the YouTube channels followed here and from the feed pages of this site.</p>`;
  return `<ul class="vcards watchcards">${w.map((v) => `<li><a class="play" href="${esc(v.url)}" rel="noopener noreferrer nofollow" target="_blank"><img src="https://i.ytimg.com/vi/${esc(v.video)}/mqdefault.jpg" alt="" loading="lazy" width="320" height="180"></a>
<a href="${esc(v.url)}" rel="noopener noreferrer nofollow" target="_blank"><b>${esc(v.title)}</b></a><small>${esc(v.source)}${v.by && v.by !== v.source ? ' &middot; ' + esc(v.by) : ''} &middot; ${date(v.ts)}${v.views ? ` &middot; ${esc(roughly(v.views))} views` : ''}</small></li>`).join('')}</ul>
<p class="note">Videos from chosen YouTube channels and from feed pages, matched by the topic's names in their titles. Nothing plays here: each link opens the video on YouTube. Titles and pictures belong to their publishers.</p>`;
}

function topicPanel(d: TopicData, angle: Angle): string {
  if (angle === 'first') return firstPanel(d);
  if (angle === 'watch') return watchPanel(d);
  if (angle === 'briefings') {
    const b = d.briefings ?? [];
    return b.length ? `<ul class="sgitems">${b.map((m) => `<li><div class="by">${esc(m.title)} &middot; ${date(m.publishedAt)}</div><a href="/${esc(m.slug)}/${esc(m.id)}${m.anchor ? '#' + esc(m.anchor) : ''}">${m.theme ? esc(m.theme) : esc(m.title)}</a>${m.tldr ? `<p class="meta">${esc(m.tldr.length > 220 ? m.tldr.slice(0, 219) + '…' : m.tldr)}</p>` : ''}</li>`).join('')}</ul>`
      : '<p class="meta">No briefing of the last two weeks mentions this topic.</p>';
  }
  if (angle === 'papers') {
    const p = d.papers;
    return p.list.length ? `<p class="meta">${n(p.matched)} paper${p.matched === 1 ? '' : 's'} from the last 30 days ${p.matched === 1 ? 'names' : 'name'} this subject${p.mentioned ? `; ${n(p.mentioned)} ${p.mentioned === 1 ? 'is' : 'are'} named in posts or on Hacker News` : '; none is discussed in posts yet, which says nothing against them'}. They are found by the topic's names in titles and abstracts, so some may only be close. <a href="/research/map">See them on the Research map</a>.</p>
<ol class="papers">${p.list.map(paperHtml).join('')}</ol><p class="meta">Papers and abstracts from <a href="https://arxiv.org/" rel="noopener noreferrer">arXiv</a>, where each paper is hosted. Upvotes from <a href="https://huggingface.co/papers" rel="noopener noreferrer">Hugging Face Daily Papers</a>; points from Hacker News.</p>`
      : '<p class="meta">No new paper of the last 30 days names this subject.</p>';
  }
  if (!d.board.proof) return '<p class="note">This Signal shows scores only, not the items behind them.</p>';
  const kinds = (['x', 'hn', 'youtube', 'rss'] as EvKind[]).map((k) => [k, d.talk.filter((i) => i.kind === k)] as const).filter(([, l]) => l.length);
  return kinds.length ? kinds.map(([k, list]) => `<h3 class="azh">${KIND_TITLE[k]} <small>${n(d.counts[k] ?? list.length)} in the last week${(d.counts[k] ?? 0) > list.length ? `, the ${list.length} most reacted to` : ''}</small></h3>
<ul class="sgitems">${list.map((i) => `<li><div class="by"><b>${esc(i.source)}</b>${i.by && i.by !== i.source ? ' &middot; ' + esc(i.by) : ''} &middot; ${i.ts ? date(i.ts) : ''}${metricOf(i) ? ` &middot; <span class="chip react">${esc(metricOf(i))}</span>` : ''}</div>
${i.url ? `<a href="${esc(i.url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(i.title || i.url)}</a>` : esc(i.title)}${i.discussionUrl ? ` <a class="dim" href="${esc(i.discussionUrl)}" rel="noopener noreferrer nofollow" target="_blank">discussion</a>` : ''}</li>`).join('')}</ul>`).join('')
    + '<p class="note">Titles and links are those of the original publishers. Follow the links to read the originals.</p>' : '<p class="meta">Nothing is logged for the last week.</p>';
}

export function topicHtml(d: TopicData, ctx: Ctx, angle: Angle, origin = '', lenses: Lens[] = []): string {
  const st = d.state, sm = d.summary, inLenses = lensesOfTopic(lenses, d);
  const lensLine = inLenses.length ? `<p class="meta">In ${inLenses.length === 1 ? 'the lens' : 'the lenses'}: ${inLenses.map((l) => `<a class="lenstag lc-${l.color}" href="/topics?lens=${esc(l.key)}${d.area === 'politics' ? '&amp;area=politics' : ''}" data-lens="${esc(l.key)}" title="See the topics of this lens">${esc(l.name)}</a>`).join(' ')}</p>` : '';
  const pill = st ? `<span class="pstate ${st}">${STATE_MARK[st]} ${STATE_LABEL[st]}</span>` : '';
  const written = sm ? `<details class="sumfrom"><summary>Written by an AI on ${esc(sm.day)} from ${n(sm.itemCount)} item${sm.itemCount === 1 ? '' : 's'}. It can get things wrong.</summary>${sm.items.length ? `<ul>${sm.items.map((i) => `<li>${i.url ? `<a href="${esc(i.url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(i.title || i.url)}</a>` : esc(i.title)}${i.by ? ` <small>${esc(i.by)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="meta">This Signal does not list the items.</p>'}</details>`
    : '<p class="meta">No written summary yet: this line is made from the numbers.</p>';
  const counts = (Object.entries(d.counts) as Array<[EvKind, number]>).map(([k, v]) => `${n(v)} on ${esc({ x: 'X', hn: 'Hacker News', youtube: 'YouTube', rss: 'blogs and news', arxiv: 'papers' }[k])}`).join(' &middot; ');
  const count = (a: Angle) => (a === 'talk' ? d.total : a === 'first' ? d.first.arrivals.length : a === 'watch' ? d.watch.length : a === 'briefings' ? d.briefings?.length ?? 0 : d.papers.matched);
  const tabs = `<nav class="sgwin angles" aria-label="Angles on this topic">${ANGLES.map(([k, label]) => `<a href="${esc(topicHref(d.slug, d.area, k === 'talk' ? undefined : k))}"${angle === k ? ' aria-current="page"' : ''}>${label} <small>${n(count(k))}</small></a>`).join('')}</nav>`;
  const names = d.members.length ? `Also counted under: ${esc(d.members.join(', '))}. ` : '';
  // The same name can be a topic in the other area too: it has its own page there (?area=), and is not mixed into this one.
  const here = d.alsoIn.filter((b) => (b.area ?? 'ai') === d.area), other = [...new Set(d.alsoIn.filter((b) => (b.area ?? 'ai') !== d.area).map((b) => b.area ?? 'ai'))];
  const also = (here.length ? `Also in: ${here.map((b) => `<a href="/signal/${esc(b.slug)}">${esc(b.title)}</a>`).join(', ')}. ` : '') + other.map((a) => `The same name is also a topic in <a href="${esc(topicHref(d.slug, a))}">${AREA_LABEL[a]}</a>. `).join('');
  const areaLink = d.area === 'politics' || ctx.areas.length > 1 ? `<a href="${AREA_HOME[d.area]}">${AREA_LABEL[d.area]}</a> &middot; ` : '';
  const summary = sm?.text ?? d.fallback;
  return shell(`${d.label} · Topic · Undercurrent`, bar(ctx, undefined, 'topics'), `<header class="pagehead"><div class="eyebrow">${areaLink}Topic &middot; <a href="/signal/${esc(d.board.slug)}">${esc(d.board.title)}</a></div><h1>${esc(d.label)} ${pill}</h1>
<p class="lede">${esc(summary)}</p>${written}${lensLine}${topicActions(ctx, d)}</header>
${lifeHtml(d.series)}
<p class="meta">Items per day over the last 14 days: bars for each day, the curve their three-day average${d.series.usual ? ', the dashed line the usual level' : ''}. ${d.total ? `In the last ${d.days} days: ${counts}.` : ''} ${names}${also}</p>
${evidenceHtml(d)}
${spreadHtml(d)}
${timelineHtml(d)}
<h2 class="sect">The angles</h2>${tabs}
<section id="angle">${topicPanel(d, angle)}</section>
${d.related.length ? `<h2 class="sect">Goes with</h2><p class="meta">${d.related.map((r) => `<a href="${esc(topicHref(r.slug, d.area))}">${esc(r.label)}</a>`).join(' &middot; ')}</p>` : ''}`,
  { description: summary, canonical: origin ? origin + topicHref(d.slug, d.area) : undefined, image: origin ? origin + cardHref(d.slug, d.area) : undefined });
}

// ---- The signed-in reader (src/site/me.ts): their topics on the front page, Follow and Ask Claude on a topic page, and /me. Only on pages made for them.
/** "Your topics" on the front page: what the reader follows in this area, with how each stands in the window. */
function yoursHtml(ctx: Ctx, topics: SigTopic[], state: (t: SigTopic) => string, area: Area, pct: ((x: number) => string) | null): string {
  const mine = (ctx.me?.follows ?? []).filter((f) => f.area === area);
  if (!mine.length) return '';
  const by = new Map(topics.map((t) => [topicSlug(t.term), t] as const));
  const row = (f: (typeof mine)[number]) => {
    const t = by.get(f.slug), st = (t ? state(t) : '') as 'new' | 'rising' | 'falling' | '';
    const how = !t ? '<small>quiet in this window</small>' : `${st ? `<span class="pstate ${st}">${STATE_MARK[st]} ${STATE_LABEL[st]}</span> ` : ''}${pct ? `<small>${pct(t.signal)} of items</small>` : ''}`;
    return `<li><a href="${esc(topicHref(f.slug, area))}">${esc(t?.label ?? f.label)}</a> ${how}</li>`;
  };
  return `<section class="yours" aria-labelledby="h-yours"><h2 class="sect" id="h-yours">Your topics</h2><ul>${mine.map(row).join('')}</ul><p class="meta"><a href="/me#follows">What you follow</a></p></section>`;
}
const hidden = (fields: Record<string, string>) => Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('');
const msgLine = (ctx: Ctx) => (ctx.msg ? `<p class="memsg" role="status">${esc(ctx.msg)}</p>` : '');
/** Follow on every topic page (a plain form, so it works on a page from the shared cache too) and, for a reader whose role has it, Ask Claude. */
function topicActions(ctx: Ctx, d: TopicData): string {
  if (!ctx.users) return '';
  const here = topicHref(d.slug, d.area), on = !!ctx.me?.follows.some((f) => f.slug === d.slug && f.area === d.area);
  const follow = `<form method="post" action="/me/${on ? 'unfollow' : 'follow'}" class="meform inline">${hidden({ slug: d.slug, area: d.area, label: d.label, back: here })}<button type="submit" class="followbtn" aria-pressed="${on}">${on ? '✓ Following' : '+ Follow'}</button></form>`;
  const me = ctx.me, ask = me?.access.features.includes('ask') ? `<form method="post" action="/me/ask" class="meform askbox">${hidden({ slug: d.slug, area: d.area, back: here })}
<label for="askq">Ask Claude about ${esc(d.label)}</label><textarea id="askq" name="question" rows="2" maxlength="500" required placeholder="What changed this week? Who is behind it?"></textarea>
<div class="askrow"><button type="submit"${me.askLeft ? '' : ' disabled'}>Ask</button><small>${me.askLeft} of ${me.access.askPerDay} questions left today. Answered from this page’s data by a language model, which can get things wrong. <a href="/me#asks">Your questions</a></small></div></form>` : '';
  return `<div class="meacts">${follow}</div>${msgLine(ctx)}${ask}`;
}
const WIN_NAME: Record<number, string> = { 1: 'Today', 3: '3 days', 7: '7 days' };
/** /me: what the reader keeps (front page, own lenses, followed topics) and their questions, each changed by a plain form. */
export function meHtml(ctx: Ctx, me: Me, siteLenses: Lens[], asks: AskRow[]): string {
  const opt = (v: string, label: string, cur: string) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const lensOpts = opt('', 'All topics', me.prefs.lens) + siteLenses.map((l) => opt(l.key, l.name, me.prefs.lens)).join('') + me.lenses.map((l) => opt(l.key, `${l.name} (yours)`, me.prefs.lens)).join('');
  const prefs = `<form method="post" action="/me/prefs" class="meform card">${hidden({ back: '/me' })}<h3>Your front page</h3><p class="meta">The front page opens on these when you go to it without choosing. You can still pick another lens or window there.</p>
<label>Lens <select name="lens">${lensOpts}</select></label> <label>Window <select name="window">${[1, 3, 7].map((w) => opt(String(w), WIN_NAME[w], String(me.prefs.window))).join('')}</select></label> <button type="submit">Save</button></form>`;
  const colours = (cur: string) => LENS_COLORS.map((c) => opt(c, c, cur)).join('');
  const lensForm = (l?: Lens) => `<form method="post" action="/me/lens" class="meform lensform">${hidden({ back: '/me#lenses', ...(l ? { key: l.key } : {}) })}
<label>Name <input name="name" maxlength="30" required value="${esc(l?.name ?? '')}"></label> <label>Colour <select name="color">${colours(l?.color ?? '')}</select></label>
<label class="wide">Topics and words, one per line or separated by commas <textarea name="terms" rows="3" required>${esc((l?.terms ?? []).join('\n'))}</textarea></label>
<label class="wide">What it is for (optional) <input name="description" maxlength="120" value="${esc(l?.description ?? '')}"></label><button type="submit">${l ? 'Save' : 'Add the lens'}</button></form>`;
  const lenses = `<section class="card" id="lenses"><h3>Your lenses</h3><p class="meta">A lens puts the topics that use its words first and marks them, like the site’s lenses. Yours are only shown to you, in the lens chooser and on the front page (?lens=my-…). Up to ${MAX_OWN_LENSES}.</p>
${me.lenses.map((l) => `<details class="mylens"><summary><span class="lenstag lc-${esc(l.color)}">${esc(l.name)}</span> <small>${l.terms.length} term${l.terms.length === 1 ? '' : 's'}</small> <a href="/?lens=${esc(l.key)}">Open</a></summary>${lensForm(l)}
<form method="post" action="/me/lens-delete" class="meform inline">${hidden({ key: l.key, back: '/me#lenses' })}<button type="submit" class="ghost">Remove this lens</button></form></details>`).join('')}
${me.lenses.length < MAX_OWN_LENSES ? `<details class="mylens"${me.lenses.length ? '' : ' open'}><summary>New lens</summary>${lensForm()}</details>` : ''}</section>`;
  const follows = `<section class="card" id="follows"><h3>Topics you follow</h3>${me.follows.length ? `<ul class="mefollows">${me.follows.map((f) => `<li><a href="${esc(topicHref(f.slug, f.area))}">${esc(f.label)}</a>${f.area === 'politics' ? ' <small>Politics</small>' : ''} <form method="post" action="/me/unfollow" class="meform inline">${hidden({ slug: f.slug, area: f.area, back: '/me#follows' })}<button type="submit" class="ghost">Unfollow</button></form></li>`).join('')}</ul>`
    : '<p class="meta">None yet. Use <b>+ Follow</b> on a topic’s page: the topics you follow are shown first on the front page, with how each stands.</p>'}<p class="meta">Up to ${MAX_FOLLOWS}.</p></section>`;
  const canAsk = me.access.features.includes('ask');
  const asked = `<section class="card" id="asks"><h3>Ask Claude</h3>${canAsk ? `<p class="meta">On a topic’s page, ask a question about it. ${me.askLeft} of ${me.access.askPerDay} questions left today (the day turns at 00:00 UTC).</p>`
    : `<p class="meta">Not included for your account. ${esc(FEATURES.find((x) => x.key === 'ask')!.description)}</p>`}
${asks.length ? `<ul class="measks">${asks.map((a) => `<li><a href="/me/ask/${a.id}">${esc(a.question)}</a> <small>${esc(a.label)} &middot; ${date(a.at)}</small></li>`).join('')}</ul>` : ''}</section>`;
  return shell('Your settings · Undercurrent', bar(ctx, undefined, 'me'), `<header class="pagehead"><div class="eyebrow">Your settings</div><h1>Your Undercurrent</h1>
<p class="lede">Signed in as <b>${esc(me.email)}</b>${me.access.role.key === 'reader' ? '' : ` &middot; ${esc(me.access.role.name)}`}. What you keep here follows you to any device you sign in on, and is only shown to you.</p>${msgLine(ctx)}</header>
<div class="mepage">${prefs}${lenses}${follows}${asked}</div>`, {});
}
/** /me/ask/<id>: one of the reader's questions and its answer. */
export function askHtml(ctx: Ctx, a: AskRow, me: Me): string {
  const topic = topicHref(a.slug, a.area);
  const again = me.access.features.includes('ask') ? `<p class="meta">${me.askLeft} of ${me.access.askPerDay} questions left today. <a href="${esc(topic)}#askq">Ask another</a></p>` : '';
  return shell(`${a.question.slice(0, 60)} · Ask Claude · Undercurrent`, bar(ctx, undefined, 'me'), `<header class="pagehead"><div class="eyebrow"><a href="/me#asks">Your questions</a> &middot; <a href="${esc(topic)}">${esc(a.label)}</a></div><h1>${esc(a.question)}</h1></header>
<article class="prose askanswer">${markdown(a.answer)}</article>
<p class="meta">Answered on ${date(a.at)} by ${esc(a.model)} from the data of <a href="${esc(topic)}">${esc(a.label)}</a> at that time. A language model can get things wrong: follow the links to check.</p>${again}`, {});
}

/** What the numbers mean and how they are made, in plain words. */
export function signalMethodHtml(ctx: Ctx): string {
  return shell('How Signal works · Undercurrent', bar(ctx, undefined, 'method'), `<header class="pagehead"><div class="eyebrow">Methodology</div><h1>How Signal works</h1>
<p class="lede">Signal shows what is being talked about across the feeds, channels and accounts we follow. Everything is counted automatically. This page says how, and where it can go wrong.</p></header>
<h2 class="sect">Sources and groups</h2>
<p class="meta">We follow public posts, articles, videos and Hacker News stories. Sources are put into <b>groups</b> (for example "Hacker News" or "AI YouTube"), and each group has a <b>weight</b> that sets how much it counts. Briefings written on this site can also feed a group; their posts were already picked from many sources, so that group starts with a higher weight.</p>
<h2 class="sect">Finding topics</h2>
<p class="meta">Each new item is read once and given up to three topics. Depending on the Signal, a topic is either a word or phrase found in the title and text, or a name written by a language model that names the <i>story</i> ("scribd breach", not just "scribd"). Model-written names are not checked by a person and can be wrong or inconsistent. The model is asked to reuse names it has used before, so one story keeps one name. Very common words and names that are in the news every day are not allowed as topics on their own.</p>
<h2 class="sect">The score</h2>
<p class="meta">A topic's score is the share of each group's items that mention it, averaged over the groups by weight. Shares, not counts, so a busy group cannot drown a small one. A topic that two or more different sources mention counts; one source repeating itself does not.</p>
<h2 class="sect">Rising, new and background</h2>
<p class="meta"><b>Rising</b> compares the period with the one before it, and needs a few days of data first. <b>New</b> means it was not there in the period before. Topics that are present on most days at the same level (for example "claude" on a feed about AI) are <b>background</b>: they are left out unless they spike, so what is new or growing stands out. The page says how many were left out.</p>
<h2 class="sect">Reactions</h2>
<p class="meta">Where the source gives them, we add up likes, points and upvotes (replies and shares count double). A topic whose items people reacted to most moves up the list, by at most half again its score, and on a log scale so one viral item does not take over. The number shown is a sum over the items we saw, not a total for the whole web.</p>
<h2 class="sect">What is shown, and what is not</h2>
<p class="meta">Pages show group names, topics and scores. A Signal can also show the items behind each topic, with their sources and links to the originals; titles and links belong to the original publishers. Names of individual feeds and accounts are shown only on those item lists. We do not store or show the full text of items on these pages.</p>
<h2 class="sect">Limits</h2>
<p class="meta">Only what we follow is counted, so a topic appears only if something we follow covers it. Small groups and short windows are noisy. Items are kept for 30 days. Topics are automatic: a mistake is fixed by changing a rule (a source, a weight or a word filter), not by editing one topic.</p>`,
  { description: 'How Signal finds topics, scores them, and what it shows.' });
}

/** A published Signal that has nothing to draw, or cannot be drawn now. */
export function signalMessageHtml(ctx: Ctx, slug: string, message: string): string {
  const b = ctx.boards.find((x) => x.slug === slug);
  return shell(`${b?.title ?? 'Signal'} · Undercurrent`, bar(ctx, undefined, 'signal', slug), `<header class="pagehead"><div class="eyebrow">Signal</div><h1>${esc(b?.title ?? 'Signal')}</h1>${b?.description ? `<p class="lede">${esc(b.description)}</p>` : ''}</header><p class="meta">${esc(message)}</p>`);
}

const SORTS = [['strength', 'Strongest'], ['rising', 'Rising'], ['new', 'New'], ['reacted', 'Most reacted']] as const;
export type SigSort = (typeof SORTS)[number][0];
/** Whether the topic at `i` is itself drawn as a part (so a second part under the same topic is too). */
const partOf0 = (list: Array<{ term: string; parent?: string }>, i: number): boolean => !!list[i].parent && (list[i - 1]?.term === list[i].parent || (i > 0 && list[i - 1]?.parent === list[i].parent && partOf0(list, i - 1)));

export function signalPageHtml(d: PubSignal, ctx: Ctx, q: { sort: SigSort; group: number; lenses?: Lens[]; lens?: Lens } = { sort: 'strength', group: -1 }): string {
  const gname = (i: number) => d.groups[i]?.name ?? '';
  // Every topic opens its own page (its numbers and movement; with sources switched on, also the items behind it).
  const termLink = (t: PubSigTerm) => `<a href="${topicUrl(t.term, ctx.area)}">${esc(t.label)}</a>`;
  // Sort and filter, as links (the public pages run no script): ?sort=rising&group=1
  const base = `/signal/${esc(d.slug)}${d.days === 7 ? '' : '/' + d.days}`, qs = (sort: string, group: number, lens = q.lens?.key ?? '') => { const p = [sort !== 'strength' ? 'sort=' + sort : '', group >= 0 ? 'group=' + group : '', lens ? 'lens=' + encodeURIComponent(lens) : ''].filter(Boolean).join('&amp;'); return base + (p ? '?' + p : ''); };
  const key = (t: PubSigTerm) => (q.sort === 'reacted' ? t.reactions ?? 0 : q.sort === 'rising' ? (t.isNew ? 1e6 : t.change ?? 0) : t.signal);
  let topList = d.top.filter((t) => (q.group < 0 || (t.shares?.[q.group] ?? 0) > 0) && (q.sort === 'new' ? t.isNew : q.sort === 'rising' ? t.isNew || (t.change ?? 0) >= 1.5 : q.sort === 'reacted' ? (t.reactions ?? 0) > 0 : true));
  if (q.sort !== 'strength' && q.sort !== 'new') topList = [...topList].sort((a, b) => key(b) - key(a) || b.signal - a.signal);
  topList = partsAfterParents(topList);
  // A lens puts its topics first (and marks them); the others stay below, dimmed. Something big outside the lens is pointed out above the list.
  const lens = q.lens, applied = applyLens(topList, lens), inLens = new Set(applied.ordered.filter((x) => x.inLens).map((x) => x.topic.term));
  if (lens) topList = applied.ordered.map((x) => x.topic);
  topList = topList.slice(0, 20);
  // A part is drawn under its topic only when it directly follows it (a lens can pull a part away from its topic).
  const partOf = new Set(topList.filter((t, i) => partOf0(topList, i)).map((t) => t.term)), isPart = (t: PubSigTerm) => partOf.has(t.term);
  const rowLens = (t: PubSigTerm) => (lens ? (inLens.has(t.term) ? ` lensin lc-${lens.color}` : ' lensout') : '');
  const sortBar = `<nav class="sgwin" aria-label="Sort">${SORTS.map(([k, label]) => `<a href="${qs(k, q.group)}"${q.sort === k ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`
    + (d.groups.length > 1 ? `<nav class="sgwin" aria-label="Show one group"><a href="${qs(q.sort, -1)}"${q.group < 0 ? ' aria-current="page"' : ''}>All groups</a>${d.groups.map((g, i) => `<a href="${qs(q.sort, i)}"${q.group === i ? ' aria-current="page"' : ''}>${esc(g.name)}</a>`).join('')}</nav>` : '');
  const chips = (t: PubSigTerm) => [
    lens && inLens.has(t.term) ? lensTag(lens) : '',
    d.groups.length > 1 ? (t.kind === 'shared' ? '<span class="chip shared">everywhere</span>' : t.kind === 'single' ? `<span class="chip single">only ${esc(gname(t.top))}</span>` : '<span class="chip">mixed</span>') : '',
    t.isNew ? '<span class="chip up">new</span>' : t.change !== null && t.change >= 1.5 ? `<span class="chip up">&uarr; &times;${t.change.toFixed(1)}</span>` : '',
    t.reactions ? `<span class="chip react" title="Reactions to the items we saw">&#9650; ${kfmt(t.reactions)}</span>` : '',
  ].join('');
  const max = Math.max(1e-9, ...topList.map((t) => t.signal));
  const headline = (t: PubSigTerm) => { const h = t.headlines?.[0]; return h?.title ? `<div class="hl">${h.url ? `<a href="${esc(h.url)}" rel="noopener noreferrer nofollow" target="_blank">&ldquo;${esc(h.title)}&rdquo;</a>` : `&ldquo;${esc(h.title)}&rdquo;`}${h.by ? ` <small>${esc(h.by)}</small>` : ''}${h.reactions ? ` <small>&#9650; ${kfmt(h.reactions)}</small>` : ''}</div>` : ''; };
  const name = (t: PubSigTerm) => `<span class="t" title="${esc([t.label, ...t.members].join(', '))}">${termLink(t)}${t.related.length ? `<small>${esc(t.related.join(' · '))}</small>` : ''}</span>`;
  const rows = topList.map((t) => `<div class="sgrow${isPart(t) ? ' sgpart' : ''}${rowLens(t)}">${name(t)}
<span class="bar" style="width:${Math.max(2, (100 * t.signal) / max).toFixed(1)}%" role="img" aria-label="${esc(t.parts.map((p, i) => `${gname(i)} ${Math.round(p * 100)}%`).join(', '))}">${t.parts.map((p, i) => (p >= 0.02 ? `<i style="flex:${p.toFixed(3)};background:${sigColor(i)}" title="${esc(gname(i))}"></i>` : '')).join('')}</span>
<b>${sigPct(t.signal)}</b><span class="cs">${chips(t)}</span>${headline(t)}</div>`).join('');
  // "Where it shows up": each group's own share of its items, one column per group. Switched with a radio, so the page needs no script.
  const topShare = Math.max(1e-9, ...topList.flatMap((t) => t.shares ?? []));
  const cols = `grid-template-columns:repeat(${d.groups.length},minmax(0,1fr))`;
  const grid = topList.map((t) => `<div class="sgrow sgwhere${isPart(t) ? ' sgpart' : ''}${rowLens(t)}">${name(t)}
<span class="cells" style="${cols}">${d.groups.map((_, i) => { const v = t.shares?.[i] ?? 0; return v > 0 ? `<span class="cell" title="${esc(gname(i))}"><i style="width:${Math.max(6, (100 * v) / topShare).toFixed(0)}%;background:${sigColor(i)}"></i><em>${sigPct(v)}</em></span>` : '<span class="cell"></span>'; }).join('')}</span>
<b>${sigPct(t.signal)}</b><span class="cs">${chips(t)}</span>${headline(t)}</div>`).join('');
  const view = rows ? `<div class="sgview"><input type="radio" name="sgv" id="sgv1" checked><input type="radio" name="sgv" id="sgv2">
<div class="sgtabs"><label for="sgv1">Strength</label><label for="sgv2">Where it shows up</label></div>
<div class="sgrows v1">${rows}</div><div class="sgrows v2"><div class="sgcols" style="${cols}">${d.groups.map((g) => `<span>${esc(g.name)}</span>`).join('')}</div>${grid}</div></div>` : '';
  const list = (title: string, hint: string, ts: PubSigTerm[], note: (t: PubSigTerm) => string) =>
    `<section class="panel"><h3>${title}</h3><p class="meta" style="margin:-4px 0 8px">${hint}</p>${ts.length ? `<ul class="sglist">${ts.map((t) => `<li><span>${termLink(t)}</span><small>${note(t)}</small></li>`).join('')}</ul>` : '<p class="meta">Nothing yet.</p>'}</section>`;
  const peak = Math.max(1, ...d.volumeDays.map((_, i) => d.groups.reduce((n, g) => n + (g.perDay[i] ?? 0), 0)));
  const volume = `<div class="act stack" role="img" aria-label="Items per day by group">${d.volumeDays.map((day, i) => {
    const total = d.groups.reduce((n, g) => n + (g.perDay[i] ?? 0), 0);
    return `<div style="height:${total ? Math.max(3, (100 * total) / peak) : 0}%" title="${esc(day)}: ${n(total)} items">${d.groups.map((g, j) => `<i style="flex:${g.perDay[i] ?? 0};background:${sigColor(j)}"></i>`).join('')}</div>`;
  }).join('')}</div><div class="axis"><span>${esc(d.volumeDays[0])}</span><span>${esc(d.volumeDays[d.volumeDays.length - 1])}</span></div>`;
  const keep = [q.sort !== 'strength' ? 'sort=' + q.sort : '', q.group >= 0 ? 'group=' + q.group : '', lens ? 'lens=' + encodeURIComponent(lens.key) : ''].filter(Boolean).join('&amp;');   // the window keeps the sort and the group
  const win = [[1, 'Today'], [3, '3 days'], [7, '7 days'], [14, '14 days']].map(([k, label]) => `<a href="/signal/${esc(d.slug)}${k === 7 ? '' : '/' + k}${keep ? '?' + keep : ''}"${d.days === k ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return shell(`${d.title} · Signal · Undercurrent`, bar(ctx, undefined, 'signal', d.slug, { lens, href: (p) => qs(q.sort, q.group, p.lens ?? '') }), `<header class="pagehead"><div class="eyebrow">${esc(d.from)}${d.from === d.to ? '' : ' to ' + esc(d.to)}</div><h1>${esc(d.title)}</h1>
<p class="lede">${d.description ? esc(d.description) + ' ' : ''}What is being talked about across ${d.groups.length === 1 ? 'one group of sources' : `${d.groups.length} groups of sources`}, combined into one score, and where each topic shows up.</p></header>
${d.groups.length > 1 ? vizLink(`/signal/${esc(d.slug)}/first`, 'Who said it first', 'See which of these sources has a topic before the others.') : ''}
${lens ? `<p class="meta">${lensTag(lens)} ${esc(lens.description)} ${inLens.size ? `${(() => { const k = topList.filter((t) => inLens.has(t.term)).length; return `${n(k)} of the ${n(topList.length)} topics shown ${k === 1 ? 'is' : 'are'} in it; they come first.`; })()}` : 'No topic shown below is in it today.'}</p>${outsideLine(applied.outside, ctx.area)}` : ''}
<nav class="sgwin" aria-label="Period">${win}</nav>
<div class="sglegend">${d.groups.map((g, i) => `<span><i style="background:${sigColor(i)}"></i>${esc(g.name)} <small>${n(g.items)} items${g.weight === 1 ? '' : ` &middot; counts &times;${g.weight}`}</small></span>`).join('')}</div>
<h2 class="sect">What is in the signal</h2>
${sortBar}${rows ? `${view}<p class="note">Each bar is split by the group the topic comes from, so a bar of one colour is a topic only that group is talking about.</p>` : `<p class="meta">${d.top.length ? 'No topic matches this filter.' : 'No topic is mentioned often enough yet.'}</p>`}
<div class="panels">${list('Everywhere', 'Mentioned in most groups at once', d.shared, (t) => `${t.breadth} of ${t.active} groups`)}
${d.groups.length > 1 ? list('Only in one group', 'What one kind of source is talking about alone', d.single, (t) => esc(gname(t.top))) : ''}
${list('Rising', d.baselineOk ? 'More than in the period before' : 'Needs a few more days of data', d.rising, (t) => (t.isNew ? 'new' : `&times;${(t.change ?? 0).toFixed(1)}`))}</div>
<h2 class="sect">Items per day</h2><section class="panel">${volume}</section>
<p class="note"><a href="/topics">All topics, A to Z</a> &middot; <a href="/signal/method">How this is worked out.</a> Topics are found automatically in the titles and text of public posts and articles${d.ai ? ', named by a language model that reads each item once' : ', by counting words and phrases'}. A topic's score is the share of a group's items that mention it, averaged over the groups. Topics that are always around at the same level as in the period before are left out${d.steadyHidden ? ` (${n(d.steadyHidden)} here)` : ''}, so what is new or growing stands out. It reflects only the sources watched here.${d.proof ? ' Select a topic to see the items behind it.' : ''}</p>`,
  { description: 'What is being talked about across news, blogs, X and Hacker News, combined into one score, and where each topic shows up.' });
}

// ---- History reports: a collection of tweets with its statistics, published from the admin. Never cost.
const day = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const dayTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC';
const rangeText = (from: number, to: number) => `${day(from)} – ${day(to - 1)}`;

function reportCards(list: PubReportBrief[]): string {
  return list.map((r) => `<li class="pic"><a class="card" href="/history/${esc(r.slug)}"><span class="eyebrow">${rangeText(r.fromTs, r.toTs)}</span><h2>${esc(r.title)}</h2>${r.description ? `<p>${esc(r.description)}</p>` : ''}
<div class="foot"><span>${n(r.tweets)} tweets</span><span>Published ${date(r.publishedAt)}</span></div></a><a class="cardpic" href="/history/${esc(r.slug)}/galaxy">See as a galaxy &rarr;</a></li>`).join('');
}

export function historyIndexHtml(ctx: Ctx): string {
  return shell('Reports · Undercurrent', bar(ctx, undefined, 'history'), `<header class="pagehead"><div class="eyebrow">${ctx.reports.length} report${ctx.reports.length === 1 ? '' : 's'}</div><h1>Reports</h1>
<p class="lede">Collections of public posts on X over longer periods, with the numbers behind them and every post.</p></header>
<ul class="topics">${reportCards(ctx.reports)}</ul>`, { description: 'Collections of public posts on X over longer periods, with statistics.' });
}

/** Ranked list with a bar per row, for accounts, hashtags, words... */
const rank = (title: string, rows: Array<{ label: string; count: number; note?: string; html?: string }>): string => {
  if (!rows.length) return '';
  const max = Math.max(1, ...rows.map((r) => r.count));
  return `<section class="rank"><h3>${esc(title)}</h3>${rows.map((r) => `<div><span title="${esc(r.label)}">${r.html ?? esc(r.label)}</span><i style="width:${Math.max(2, Math.round((100 * r.count) / max))}%"></i><b>${n(r.count)}${r.note ? ` <small>${esc(r.note)}</small>` : ''}</b></div>`).join('')}</section>`;
};

const tweetHtml = (t: PubTweet): string => `<article class="tw"><header><b>${esc(t.author.name || t.author.userName)}</b> ${t.author.userName ? handleLink(t.author.userName) : ''} <span class="dim">· ${Number.isFinite(Date.parse(t.createdAt)) ? `<time datetime="${new Date(t.createdAt).toISOString()}">${dayTime(t.createdAt)}</time>` : ''}${t.isReply ? ' · reply' : ''}</span></header>
<p>${esc(t.text).replace(/\n/g, '<br>')}</p>
<footer><span>&#9829; ${n(t.likeCount)}</span><span>&#8635; ${n(t.retweetCount)}</span><span>&#8617; ${n(t.replyCount)}</span>${t.viewCount ? `<span>${n(t.viewCount)} views</span>` : ''}${/^https:\/\/(x|twitter)\.com\//.test(t.url) ? `<a href="${esc(t.url)}" rel="noopener noreferrer nofollow" target="_blank">View on X</a>` : ''}</footer></article>`;

/** The AI analysis on a report: the written summary, the themes and the stance toward each subject. Labelled as written by AI. */
function analysisHtml(r: PubReport): string {
  const an = r.analysis; if (!an) return '';
  const res = an.results, themes = res.themes.filter((t) => t.count).sort((a, b) => b.count - a.count);
  const stance = res.subjects.map((s) => {
    const sides = s.for + s.against + s.neutral, max = Math.max(1, ...s.perStep.for.map((v, i) => v + s.perStep.against[i] + s.perStep.neutral[i]));
    const pct = (v: number) => (sides ? (100 * v) / sides : 0).toFixed(1);
    const desc = an.subjects.find((x) => x.name === s.name)?.description;
    return `<section class="panel"><h3>${esc(s.name)} <small>stance of the tweets that take a side</small></h3>${desc ? `<p class="meta" style="margin:0 0 8px">${esc(desc)}</p>` : ''}
<div class="split" role="img" aria-label="Supportive ${s.for}, critical ${s.against}, neutral ${s.neutral}"><i class="for" style="width:${pct(s.for)}%"></i><i class="neu" style="width:${pct(s.neutral)}%"></i><i class="against" style="width:${pct(s.against)}%"></i></div>
<p class="legend"><span class="for">Supportive ${n(s.for)}</span> <span class="neu">Neutral ${n(s.neutral)}</span> <span class="against">Critical ${n(s.against)}</span> <span class="dim">${n(s.none)} not about it</span></p>
${s.perStep.for.length > 1 ? `<div class="act stack" role="img" aria-label="Stance over time">${s.perStep.for.map((f, i) => { const a = s.perStep.against[i], u = s.perStep.neutral[i], t = f + a + u;
  return `<div style="height:${t ? Math.max(3, (100 * t) / max) : 0}%" title="${n(f)} supportive, ${n(u)} neutral, ${n(a)} critical"><i class="against" style="flex:${a}"></i><i class="neu" style="flex:${u}"></i><i class="for" style="flex:${f}"></i></div>`; }).join('')}</div>` : ''}
${s.top.for || s.top.against ? `<p class="meta" style="margin:8px 0 0">${s.top.for ? `Best-liked supportive: ${s.top.for.url ? `<a href="${esc(s.top.for.url)}" rel="noopener noreferrer nofollow" target="_blank">@${esc(s.top.for.handle)}</a>` : '@' + esc(s.top.for.handle)}. ` : ''}${s.top.against ? `Best-liked critical: ${s.top.against.url ? `<a href="${esc(s.top.against.url)}" rel="noopener noreferrer nofollow" target="_blank">@${esc(s.top.against.handle)}</a>` : '@' + esc(s.top.against.handle)}.` : ''}</p>` : ''}</section>`;
  }).join('');
  return `<h2 class="sect" id="analysis">Analysis <small class="dim">written by AI</small></h2>
${an.narrative ? `<article class="an">${markdown(an.narrative)}</article>` : ''}
<div class="panels">${rank('Themes', themes.map((t) => ({ label: t.name, count: t.count, note: `${res.labelled ? Math.round((100 * t.count) / res.labelled) : 0}%` })))}${stance}</div>
<p class="note">The summary and the labels (theme, kind, stance) were made by AI models from the collected tweets and can be wrong. ${n(res.labelled)} of ${n(res.total)} tweets were labelled.</p>`;
}

export function reportHtml(r: PubReport, tw: PubTweets, origin: string, ctx: Ctx): string {
  const { report, job, stats: s } = r, base = `/history/${report.slug}`;
  const href = (sort: 'new' | 'top', p: number) => (sort === 'new' && p === 1 ? base : `${base}/${sort}/${p}`);
  const flags = [job.filters.excludeReplies && 'no replies', job.filters.excludeRetweets && 'no retweets', job.filters.minFaves > 0 && `at least ${n(job.filters.minFaves)} likes`, job.filters.lang && `language ${job.filters.lang}`].filter(Boolean).join(', ');
  const partial = job.status === 'done' ? '' : `<p class="note">The collection ${job.status === 'capped' ? `reached its limit of about ${n(job.maxTweets)} tweets` : 'was stopped'} before it covered the whole period. It reads newest first, so the oldest days may be thin or missing.</p>`;
  const kpi = [['Tweets', s.tweets], ['Accounts', s.authors], ['Likes', s.likes], ['Retweets', s.retweets], ['Replies', s.replies], ...(s.views ? [['Views', s.views]] : []), ['Likes per tweet', s.tweets ? Math.round((10 * s.likes) / s.tweets) / 10 : 0]] as Array<[string, number]>;
  const stepLabel = (i: number) => { const t = s.startTs + i * s.stepSec; return s.stepSec < 86_400 ? `${new Date(t * 1000).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} UTC` : s.stepSec === 86_400 ? day(t) : `from ${day(t)}`; };
  const maxStep = Math.max(1, ...s.perStep), maxHeat = Math.max(1, ...s.heat.flat());
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const chart = s.perStep.length > 1 ? `<section class="panel wide"><h3>Tweets over time <small>per ${s.stepSec < 86_400 ? 'hour' : s.stepSec === 86_400 ? 'day' : s.stepSec === 7 * 86_400 ? 'week' : '30 days'}</small></h3>
<div class="act" role="img" aria-label="Tweets over time">${s.perStep.map((c, i) => `<i style="height:${c ? Math.max(2, (100 * c) / maxStep) : 0}%" title="${esc(stepLabel(i))}: ${n(c)} tweets"></i>`).join('')}</div>
<div class="axis"><span>${day(s.startTs)}</span><span>${day(Math.min(job.toTs - 1, s.startTs + s.perStep.length * s.stepSec - 1))}</span></div></section>` : '';
  const heat = `<section class="panel wide"><h3>When they post <small>weekday and hour, UTC</small></h3><div class="heat"><span></span>${Array.from({ length: 24 }, (_, h) => `<span class="h">${h % 3 ? '' : h}</span>`).join('')}
${s.heat.map((row, d) => `<span class="d">${WD[d]}</span>${row.map((c, h) => `<i title="${WD[d]} ${h}:00, ${n(c)} tweets" style="opacity:${(0.06 + (0.94 * c) / maxHeat).toFixed(2)}"></i>`).join('')}`).join('')}</div></section>`;
  const nav = (sort: 'new' | 'top') => `<a href="${href(sort, 1)}"${tw.sort === sort ? ' aria-current="page"' : ''}>${sort === 'new' ? 'Newest' : 'Most liked'}</a>`;
  const pager = tw.pages > 1 ? `<nav class="pager" aria-label="Pages">${tw.page > 1 ? `<a href="${href(tw.sort, tw.page - 1)}" rel="prev">&larr; Previous</a>` : '<span></span>'}<span>Page ${n(tw.page)} of ${n(tw.pages)}</span>${tw.page < tw.pages ? `<a href="${href(tw.sort, tw.page + 1)}" rel="next">Next &rarr;</a>` : '<span></span>'}</nav>` : '';
  const body = `<header class="pagehead"><div class="eyebrow">Report &middot; ${rangeText(job.fromTs, job.toTs)}</div><h1>${esc(report.title)}</h1>${report.description ? `<p class="lede">${esc(report.description)}</p>` : ''}</header>
${vizLink(`/history/${esc(report.slug)}/galaxy`, 'See it as a Tweet Galaxy', "Every tweet as a point of light, in an animated picture.")}
<p class="meta">Collected from X with <code>${esc(job.query)}</code>${flags ? ` (${esc(flags)})` : ''}. Published ${date(report.publishedAt)}.</p>${partial}
<div class="kpis">${kpi.map(([l, v]) => `<div><b>${n(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
<div class="panels">${chart}${heat}
${rank('Most active accounts', s.topAuthors.map((a) => ({ label: '@' + a.handle, count: a.tweets, note: `${n(a.likes)} likes`, html: handleLink(a.handle) })))}
${rank('Hashtags', s.hashtags)}${rank('Languages', s.langs)}${rank('Most used words', s.words)}${rank('Linked sites', s.domains)}</div>
${analysisHtml(r)}
<h2 class="sect" id="tweets">The tweets</h2>
<nav class="views" aria-label="Order">${nav('new')}${nav('top')}</nav>
${pager}<div class="tws">${tw.tweets.map(tweetHtml).join('')}</div>${pager}
<p class="note">Public posts collected from X, shown as they were when collected. Counts are from the time of collection. The statistics are computed from the collected tweets only, in UTC.</p>`;
  return shell(`${report.title} · Reports`, bar(ctx, undefined, 'history'), body,
    { description: report.description || `${n(s.tweets)} tweets, ${rangeText(job.fromTs, job.toTs)}`, canonical: `${origin}${href(tw.sort, tw.page)}` });
}

// ---- where the briefing comes from (never cost: that is for the admin only)
const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const handleLink = (h: string) => (/^[A-Za-z0-9_]{1,15}$/.test(h) ? `<a href="https://x.com/${esc(h)}" rel="noopener noreferrer nofollow" target="_blank">@${esc(h)}</a>` : esc('@' + h));
const listLink = (id: string | undefined, label: string) => (id && /^\d{1,25}$/.test(id) ? `<a href="https://x.com/i/lists/${esc(id)}" rel="noopener noreferrer nofollow" target="_blank">${esc(label)}</a>` : esc(label));
const n = (v: number) => v.toLocaleString('en-GB');
const modelName = (id: string) => (id === 'mock' ? '' : aiModelInfo(id)?.label ?? openrouterModelInfo(id)?.label ?? id.replace(/^.*\//, ''));

// How a list was read, in words a reader understands. Never anything about money.
const howRead = (s: { mode?: string; minFaves?: number }) =>
  s.mode === 'best' ? `top posts by reaction${s.minFaves ? `, at least ${s.minFaves} likes` : ''}, without retweets or replies` : s.mode === 'latest' ? 'newest posts first' : '';

// What to call what an issue was written from: posts (X), items (feeds), or both.
const unit = (i: IssueFull) => { const f = (i.provenance?.feeds ?? []).reduce((t, x) => t + x.count, 0); return !f ? 'posts' : f >= i.tweets ? 'items' : 'posts and items'; };

export function sourcesHtml(i: IssueFull): string {
  const p = i.provenance;
  if (!p) return '';
  const feeds = p.feeds ?? [], feedItems = feeds.reduce((t, f) => t + f.count, 0), xPosts = Math.max(0, p.used - feedItems);
  const rows = p.sources.filter((s) => !(feeds.length && s.kind === 'feed')).map((s) => {   // the feeds get their own list below
    const cnt = `<span class="c">${n(s.count)} posts</span>`;
    if (s.kind === 'xgroup') return `<li><b>${esc(s.label)}</b> <span class="k">group of ${s.lists?.length ?? 0} X lists, read together${howRead(s) ? ': ' + howRead(s) : ''}</span> ${cnt}<ul>${(s.lists ?? []).map((l) => `<li>${listLink(l.id, l.label)} <span class="c">${n(l.count)}</span></li>`).join('')}</ul></li>`;
    if (s.kind === 'xlist') return `<li>${listLink(s.id, s.label)} <span class="k">X list${howRead(s) ? ': ' + howRead(s) : ''}</span> ${cnt}</li>`;
    if (s.kind === 'flist') return `<li><b>${esc(s.label)}</b> <span class="k">feed list</span> ${cnt.replace(' posts', ' items')}</li>`;
    if (s.kind === 'search') return `<li><code>${esc(s.label)}</code> <span class="k">search on X</span> ${cnt}</li>`;
    if (s.kind === 'list') return `<li><b>${esc(s.label)}</b> <span class="k">curated list${s.accounts ? ` of ${n(s.accounts)} accounts` : ''}</span> ${cnt}${s.handles?.length ? `<details><summary>The accounts</summary><p>${s.handles.map(handleLink).join(', ')}${(s.accounts ?? 0) > s.handles.length ? ', …' : ''}</p></details>` : ''}</li>`;
    return `<li>${esc(s.label)} ${cnt}</li>`;
  }).join('');
  const model = modelName(i.model);
  const webUrl = (raw?: string) => { try { const u = new URL(raw ?? ''); return u.protocol === 'https:' || u.protocol === 'http:' ? u : null; } catch { return null; } };
  const feedRows = feeds.map((f) => {
    // The name links to the site, or for YouTube to the channel or playlist page.
    const feed = webUrl(f.url), page = f.source === 'youtube' ? pageOfFeed(f.url ?? '') : feed && (f.source === 'rss' || f.source === 'arxiv') ? feed.origin : null;
    const name = page ? `<a href="${esc(page)}" rel="noopener noreferrer nofollow" target="_blank">${esc(f.label)}</a>` : `<b>${esc(f.label)}</b>`;
    // The address of the feed itself, in full, so a reader can subscribe to it or check what was read.
    const addr = feed ? ` <a class="k" href="${esc(feed.href)}" rel="noopener noreferrer nofollow" target="_blank"><code>${esc(feed.href)}</code></a>` : '';
    return `<li>${name} <span class="k">${f.source === 'hn' ? 'Hacker News' : f.source === 'youtube' ? 'YouTube' : f.source === 'arxiv' ? 'arXiv' : 'RSS feed'}</span>${f.source === 'arxiv' ? '' : addr} <span class="c">${n(f.count)} ${f.count === 1 ? 'item' : 'items'}</span></li>`;
  }).join('');
  const basis = !feeds.length ? `<b>${n(p.used)} posts</b> from <b>${n(p.accounts)} accounts</b>`
    : !xPosts ? `<b>${n(feedItems)} items</b> from <b>${n(feeds.length)} ${feeds.length === 1 ? 'feed' : 'feeds'}</b>`
    : `<b>${n(p.used)} posts and items</b>: ${n(xPosts)} posts from ${n(p.accounts)} accounts on X, and ${n(feedItems)} items from ${n(feeds.length)} ${feeds.length === 1 ? 'feed' : 'feeds'}`;
  return `<details class="src"><summary>Where this comes from <small>${basis.replace(/<\/?b>/g, '')}</small></summary>
<p>Based on ${basis}, ${feeds.length ? 'published' : 'posted'} between ${when(p.from)} and ${when(p.to)} UTC.${p.truncated ? ` Of ${n(p.fetched)} collected, the ${n(p.used)} that drew the most reaction were used.` : ''}</p>
${rows ? `<ul class="srcs">${rows}</ul>` : ''}
${feedRows ? `<p>The feeds it drew on:</p><ul class="srcs">${feedRows}</ul>` : ''}
${p.partial ? '<p>Collection stopped early, so some lists are only partly covered.</p>' : ''}
${p.topAccounts.length ? `<p>Most posts in the analysis: ${p.topAccounts.map((a) => `${handleLink(a.handle)} (${a.count})`).join(', ')}.</p>` : ''}
${model ? `<p>Written by ${esc(model)}.</p>` : ''}</details>`;
}

const plain = (tldr: string) => inline(tldr).replace(/<\/?a[^>]*>/g, '');
const stamp = (ms: number) => `<time datetime="${new Date(ms).toISOString()}">${date(ms)}</time>`;

// Words on a briefing's page, in the briefing's language (a Swedish briefing gets Swedish labels around it).
const LABELS = {
  en: { latest: 'Latest briefing', earlier: 'Previous days', inbrief: 'In brief', read: 'min read', based: 'based on', from: 'from the last', seeLatest: 'see the latest',
    isNew: 'new', cont: 'continuing', sources: 'Sources', older: 'Earlier', newer: 'Later', others: 'Other briefings today', signal: 'In Signal', updated: 'Updated', rss: 'RSS', themes: 'Themes', listAll: 'The lists behind the briefings', report: 'Report an error' },
  sv: { latest: 'Senaste', earlier: 'Tidigare dagar', inbrief: 'I korthet', read: 'min läsning', based: 'utifrån', from: 'från de senaste', seeLatest: 'se den senaste',
    isNew: 'ny', cont: 'fortsätter', sources: 'Källor', older: 'Tidigare', newer: 'Senare', others: 'Andra sammanfattningar i dag', signal: 'I Signal', updated: 'Uppdateras', rss: 'RSS', themes: 'Teman', listAll: 'Listorna bakom sammanfattningarna', report: 'Rapportera ett fel' },
};
type Lang = keyof typeof LABELS;

// The topic page frame: the rail opens this topic's views; on narrow screens the views also show above the content.
function topicPage(topic: TopicInfo, view: 'latest' | 'archive' | 'issue', earlier: number, content: string, head: { title: string; description?: string; canonical?: string; image?: string; lang?: Lang }, ctx: Ctx): string {
  const cur = (v: string) => (v === view ? ' aria-current="page"' : ''), L = LABELS[head.lang ?? 'en'];
  return shell(head.title, bar(ctx, { slug: topic.slug, title: topic.title, view, earlier }), `<header class="pagehead"><div class="eyebrow">${L.updated} ${every(topic.intervalHours)}</div><h1>${esc(topic.title)}</h1>${topic.description ? `<p class="lede">${esc(topic.description)}</p>` : ''}</header>
<nav class="views" aria-label="Views"><a href="/${esc(topic.slug)}"${cur('latest')}>${L.latest}</a><a href="/${esc(topic.slug)}/archive"${cur('archive')}>${L.earlier}${earlier ? ` (${earlier})` : ''}</a><a class="rss" href="/${esc(topic.slug)}/feed.xml" title="Follow with a feed reader">${L.rss}</a></nav>
${content}`, { ...head, feed: `/${topic.slug}/feed.xml`, feedTitle: topic.title });
}

// The audio version, at the top of a post. The file is served by /audio/<topic>/<day>.mp3 (a published post only).
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
// The picture at the top of a post, made by an image model from the briefing. The file is served by /image/<topic>/<day>.jpg (a published post only).
export const imageHtml = (slug: string, i: IssueFull): string => i.image
  ? `<figure class="hero"><img src="/image/${esc(slug)}/${esc(i.id)}.jpg?v=${i.image.v}" alt="Illustration for this briefing" loading="lazy" decoding="async" style="aspect-ratio:${esc(i.image.aspect.replace(':', '/'))}"><figcaption>AI-generated illustration</figcaption></figure>` : '';
export const listenHtml = (slug: string, i: IssueFull): string => i.audio
  ? `<div class="listen"><span class="lbl">Listen</span><audio controls preload="none" src="/audio/${esc(slug)}/${esc(i.id)}.mp3?v=${i.audio.v}"></audio><span class="dur">${clock(i.audio.seconds)}</span></div>` : '';

const span = (h: number) => (h >= 48 ? Math.round(h / 24) + ' days' : h + ' hours');

/** Topics a piece of text mentions, from a Signal strip (whole words, any of a topic's names). */
const mentioned = (strip: SigStrip | undefined, text: string) => {
  const low = text.toLowerCase();
  return (strip?.topics ?? []).filter((t) => [t.label, t.term].some((x) => x.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(low)));
};
const sigChip = (strip: SigStrip, t: SigStrip['topics'][number]) => `<a class="chip sig" href="${topicUrl(t.term, strip.area)}">${esc(t.label)}</a>`;

/**
 * A briefing as a page: the TL;DR, "In brief" (its themes, linked), then each theme under its heading with whether it is new or carries on from the
 * day before, the Signal topics it touches and the accounts it cites; then where it comes from, the days around it and the other briefings of the day.
 */
export function issueHtml(p: PubPage, origin: string, ctx: Ctx, strip?: SigStrip): string {
  const { topic, issue, archive } = p;
  const idx = archive.findIndex((a) => a.id === issue.id), isLatest = idx === 0, older = idx >= 0 ? archive[idx + 1] : undefined, newer = idx > 0 ? archive[idx - 1] : undefined;
  const lang = langOf(issue.markdown), L = LABELS[lang];
  const secs = sectionsOf(issue.markdown), themes = secs.filter((x) => !isMeta(x.title));
  const marks = continuity(themes.map((x) => x.title), older?.themes);
  const mark = new Map(themes.map((x, i) => [x.anchor, marks[i]] as const));
  // The article, with an id on every heading (in the order sectionsOf found them) and, under each theme, what it touches and cites.
  let k = 0;
  let body = markdown(normalizeThemes(issue.markdown), issue.links).replace(/<h([234])>/g, (m, n) => (secs[k] ? `<h${n} id="${esc(secs[k++].anchor)}">` : m));
  const used = new Set<string>();
  body = body.replace(/(<h[234] id="([^"]+)">[\s\S]*?<\/h[234]>)([\s\S]*?)(?=<h[234] id=|$)/g, (all, head: string, anchor: string, rest: string) => {
    const sec = secs.find((x) => x.anchor === anchor);
    if (!sec || isMeta(sec.title)) return all;
    const m = mark.get(anchor), topics = strip ? mentioned(strip, `${sec.title}\n${sec.body}`) : [];
    topics.forEach((t) => used.add(t.term));
    const handles = [...new Set([...sec.body.matchAll(/\[@?([A-Za-z0-9_]{1,15})\]\(https:\/\/(?:x|twitter)\.com\//g)].map((x) => '@' + x[1]))];
    const tags = (m ? `<span class="chip ${m === 'new' ? 'up' : ''}">${m === 'new' ? L.isNew : L.cont}</span>` : '') + (strip ? topics.map((t) => sigChip(strip, t)).join('') : '');
    const report = `<a class="rep" href="/report/${esc(topic.slug)}/${esc(issue.id)}?theme=${encodeURIComponent(sec.title)}" rel="nofollow">${L.report}</a>`;
    return `${head}${tags ? `<div class="thm">${tags}</div>` : ''}${rest}<p class="cites">${handles.length ? `${L.sources}: ${handles.map(esc).join(' &middot; ')} &middot; ` : ''}${report}</p>`;
  });
  // "In brief" goes right after the TL;DR (the first paragraph), when the briefing has themes.
  const brief = themes.length ? `<nav class="inbrief" aria-label="${L.inbrief}"><h2>${L.inbrief}</h2><ol>${themes.map((x) => `<li><a href="#${esc(x.anchor)}">${esc(x.title)}</a>${mark.get(x.anchor) === 'new' ? ` <small class="up">${L.isNew}</small>` : ''}</li>`).join('')}</ol></nav>` : '';
  const at = body.indexOf('</p>');
  if (brief) body = at >= 0 ? body.slice(0, at + 4) + brief + body.slice(at + 4) : brief + body;
  const rest = strip ? strip.topics.filter((t) => !used.has(t.term)) : [];
  const day = (b: Brief | undefined, label: string, cls: string) => (b ? `<a class="${cls}" href="/${esc(topic.slug)}/${esc(b.id)}"><small>${label}</small>${date(b.publishedAt)}</a>` : '<span></span>');
  const others = ctx.topics.filter((t) => t.slug !== topic.slug && Date.now() - t.latest.publishedAt < 36 * 3600_000).sort((a, b) => b.latest.publishedAt - a.latest.publishedAt);
  return topicPage(topic, isLatest ? 'latest' : 'issue', Math.max(0, archive.length - 1), `<p class="meta">${stamp(issue.publishedAt)} · ${readingMinutes(issue.markdown)} ${L.read} · ${L.based} ${issue.tweets} ${unit(issue)} ${L.from} ${span(issue.windowHours)}${isLatest ? '' : ` · <a href="/${esc(topic.slug)}">${L.seeLatest}</a>`}</p>
${listenHtml(topic.slug, issue)}${imageHtml(topic.slug, issue)}<article lang="${lang}">${body}</article>${strip && rest.length ? `<p class="thm">${L.signal}: ${rest.map((t) => sigChip(strip, t)).join('')}</p>` : ''}${sourcesHtml(issue)}
<nav class="daynav" aria-label="Days">${day(older, L.older, 'prev')}${day(newer, L.newer, 'next')}</nav>
${others.length ? `<h2 class="sect">${L.others}</h2><ul class="others">${others.map((t) => `<li><a href="/${esc(t.slug)}">${esc(t.title)}</a>${t.latest.tldr ? `<span>${inline(t.latest.tldr)}</span>` : ''}</li>`).join('')}</ul>` : ''}
${NOTE}<p class="note"><a href="/report/${esc(topic.slug)}/${esc(issue.id)}" rel="nofollow">${L.report}</a>${listTotal(ctx) ? ` &middot; <a href="/lists">${L.listAll} &rarr;</a>` : ''}</p>`,
    { title: `${topic.title} · ${date(issue.publishedAt)}`, description: issue.tldr.replace(/\*\*/g, '') || topic.description, canonical: `${origin}/${topic.slug}/${issue.id}`, lang, ...(issue.image ? { image: `${origin}/image/${topic.slug}/${issue.id}.jpg?v=${issue.image.v}` } : {}) }, ctx);
}

export function archiveHtml(p: { topic: TopicInfo; latest: Brief; issues: IssueFull[] }, origin: string, ctx: Ctx): string {
  const { topic, issues } = p, lang = langOf(issues.map((i) => i.markdown).join('\n').slice(0, 6000)), L = LABELS[lang];
  // One line per day: its TL;DR and its themes, each linking into that day's page. The full text is on the day's own page.
  const days = issues.map((i) => {
    const th = sectionsOf(i.markdown).filter((x) => !isMeta(x.title));
    return `<li><a class="d" href="/${esc(topic.slug)}/${esc(i.id)}">${stamp(i.publishedAt)}</a><div>${i.tldr ? `<p>${inline(i.tldr)}</p>` : ''}${th.length ? `<p class="th">${th.map((x) => `<a href="/${esc(topic.slug)}/${esc(i.id)}#${esc(x.anchor)}">${esc(x.title)}</a>`).join(' &middot; ')}</p>` : ''}${i.audio ? `<small class="aud">&#9835; ${clock(i.audio.seconds)}</small>` : ''}</div></li>`;
  }).join('');
  return topicPage(topic, 'archive', issues.length, `<h2 style="margin:0 0 14px;font-size:20px">${L.earlier}</h2>
${days ? `<ul class="daylist">${days}</ul>` : '<p class="lede">No earlier briefings yet.</p>'}${issues.length >= 30 ? '<p class="meta" style="margin-top:14px">Showing the last 30 days.</p>' : ''}${NOTE}`,
    { title: `${topic.title} · ${L.earlier.toLowerCase()}`, description: topic.description, canonical: `${origin}/${topic.slug}/archive`, lang }, ctx);
}

/** The form for reporting an error in a briefing, or in one theme of it. Plain HTML: a message, nothing about the reader. */
export function errorReportHtml(topic: TopicInfo, issueId: string, theme: string, ctx: Ctx, sent?: 'ok' | 'error'): string {
  const back = `/${esc(topic.slug)}/${esc(issueId)}${theme ? '#' + esc(anchorOfTheme(theme)) : ''}`;
  return shell(`Report an error · ${topic.title} · Undercurrent`, bar(ctx, { slug: topic.slug, title: topic.title, view: 'issue', earlier: 0 }), `<header class="pagehead"><div class="eyebrow"><a href="${back}">&larr; ${esc(topic.title)}, ${esc(issueId)}</a></div><h1>Report an error</h1>
<p class="lede">${theme ? `In “${esc(theme)}”. ` : ''}Tell us what is wrong: a fact, a source, a missing side of the story. Reports are read by a person; the briefing is changed when they are right.</p></header>
${sent === 'ok' ? `<p class="lede">Thank you, it has been sent. <a href="${back}">Back to the briefing</a>.</p>` : `${sent === 'error' ? '<p class="meta">That could not be sent. Too many reports from you today, or the message was empty.</p>' : ''}
<form class="report" method="post" action="/report"><input type="hidden" name="slug" value="${esc(topic.slug)}"><input type="hidden" name="id" value="${esc(issueId)}"><input type="hidden" name="theme" value="${esc(theme)}">
<label>What is wrong <textarea name="message" required minlength="5" maxlength="1000" rows="6"></textarea></label>
<label class="hp" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>
<button type="submit">Send</button><p class="meta">Do not include personal details. Nothing about you is stored except a one-day count to stop floods.</p></form>`}`, { description: 'Report an error in a briefing.' });
}

const ago = (ts: number) => { const m = Math.round((Date.now() - ts) / 60_000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : date(ts); };
const thumb = (i: ViewItem) => (i.video ? `<img src="https://i.ytimg.com/vi/${esc(i.video)}/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">` : '');
const itemLink = (i: ViewItem, inner: string) => (/^https:\/\//.test(i.url) ? `<a href="${esc(i.url)}" rel="noopener noreferrer nofollow" target="_blank">${inner}</a>` : inner);
const itemMeta = (i: ViewItem) => `<small>${esc(i.source)}${i.by && i.by !== i.source ? ' &middot; ' + esc(i.by) : ''} &middot; ${ago(i.ts)}${i.reactions ? ` &middot; &#9650; ${kfmt(i.reactions)}` : ''}</small>`;
const player = (i: ViewItem) => `<div class="vplayer"><iframe src="https://www.youtube-nocookie.com/embed/${esc(i.video!)}" title="${esc(i.title)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;

/** A feed page: items from what is watched, as the admin defined it (newest or most reacted, one per source or all), as a player, cards or a list. */
export function feedPageHtml(d: PubViewPage, ctx: Ctx): string {
  const first = d.layout === 'player' ? d.items.find((i) => i.video) : undefined, rest = first ? d.items.filter((i) => i !== first) : d.items;
  const how = `${d.show === 'top' ? 'Most reacted' : 'Newest'}${d.perSource ? ', one from each source' : ''}, from the last ${d.days === 1 ? 'day' : d.days + ' days'}`;
  const body = !d.items.length ? '<p class="meta">Nothing in this period yet.</p>'
    : (first ? `<section class="vlead">${player(first)}<h2>${itemLink(first, esc(first.title))}</h2>${itemMeta(first)} ${itemLink(first, '<small class="out">Watch on YouTube &#8599;</small>')}</section>` : '')
    + (d.layout === 'list' ? `<ul class="vlist">${rest.map((i) => `<li>${itemLink(i, esc(i.title))}${itemMeta(i)}</li>`).join('')}</ul>`
      : `<ul class="vcards">${rest.map((i) => `<li>${itemLink(i, `${thumb(i)}<b>${esc(i.title)}</b>`)}${itemMeta(i)}</li>`).join('')}</ul>`);
  return shell(`${d.title} · Undercurrent`, bar(ctx, undefined, 'feeds', d.slug), `<header class="pagehead"><div class="eyebrow">${how}</div><h1>${esc(d.title)}</h1>${d.description ? `<p class="lede">${esc(d.description)}</p>` : ''}</header>
${body}<p class="note">Titles, pictures and videos belong to their publishers; each links to the original. Videos play from YouTube's privacy-enhanced player.</p>`,
    { description: d.description || `${d.title}: ${how.toLowerCase()}.` });
}

/**
 * The topics Signal found by itself, to browse: what is new and rising first, then every topic A to Z with how many items mention it.
 * A search (?q=) narrows the list; plain HTML, no script. Each topic links to its page in Signal.
 */
export function topicsHtml(all: PubTerms[], ctx: Ctx, q: string, lenses: Lens[] = [], lens?: Lens): string {
  const query = q.trim().toLowerCase().slice(0, 60);
  const link = (b: PubTerms, t: PubTerms['terms'][number], extra = '') => `<a href="${topicUrl(t.term, ctx.area)}">${esc(t.term)}</a>${extra}`;
  const sections = all.map((b) => {
    const hits = query ? b.terms.filter((t) => t.term.includes(query)) : b.terms;
    const fresh = hits.filter((t) => t.isNew), rising = hits.filter((t) => !t.isNew && (t.change ?? 0) >= 1.5 && !t.evergreen).sort((a, c) => (c.change ?? 0) - (a.change ?? 0));
    const az = [...hits].sort((a, c) => a.term.localeCompare(c.term));
    const byLetter = new Map<string, typeof az>();
    for (const t of az) { const l = /^[a-z]/.test(t.term[0]) ? t.term[0].toUpperCase() : /^\p{L}/u.test(t.term[0]) ? t.term[0].toUpperCase() : '#'; (byLetter.get(l) ?? byLetter.set(l, []).get(l)!).push(t); }
    // With a lens: its topics first and marked, the others after and dimmed; a topic that is not in it but big today is pointed out.
    const mark = lens ? applyLens(hits, lens) : null, inLens = new Set(mark?.ordered.filter((x) => x.inLens).map((x) => x.topic.term));
    const cls = (t: PubTerms['terms'][number]) => (lens ? (inLens.has(t.term) ? ` class="lensin lc-${lens.color}"` : ' class="lensout"') : '');
    const tag = (t: PubTerms['terms'][number]) => (lens && inLens.has(t.term) ? ' ' + lensTag(lens) : '');
    const chip = (t: PubTerms['terms'][number]) => `<li${cls(t)}>${link(b, t)}<small>${t.docs}</small>${tag(t)}</li>`;
    const lensFirst = (ts: typeof hits) => (lens ? applyLens(ts, lens).ordered.map((x) => x.topic) : ts);
    const inYours = mark ? mark.ordered.filter((x) => x.inLens).map((x) => x.topic).slice(0, 40) : [];
    const yours = lens ? `<h2 class="sect">In your lens: ${esc(lens.name)} <small class="dim">${inYours.length}</small></h2>${inYours.length ? `<ul class="azl">${inYours.map(chip).join('')}</ul>` : '<p class="meta">No topic of the last two weeks is in this lens.</p>'}${outsideLine(mark!.outside, ctx.area)}` : '';
    return `${all.length > 1 ? `<h2 class="sect">${esc(b.title)}</h2>` : ''}${query ? '' : yours}
${!query && (fresh.length || rising.length) ? `<div class="panels">${fresh.length ? `<section class="panel"><h3>New</h3><p class="meta" style="margin:-4px 0 8px">Not there the two weeks before</p><ul class="sglist">${lensFirst(fresh).slice(0, 15).map((t) => `<li${cls(t)}><span>${link(b, t)}${tag(t)}</span><small>${t.docs} items</small></li>`).join('')}</ul></section>` : ''}
${rising.length ? `<section class="panel"><h3>Rising</h3><p class="meta" style="margin:-4px 0 8px">More than the two weeks before</p><ul class="sglist">${lensFirst(rising).slice(0, 15).map((t) => `<li${cls(t)}><span>${link(b, t)}${tag(t)}</span><small>&times;${(t.change ?? 0).toFixed(1)}</small></li>`).join('')}</ul></section>` : ''}</div>` : ''}
<h2 class="sect">${query ? `Topics with “${esc(query)}”` : 'All topics, A to Z'} <small class="dim">${hits.length}</small></h2>
${hits.length ? `<nav class="az" aria-label="Letters">${[...byLetter.keys()].map((l) => `<a href="#l-${esc(b.slug)}-${esc(l)}">${esc(l)}</a>`).join('')}</nav>${[...byLetter].map(([l, ts]) => `<h3 class="azh" id="l-${esc(b.slug)}-${esc(l)}">${esc(l)}</h3><ul class="azl">${ts.map(chip).join('')}</ul>`).join('')}` : '<p class="meta">No topic matches.</p>'}`;
  }).join('');
  return shell('Topics · Undercurrent', bar(ctx, undefined, 'topics', undefined, { lens, href: (p) => '/topics' + [query ? 'q=' + encodeURIComponent(query) : '', p.lens ? 'lens=' + encodeURIComponent(p.lens) : '', ctx.area === 'politics' ? 'area=politics' : ''].filter(Boolean).map((x, i) => (i ? '&amp;' : '?') + x).join('') }), `<header class="pagehead"><div class="eyebrow">The last two weeks</div><h1>Topics</h1>
<p class="lede">What Signal found people talking about, by itself: every topic named in the posts and articles followed. Each opens its own page, with how it moved and where it shows up. <a href="/signal/method">How topics are found</a>.</p></header>
<form class="tsearch" method="get" action="/search"><input type="search" name="q" value="${esc(query)}" placeholder="Search topics, items, papers" aria-label="Search topics, items, papers and briefings" maxlength="80"><input type="hidden" name="kinds" value="topics"><button type="submit">Search</button>${lens ? `<input type="hidden" name="lens" value="${esc(lens.key)}">` : ''}${ctx.area === 'politics' ? '<input type="hidden" name="area" value="politics">' : ''}${query ? ` <a href="/topics${[lens ? 'lens=' + esc(lens.key) : '', ctx.area === 'politics' ? 'area=politics' : ''].filter(Boolean).map((x, i) => (i ? '&amp;' : '?') + x).join('')}">All topics</a>` : ''}</form>
${sections || '<p class="meta">No published Signal yet.</p>'}`, { description: 'Every topic Signal found in the last two weeks: new, rising, and A to Z.' });
}

const ITEM_KIND: Record<string, string> = { x: 'X', hn: 'Hacker News', youtube: 'YouTube', rss: 'Blog or news' };
const WINDOW_WORDS: Record<number, string> = { 1: 'day', 3: '3 days', 7: 'week', 14: '2 weeks', 30: 'month' };
/**
 * /search?q=&kinds=&lens=&window=&page=: topics, items, papers and briefings, grouped by kind with topics first (src/site/search.ts, src/site/searchData.ts).
 * Plain links and a form, no script. With several kinds each group shows a few and links to the rest; with one kind it pages.
 */
export function searchHtml(ctx: Ctx, a: SearchAnswer, lenses: Lens[] = [], lens?: Lens): string {
  const area = ctx.area, q = a.q, here = (p: { kinds?: SearchKind[]; window?: number; page?: number; lens?: string | null }) => searchHref({ q, kinds: p.kinds ?? a.kinds, lens: p.lens === null ? undefined : p.lens ?? lens?.key, window: p.window ?? a.window, page: p.page, area });
  const all = a.kinds.length === SEARCH_KINDS.length, shown = SEARCH_KINDS.filter((k) => a.kinds.includes(k));
  const total = SEARCH_KINDS.reduce((t, k) => t + a[k].total, 0);
  const lensBy = new Map(lenses.map((l) => [l.key, l] as const));
  const kindNav = q && !tooShort(q) ? `<nav class="sgwin angles" aria-label="Kinds of result"><a href="${here({ kinds: [...SEARCH_KINDS] })}"${all ? ' aria-current="page"' : ''}>Everything <small>${n(total)}</small></a>${SEARCH_KINDS.map((k) => `<a href="${here({ kinds: [k] })}"${!all && a.kinds.length === 1 && a.kinds[0] === k ? ' aria-current="page"' : ''}>${SEARCH_TITLE[k]} <small>${n(a[k].total)}</small></a>`).join('')}</nav>` : '';
  const winNav = `<nav class="sgwin" aria-label="How far back">${SEARCH_WINDOWS.map((w) => `<a href="${here({ window: w })}"${a.window === w ? ' aria-current="page"' : ''}>${w === 1 ? 'Today' : w + ' days'}</a>`).join('')}</nav><p class="meta" style="margin:-4px 0 12px">Items, papers and briefings from the last ${WINDOW_WORDS[a.window] ?? a.window + ' days'}${a.window > 14 ? ' (items go back two weeks at most)' : ''}. Topics are the ones in the Signals now.</p>`;
  const hiddenLens = (lens ? `<input type="hidden" name="lens" value="${esc(lens.key)}">` : '') + (area === 'politics' ? '<input type="hidden" name="area" value="politics">' : '');
  const form = `<form class="tsearch" method="get" action="/search" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Search topics, items, papers and briefings" aria-label="Search" maxlength="80"${q ? '' : ' autofocus'}>${hiddenLens}${a.window !== 14 ? `<input type="hidden" name="window" value="${a.window}">` : ''}<button type="submit">Search</button></form>`;
  const more = (k: SearchKind) => (a.kinds.length > 1 && a[k].total > a[k].list.length ? `<p class="more"><a href="${here({ kinds: [k] })}">See all ${n(a[k].total)} ${SEARCH_TITLE[k].toLowerCase()} &rarr;</a></p>` : '');
  const pager = (k: SearchKind) => {
    const pages = Math.min(MAX_PAGE, Math.ceil(a[k].total / PAGE_SIZE));
    return a.kinds.length === 1 && pages > 1 ? `<nav class="pager" aria-label="Pages">${a.page > 1 ? `<a href="${here({ page: a.page - 1 })}" rel="prev">&larr; Earlier results</a>` : '<span></span>'}<span>Page ${n(a.page)} of ${n(pages)}</span>${a.page < pages ? `<a href="${here({ page: a.page + 1 })}" rel="next">More results &rarr;</a>` : '<span></span>'}</nav>` : '';
  };
  const topics = (): string => `<ul class="sgitems">${a.topics.list.map((t) => {
    const tags = t.lenses.map((key) => lensBy.get(key)).filter((l): l is Lens => !!l).slice(0, 2).map(lensTag).join(' ');
    const st = t.state ? `<span class="pstate ${t.state}">${STATE_MARK[t.state]} ${STATE_LABEL[t.state]}</span>` : '';
    const why = t.field === 'member' ? `Also counted as “${esc(t.because ?? '')}”` : t.field === 'summary' ? `In its summary: ${esc(t.because ?? '')}` : '';
    return `<li${lens ? (t.inLens ? ` class="lensin lc-${lens.color}"` : ' class="lensout"') : ''}><div class="by">${st}${st && tags ? ' ' : ''}${tags}</div><a href="${esc(topicHref(t.slug, area))}">${esc(t.label)}</a>${why ? `<p class="meta">${why}</p>` : ''}</li>`;
  }).join('')}</ul>`;
  const items = (): string => `<ul class="sgitems">${a.items.list.map((i) => {
    const react = reactionText(i);
    return `<li><div class="by"><b>${esc(ITEM_KIND[i.kind] ?? i.kind)}</b>${i.source && i.kind !== 'x' ? ' &middot; ' + esc(i.source) : ''}${i.by ? ' &middot; ' + esc(i.by) : ''} &middot; ${date(i.ts)}${react ? ` &middot; <span class="chip react">${esc(react)}</span>` : ''}</div>
${i.url ? ext(i.url, esc(i.title || i.url)) : esc(i.title)}${i.discussionUrl && i.discussionUrl !== i.url ? ` ${ext(i.discussionUrl, '<span class="dim">discussion</span>')}` : ''}${i.topic ? `<p class="meta">Topic: <a href="${esc(topicHref(i.topic.slug, area))}">${esc(i.topic.label)}</a></p>` : ''}</li>`;
  }).join('')}</ul><p class="note">Titles and links are those of the original publishers. Only items from the Signals and feed pages shown on this site are searched.</p>`;
  const papers = (): string => `<ol class="papers">${a.papers.list.map((p) => {
    const at = p.attention, up = [at.accounts ? `named in posts by ${n(at.accounts)} ${at.accounts === 1 ? 'account' : 'accounts'}` : '', at.hn ? `${n(at.hn.points)} points on Hacker News` : '', at.hf ? `${n(at.hf.upvotes)} upvotes on Hugging Face` : ''].filter(Boolean);
    return `<li><h3>${ext(p.absUrl, esc(p.title))}</h3><p class="pby">${esc(p.authors.slice(0, 3).join(', '))}${p.authors.length > 3 ? ' et al.' : ''} · ${esc(new Date(p.published).toISOString().slice(0, 10))} · ${esc(p.categories.join(' '))}</p>
<p class="psig">${up.length ? esc(up.join('; ')) : 'Not discussed yet'}</p><p>${esc(p.snippet)}</p></li>`;
  }).join('')}</ol><p class="meta">Papers and abstracts from <a href="https://arxiv.org/" rel="noopener noreferrer">arXiv</a>, where each paper is hosted. This site is not affiliated with or endorsed by arXiv.</p>`;
  const briefings = (): string => `<ul class="sgitems">${a.briefings.list.map((b) => `<li><div class="by">${esc(b.title)} &middot; ${date(b.publishedAt)}</div><a href="/${esc(b.slug)}/${esc(b.id)}${b.anchor ? '#' + esc(b.anchor) : ''}">${esc(b.theme || b.title)}</a>${b.headline ? `<p class="meta">${esc(b.headline)}</p>` : ''}</li>`).join('')}</ul>`;
  const draw: Record<SearchKind, () => string> = { topics, items, papers, briefings };
  let body: string;
  if (!q) body = '<p class="meta">Type a word or a few: a topic, a product, a paper title. The search covers topics, items (posts, articles, videos and threads), papers and briefings, and puts topics first. <a href="/topics${areaQs(area)}">All topics, A to Z</a>.</p>';
  else if (tooShort(q)) body = '<p class="meta">Please type at least two letters.</p>';
  else if (!shown.some((k) => a[k].total)) body = `<p class="meta">Nothing found for “${esc(q)}” in ${all ? 'topics, items, papers or briefings' : shown.map((k) => SEARCH_TITLE[k].toLowerCase()).join(' or ')} from the last ${WINDOW_WORDS[a.window] ?? a.window + ' days'}. Try fewer or shorter words${a.window < 30 ? ', or look further back' : ''}${!all ? `, or <a href="${here({ kinds: [...SEARCH_KINDS] })}">search everything</a>` : ''}.</p>`;
  else body = shown.filter((k) => a[k].total).map((k) => `<h2 class="sect">${SEARCH_TITLE[k]} <small class="dim">${n(a[k].total)}</small></h2>${draw[k]()}${more(k)}${pager(k)}`).join('');
  const top = topBar(ctx, { lenses, lens, q, here: {}, href: (p) => searchHref({ q, kinds: a.kinds, lens: p.lens, window: a.window, area }) });
  return shell(`${q ? q + ' · ' : ''}${area === 'politics' ? 'Politics · ' : ''}Search · Undercurrent`, top, `<header class="pagehead"><div class="eyebrow">${area === 'politics' ? 'Politics &middot; ' : ''}Search</div><h1>${q ? `“${esc(q)}”` : 'Search'}</h1></header>
${form}${kindNav}${winNav}${body}`, { wide: true, description: 'Search topics, items, papers and briefings.' });
}

/** A topic's newest briefings as an RSS 2.0 feed, each in full. */
export function feedXml(d: { topic: TopicInfo; issues: IssueFull[] }, origin: string): string {
  const x = (v: string) => esc(v), cdata = (v: string) => `<![CDATA[${v.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`, url = `${origin}/${d.topic.slug}`;
  const items = d.issues.map((i) => `<item><title>${x(`${date(i.publishedAt)}: ${i.tldr.replace(/\*\*/g, '') || d.topic.title}`)}</title><link>${x(`${url}/${i.id}`)}</link><guid isPermaLink="true">${x(`${url}/${i.id}`)}</guid><pubDate>${new Date(i.publishedAt).toUTCString()}</pubDate><description>${cdata(markdown(normalizeThemes(i.markdown), i.links))}</description></item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${x(d.topic.title)} · Undercurrent</title><link>${x(url)}</link><description>${x(d.topic.description || d.topic.title)}</description><language>${d.issues[0] ? langOf(d.issues[0].markdown) : 'en'}</language><atom:link href="${x(url)}/feed.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
}

// The lists behind the briefings: X lists (grouped, each opening on x.com), curated sets of X accounts, and curated sets of feeds.
// Only lists the admin marked public arrive here.
const HN_TAGS: Record<string, string> = { front_page: 'front page', story: 'new stories', show_hn: 'Show HN', ask_hn: 'Ask HN' };
function feedLine(f: PubFList['feeds'][number]): string {
  if (f.source === 'hn') return `<li><b>Hacker News</b> <span class="k">${esc(HN_TAGS[f.hnTag ?? ''] ?? 'stories')}${f.query ? `, matching <code>${esc(f.query)}</code>` : ''}${f.minPoints ? `, ${n(f.minPoints)}+ points` : ''}</span></li>`;
  if (f.source === 'arxiv') return `<li><b>arXiv</b> <span class="k">papers matching <code>${esc(f.query)}</code></span></li>`;
  const u = (() => { try { const x = new URL(f.query); return x.protocol === 'https:' || x.protocol === 'http:' ? x : null; } catch { return null; } })();
  const page = f.source === 'youtube' ? pageOfFeed(f.query) : u ? u.origin : null;
  return `<li>${page ? `<a href="${esc(page)}" rel="noopener noreferrer nofollow" target="_blank">${esc(f.label)}</a>` : `<b>${esc(f.label)}</b>`} <span class="k">${f.source === 'youtube' ? 'YouTube' : 'RSS feed'}</span></li>`;
}
export function listsHtml(ctx: Ctx): string {
  const groups = new Map<string, PubXList[]>();
  for (const l of ctx.lists) for (const g of l.groups.length ? l.groups : ['Other']) (groups.get(g) ?? groups.set(g, []).get(g)!).push(l);
  const entries = [...groups];
  const xSections = entries.map(([g, ls], i) => {
    // A sentence shared by three or more lists in a group (e.g. AI Community #1-#8) is said once, under the group's name.
    const counts = new Map<string, number>(); for (const l of ls) if (l.description) counts.set(l.description, (counts.get(l.description) ?? 0) + 1);
    const shared = [...counts].find(([, c]) => c >= 3)?.[0];
    return `<section class="lgroup" id="g${i}"><h3>${esc(g)} <small>${ls.length}</small></h3>${shared ? `<p class="gnote">${esc(shared)}</p>` : ''}<ul class="lists">${ls.map((l) =>
      `<li>${listLink(l.id, l.name).replace('<a ', '<a class="lname" ').replace(/<\/a>$/, ' <span aria-hidden="true">&#8599;</span></a>')}${l.description && l.description !== shared ? `<p>${esc(l.description)}</p>` : ''}</li>`).join('')}</ul></section>`;
  }).join('');
  const kinds: { id: string; title: string; count: number; intro: string; body: string }[] = [];
  if (ctx.lists.length) kinds.push({ id: 'x', title: 'X lists', count: ctx.lists.length, intro: 'Lists kept on X, grouped by theme. Each one opens on X.', body: xSections });
  if (ctx.alists.length) kinds.push({ id: 'accounts', title: 'Account lists', count: ctx.alists.length, intro: 'Hand-picked sets of X accounts, followed together.',
    body: `<ul class="lists">${ctx.alists.map((l) => `<li><b>${esc(l.name)}</b> <span class="k">${n(l.handles.length)} accounts</span>${l.topic ? `<p>${esc(l.topic)}</p>` : ''}<details><summary>The accounts</summary><p>${l.handles.map(handleLink).join(', ')}</p></details></li>`).join('')}</ul>` });
  if (ctx.flists.length) kinds.push({ id: 'feeds', title: 'Feed lists', count: ctx.flists.length, intro: 'Sets of news and blog feeds, YouTube channels and Hacker News searches.',
    body: `<ul class="lists">${ctx.flists.map((l) => `<li><b>${esc(l.name)}</b> <span class="k">${n(l.feeds.length)} ${l.feeds.length === 1 ? 'source' : 'sources'}</span>${l.topic ? `<p>${esc(l.topic)}</p>` : ''}<details><summary>The sources</summary><ul class="srcs">${l.feeds.map(feedLine).join('')}</ul></details></li>`).join('')}</ul>` });
  const sections = kinds.map((k) => `<section id="${k.id}"><h2 class="sect">${k.title} <small class="dim">${k.count}</small></h2><p class="gnote">${k.intro}</p>${k.body}</section>`).join('');
  return shell('Lists · Undercurrent', bar(ctx, undefined, 'lists'), `<header class="pagehead"><div class="eyebrow">${listTotal(ctx)} lists</div><h1>Lists</h1>
<p class="lede">The sets of accounts and sources that these briefings draw from.</p></header>
${kinds.length > 1 ? `<nav class="chips" aria-label="Kinds of list">${kinds.map((k) => `<a href="#${k.id}">${k.title}</a>`).join('')}</nav>` : ''}${sections}`,
  { description: 'The lists of accounts, feeds and channels that the briefings draw from.' });
}

interface PubGalaxy { title: string; tweets: number; shown: number; analysed: boolean }
function galaxyPageHtml(slug: string, g: PubGalaxy, ctx: Ctx): string {
  const s = esc(slug);
  return shell(`${g.title} · Tweet Galaxy`, bar(ctx, undefined, 'galaxy'), `<header class="pagehead"><div class="eyebrow"><a href="/history/${s}">${esc(g.title)}</a></div><h1>Tweet Galaxy</h1>
<p class="lede">Every tweet of this report is a point of light, brighter the more it was liked. ${g.analysed ? 'Move them between themes, kinds, a timeline and stance, ' : 'See them on a timeline, '}replay the collection day by day, and pick a star to read it.</p></header>
${vizSwitch('Report', ctx.reports.map((r) => ({ href: `/history/${esc(r.slug)}/galaxy`, title: r.title, on: r.slug === slug })))}
${vizFrame('galaxy', `/history/${s}/galaxy`, 'The tweets of this report as an animated picture')}
<p class="note">${g.shown < g.tweets ? `The ${n(g.shown)} most liked of ${n(g.tweets)} tweets. ` : ''}Public posts collected from X, as they were when collected. <a href="/history/${s}#tweets">The same tweets as a list</a>.</p>`,
  { description: `${n(g.tweets)} tweets as an animated picture.` });
}
function firstPageHtml(b: PubBoard, ctx: Ctx): string {
  const s = esc(b.slug);
  return shell(`Who said it first · ${b.title}`, bar(ctx, undefined, 'first', b.slug), `<header class="pagehead"><div class="eyebrow"><a href="/signal/${s}">${esc(b.title)}</a></div><h1>Who said it first</h1>
<p class="lede">When a topic takes off, which sources had it first? A ripple spreads from the first group to the others: the further from the centre, the later it arrived.</p></header>
${vizSwitch('Signal', ctx.boards.filter(hasFirst).map((x) => ({ href: `/signal/${esc(x.slug)}/first`, title: x.title, on: x.slug === b.slug })))}
${vizFrame('first', `/signal/${s}/first`, 'Which source groups mentioned each topic first, as an animated picture')}
<p class="note">Only a topic that starts after three quiet days and reaches at least two groups is judged. A group posting more comes first more often by luck, so each one is compared with what chance predicts, and called early or late only when the difference is clear. This is the order among the sources watched here, by publication time. It does not say where a story began.</p>`,
  { description: `Which sources of ${b.title} tend to have a topic first.` });
}

export const notFoundHtml = (ctx: Ctx) => shell('Not found', bar(ctx), '<header class="pagehead"><h1>Not found</h1><p class="lede">There is no such page. <a href="/">See the briefings of today</a>.</p></header>');

// ---- routing
const NO_STORE = { 'cache-control': 'no-store' };
const NOT_FOUND_JSON = () => new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json', ...NO_STORE } });
// The only scripts a public page may load are this site's own theme script and Cloudflare Web Analytics (no cookies), and only when its token is set. Forms post only to this site (the error report).
// The picture pages (viz: site/viz.ts) may also load this site's own script, read its JSON and show its sandboxed frames.
export const PUBLIC_HEADERS_FOR = (analytics: boolean, viz = false) => ({
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; media-src 'self'; img-src 'self' https://i.ytimg.com; frame-src ${viz ? "'self'" : 'https://www.youtube-nocookie.com'}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self'${analytics ? ' https://static.cloudflareinsights.com' : ''}${viz || analytics ? `; connect-src${viz ? " 'self'" : ''}${analytics ? ' https://cloudflareinsights.com' : ''}` : ''}`,
  'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
});
let PUBLIC_HEADERS = PUBLIC_HEADERS_FOR(false);

/** The lenses of an area (AI unless asked), for the pages that apply one. Never fails the page: with none, the page shows its plain lists. */
const lensesOf = (env: Env, area: Area = 'ai'): Promise<Lens[]> => env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/lenses-public?area=' + area)).then((r) => (r.ok ? (r.json() as Promise<Lens[]>) : [])).catch(() => [] as Lens[]);

const publish = (env: Env, path: string) => env.PUBLISH.getByName('main').fetch(new Request('https://internal' + path));

/** The top topics of the first published Signal (or only those a text mentions), for a strip on another page. Never fails the page. */
async function signalStrip(env: Env, ctx: Ctx, n: number, text?: string): Promise<SigStrip | undefined> {
  const b = ctx.boards[0]; if (!b) return undefined;
  try {
    const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/signal-public?slug=${b.slug}&days=7`));
    const d = (await r.json()) as PubSignal;
    if (!r.ok || !d?.top) return undefined;
    const low = text?.toLowerCase(), says = (t: PubSigTerm) => [t.label, t.term, ...t.members].some((x) => x.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(low!));
    const topics = (low ? d.top.filter(says) : d.top).slice(0, n).map((t) => ({ term: t.term, label: t.label, isNew: t.isNew, change: t.change }));
    return { slug: b.slug, title: b.title, area: ctx.area, topics };
  } catch { return undefined; }
}

/** The files and JSON behind the picture pages: no menu to draw, so none of the page's reads. Undefined when the address is something else. */
async function vizData(env: Env, parts: string[], url: URL, me: Me | null = null): Promise<Response | undefined> {
  const jsonOf = async (r: Response) => { if (!r.ok) { await r.body?.cancel(); return NOT_FOUND_JSON(); } return new Response(r.body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' } }); };
  if (parts[0] === 'viz' && parts.length === 2) {
    if (parts[1] === 'theme.js') return new Response(THEME_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' } });
    if (parts[1] === 'visit.js') return new Response(VISIT_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' } });
    if (parts[1] === 'lens.js') return new Response(LENS_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' } });
    if (parts[1] === 'host.js') return new Response(HOST_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' } });
    const view = Object.hasOwn(VIZ_VIEWS, parts[1]) ? VIZ_VIEWS[parts[1]] : undefined;
    if (!view) return new Response('Not found', { status: 404, headers: NO_STORE });
    return new Response(view, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': await viewCsp(view), 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
  }
  if (parts[0] === 'overview.json' && parts.length === 1) {   // /overview.json?window=&lens=&area=: what get_overview answers, for the landscape frame on the landing page
    const w = url.searchParams.get('window') ?? '1', lens = url.searchParams.get('lens');
    if (!/^[137]$/.test(w) || (lens !== null && !/^[a-z][a-z0-9-]{1,19}$/.test(lens))) return NOT_FOUND_JSON();
    const area = parseArea(url.searchParams.get('area')), d = await loadOverview(env, { window: windowOf(w), lens, area, own: ownLenses(me, area), replay: true });
    return new Response(JSON.stringify(overviewOut(d, url.origin, 'brief').data), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' } });
  }
  if (parts[0] === 'lenses.json' && parts.length === 1) return jsonOf(await env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/lenses-public?area=' + parseArea(url.searchParams.get('area')))));   // /lenses.json?area=: the lenses of an area (AI unless asked): key, name, one line, colour and terms
  if (parts[0] === 'research') {
    const mon = (p: string) => env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/${p}`));
    if (parts.length === 2 && parts[1] === 'map.json') { const l = url.searchParams.get('lens'); return jsonOf(await mon(l && /^[a-z][a-z0-9-]{1,19}$/.test(l) ? `research-map?lens=${l}` : 'research-map')); }
    const m = parts.length === 4 && parts[1] === 'map' && parts[2] === 'paper' ? /^(\d{4}\.\d{4,5})\.json$/.exec(parts[3]) : null;
    if (m) return jsonOf(await mon(`research-map-paper?id=${m[1]}`));
  }
  if (parts[0] === 't' && parts.length === 2 && parts[1].endsWith('.json')) {   // /t/<slug>.json: the data behind a topic page
    const slug = parts[1].slice(0, -5), r = TOPIC_SLUG.test(slug) ? await loadTopic(env, slug, { area: areaHint(url.searchParams.get('area')) }) : null;
    if (!r) return NOT_FOUND_JSON();
    if ('redirect' in r) return new Response(null, { status: 301, headers: { location: r.redirect.replace(/(\?|$)/, '.json$1'), 'cache-control': 'public, max-age=3600' } });
    return new Response(JSON.stringify(r.data), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' } });
  }
  const hist = (p: string) => env.HISTORY.getByName('main').fetch(new Request(`https://internal/hist/${p}`));
  if (parts[0] === 'history' && parts[1] && SLUG.test(parts[1])) {
    if (parts.length === 3 && parts[2] === 'galaxy.json') return jsonOf(await hist(`pub-galaxy?slug=${parts[1]}`));
    if (parts.length === 4 && parts[2] === 'galaxy') {   // whole pages only, so there is a small number of addresses to keep
      const m = /^(\d{1,5})\.json$/.exec(parts[3]), offset = m ? Number(m[1]) : -1;
      if (offset < 0 || offset % GALAXY_PAGE || offset >= MAX_GALAXY_POINTS) return NOT_FOUND_JSON();
      return jsonOf(await hist(`pub-galaxy-points?slug=${parts[1]}&offset=${offset}`));
    }
  }
  if (parts[0] === 'signal' && parts[1] && SLUG.test(parts[1]) && parts.length === 4 && parts[2] === 'first') {
    const m = /^(7|14)\.json$/.exec(parts[3]);
    if (!m) return NOT_FOUND_JSON();
    return jsonOf(await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/first-public?slug=${parts[1]}&days=${m[1]}`)));
  }
  return undefined;
}

/** The landing page: every read is on its own (loadOverview, shared with the MCP tool get_overview), so any one source failing leaves that block out and the rest as it was. */
async function landingPage(env: Env, ctx: Ctx, url: URL): Promise<string> {
  const d = await loadOverview(env, { window: windowOf(url.searchParams.get('window')), lens: url.searchParams.get('lens'), boards: ctx.boards, area: ctx.area, own: ownLenses(ctx.me, ctx.area) });
  return landingHtml(ctx, d, url.origin);
}

async function render(env: Env, url: URL, viewer: Viewer = { enabled: false, me: null }): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean);
  const data = await vizData(env, parts, url, viewer.me);
  if (data) return data;
  const html = (body: string, status = 200) => new Response(body, { status, headers: { ...PUBLIC_HEADERS, ...(status === 200 ? { 'cache-control': 'public, max-age=60' } : NO_STORE) } });
  // The rail on every page needs the topics and the public lists.
  const listsDo = (path: string) => env.LISTS.getByName('main').fetch(new Request('https://internal/lists/' + path)).then((r) => r.json()).catch(() => []);
  const [topics, lists, alists, flists, reports, boards, views] = await Promise.all([
    publish(env, '/pub/topics').then((r) => r.json() as Promise<PubTopic[]>),
    listsDo('x-public') as Promise<PubXList[]>, listsDo('a-public') as Promise<PubAList[]>, listsDo('f-public') as Promise<PubFList[]>,
    env.HISTORY.getByName('main').fetch(new Request('https://internal/hist/pub-reports')).then((r) => r.json() as Promise<PubReportBrief[]>).catch(() => [] as PubReportBrief[]),
    env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/signal-public-boards')).then((r) => r.json() as Promise<PubBoard[]>).catch(() => [] as PubBoard[]),
    env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/views-public')).then((r) => (r.ok ? (r.json() as Promise<PubView[]>) : [])).catch(() => [] as PubView[]),
  ]);
  // One Ctx per area: AI pages see only AI briefings and Signals, politics pages only politics ones. The lists, reports and feed pages are not tagged with an area: they belong to AI.
  const areas = publishedAreas(boards, topics);
  const lensBy: Partial<Record<Area, Lens[]>> = {};   // the lenses of each area, read once per request: the top bar offers them on every page
  const ctxFor = (area: Area): Ctx => ({ area, areas, lenses: lensBy[area], users: viewer.enabled, me: viewer.me, msg: viewer.me ? (url.searchParams.get('msg') ?? '').slice(0, 200) : '', topics: topicsOfArea(topics, area), boards: boardsOfArea(boards, area), ...(area === 'ai' ? { lists, alists, flists, reports, views } : { lists: [], alists: [], flists: [], reports: [], views: [] }) });
  const area = areaOfRequest(parts, url.searchParams, boards, topics);
  lensBy[area] = [...await lensesOf(env, area), ...ownLenses(viewer.me, area)];
  const ctx = ctxFor(area);
  const missing = () => html(notFoundHtml(ctx), 404);
  const vizPage = (body: string) => new Response(body, { headers: { ...PUBLIC_HEADERS_FOR(!!analyticsToken, true), 'cache-control': 'public, max-age=60' } });

  if (parts[0] === 'me') {   // /me and /me/ask/<id>: the signed-in reader's own page, never cached (handlePublic)
    const me = viewer.me;
    if (!viewer.enabled) return missing();
    if (!me) return html(shell('Your settings · Undercurrent', bar(ctx, undefined, 'me'), `<header class="pagehead"><h1>Your settings</h1><p class="lede">This page needs the site’s sign-in, which did not come through${viewer.problem ? ` (${esc(viewer.problem)})` : ''}. Reload the page, or sign in again. If it keeps happening, the site’s sign-in setting may be wrong: the site owner can check it.</p></header>`, {}), 403);
    if (parts.length === 1) return html(meHtml(ctx, me, (lensBy[area] ?? []).filter((l) => !isOwnLens(l.key)), await env.USERS.getByName('main').asks(me.email)));
    if (parts.length === 3 && parts[1] === 'ask' && /^\d{1,10}$/.test(parts[2])) { const a = await env.USERS.getByName('main').ask(me.email, Number(parts[2])); return a && a.answer ? html(askHtml(ctx, a, me)) : missing(); }
    return missing();
  }
  if (parts.length === 0) return vizPage(await landingPage(env, ctx, url));   // the viz policy: the landscape frame (after the text) is the one script it adds
  if (parts[0] === 'politics') {   // /politics and /politics/briefings: the politics area, when something of it is published
    if (!areas.includes('politics')) return missing();
    if (parts.length === 1) return vizPage(await landingPage(env, ctx, url));
    if (parts.length === 2 && parts[1] === 'briefings') return html(briefingsHtml(ctx, await signalStrip(env, ctx, 8), url.origin, null));
    return missing();
  }
  if (parts.length === 1 && parts[0] === 'briefings') {   // the day's briefings: what the landing page was before the redesign
    // Worth having without its picture, so a failure here only leaves the picture out.
    const lead = await publish(env, '/pub/hero').then((r) => (r.ok ? (r.json() as Promise<PubHero | null>) : null)).catch(() => null);
    return html(briefingsHtml(ctx, await signalStrip(env, ctx, 8), url.origin, lead));
  }
  if (parts.length === 1 && parts[0] === 'agent') return html(agentHtml(ctx, url.origin));
  if (parts.length === 1 && parts[0] === 'lists') return listTotal(ctx) ? html(listsHtml(ctx)) : missing();
  if (parts[0] === 'research' && parts[1] === 'map' && parts.length === 2) return vizPage(researchMapHtml(ctx, chosenLens(ctx.lenses ?? [], url.searchParams.get('lens'))));   // ?lens= starts the map on that lens
  if (parts[0] === 'research' && parts.length === 2) {
    const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/research-page?slug=${encodeURIComponent(parts[1])}&page=${Number(url.searchParams.get('page')) || 1}`));
    if (!r.ok) { await r.body?.cancel(); return missing(); }
    return html(researchTopicHtml((await r.json()) as PubResearchPage, ctx));
  }
  if (parts[0] === 'research' && parts.length === 1) {
    const r = await env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/pulse-public'));
    if (!r.ok) { await r.body?.cancel(); return missing(); }
    return html(researchHtml((await r.json()) as PubPulse, ctx));
  }
  if (parts[0] === 't') {   // /t/<slug>[?angle=]: one topic, with its angles
    const slug = parts.length === 2 ? parts[1] : '';
    if (!TOPIC_SLUG.test(slug)) return missing();
    const r = await loadTopic(env, slug, { area: areaHint(url.searchParams.get('area')) });
    if (!r) return missing();
    if ('redirect' in r) { const rest = new URLSearchParams(url.search); rest.delete('area'); const tail = rest.toString(); return new Response(null, { status: 301, headers: { location: r.redirect + (tail ? (r.redirect.includes('?') ? '&' : '?') + tail : ''), 'cache-control': 'public, max-age=3600' } }); }
    // A topic belongs to the area of its Signal, whatever the address said: a politics topic opened without a hint still gets the politics menu and leads back to /politics.
    lensBy[r.data.area] ??= [...await lensesOf(env, r.data.area), ...ownLenses(viewer.me, r.data.area)];
    const tctx = r.data.area === ctx.area ? ctx : ctxFor(r.data.area);
    return html(topicHtml(r.data, tctx, topicAngle(url.searchParams.get('angle')), url.origin, lensBy[r.data.area]));
  }
  if (parts[0] === 'search' && parts.length === 1) {   // /search?q=&kinds=&lens=&window=&page=: everything, topics first
    const lenses = ctx.lenses ?? [], lens = chosenLens(lenses, url.searchParams.get('lens')), kinds = parseKinds(url.searchParams.get('kinds'));
    const ans = await loadSearch(env, { q: url.searchParams.get('q') ?? '', kinds, window: windowOfSearch(url.searchParams.get('window')), lens: lens?.key, page: pageOf(url.searchParams.get('page')), area: ctx.area });
    return html(searchHtml(ctx, ans, lenses, lens));
  }
  if (parts[0] === 'topics' && parts.length === 1) {   // /topics[?q=] stays: the list of every topic, narrowed by name (the search boxes now go to /search)   // /topics[?q=]: every Signal topic of the published Signals
    const all = (await Promise.all(ctx.boards.map((b) => env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/signal-public-terms?slug=${b.slug}`))
      .then((r) => (r.ok ? (r.json() as Promise<PubTerms>) : null)).catch(() => null)))).filter((x): x is PubTerms => !!x);
    const lenses = ctx.lenses ?? [];
    return ctx.boards.length ? html(topicsHtml(all, ctx, url.searchParams.get('q') ?? '', lenses, chosenLens(lenses, url.searchParams.get('lens')))) : missing();
  }
  if (parts[0] === 'feeds') {   // /feeds/<address>: a feed page
    if (parts.length === 1) return ctx.views.length ? new Response(null, { status: 302, headers: { location: `/feeds/${ctx.views[0].slug}`, ...NO_STORE } }) : missing();
    if (parts.length !== 2 || !SLUG.test(parts[1])) return missing();
    const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/view-public?slug=${parts[1]}`));
    if (!r.ok) { await r.body?.cancel(); return missing(); }
    return html(feedPageHtml((await r.json()) as PubViewPage, ctx));
  }
  if (parts[0] === 'signal') {
    if (parts.length === 1) return ctx.boards.length ? html(signalIndexHtml(ctx)) : missing();
    // An address a Signal had before: send readers (and old links) to where it is now.
    const moved = !ctx.boards.some((b) => b.slug === parts[1]) && ctx.boards.find((b) => b.aliases?.includes(parts[1]));
    if (moved) return new Response(null, { status: 301, headers: { location: ['/signal', moved.slug, ...parts.slice(2)].map((x) => x.replace(/[^\w\-/%.~]/g, encodeURIComponent)).join('/') + url.search, 'cache-control': 'public, max-age=3600' } });
    if (parts[1] === 'method' && parts.length === 2) return html(signalMethodHtml(ctx));
    if (parts[2] === 'first') {   // /signal/<slug>/first: Who Said It First
      const b = ctx.boards.find((x) => x.slug === parts[1]);
      return b && parts.length === 3 ? vizPage(firstPageHtml(b, ctx)) : missing();
    }
    if (parts[2] === 't') {   // /signal/<slug>/t/<term>[/<days>]: the old address of a topic, now one page for the subject at /t/<slug>
      let term = ''; try { term = decodeURIComponent(parts[3] ?? ''); } catch { /* not a valid address */ }
      if (parts.length < 4 || parts.length > 5 || !SLUG.test(parts[1]) || ![1, 3, 7, 14].includes(parts.length === 4 ? 7 : Number(parts[4])) || !term || term.length > 80 || !ctx.boards.some((b) => b.slug === parts[1])) return missing();
      return new Response(null, { status: 301, headers: { location: topicUrl(term, areaOf(ctx.boards.find((b) => b.slug === parts[1]))), 'cache-control': 'public, max-age=3600' } });
    }
    const days = parts.length === 2 ? 7 : Number(parts[2]);
    if (parts.length > 3 || !SLUG.test(parts[1]) || ![1, 3, 7, 14].includes(days) || !ctx.boards.some((b) => b.slug === parts[1])) return missing();
    const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/signal-public?slug=${parts[1]}&days=${days}`));
    const d = (await r.json().catch(() => null)) as PubSignal | null;
    if (!r.ok) return html(signalMessageHtml(ctx, parts[1], 'This Signal cannot be shown right now. Please try again in a moment.'), 503);
    // A published Signal with nothing counted in the period (a quiet source, or every group muted) is still a page, not a missing one.
    const sort = (SORTS.find(([k]) => k === url.searchParams.get('sort'))?.[0] ?? 'strength') as SigSort, grp = /^\d{1,2}$/.test(url.searchParams.get('group') ?? '') ? Number(url.searchParams.get('group')) : -1;
    const lenses = ctx.lenses ?? [];
    return html(d?.groups?.length ? signalPageHtml(d, ctx, { sort, group: grp < (d.groups?.length ?? 0) ? grp : -1, lenses, lens: chosenLens(lenses, url.searchParams.get('lens')) }) : signalMessageHtml(ctx, parts[1], 'Nothing has been counted for this Signal in this period yet.'));
  }
  if (parts[0] === 'history') {
    if (parts.length === 1) return reports.length ? html(historyIndexHtml(ctx)) : missing();
    if (parts.length === 3 && parts[2] === 'galaxy') {   // /history/<slug>/galaxy: the Tweet Galaxy of a published report
      if (!SLUG.test(parts[1])) return missing();
      const r = await env.HISTORY.getByName('main').fetch(new Request(`https://internal/hist/pub-galaxy?slug=${parts[1]}`));
      if (!r.ok) { await r.body?.cancel(); return missing(); }
      return vizPage(galaxyPageHtml(parts[1], (await r.json()) as PubGalaxy, ctx));
    }
    let sort: 'new' | 'top' = 'new', pageNo = 1;
    if (parts.length === 4 && (parts[2] === 'new' || parts[2] === 'top') && /^\d{1,5}$/.test(parts[3])) { sort = parts[2]; pageNo = Math.max(1, Number(parts[3])); }
    else if (parts.length !== 2) return missing();
    if (!SLUG.test(parts[1])) return missing();
    const q = `slug=${parts[1]}`, ask = (p: string) => env.HISTORY.getByName('main').fetch(new Request(`https://internal/hist/${p}`));
    const [rep, tw] = await Promise.all([ask(`pub-report?${q}`), ask(`pub-tweets?${q}&sort=${sort}&page=${pageNo}`)]);
    if (!rep.ok || !tw.ok) { await rep.body?.cancel(); await tw.body?.cancel(); return missing(); }
    const tweets = (await tw.json()) as PubTweets;
    if (pageNo > tweets.pages) return missing();
    return html(reportHtml((await rep.json()) as PubReport, tweets, url.origin, ctx));
  }
  if (parts[0] === 'report' && parts.length === 3 && SLUG.test(parts[1]) && ISSUE_ID.test(parts[2])) {   // /report/<topic>/<day>?theme=…
    const r = await publish(env, `/pub/issue?slug=${parts[1]}&id=${parts[2]}`);
    if (!r.ok) { await r.body?.cancel(); return missing(); }
    const page = (await r.json()) as PubPage, sent = url.searchParams.get('sent');
    return new Response(errorReportHtml(page.topic, page.issue.id, (url.searchParams.get('theme') ?? '').slice(0, 120), ctx, sent === 'ok' || sent === 'error' ? sent : undefined), { headers: { ...PUBLIC_HEADERS, ...NO_STORE } });
  }
  if (parts.length > 2 || !SLUG.test(parts[0]) || (parts[1] && parts[1] !== 'archive' && parts[1] !== 'feed.xml' && !ISSUE_ID.test(parts[1]))) return missing();
  if (parts[1] === 'feed.xml') {
    const r = await publish(env, `/pub/feed?slug=${parts[0]}`);
    if (!r.ok) { await r.body?.cancel(); return missing(); }
    return new Response(feedXml((await r.json()) as Parameters<typeof feedXml>[0], url.origin), { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  }
  if (parts[1] === 'archive') {
    const r = await publish(env, `/pub/archive?slug=${parts[0]}`);
    if (!r.ok) { await r.body?.cancel(); return missing(); }
    return html(archiveHtml((await r.json()) as Parameters<typeof archiveHtml>[0], url.origin, ctx));
  }
  const res = await publish(env, parts[1] ? `/pub/issue?slug=${parts[0]}&id=${parts[1]}` : `/pub/topic?slug=${parts[0]}`);
  if (!res.ok) { await res.body?.cancel(); return missing(); }
  const page = (await res.json()) as PubPage;
  const pctx = areaOf(page.topic) === ctx.area ? ctx : ctxFor(areaOf(page.topic));   // an unlisted briefing is found by its address: it still belongs to its own area
  return html(issueHtml(page, url.origin, pctx, await signalStrip(env, pctx, 8, page.issue.markdown)));
}

/** A report from the form: checked here, stored by the Publish object with only a one-day hash of the address. Always answers with a redirect. */
async function reportPost(request: Request, env: Env): Promise<Response> {
  const f = await request.formData().catch(() => null);
  const get = (k: string) => String(f?.get(k) ?? '').trim();
  const slug = get('slug'), id = get('id'), theme = get('theme').slice(0, 120), message = get('message').slice(0, 1000);
  const back = (sent: string) => new Response(null, { status: 303, headers: { location: `/report/${SLUG.test(slug) ? slug : 'x'}/${ISSUE_ID.test(id) ? id : 'x'}?${new URLSearchParams({ theme, sent })}`, ...NO_STORE } });
  if (!SLUG.test(slug) || !ISSUE_ID.test(id)) return new Response('Bad request', { status: 400, headers: NO_STORE });
  if (get('website')) return back('ok');   // filled by a bot: thank it and drop it
  if (message.length < 5) return back('error');
  const day = new Date().toISOString().slice(0, 10), raw = `${request.headers.get('cf-connecting-ip') ?? ''}|${day}`;
  const who = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  const r = await env.PUBLISH.getByName('main').fetch(new Request('https://internal/pub/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, id, theme, message, who }) }));
  return back(r.ok ? 'ok' : 'error');
}

/** /t/<slug>/card.png: the picture a shared topic link shows (src/site/shareCard.ts). */
const CARD_PATH = /^\/t\/[a-z0-9][a-z0-9-]{0,63}\/card\.png$/;
const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
/** Where a topic's card is: the day is in the address, so a link shared tomorrow gets tomorrow's curve while one shared today keeps showing today's. */
export const cardHref = (slug: string, area: Area, day = utcDay()) => `/t/${slug}/card.png?${area === 'politics' ? 'area=politics&' : ''}d=${day}`;
/**
 * The card as a PNG. Drawn once per topic, area and day and kept at the edge for six hours (drawing takes tens of milliseconds, but crawlers ask in bursts when a link spreads).
 * A topic counted under a bigger one sends to that one's card, as its page does. Never starts a model call.
 */
async function topicCard(request: Request, env: Env, url: URL, slug: string): Promise<Response> {
  const area = areaHint(url.searchParams.get('area')), day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('d') ?? '') ? url.searchParams.get('d')! : utcDay();
  const ver = (env as { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA?.id ?? '';
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`${url.origin}/t/${slug}/card.png?${area ? 'area=' + area + '&' : ''}d=${day}&v=${ver}`, { method: 'GET' });
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return request.method === 'HEAD' ? new Response(null, hit) : hit;
  const r = await loadTopic(env, slug, { quiet: true, area });
  if (!r) return new Response('Not found', { status: 404, headers: NO_STORE });
  if ('redirect' in r) { const to = /^\/t\/([^/?]+)/.exec(r.redirect)?.[1] ?? slug; return new Response(null, { status: 301, headers: { location: cardHref(to, r.redirect.includes('area=politics') ? 'politics' : 'ai', day), 'cache-control': 'public, max-age=3600' } }); }
  const d = r.data, svg = shareCardSvg({ label: d.label, area: d.area, state: d.state, change: d.change, series: d.series, host: url.host });
  let png: Uint8Array;
  try { png = await svgToPng(svg, CARD_W, CARD_FONT); } catch (err) {
    console.error('topic card', slug, err instanceof Error ? err.message : String(err));
    return new Response('Could not draw the picture', { status: 500, headers: NO_STORE });
  }
  const res = new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=21600', 'x-content-type-options': 'nosniff' } });
  await cache?.put(key, res.clone()).catch(() => undefined);
  return request.method === 'HEAD' ? new Response(null, res) : res;
}

export async function handlePublic(request: Request, env: Env, url: URL): Promise<Response> {
  analyticsToken = /^[\w-]{8,64}$/.test(env.CF_ANALYTICS_TOKEN ?? '') ? env.CF_ANALYTICS_TOKEN : '';
  PUBLIC_HEADERS = PUBLIC_HEADERS_FOR(!!analyticsToken);
  if (url.pathname === '/report' && request.method === 'POST') return reportPost(request, env);
  // Who is reading (src/site/me.ts): not for files, sound and pictures, which are the same for everyone.
  const isMe = url.pathname === '/me' || url.pathname.startsWith('/me/');
  const viewer: Viewer = /^\/(viz|audio|image)\//.test(url.pathname) || CARD_PATH.test(url.pathname) || url.pathname === '/robots.txt' ? { enabled: false, me: null } : await viewerOf(request, env);
  if (isMe && request.method === 'POST') return mePost(request, env, url, viewer);
  if (url.pathname === '/me/avatar' && request.method === 'GET') return avatarResponse(request, env, url, viewer);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', ...NO_STORE } });
  if (url.pathname === '/robots.txt') {
    return new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /custom\n`, { headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=3600' } });
  }
  // An audio version: /audio/<topic>/<day>.mp3, only while its post is published. Not page-cached: players ask for byte ranges.
  const seg = url.pathname.split('/').filter(Boolean);
  if (seg[0] === 'audio') {
    const m = seg.length === 3 ? /^(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.mp3$/.exec(seg[2]) : null;
    if (!m || !SLUG.test(seg[1])) return new Response('Not found', { status: 404, headers: NO_STORE });
    const r = await publish(env, `/pub/audio?slug=${seg[1]}&id=${m[1]}`);
    if (!r.ok) { await r.body?.cancel(); return new Response('Not found', { status: 404, headers: NO_STORE }); }
    return serveAudio(env, ((await r.json()) as { key: string }).key, request, 'public, max-age=3600');
  }
  // A picture: /image/<topic>/<day>.jpg, only while its post is published.
  if (seg[0] === 'image') {
    const m = seg.length === 3 ? /^(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.(?:jpg|png|webp)$/.exec(seg[2]) : null;
    if (!m || !SLUG.test(seg[1])) return new Response('Not found', { status: 404, headers: NO_STORE });
    const r = await publish(env, `/pub/image?slug=${seg[1]}&id=${m[1]}`);
    if (!r.ok) { await r.body?.cancel(); return new Response('Not found', { status: 404, headers: NO_STORE }); }
    return serveImage(env, ((await r.json()) as { key: string }).key, request, 'public, max-age=3600');
  }
  if (CARD_PATH.test(url.pathname)) return topicCard(request, env, url, seg[1]);
  // Edge cache: public traffic must not all land on the one Durable Object. A minute of staleness is fine.
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  // The key is the path plus the query parameters a page reads (Signal's sort and group, a topic's angle, the lens), so a sorted page is not served the default one.
  // The report form is never cached: it shows whether a report was sent.
  // A search's words (`q`, at most 80 letters) and kinds are kept whole: cut at 20 letters, two different searches would share one page.
  const q = new URLSearchParams([...['sort', 'group', 'q', 'kinds', 'page', 'angle', 'lens', 'window', 'area'].flatMap((k) => (url.searchParams.has(k) ? [[k, url.searchParams.get(k)!.slice(0, k === 'q' ? 80 : k === 'kinds' ? 40 : 20)]] : []))] as [string, string][]).toString();
  // The deployed version is part of the key, so a deploy never serves pages (with an old menu) rendered by the version before.
  const ver = (env as { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA?.id ?? '';
  const key = new Request(url.origin + url.pathname + '?' + new URLSearchParams([...(q ? new URLSearchParams(q) : []), ['v', ver]]).toString(), { method: 'GET' }), cacheable = !url.pathname.startsWith('/report/');
  // A reader's front page opens on their lens and window when they come to it from outside (the address typed, a bookmark, another site). From a
  // page of this site it was chosen ("All" in the lens chooser is a bare /), so it stays.
  const fromHere = (() => { try { return new URL(request.headers.get('Referer') ?? '').host === url.host; } catch { return false; } })();
  const home = viewer.me && url.pathname === '/' && !url.search && !fromHere ? homeFor(viewer.me.prefs, () => true) : null;
  if (home) return new Response(null, { status: 302, headers: { location: '/?' + new URLSearchParams([...(home.lens ? [['lens', home.lens]] : []), ...(home.window !== 1 ? [['window', String(home.window)]] : [])]).toString(), 'cache-control': 'private, no-store' } });
  // A page that shows what is the reader's own is made for them each time and never kept: the shared copy is the same for everyone.
  if (isMe || isPersonal(viewer.me)) {
    const res = await render(env, url, viewer), out = new Response(request.method === 'HEAD' ? null : res.body, res);
    out.headers.set('cache-control', 'private, no-store');
    return out;
  }
  const hit = cacheable ? await cache?.match(key).catch(() => undefined) : undefined;
  // The site keeps a page for a minute; a browser always asks again (no-cache), so it never shows a page older than the site's copy.
  const forBrowser = (r: Response) => { const out = new Response(request.method === 'HEAD' ? null : r.body, r); if (out.headers.get('cache-control')?.startsWith('public')) out.headers.set('cache-control', 'no-cache'); return out; };
  if (hit) return forBrowser(hit);
  const res = await render(env, url, { enabled: viewer.enabled, me: null });
  if (res.status === 200 && cacheable) await cache?.put(key, res.clone()).catch(() => undefined);
  return forBrowser(res);
}
