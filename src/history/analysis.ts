// The pure parts of the History analysis: prompts, parsing and checking what a model returns, estimates and aggregation.
// No Worker APIs, so Node can test them. The Durable Object (durable-objects/history.ts) does the storage and the model calls.
import { epochOf, pickStep } from './stats.ts';
import type { StatTweet } from './stats.ts';
import type { Answer, Question } from '../llm/decisions.ts';

export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }

/** Pulls the first JSON object or array out of a model's answer (it may wrap it in a code fence or add a sentence). */
export function parseJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = t.indexOf(open), b = t.lastIndexOf(close);
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* try the other kind */ } }
  }
  throw new Error('the model did not return valid JSON');
}

export const KINDS = ['news', 'opinion', 'announcement', 'question', 'promo', 'humor', 'spam', 'other'] as const;
const KIND_HELP = ['reports facts or links to an article', 'a personal view or argument', 'an organisation or person announcing their own work', 'asks something', 'advertising, self-promotion, giveaways', 'a joke or meme', 'bot-like, repeated or irrelevant', 'none of these'];
export interface Theme { name: string; description: string }
export interface Subject { name: string; description: string }
/** Stance toward a subject: 1 for, -1 against, 0 neutral or mixed, null not about it. */
export type Stance = 1 | -1 | 0 | null;
export interface Label { theme: number; kind: number; stance: Stance[]; unsure: boolean }     // theme === themes.length means "other"
export const BATCH = 40;                 // tweets per cheap call
export const STRONG_BATCH = 25;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s: string) => s.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();

/** What makes two tweets the same for labelling: the text without links, mentions and punctuation. Duplicates are labelled once. */
export const normKey = (text: string): string => text.toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/@\w+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 240);
/** Too short to say anything: a link, an emoji, a reaction. These get the "other" label without a model call. */
export const isTrivial = (key: string): boolean => key.length < 12;

// ---- clean up what the user or a model gives as themes and subjects
const cleanItems = (raw: unknown, max: number): Array<{ name: string; description: string }> => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), out: Array<{ name: string; description: string }> = [];
  for (const r of raw) {
    const name = oneLine(String((r as { name?: unknown })?.name ?? '')).replace(/[|:]/g, ' ').trim().slice(0, 60), key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key); out.push({ name, description: oneLine(String((r as { description?: unknown })?.description ?? '')).slice(0, 200) });
    if (out.length >= max) break;
  }
  return out;
};
export const cleanThemes = (raw: unknown): Theme[] => cleanItems(raw, 12);
export const cleanSubjects = (raw: unknown): Subject[] => cleanItems(raw, 6);
/** Textarea lines "Name: description" -> items. */
export const parseLines = (text: string): Array<{ name: string; description: string }> =>
  String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(':'); return i > 0 ? { name: l.slice(0, i).trim(), description: l.slice(i + 1).trim() } : { name: l, description: '' }; });

// ---- labelling
export function labelSystem(themes: Theme[], subjects: Subject[]): Msg {
  const t = [...themes.map((x, i) => `${i} ${x.name}${x.description ? ': ' + x.description : ''}`), `${themes.length} Other: none of the above`].join('\n');
  const s = subjects.length ? subjects.map((x, i) => `${i} ${x.name}${x.description ? ': ' + x.description : ''}`).join('\n') : '(none)';
  return { role: 'system', content: `You label tweets for a research analysis. For EACH numbered tweet return one entry.
Themes (pick the single best fit, by number):
${t}
Kinds: ${KINDS.map((k, i) => `${i} ${k} (${KIND_HELP[i]})`).join('; ')}.
Subjects, with the tweet's stance toward each: ${subjects.length ? '' : 'no subjects, so use an empty list'}
${s}
Stance: 1 = supportive, -1 = critical or against, 0 = neutral or mixed, null = the tweet is not about that subject.
Answer with JSON only, no other text: {"labels":[{"i":1,"t":0,"k":1,"s":[1,null],"u":0}]} where i is the tweet number, t the theme number, k the kind number, s one stance per subject in order, and u is 1 only if you are genuinely unsure about the theme or a stance.` };
}
export const labelUser = (texts: string[]): Msg => ({ role: 'user', content: texts.map((t, i) => `${i + 1}. ${clip(oneLine(t) || '(no text)', 280)}`).join('\n') });

// The same labelling for a decision model (decisions.ts): one request per tweet, with a choice question for the theme, one for the kind and one
// per subject. Answers are typed, so there is no JSON to parse and nothing to get wrong but the choice itself.
export const decisionState = (text: string) => ({ tweet: clip(oneLine(text) || '(no text)', 600) });
export function decisionQuestions(themes: Theme[], subjects: Subject[]): Record<string, Question> {
  const q: Record<string, Question> = {
    theme: { type: 'choice', instructions: 'Which theme does this tweet belong to? Pick the single best fit.',
      criteria: Object.fromEntries([...themes.map((t, i) => [`t${i}`, `${t.name}${t.description ? ': ' + t.description : ''}`]), [`t${themes.length}`, 'Other: none of the other themes']]) },
    kind: { type: 'choice', instructions: 'What kind of tweet is this?', criteria: Object.fromEntries(KINDS.map((k, i) => [k, KIND_HELP[i]])) },
  };
  subjects.forEach((s, j) => {
    q[`s${j}`] = { type: 'choice', instructions: `What is this tweet's stance toward ${s.name}${s.description ? ' (' + s.description + ')' : ''}?`,
      criteria: { for: `supportive of ${s.name}`, against: `critical of or against ${s.name}`, neutral: `about ${s.name} but neutral or mixed`, none: `not about ${s.name}` } };
  });
  return q;
}
/** A Label from a decision model's answers, or null when the theme or kind answer is missing or not one on offer. `unsure`: it says it is under 50% confident of the theme. */
export function parseDecision(answers: Record<string, Answer>, themes: number, subjects: number): Label | null {
  const th = answers.theme, kd = answers.kind;
  if (th?.type !== 'choice' || kd?.type !== 'choice') return null;
  const t = /^t(\d+)$/.exec(th.choice), theme = t ? Number(t[1]) : -1, kind = (KINDS as readonly string[]).indexOf(kd.choice);
  if (theme < 0 || theme > themes || kind < 0) return null;
  const stance = Array.from({ length: subjects }, (_, j): Stance => {
    const a = answers[`s${j}`], v = a?.type === 'choice' ? a.choice : '';
    return v === 'for' ? 1 : v === 'against' ? -1 : v === 'neutral' ? 0 : null;
  });
  const top = th.probabilities ? Math.max(...Object.values(th.probabilities).filter((x) => Number.isFinite(x)), 0) : null;
  const sure = typeof th.confidence === 'number' ? th.confidence : top;
  return { theme, kind, stance, unsure: sure !== null && sure > 0 && sure < 0.5 };
}

/** Checks a model's labels. Returns the valid ones by 0-based position in the batch; anything missing or malformed is simply absent. */
export function parseLabels(obj: unknown, n: number, themes: number, subjects: number): Map<number, Label> {
  const out = new Map<number, Label>();
  const list = Array.isArray(obj) ? obj : (obj as { labels?: unknown })?.labels;
  if (!Array.isArray(list)) return out;
  for (const e of list as Array<Record<string, unknown>>) {
    const i = Number(e?.i) - 1, t = Number(e?.t), k = Number(e?.k);
    if (!Number.isInteger(i) || i < 0 || i >= n || out.has(i)) continue;
    if (!Number.isInteger(t) || t < 0 || t > themes || !Number.isInteger(k) || k < 0 || k >= KINDS.length) continue;
    const raw = Array.isArray(e.s) ? e.s : [];
    const stance = Array.from({ length: subjects }, (_, j): Stance => { const v = raw[j]; return v === 1 || v === '1' ? 1 : v === -1 || v === '-1' ? -1 : v === 0 || v === '0' ? 0 : null; });
    out.set(i, { theme: t, kind: k, stance, unsure: e.u === 1 || e.u === true || e.u === '1' });
  }
  return out;
}
export const packStance = (s: Stance[]): string => s.map((v) => (v === 1 ? '+' : v === -1 ? '-' : v === 0 ? '0' : '.')).join('');
export const unpackStance = (s: string): Stance[] => [...s].map((c): Stance => (c === '+' ? 1 : c === '-' ? -1 : c === '0' ? 0 : null));

// ---- proposing themes and subjects from a sample
export function proposeMessages(query: string, period: string, sample: Array<{ handle: string; text: string; likes: number }>): Msg[] {
  return [{ role: 'system', content: `You are helping set up an analysis of a collection of tweets. From the sample, propose:
- "themes": 6 to 10 mutually distinct topics the tweets fall into, each with a short name (2 to 4 words) and a one-sentence description that says what belongs there.
- "subjects": 3 to 6 specific named things (a person, party, company, product, policy or event) that people clearly take sides on, each with a short name and a one-sentence description. Only things that appear in the sample.
Write names in English, keeping proper nouns as they appear. Answer with JSON only: {"themes":[{"name":"","description":""}],"subjects":[{"name":"","description":""}]}` },
  { role: 'user', content: `The tweets were collected with the search "${query}" over ${period}. A sample (most liked and random), with likes:\n${sample.map((t, i) => `${i + 1}. @${t.handle} (${t.likes}) ${clip(oneLine(t.text), 240)}`).join('\n')}` }];
}
export function parseProposal(obj: unknown): { themes: Theme[]; subjects: Subject[] } {
  const o = (obj ?? {}) as { themes?: unknown; subjects?: unknown };
  const themes = cleanThemes(o.themes), subjects = cleanSubjects(o.subjects);
  if (!themes.length) throw new Error('the model proposed no themes');
  return { themes, subjects };
}

// ---- estimate, before anything is spent
export interface EstimateIn { texts: number; avgChars: number; themes: number; subjects: number; escalate: number }
/** Tokens for the labelling calls. Output counts double because some models think before they answer. */
export function labelTokens(e: { texts: number; avgChars: number; themes: number; subjects: number }, batch: number): { calls: number; tokensIn: number; tokensOut: number } {
  const calls = Math.ceil(e.texts / batch), system = 320 + 22 * (e.themes + e.subjects);
  return { calls, tokensIn: calls * system + e.texts * (Math.ceil(Math.min(e.avgChars, 280) / 3.2) + 8), tokensOut: Math.round(2 * e.texts * (20 + 5 * e.subjects)) };
}

// ---- results
export interface TopTweet { id: string; handle: string; text: string; likes: number; url: string }
export interface Results {
  total: number; labelled: number; unlabelled: number; stepSec: number; startTs: number; steps: number;
  themes: Array<{ name: string; count: number; likes: number; perStep: number[]; top: TopTweet[] }>;     // the last entry is "Other"
  kinds: Array<{ name: string; count: number }>;
  subjects: Array<{ name: string; for: number; against: number; neutral: number; none: number; perStep: { for: number[]; against: number[]; neutral: number[] }; top: { for?: TopTweet; against?: TopTweet } }>;
}
export interface Labelled { tweet: StatTweet & { url?: string }; label: Label | null }

/** One pass over the labelled tweets. `label` null = never labelled (sampled out, or the model never answered). */
export function aggregate(items: Iterable<Labelled>, themes: Theme[], subjects: Subject[], range: { fromTs: number; toTs: number }): Results {
  const stepSec = pickStep(Math.max(1, range.toTs - range.fromTs)), startTs = Math.floor(range.fromTs / stepSec) * stepSec, steps = Math.min(2000, Math.ceil((range.toTs - startTs) / stepSec));
  const zeros = () => Array(steps).fill(0) as number[];
  const r: Results = { total: 0, labelled: 0, unlabelled: 0, stepSec, startTs, steps,
    themes: [...themes.map((t) => t.name), 'Other'].map((name) => ({ name, count: 0, likes: 0, perStep: zeros(), top: [] })),
    kinds: KINDS.map((name) => ({ name, count: 0 })),
    subjects: subjects.map((s) => ({ name: s.name, for: 0, against: 0, neutral: 0, none: 0, perStep: { for: zeros(), against: zeros(), neutral: zeros() }, top: {} })) };
  const top = (t: Labelled['tweet']): TopTweet => ({ id: t.id, handle: t.author?.userName ?? '', text: clip(oneLine(t.text ?? ''), 200), likes: t.likeCount ?? 0,
    url: /^https:\/\/(x|twitter)\.com\//.test(t.url ?? '') ? String(t.url) : t.author?.userName ? `https://x.com/${t.author.userName}/status/${t.id}` : '' });
  for (const { tweet, label } of items) {
    r.total++;
    if (!label) { r.unlabelled++; continue; }
    r.labelled++;
    const likes = tweet.likeCount ?? 0, b = Math.floor((epochOf(tweet) - startTs) / stepSec), inRange = b >= 0 && b < steps;
    const th = r.themes[Math.min(label.theme, themes.length)];
    th.count++; th.likes += likes; if (inRange) th.perStep[b]++;
    if (th.top.length < 3 || likes > th.top[th.top.length - 1].likes) { th.top.push(top(tweet)); th.top.sort((x, y) => y.likes - x.likes); th.top.length = Math.min(3, th.top.length); }
    r.kinds[label.kind].count++;
    subjects.forEach((_, j) => {
      const s = r.subjects[j], v = label.stance[j] ?? null;
      if (v === null) { s.none++; return; }
      const key = v === 1 ? 'for' : v === -1 ? 'against' : 'neutral';
      s[key]++; if (inRange) s.perStep[key][b]++;
      if (key !== 'neutral' && (!s.top[key] || likes > s.top[key]!.likes)) s.top[key] = top(tweet);
    });
  }
  return r;
}

// ---- the narrative: written once, from the numbers and a few top tweets, by the stronger model
export function narrativeMessages(query: string, period: string, themes: Theme[], subjects: Subject[], r: Results, topAccounts: string[]): Msg[] {
  const day = (i: number) => new Date((r.startTs + i * r.stepSec) * 1000).toISOString().slice(0, 10);
  const totalPerStep = Array.from({ length: r.steps }, (_, i) => r.themes.reduce((n, t) => n + t.perStep[i], 0));
  const peaks = totalPerStep.map((n, i) => [n, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 4).filter((p) => p[0] > 0).map(([n, i]) => `${day(i)} (${n} tweets)`);
  const share = (n: number) => (r.labelled ? Math.round((100 * n) / r.labelled) + '%' : '0%');
  const half = (a: number[]) => [a.slice(0, a.length >> 1).reduce((x, y) => x + y, 0), a.slice(a.length >> 1).reduce((x, y) => x + y, 0)];
  const data = [
    `Search: "${query}", ${period}. ${r.labelled} tweets analysed${r.unlabelled ? ` (${r.unlabelled} more not labelled)` : ''}. Busiest ${r.stepSec >= 86_400 ? 'days' : 'periods'}: ${peaks.join(', ') || 'n/a'}.`,
    `THEMES (share, then busiest period and best-liked tweets):`,
    ...r.themes.filter((t) => t.count).map((t) => { const pk = t.perStep.indexOf(Math.max(...t.perStep)); return `- ${t.name}: ${share(t.count)}, ${t.count} tweets, peak ${day(Math.max(0, pk))}${themes.find((x) => x.name === t.name)?.description ? `. ${themes.find((x) => x.name === t.name)!.description}` : ''}\n${t.top.map((x) => `    * @${x.handle} (${x.likes} likes) "${x.text}" ${x.url}`).join('\n')}`; }),
    subjects.length ? `STANCE TOWARD SUBJECTS (tweets that take a side; first half of the period vs second half):` : '',
    ...r.subjects.map((s) => { const [f1, f2] = half(s.perStep.for), [a1, a2] = half(s.perStep.against);
      return `- ${s.name}: ${s.for} for, ${s.against} against, ${s.neutral} neutral, ${s.none} not about it. For ${f1} then ${f2}; against ${a1} then ${a2}.${s.top.for ? `\n    * for: @${s.top.for.handle} "${s.top.for.text}" ${s.top.for.url}` : ''}${s.top.against ? `\n    * against: @${s.top.against.handle} "${s.top.against.text}" ${s.top.against.url}` : ''}`; }),
    `KINDS: ${r.kinds.filter((k) => k.count).map((k) => `${k.name} ${share(k.count)}`).join(', ')}.`,
    topAccounts.length ? `MOST ACTIVE ACCOUNTS: ${topAccounts.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: `You write the analysis text for a report on a collection of tweets, for readers who have not seen the data. Use ONLY the facts and numbers given; do not invent anything and do not say what you cannot see. Write clear, neutral English in Markdown with these sections:
## Summary (3 to 5 sentences: what the conversation was about and how it moved)
## Storylines (one short paragraph per major theme, with the share; cite a supporting tweet as a Markdown link like [@handle](url) using the URLs given)
## Timeline (bullets: dates and what drove the busiest periods, only where the data supports it)
## Where people disagree (only if subjects are given: for each, the balance of for and against, whether it shifted, and a cited tweet from each side)
## Caveats (2 to 3 sentences: labels were made by an AI model, the sample, what a search on X does not capture)
Keep it under 450 words.` }, { role: 'user', content: data }];
}
