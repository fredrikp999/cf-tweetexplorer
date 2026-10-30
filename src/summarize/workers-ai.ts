// Cloudflare Workers AI as a Strands model. Strands already speaks OpenAI chat-completions, and Workers AI
// returns that format, so this is a thin adapter: an OpenAI client whose `fetch` is routed to Workers AI
// (the `AI` binding inside a Worker, or Cloudflare's REST API from Node), with three fixes for its quirks:
//   - message `content` must be a plain string (never an array or null)
//   - usage is repeated on every streamed chunk; OpenAI sends it once, at the end
//   - the stream ends with a non-OpenAI summary line ({"response":"", "usage":{...}})
//   - some models (gpt-oss) intermittently stream NOTHING when they decide to call a tool (about half the time in
//     testing, never when not streaming). If a stream ends with no text and no tool call, we ask again without
//     streaming and replay that answer into the same stream.
import OpenAI from 'openai';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import type { Model } from '@strands-agents/sdk';

export interface AiRunner { run(model: string, input: Record<string, unknown>): Promise<unknown> }

// Tool-calling text models worth offering (ids and prices from `wrangler ai models list`, USD per million tokens).
// `note` is what testing on a real list of tweets showed; `paid` models are refused on the Workers Free plan.
export interface AiModelInfo { id: string; label: string; context: string; inPrice: number; outPrice: number; note: string; paid?: boolean }
export const WORKERS_AI_MODELS: AiModelInfo[] = [
  { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B', context: '128K', inPrice: 0.2, outPrice: 0.3, note: 'Best balance: structured, well cited, cheapest' },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout', context: '131K', inPrice: 0.27, outPrice: 0.85, note: 'Fastest and reliable, terser. Never fetches tweets by itself, so use a list, search or feed source' },
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1', context: '128K', inPrice: 0.351, outPrice: 0.555, note: 'Plain, concise summaries' },
  { id: '@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B', context: '128K', inPrice: 0.35, outPrice: 0.75, note: 'Strongest analysis; some citations lack links' },
  { id: '@cf/nvidia/nemotron-3-120b-a12b', label: 'Nemotron 3 120B', context: '256K', inPrice: 0.5, outPrice: 1.5, note: 'Good, but sometimes returns nothing (retried once)' },
  { id: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B', context: '256K', inPrice: 0.1, outPrice: 0.3, note: 'Thorough but slow (over a minute)' },
  { id: '@cf/qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', context: '262K', inPrice: 0.45, outPrice: 3.2, note: 'Thorough but slow' },
  { id: '@cf/zai-org/glm-5.3-flash', label: 'GLM 5.3 Flash', context: '1M', inPrice: 0.15, outPrice: 0.5, note: 'Very long context. Needs the Workers Paid plan (not tested)', paid: true },
  { id: '@cf/moonshotai/kimi-k2.6', label: 'Kimi K2.6', context: '262K', inPrice: 0.95, outPrice: 4, note: 'Strong agent model. Needs the Workers Paid plan (not tested)', paid: true },
];
export const DEFAULT_AI_MODEL = WORKERS_AI_MODELS[0].id;
export const aiModelInfo = (id: string): AiModelInfo | undefined => WORKERS_AI_MODELS.find((m) => m.id === id);
export const estimateCost = (id: string, inputTokens: number, outputTokens: number): number | null => {
  const m = aiModelInfo(id);
  return m ? (inputTokens * m.inPrice + outputTokens * m.outPrice) / 1e6 : null;
};

type Msg = Record<string, unknown>;
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((p) => (p && typeof p === 'object' && typeof (p as Msg).text === 'string' ? (p as Msg).text : '')).join('') : '';

// OpenAI-style request -> the shape Workers AI accepts.
export function toWorkersAiRequest(body: Record<string, unknown>): Record<string, unknown> {
  const { model: _m, stream: _s, stream_options: _o, max_completion_tokens, messages, ...rest } = body;
  const out: Record<string, unknown> = { ...rest };
  if (max_completion_tokens !== undefined && out.max_tokens === undefined) out.max_tokens = max_completion_tokens;
  out.messages = (Array.isArray(messages) ? (messages as Msg[]) : []).map((m) => ({ ...m, content: textOf(m.content) }));
  return out;
}

const encoder = new TextEncoder(), decoder = new TextDecoder();
const frame = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

type Completion = { id?: string; model?: string; usage?: Record<string, number>; choices?: Array<{ finish_reason?: string; message?: { content?: string | null; tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }> } }> };

// A non-streamed completion, replayed as the chunks a stream would have carried.
function replayChunks(r: Completion, id: string, model: string): Uint8Array[] {
  const msg = r.choices?.[0]?.message, base = { id, object: 'chat.completion.chunk', model };
  const out: Uint8Array[] = [];
  if (msg?.content) out.push(frame({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: msg.content }, finish_reason: null }] }));
  const calls = msg?.tool_calls ?? [];
  if (calls.length) out.push(frame({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: calls.map((c, index) => ({ index, id: c.id ?? `call_${index}`, type: 'function', function: { name: c.function.name, arguments: c.function.arguments } })) }, finish_reason: null }] }));
  out.push(frame({ ...base, choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }] }));
  return out;
}

// Workers AI SSE -> OpenAI SSE: drop per-chunk usage, turn the summary line into the usual final usage chunk,
// and (if given) re-ask without streaming when the stream produced neither text nor a tool call.
export function normalizeStream(src: ReadableStream<Uint8Array>, fallback?: () => Promise<Completion>): ReadableStream<Uint8Array> {
  let buf = '', id = 'chatcmpl-workers-ai', model = '', usage: Record<string, number> | null = null, produced = false, finish: string | null = null;
  const out = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buf += decoder.decode(chunk, { stream: true });
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;                       // re-emitted once, after the usage chunk
        let obj: Record<string, any>;
        try { obj = JSON.parse(data); } catch { continue; }
        if (Array.isArray(obj.choices) && obj.choices.length) {
          id = obj.id ?? id; model = obj.model ?? model;
          const c = obj.choices[0], d = c?.delta;
          const hasDelta = (typeof d?.content === 'string' && d.content) || (Array.isArray(d?.tool_calls) && d.tool_calls.length);
          if (hasDelta) produced = true;
          delete obj.usage; delete obj.p; delete obj.prompt_token_ids; delete obj.prompt_text;
          if (c?.finish_reason) { finish = c.finish_reason; c.finish_reason = null; }   // held back: sent once, at the very end
          if (hasDelta || d?.reasoning || d?.role) controller.enqueue(frame(obj));
        } else if (obj.usage && (obj.usage.prompt_tokens || obj.usage.completion_tokens) && 'response' in obj) {
          usage = obj.usage;                                   // the totals
        }
      }
    },
    async flush(controller) {
      if (!produced && fallback) {
        try {
          const r = await fallback();
          const replay = replayChunks(r, id, model);
          for (const f of replay) controller.enqueue(f);
          finish = replay.length ? 'replayed' : finish;
          if (r.usage) usage = { prompt_tokens: (usage?.prompt_tokens ?? 0) + (r.usage.prompt_tokens ?? 0), completion_tokens: (usage?.completion_tokens ?? 0) + (r.usage.completion_tokens ?? 0), total_tokens: (usage?.total_tokens ?? 0) + (r.usage.total_tokens ?? 0) };
        } catch { /* nothing more to say: the caller sees an empty answer and its own retry applies */ }
      }
      if (finish !== 'replayed') controller.enqueue(frame({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: finish ?? 'stop' }] }));
      controller.enqueue(frame({ id, object: 'chat.completion.chunk', model, choices: [], usage }));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });
  return src.pipeThrough(out);
}

// A fetch that the OpenAI SDK can use: /chat/completions goes to Workers AI.
export function workersAiFetch(ai: AiRunner): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
    if (!url.pathname.endsWith('/chat/completions')) return new Response('not found', { status: 404 });
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const stream = !!body.stream;
    try {
      const payload = toWorkersAiRequest(body), model = String(body.model);
      const result = await ai.run(model, { ...payload, stream });
      if (stream && result instanceof ReadableStream) {
        const again = body.tools ? async () => (await ai.run(model, { ...payload, stream: false })) as Completion : undefined;   // only tool turns need the safety net
        return new Response(normalizeStream(result as ReadableStream<Uint8Array>, again), { headers: { 'content-type': 'text/event-stream' } });
      }
      return Response.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /\b(4\d\d)\b/.exec(message)?.[1] ? Number(/\b(4\d\d)\b/.exec(message)?.[1]) : /5006|validation|oneOf/i.test(message) ? 400 : 502;
      return Response.json({ error: { message, type: 'workers_ai_error' } }, { status });
    }
  }) as typeof fetch;
}

export function workersAiModel(ai: AiRunner, modelId = DEFAULT_AI_MODEL, maxTokens = 16_000): Model {
  const client = new OpenAI({ apiKey: 'workers-ai', baseURL: 'https://workers-ai.invalid/v1', fetch: workersAiFetch(ai), maxRetries: 0 });
  return new OpenAIModel({ api: 'chat', modelId, maxTokens, client });
}

// Node (local server): Cloudflare's REST API. Same payload as the binding; streaming comes back as SSE.
export function restRunner(accountId: string, token: string): AiRunner {
  return {
    async run(model, input) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
      if (input.stream) return res.body;
      const j = (await res.json()) as { result?: unknown };
      return j.result ?? j;
    },
  };
}
