// Text to speech with Gemini TTS on Replicate: google/gemini-3.8-flash-tts and the cheaper gemini-3.8-flash-lite-tts (same inputs and voices).
// Billing is per token (text in, audio out; about 25 audio tokens per second). The model pages publish no price. Flash is calibrated on
// Replicate's own "approximate cost" for four real runs (2,900 to 4,700 output tokens cost $0.03 to $0.04, i.e. about $9 per million output
// tokens, good to roughly 10% because Replicate rounds to cents). Flash-Lite is assumed at half of Flash: its one run (135 tokens) only
// shows "less than $0.01". Change them here if an invoice says otherwise.
const API = 'https://api.replicate.com/v1';
export const TTS_MODELS = {
  flash: { slug: 'google/gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS (most expressive)', usdIn: 0.5 / 1e6, usdOut: 9 / 1e6 },
  lite: { slug: 'google/gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS (cheaper)', usdIn: 0.25 / 1e6, usdOut: 4.5 / 1e6 },
} as const;
export type TtsModel = keyof typeof TTS_MODELS;
export const isTtsModel = (m: unknown): m is TtsModel => typeof m === 'string' && m in TTS_MODELS;
/** Rough dollars per character read aloud (about 15 characters a second, 25 audio tokens a second), for showing a price before the run. */
export const usdPerChar = (m: TtsModel): number => (25 / 15) * TTS_MODELS[m].usdOut + TTS_MODELS[m].usdIn / 4;

export const VOICES: ReadonlyArray<readonly [string, string]> = [
  ['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'], ['Fenrir', 'Excitable'], ['Leda', 'Youthful'],
  ['Orus', 'Firm'], ['Aoede', 'Breezy'], ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'],
  ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Erinome', 'Clear'], ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'],
  ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'], ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'],
  ['Achird', 'Friendly'], ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'], ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm'],
];
export const VOICE_NAMES: string[] = VOICES.map((v) => v[0]);

export interface TtsSettings { voice: string; style: string; model: TtsModel }
export interface TtsResult { audio: Uint8Array; tokensIn: number; tokensOut: number }
export const ttsCost = (m: TtsModel, tokensIn: number, tokensOut: number): number => tokensIn * TTS_MODELS[m].usdIn + tokensOut * TTS_MODELS[m].usdOut;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function apiError(status: number, body: string): Error {
  const detail = (() => { try { const j = JSON.parse(body) as { detail?: string; title?: string; error?: string }; return String(j.detail ?? j.title ?? j.error ?? body); } catch { return body; } })().replace(/\s+/g, ' ').slice(0, 160);
  if (status === 401) return new Error('Replicate rejected the API token (401). Check the REPLICATE_API_TOKEN secret.');
  if (status === 402) return new Error(`Replicate has no credit for this account (402${detail ? ': ' + detail : ''}). Add credit at replicate.com/account/billing.`);
  if (status === 429) return new Error('Replicate is rate limiting this token (429). Try again in a moment.');
  return new Error(`Replicate error ${status}${detail ? ': ' + detail : ''}`);
}

interface Prediction { id?: string; status?: string; output?: unknown; error?: unknown; metrics?: { token_input_count?: number; token_output_count?: number }; urls?: { get?: string } }
interface Ran { url: string; metrics: NonNullable<Prediction['metrics']> }

/** Runs a model and waits for it (long runs take a minute or more); retries rate limits, server errors and failed runs. Returns the output file's URL. */
async function runModel(token: string, slug: string, input: Record<string, unknown>): Promise<Ran> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  let last: Error = new Error('Replicate did not answer');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let res = await fetch(`${API}/models/${slug}/predictions`, { method: 'POST', headers: { ...headers, prefer: 'wait=60' }, body: JSON.stringify({ input }), signal: AbortSignal.timeout(90_000) });
      if (!res.ok) {
        const err = apiError(res.status, await res.text().catch(() => ''));
        if (res.status === 429 || res.status >= 500) { last = err; await sleep(3000 * (attempt + 1)); continue; }
        throw err;                                       // 401, 402, 422...: retrying will not help
      }
      let p = (await res.json()) as Prediction;
      for (let polls = 0; (p.status === 'starting' || p.status === 'processing') && p.urls?.get && polls < 120; polls++) {
        await sleep(2000);
        res = await fetch(p.urls.get, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
        if (res.ok) p = (await res.json()) as Prediction; else await res.body?.cancel();
      }
      if (p.status !== 'succeeded') { last = new Error(`Replicate ${p.status === 'failed' ? 'failed' : 'did not finish'}${p.error ? ': ' + String(p.error).slice(0, 160) : ''}`); continue; }
      const url = Array.isArray(p.output) ? p.output[0] : p.output;
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('Replicate returned no file');
      return { url, metrics: p.metrics ?? {} };
    } catch (err) {
      if (err instanceof Error && /^Replicate (rejected|has no credit)|returned no file/.test(err.message)) throw err;
      last = err instanceof Error ? err : new Error(String(err));
      await sleep(2000 * (attempt + 1));
    }
  }
  throw last;
}

async function download(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  let last: Error = new Error('download failed');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const file = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (file.ok) return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.headers.get('content-type') ?? '' };
      await file.body?.cancel(); last = new Error(`Could not download the file from Replicate (${file.status})`);
    } catch (err) { last = err instanceof Error ? err : new Error(String(err)); }
    await sleep(1500 * (attempt + 1));
  }
  throw last;
}

/** One piece of text as MP3 bytes. */
export async function replicateTts(token: string, s: TtsSettings, text: string): Promise<TtsResult> {
  const r = await runModel(token, TTS_MODELS[s.model].slug, { text, voice: s.voice, output_format: 'mp3', ...(s.style ? { style: s.style } : {}) });
  return { audio: (await download(r.url)).bytes, tokensIn: r.metrics.token_input_count ?? 0, tokensOut: r.metrics.token_output_count ?? 0 };
}

// ---- Images. Billed per image. Confirmed on Replicate's runs list ("approximate cost"): nano-banana-pro $0.15, imagen-4-fast $0.02, and
// flux-schnell under $0.01 (its published price is $3 per 1,000 images). Change them here if an invoice says otherwise.
// The `cf-` models run on Workers AI (media/workersai.ts) inside the free daily Neurons, so they cost nothing; once the day's allowance
// would run out, or Workers AI fails, the picture is made with `fallback` on Replicate instead (at its price).
interface ImageModelInfo { slug: string; label: string; usd: number; provider: 'replicate' | 'workers-ai'; fallback?: 'best' | 'cheaper' | 'cheapest' }
export const IMAGE_MODELS = {
  best: { slug: 'google/nano-banana-pro', label: 'Nano Banana Pro (best quality)', usd: 0.15, provider: 'replicate' },
  cheaper: { slug: 'google/imagen-4-fast', label: 'Imagen 4 Fast (cheaper)', usd: 0.02, provider: 'replicate' },
  cheapest: { slug: 'black-forest-labs/flux-schnell', label: 'FLUX.1 schnell (very cheap)', usd: 0.003, provider: 'replicate' },
  'cf-klein4b': { slug: '@cf/black-forest-labs/flux-2-klein-4b', label: 'FLUX.2 klein 4B on Cloudflare (free, about 90 a day; then FLUX.1 schnell)', usd: 0, provider: 'workers-ai', fallback: 'cheapest' },
  'cf-klein9b': { slug: '@cf/black-forest-labs/flux-2-klein-9b', label: 'FLUX.2 klein 9B on Cloudflare (free, about 6 a day; then Imagen 4 Fast)', usd: 0, provider: 'workers-ai', fallback: 'cheaper' },
  'cf-phoenix': { slug: '@cf/leonardo/phoenix-1.0', label: 'Leonardo Phoenix on Cloudflare (free, about 4 a day; then Imagen 4 Fast)', usd: 0, provider: 'workers-ai', fallback: 'cheaper' },
} as const satisfies Record<string, ImageModelInfo>;
export type ImageModel = keyof typeof IMAGE_MODELS;
export type ReplicateImageModel = 'best' | 'cheaper' | 'cheapest';
export const isImageModel = (m: unknown): m is ImageModel => typeof m === 'string' && m in IMAGE_MODELS;
export const imageModelInfo = (m: ImageModel): ImageModelInfo => IMAGE_MODELS[m];
export const ASPECTS = ['16:9', '4:3', '1:1'] as const;      // the shapes all three models accept (Imagen 4 Fast has no 3:2)
export type Aspect = (typeof ASPECTS)[number];
export interface ImageResult { bytes: Uint8Array; type: string; cost: number }

export async function replicateImage(token: string, model: ReplicateImageModel, prompt: string, aspect: Aspect): Promise<ImageResult> {
  const input: Record<string, unknown> = { prompt, aspect_ratio: aspect, output_format: 'jpg' };
  if (model === 'best') input.resolution = '2K';
  if (model === 'cheapest') input.num_outputs = 1;
  const f = await download((await runModel(token, IMAGE_MODELS[model].slug, input)).url);
  return { bytes: f.bytes, type: /^image\//.test(f.type) ? f.type.split(';')[0] : 'image/jpeg', cost: IMAGE_MODELS[model].usd };
}

// ---- dev mock: `AUDIO_MOCK=1` in .dev.vars (never a deployed variable) returns a short silent MP3.
export function mockMp3(seconds: number): Uint8Array {
  const frame = new Uint8Array(417);                      // one MPEG-1 Layer III frame, 128 kbps, 44.1 kHz, silent
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  const n = Math.max(1, Math.round(seconds / 0.026)), out = new Uint8Array(n * frame.length);
  for (let i = 0; i < n; i++) out.set(frame, i * frame.length);
  return out;
}
/** A flat placeholder picture for AUDIO_MOCK runs: an SVG, so it needs no encoder. */
export function mockImage(label: string, aspect: Aspect): ImageResult {
  const [w, h] = aspect.split(':').map(Number), W = 800, H = Math.round((W * h) / w);
  const text = label.replace(/[<>&"]/g, ' ').slice(0, 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f7a8c"/><stop offset="1" stop-color="#7c5cbf"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="28" text-anchor="middle">${text}</text></svg>`;
  return { bytes: new TextEncoder().encode(svg), type: 'image/svg+xml', cost: 0 };
}
