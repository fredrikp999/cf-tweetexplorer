// One chat completion from an OpenRouter model. The History analysis makes many small calls and wants the token counts back, so this is a
// plain request, not the agent loop. Only OpenRouter models are used here (and not gpt-oss, which spends its whole allowance thinking
// and then answers nothing on batch labelling).
import { OPENROUTER_MODELS, openrouterModelInfo } from '../summarize/openrouter.ts';
import { DECIDER_MODELS, deciderInfo } from './decisions.ts';
import type { Msg } from '../history/analysis.ts';
export type { Msg };

export interface Completion { text: string; tokensIn: number; tokensOut: number; cost: number }
/** `decider`: a classifier that cannot write text, so it can only be the cheap model that labels (not the stronger one). */
export interface ModelOption { id: string; label: string; provider: string; inPrice: number; outPrice: number; note: string; decider?: boolean }

const hasKey = (env: Env) => !!(env as { OPENROUTER_API_KEY?: string }).OPENROUTER_API_KEY || (env as { SUMMARY_MOCK?: string }).SUMMARY_MOCK === '1';

/** The models the analysis can use, cheapest first, with prices per million tokens. Empty without the OPENROUTER_API_KEY secret. */
export function modelOptions(env: Env): ModelOption[] {
  if (!hasKey(env)) return [];
  const all: ModelOption[] = [...OPENROUTER_MODELS.map((m) => ({ ...m, provider: 'openrouter' })), ...DECIDER_MODELS.map((m) => ({ ...m, provider: 'openrouter', decider: true }))];
  return all.sort((a, b) => a.inPrice + 4 * a.outPrice - (b.inPrice + 4 * b.outPrice));
}
export const costOf = (id: string, tokensIn: number, tokensOut: number): number => {
  const m = openrouterModelInfo(id) ?? deciderInfo(id);
  return m ? (tokensIn * m.inPrice + tokensOut * m.outPrice) / 1e6 : 0;
};

/** Defaults for the two tiers: the cheapest model for the many small labelling calls, and a stronger one for the few that need judgement. */
export function defaultTiers(env: Env): { cheap: string; strong: string } {
  const all = modelOptions(env).filter((m) => !m.decider), has = (id: string) => all.some((m) => m.id === id);
  const cheap = ['mistralai/mistral-small-3.2-24b-instruct', 'meta-llama/llama-4-scout'].find(has) ?? all[0]?.id ?? '';
  const strong = ['anthropic/claude-haiku-5.5', 'deepseek/deepseek-v3.2'].find(has) ?? all[all.length - 1]?.id ?? cheap;
  return { cheap, strong };
}

export async function complete(env: Env, model: string, messages: Msg[], opts: { maxTokens?: number; mock?: () => string } = {}): Promise<Completion> {
  if ((env as { SUMMARY_MOCK?: string }).SUMMARY_MOCK === '1' && opts.mock) {      // dev only: scripted answers, no model call
    const text = opts.mock(), tin = Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4), tout = Math.ceil(text.length / 4);
    return { text, tokensIn: tin, tokensOut: tout, cost: costOf(model, tin, tout) };
  }
  const key = (env as { OPENROUTER_API_KEY?: string }).OPENROUTER_API_KEY;
  if (!key) throw new Error('No OpenRouter API key is configured: add the OPENROUTER_API_KEY secret');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Tweet Explorer' },
    body: JSON.stringify({ model, messages, max_tokens: opts.maxTokens ?? 2000, temperature: 0.2 }), signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw Object.assign(new Error(`OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`), { status: res.status });
  const r = (await res.json()) as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
  if (r.error) throw new Error(`OpenRouter: ${String(r.error.message ?? 'error').slice(0, 200)}`);
  const text = String(r.choices?.[0]?.message?.content ?? ''), tin = Number(r.usage?.prompt_tokens ?? 0), tout = Number(r.usage?.completion_tokens ?? 0);
  if (!text.trim()) throw new Error(`the model returned nothing (finish: ${r.choices?.[0]?.finish_reason ?? 'unknown'}, ${tout} tokens out)`);
  return { text, tokensIn: tin, tokensOut: tout, cost: costOf(model, tin, tout) };
}
