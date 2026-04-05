/**
 * @maestro/router — Direct Router plugin.
 *
 * Offline-first, zero-config, air-gapped fallback router.
 * Reads from a hardcoded static model list — no API keys, no network,
 * no external dependencies. Always healthy, always available.
 *
 * Selection logic:
 *   1. Filter models by required capabilities
 *   2. Exclude blocked providers
 *   3. Apply provider preference (soft)
 *   4. For cost_sensitivity='high', pick cheapest qualifying model
 *   5. Otherwise, pick highest-quality qualifying model for the effort level
 *
 * This is the recommended fallback plugin for every deployment.
 *
 * **Singleton pattern:** This module exports a single plugin object with no mutable
 * module-level state (stateless by design — no API keys needed). Safe to import
 * from multiple entry points. `initialize()` and `dispose()` are no-ops.
 */

import type {
  RouterPlugin,
  SpawnIntent,
  ModelSelection,
  ModelCapability,
  Effort,
} from '../types.js';
import { NoModelAvailableError } from '../errors.js';

// ── Static Model Catalog ──────────────────────────────────────────

const STATIC_MODELS: ModelCapability[] = [
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

// ── Effort → Model Tier Mapping ───────────────────────────────────

/** Maps effort levels to preferred model tiers for quality-first selection. */
const EFFORT_MODEL_TIERS: Record<Effort, string[]> = {
  deep: ['claude-opus-4-6', 'gpt-5', 'gemini-2.5-pro', 'claude-sonnet-4-6'],
  standard: ['claude-sonnet-4-6', 'gemini-2.5-pro', 'gpt-5', 'gpt-4.1-mini'],
  minimal: ['claude-haiku-4-5', 'gpt-4.1-mini', 'gemini-2.5-flash', 'claude-sonnet-4-6'],
};

// ── Selection Helpers ─────────────────────────────────────────────

function meetsRequirements(model: ModelCapability, requires?: string[]): boolean {
  if (!requires || requires.length === 0) return true;
  return requires.every(req => model.capabilities.includes(req));
}

function effectiveCost(model: ModelCapability): number {
  // Weighted average: assume ~3:1 output:input ratio for cost estimation
  return model.cost_per_million_input + model.cost_per_million_output * 3;
}

// ── Plugin ────────────────────────────────────────────────────────

/**
 * Direct router — offline, deterministic, always available.
 */
export default {
  id: 'direct',
  name: 'Direct Router',

  async select(intent: SpawnIntent): Promise<ModelSelection> {
    // 1. Filter by required capabilities
    let candidates = STATIC_MODELS.filter(m => meetsRequirements(m, intent.requires));

    // 2. Exclude blocked providers
    if (intent.exclude_providers?.length) {
      candidates = candidates.filter(m => !intent.exclude_providers!.includes(m.provider));
    }

    if (candidates.length === 0) {
      throw new NoModelAvailableError(intent);
    }

    // 3. For high cost sensitivity, pick cheapest qualifying model
    if (intent.cost_sensitivity === 'high') {
      candidates.sort((a, b) => effectiveCost(a) - effectiveCost(b));

      // Apply provider preference as tiebreaker among similarly-priced models
      if (intent.prefer_provider) {
        const cheapest = effectiveCost(candidates[0]);
        const threshold = cheapest * 1.2; // within 20%
        const affordable = candidates.filter(m => effectiveCost(m) <= threshold);
        const preferred = affordable.find(m => m.provider === intent.prefer_provider);
        if (preferred) {
          return buildSelection(preferred, intent);
        }
      }

      return buildSelection(candidates[0], intent);
    }

    // 4. Quality-first: use effort tier ordering
    const tierOrder = EFFORT_MODEL_TIERS[intent.effort];
    for (const modelId of tierOrder) {
      // Prefer provider match first
      if (intent.prefer_provider) {
        const preferred = candidates.find(
          m => m.model === modelId && m.provider === intent.prefer_provider,
        );
        if (preferred) return buildSelection(preferred, intent);
      }

      const match = candidates.find(m => m.model === modelId);
      if (match) return buildSelection(match, intent);
    }

    // 5. Fallback: first qualifying candidate
    if (intent.prefer_provider) {
      const preferred = candidates.find(m => m.provider === intent.prefer_provider);
      if (preferred) return buildSelection(preferred, intent);
    }

    return buildSelection(candidates[0], intent);
  },

  async models(): Promise<ModelCapability[]> {
    return [...STATIC_MODELS];
  },

  async healthy(): Promise<boolean> {
    return true;
  },
} satisfies RouterPlugin;

// ── Helpers ───────────────────────────────────────────────────────

function buildSelection(model: ModelCapability, intent: SpawnIntent): ModelSelection {
  return {
    router: 'direct',
    provider: model.provider,
    harness: 'api',
    model: model.model,
    config: `effort:${intent.effort}`,
    estimated_cost: effectiveCost(model) / 1_000_000, // normalize to per-request estimate
    rationale: `Direct selection: ${model.model} for effort=${intent.effort}, cost_sensitivity=${intent.cost_sensitivity}`,
  };
}
