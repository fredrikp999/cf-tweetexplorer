// Screens the tweets before a summary or briefing is written, with an OpenRouter decision model (decisions.ts): off-topic tweets, spam and
// empty reactions are dropped, and every tweet that stays gets a `signal` (0 to 100) the writer can use to pick what to feature. The decision
// model costs about $0.01 to $0.02 per million tokens, so screening 150 tweets is a few hundredths of a cent, and it lets the writing model read
// fewer tweets. Screening never makes a summary fail: when it cannot run, the tweets go on unscreened.
import { decide, decideAll, DECIDER_MODELS, decidersReady, deciderInfo, probOf } from '../llm/decisions.ts';
import type { Question } from '../llm/decisions.ts';
import type { CompactTweet } from './tweets.ts';

export interface ScreenResult { tweets: CompactTweet[]; dropped: number; scored: number; cost: number; tokensIn: number; model: string }

const MIN_TWEETS = 25;        // below this there is nothing worth screening
const MIN_KEEP = 20;          // never screen a briefing down to less than this (or all of them, if fewer)
const OFF_TOPIC = 0.15, JUNK = 0.85, CONCURRENCY = 10, BUDGET_MS = 25_000;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** The model that screens, or null when screening is off. `SUMMARY_SCREEN_MODEL`: unset = Decider Flash when OpenRouter is available, `off` = never, or a Decider id. */
export function screenModel(env: Env): string | null {
  const v = ((env as { SUMMARY_SCREEN_MODEL?: string }).SUMMARY_SCREEN_MODEL ?? '').trim();
  if (v === 'off' || !decidersReady(env)) return null;
  return deciderInfo(v) ? v : DECIDER_MODELS[0].id;
}

/** `topic`: what the summary is about (the instruction). Without a real one, only usefulness and spam are judged, not relevance. */
export function questionsFor(topic: string | undefined): Record<string, Question> {
  const t = (topic ?? '').replace(/\s+/g, ' ').trim();
  return {
    ...(t.length >= 15 ? { relevant: { type: 'noul', instructions: `Is this tweet relevant to this briefing: "${clip(t, 400)}"? Answer yes if it is about that subject, no if it is about something else.` } as Question } : {}),
    useful: { type: 'noul', instructions: 'Does this tweet carry real information: news, data, a substantive argument, or a first-hand account? Answer no for jokes, greetings, reactions, and plain promotion.' },
    junk: { type: 'noul', instructions: 'Is this tweet spam, an advertisement, a giveaway, or a reaction with no content of its own?' },
  };
}

/** The decision for one tweet from its three probabilities: a signal 0 to 100, and whether to drop it. A missing answer never drops a tweet. */
export function judge(p: { relevant: number | null; useful: number | null; junk: number | null }): { signal: number | null; drop: boolean } {
  const { relevant, useful, junk } = p;
  if (useful === null && relevant === null && junk === null) return { signal: null, drop: false };
  const base = (useful ?? 0.5) * (1 - (junk ?? 0)), mixed = relevant === null ? base : 0.5 * relevant + 0.5 * base;
  return { signal: Math.round(100 * mixed), drop: (relevant !== null && relevant < OFF_TOPIC) || (junk !== null && junk > JUNK) };
}

export async function screenTweets(env: Env, tweets: CompactTweet[], topic?: string): Promise<ScreenResult | null> {
  const model = screenModel(env);
  if (!model || tweets.length < MIN_TWEETS) return null;
  const questions = questionsFor(topic), began = Date.now();
  const mock = (t: CompactTweet) => () => {       // dev only (SUMMARY_MOCK=1): a spread of answers from the tweet id
    const h = Number(BigInt(/^\d+$/.test(t.id) ? t.id : '7') % 100n) / 100;
    return { relevant: { type: 'noul' as const, noul: h }, useful: { type: 'noul' as const, noul: 1 - h / 2 }, junk: { type: 'noul' as const, noul: h > 0.9 ? 0.95 : 0.05 } };
  };
  const out = await decideAll(tweets, CONCURRENCY, (t) => decide(env, model, { tweet: clip(t.text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim() || '(no text)', 600) }, questions, { mock: mock(t) }),
    () => Date.now() - began > BUDGET_MS);
  const verdicts = tweets.map((t, i) => {
    const d = out[i];
    if (!d) return { t, signal: null as number | null, drop: false };
    return { t, ...judge({ relevant: probOf(d.answers.relevant), useful: probOf(d.answers.useful), junk: probOf(d.answers.junk) }) };
  });
  const scored = verdicts.filter((v) => v.signal !== null).length;
  if (!scored) return null;
  // Keep a floor of tweets: if the screen would leave fewer than MIN_KEEP, bring back the highest-signal dropped ones.
  const keepAtLeast = Math.min(MIN_KEEP, tweets.length);
  let dropSet = new Set(verdicts.filter((v) => v.drop).map((v) => v.t.id));
  if (tweets.length - dropSet.size < keepAtLeast) {
    const back = verdicts.filter((v) => v.drop).sort((a, b) => (b.signal ?? 0) - (a.signal ?? 0)).slice(0, keepAtLeast - (tweets.length - dropSet.size));
    dropSet = new Set([...dropSet].filter((id) => !back.some((v) => v.t.id === id)));
  }
  const kept = verdicts.filter((v) => !dropSet.has(v.t.id)).map((v) => (v.signal === null ? v.t : { ...v.t, signal: v.signal }));
  return { tweets: kept, dropped: dropSet.size, scored, cost: out.reduce((n, d) => n + (d?.cost ?? 0), 0), tokensIn: out.reduce((n, d) => n + (d?.tokensIn ?? 0), 0), model };
}
