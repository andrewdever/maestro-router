/**
 * @maestro/router — Core type definitions.
 *
 * Defines the RouterPlugin contract, SpawnIntent/ModelSelection types,
 * and the plugin registry. Mirrors the plugin pattern from @maestro/sandbox
 * and @maestro/db: dynamic registry, contract test suite, lazy imports.
 *
 * The full routing resolution chain is:
 *   router → provider → harness → model → config
 *
 * Produces canonical slugs like:
 *   openrouter-anthropic-api-opus-4-6-effort:deep
 */

// ── Effort & Cost ──────────────────────────────────────────────────

/** Task effort level — drives thinking budget, timeout, and token allocation. */
export type Effort = 'minimal' | 'standard' | 'deep';

/** Cost sensitivity — influences model selection when multiple qualify. */
export type CostSensitivity = 'low' | 'normal' | 'high';

// ── SpawnIntent ────────────────────────────────────────────────────

/**
 * What the orchestrator needs from routing.
 *
 * SpawnIntent carries capability requirements and cost constraints.
 * The router plugin resolves this to a concrete ModelSelection.
 * Task definitions never contain model names — only intents.
 *
 * @example
 * ```typescript
 * const intent: SpawnIntent = {
 *   effort: 'deep',
 *   cost_sensitivity: 'normal',
 *   requires: ['thinking', 'tool_use'],
 *   prefer_provider: 'anthropic',
 * };
 * ```
 */
export interface SpawnIntent {
  /** Task effort level. Drives thinking budget, timeout, token budget. */
  effort: Effort;
  /** Cost sensitivity. 'high' = prefer cheapest qualifying model. */
  cost_sensitivity: CostSensitivity;
  /** Required model capabilities (e.g. 'thinking', 'tool_use', 'vision'). */
  requires?: string[];
  /** Preferred provider (soft preference, not a hard constraint). */
  prefer_provider?: string;
  /** Providers to exclude from selection. */
  exclude_providers?: string[];
}

// ── ModelSelection ─────────────────────────────────────────────────

/**
 * The full routing resolution result.
 *
 * Contains the 5-part chain: router → provider → harness → model → config.
 * The canonical slug format is traceable across logs, metrics, and audit trails.
 *
 * @example
 * ```typescript
 * const selection: ModelSelection = {
 *   router: 'maestro',
 *   provider: 'anthropic',
 *   harness: 'api',
 *   model: 'opus-4-6',
 *   config: 'effort:deep',
 *   estimated_cost: 0.045,
 *   rationale: 'Opus selected for deep effort with thinking requirement',
 *   quality_score: 0.94,
 * };
 * // slug: maestro-anthropic-api-opus-4-6-effort:deep
 * ```
 */
export interface ModelSelection {
  /** Router plugin that made the selection (e.g. 'maestro', 'openrouter', 'direct'). */
  router: string;
  /** Provider (e.g. 'anthropic', 'openai', 'google'). */
  provider: string;
  /** Harness (e.g. 'api', 'claude-code'). */
  harness: string;
  /** Model identifier (e.g. 'opus-4-6', 'sonnet-4-6', 'gpt-5'). */
  model: string;
  /** Configuration string (e.g. 'effort:deep', 'effort:standard'). */
  config: string;
  /** Estimated cost in USD for this request (optional). */
  estimated_cost?: number;
  /** Human-readable explanation of why this model was chosen. */
  rationale?: string;
  /** Quality score from @maestro/score (0-1, higher = better). */
  quality_score?: number;
}

// ── ModelCapability ────────────────────────────────────────────────

/**
 * A model's capabilities and pricing metadata.
 *
 * Sourced differently per plugin: DirectPlugin reads from config,
 * OpenRouterPlugin fetches from API, custom plugins source as they choose.
 *
 * @example
 * ```typescript
 * const capability: ModelCapability = {
 *   provider: 'anthropic',
 *   model: 'claude-opus-4-6',
 *   capabilities: ['thinking', 'tool_use', 'vision'],
 *   context_window: 200000,
 *   max_thinking_budget: 32000,
 *   cost_per_million_input: 15.0,
 *   cost_per_million_output: 75.0,
 * };
 * ```
 */
export interface ModelCapability {
  /** Provider identifier. */
  provider: string;
  /** Model identifier. */
  model: string;
  /** Supported capabilities (e.g. 'thinking', 'tool_use', 'vision', 'code'). */
  capabilities: string[];
  /** Maximum context window in tokens. */
  context_window: number;
  /** Maximum thinking budget in tokens. 0 for models without thinking support. */
  max_thinking_budget: number;
  /** Cost per million input tokens in USD. */
  cost_per_million_input: number;
  /** Cost per million output tokens in USD. */
  cost_per_million_output: number;
}

// ── RouterPlugin ───────────────────────────────────────────────────

/**
 * The router plugin contract.
 *
 * Every router plugin implements this interface. Any conforming
 * implementation is valid — OpenRouter.ai, a custom corporate proxy,
 * a cost-optimizing wrapper, or a simple static mapping.
 *
 * Third-party plugins are packages that export a `RouterPlugin`:
 * ```typescript
 * import type { RouterPlugin } from '@maestro/router'
 * export const myRouter: RouterPlugin = { ... }
 * ```
 */
export interface RouterPlugin {
  /** Unique identifier, e.g. 'openrouter', 'direct', 'maestro'. */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;

  /**
   * Select a model for the given intent.
   *
   * This is the core routing operation. The plugin examines the
   * SpawnIntent and returns a ModelSelection with the full
   * router-provider-harness-model-config chain.
   */
  select(intent: SpawnIntent): Promise<ModelSelection>;

  /** List available models and their capabilities. */
  models(): Promise<ModelCapability[]>;

  /** Health check — can this plugin currently fulfill requests? */
  healthy(): Promise<boolean>;

  /**
   * Optional: called once on registration, for API key validation,
   * cache warming, etc. Config comes from maestro.config.ts routing.config.
   */
  initialize?(config: Record<string, unknown>): Promise<void>;

  /** Optional: teardown — release connections, flush caches. */
  dispose?(): Promise<void>;
}

// ── Plugin Registry Types ──────────────────────────────────────────

/** Lazy plugin loader — dynamic import for tree-shaking. */
export type PluginLoader = () => Promise<{ default: RouterPlugin }>;

/** Map of plugin id → lazy loader. */
export type PluginLoaderRegistry = Record<string, PluginLoader>;

// ── Routing Config ─────────────────────────────────────────────────

/**
 * Routing configuration from maestro.config.ts.
 *
 * @example
 * ```typescript
 * routing: {
 *   plugin: 'maestro',
 *   fallback: 'direct',
 *   config: {
 *     off_peak_enabled: true,
 *   },
 * }
 * ```
 */
export interface RoutingConfig {
  /** Active router plugin ID. Default: 'direct'. */
  plugin?: string;
  /** Fallback plugin ID when primary fails. Default: 'direct'. */
  fallback?: string;
  /** Plugin-specific config passed to plugin.initialize(). */
  config?: Record<string, unknown>;
}

// ── Execution Config ───────────────────────────────────────────────

/**
 * Derived execution configuration.
 *
 * After routing + harness selection, the orchestrator derives
 * concrete execution parameters from the effort level and model limits.
 */
export interface ExecutionConfig {
  /** Thinking token budget. Clamped to model max. */
  thinking_budget: number;
  /** Request timeout in milliseconds. */
  timeout_ms: number;
  /** Knowledge token budget for context. */
  knowledge_token_budget: number;
}

/** Effort → default execution parameters (before model clamping). */
export const EFFORT_DEFAULTS: Record<Effort, ExecutionConfig> = {
  minimal: { thinking_budget: 0, timeout_ms: 120_000, knowledge_token_budget: 2_000 },
  standard: { thinking_budget: 4_000, timeout_ms: 300_000, knowledge_token_budget: 8_000 },
  deep: { thinking_budget: 16_000, timeout_ms: 900_000, knowledge_token_budget: 16_000 },
};

// ── Habit Match ────────────────────────────────────────────────────

/**
 * A habit match result.
 *
 * When a habit matches, the router short-circuits entirely:
 * no plugin invoked, no tokens spent, no provider API call.
 */
export interface HabitMatch {
  /** The habit entity slug that matched. */
  habit_slug: string;
  /** The local handler function or code path. */
  handler: string;
  /** Confidence of the match (0-1). */
  confidence: number;
}

// ── Utility ────────────────────────────────────────────────────────

/**
 * Build the canonical routing slug from a ModelSelection.
 *
 * Format: `{router}-{provider}-{harness}-{model}-{config}`
 * Example: `openrouter-anthropic-api-opus-4-6-effort:deep`
 */
export function toSlug(selection: ModelSelection): string {
  return `${selection.router}-${selection.provider}-${selection.harness}-${selection.model}-${selection.config}`;
}
