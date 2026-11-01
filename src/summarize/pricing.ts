// What things cost, in one place. twitterapi.io: $0.15 per 1,000 tweets, at least one tweet's worth per call.
// Models: the list price per million tokens from the model tables (Workers AI's free daily allowance is NOT subtracted).
import { openrouterModelInfo } from './openrouter.ts';
import { aiModelInfo } from './workers-ai.ts';

export const TWEET_PRICE = 0.00015;
export const PROFILE_PRICE = 0.00018;
export const tweetCallCost = (tweets: number): number => Math.max(1, tweets) * TWEET_PRICE;

/** Anthropic's own ids ("claude-sonnet-5-5") priced like the same model on OpenRouter ("anthropic/claude-sonnet-5.5"). Without this a briefing written through Anthropic directly cost nothing in the ledger. */
export const openrouterIdOf = (id: string): string => { const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id); return m ? `anthropic/claude-${m[1]}-${m[2]}.${m[3]}` : id; };

/** Dollars for a model call, or null when we have no price for that model (Anthropic direct, mock). */
export function llmCost(modelId: string | undefined, tokensIn: number, tokensOut: number, cache?: { read?: number; write?: number }): number | null {
  const m = modelId ? aiModelInfo(modelId) ?? openrouterModelInfo(modelId) ?? openrouterModelInfo(openrouterIdOf(modelId)) : undefined;
  // Anthropic bills cached input apart from `inputTokens`: a read costs a tenth of the input price, a write a quarter more.
  return m ? (tokensIn * m.inPrice + tokensOut * m.outPrice + (cache?.read ?? 0) * m.inPrice * 0.1 + (cache?.write ?? 0) * m.inPrice * 1.25) / 1e6 : null;
}

/** Counts what a run asks twitterapi.io for. */
export interface Meter { calls: number; tweets: number; cost: number; cap?: number; capped?: boolean }
export const newMeter = (cap?: number): Meter => ({ calls: 0, tweets: 0, cost: 0, ...(cap ? { cap } : {}) });
/** True when the next request (worst case `next`, a full page by default) could take a run past its data budget:
 *  callers then stop making requests and keep what they have, so a budget is never exceeded. */
export function exhausted(m: Meter | undefined, next: number = tweetCallCost(20)): boolean {
  if (m?.cap !== undefined && m.cost + next > m.cap) { m.capped = true; return true; }
  return false;
}
export function bill(m: Meter | undefined, tweets: number): void {
  if (m) { m.calls++; m.tweets += tweets; m.cost += tweetCallCost(tweets); }
}
