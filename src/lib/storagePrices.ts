// What Cloudflare storage costs, from Cloudflare's price lists (checked 2026-11-04): SQLite in Durable Objects $0.20 per GB-month with 5 included, R2 standard storage $0.015 with 10 included.
// Both are on the Workers Paid plan, and Cloudflare counts a GB as 10^9 bytes. Pure functions (no Worker APIs), so Node can test them.
export type StoreKind = 'do' | 'r2';
const RATE: Record<StoreKind, number> = { do: 0.2, r2: 0.015 }, INCLUDED: Record<StoreKind, number> = { do: 5, r2: 10 };
const GB = 1e9, DAYS_PER_MONTH = 30;

/** One day of holding this much, at list price, before anything included. The ledger's other amounts are list prices too. */
export const storageDayCost = (kind: StoreKind, bytes: number) => (Math.max(0, bytes) / GB) * RATE[kind] / DAYS_PER_MONTH;

/** A month at this size: at list price, and what would be billed after the included amount of that kind (which covers all of the account, not only this app). */
export function storageMonth(kind: StoreKind, bytes: number): { list: number; billed: number } {
  const gb = Math.max(0, bytes) / GB;
  return { list: gb * RATE[kind], billed: Math.max(0, gb - INCLUDED[kind]) * RATE[kind] };
}
