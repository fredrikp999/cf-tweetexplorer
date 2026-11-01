// Signal topics written by a language model: each new item is read once and given one to three specific topic names ("kimi k2", "scribd breach"),
// which are counted like words are. Pure functions (no Worker APIs), so Node can test them. The Monitor Durable Object does the queue and the calls.
import { parseJson } from '../history/analysis.ts';
import type { Msg } from '../history/analysis.ts';
import { isGenericWord } from './terms.ts';

export const AI_BATCH = 40;
const MAX_TOPICS = 3;
// Categories, not topics: a model sometimes gives them anyway.
export const VAGUE = new Set('ai a.i artificial-intelligence tech technology data software internet online computer computers science business market markets economy politics sports entertainment gaming machine-learning ml openai google anthropic claude chatgpt gpt llm llms microsoft nvidia apple meta amazon agent agents'.split(' '));

export function topicSystem(known: string[] = []): Msg {
  return { role: 'system', content: `You name the topics of headlines and posts, for a tool that shows what is being talked about.
For EACH numbered item give up to ${MAX_TOPICS} topics it is about. Each topic is a short lowercase name of one to four words, as people would search for it.
Rules:
- Name the STORY or event, not just the big name in it: "claude code backdoor", "openai device leak", "us chip export ban", "scribd breach", "rust 2.0 release". What happened, to what.
- Never give a bare name that is in the news every day: "openai", "google", "anthropic", "claude", "chatgpt", "gpt", "llm", "llms", "microsoft", "nvidia", "apple", "meta", "amazon", "ai agents". Add what is going on ("google ai overviews"). A bare name is fine only for a small or new thing ("kimi k2", "n8n", "bbrouter").
- Use the same name for the same story every time, and the most common short wording.
- Never give generic words or categories such as "ai", "news", "video", "tech", "update", "world", "model", "tutorial", "review", "guide".
- If an item is only a tutorial, listicle or opinion with no specific story, give an empty list.
- Singular, not plural ("game", not "games"); no sentences.${known.length ? `
- Names already in use. When an item is about one of these stories, use exactly that name; only invent a new name for a story not on the list: ${known.slice(0, 60).join('; ')}.` : ''}
Answer with JSON only, no other text: {"items":[{"i":1,"t":["kimi k2","moonshot"]},{"i":2,"t":[]}]} where i is the item number.` };
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const topicUser = (texts: string[]): Msg => ({ role: 'user', content: texts.map((t, i) => `${i + 1}. ${clip(t.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim() || '(no text)', 280)}`).join('\n') });

/** A model's topic, made safe and comparable: lowercase, letters, digits and a few joiners, one to four words. Null when nothing usable is left. */
export function normTopic(raw: unknown): string | null {
  let t = String(raw ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}.+#'’ -]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^[-.'’ ]+|[-.'’ ]+$/g, '');
  const words = t.split(' ').filter(Boolean);
  const last = words.length - 1;   // "llms" and "llm" are one thing: a plural s comes off the last word (not "ss", "us", "is", "os", "as", "es", "ics")
  if (words[last] && words[last].length >= 4 && words[last].length <= 8 && /^[a-z]+s$/.test(words[last]) && !/(ss|us|is|os|as|es|ics)$/.test(words[last])) { words[last] = words[last].slice(0, -1); t = words.join(' '); }
  if (!words.length || words.length > 4 || t.length < 2 || t.length > 40) return null;
  if (words.length === 1 && (isGenericWord(t) || VAGUE.has(t) || /^\p{N}+$/u.test(t))) return null;
  return t;
}

/** The topics per item (0-based position in the batch) from a model's answer. Items it left out, or answered badly, are absent. */
export function parseTopics(text: string, n: number): Map<number, string[]> {
  const out = new Map<number, string[]>();
  let obj: unknown;
  try { obj = parseJson(text); } catch { return out; }
  const list = Array.isArray(obj) ? obj : (obj as { items?: unknown })?.items;
  if (!Array.isArray(list)) return out;
  for (const e of list as Array<Record<string, unknown>>) {
    const i = Number(e?.i) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= n || out.has(i)) continue;
    const raw = Array.isArray(e.t) ? e.t : Array.isArray(e.topics) ? e.topics : [];
    out.set(i, [...new Set(raw.map(normTopic).filter((x): x is string => !!x))].slice(0, MAX_TOPICS));
  }
  return out;
}

/** What one thousand items cost with a model priced per million tokens: about 75 tokens in per item (plus the instructions once per batch) and 25 out. */
export const estimatePer1000 = (inPrice: number, outPrice: number): number => ((1000 * 75 + (1000 / AI_BATCH) * 330) * inPrice + 1000 * 25 * outPrice) / 1e6;
