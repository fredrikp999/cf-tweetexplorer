// OpenRouter "decision" models (Perplexity Decider and Decider Flash). They do not write text: you send a `state` (here a tweet) and typed
// questions, and get typed answers back. A choice question names the best option, a noul question gives the probability of yes. They are
// served on their own endpoint (/api/v1/systemone), not chat completions, and cost a fraction of a cent per thousand tweets.
import { mapPool } from '../lib/pool.ts';

export interface DeciderInfo { id: string; label: string; inPrice: number; outPrice: number; note: string }
/** USD per million input tokens (output is free). The `~` ids are OpenRouter aliases that follow the newest version. */
export const DECIDER_MODELS: DeciderInfo[] = [
  { id: '~perplexity/pplx-decider-flash-latest', label: 'Perplexity Decider Flash', inPrice: 0.01, outPrice: 0, note: 'Classifier, no text. Cheapest' },
  { id: '~perplexity/pplx-decider-latest', label: 'Perplexity Decider', inPrice: 0.02, outPrice: 0, note: 'Classifier, no text. More accurate' },
];
export const deciderInfo = (id: string | undefined): DeciderInfo | undefined => DECIDER_MODELS.find((m) => m.id === id);
export const isDecider = (id: string | undefined): boolean => !!deciderInfo(id);

export type Question =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };
export type Answer = { type: 'noul'; noul: number } | { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> } | { type: 'score'; score: number };
export interface Decision { answers: Record<string, Answer>; tokensIn: number; cost: number }

const hasMock = (env: Env) => (env as { SUMMARY_MOCK?: string }).SUMMARY_MOCK === '1';
export const decidersReady = (env: Env): boolean => !!(env as { OPENROUTER_API_KEY?: string }).OPENROUTER_API_KEY || hasMock(env);

/** One decision. `mock` (dev only, SUMMARY_MOCK=1) supplies scripted answers instead of calling the model. */
export async function decide(env: Env, model: string, state: unknown, questions: Record<string, Question>, opts: { mock?: () => Record<string, Answer>; signal?: AbortSignal } = {}): Promise<Decision> {
  const price = deciderInfo(model)?.inPrice ?? 0.02;
  if (hasMock(env) && opts.mock) {
    const tokensIn = Math.ceil(JSON.stringify([state, questions]).length / 4);
    return { answers: opts.mock(), tokensIn, cost: (tokensIn * price) / 1e6 };
  }
  const key = (env as { OPENROUTER_API_KEY?: string }).OPENROUTER_API_KEY;
  if (!key) throw new Error('No OpenRouter API key is configured: add the OPENROUTER_API_KEY secret');
  const res = await fetch('https://openrouter.ai/api/v1/systemone', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Tweet Explorer' },
    body: JSON.stringify({ model, state, questions }),
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw Object.assign(new Error(`OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`), { status: res.status });
  const r = (await res.json()) as { answers?: Record<string, Answer>; usage?: { inputTokens?: number; input_tokens?: number; prompt_tokens?: number; cost?: number }; error?: { message?: string } };
  if (r.error) throw new Error(`OpenRouter: ${String(r.error.message ?? 'error').slice(0, 200)}`);
  if (!r.answers || typeof r.answers !== 'object') throw new Error('the decision model returned no answers');
  const tokensIn = Number(r.usage?.inputTokens ?? r.usage?.input_tokens ?? r.usage?.prompt_tokens ?? 0);      // the docs say camelCase; the wire may differ
  return { answers: r.answers, tokensIn, cost: Number.isFinite(r.usage?.cost) ? Number(r.usage!.cost) : (tokensIn * price) / 1e6 };
}

/** A probability from a noul answer, or null when it is missing or not between 0 and 1 (then the caller leaves the tweet as it is). */
export const probOf = (a: Answer | undefined): number | null => (a?.type === 'noul' && typeof a.noul === 'number' && a.noul >= 0 && a.noul <= 1 ? a.noul : null);
/** The chosen option of a choice answer, if it is one of `keys`. */
export const choiceOf = (a: Answer | undefined, keys: readonly string[]): string | null => (a?.type === 'choice' && keys.includes(a.choice) ? a.choice : null);

/** Runs `decide` for many items, a few at a time, each failure isolated. `null` marks an item with no answer. Stops starting new ones once `stop()` is true. */
export async function decideAll<T>(items: readonly T[], concurrency: number, one: (item: T, i: number) => Promise<Decision>, stop: () => boolean = () => false, onError: (err: unknown) => void = () => {}): Promise<Array<Decision | null>> {
  return mapPool(items, concurrency, async (item, i) => {
    if (stop()) return null;
    try { return await one(item, i); }
    catch (err) { if (/\b(401|402|403|404)\b|credit/i.test(String((err as Error)?.message))) throw err; onError(err); return null; }   // a wrong key, no credit or an unknown model fail the whole run, a bad single answer only that item
  });
}
