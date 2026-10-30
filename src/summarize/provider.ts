// Chooses the model for a run. Three providers: Cloudflare Workers AI (the default, no key), OpenRouter and Anthropic.
// A model id says which provider it belongs to (`@cf/...` is Workers AI, `vendor/name` is OpenRouter), so the model
// picker can mix them. A fallback (OpenRouter) can stand behind any other provider for when it is out of credits.
import type { Model } from '@strands-agents/sdk';
import { DEFAULT_MODEL, makeModel } from './agent.ts';
import { FallbackModel } from './fallback.ts';
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_ID, OPENROUTER_MODELS, openrouterModel, openrouterModelInfo } from './openrouter.ts';
import { DEFAULT_AI_MODEL, WORKERS_AI_MODELS, aiModelInfo, workersAiModel } from './workers-ai.ts';
import type { AiModelInfo, AiRunner } from './workers-ai.ts';

export type Provider = 'workers-ai' | 'anthropic' | 'openrouter';

export interface ProviderConfig {
  provider: Provider;       // the main provider (SUMMARY_PROVIDER)
  ai?: AiRunner;            // Workers AI runner (the AI binding, or REST from Node)
  anthropicKey?: string;
  openrouterKey?: string;
  configured?: string;      // SUMMARY_MODEL
  fallback?: string;        // SUMMARY_FALLBACK_MODEL: an OpenRouter model id, used when the main model cannot start
}

// Failures another provider would fix. Not: bad requests, auth errors on the main key.
export function isFallbackWorthy(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = Number((err as { status?: number } | null)?.status ?? /^(\d{3})\b/.exec(msg)?.[1]);
  return [402, 429, 503, 529].includes(status) || /4006|daily free allocation|neurons|3040|capacity|5035|Workers Free plan|credit balance|rate.?limit|overloaded/i.test(msg);
}

type Chosen = { provider: Provider; id: string };

function pick(c: ProviderConfig, requested?: string): Chosen {
  // An explicit request is honoured only for models we list (a cost guard), and only if that provider is usable.
  if (requested && c.ai && aiModelInfo(requested)) return { provider: 'workers-ai', id: requested };
  if (requested && c.openrouterKey && openrouterModelInfo(requested)) return { provider: 'openrouter', id: requested };
  const cfg = c.configured;
  if (c.provider === 'workers-ai') {
    if (!c.ai) throw new Error('Workers AI is not available here.');
    return { provider: 'workers-ai', id: cfg && aiModelInfo(cfg) ? cfg : DEFAULT_AI_MODEL };
  }
  if (c.provider === 'openrouter') {
    if (!c.openrouterKey) throw new Error('No OpenRouter API key is configured.');
    return { provider: 'openrouter', id: cfg && OPENROUTER_ID.test(cfg) ? cfg : DEFAULT_OPENROUTER_MODEL };
  }
  if (!c.anthropicKey) throw new Error('No Anthropic API key is configured.');
  return { provider: 'anthropic', id: cfg && cfg.startsWith('claude') ? cfg : DEFAULT_MODEL };
}

const make = (c: ProviderConfig, p: Chosen): Model =>
  p.provider === 'workers-ai' ? workersAiModel(c.ai!, p.id) : p.provider === 'openrouter' ? openrouterModel(c.openrouterKey!, p.id) : makeModel(c.anthropicKey!, p.id);

const labelOf = (p: Chosen) => (p.provider === 'workers-ai' ? aiModelInfo(p.id) : p.provider === 'openrouter' ? openrouterModelInfo(p.id) : undefined)?.label ?? p.id;

// `fallback`: undefined uses the configured SUMMARY_FALLBACK_MODEL, '' turns the fallback off, an id picks that OpenRouter model.
export function buildModel(c: ProviderConfig, requested?: string, fallback?: string): { model: Model; id: string; label: string } {
  const main = pick(c, requested);
  const model = make(c, main);
  // The fallback only stands behind a provider that is not OpenRouter itself, and only if it is a different model.
  const fb = fallback ?? c.fallback;
  if (fb && c.openrouterKey && main.provider !== 'openrouter' && OPENROUTER_ID.test(fb)) {
    const second: Chosen = { provider: 'openrouter', id: fb };
    return { model: new FallbackModel(model, make(c, second), { primary: main.id, secondary: second.id }, isFallbackWorthy), id: main.id, label: labelOf(main) };
  }
  return { model, id: main.id, label: labelOf(main) };
}

/** True when this config can run something. */
export const usable = (c: Partial<ProviderConfig>): boolean => !!(c.ai || c.anthropicKey || c.openrouterKey);

export interface ModelChoice extends AiModelInfo { provider: Provider }

// What the browser needs to draw the model picker: every model whose provider is usable.
export function featureInfo(c: ProviderConfig | null) {
  if (!c) return {};
  const models: ModelChoice[] = [
    ...(c.ai ? WORKERS_AI_MODELS.map((m) => ({ ...m, provider: 'workers-ai' as const })) : []),
    ...(c.openrouterKey ? OPENROUTER_MODELS.map((m) => ({ ...m, provider: 'openrouter' as const })) : []),
  ];
  let def = c.configured && models.some((m) => m.id === c.configured) ? c.configured : undefined;
  if (c.provider === 'anthropic') return { summaryProvider: c.provider, summaryDefault: DEFAULT_MODEL, summaryModels: [] };
  def ??= c.provider === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : DEFAULT_AI_MODEL;
  const fallback = c.fallback && c.openrouterKey && c.provider !== 'openrouter' ? c.fallback : undefined;
  return { summaryProvider: c.provider, summaryDefault: def, summaryModels: models, ...(fallback ? { summaryFallback: openrouterModelInfo(fallback)?.label ?? fallback, summaryFallbackId: fallback } : {}) };
}
