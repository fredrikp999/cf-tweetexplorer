// Pictures with Workers AI (the AI binding). Cloudflare prices these models in Neurons, and every account gets 10,000 Neurons a day free
// (reset at 00:00 UTC). The caller keeps a daily tally with neuronsFor() and switches to the model's Replicate fallback before the free
// allowance runs out, so these pictures never cost anything. Prices from developers.cloudflare.com/workers-ai/platform/pricing (Nov 2026).
import type { Aspect, ImageResult } from './replicate.ts';
import { gatewayId } from '../llm/gateway.ts';

export const FREE_NEURONS = 10_000;
export const NEURON_MARGIN = 500;        // other Workers AI use on the account is not counted here: leave some room

const SIZES: Record<Aspect, [number, number]> = { '16:9': [1024, 576], '4:3': [1024, 768], '1:1': [1024, 1024] };
const tiles = (w: number, h: number) => Math.ceil(w / 512) * Math.ceil(h / 512);

/** Neurons one picture uses, from the published per-tile, per-step and per-megapixel prices (rounded up). */
export function neuronsFor(slug: string, aspect: Aspect): number {
  const [w, h] = SIZES[aspect], mp = (w * h) / (1024 * 1024);
  if (slug === '@cf/black-forest-labs/flux-2-klein-4b') return Math.ceil(26.05 * tiles(w, h));
  if (slug === '@cf/black-forest-labs/flux-2-klein-9b') return Math.ceil(1363.64 + 181.82 * Math.max(0, Math.ceil(mp) - 1));
  if (slug === '@cf/leonardo/phoenix-1.0') return Math.ceil(530 * tiles(w, h) + 10 * 25);
  return 2500;                            // unknown model: assume an expensive one
}

/** The free daily allowance is gone (Workers Free plan error 4006). */
export const isAllowanceError = (err: unknown) => /4006|daily free allocation|neurons/i.test(err instanceof Error ? err.message : String(err));

type AiRun = { run(model: string, input: unknown, opts?: { gateway?: { id: string } }): Promise<unknown> };

const sniff = (b: Uint8Array) =>
  b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x52 && b[8] === 0x57 ? 'image/webp' : 'image/jpeg';

async function bytesOf(out: unknown): Promise<Uint8Array> {
  if (out instanceof ReadableStream) return new Uint8Array(await new Response(out).arrayBuffer());
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  const b64 = (out as { image?: unknown } | null)?.image;
  if (typeof b64 === 'string' && b64) return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  throw new Error('Workers AI returned no picture');
}

export async function workersAiImage(ai: unknown, slug: string, prompt: string, aspect: Aspect): Promise<ImageResult> {
  const [w, h] = SIZES[aspect], gw = gatewayId();
  const run = (model: string, input: unknown, viaGateway = true) => (ai as AiRun).run(model, input, gw && viaGateway ? { gateway: { id: gw } } : undefined);
  let out: unknown;
  if (slug.startsWith('@cf/black-forest-labs/flux-2')) {
    // The FLUX.2 models take multipart form data, even for a prompt alone. AI Gateway cannot pass a streamed body on
    // ("AI Gateway does not support ReadableStreams yet"), so these go to Workers AI directly and are not in the gateway's log.
    const form = new FormData();
    form.append('prompt', prompt.slice(0, 2000)); form.append('width', String(w)); form.append('height', String(h));
    const body = new Response(form);
    out = await run(slug, { multipart: { body: body.body, contentType: body.headers.get('content-type') } }, false);
  } else out = await run(slug, { prompt: prompt.slice(0, 2000), width: w, height: h });
  const bytes = await bytesOf(out);
  return { bytes, type: sniff(bytes), cost: 0 };
}
