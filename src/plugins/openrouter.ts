/**
 * @maestro/router — OpenRouter plugin.
 *
 * Multi-provider routing via openrouter.ai. Aggregates 200+ models
 * from dozens of providers behind a single API key. Supports
 * automatic failover, cost tracking, and rate limit management.
 *
 * Uses a static model cache as fallback, with live model discovery
 * via undici when an API key is configured.
 *
 * **Singleton pattern:** This module uses module-level `let` variables for state
 * (apiKey, baseUrl, etc.). Because ES modules are cached after first import,
 * there is exactly one instance per process. `initialize()` sets state,
 * `dispose()` resets it. Do not import this module from multiple entry points
 * expecting independent state — use the RouterRegistry for managed lifecycle.
 *
 * @see https://openrouter.ai/docs
 */

import type {
  RouterPlugin,
  SpawnIntent,
  ModelSelection,
  ModelCapability,
  Effort,
} from '../types.js';
import { NoModelAvailableError, SelectionError } from '../errors.js';
import { fetchJson, isReachable, validateBaseUrl } from '../http.js';

// ── API Response Types ───────────────────────────────────────────

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  top_provider?: { context_length?: number };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

// ── Static Model Catalog (OpenRouter-available models) ────────────

const OPENROUTER_MODELS: ModelCapability[] = [
  {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    capabilities: ['thinking', 'tool_use', 'vision', 'code'],
    context_window: 200_000,
    max_thinking_budget: 32_000,
    cost_per_million_input: 15.0,
    cost_per_million_output: 75.0,
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    capabilities: ['thinking', 'tool_use', 'vision', 'code'],
    context_window: 200_000,
    max_thinking_budget: 16_000,
    cost_per_million_input: 3.0,
    cost_per_million_output: 15.0,
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    capabilities: ['tool_use', 'vision', 'code'],
    context_window: 200_000,
    max_thinking_budget: 0,
    cost_per_million_input: 0.8,
    cost_per_million_output: 4.0,
  },
  {
    provider: 'openai',
    model: 'gpt-5',
    capabilities: ['thinking', 'tool_use', 'vision', 'code'],
    context_window: 200_000,
    max_thinking_budget: 32_000,
    cost_per_million_input: 10.0,
    cost_per_million_output: 30.0,
  },
  {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    capabilities: ['tool_use', 'vision', 'code'],
    context_window: 128_000,
    max_thinking_budget: 0,
    cost_per_million_input: 0.4,
    cost_per_million_output: 1.6,
  },
  {
    provider: 'google',
    model: 'gemini-2.5-pro',
    capabilities: ['thinking', 'tool_use', 'vision', 'code'],
    context_window: 1_000_000,
    max_thinking_budget: 16_000,
    cost_per_million_input: 2.5,
    cost_per_million_output: 15.0,
  },
  {
    provider: 'google',
    model: 'gemini-2.5-flash',
    capabilities: ['tool_use', 'vision', 'code'],
    context_window: 1_000_000,
    max_thinking_budget: 0,
    cost_per_million_input: 0.15,
    cost_per_million_output: 0.6,
  },
  {
    provider: 'meta',
    model: 'llama-4-maverick',
    capabilities: ['tool_use', 'code'],
    context_window: 128_000,
    max_thinking_budget: 0,
    cost_per_million_input: 0.2,
    cost_per_million_output: 0.6,
  },
];

// ── Effort → Model Preference ─────────────────────────────────────

const EFFORT_PREFERENCES: Record<Effort, string[]> = {
  deep: ['claude-opus-4-6', 'gpt-5', 'gemini-2.5-pro'],
  standard: ['claude-sonnet-4-6', 'gemini-2.5-pro', 'gpt-5'],
  minimal: ['claude-haiku-4-5', 'gpt-4.1-mini', 'gemini-2.5-flash', 'llama-4-maverick'],
};

// ── Plugin State ──────────────────────────────────────────────────

/** API key for openrouter.ai. Set via initialize(). */
let apiKey: string | null = null;

/** Base URL for OpenRouter API. Defaults to production. */
let baseUrl = 'https://openrouter.ai/api/v1';

/** Cached model list with TTL. */
let modelCache: ModelCapability[] = [...OPENROUTER_MODELS];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let modelFetchPromise: Promise<ModelCapability[]> | null = null;

// ── Helpers ───────────────────────────────────────────────────────

function isCacheValid(): boolean {
  return Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

function safeParseFloat(value: string): number {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

function parseOpenRouterModel(m: OpenRouterModel): ModelCapability | null {
  const pricing = m.pricing;
  if (!pricing?.prompt || !pricing?.completion) return null;

  // Parse provider from model ID (e.g., "anthropic/claude-3-opus" → "anthropic")
  const provider = m.id.split('/')[0] ?? 'unknown';
  const model = m.id.split('/').slice(1).join('/') || m.id;

  // Infer capabilities from model name/id
  const capabilities: string[] = ['code'];
  const idLower = m.id.toLowerCase();
  if (idLower.includes('vision') || idLower.includes('gpt-4') || idLower.includes('claude') || idLower.includes('gemini')) {
    capabilities.push('vision');
  }
  if (idLower.includes('opus') || idLower.includes('gpt-5') || idLower.includes('o1') || idLower.includes('r1') || idLower.includes('pro')) {
    capabilities.push('thinking');
  }
  capabilities.push('tool_use');

  return {
    provider,
    model,
    capabilities,
    context_window: m.context_length ?? m.top_provider?.context_length ?? 128_000,
    max_thinking_budget: capabilities.includes('thinking') ? 16_000 : 0,
    cost_per_million_input: safeParseFloat(pricing.prompt) * 1_000_000,
    cost_per_million_output: safeParseFloat(pricing.completion) * 1_000_000,
  };
}

function effectiveCost(model: ModelCapability): number {
  return model.cost_per_million_input + model.cost_per_million_output * 3;
}

// ── Plugin ────────────────────────────────────────────────────────

/**
 * OpenRouter — multi-provider aggregator with 200+ models.
 * Routes through openrouter.ai for unified billing and automatic failover.
 *
 * Uses undici for live model discovery from the OpenRouter API,
 * with static model data as fallback when API calls fail.
 */
export default {
  id: 'openrouter',
  name: 'OpenRouter',

  async initialize(config: Record<string, unknown>): Promise<void> {
    if (typeof config.api_key === 'string' && config.api_key.length > 0) {
      apiKey = config.api_key;
    } else if (typeof config.OPENROUTER_API_KEY === 'string' && config.OPENROUTER_API_KEY.length > 0) {
      apiKey = config.OPENROUTER_API_KEY;
    } else {
      apiKey = null;
    }

    if (typeof config.base_url === 'string') {
      const validated = validateBaseUrl(config.base_url);
      if (validated) baseUrl = validated;
    }

    // Reset cache on re-initialization
    modelCache = [...OPENROUTER_MODELS];
    cacheTimestamp = Date.now();
  },

  async select(intent: SpawnIntent): Promise<ModelSelection> {
    if (!apiKey) {
      throw new SelectionError('openrouter', 'OPENROUTER_API_KEY not configured');
    }

    // 1. Filter by capabilities
    let candidates = modelCache.filter(m => {
      if (intent.requires?.length) {
        return intent.requires.every(req => m.capabilities.includes(req));
      }
      return true;
    });

    // 2. Exclude providers
    if (intent.exclude_providers?.length) {
      candidates = candidates.filter(m => !intent.exclude_providers!.includes(m.provider));
    }

    if (candidates.length === 0) {
      throw new NoModelAvailableError(intent, 'No OpenRouter model matches requirements');
    }

    // 3. Cost-sensitive: pick cheapest
    if (intent.cost_sensitivity === 'high') {
      candidates.sort((a, b) => effectiveCost(a) - effectiveCost(b));
      const picked = intent.prefer_provider
        ? candidates.find(m => m.provider === intent.prefer_provider) ?? candidates[0]
        : candidates[0];

      return buildSelection(picked, intent);
    }

    // 4. Quality-first: use effort preference ordering
    const preferred = EFFORT_PREFERENCES[intent.effort];
    for (const modelId of preferred) {
      if (intent.prefer_provider) {
        const match = candidates.find(
          m => m.model === modelId && m.provider === intent.prefer_provider,
        );
        if (match) return buildSelection(match, intent);
      }

      const match = candidates.find(m => m.model === modelId);
      if (match) return buildSelection(match, intent);
    }

    // 5. Fallback: prefer provider, then first candidate
    if (intent.prefer_provider) {
      const match = candidates.find(m => m.provider === intent.prefer_provider);
      if (match) return buildSelection(match, intent);
    }

    return buildSelection(candidates[0], intent);
  },

  async models(): Promise<ModelCapability[]> {
    if (isCacheValid()) return [...modelCache];
    if (!apiKey) return [...OPENROUTER_MODELS];

    // Coalesce concurrent cache refreshes into a single HTTP request
    if (modelFetchPromise) return modelFetchPromise;

    modelFetchPromise = (async () => {
      try {
        const response = await fetchJson<OpenRouterModelsResponse>(
          `${baseUrl}/models`,
          { headers: { 'Authorization': `Bearer ${apiKey}` } },
        );
        const parsed = response.data.data
          .map(parseOpenRouterModel)
          .filter((m): m is ModelCapability => m !== null);

        if (parsed.length > 0) {
          modelCache = parsed;
        }
      } catch {
        // Fall through to static data
      }
      cacheTimestamp = Date.now();
      return [...modelCache];
    })().finally(() => { modelFetchPromise = null; });

    return modelFetchPromise;
  },

  async healthy(): Promise<boolean> {
    return apiKey !== null && apiKey.length > 0;
  },

  async dispose(): Promise<void> {
    apiKey = null;
    baseUrl = 'https://openrouter.ai/api/v1';
    modelCache = [...OPENROUTER_MODELS];
    cacheTimestamp = 0;
    modelFetchPromise = null;
  },
} satisfies RouterPlugin;

// ── Helpers ───────────────────────────────────────────────────────

function buildSelection(model: ModelCapability, intent: SpawnIntent): ModelSelection {
  return {
    router: 'openrouter',
    provider: model.provider,
    harness: 'api',
    model: model.model,
    config: `effort:${intent.effort}`,
    estimated_cost: effectiveCost(model) / 1_000_000,
    rationale:
      `OpenRouter selection: ${model.provider}/${model.model} ` +
      `for effort=${intent.effort}, cost_sensitivity=${intent.cost_sensitivity}`,
  };
}
