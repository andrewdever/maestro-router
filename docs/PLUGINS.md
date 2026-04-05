# Plugin Guide

This document covers what plugins do, how the shipped plugins work, and how to build your own.

---

## Table of Contents

1. [What Plugins Do (And Don't Do)](#1-what-plugins-do-and-dont-do)
2. [Plugin Architecture](#2-plugin-architecture)
3. [Shipped Plugins](#3-shipped-plugins)
4. [Plugin Comparison Matrix](#4-plugin-comparison-matrix)
5. [Decision Matrix](#5-decision-matrix)
6. [Plugin Development](#6-plugin-development)
7. [Contract Tests](#7-contract-tests)
8. [Plugin Lifecycle](#8-plugin-lifecycle)

---

## 1. What Plugins Do (And Don't Do)

A plugin is a **selection strategy**. It answers one question: given what the caller needs, which provider and model should handle it?

Each plugin brings a different source of intelligence to that decision:

- **DirectPlugin** uses a static model catalog. No network calls, deterministic answers.
- **MaestroPlugin** adds quality scoring and off-peak pricing awareness.
- **OpenRouterPlugin** queries openrouter.ai's model catalog API to get live pricing and availability data for 200+ models, then uses that data to make a better-informed local selection.
- **PortkeyPlugin** queries portkey.ai's catalog (or your self-hosted gateway) for model metadata.

**What plugins do NOT do:**

- Route traffic through their service. The OpenRouter plugin does not send your prompts through OpenRouter.
- See, modify, or proxy AI requests or responses.
- Manage API keys for execution. They may use an API key to access a model catalog, but your execution API keys stay with your orchestrator.
- Make any provider API calls on your behalf (Claude, GPT, Gemini, etc.).

The plugin produces a `ModelSelection`. Your orchestrator takes that selection and makes the actual API call itself, directly to the provider.

---

## 2. Plugin Architecture

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

The key method is `select()`. It receives a `SpawnIntent` (what you need) and returns a `ModelSelection` (where to send it). That's the entire plugin contract. Everything else -- `models()`, `healthy()`, `initialize()`, `dispose()` -- is lifecycle support.

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

## 3. Shipped Plugins

### Direct Plugin

**ID:** `direct` | **Status:** Stable | **API Key:** No

**Intelligence source:** Static model catalog compiled into the package at release time.

The zero-config, zero-network fallback. Uses a hardcoded catalog of models with known pricing and capabilities. Selection is fully deterministic based on effort level and cost sensitivity. Always healthy, always available.

**When to use:** Development, testing, air-gapped environments, or as a fallback for any other plugin.

**Selection logic:**
- `cost_sensitivity: 'high'` -- cheapest qualifying model
- Otherwise -- effort-based tier ordering (deep: Opus/GPT-5, standard: Sonnet/Gemini Pro, minimal: Haiku/Flash)

**Trade-offs:**
- No live data -- pricing and model availability may be stale between releases
- No provider-specific optimizations
- The simplest and most reliable plugin, by design

---

### Maestro Plugin

**ID:** `maestro` | **Status:** Stable | **API Key:** No

**Intelligence source:** Static catalog + quality scores from `@maestro/score` bridge + off-peak pricing windows.

Computes a composite score that weights quality and cost based on `cost_sensitivity`. During off-peak windows (provider-specific time ranges), effective costs are reduced, shifting the cost-quality balance toward models that are temporarily cheaper.

**When to use:** Production deployments where cost-quality tradeoff matters and you want score-driven model selection.

**How it decides:**
- Composite score: `(quality_weight * quality) - (cost_weight * normalized_cost)`
- Off-peak pricing: provider-specific UTC time windows reduce effective cost
- Score bridge: reads quality data from `@maestro/score` if available, falls back to static defaults

**Trade-offs:**
- Quality scores are static by default (StaticScoreBridge). Real-time quality requires implementing a custom ScoreBridge.
- No live model discovery -- uses the same static catalog as DirectPlugin, augmented with scoring

---

### OpenRouter Plugin

**ID:** `openrouter` | **Status:** Stable | **API Key:** Yes

**Intelligence source:** Live model catalog from [openrouter.ai](https://openrouter.ai)'s `/models` API endpoint, cached for 5 minutes.

Queries OpenRouter's public model catalog API to get up-to-date pricing, availability, and capability data for 200+ models across dozens of providers. This data is used locally to make better-informed selection decisions. **The plugin does not route your AI traffic through OpenRouter** -- it only reads their catalog to know what's available and how much it costs right now.

**When to use:** You want the freshest pricing and availability data across many providers, updated in near-real-time as providers change pricing or add models.

**How it works:**
1. On first `select()` or `models()` call, fetches the model catalog from OpenRouter's API
2. Parses model entries, infers capabilities, extracts pricing
3. Caches the result for 5 minutes (cache coalescing prevents stampedes)
4. Uses this enriched catalog for selection, just like DirectPlugin uses its static catalog

**Trade-offs:**
- Requires an OpenRouter API key (for catalog access)
- Depends on OpenRouter's API availability (falls back to static catalog on failure)
- Pricing data includes OpenRouter's markup (currently 0%)

---

### Requesty Plugin

**ID:** `requesty` | **Status:** Stable | **API Key:** Yes

**Intelligence source:** Live model catalog from [requesty.ai](https://requesty.ai), cached with coalescing.

Queries Requesty's API for model availability and pricing data. Like the OpenRouter plugin, this is catalog intelligence only -- **your AI traffic does not flow through Requesty**.

**When to use:** Teams that use Requesty's infrastructure and want selection decisions informed by Requesty's view of model availability and failover state.

**How it works:**
- Fetches model catalog from Requesty's API
- Uses Requesty's availability signals to inform selection
- Falls back to static catalog if the API is unreachable

**Trade-offs:**
- Requires API key
- Currently uses static model catalog as primary (live discovery validates availability only)

---

### Portkey Plugin

**ID:** `portkey` | **Status:** Stable | **API Key:** Yes

**Intelligence source:** Model catalog from [portkey.ai](https://portkey.ai) or your self-hosted Portkey gateway.

Queries Portkey's API for model catalog data. Supports self-hosted deployments -- point `base_url` at your own gateway to keep catalog queries inside your network. **The plugin queries your Portkey instance for catalog data; it does not proxy AI requests through Portkey** (though you may separately choose to use Portkey as an execution gateway -- that's your orchestrator's concern).

**When to use:** Enterprise environments with self-hosted Portkey gateways, or teams using Portkey's virtual key management.

**How it works:**
- Queries Portkey's model catalog endpoint with appropriate headers
- Supports virtual keys for team-level catalog isolation
- Falls back to static catalog on failure

**Trade-offs:**
- Requires API key (even self-hosted instances)
- Currently uses static model catalog as primary

---

### LiteLLM Plugin

**ID:** `litellm` | **Status:** Stable | **API Key:** Proxy mode

**Intelligence source:** Model catalog from a [LiteLLM](https://github.com/BerriAI/litellm) proxy server or in-process SDK.

Queries your LiteLLM proxy for its model list and pricing data. LiteLLM supports 2500+ models across 100+ providers, so this plugin gives the broadest catalog. **The plugin queries your LiteLLM instance for catalog data; it does not send AI requests through LiteLLM** (your orchestrator may use LiteLLM as an execution proxy separately).

**When to use:** Teams already running a LiteLLM proxy, or those wanting the broadest model coverage for selection intelligence.

**How it works:**
- Proxy mode: HTTP requests to your LiteLLM server's model list endpoint
- SDK mode: in-process catalog access (requires Python runtime)
- Falls back to static catalog on failure

**Trade-offs:**
- Proxy mode requires a running LiteLLM server
- SDK mode requires Python runtime
- Currently uses static model catalog as primary

---

### Mock Plugin

**ID:** `mock` | **Status:** Stable | **API Key:** No

**Intelligence source:** Pre-configured test data that you control.

Deterministic test plugin with pre-configured responses, call tracking, and failure simulation. Returns exactly what you tell it to -- nothing more, nothing less.

**When to use:** Unit tests, integration tests, and CI pipelines.

**Test helpers:**
- `setResponse(effort, selection)` -- configure what `select()` returns
- `getCalls()` -- inspect all intents that were routed
- `clearCalls()` -- reset call history
- `setHealthy(boolean)` -- simulate health state changes
- `setError(error)` -- simulate plugin failures

---

## 4. Plugin Comparison Matrix

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

## 5. Decision Matrix

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

## 6. Plugin Development

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

## 7. Contract Tests

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

## 8. Plugin Lifecycle

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
