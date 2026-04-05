/**
 * @maestro/router — Score engine integration bridge.
 *
 * Isolates the @maestro/score dependency. The router uses score data
 * to make quality-informed routing decisions. This module provides
 * the interface and a default implementation.
 *
 * V1: Types + static quality estimates.
 * V2: Closed feedback loop — score engine results update routing weights.
 *
 * When @maestro/router runs standalone (without @maestro/score),
 * the bridge returns default quality estimates.
 */

// ── Score Data Types (standalone — no @maestro/score import) ───────

/**
 * Quality data for a model+task-type pair.
 *
 * This type is defined here (not imported from @maestro/score)
 * so @maestro/router can ship as a standalone package.
 */
export interface ModelQualityData {
  /** Provider identifier. */
  provider: string;
  /** Model identifier. */
  model: string;
  /** Task type (e.g. 'code-review', 'summarization', 'analysis'). */
  task_type: string;
  /** Quality score (0-1, higher = better). */
  quality: number;
  /** Number of evaluations this score is based on. */
  sample_size: number;
  /** When this data was last updated. */
  updated_at: string;
}

// ── Score Bridge Interface ─────────────────────────────────────────

/**
 * Interface for score data providers.
 *
 * Implementations can source quality data from:
 * - Static configuration (default)
 * - @maestro/score package (when available)
 * - External APIs
 * - Historical execution data
 */
export interface ScoreBridge {
  /**
   * Get quality data for a model on a given task type.
   * Returns null if no data is available.
   */
  getQuality(provider: string, model: string, taskType?: string): ModelQualityData | null;

  /**
   * Get all quality data for a provider's models.
   */
  getProviderQuality(provider: string): ModelQualityData[];
}

// ── Default Implementation ─────────────────────────────────────────

/**
 * Static score bridge with configurable quality estimates.
 *
 * Used when @maestro/score is not available or for initial routing
 * before execution data exists. Quality values are based on
 * published benchmark data and model pricing tiers.
 */
export class StaticScoreBridge implements ScoreBridge {
  private readonly data = new Map<string, ModelQualityData>();

  /** Register quality data for a model. */
  register(entry: ModelQualityData): void {
    const key = this.key(entry.provider, entry.model, entry.task_type);
    this.data.set(key, entry);
  }

  /** Register multiple entries at once. */
  registerAll(entries: ModelQualityData[]): void {
    for (const entry of entries) this.register(entry);
  }

  getQuality(provider: string, model: string, taskType?: string): ModelQualityData | null {
    // Try exact match first
    if (taskType) {
      const exact = this.data.get(this.key(provider, model, taskType));
      if (exact) return exact;
    }

    // Fall back to general (no task type)
    return this.data.get(this.key(provider, model, '*')) ?? null;
  }

  getProviderQuality(provider: string): ModelQualityData[] {
    return Array.from(this.data.values()).filter(d => d.provider === provider);
  }

  private key(provider: string, model: string, taskType: string): string {
    return `${provider}:${model}:${taskType}`;
  }
}

// ── Default Quality Estimates ──────────────────────────────────────

/**
 * Create a StaticScoreBridge pre-populated with baseline quality
 * estimates for common models. Based on published benchmarks.
 */
export function createDefaultScoreBridge(): StaticScoreBridge {
  const bridge = new StaticScoreBridge();
  const now = new Date().toISOString();

  const defaults: Omit<ModelQualityData, 'updated_at'>[] = [
    { provider: 'anthropic', model: 'claude-opus-4-6', task_type: '*', quality: 0.95, sample_size: 0 },
    { provider: 'anthropic', model: 'claude-sonnet-4-6', task_type: '*', quality: 0.90, sample_size: 0 },
    { provider: 'anthropic', model: 'claude-haiku-4-5', task_type: '*', quality: 0.78, sample_size: 0 },
    { provider: 'openai', model: 'gpt-5', task_type: '*', quality: 0.93, sample_size: 0 },
    { provider: 'openai', model: 'gpt-4.1', task_type: '*', quality: 0.88, sample_size: 0 },
    { provider: 'openai', model: 'gpt-4.1-mini', task_type: '*', quality: 0.80, sample_size: 0 },
    { provider: 'google', model: 'gemini-2.5-pro', task_type: '*', quality: 0.91, sample_size: 0 },
    { provider: 'google', model: 'gemini-2.5-flash', task_type: '*', quality: 0.82, sample_size: 0 },
  ];

  bridge.registerAll(defaults.map(d => ({ ...d, updated_at: now })));
  return bridge;
}
