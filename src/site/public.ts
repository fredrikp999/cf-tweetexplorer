// The public side of the site: the landing page at / and one page per topic at /<slug>. Rendered here as plain
// HTML (no client script), from issues the admin has published. Model output is untrusted, so the Markdown
// renderer escapes everything first and only ever emits links to posts on x.com / twitter.com.
import { SLUG } from '../durable-objects/publish';
import { esc, inline, markdown } from './markdown';
import { pageOfFeed } from '../sources/youtube';
export { markdown };
import { serveAudio, serveImage } from '../media/audio-serve';
import type { Provenance } from '../durable-objects/publish';
import type { Stats } from '../history/stats.ts';
import type { Results, Subject, Theme } from '../history/analysis.ts';
import { openrouterModelInfo } from '../summarize/openrouter.ts';
import { aiModelInfo } from '../summarize/workers-ai.ts';

interface Brief { id: string; tldr: string; publishedAt: number; tweets: number; accounts?: number | null }
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
interface Ctx { topics: PubTopic[]; lists: PubXList[]; alists: PubAList[]; flists: PubFList[]; reports: PubReportBrief[] }
const listTotal = (c: Ctx) => c.lists.length + c.alists.length + c.flists.length;
type PubPage = { topic: TopicInfo; issue: IssueFull; archive: Brief[] };

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
figure.bars div{grid-template-columns:6rem 1fr 2.5rem}nav.archive li{grid-template-columns:1fr}}`;

const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#c9265f"/><polyline points="5,17 11,17 14,8 18,24 21,14 23,17 27,17" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The left rail on every public page: the brand, the topics (the one you are in opens its views), and a note.
interface Active { slug: string; title: string; view: 'latest' | 'archive' | 'issue'; earlier: number }
function rail(ctx: Ctx, active?: Active, page?: 'lists' | 'history'): string {
  const list = [...ctx.topics].sort((a, b) => a.title.localeCompare(b.title));
  if (active && !list.some((t) => t.slug === active.slug)) list.push({ slug: active.slug, title: active.title } as PubTopic);   // an unlisted topic, reached by its link
  const items = list.map((t) => {
    const on = active?.slug === t.slug;
    return `<a href="/${esc(t.slug)}"${on ? ' class="on"' : ''}>${esc(t.title)}</a>` + (on ? `<div class="sub"><a href="/${esc(t.slug)}"${active!.view === 'latest' ? ' aria-current="page"' : ''}>Latest briefing</a>
<a href="/${esc(t.slug)}/archive"${active!.view === 'archive' ? ' aria-current="page"' : ''}>Previous days${active!.earlier ? ` <small>${active!.earlier}</small>` : ''}</a></div>` : '');
  }).join('');
  return `<aside class="rail"><a class="brand" href="/">${MARK}<span>Signals<small>Agent Cortex</small></span></a>
<nav aria-label="Topics"><a href="/"${active || page ? '' : ' aria-current="page"'}>Overview</a>${items ? `<div class="grp">Topics</div>${items}` : ''}${listTotal(ctx) || ctx.reports.length || page === 'history' ? '<div class="grp">More</div>' : ''}${ctx.reports.length || page === 'history' ? `<a href="/history"${page === 'history' ? ' aria-current="page"' : ''}>Reports${ctx.reports.length ? ` <small>${ctx.reports.length}</small>` : ''}</a>` : ''}${listTotal(ctx) ? `<a href="/lists"${page === 'lists' ? ' aria-current="page"' : ''}>Lists <small>${listTotal(ctx)}</small></a>` : ''}</nav>
<div class="railfoot">Briefings written by AI from public posts and articles. Every one shows its sources.</div></aside>`;
}

function shell(title: string, railHtml: string, body: string, opts: { description?: string; canonical?: string; image?: string } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${opts.description ? `<meta name="description" content="${esc(opts.description.slice(0, 200))}">` : ''}
<meta property="og:title" content="${esc(title)}">${opts.description ? `<meta property="og:description" content="${esc(opts.description.slice(0, 200))}">` : ''}
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : ''}${opts.image ? `<meta property="og:image" content="${esc(opts.image)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Newsreader:opsz,wght@6..72,400..600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="app">${railHtml}<main class="page">${body}</main></div></body></html>`;
}

const NOTE = '<p class="note">Written by an AI from public posts and articles. It can get things wrong: follow the links to read the originals.</p>';

export function landingHtml(ctx: Ctx): string {
  const topics = ctx.topics;
  const cards = [...topics].sort((a, b) => b.latest.publishedAt - a.latest.publishedAt).map((t) => {
    const facts = [t.latest.tweets ? `${n(t.latest.tweets)} posts` : '', t.latest.accounts ? `${n(t.latest.accounts)} accounts` : ''].filter(Boolean).join(' · ');
    return `<li><a class="card" href="/${esc(t.slug)}"><span class="eyebrow">${every(t.intervalHours)}</span><h2>${esc(t.title)}</h2>${t.description ? `<p>${esc(t.description)}</p>` : ''}
${t.latest.tldr ? `<p class="tldr">${inline(t.latest.tldr)}</p>` : ''}<div class="foot"><span>${facts}</span><span>Updated ${date(t.latest.publishedAt)}</span></div></a></li>`;
  }).join('');
  return shell('Signals · Agent Cortex', rail(ctx), `<header class="pagehead"><div class="eyebrow">${topics.length ? `${topics.length} topic${topics.length === 1 ? '' : 's'}` : 'Briefings'}</div><h1>Signals</h1>
<p class="lede">Short briefings on what is being said online, drawn from X, news and blog feeds, YouTube and Hacker News, and kept up to date.${listTotal(ctx) ? ` <a href="/lists">Browse the ${listTotal(ctx)} lists they draw from &rarr;</a>` : ''}</p></header>
${cards ? `<ul class="topics">${cards}</ul>` : ctx.reports.length ? '' : '<p class="lede">Nothing published yet.</p>'}
${ctx.reports.length ? `<h2 class="sect">Reports</h2><ul class="topics">${reportCards(ctx.reports)}</ul>` : ''}`,
  { description: 'Short briefings on what is being said online, from X, feeds, YouTube and Hacker News, kept up to date.' });
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
  return shell('Reports · Signals', rail(ctx, undefined, 'history'), `<header class="pagehead"><div class="eyebrow">${ctx.reports.length} report${ctx.reports.length === 1 ? '' : 's'}</div><h1>Reports</h1>
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

// The topic page frame: the rail opens this topic's views; on narrow screens the views also show above the content.
function topicPage(topic: TopicInfo, view: 'latest' | 'archive' | 'issue', earlier: number, content: string, head: { title: string; description?: string; canonical?: string; image?: string }, ctx: Ctx): string {
  const cur = (v: string) => (v === view ? ' aria-current="page"' : '');
  return shell(head.title, rail(ctx, { slug: topic.slug, title: topic.title, view, earlier }), `<header class="pagehead"><div class="eyebrow">Updated ${every(topic.intervalHours)}</div><h1>${esc(topic.title)}</h1>${topic.description ? `<p class="lede">${esc(topic.description)}</p>` : ''}</header>
<nav class="views" aria-label="Views"><a href="/${esc(topic.slug)}"${cur('latest')}>Latest briefing</a><a href="/${esc(topic.slug)}/archive"${cur('archive')}>Previous days${earlier ? ` (${earlier})` : ''}</a></nav>
${content}`, head);
}

// The audio version, at the top of a post. The file is served by /audio/<topic>/<day>.mp3 (a published post only).
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
// The picture at the top of a post, made by an image model from the briefing. The file is served by /image/<topic>/<day>.jpg (a published post only).
export const imageHtml = (slug: string, i: IssueFull): string => i.image
  ? `<figure class="hero"><img src="/image/${esc(slug)}/${esc(i.id)}.jpg?v=${i.image.v}" alt="Illustration for this briefing" loading="lazy" decoding="async" style="aspect-ratio:${esc(i.image.aspect.replace(':', '/'))}"><figcaption>AI-generated illustration</figcaption></figure>` : '';
export const listenHtml = (slug: string, i: IssueFull): string => i.audio
  ? `<div class="listen"><span class="lbl">Listen</span><audio controls preload="none" src="/audio/${esc(slug)}/${esc(i.id)}.mp3?v=${i.audio.v}"></audio><span class="dur">${clock(i.audio.seconds)}</span></div>` : '';

const span = (h: number) => (h >= 48 ? Math.round(h / 24) + ' days' : h + ' hours');

export function issueHtml(p: PubPage, origin: string, ctx: Ctx): string {
  const { topic, issue, archive } = p;
  const isLatest = archive[0]?.id === issue.id;
  return topicPage(topic, isLatest ? 'latest' : 'issue', Math.max(0, archive.length - 1), `<p class="meta">${stamp(issue.publishedAt)} · based on ${issue.tweets} ${unit(issue)} from the last ${span(issue.windowHours)}${isLatest ? '' : ` · <a href="/${esc(topic.slug)}">see the latest</a>`}</p>
${imageHtml(topic.slug, issue)}${listenHtml(topic.slug, issue)}<article>${markdown(issue.markdown, issue.links)}</article>${sourcesHtml(issue)}${NOTE}`,
    { title: `${topic.title} · ${date(issue.publishedAt)}`, description: issue.tldr.replace(/\*\*/g, '') || topic.description, canonical: `${origin}/${topic.slug}/${issue.id}`, ...(issue.image ? { image: `${origin}/image/${topic.slug}/${issue.id}.jpg?v=${issue.image.v}` } : {}) }, ctx);
}

export function archiveHtml(p: { topic: TopicInfo; latest: Brief; issues: IssueFull[] }, origin: string, ctx: Ctx): string {
  const { topic, issues } = p;
  const days = issues.map((i) => `<details id="${esc(i.id)}"><summary>${stamp(i.publishedAt)}<span>${i.tldr ? plain(i.tldr) : 'Briefing'}${i.audio ? ` <em class="aud" title="Has an audio version">&#9835; ${clock(i.audio.seconds)}</em>` : ''}</span></summary>
<div class="body"><p class="meta">Based on ${i.tweets} ${unit(i)} from the last ${span(i.windowHours)} · <a href="/${esc(topic.slug)}/${esc(i.id)}">link to this day</a></p>${imageHtml(topic.slug, i)}${listenHtml(topic.slug, i)}<article>${markdown(i.markdown, i.links)}</article>${sourcesHtml(i)}</div></details>`).join('');
  return topicPage(topic, 'archive', issues.length, `<h2 style="margin:0 0 14px;font-size:20px">Previous days</h2>
${days ? `<div class="days">${days}</div>` : '<p class="lede">No earlier briefings yet.</p>'}${issues.length >= 30 ? '<p class="meta" style="margin-top:14px">Showing the last 30 days.</p>' : ''}${NOTE}`,
    { title: `${topic.title} · previous days`, description: topic.description, canonical: `${origin}/${topic.slug}/archive` }, ctx);
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
  return shell('Lists · Signals', rail(ctx, undefined, 'lists'), `<header class="pagehead"><div class="eyebrow">${listTotal(ctx)} lists</div><h1>Lists</h1>
<p class="lede">The sets of accounts and sources that these briefings draw from.</p></header>
${kinds.length > 1 ? `<nav class="chips" aria-label="Kinds of list">${kinds.map((k) => `<a href="#${k.id}">${k.title}</a>`).join('')}</nav>` : ''}${sections}`,
  { description: 'The lists of accounts, feeds and channels that the Signals briefings draw from.' });
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

async function render(env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean);
  const html = (body: string, status = 200) => new Response(body, { status, headers: { ...PUBLIC_HEADERS, ...(status === 200 ? { 'cache-control': 'public, max-age=60' } : NO_STORE) } });
  // The rail on every page needs the topics and the public lists.
  const listsDo = (path: string) => env.LISTS.getByName('main').fetch(new Request('https://internal/lists/' + path)).then((r) => r.json()).catch(() => []);
  const [topics, lists, alists, flists, reports] = await Promise.all([
    publish(env, '/pub/topics').then((r) => r.json() as Promise<PubTopic[]>),
    listsDo('x-public') as Promise<PubXList[]>, listsDo('a-public') as Promise<PubAList[]>, listsDo('f-public') as Promise<PubFList[]>,
    env.HISTORY.getByName('main').fetch(new Request('https://internal/hist/pub-reports')).then((r) => r.json() as Promise<PubReportBrief[]>).catch(() => [] as PubReportBrief[]),
  ]);
  const ctx: Ctx = { topics, lists, alists, flists, reports };
  const missing = () => html(notFoundHtml(ctx), 404);

  if (parts.length === 0) return html(landingHtml(ctx));
  if (parts.length === 1 && parts[0] === 'lists') return listTotal(ctx) ? html(listsHtml(ctx)) : missing();
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
  if (parts.length > 2 || !SLUG.test(parts[0]) || (parts[1] && parts[1] !== 'archive' && !ISSUE_ID.test(parts[1]))) return missing();
  if (parts[1] === 'archive') {
    const r = await publish(env, `/pub/archive?slug=${parts[0]}`);
    if (!r.ok) { await r.body?.cancel(); return missing(); }
    return html(archiveHtml((await r.json()) as Parameters<typeof archiveHtml>[0], url.origin, ctx));
  }
  const res = await publish(env, parts[1] ? `/pub/issue?slug=${parts[0]}&id=${parts[1]}` : `/pub/topic?slug=${parts[0]}`);
  if (!res.ok) { await res.body?.cancel(); return missing(); }
  return html(issueHtml((await res.json()) as PubPage, url.origin, ctx));
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
