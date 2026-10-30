// Reports spending to the ledger. Cost tracking must never break the feature it measures, so failures are swallowed.
import type { CostEntry } from '../durable-objects/cost';

export async function recordCost(env: Env, e: CostEntry): Promise<void> {
  try { await env.COST.getByName('main').add(e); }
  catch (err) { console.error('cost ledger write failed', err instanceof Error ? err.message : String(err)); }
}
