// What was said in a YouTube video, for the summarizer's get_video_transcript tool. Three ways to get it, chosen by TRANSCRIPT_PROVIDER:
//   captions    (default) the video's own public caption track. Free, but unofficial: YouTube may refuse requests from cloud addresses,
//               and videos without captions have none.
//   openrouter  a Gemini model that reads the video from its YouTube address (OPENROUTER_API_KEY; billed per token).
//   replicate   a speech-to-text model that takes a video address (REPLICATE_API_TOKEN; billed per second of compute).
// TRANSCRIPT_FALLBACK (openrouter or replicate) is tried when the first way fails, so captions can be the default and a paid
// service the safety net. The text is written by strangers: it is capped, and the caller treats it as untrusted.
import { decode } from './rss.ts';
import { orFetch } from '../llm/gateway.ts';

export type TranscriptProvider = 'captions' | 'openrouter' | 'replicate';
export interface TranscriptConfig {
  provider: TranscriptProvider; fallback?: TranscriptProvider;
  openrouterKey?: string; openrouterModel: string;
  replicateToken?: string; replicateModel: string; replicateUsdPerSec: number;
}
export interface Transcript { text: string; via: TranscriptProvider; lang?: string; cost: number; model?: string; tokensIn?: number; tokensOut?: number }

export const DEFAULT_TRANSCRIPT_MODEL = 'google/gemini-2.5-flash';
export const DEFAULT_REPLICATE_MODEL = 'adidoes/whisperx-video-transcribe';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isProvider = (v: unknown): v is TranscriptProvider => v === 'captions' || v === 'openrouter' || v === 'replicate';

/** Reads the settings from the environment; anything unrecognised falls back to the free default. */
export function transcriptConfig(env: Partial<Record<string, string | undefined>>): TranscriptConfig {
  const provider = isProvider(env.TRANSCRIPT_PROVIDER) ? env.TRANSCRIPT_PROVIDER : 'captions';
  const fallback = isProvider(env.TRANSCRIPT_FALLBACK) && env.TRANSCRIPT_FALLBACK !== provider ? env.TRANSCRIPT_FALLBACK : undefined;
  const rate = Number(env.TRANSCRIPT_REPLICATE_USD_PER_SEC);
  return {
    provider, fallback, openrouterKey: env.OPENROUTER_API_KEY, openrouterModel: /^[\w.-]+\/[\w.:-]{1,80}$/.test(env.TRANSCRIPT_MODEL ?? '') ? env.TRANSCRIPT_MODEL! : DEFAULT_TRANSCRIPT_MODEL,
    replicateToken: env.REPLICATE_API_TOKEN, replicateModel: /^[\w.-]+\/[\w.-]{1,80}$/.test(env.TRANSCRIPT_REPLICATE_MODEL ?? '') ? env.TRANSCRIPT_REPLICATE_MODEL! : DEFAULT_REPLICATE_MODEL,
    replicateUsdPerSec: rate > 0 && rate < 0.1 ? rate : 0.001,   // a rough default; set it to what your invoice shows
  };
}

// ---- shared: turn timed segments into "[m:ss] text" paragraphs of about 30 seconds
export interface Segment { start: number; text: string }
const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export function formatSegments(segs: Segment[], every = 30): string {
  const out: string[] = []; let cur = '', from = -Infinity;
  for (const s of segs) {
    const t = s.text.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (cur && s.start - from >= every) { out.push(cur); cur = ''; }
    if (!cur) { cur = `[${stamp(s.start)}] ${t}`; from = s.start; } else cur += ' ' + t;
  }
  if (cur) out.push(cur);
  return out.join('\n');
}

// ---- captions
const ANDROID = { clientName: 'ANDROID', clientVersion: '20.10.38' };

interface Track { baseUrl?: string; languageCode?: string; kind?: string }
function pickTrack(tracks: Track[], lang: string): Track | undefined {
  const l = lang.toLowerCase().split('-')[0];
  const usable = tracks.filter((t) => t.baseUrl);
  const mine = usable.filter((t) => (t.languageCode ?? '').toLowerCase().split('-')[0] === l);
  return mine.find((t) => t.kind !== 'asr') ?? mine[0] ?? usable.find((t) => t.kind !== 'asr') ?? usable[0];
}

/** Parses either caption format YouTube serves: <text start="s" dur="s"> or <p t="ms" d="ms">. */
export function parseCaptionXml(xml: string): Segment[] {
  const clean = (raw: string) => decode(decode(raw.replace(/<[^>]*>/g, ''))).replace(/\s+/g, ' ').trim();
  const out: Segment[] = [];
  for (const m of xml.matchAll(/<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) out.push({ start: Number(m[1]), text: clean(m[2]) });
  if (!out.length) for (const m of xml.matchAll(/<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) out.push({ start: Number(m[1]) / 1000, text: clean(m[2]) });
  return out;
}

export async function captionsTranscript(videoId: string, lang = 'en'): Promise<Transcript> {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('not a YouTube video id');
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', 'user-agent': `com.google.android.youtube/${ANDROID.clientVersion} (Linux; U; Android 14)`, 'accept-language': 'en' },
    body: JSON.stringify({ context: { client: { ...ANDROID, hl: 'en' } }, videoId }),
  });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`YouTube answered HTTP ${res.status}`); }
  const data = (await res.json()) as { playabilityStatus?: { status?: string; reason?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } } };
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) {
    const st = data.playabilityStatus;
    throw new Error(st && st.status !== 'OK' ? `YouTube would not serve this video (${st.reason ?? st.status})` : 'this video has no captions');
  }
  const track = pickTrack(tracks, lang)!;
  const cap = new URL(track.baseUrl!);
  if (!/(^|\.)youtube\.com$/.test(cap.hostname)) throw new Error('unexpected caption address');
  cap.searchParams.delete('fmt');
  const xml = await fetch(cap.href, { signal: AbortSignal.timeout(20_000), headers: { 'accept-language': 'en' } });
  if (!xml.ok) { await xml.body?.cancel(); throw new Error(`the caption track answered HTTP ${xml.status}`); }
  const segs = parseCaptionXml(await xml.text());
  if (!segs.length) throw new Error('YouTube returned an empty caption track');
  return { text: formatSegments(segs), via: 'captions', lang: track.languageCode, cost: 0 };
}

// ---- OpenRouter: a Gemini model reads the video itself
export async function openrouterTranscript(cfg: TranscriptConfig, videoId: string): Promise<Transcript> {
  if (!cfg.openrouterKey) throw new Error('needs the OPENROUTER_API_KEY secret');
  const res = await orFetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(170_000),
    headers: { authorization: `Bearer ${cfg.openrouterKey}`, 'content-type': 'application/json', 'x-title': 'Tweet Explorer' },
    body: JSON.stringify({
      model: cfg.openrouterModel, max_tokens: 16_000, usage: { include: true },
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Transcribe the speech in this video, word for word, in the language spoken. Plain text only: start each paragraph with a timestamp like [m:ss], about one every 30 seconds. No summary, no commentary, no description of the pictures. If there is no speech, reply exactly: NO SPEECH.' },
        { type: 'video_url', video_url: { url: `https://www.youtube.com/watch?v=${videoId}` } },
      ] }],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };
  if (!res.ok) throw new Error(`OpenRouter ${res.status}${body.error?.message ? ': ' + body.error.message.slice(0, 160) : ''}`);
  const text = (body.choices?.[0]?.message?.content ?? '').trim();
  if (!text || /^NO SPEECH\.?$/i.test(text)) throw new Error('the model found no speech in the video');
  const { prompt_tokens = 0, completion_tokens = 0, cost = 0 } = body.usage ?? {};
  return { text, via: 'openrouter', cost, model: cfg.openrouterModel, tokensIn: prompt_tokens, tokensOut: completion_tokens };
}

// ---- Replicate: a speech-to-text model that takes a video address as `url`. Community models are run by version id.
interface Prediction { status?: string; output?: unknown; error?: unknown; metrics?: { predict_time?: number }; urls?: { get?: string } }
const versions = new Map<string, string>();

export function textFromReplicateOutput(out: unknown): string {
  const first = Array.isArray(out) ? out.map(String).join('') : typeof out === 'string' ? out : '';
  try {
    const j = JSON.parse(first) as { segments?: Array<{ start?: number; text?: string }>; text?: string };
    if (Array.isArray(j.segments)) return formatSegments(j.segments.map((s) => ({ start: Number(s.start) || 0, text: String(s.text ?? '') })));
    if (typeof j.text === 'string') return j.text.trim();
  } catch { /* plain text */ }
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    const o = out as { segments?: Array<{ start?: number; text?: string }>; text?: string; transcription?: string };
    if (Array.isArray(o.segments)) return formatSegments(o.segments.map((s) => ({ start: Number(s.start) || 0, text: String(s.text ?? '') })));
    return String(o.text ?? o.transcription ?? '').trim();
  }
  return first.trim();
}

export async function replicateTranscript(cfg: TranscriptConfig, videoId: string): Promise<Transcript> {
  const token = cfg.replicateToken;
  if (!token) throw new Error('needs the REPLICATE_API_TOKEN secret');
  const auth = { authorization: `Bearer ${token}` };
  let version = versions.get(cfg.replicateModel);
  if (!version) {
    const m = await fetch(`https://api.replicate.com/v1/models/${cfg.replicateModel}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
    if (!m.ok) { await m.body?.cancel(); throw new Error(m.status === 401 ? 'Replicate rejected the API token (401)' : `Replicate does not know the model ${cfg.replicateModel} (${m.status})`); }
    version = ((await m.json()) as { latest_version?: { id?: string } }).latest_version?.id;
    if (!version) throw new Error(`the model ${cfg.replicateModel} has no published version`);
    versions.set(cfg.replicateModel, version);
  }
  let res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json', prefer: 'wait=60' }, signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ version, input: { url: `https://www.youtube.com/watch?v=${videoId}` } }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(res.status === 402 ? 'Replicate has no credit for this account (402)' : `Replicate error ${res.status}: ${t.replace(/\s+/g, ' ').slice(0, 140)}`); }
  let p = (await res.json()) as Prediction;
  for (let polls = 0; (p.status === 'starting' || p.status === 'processing') && p.urls?.get && polls < 150; polls++) {   // up to about 5 minutes
    await sleep(2000);
    res = await fetch(p.urls.get, { headers: auth, signal: AbortSignal.timeout(30_000) });
    if (res.ok) p = (await res.json()) as Prediction; else await res.body?.cancel();
  }
  if (p.status !== 'succeeded') throw new Error(`Replicate ${p.status === 'failed' ? 'failed' : 'did not finish'}${p.error ? ': ' + String(p.error).slice(0, 160) : ''}`);
  const text = textFromReplicateOutput(p.output);
  if (!text) throw new Error('the model returned no text');
  return { text, via: 'replicate', model: cfg.replicateModel, cost: (p.metrics?.predict_time ?? 0) * cfg.replicateUsdPerSec };
}

/** The chosen way first, then the fallback if there is one. The error lists every way that was tried. */
export async function getTranscript(cfg: TranscriptConfig, videoId: string, lang = 'en'): Promise<Transcript> {
  const order: TranscriptProvider[] = [cfg.provider, ...(cfg.fallback ? [cfg.fallback] : [])];
  const errors: string[] = [];
  for (const p of order) {
    try {
      return p === 'captions' ? await captionsTranscript(videoId, lang) : p === 'openrouter' ? await openrouterTranscript(cfg, videoId) : await replicateTranscript(cfg, videoId);
    } catch (err) { errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`); }
  }
  throw new Error(`no transcript (${errors.join('; ')})`);
}
