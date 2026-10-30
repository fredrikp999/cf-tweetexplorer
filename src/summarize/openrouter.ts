// OpenRouter as a Strands model. It speaks OpenAI chat-completions, so this is just the OpenAI client pointed at it.
// Prices are USD per million tokens, from OpenRouter's public model list; every model here advertises tool support.
// None of them has been run against real tweets yet. The gpt-oss models are deliberately not listed (they stall on batch work).
import OpenAI from 'openai';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import type { Model } from '@strands-agents/sdk';
import type { AiModelInfo } from './workers-ai.ts';

export const OPENROUTER_MODELS: AiModelInfo[] = [
  { id: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout', context: '1.3M', inPrice: 0.1, outPrice: 0.3, note: 'Fast and cheap, terser' },
  { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2', context: '256K', inPrice: 0.075, outPrice: 0.2, note: 'Plain, concise summaries' },
  { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', context: '164K', inPrice: 0.28, outPrice: 0.42, note: 'Good value' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', context: '1M', inPrice: 0.3, outPrice: 2.5, note: 'Fast, long context' },
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', context: '1M', inPrice: 0.1, outPrice: 0.5, note: 'Careful with citations' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', context: '1M', inPrice: 2, outPrice: 10, note: 'Best quality, most expensive' },
];
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-haiku-5.5';
export const openrouterModelInfo = (id: string): AiModelInfo | undefined => OPENROUTER_MODELS.find((m) => m.id === id);
// Operator-set ids (SUMMARY_MODEL, SUMMARY_FALLBACK_MODEL) may be any OpenRouter model; ids from the browser must be listed.
export const OPENROUTER_ID = /^[\w.-]+\/[\w.:-]{1,80}$/;

export function openrouterModel(apiKey: string, modelId = DEFAULT_OPENROUTER_MODEL, maxTokens = 16_000): Model {
  const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', maxRetries: 0, defaultHeaders: { 'X-Title': 'Tweet Explorer' } });
  return new OpenAIModel({ api: 'chat', modelId, maxTokens, client });
}
