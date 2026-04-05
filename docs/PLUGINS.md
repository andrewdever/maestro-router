# Plugin Guide

This document covers the shipped plugins, how to configure them, and how to build your own.

---

## Table of Contents

1. [Plugin Architecture](#1-plugin-architecture)
2. [Shipped Plugins](#2-shipped-plugins)
3. [Plugin Comparison Matrix](#3-plugin-comparison-matrix)
4. [Decision Matrix](#4-decision-matrix)
5. [Plugin Development](#5-plugin-development)
6. [Contract Tests](#6-contract-tests)
7. [Plugin Lifecycle](#7-plugin-lifecycle)

---

## 1. Plugin Architecture

Every plugin implements the `RouterPlugin` interface:

```typescript
interface RouterPlugin {
  /** Unique plugin identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Route a SpawnIntent to a ModelSelection. */
  select(intent: SpawnIntent): Promise<ModelSelection>;
  /** List available models with capabilities and pricing. */
  models(): Promise<ModelCapability[]>;
  /** Check if the plugin is healthy and ready to serve requests. */
  healthy(): Promise<boolean>;
  /** Initialize with configuration (optional). */
  initialize?(config: Record<string, unknown>): Promise<void>;
  /** Dispose resources (optional). */
  dispose?(): Promise<void>;
}
```

Plugins are loaded lazily via dynamic `import()`. The `ROUTER_PLUGINS` registry maps plugin IDs to loader functions:

```typescript
const ROUTER_PLUGINS = {
  direct:    () => import('./direct.js'),
  maestro:   () => import('./maestro.js'),
  openrouter:() => import('./openrouter.js'),
  requesty:  () => import('./requesty.js'),
  portkey:   () => import('./portkey.js'),
  litellm:   () => import('./litellm.js'),
  mock:      () => import('./mock.js'),
};
```

Only the plugin you configure is loaded. Unused plugins are never imported (tree-shakeable).

---

## 2. Shipped Plugins

### Direct Plugin

**ID:** `direct` | **Status:** Stable | **API Key:** No

The offline-first, zero-config fallback. Uses a static model catalog with deterministic selection based on effort level. Always healthy, always available. This is the universal last resort.

**When to use:** Development, testing, air-gapped environments, or as a fallback for any other plugin.

**Selection logic:**
- `cost_sensitivity: 'high'` -- cheapest qualifying model
- Otherwise -- effort-based tier ordering (deep: Opus/GPT-5, standard: Sonnet/Gemini Pro, minimal: Haiku/Flash)

**Limitations:**
- No live model discovery
- No provider-specific optimizations
- Static pricing data (updated at release time)

---

### Maestro Plugin

**ID:** `maestro` | **Status:** Stable | **API Key:** No

Quality-informed routing with score bridge integration. Computes a composite score weighting quality and cost based on `cost_sensitivity`. Supports off-peak pricing optimization.

**When to use:** Production deployments where cost-quality tradeoff matters and you want score-driven model selection.

**Unique features:**
- Composite score: `(quality_weight * quality) - (cost_weight * normalized_cost)`
- Off-peak pricing: provider-specific time windows reduce effective cost
- Score bridge integration: reads quality data from `@maestro/score` (optional)

**Limitations:**
- Quality scores are static by default (StaticScoreBridge). Real-time quality requires implementing a custom ScoreBridge.

---

### OpenRouter Plugin

**ID:** `openrouter` | **Status:** Stable | **API Key:** Yes

Multi-provider aggregator via [openrouter.ai](https://openrouter.ai). Aggregates 200+ models from dozens of providers behind a single API key. Live model discovery with 5-minute cache TTL.

**When to use:** You want access to many providers without managing individual API keys.

**Unique features:**
- Live model discovery via `/models` API endpoint
- Automatic model catalog parsing with capability inference
- Cache coalescing (concurrent `models()` calls share one HTTP request)

**Limitations:**
- Requires API key
- Depends on OpenRouter's availability
- Pricing includes OpenRouter's markup (currently 0%)

---

### Requesty Plugin

**ID:** `requesty` | **Status:** Stable | **API Key:** Yes

Smart routing via [requesty.ai](https://requesty.ai) with sub-20ms failover between providers.

**When to use:** Latency-sensitive applications where fast failover matters.

**Unique features:**
- Sub-20ms provider failover
- Intelligent load balancing

**Limitations:**
- Requires API key
- Currently uses static model catalog (live discovery validates availability only)

---

### Portkey Plugin

**ID:** `portkey` | **Status:** Stable | **API Key:** Yes

Open-source AI gateway via [portkey.ai](https://portkey.ai). 250+ models, 45+ providers. Supports self-hosted deployment for data sovereignty.

**When to use:** Enterprise environments requiring self-hosted gateways, or teams that need Portkey's guardrails and canary deployment features.

**Unique features:**
- Self-hosted option (set `base_url` to your gateway)
- Virtual key support for team-level key management
- Portkey-specific headers (`x-portkey-api-key`, `x-portkey-virtual-key`)

**Limitations:**
- Requires API key (even self-hosted)
- Currently uses static model catalog

---

### LiteLLM Plugin

**ID:** `litellm` | **Status:** Stable | **API Key:** Proxy mode

Universal gateway via [LiteLLM](https://github.com/BerriAI/litellm). 2500+ models, 100+ providers. OpenAI-compatible interface. Operates in proxy or SDK mode.

**When to use:** Teams already running a LiteLLM proxy, or those wanting the broadest model coverage.

**Unique features:**
- Dual mode: proxy (HTTP to LiteLLM server) or SDK (in-process, requires Python)
- Broadest model support (2500+ models)
- OpenAI-compatible API format

**Limitations:**
- Proxy mode requires a running LiteLLM server
- SDK mode requires Python runtime
- Currently uses static model catalog

---

### Mock Plugin

**ID:** `mock` | **Status:** Stable | **API Key:** No

Deterministic test router with pre-configured responses, call tracking, and failure simulation.

**When to use:** Unit tests, integration tests, and CI pipelines.

**Unique features:**
- `setResponse(effort, selection)` -- configure what `select()` returns
- `getCalls()` -- inspect all intents that were routed
- `clearCalls()` -- reset call history
- `setHealthy(boolean)` -- simulate health state changes
- `setError(error)` -- simulate plugin failures

---

## 3. Plugin Comparison Matrix

| Feature | Direct | Maestro | OpenRouter | Requesty | Portkey | LiteLLM |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| Offline operation | Yes | Yes | No | No | No | No |
| API key required | No | No | Yes | Yes | Yes | Proxy |
| Live model discovery | No | No | Yes | Partial | Partial | Partial |
| Quality scoring | No | Yes | No | No | No | No |
| Off-peak pricing | No | Yes | No | No | No | No |
| Self-hosted | N/A | N/A | No | No | Yes | Yes |
| Model count (static) | 7 | 7 | 8 | 7 | 7 | 9 |
| Cache coalescing | N/A | N/A | Yes | Yes | Yes | Yes |
| Base URL configurable | No | No | Yes | Yes | Yes | Yes |

---

## 4. Decision Matrix

| Scenario | Recommended Plugin | Fallback | Rationale |
|:---|:---|:---|:---|
| Development / prototyping | `direct` | -- | Zero config, zero cost, instant |
| Production, single provider | `openrouter` | `direct` | Unified billing, wide model access |
| Production, cost-optimized | `maestro` | `direct` | Quality-cost scoring, off-peak |
| Enterprise, self-hosted | `portkey` | `direct` | Data sovereignty, guardrails |
| Existing LiteLLM infrastructure | `litellm` | `direct` | Leverage existing proxy |
| Latency-critical | `requesty` | `direct` | Sub-20ms failover |
| Testing / CI | `mock` | -- | Deterministic, fast |
| Air-gapped / offline | `direct` + habits | -- | No network dependencies |

---

## 5. Plugin Development

### Step-by-Step

**Step 1:** Create `src/plugins/your-plugin.ts`:

```typescript
import type { RouterPlugin, SpawnIntent, ModelSelection, ModelCapability } from '../types.js';

const MY_MODELS: ModelCapability[] = [
  {
    provider: 'my-provider',
    model: 'my-model-large',
    capabilities: ['thinking', 'tool_use', 'code'],
    context_window: 200_000,
    max_thinking_budget: 16_000,
    cost_per_million_input: 5.0,
    cost_per_million_output: 15.0,
  },
  // ... more models
];

let apiKey: string | null = null;

export default {
  id: 'my-plugin',
  name: 'My Plugin',

  async initialize(config: Record<string, unknown>): Promise<void> {
    if (typeof config.api_key === 'string' && config.api_key.length > 0) {
      apiKey = config.api_key;
    }
  },

  async select(intent: SpawnIntent): Promise<ModelSelection> {
    // 1. Filter by capabilities
    let candidates = MY_MODELS.filter(m => {
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
      throw new Error('No model matches requirements');
    }

    // 3. Select (your logic here)
    const picked = candidates[0];

    return {
      router: 'my-plugin',
      provider: picked.provider,
      harness: 'api',
      model: picked.model,
      config: `effort:${intent.effort}`,
      estimated_cost: (picked.cost_per_million_input + picked.cost_per_million_output) / 1_000_000,
      rationale: `Selected ${picked.model} for effort=${intent.effort}`,
    };
  },

  async models(): Promise<ModelCapability[]> {
    return [...MY_MODELS];
  },

  async healthy(): Promise<boolean> {
    return apiKey !== null;
  },

  async dispose(): Promise<void> {
    apiKey = null;
  },
} satisfies RouterPlugin;
```

**Step 2:** Register the loader in `src/plugins/registry.ts`:

```typescript
export const ROUTER_PLUGINS: PluginLoaderRegistry = {
  // ... existing plugins
  'my-plugin': () => import('./my-plugin.js'),
};
```

**Step 3:** Export from `src/index.ts` (if you want it publicly accessible).

**Step 4:** Run contract tests:

```bash
npx vitest run src/__tests__/contract/
```

**Step 5:** Add plugin-specific tests in `src/__tests__/unit/`.

**Step 6:** Document in this file and in README.md.

### Implementation Checklist

- [ ] `select()` returns valid `ModelSelection` for all effort/cost_sensitivity combinations
- [ ] `models()` returns a non-empty `ModelCapability[]`
- [ ] `healthy()` returns `true` when configured, `false` when not
- [ ] `initialize()` validates config and sets state
- [ ] `dispose()` resets all module-level state
- [ ] API keys never appear in `rationale` strings or error messages
- [ ] Base URLs are validated with `validateBaseUrl()` before use
- [ ] Model cache uses promise coalescing to prevent stampedes
- [ ] Required capabilities in the intent are respected in filtering

---

## 6. Contract Tests

The contract test suite (`src/__tests__/contract/router-contract.test.ts`) validates every plugin against a standard set of behavioral requirements. All shipped plugins pass this suite, and custom plugins should too.

**What the contract tests verify:**

- `select()` returns a `ModelSelection` with all 5 required fields for every effort/cost_sensitivity pair
- `models()` returns an array with at least one `ModelCapability`
- `healthy()` returns a boolean (not undefined, not a string)
- `initialize()` does not throw with valid config
- `dispose()` does not throw
- Capability filtering works: if the intent requires `['thinking']`, the selected model must support it
- Cost sensitivity affects selection: `high` sensitivity should not select the most expensive model when cheaper alternatives exist

---

## 7. Plugin Lifecycle

```
  register/load
       |
       v
  +-----------+
  | Registered |
  +-----------+
       |
  initialize(config)
       |
       v
  +-------------+
  | Initialized |  <-- healthy() returns true
  +-------------+
       |
  select(intent) -- called many times
       |
  dispose()
       |
       v
  +----------+
  | Disposed |  <-- state reset, healthy() returns false
  +----------+
```

> **Note:** Plugins use the singleton pattern with module-level state. `initialize()` sets state, `dispose()` resets it. The `RouterRegistry` manages this lifecycle. Do not import plugins directly and call lifecycle methods outside of the registry.
