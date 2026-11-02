// What the Tweet Galaxy view (src/apps/galaxy.ts) draws: one compact row per tweet, read a page at a time, plus a summary for the model.
// No Worker APIs, so Node can test it (the query too, against node:sqlite). The Durable Object (durable-objects/history.ts) runs the query.
import { epochOf } from './stats.ts';
import { KINDS } from './analysis.ts';
import type { Results, Subject, Theme } from './analysis.ts';

/** More particles than this would not read better and would be slow to send; the most liked ones are kept. */
export const MAX_GALAXY_POINTS = 6000;
export const GALAXY_PAGE = 1000;
const TEXT_MAX = 280;

/** Most liked first, so a capped galaxy keeps the brightest tweets and paging is stable. Reads `tweets` because `tweet_index` exists only for published reports. */
export const GALAXY_PAGE_SQL = `SELECT t.id, t.json, l.theme, l.kind, l.stance FROM tweets t LEFT JOIN labels l ON l.job = t.job AND l.id = t.id
  WHERE t.job = ? ORDER BY COALESCE(json_extract(t.json, '$.likeCount'), 0) DESC, t.id LIMIT ? OFFSET ?`;

export interface GalaxyRow { id: string; json: string; theme: number | null; kind: number | null; stance: string | null; [k: string]: SqlStorageValue }
/** [id, posted (epoch seconds, 0 if unknown), likes, theme (-1 not labelled, themes.length is "Other"), kind, stance (one of + - 0 . per subject), handle, text] */
export type GalaxyPoint = [string, number, number, number, number, string, string, string];

const cleanText = (s: string): string => {
  const t = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > TEXT_MAX ? t.slice(0, TEXT_MAX - 1) + '…' : t;
};

export function galaxyPoint(row: GalaxyRow, themeCount: number): GalaxyPoint {
  const t = JSON.parse(row.json) as { createdAt?: string; likeCount?: number; text?: string; author?: { userName?: string } };
  const ts = epochOf({ createdAt: t.createdAt ?? '' });
  // Negative themes are the analysis's own "still waiting" states, and those tweets have no label yet.
  const theme = row.theme === null || row.theme < 0 ? -1 : Math.min(row.theme, themeCount);
  return [row.id, Number.isFinite(ts) ? ts : 0, t.likeCount ?? 0, theme, theme < 0 ? KINDS.length - 1 : row.kind ?? KINDS.length - 1, theme < 0 ? '' : row.stance ?? '', t.author?.userName ?? '', cleanText(t.text ?? '')];
}

export interface GalaxyJob { id: string; query: string; tweets: number; fromTs: number; toTs: number; report?: { title?: string } }
export interface GalaxyAnalysis { config: { themes: Theme[]; subjects: Subject[] }; results?: Results }

const shortQuery = (q: string): string => (q.length > 60 ? q.slice(0, 59) + '…' : q);

/** The collection's summary: the tool's answer for the model, and what the view needs to name the themes, kinds and subjects. Counts come from the finished analysis. */
export function galaxyMeta(job: GalaxyJob, analysis: GalaxyAnalysis | null | undefined, jobs: Array<GalaxyJob & { analysed: boolean }>) {
  const r = analysis?.results, c = analysis?.config;
  return {
    id: job.id, title: job.report?.title || shortQuery(job.query), query: shortQuery(job.query), fromTs: job.fromTs, toTs: job.toTs,
    tweets: job.tweets, shown: Math.min(job.tweets, MAX_GALAXY_POINTS), analysed: !!r,
    themes: r && c ? [...c.themes, { name: 'Other', description: 'None of the themes above' }].map((t, i) => ({ name: t.name, description: t.description, count: r.themes[i]?.count ?? 0, likes: r.themes[i]?.likes ?? 0, top: r.themes[i]?.top ?? [] })) : [],
    kinds: KINDS,
    subjects: r && c ? c.subjects.map((s, i) => ({ name: s.name, description: s.description, for: r.subjects[i]?.for ?? 0, against: r.subjects[i]?.against ?? 0, neutral: r.subjects[i]?.neutral ?? 0, none: r.subjects[i]?.none ?? 0 })) : [],
    jobs: jobs.map((j) => ({ id: j.id, title: j.report?.title || shortQuery(j.query), tweets: j.tweets, analysed: j.analysed })),
  };
}
