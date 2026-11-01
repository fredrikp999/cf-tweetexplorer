// The public side of the site: the landing page at / and one page per topic at /<slug>. Rendered here as plain
// HTML (no client script), from issues the admin has published. Model output is untrusted, so the Markdown
// renderer escapes everything first and only ever emits links to posts on x.com / twitter.com.
import { SLUG } from '../durable-objects/publish';
import { esc, inline, markdown } from './markdown';
import { anchorOf as anchorOfTheme, continuity, isMeta, langOf, normalizeThemes, readingMinutes, sectionsOf } from './brief';
import { pageOfFeed } from '../sources/youtube';
export { markdown };
import { serveAudio, serveImage } from '../media/audio-serve';
import type { Provenance } from '../durable-objects/publish';
import type { Stats } from '../history/stats.ts';
import type { Results, Subject, Theme } from '../history/analysis.ts';
import { openrouterModelInfo } from '../summarize/openrouter.ts';
import { aiModelInfo } from '../summarize/workers-ai.ts';

interface Brief { id: string; tldr: string; publishedAt: number; tweets: number; accounts?: number | null; /** Its theme headings (absent on answers from before themes were listed). */ themes?: string[] }
interface TopicInfo { slug: string; title: string; description: string; intervalHours: number }
interface IssueFull extends Brief { markdown: string; links?: string[]; windowHours: number; model: string; provenance?: Provenance; audio?: { seconds: number; v: number }; image?: { v: number; aspect: string } }
type PubTopic = TopicInfo & { latest: Brief };
interface PubXList { id: string; name: string; groups: string[]; description: string }
interface PubReportBrief { slug: string; title: string; description: string; tweets: number; fromTs: number; toTs: number; publishedAt: number }
interface PubReport { report: { slug: string; title: string; description: string; publishedAt: number }; job: { query: string; fromTs: number; toTs: number; filters: { excludeReplies: boolean; excludeRetweets: boolean; minFaves: number; lang: string }; status: string; maxTweets: number }; stats: Stats; analysis?: { narrative: string; results: Results; themes: Theme[]; subjects: Subject[] } }
interface PubTweet { id: string; url: string; text: string; createdAt: string; lang: string; isReply: boolean; likeCount: number; retweetCount: number; replyCount: number; viewCount: number; author: { userName: string; name: string } }
interface PubTweets { total: number; pages: number; page: number; sort: 'new' | 'top'; tweets: PubTweet[] }
/** What every page needs for the rail. */
interface PubAList { id: string; name: string; topic: string; handles: string[] }
interface PubFList { id: string; name: string; topic: string; feeds: { source: 'rss' | 'youtube' | 'hn'; label: string; query: string; hnTag?: string; minPoints?: number }[] }
// lists: X lists (live on x.com); alists: curated sets of X accounts; flists: curated sets of feeds (RSS, YouTube, Hacker News)
interface Ctx { topics: PubTopic[]; lists: PubXList[]; alists: PubAList[]; flists: PubFList[]; reports: PubReportBrief[]; /** The published Signals (top-level sets of source groups). */ boards: PubBoard[] }
interface PubBoard { slug: string; title: string; description: string; groups: string[]; proof?: boolean; /** Addresses it had before: they redirect here. */ aliases?: string[] }
/** One topic of a published Signal, as its own page. Items, sources and `total` are present only when the Signal shows its sources. */
interface PubTopicPage { slug: string; title: string; proof: boolean; days: number; from: string; to: string; baselineOk: boolean; term: string; label: string; members: string[]; signal: number; change: number | null; isNew: boolean;
  kind: 'shared' | 'single' | 'mixed'; breadth: number; active: number; reactions: number; related: string[]; days_: string[];
  groups: Array<{ name: string; weight: number; items: number; part: number; share: number; docs: number; perDay: number[]; perDayItems: number[] }>;
  total?: number; sources?: Array<{ label: string; group: string; n: number }>; items?: Array<{ title: string; url: string; discussionUrl: string; source: string; by: string; group: string; ts: number; reactions?: number }> }
interface PubProof { slug: string; title: string; days: number; term: string; label: string; terms: string[]; from: string; to: string; total: number; groups: Array<{ name: string; n: number }>; sources: Array<{ label: string; group: string; n: number }>; items: Array<{ title: string; url: string; discussionUrl: string; source: string; by: string; group: string; ts: number }> }
// Signal, as the Monitor gives it for the public page: group names and counts, and terms. `parts` is each group's share of a term's score, in the order of `groups`.
interface PubSigTerm { term: string; label: string; related: string[]; members: string[]; signal: number; change: number | null; isNew: boolean; kind: 'shared' | 'single' | 'mixed'; breadth: number; active: number; top: number; parts: number[]; /** Each group's own share of its items that mention the topic, in the order of `groups`. */ shares?: number[]; /** Only on a Signal with sources shown. */ reactions?: number; headlines?: Array<{ title: string; url: string; by: string; reactions?: number }> }
interface PubSignal { slug: string; title: string; description: string; proof?: boolean; /** Topics were named by a language model. */ ai?: boolean; /** Topics left out because they are always around at the same level. */ steadyHidden?: number; days: number; from: string; to: string; baselineOk: boolean; volumeDays: string[]; groups: Array<{ name: string; weight: number; items: number; perDay: number[] }>;
  top: PubSigTerm[]; rising: PubSigTerm[]; shared: PubSigTerm[]; single: PubSigTerm[] }
const listTotal = (c: Ctx) => c.lists.length + c.alists.length + c.flists.length;
type PubPage = { topic: TopicInfo; issue: IssueFull; archive: Brief[] };
/** A Signal's top topics, as a strip on other pages: a name and its link. */
interface SigStrip { slug: string; title: string; topics: Array<{ term: string; label: string; isNew: boolean; change: number | null }> }
interface Mention { slug: string; title: string; id: string; publishedAt: number; tldr: string; theme?: string; anchor?: string }

const ISSUE_ID = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;

// ---- pages
const date = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const every = (h: number) => (h < 24 ? `every ${h} hours` : h === 24 ? 'daily' : h === 48 ? 'every other day' : h === 168 ? 'weekly' : `every ${h} hours`);

const CSS = `
:root{--bg:#f6f5f1;--card:#fff;--text:#16201f;--muted:#5d6b6a;--line:#e0ddd4;--accent:#b0214f;--soft:#f9e9ee;--bar:#1f7a8c;--rail:#0c2a31;--rail-text:#b7cfd2;--rail-dim:#7b9ca1;--rail-on:rgba(255,255,255,.1);
--ui:"Bricolage Grotesque",system-ui,-apple-system,"Segoe UI",sans-serif;--read:Newsreader,"Iowan Old Style",Georgia,serif}
@media(prefers-color-scheme:dark){:root{--bg:#0d1718;--card:#142224;--text:#e8efee;--muted:#93a8a6;--line:#243a3c;--accent:#ff7aa1;--soft:#3a1626;--bar:#4cb5c6;--rail:#06151a;--rail-on:rgba(255,255,255,.08)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 var(--ui)}
a{color:var(--accent)}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.app{display:grid;grid-template-columns:252px minmax(0,1fr);min-height:100vh}
.rail{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--rail);color:var(--rail-text);display:flex;flex-direction:column;padding:20px 12px 16px}
.rail a{color:inherit;text-decoration:none}.rail a:focus-visible{outline-color:#fff}
.brand{display:flex;align-items:center;gap:10px;padding:0 8px 22px;color:#fff!important;font-weight:700;font-size:18px;letter-spacing:-.01em}
.brand svg{width:32px;height:32px;flex:none}.brand small{display:block;font-weight:500;font-size:12px;color:var(--rail-dim);letter-spacing:0;line-height:1.25}
.rail nav{display:flex;flex-direction:column;gap:2px;flex:1}.rail .grp{padding:16px 10px 5px;font-size:12.5px;color:var(--rail-dim)}
.rail nav a{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:9px;font-size:14.5px}
.rail nav a:hover{background:var(--rail-on);color:#fff}
.rail nav a[aria-current=page],.rail nav a.on{background:var(--rail-on);color:#fff;font-weight:600;box-shadow:inset 3px 0 0 var(--accent)}
.rail .sub{display:flex;flex-direction:column;gap:2px;margin:2px 0 6px 14px;padding-left:8px;border-left:1px solid rgba(255,255,255,.12)}
.rail .sub a{font-size:13.5px;padding:6px 10px;font-weight:400}.rail .sub a[aria-current=page]{box-shadow:none;background:rgba(255,255,255,.14);font-weight:600}
.rail .sub small{color:var(--rail-dim);font-weight:400}
.railfoot{padding:14px 10px 0;border-top:1px solid rgba(255,255,255,.1);font-size:12.5px;line-height:1.45;color:var(--rail-dim)}
.page{max-width:60rem;width:100%;padding:38px 44px 72px}
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
.note{margin-top:40px;padding:14px 16px;background:var(--soft);border-radius:10px;color:var(--muted);font-size:14px}
.days{display:grid;gap:10px}.days details{background:var(--card);border:1px solid var(--line);border-radius:12px}
.days summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:8.5rem 1fr 1rem;gap:14px;align-items:baseline;padding:14px 16px}
.days summary::-webkit-details-marker{display:none}.days summary::after{content:"+";color:var(--muted);text-align:right}.days details[open] summary::after{content:"\\2212"}
.days summary time{color:var(--muted);font-size:14px;white-space:nowrap}.days summary span{font-family:var(--read);font-size:17px}
.days summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:12px}.days details[open] summary{border-bottom:1px solid var(--line)}
.days .aud{font-family:var(--ui,inherit);font-style:normal;font-size:13px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums;margin-left:6px}
.days .body{padding:6px 20px 16px}.days .perma{font-size:14px;margin:0}
@media(max-width:860px){.app{grid-template-columns:minmax(0,1fr)}.rail,.page{min-width:0}.rail{position:static;height:auto;padding:12px 12px 8px}.brand{padding-bottom:10px}
.rail nav{flex-direction:row;overflow-x:auto;gap:6px;padding-bottom:6px}.rail nav a{white-space:nowrap;border:1px solid rgba(255,255,255,.14)}
.rail .grp,.rail .sub,.railfoot{display:none}.page{padding:24px 18px 56px}.views{display:flex}}
@media(max-width:520px){.days summary{grid-template-columns:1fr 1rem}.days summary time{grid-column:1}.days summary span{grid-column:1}.days summary::after{grid-row:1/3;grid-column:2}
figure.bars div{grid-template-columns:6rem 1fr 2.5rem}nav.archive li{grid-template-columns:1fr}}
.sgwin{display:flex;gap:4px;margin:0 0 12px;flex-wrap:wrap}.sgwin a{padding:5px 14px;border-radius:999px;border:1px solid var(--line);color:var(--text);text-decoration:none;font-size:14px;background:var(--card)}.sgwin a[aria-current=page]{border-color:var(--accent);color:var(--accent);font-weight:600}
.sglegend{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:14px;margin:6px 0 4px}.sglegend i,.sgrow .bar i{display:inline-block}.sglegend i{width:11px;height:11px;border-radius:3px;margin-right:6px}.sglegend small{color:var(--muted)}
.sgrows{display:flex;flex-direction:column;gap:6px}.sgrow{display:grid;grid-template-columns:minmax(90px,200px) minmax(0,1fr) 3.4rem minmax(0,200px);gap:12px;align-items:center;font-size:15px}
.sgrow .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.sgrow .t small{display:block;font-weight:400;font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis}.sgrow .bar{display:flex;height:16px;border-radius:4px;overflow:hidden}.sgrow .bar i{display:block;min-width:2px}
.sgrow b{text-align:right;font-weight:500;font-variant-numeric:tabular-nums;color:var(--muted)}.sgrow .cs{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.chip{font-size:12px;padding:0 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}.chip.shared{color:#1a7f5a;border-color:#1a7f5a}.chip.single{color:#7c5cbf;border-color:#7c5cbf}.chip.up{color:var(--accent);border-color:var(--accent)}
.sglist{list-style:none;margin:0;padding:0}.sglist li{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line);font-size:14.5px}.sglist small{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.act.stack>div i{min-height:0}
.sgitems{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}.sgitems li{border-left:3px solid var(--line);padding-left:12px}.sgitems .by{font-size:13px;color:var(--muted)}.sgitems a{color:var(--text)}.sgitems a:hover{color:var(--accent)}.sgrow .t a{color:inherit;text-decoration:none}.sgrow .t a:hover{color:var(--accent);text-decoration:underline}.sglist a{color:inherit;text-decoration:none}.sglist a:hover{text-decoration:underline}
.mnav{display:none}.views a.rss{margin-left:auto;font-size:13px}
.inbrief{border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:14px 0 20px;background:var(--card)}.inbrief h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}.inbrief ol{margin:0;padding-left:20px}.inbrief li{margin:3px 0}.inbrief small.up,.today small .up{color:var(--accent,#c9265f)}
article h3[id]{scroll-margin-top:16px}.thm{display:flex;flex-wrap:wrap;gap:6px;margin:-4px 0 8px}.chip.sig{text-decoration:none;color:var(--text)}.cites{font-size:13px;color:var(--muted);margin:-4px 0 18px}
article h3[id^="notable"]+ul{list-style:none;padding:0;display:grid;gap:8px}article h3[id^="notable"]+ul li{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--card)}
.daynav{display:flex;justify-content:space-between;gap:10px;margin:22px 0}.daynav a{display:flex;flex-direction:column;padding:8px 14px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--text)}.daynav a small{color:var(--muted);font-size:12px}.daynav .next{text-align:right}
.others{list-style:none;padding:0;margin:0;display:grid;gap:10px}.others li{display:flex;flex-direction:column}.others span{color:var(--muted);font-size:14.5px}
.today{list-style:none;padding:0;margin:0 0 10px;display:grid;gap:16px}.today li{border-bottom:1px solid var(--line);padding-bottom:14px}.today .h{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.today .h a{text-decoration:none;color:var(--text);font-size:18px}.today small{color:var(--muted)}.today p{margin:6px 0}.today .th,.daylist .th{font-size:14px;color:var(--muted)}.today .th a,.daylist .th a{color:var(--muted)}
.daylist{list-style:none;padding:0;margin:0;display:grid;gap:14px}.daylist li{display:grid;grid-template-columns:9rem minmax(0,1fr);gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px}.daylist p{margin:0 0 4px}.daylist .d{text-decoration:none;font-weight:600}
@media(max-width:860px){.rail>nav.full{display:none}.mnav{display:block}.mnav summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;padding:8px 2px;font-weight:600}.mnav summary span{opacity:.75;font-weight:400}.rail .mnav nav{flex-direction:column;overflow:visible;padding:4px 0 8px}.rail .mnav .grp{display:block}.rail .mnav nav a{border:0}.daylist li{grid-template-columns:1fr}}
.sgstrip{margin:18px 0 22px}.sgstrip h2{display:flex;justify-content:space-between;gap:10px;align-items:baseline;font-size:15px;margin:0 0 8px}.sgstrip h2 a{font-weight:400;font-size:13.5px;color:var(--muted)}
.sgstrip div{display:flex;flex-wrap:wrap;gap:6px}.sgstrip div a{padding:4px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--text);text-decoration:none;font-size:14px}.sgstrip small.up{color:var(--accent,#c9265f)}
.chip.react{color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.stat{border:1px solid var(--line);border-radius:12px;padding:10px 14px;background:var(--card)}.stat b{display:block;font-size:24px;letter-spacing:-.02em}.stat span{color:var(--muted);font-size:13px}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px}
.sgrow .hl{grid-column:1/-1;font-size:13.5px;color:var(--muted);margin-top:-2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sgrow .hl a{color:var(--muted)}.sgrow .hl small{margin-left:4px}
.sgview>input{position:absolute;opacity:0;pointer-events:none}.sgtabs{display:inline-flex;gap:4px;margin:0 0 10px}.sgtabs label{padding:5px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:14px;cursor:pointer}
#sgv1:checked~.sgtabs label[for=sgv1],#sgv2:checked~.sgtabs label[for=sgv2]{border-color:#c9265f;font-weight:600}#sgv1:checked~.v2,#sgv2:checked~.v1{display:none}
.sgwhere .cells{display:grid;gap:6px}.sgwhere .cell{position:relative;height:20px;border-radius:4px;background:var(--card);overflow:hidden}.sgwhere .cell i{position:absolute;inset:0 auto 0 0;opacity:.85}.sgwhere .cell em{position:relative;font-style:normal;font-size:12px;padding-left:6px;line-height:20px;color:#fff;text-shadow:0 0 3px rgba(0,0,0,.6)}
.sgcols{display:grid;gap:6px;margin:0 0 4px calc(min(200px,30%) + 12px);margin-right:calc(3.4rem + min(200px,30%) + 24px);font-size:13px;color:var(--muted)}.sgcols span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:700px){.sgcols{display:none}.sgwhere .cells{grid-column:1/-1}.sgrow{grid-template-columns:minmax(0,1fr) 3.4rem}.sgrow .bar,.sgrow .cs{grid-column:1/-1}.sgrow .cs{justify-content:flex-start}}`;

const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#c9265f"/><polyline points="5,17 11,17 14,8 18,24 21,14 23,17 27,17" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The left rail on every public page: the brand, the topics (the one you are in opens its views), and a note.
interface Active { slug: string; title: string; view: 'latest' | 'archive' | 'issue'; earlier: number }
function rail(ctx: Ctx, active?: Active, page?: 'lists' | 'history' | 'signal', board?: string): string {
  const list = [...ctx.topics].sort((a, b) => a.title.localeCompare(b.title));
  if (active && !list.some((t) => t.slug === active.slug)) list.push({ slug: active.slug, title: active.title } as PubTopic);   // an unlisted topic, reached by its link
  const items = list.map((t) => {
    const on = active?.slug === t.slug;
    return `<a href="/${esc(t.slug)}"${on ? ' class="on"' : ''}>${esc(t.title)}</a>` + (on ? `<div class="sub"><a href="/${esc(t.slug)}"${active!.view === 'latest' ? ' aria-current="page"' : ''}>Latest briefing</a>
<a href="/${esc(t.slug)}/archive"${active!.view === 'archive' ? ' aria-current="page"' : ''}>Previous days${active!.earlier ? ` <small>${active!.earlier}</small>` : ''}</a></div>` : '');
  }).join('');
  // Today, the briefings, Signal and Reports. The lists behind the briefings are linked from the foot and from each briefing's sources.
  const links = `<a href="/"${active || page ? '' : ' aria-current="page"'}>Today</a>${items ? `<div class="grp">Topics</div>${items}` : ''}${ctx.boards.length || ctx.reports.length || page === 'history' ? '<div class="grp">Across topics</div>' : ''}${ctx.boards.length ? `<a href="/signal"${page === 'signal' && !board ? ' aria-current="page"' : ''}${board ? ' class="on"' : ''}>Signal <small>${ctx.boards.length}</small></a>${page === 'signal' && ctx.boards.length > 1 ? `<div class="sub">${ctx.boards.map((b) => `<a href="/signal/${esc(b.slug)}"${b.slug === board ? ' aria-current="page"' : ''}>${esc(b.title)}</a>`).join('')}</div>` : ''}` : ''}${listTotal(ctx) ? `<a href="/lists"${page === 'lists' ? ' aria-current="page"' : ''}>Lists <small>${listTotal(ctx)}</small></a>` : ''}${ctx.reports.length || page === 'history' ? `<a href="/history"${page === 'history' ? ' aria-current="page"' : ''}>Reports${ctx.reports.length ? ` <small>${ctx.reports.length}</small>` : ''}</a>` : ''}`;
  const here = active?.title ?? (page === 'signal' ? 'Signal' : page === 'history' ? 'Reports' : page === 'lists' ? 'Lists' : 'Today');
  return `<aside class="rail"><a class="brand" href="/">${MARK}<span>Agent Cortex<small>Briefings and Signal</small></span></a>
<nav class="full" aria-label="Site">${links}</nav>
<details class="mnav"><summary><span>${esc(here)}</span> Menu</summary><nav aria-label="Site">${links}</nav></details>
<div class="railfoot">Briefings written by AI from public posts and articles. Every one shows its sources.${listTotal(ctx) ? ` <a href="/lists">The ${listTotal(ctx)} lists behind them</a>.` : ''}</div></aside>`;
}

function shell(title: string, railHtml: string, body: string, opts: { description?: string; canonical?: string; image?: string; lang?: string; feed?: string; feedTitle?: string } = {}): string {
  return `<!doctype html><html lang="${opts.lang === 'sv' ? 'sv' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${opts.description ? `<meta name="description" content="${esc(opts.description.slice(0, 200))}">` : ''}
<meta property="og:title" content="${esc(title)}">${opts.description ? `<meta property="og:description" content="${esc(opts.description.slice(0, 200))}">` : ''}
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : ''}${opts.feed ? `<link rel="alternate" type="application/rss+xml" title="${esc(opts.feedTitle ?? title)}" href="${esc(opts.feed)}">` : ''}${opts.image ? `<meta property="og:image" content="${esc(opts.image)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Newsreader:opsz,wght@6..72,400..600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="app">${railHtml}<main class="page">${body}</main></div></body></html>`;
}

const NOTE = '<p class="note">Written by an AI from public posts and articles. It can get things wrong: follow the links to read the originals.</p>';

export function landingHtml(ctx: Ctx, strip?: SigStrip): string {
  const topics = [...ctx.topics].sort((a, b) => b.latest.publishedAt - a.latest.publishedAt);
  // Today: each briefing's headline and themes, newest first; what is from the last day is marked new.
  const today = topics.map((t) => {
    const fresh = Date.now() - t.latest.publishedAt < 26 * 3600_000, th = (t.latest.themes ?? []).slice(0, 4);
    return `<li><div class="h"><a href="/${esc(t.slug)}"><b>${esc(t.title)}</b></a><small>${fresh ? '<span class="up">new</span> ' : ''}${date(t.latest.publishedAt)}</small></div>
${t.latest.tldr ? `<p>${inline(t.latest.tldr)}</p>` : ''}${th.length ? `<p class="th">${th.map((x) => `<a href="/${esc(t.slug)}#${esc(anchorOfTheme(x))}">${esc(x)}</a>`).join(' &middot; ')}</p>` : ''}</li>`;
  }).join('');
  return shell('Agent Cortex', rail(ctx), `<header class="pagehead"><div class="eyebrow">${date(Date.now())}</div><h1>Today</h1>
<p class="lede">Short briefings on what is being said online, from X, news and blog feeds, YouTube and Hacker News, and <a href="/signal">Signal</a>: what is talked about across all of it.</p></header>
${today ? `<ul class="today">${today}</ul>` : ctx.reports.length ? '' : '<p class="lede">Nothing published yet.</p>'}
${strip?.topics.length ? stripHtml(strip, 'Talked about now') : ''}
${ctx.reports.length ? `<h2 class="sect">Reports</h2><ul class="topics">${reportCards(ctx.reports)}</ul>` : ''}`,
  { description: 'Short briefings on what is being said online, from X, feeds, YouTube and Hacker News, and Signal: what is talked about across all of it.' });
}


/** A row of Signal topics linking to their pages, with what is new or rising marked. */
function stripHtml(st: SigStrip, title: string): string {
  return `<section class="sgstrip" aria-label="${esc(title)}"><h2><span>${esc(title)}</span> <a href="/signal/${esc(st.slug)}">${esc(st.title)} in Signal &rarr;</a></h2><div>${st.topics.map((t) => `<a href="/signal/${esc(st.slug)}/t/${encodeURIComponent(t.term)}">${esc(t.label)}${t.isNew ? ' <small class="up">new</small>' : t.change !== null && t.change >= 1.5 ? ` <small class="up">&uarr;</small>` : ''}</a>`).join('')}</div></section>`;
}

// ---- Signal: what the watched sources are talking about, combined. Counted automatically (no AI), from the groups marked public in the admin.
const SIG_COLORS = ['#1f7a8c', '#e3a008', '#7c5cbf', '#c2410c', '#2f9e6b', '#d6336c', '#4263eb', '#868e96'];
const sigColor = (i: number) => SIG_COLORS[i % SIG_COLORS.length];
const sigPct = (x: number) => { const p = x * 100; return (p < 10 ? p.toFixed(1) : String(Math.round(p))) + '%'; };

export function signalIndexHtml(ctx: Ctx): string {
  const cards = ctx.boards.map((b) => `<li><a class="card" href="/signal/${esc(b.slug)}"><span class="eyebrow">${b.groups.length} group${b.groups.length === 1 ? '' : 's'}</span><h2>${esc(b.title)}</h2>${b.description ? `<p>${esc(b.description)}</p>` : ''}
<div class="foot"><span>${esc(b.groups.join(' · '))}</span></div></a></li>`).join('');
  return shell('Signal · Agent Cortex', rail(ctx, undefined, 'signal'), `<header class="pagehead"><div class="eyebrow">${ctx.boards.length} signal${ctx.boards.length === 1 ? '' : 's'}</div><h1>Signal</h1>
<p class="lede">What is being talked about across news, blogs, X and Hacker News, combined into one score per topic, and where each topic shows up. <a href="/signal/method">How it works</a>.</p></header>
<ul class="topics">${cards}</ul>`, { description: 'What is being talked about across news, blogs, X and Hacker News, combined into one score per topic.' });
}

const kfmt = (v: number) => (v >= 10000 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)));
const topicHref = (slug: string, term: string, days: number) => `/signal/${esc(slug)}/t/${encodeURIComponent(term)}${days === 7 ? '' : '/' + days}`;

/** One topic of a published Signal: its numbers, where it shows up, how it moved, what goes with it and, if the Signal shows sources, the items behind it. */
export function signalTopicHtml(d: PubTopicPage, ctx: Ctx, mentions: Mention[] = []): string {
  const win = [[1, 'Today'], [3, '3 days'], [7, '7 days'], [14, '14 days']].map(([k, label]) => `<a href="${topicHref(d.slug, d.term, k as number)}"${d.days === k ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const perDay = d.days_.map((_, i) => d.groups.reduce((n, g) => n + (g.perDay[i] ?? 0), 0)), peak = Math.max(1, ...perDay);
  const chart = `<div class="act stack" role="img" aria-label="Items mentioning it per day, by group">${d.days_.map((day, i) => `<div style="height:${perDay[i] ? Math.max(4, (100 * perDay[i]) / peak) : 0}%" title="${esc(day)}: ${perDay[i]} item${perDay[i] === 1 ? '' : 's'}">${d.groups.map((g, j) => `<i style="flex:${g.perDay[i] ?? 0};background:${sigColor(j)}"></i>`).join('')}</div>`).join('')}</div><div class="axis"><span>${esc(d.days_[0])}</span><span>${esc(d.days_[d.days_.length - 1])}</span></div>`;
  const change = d.isNew ? 'new' : d.change !== null ? `&times;${d.change.toFixed(1)}` : 'n/a';
  const tile = (n: string, label: string) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`;
  const where = d.groups.map((g, i) => `<li><span><i class="sw" style="background:${sigColor(i)}"></i>${esc(g.name)}</span><small>${g.docs} of ${n(g.items)} items &middot; ${sigPct(g.share)}</small></li>`).join('');
  const items = (d.items ?? []).map((i) => `<li><div class="by">${esc(i.group)} &middot; <b>${esc(i.source)}</b>${i.by && i.by !== i.source ? ' &middot; ' + esc(i.by) : ''} &middot; ${i.ts ? date(i.ts) : ''}${i.reactions ? ` &middot; <span class="chip react">&#9650; ${kfmt(i.reactions)}</span>` : ''}</div>
${i.url ? `<a href="${esc(i.url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(i.title || i.url)}</a>` : esc(i.title)}${i.discussionUrl ? ` <a class="dim" href="${esc(i.discussionUrl)}" rel="noopener noreferrer nofollow" target="_blank">discussion</a>` : ''}</li>`).join('');
  return shell(`${d.label} · ${d.title} · Agent Cortex`, rail(ctx, undefined, 'signal', d.slug), `<header class="pagehead"><div class="eyebrow"><a href="/signal/${esc(d.slug)}${d.days === 7 ? '' : '/' + d.days}">&larr; ${esc(d.title)}</a></div><h1>${esc(d.label)}</h1>
<p class="lede">${esc(d.from)}${d.from === d.to ? '' : ' to ' + esc(d.to)}.${d.members.length ? ` Also counted under: ${esc(d.members.join(', '))}.` : ''} <a href="/signal/method">How this is worked out</a>.</p></header>
<nav class="sgwin" aria-label="Period">${win}</nav>
<div class="stats">${tile(sigPct(d.signal), 'score')}${tile(change, d.baselineOk ? 'against the period before' : 'earlier data too thin to compare')}${tile(d.kind === 'shared' ? 'everywhere' : d.kind === 'single' ? 'one group' : 'mixed', `${d.breadth} of ${d.active} group${d.active === 1 ? '' : 's'}`)}${d.reactions ? tile('&#9650; ' + kfmt(d.reactions), 'reactions to the items') : ''}</div>
<h2 class="sect">Day by day</h2><section class="panel">${chart}</section>
<h2 class="sect">Where it shows up</h2><section class="panel"><ul class="sglist">${where}</ul></section>
${mentions.length ? `<h2 class="sect">In the briefings</h2><ul class="sglist">${mentions.map((m) => `<li><a href="/${esc(m.slug)}/${esc(m.id)}${m.anchor ? '#' + esc(m.anchor) : ''}">${esc(m.title)}${m.theme ? `: ${esc(m.theme)}` : ''}</a><small>${date(m.publishedAt)}</small></li>`).join('')}</ul>` : ''}
${d.related.length ? `<h2 class="sect">Goes with</h2><p class="meta">${d.related.map((r) => `<a href="${topicHref(d.slug, r, d.days)}">${esc(r)}</a>`).join(' &middot; ')}</p>` : ''}
${d.proof ? `<h2 class="sect">Items${d.total && d.total > (d.items?.length ?? 0) ? ` <small class="dim">the newest ${d.items?.length} of ${n(d.total)}</small>` : ''}</h2>
${d.sources?.length ? `<p class="meta">${d.sources.map((x) => `${esc(x.label)} <small>${n(x.n)}</small>`).join(' &middot; ')}</p>` : ''}
<ul class="sgitems">${items || '<li class="meta">Nothing is logged for this period.</li>'}</ul>
<p class="note">Titles and links are those of the original publishers. Follow the links to read the originals.</p>` : '<p class="note">This Signal shows scores only, not the items behind them.</p>'}`,
  { description: `${d.label}: how much it is talked about, where, and how it moved.` });
}

/** What the numbers mean and how they are made, in plain words. */
export function signalMethodHtml(ctx: Ctx): string {
  return shell('How Signal works · Agent Cortex', rail(ctx, undefined, 'signal'), `<header class="pagehead"><div class="eyebrow">Methodology</div><h1>How Signal works</h1>
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
  return shell(`${b?.title ?? 'Signal'} · Agent Cortex`, rail(ctx, undefined, 'signal', slug), `<header class="pagehead"><div class="eyebrow">Signal</div><h1>${esc(b?.title ?? 'Signal')}</h1>${b?.description ? `<p class="lede">${esc(b.description)}</p>` : ''}</header><p class="meta">${esc(message)}</p>`);
}

const SORTS = [['strength', 'Strongest'], ['rising', 'Rising'], ['new', 'New'], ['reacted', 'Most reacted']] as const;
export type SigSort = (typeof SORTS)[number][0];

export function signalPageHtml(d: PubSignal, ctx: Ctx, q: { sort: SigSort; group: number } = { sort: 'strength', group: -1 }): string {
  const gname = (i: number) => d.groups[i]?.name ?? '';
  // Every topic opens its own page (its numbers and movement; with sources switched on, also the items behind it).
  const termLink = (t: PubSigTerm) => `<a href="${topicHref(d.slug, t.term, d.days)}">${esc(t.label)}</a>`;
  // Sort and filter, as links (the public pages run no script): ?sort=rising&group=1
  const base = `/signal/${esc(d.slug)}${d.days === 7 ? '' : '/' + d.days}`, qs = (sort: string, group: number) => { const p = [sort !== 'strength' ? 'sort=' + sort : '', group >= 0 ? 'group=' + group : ''].filter(Boolean).join('&amp;'); return base + (p ? '?' + p : ''); };
  const key = (t: PubSigTerm) => (q.sort === 'reacted' ? t.reactions ?? 0 : q.sort === 'rising' ? (t.isNew ? 1e6 : t.change ?? 0) : t.signal);
  let topList = d.top.filter((t) => (q.group < 0 || (t.shares?.[q.group] ?? 0) > 0) && (q.sort === 'new' ? t.isNew : q.sort === 'rising' ? t.isNew || (t.change ?? 0) >= 1.5 : q.sort === 'reacted' ? (t.reactions ?? 0) > 0 : true));
  if (q.sort !== 'strength' && q.sort !== 'new') topList = [...topList].sort((a, b) => key(b) - key(a) || b.signal - a.signal);
  topList = topList.slice(0, 20);
  const sortBar = `<nav class="sgwin" aria-label="Sort">${SORTS.map(([k, label]) => `<a href="${qs(k, q.group)}"${q.sort === k ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`
    + (d.groups.length > 1 ? `<nav class="sgwin" aria-label="Show one group"><a href="${qs(q.sort, -1)}"${q.group < 0 ? ' aria-current="page"' : ''}>All groups</a>${d.groups.map((g, i) => `<a href="${qs(q.sort, i)}"${q.group === i ? ' aria-current="page"' : ''}>${esc(g.name)}</a>`).join('')}</nav>` : '');
  const chips = (t: PubSigTerm) => [
    d.groups.length > 1 ? (t.kind === 'shared' ? '<span class="chip shared">everywhere</span>' : t.kind === 'single' ? `<span class="chip single">only ${esc(gname(t.top))}</span>` : '<span class="chip">mixed</span>') : '',
    t.isNew ? '<span class="chip up">new</span>' : t.change !== null && t.change >= 1.5 ? `<span class="chip up">&uarr; &times;${t.change.toFixed(1)}</span>` : '',
    t.reactions ? `<span class="chip react" title="Reactions to the items we saw">&#9650; ${kfmt(t.reactions)}</span>` : '',
  ].join('');
  const max = Math.max(1e-9, ...topList.map((t) => t.signal));
  const headline = (t: PubSigTerm) => { const h = t.headlines?.[0]; return h?.title ? `<div class="hl">${h.url ? `<a href="${esc(h.url)}" rel="noopener noreferrer nofollow" target="_blank">&ldquo;${esc(h.title)}&rdquo;</a>` : `&ldquo;${esc(h.title)}&rdquo;`}${h.by ? ` <small>${esc(h.by)}</small>` : ''}${h.reactions ? ` <small>&#9650; ${kfmt(h.reactions)}</small>` : ''}</div>` : ''; };
  const name = (t: PubSigTerm) => `<span class="t" title="${esc([t.label, ...t.members].join(', '))}">${termLink(t)}${t.related.length ? `<small>${esc(t.related.join(' · '))}</small>` : ''}</span>`;
  const rows = topList.map((t) => `<div class="sgrow">${name(t)}
<span class="bar" style="width:${Math.max(2, (100 * t.signal) / max).toFixed(1)}%" role="img" aria-label="${esc(t.parts.map((p, i) => `${gname(i)} ${Math.round(p * 100)}%`).join(', '))}">${t.parts.map((p, i) => (p >= 0.02 ? `<i style="flex:${p.toFixed(3)};background:${sigColor(i)}" title="${esc(gname(i))}"></i>` : '')).join('')}</span>
<b>${sigPct(t.signal)}</b><span class="cs">${chips(t)}</span>${headline(t)}</div>`).join('');
  // "Where it shows up": each group's own share of its items, one column per group. Switched with a radio, so the page needs no script.
  const topShare = Math.max(1e-9, ...topList.flatMap((t) => t.shares ?? []));
  const cols = `grid-template-columns:repeat(${d.groups.length},minmax(0,1fr))`;
  const grid = topList.map((t) => `<div class="sgrow sgwhere">${name(t)}
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
  const keep = [q.sort !== 'strength' ? 'sort=' + q.sort : '', q.group >= 0 ? 'group=' + q.group : ''].filter(Boolean).join('&amp;');   // the window keeps the sort and the group
  const win = [[1, 'Today'], [3, '3 days'], [7, '7 days'], [14, '14 days']].map(([k, label]) => `<a href="/signal/${esc(d.slug)}${k === 7 ? '' : '/' + k}${keep ? '?' + keep : ''}"${d.days === k ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return shell(`${d.title} · Signal · Agent Cortex`, rail(ctx, undefined, 'signal', d.slug), `<header class="pagehead"><div class="eyebrow">${esc(d.from)}${d.from === d.to ? '' : ' to ' + esc(d.to)}</div><h1>${esc(d.title)}</h1>
<p class="lede">${d.description ? esc(d.description) + ' ' : ''}What is being talked about across ${d.groups.length === 1 ? 'one group of sources' : `${d.groups.length} groups of sources`}, combined into one score, and where each topic shows up.</p></header>
<nav class="sgwin" aria-label="Period">${win}</nav>
<div class="sglegend">${d.groups.map((g, i) => `<span><i style="background:${sigColor(i)}"></i>${esc(g.name)} <small>${n(g.items)} items${g.weight === 1 ? '' : ` &middot; counts &times;${g.weight}`}</small></span>`).join('')}</div>
<h2 class="sect">What is in the signal</h2>
${sortBar}${rows ? `${view}<p class="note">Each bar is split by the group the topic comes from, so a bar of one colour is a topic only that group is talking about.</p>` : `<p class="meta">${d.top.length ? 'No topic matches this filter.' : 'No topic is mentioned often enough yet.'}</p>`}
<div class="panels">${list('Everywhere', 'Mentioned in most groups at once', d.shared, (t) => `${t.breadth} of ${t.active} groups`)}
${d.groups.length > 1 ? list('Only in one group', 'What one kind of source is talking about alone', d.single, (t) => esc(gname(t.top))) : ''}
${list('Rising', d.baselineOk ? 'More than in the period before' : 'Needs a few more days of data', d.rising, (t) => (t.isNew ? 'new' : `&times;${(t.change ?? 0).toFixed(1)}`))}</div>
<h2 class="sect">Items per day</h2><section class="panel">${volume}</section>
<p class="note"><a href="/signal/method">How this is worked out.</a> Topics are found automatically in the titles and text of public posts and articles${d.ai ? ', named by a language model that reads each item once' : ', by counting words and phrases'}. A topic's score is the share of a group's items that mention it, averaged over the groups. Topics that are always around at the same level as in the period before are left out${d.steadyHidden ? ` (${n(d.steadyHidden)} here)` : ''}, so what is new or growing stands out. It reflects only the sources watched here.${d.proof ? ' Select a topic to see the items behind it.' : ''}</p>`,
  { description: 'What is being talked about across news, blogs, X and Hacker News, combined into one score, and where each topic shows up.' });
}

// ---- History reports: a collection of tweets with its statistics, published from the admin. Never cost.
const day = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const dayTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC';
const rangeText = (from: number, to: number) => `${day(from)} – ${day(to - 1)}`;

function reportCards(list: PubReportBrief[]): string {
  return list.map((r) => `<li><a class="card" href="/history/${esc(r.slug)}"><span class="eyebrow">${rangeText(r.fromTs, r.toTs)}</span><h2>${esc(r.title)}</h2>${r.description ? `<p>${esc(r.description)}</p>` : ''}
<div class="foot"><span>${n(r.tweets)} tweets</span><span>Published ${date(r.publishedAt)}</span></div></a></li>`).join('');
}

export function historyIndexHtml(ctx: Ctx): string {
  return shell('Reports · Agent Cortex', rail(ctx, undefined, 'history'), `<header class="pagehead"><div class="eyebrow">${ctx.reports.length} report${ctx.reports.length === 1 ? '' : 's'}</div><h1>Reports</h1>
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
  return shell(`${report.title} · Reports`, rail(ctx, undefined, 'history'), body,
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
    const feed = webUrl(f.url), page = f.source === 'youtube' ? pageOfFeed(f.url ?? '') : feed && f.source === 'rss' ? feed.origin : null;
    const name = page ? `<a href="${esc(page)}" rel="noopener noreferrer nofollow" target="_blank">${esc(f.label)}</a>` : `<b>${esc(f.label)}</b>`;
    // The address of the feed itself, in full, so a reader can subscribe to it or check what was read.
    const addr = feed ? ` <a class="k" href="${esc(feed.href)}" rel="noopener noreferrer nofollow" target="_blank"><code>${esc(feed.href)}</code></a>` : '';
    return `<li>${name} <span class="k">${f.source === 'hn' ? 'Hacker News' : f.source === 'youtube' ? 'YouTube' : 'RSS feed'}</span>${addr} <span class="c">${n(f.count)} ${f.count === 1 ? 'item' : 'items'}</span></li>`;
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
    isNew: 'new', cont: 'continuing', sources: 'Sources', older: 'Earlier', newer: 'Later', others: 'Other briefings today', signal: 'In Signal', updated: 'Updated', rss: 'RSS', themes: 'Themes', listAll: 'The lists behind the briefings' },
  sv: { latest: 'Senaste', earlier: 'Tidigare dagar', inbrief: 'I korthet', read: 'min läsning', based: 'utifrån', from: 'från de senaste', seeLatest: 'se den senaste',
    isNew: 'ny', cont: 'fortsätter', sources: 'Källor', older: 'Tidigare', newer: 'Senare', others: 'Andra sammanfattningar i dag', signal: 'I Signal', updated: 'Uppdateras', rss: 'RSS', themes: 'Teman', listAll: 'Listorna bakom sammanfattningarna' },
};
type Lang = keyof typeof LABELS;

// The topic page frame: the rail opens this topic's views; on narrow screens the views also show above the content.
function topicPage(topic: TopicInfo, view: 'latest' | 'archive' | 'issue', earlier: number, content: string, head: { title: string; description?: string; canonical?: string; image?: string; lang?: Lang }, ctx: Ctx): string {
  const cur = (v: string) => (v === view ? ' aria-current="page"' : ''), L = LABELS[head.lang ?? 'en'];
  return shell(head.title, rail(ctx, { slug: topic.slug, title: topic.title, view, earlier }), `<header class="pagehead"><div class="eyebrow">${L.updated} ${every(topic.intervalHours)}</div><h1>${esc(topic.title)}</h1>${topic.description ? `<p class="lede">${esc(topic.description)}</p>` : ''}</header>
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
const sigChip = (strip: SigStrip, t: SigStrip['topics'][number]) => `<a class="chip sig" href="/signal/${esc(strip.slug)}/t/${encodeURIComponent(t.term)}">${esc(t.label)}</a>`;

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
    return `${head}${tags ? `<div class="thm">${tags}</div>` : ''}${rest}${handles.length ? `<p class="cites">${L.sources}: ${handles.map(esc).join(' &middot; ')}</p>` : ''}`;
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
${NOTE}${listTotal(ctx) ? `<p class="note"><a href="/lists">${L.listAll} &rarr;</a></p>` : ''}`,
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

/** A topic's newest briefings as an RSS 2.0 feed, each in full. */
export function feedXml(d: { topic: TopicInfo; issues: IssueFull[] }, origin: string): string {
  const x = (v: string) => esc(v), cdata = (v: string) => `<![CDATA[${v.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`, url = `${origin}/${d.topic.slug}`;
  const items = d.issues.map((i) => `<item><title>${x(`${date(i.publishedAt)}: ${i.tldr.replace(/\*\*/g, '') || d.topic.title}`)}</title><link>${x(`${url}/${i.id}`)}</link><guid isPermaLink="true">${x(`${url}/${i.id}`)}</guid><pubDate>${new Date(i.publishedAt).toUTCString()}</pubDate><description>${cdata(markdown(normalizeThemes(i.markdown), i.links))}</description></item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${x(d.topic.title)} · Agent Cortex</title><link>${x(url)}</link><description>${x(d.topic.description || d.topic.title)}</description><language>${d.issues[0] ? langOf(d.issues[0].markdown) : 'en'}</language><atom:link href="${x(url)}/feed.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
}

// The lists behind the briefings: X lists (grouped, each opening on x.com), curated sets of X accounts, and curated sets of feeds.
// Only lists the admin marked public arrive here.
const HN_TAGS: Record<string, string> = { front_page: 'front page', story: 'new stories', show_hn: 'Show HN', ask_hn: 'Ask HN' };
function feedLine(f: PubFList['feeds'][number]): string {
  if (f.source === 'hn') return `<li><b>Hacker News</b> <span class="k">${esc(HN_TAGS[f.hnTag ?? ''] ?? 'stories')}${f.query ? `, matching <code>${esc(f.query)}</code>` : ''}${f.minPoints ? `, ${n(f.minPoints)}+ points` : ''}</span></li>`;
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
  return shell('Lists · Agent Cortex', rail(ctx, undefined, 'lists'), `<header class="pagehead"><div class="eyebrow">${listTotal(ctx)} lists</div><h1>Lists</h1>
<p class="lede">The sets of accounts and sources that these briefings draw from.</p></header>
${kinds.length > 1 ? `<nav class="chips" aria-label="Kinds of list">${kinds.map((k) => `<a href="#${k.id}">${k.title}</a>`).join('')}</nav>` : ''}${sections}`,
  { description: 'The lists of accounts, feeds and channels that the briefings draw from.' });
}

export const notFoundHtml = (ctx: Ctx) => shell('Not found', rail(ctx), '<header class="pagehead"><h1>Not found</h1><p class="lede">There is no such page. <a href="/">See all topics</a>.</p></header>');

// ---- routing
const NO_STORE = { 'cache-control': 'no-store' };
const PUBLIC_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; media-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
};

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
    return { slug: b.slug, title: b.title, topics };
  } catch { return undefined; }
}

async function render(env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean);
  const html = (body: string, status = 200) => new Response(body, { status, headers: { ...PUBLIC_HEADERS, ...(status === 200 ? { 'cache-control': 'public, max-age=60' } : NO_STORE) } });
  // The rail on every page needs the topics and the public lists.
  const listsDo = (path: string) => env.LISTS.getByName('main').fetch(new Request('https://internal/lists/' + path)).then((r) => r.json()).catch(() => []);
  const [topics, lists, alists, flists, reports, boards] = await Promise.all([
    publish(env, '/pub/topics').then((r) => r.json() as Promise<PubTopic[]>),
    listsDo('x-public') as Promise<PubXList[]>, listsDo('a-public') as Promise<PubAList[]>, listsDo('f-public') as Promise<PubFList[]>,
    env.HISTORY.getByName('main').fetch(new Request('https://internal/hist/pub-reports')).then((r) => r.json() as Promise<PubReportBrief[]>).catch(() => [] as PubReportBrief[]),
    env.MONITOR.getByName('main').fetch(new Request('https://internal/mon/signal-public-boards')).then((r) => r.json() as Promise<PubBoard[]>).catch(() => [] as PubBoard[]),
  ]);
  const ctx: Ctx = { topics, lists, alists, flists, reports, boards };
  const missing = () => html(notFoundHtml(ctx), 404);

  if (parts.length === 0) return html(landingHtml(ctx, await signalStrip(env, ctx, 8)));
  if (parts.length === 1 && parts[0] === 'lists') return listTotal(ctx) ? html(listsHtml(ctx)) : missing();
  if (parts[0] === 'signal') {
    if (parts.length === 1) return ctx.boards.length ? html(signalIndexHtml(ctx)) : missing();
    // An address a Signal had before: send readers (and old links) to where it is now.
    const moved = !ctx.boards.some((b) => b.slug === parts[1]) && ctx.boards.find((b) => b.aliases?.includes(parts[1]));
    if (moved) return new Response(null, { status: 301, headers: { location: ['/signal', moved.slug, ...parts.slice(2)].map((x) => x.replace(/[^\w\-/%.~]/g, encodeURIComponent)).join('/') + url.search, 'cache-control': 'public, max-age=3600' } });
    if (parts[1] === 'method' && parts.length === 2) return html(signalMethodHtml(ctx));
    if (parts[2] === 't') {   // /signal/<slug>/t/<term>[/<days>]: one topic of a published Signal
      const days = parts.length === 4 ? 7 : Number(parts[4]);
      let term = ''; try { term = decodeURIComponent(parts[3] ?? ''); } catch { /* not a valid address */ }
      if (parts.length < 4 || parts.length > 5 || !SLUG.test(parts[1]) || ![1, 3, 7, 14].includes(days) || !term || term.length > 80 || !ctx.boards.some((b) => b.slug === parts[1])) return missing();
      const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/signal-public-topic?slug=${parts[1]}&days=${days}&term=${encodeURIComponent(term)}`));
      const d = (await r.json().catch(() => null)) as PubTopicPage | null;
      if (!r.ok || !d?.groups?.length) return missing();
      const names = [d.label, d.term, ...d.members].filter((x, i, a) => a.indexOf(x) === i).join('|');
      const mentions = await publish(env, `/pub/mentions?q=${encodeURIComponent(names)}`).then((x) => (x.ok ? (x.json() as Promise<Mention[]>) : [])).catch(() => [] as Mention[]);
      return html(signalTopicHtml(d, ctx, mentions));
    }
    const days = parts.length === 2 ? 7 : Number(parts[2]);
    if (parts.length > 3 || !SLUG.test(parts[1]) || ![1, 3, 7, 14].includes(days) || !ctx.boards.some((b) => b.slug === parts[1])) return missing();
    const r = await env.MONITOR.getByName('main').fetch(new Request(`https://internal/mon/signal-public?slug=${parts[1]}&days=${days}`));
    const d = (await r.json().catch(() => null)) as PubSignal | null;
    if (!r.ok) return html(signalMessageHtml(ctx, parts[1], 'This Signal cannot be shown right now. Please try again in a moment.'), 503);
    // A published Signal with nothing counted in the period (a quiet source, or every group muted) is still a page, not a missing one.
    const sort = (SORTS.find(([k]) => k === url.searchParams.get('sort'))?.[0] ?? 'strength') as SigSort, grp = /^\d{1,2}$/.test(url.searchParams.get('group') ?? '') ? Number(url.searchParams.get('group')) : -1;
    return html(d?.groups?.length ? signalPageHtml(d, ctx, { sort, group: grp < (d.groups?.length ?? 0) ? grp : -1 }) : signalMessageHtml(ctx, parts[1], 'Nothing has been counted for this Signal in this period yet.'));
  }
  if (parts[0] === 'history') {
    if (parts.length === 1) return reports.length ? html(historyIndexHtml(ctx)) : missing();
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
  return html(issueHtml(page, url.origin, ctx, await signalStrip(env, ctx, 8, page.issue.markdown)));
}

export async function handlePublic(request: Request, env: Env, url: URL): Promise<Response> {
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
  // Edge cache: public traffic must not all land on the one Durable Object. A minute of staleness is fine.
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(url.origin + url.pathname, { method: 'GET' });
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return request.method === 'HEAD' ? new Response(null, hit) : hit;
  const res = await render(env, url);
  if (res.status === 200) await cache?.put(key, res.clone()).catch(() => undefined);
  return request.method === 'HEAD' ? new Response(null, res) : res;
}
