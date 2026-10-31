// Validates the browser's request. Everything here is untrusted input, so it is reduced to known, bounded fields.
import type { Length, SourceSpec, SummaryRequest } from './agent.ts';
import { cleanClientTweets } from './tweets.ts';

// Long enough for a detailed brief (about 2,000 words); the box in /admin and the Summarize tab allow the same.
export const INSTRUCTION_MAX = 8000;
const clamp = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.floor(Number(v)) || d));

export function parseRequest(raw: unknown): SummaryRequest {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const length: Length = b.length === 'brief' || b.length === 'detailed' ? b.length : 'standard';
  const instruction = typeof b.instruction === 'string' ? b.instruction.trim().slice(0, INSTRUCTION_MAX) : '';
  const tweets = cleanClientTweets(b.tweets);
  let source: SourceSpec | undefined;
  const s = (b.source && typeof b.source === 'object' ? b.source : undefined) as Record<string, unknown> | undefined;
  if (s?.type === 'list') {
    if (typeof s.listId !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(s.listId)) throw new Error('pick a list');
    source = { type: 'list', listId: s.listId, hours: clamp(s.hours, 1, 720, 168) };
  } else if (s?.type === 'flist') {
    if (typeof s.listId !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(s.listId)) throw new Error('pick a feed list');
    source = { type: 'flist', listId: s.listId, hours: clamp(s.hours, 1, 720, 168) };
  } else if (s?.type === 'search') {
    const query = typeof s.query === 'string' ? s.query.trim().slice(0, 400) : '';
    if (!query) throw new Error('enter a search');
    source = { type: 'search', query, sort: s.sort === 'Top' ? 'Top' : 'Latest', pages: clamp(s.pages, 1, 5, 2) };
  } else if (s?.type === 'xlist') {
    const ids = (Array.isArray(s.listIds) ? s.listIds : []).map(String).filter((id) => /^\d{1,25}$/.test(id)).slice(0, 20);
    if (!ids.length) throw new Error('pick an X list');
    source = { type: 'xlist', listIds: ids, hours: clamp(s.hours, 1, 720, 24), pages: clamp(s.pages, 1, 5, 2), mode: s.mode === 'latest' ? 'latest' : 'best', minFaves: Math.min(1000, Math.max(0, Math.floor(Number(s.minFaves)) || (s.minFaves === 0 ? 0 : 5))) };
  } else if (s?.type === 'feed') {
    source = { type: 'feed', limit: clamp(s.limit, 1, 200, 100), ...(typeof s.watch === 'string' && s.watch ? { watch: s.watch.slice(0, 60) } : {}), ...(s.source === 'x' || s.source === 'rss' || s.source === 'hn' || s.source === 'youtube' ? { source: s.source } : {}) };
  } else if (s?.type === 'free') source = { type: 'free' };
  if (!tweets.length && !source && !instruction) throw new Error('nothing to summarize: pick a source or describe what you want');
  const model = typeof b.model === 'string' && /^[\w@./:-]{1,120}$/.test(b.model) ? b.model : undefined;
  return { instruction, length, tweets: tweets.length ? tweets : undefined, source, model };
}
