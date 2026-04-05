/**
 * @maestro/router — Mock Router plugin.
 *
 * Deterministic test router for unit tests, integration tests,
 * and development. Returns preconfigured responses based on intent
 * hashing, or a sensible default when no match is found.
 *
 * Usage:
 * ```typescript
 * const mock = (await import('./plugins/mock.js')).default;
 * await mock.initialize({
 *   responses: {
 *     'deep:normal': {
 *       router: 'mock', provider: 'test', harness: 'api',
 *       model: 'test-large', config: 'effort:deep',
 *     },
 *   },
 * });
 * const selection = await mock.select({ effort: 'deep', cost_sensitivity: 'normal' });
 * ```
 *
 * **Singleton pattern:** This module uses module-level `let` variables for state
 * (responses, calls). Because ES modules are cached after first import,
 * there is exactly one instance per process. `initialize()` sets state,
 * `dispose()` resets it. Do not import this module from multiple entry points
 * expecting independent state — use the RouterRegistry for managed lifecycle.
 */

import type {
  RouterPlugin,
  SpawnIntent,
  ModelSelection,
  ModelCapability,
} from '../types.js';

// ── Static Mock Models ────────────────────────────────────────────

const MOCK_MODELS: ModelCapability[] = [
  {
    provider: 'mock',
    model: 'mock-large',
    capabilities: ['thinking', 'tool_use', 'vision', 'code'],
    context_window: 200_000,
    max_thinking_budget: 32_000,
    cost_per_million_input: 0.0,
    cost_per_million_output: 0.0,
  },
  {
    provider: 'mock',
    model: 'mock-small',
    capabilities: ['tool_use', 'code'],
    context_window: 128_000,
    max_thinking_budget: 0,
    cost_per_million_input: 0.0,
    cost_per_million_output: 0.0,
  },
  {
    provider: 'mock',
    model: 'mock-vision',
    capabilities: ['vision', 'tool_use'],
    context_window: 128_000,
    max_thinking_budget: 0,
    cost_per_million_input: 0.0,
    cost_per_million_output: 0.0,
  },
];

// ── Plugin State ──────────────────────────────────────────────────

/**
 * Preconfigured responses.
 * Key: intent hash (e.g. 'deep:normal', 'standard:high')
 * Value: ModelSelection to return
 */
let responses = new Map<string, ModelSelection>();

/** Call log for test assertions. */
let selectCalls: SpawnIntent[] = [];

// ── Helpers ───────────────────────────────────────────────────────

/** Hash an intent into a lookup key. */
function intentKey(intent: SpawnIntent): string {
  const parts: string[] = [intent.effort, intent.cost_sensitivity];
  if (intent.requires?.length) {
    parts.push(intent.requires.sort().join('+'));
  }
  if (intent.prefer_provider) {
    parts.push(intent.prefer_provider);
  }
  return parts.join(':');
}

/** Default mock selection when no preconfigured response matches. */
function defaultSelection(intent: SpawnIntent): ModelSelection {
  return {
    router: 'mock',
    provider: 'mock',
    harness: 'api',
    model: intent.effort === 'deep' ? 'mock-large' : 'mock-small',
    config: `effort:${intent.effort}`,
    estimated_cost: 0,
    rationale: `Mock selection (default) for effort=${intent.effort}`,
    quality_score: 1.0,
  };
}

// ── Plugin ────────────────────────────────────────────────────────

/**
 * Mock router — deterministic, zero-cost, for testing.
 * Returns preconfigured responses or sensible defaults.
 * Records all select() calls for test assertions.
 */
const mockPlugin = {
  id: 'mock',
  name: 'Mock Router',

  async initialize(config: Record<string, unknown>): Promise<void> {
    responses = new Map();
    selectCalls = [];

    // Accept a responses map: { [intentKey]: ModelSelection }
    if (config.responses && typeof config.responses === 'object') {
      const entries = config.responses as Record<string, ModelSelection>;
      for (const [key, value] of Object.entries(entries)) {
        responses.set(key, value);
      }
    }
  },

  async select(intent: SpawnIntent): Promise<ModelSelection> {
    selectCalls.push({ ...intent });

    // Try exact match first
    const key = intentKey(intent);
    const preconfigured = responses.get(key);
    if (preconfigured) {
      return { ...preconfigured };
    }

    // Try simpler key (effort:cost_sensitivity only)
    const simpleKey = `${intent.effort}:${intent.cost_sensitivity}`;
    const simpleMatch = responses.get(simpleKey);
    if (simpleMatch) {
      return { ...simpleMatch };
    }

    // Default
    return defaultSelection(intent);
  },

  async models(): Promise<ModelCapability[]> {
    return [...MOCK_MODELS];
  },

  async healthy(): Promise<boolean> {
    return true;
  },

  async dispose(): Promise<void> {
    responses = new Map();
    selectCalls = [];
  },

  // ── Test Helpers (not part of RouterPlugin interface) ───────────

  /** Get all recorded select() calls. For test assertions. */
  getCalls(): SpawnIntent[] {
    return [...selectCalls];
  },

  /** Clear recorded calls without full dispose. */
  clearCalls(): void {
    selectCalls = [];
  },

  /** Add a single preconfigured response. */
  setResponse(key: string, selection: ModelSelection): void {
    responses.set(key, selection);
  },
} satisfies RouterPlugin & {
  getCalls(): SpawnIntent[];
  clearCalls(): void;
  setResponse(key: string, selection: ModelSelection): void;
};

export default mockPlugin;
