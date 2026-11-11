// The public id of a collected item, for the source card /t/<topic>/i/<item> (src/signal/sourcecard.ts). Pure, no Worker APIs.
import type { Area } from './area.ts';

/** What an item id looks like: eleven lowercase letters and digits (the route checks this before asking anyone). */
export const ITEM_ID = /^[a-z0-9]{11}$/;

/** cyrb53: a fast 53-bit hash of a string (two mixed 32-bit lanes). Not secret, and it need not be: it only has to tell addresses apart. */
function hash53(s: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/**
 * The public id of an item: eleven letters and digits from a hash of the item's own address (without the part after `#`). The same item always has the same id, in any topic,
 * and nothing about the id says more than the address already does. Empty for an item with no web address (it has no card).
 */
export function itemId(url: string): string {
  const u = String(url ?? '').trim().replace(/#.*$/, '');
  if (!/^https?:\/\/\S+$/i.test(u)) return '';
  return hash53(u).toString(36).padStart(11, '0');
}
/** The address of a card; the area is added only for a politics topic, as for the topic page. */
export const itemHref = (slug: string, id: string, area: Area = 'ai'): string => `/t/${slug}/i/${id}${area === 'politics' ? '?area=politics' : ''}`;

