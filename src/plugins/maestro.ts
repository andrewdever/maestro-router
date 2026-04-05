/**
 * @maestro/router — Maestro Router plugin.
 *
 * The recommended default router. Intelligent first-party routing
 * with quality-informed model selection via the score bridge.
 *
 * Features:
 * - Cost-quality tradeoff optimization based on intent
 * - Quality scores from @maestro/score (via bridge) influence selection
 * - Off-peak optimization: non-urgent tasks can be flagged for cheaper windows
 * - Provider preference as soft constraint with quality-aware fallback
 *
 * Selection algorithm:
 *   1. Load quality data from score bridge
 *   2. Filter models by required capabilities
 *   3. Score each candidate: weighted(quality, cost, preference)
 *   4. Apply cost_sensitivity weighting
 *   5. Return best candidate with quality_score populated
 *
 * **Singleton pattern:** This module uses module-level `let` variables for state
 * (scoreBridge, offPeakEnabled, etc.). Because ES modules are cached after first
 * import, there is exactly one instance per process. `initialize()` sets state,
 * `dispose()` resets it. Do not import this module from multiple entry points
 * expecting independent state — use the RouterRegistry for managed lifecycle.
 */

import type {
  RouterPlugin,
  SpawnIntent,
  ModelSelection,
  ModelCapability,
  Effort,
} from '../types.js';
import { NoModelAvailableError } from '../errors.js';
import { type ScoreBridge, createDefaultScoreBridge } from '../score-bridge.js';

// ── Static Model Catalog ──────────────────────────────────────────

const DEFAULT_MODELS: ModelCapability[] = [
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

// ── Off-Peak Detection ────────────────────────────────────────────

/**
 * Provider-specific off-peak pricing windows.
 *
 * Currently only DeepSeek offers explicit time-based discounts:
 *   - V3/V4: 50% off during 16:30–00:30 UTC daily
 *   - R1: 75% off during 16:30–00:30 UTC daily
 *   - This window coincides with US business hours (11:30am–7:30pm EST)
 *
 * Other providers use batch APIs (50% off) or prompt caching for discounts,
 * but these are not time-gated. The router tracks them via `async_eligible`
 * on SpawnIntent (future) and cache-aware selection.
 *
 * @see https://api-docs.deepseek.com/quick_start/pricing
 */
interface OffPeakWindow {
  /** Provider ID this window applies to. */
  provider: string;
  /** UTC hour the off-peak window starts (inclusive). */
  startHourUtc: number;
  /** UTC minute the window starts. */
  startMinuteUtc: number;
  /** UTC hour the off-peak window ends (exclusive). */
  endHourUtc: number;
  /** UTC minute the window ends. */
  endMinuteUtc: number;
  /** Discount multiplier during off-peak (e.g. 0.5 = 50% off). */
  discount: number;
}

const OFF_PEAK_WINDOWS: OffPeakWindow[] = [
  {
    provider: 'deepseek',
    startHourUtc: 16, startMinuteUtc: 30,
    endHourUtc: 0, endMinuteUtc: 30,
    discount: 0.5, // V3/V4: 50% off; R1 is 75% off but we use conservative estimate
  },
];

/**
 * Check if a provider is currently in an off-peak window.
 * Returns the discount multiplier (0-1, lower = cheaper) or null if not off-peak.
 */
function getOffPeakDiscount(provider: string, now: Date = new Date()): number | null {
  for (const window of OFF_PEAK_WINDOWS) {
    if (window.provider !== provider) continue;

    const h = now.getUTCHours();
    const m = now.getUTCMinutes();
    const currentMinutes = h * 60 + m;
    const startMinutes = window.startHourUtc * 60 + window.startMinuteUtc;
    const endMinutes = window.endHourUtc * 60 + window.endMinuteUtc;

    // Handle overnight windows (start > end means wraps past midnight)
    const inWindow = endMinutes <= startMinutes
      ? currentMinutes >= startMinutes || currentMinutes < endMinutes
      : currentMinutes >= startMinutes && currentMinutes < endMinutes;

    if (inWindow && window.discount > 0 && window.discount <= 1) return window.discount;
  }
  return null;
}

/** Check if any provider has an off-peak window active now. */
function isOffPeak(): boolean {
  const now = new Date();
  return OFF_PEAK_WINDOWS.some(w => getOffPeakDiscount(w.provider, now) !== null);
}

// ── Cost/Quality Scoring ──────────────────────────────────────────

/**
 * Cost sensitivity weights for the composite score.
 * Higher cost_weight = more influence from cost in selection.
 */
const COST_WEIGHTS = {
  low: { quality_weight: 0.9, cost_weight: 0.1 },
  normal: { quality_weight: 0.65, cost_weight: 0.35 },
  high: { quality_weight: 0.3, cost_weight: 0.7 },
} as const;

/** Effort → minimum quality threshold. Below this, a model is disqualified. */
const EFFORT_QUALITY_FLOOR: Record<Effort, number> = {
  deep: 0.85,
  standard: 0.70,
  minimal: 0.0,
};

function effectiveCost(model: ModelCapability): number {
  return model.cost_per_million_input + model.cost_per_million_output * 3;
}

/**
 * Normalize cost to a 0-1 score (inverted: lower cost = higher score).
 * Uses the max cost among candidates for normalization.
 */
function costScore(model: ModelCapability, maxCost: number): number {
  if (maxCost === 0) return 1;
  return 1 - effectiveCost(model) / maxCost;
}

// ── Plugin State ──────────────────────────────────────────────────

let scoreBridge: ScoreBridge = createDefaultScoreBridge();
let offPeakEnabled = false;
let modelCatalog: ModelCapability[] = [...DEFAULT_MODELS];

// ── Plugin ────────────────────────────────────────────────────────

/**
 * Maestro router — intelligent, quality-informed, cost-aware.
 * The recommended default for production deployments.
 */
export default {
  id: 'maestro',
  name: 'Maestro Router',

  async initialize(config: Record<string, unknown>): Promise<void> {
    if (typeof config.off_peak_enabled === 'boolean') {
      offPeakEnabled = config.off_peak_enabled;
    }

    if (Array.isArray(config.models)) {
      modelCatalog = config.models as ModelCapability[];
    }

    // Accept an injected score bridge (for testing or custom integrations)
    if (config.score_bridge && typeof config.score_bridge === 'object') {
      scoreBridge = config.score_bridge as ScoreBridge;
    }
  },

  async select(intent: SpawnIntent): Promise<ModelSelection> {
    // 1. Filter by required capabilities
    let candidates = modelCatalog.filter(m => {
      if (intent.requires?.length) {
        return intent.requires.every(req => m.capabilities.includes(req));
      }
      return true;
    });

    // 2. Exclude blocked providers
    if (intent.exclude_providers?.length) {
      candidates = candidates.filter(m => !intent.exclude_providers!.includes(m.provider));
    }

    if (candidates.length === 0) {
      throw new NoModelAvailableError(intent);
    }

    // 3. Get quality data from score bridge
    const scored = candidates.map(m => {
      const qualityData = scoreBridge.getQuality(m.provider, m.model);
      return {
        model: m,
        quality: qualityData?.quality ?? 0.5, // default to 0.5 if no data
      };
    });

    // 4. Apply quality floor based on effort level
    const qualityFloor = EFFORT_QUALITY_FLOOR[intent.effort];
    const qualified = scored.filter(s => s.quality >= qualityFloor);

    // If nothing passes the quality floor, use all candidates (graceful degradation)
    const pool = qualified.length > 0 ? qualified : scored;

    // 5. Off-peak optimization: provider-specific discounts
    //    When off-peak is enabled, models from providers with active off-peak windows
    //    get a cost boost (their effective cost is reduced by the discount multiplier).
    const now = new Date();
    const anyOffPeak = offPeakEnabled && isOffPeak();
    const effectiveSensitivity =
      anyOffPeak && intent.cost_sensitivity !== 'low'
        ? 'high'
        : intent.cost_sensitivity;

    // 6. Compute composite score for each candidate
    const weights = COST_WEIGHTS[effectiveSensitivity];

    // Apply provider-specific off-peak discounts to effective cost
    const adjustedPool = pool.map(s => {
      const discount = offPeakEnabled ? getOffPeakDiscount(s.model.provider, now) : null;
      const adjustedCost = discount !== null
        ? effectiveCost(s.model) * discount
        : effectiveCost(s.model);
      return { ...s, adjustedCost };
    });

    const maxCost = Math.max(...adjustedPool.map(s => s.adjustedCost));

    const ranked = adjustedPool.map(s => {
      const cScore = maxCost === 0 ? 1 : 1 - s.adjustedCost / maxCost;
      let composite =
        s.quality * weights.quality_weight +
        cScore * weights.cost_weight;

      // Provider preference bonus (5% boost)
      if (intent.prefer_provider && s.model.provider === intent.prefer_provider) {
        composite *= 1.05;
      }

      return { ...s, composite };
    });

    // 7. Sort by composite score descending
    ranked.sort((a, b) => b.composite - a.composite);

    const best = ranked[0];
    const discount = offPeakEnabled ? getOffPeakDiscount(best.model.provider, now) : null;
    const offPeakNote = discount !== null
      ? ` (off-peak: ${best.model.provider} ${Math.round((1 - discount) * 100)}% discount)`
      : '';

    return {
      router: 'maestro',
      provider: best.model.provider,
      harness: 'api',
      model: best.model.model,
      config: `effort:${intent.effort}`,
      estimated_cost: effectiveCost(best.model) / 1_000_000,
      quality_score: best.quality,
      rationale:
        `Maestro selection: ${best.model.model} ` +
        `(quality=${best.quality.toFixed(2)}, composite=${best.composite.toFixed(3)}) ` +
        `for effort=${intent.effort}, cost_sensitivity=${effectiveSensitivity}` +
        offPeakNote,
    };
  },

  async models(): Promise<ModelCapability[]> {
    return [...modelCatalog];
  },

  async healthy(): Promise<boolean> {
    return true;
  },

  async dispose(): Promise<void> {
    scoreBridge = createDefaultScoreBridge();
    offPeakEnabled = false;
    modelCatalog = [...DEFAULT_MODELS];
  },
} satisfies RouterPlugin;
