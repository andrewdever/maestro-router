/**
 * @maestro/router — Portkey plugin.
 *
 * Open-source AI gateway via portkey.ai (11.2K+ GitHub stars).
 * Supports 250+ models across 45+ providers with built-in
 * guardrails, canary deployments, and automatic fallback chains.
 * Can be self-hosted for full data sovereignty.
 *
 * Uses a static model cache as fallback, with live model discovery
 * via undici when an API key is configured.
 *
 * **Singleton pattern:** This module uses module-level `let` variables for state
 * (apiKey, baseUrl, virtualKey). Because ES modules are cached after first import,
 * there is exactly one instance per process. `initialize()` sets state,
 * `dispose()` resets it. Do not import this module from multiple entry points
 * expecting independent state — use the RouterRegistry for managed lifecycle.
 *
 * @see https://portkey.ai
 * @see https://github.com/Portkey-AI/gateway
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

// ── Static Model Catalog ──────────────────────────────────────────

const PORTKEY_MODELS: ModelCapability[] = [
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
];

// ── Effort Preferences ────────────────────────────────────────────

const EFFORT_PREFERENCES: Record<Effort, string[]> = {
  deep: ['claude-opus-4-6', 'gpt-5', 'gemini-2.5-pro'],
  standard: ['claude-sonnet-4-6', 'gemini-2.5-pro', 'gpt-5'],
  minimal: ['claude-haiku-4-5', 'gpt-4.1-mini', 'gemini-2.5-flash'],
};

// ── Plugin State ──────────────────────────────────────────────────

/** API key for portkey.ai. Set via initialize(). */
let apiKey: string | null = null;

/**
 * Base URL for Portkey gateway.
 * Defaults to cloud. Override with base_url config for self-hosted.
 */
let baseUrl = 'https://api.portkey.ai/v1';

/** Virtual key for Portkey's key management (optional). */
let virtualKey: string | null = null;

/** Cached model list with TTL. */
let modelCache: ModelCapability[] = [...PORTKEY_MODELS];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let modelFetchPromise: Promise<ModelCapability[]> | null = null;

function isCacheValid(): boolean {
  return Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

// ── Helpers ───────────────────────────────────────────────────────

function effectiveCost(model: ModelCapability): number {
  return model.cost_per_million_input + model.cost_per_million_output * 3;
}

function buildSelection(model: ModelCapability, intent: SpawnIntent): ModelSelection {
  return {
    router: 'portkey',
    provider: model.provider,
    harness: 'api',
    model: model.model,
    config: `effort:${intent.effort}`,
    estimated_cost: effectiveCost(model) / 1_000_000,
    rationale:
      `Portkey selection: ${model.provider}/${model.model} ` +
      `for effort=${intent.effort}, cost_sensitivity=${intent.cost_sensitivity}`,
  };
}

// ── Plugin ────────────────────────────────────────────────────────

/**
 * Portkey — open-source AI gateway with 250+ models, 45+ providers.
 * Supports guardrails, canary deployments, and self-hosted operation.
 *
 * Uses undici for live model discovery from the Portkey gateway,
 * with static model data as fallback when API calls fail.
 */
export default {
  id: 'portkey',
  name: 'Portkey',

  async initialize(config: Record<string, unknown>): Promise<void> {
    if (typeof config.api_key === 'string' && config.api_key.length > 0) {
      apiKey = config.api_key;
    } else if (typeof config.PORTKEY_API_KEY === 'string' && config.PORTKEY_API_KEY.length > 0) {
      apiKey = config.PORTKEY_API_KEY;
    } else {
      apiKey = null;
    }

    if (typeof config.base_url === 'string') {
      const validated = validateBaseUrl(config.base_url);
      if (validated) baseUrl = validated;
    }

    if (typeof config.virtual_key === 'string') {
      virtualKey = config.virtual_key;
    }
  },

  async select(intent: SpawnIntent): Promise<ModelSelection> {
    if (!apiKey) {
      throw new SelectionError('portkey', 'PORTKEY_API_KEY not configured');
    }

    // 1. Filter by capabilities
    let candidates = PORTKEY_MODELS.filter(m => {
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
      throw new NoModelAvailableError(intent, 'No Portkey model matches requirements');
    }

    // 3. Cost-sensitive: pick cheapest
    if (intent.cost_sensitivity === 'high') {
      candidates.sort((a, b) => effectiveCost(a) - effectiveCost(b));
      const picked = intent.prefer_provider
        ? candidates.find(m => m.provider === intent.prefer_provider) ?? candidates[0]
        : candidates[0];

      return buildSelection(picked, intent);
    }

    // 4. Quality-first: use effort preferences
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

    // 5. Fallback
    if (intent.prefer_provider) {
      const match = candidates.find(m => m.provider === intent.prefer_provider);
      if (match) return buildSelection(match, intent);
    }

    return buildSelection(candidates[0], intent);
  },

  async models(): Promise<ModelCapability[]> {
    if (isCacheValid()) return [...modelCache];
    if (!apiKey) return [...PORTKEY_MODELS];

    // Coalesce concurrent cache refreshes into a single HTTP request
    if (modelFetchPromise) return modelFetchPromise;

    modelFetchPromise = (async () => {
      try {
        const headers: Record<string, string> = {
          'x-portkey-api-key': apiKey!,
        };
        if (virtualKey) {
          headers['x-portkey-virtual-key'] = virtualKey;
        }
        await fetchJson(`${baseUrl}/models`, { headers });
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
    baseUrl = 'https://api.portkey.ai/v1';
    virtualKey = null;
    modelCache = [...PORTKEY_MODELS];
    cacheTimestamp = 0;
    modelFetchPromise = null;
  },
} satisfies RouterPlugin;
