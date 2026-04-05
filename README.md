# @maestro/router

**Intelligent multi-provider routing for AI orchestration.**

[![npm version](https://img.shields.io/npm/v/@maestro/router?style=flat-square)](https://www.npmjs.com/package/@maestro/router)
[![CI](https://img.shields.io/github/actions/workflow/status/andrewdever/maestro-router/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/andrewdever/maestro-router/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org)

Receives a `SpawnIntent` from the orchestrator and resolves it to a concrete `ModelSelection` through a five-part chain: **router - provider - harness - model - config**. Self-contained with zero dependencies on the rest of the Maestro platform -- publish and use it standalone.

---

## Features

- **Intent-based routing** -- tasks declare capabilities and constraints, never model names
- **7 shipped plugins** -- Direct, Maestro, OpenRouter, Requesty, Portkey, LiteLLM, Mock
- **Habit matching** -- local-first short-circuit routing, zero tokens, zero API calls
- **Resilience** -- per-plugin circuit breakers, exponential backoff retry (via cockatiel)
- **Cost-quality optimization** -- RouteLLM-inspired threshold routing with complexity scoring
- **Semantic classification** -- TF-IDF cosine similarity intent classifier, zero external deps
- **OpenTelemetry tracing** -- full span hierarchy with semantic attributes (optional peer dep)
- **Audit trail** -- every routing decision recorded with pluggable storage backends
- **Rate limiting** -- per-key sliding window with 429/Retry-After handling
- **Dynamic plugin loading** -- tree-shakeable lazy imports, only load what you use
- **Fallback chains** -- primary plugin fails, fallback takes over transparently
- **Canonical slugs** -- traceable `router-provider-harness-model-config` identifiers across logs and metrics

## Quick Start

```bash
npm install @maestro/router
```

```typescript
import { Router } from '@maestro/router';

const router = new Router({
  config: { plugin: 'direct' },
});

await router.initialize();

const result = await router.route({
  effort: 'deep',
  cost_sensitivity: 'normal',
  requires: ['thinking', 'tool_use'],
  prefer_provider: 'anthropic',
});

console.log(result.slug);
// direct-anthropic-api-claude-opus-4-6-effort:deep

console.log(result.selection.rationale);
// Direct selection: claude-opus-4-6 for effort=deep, cost_sensitivity=normal

await router.dispose();
```

## Core Concepts

### SpawnIntent

A `SpawnIntent` describes what the orchestrator needs without naming specific models. The router resolves the intent to a concrete model.

```typescript
interface SpawnIntent {
  effort: 'minimal' | 'standard' | 'deep';
  cost_sensitivity: 'low' | 'normal' | 'high';
  requires?: string[];           // e.g. ['thinking', 'tool_use', 'vision']
  prefer_provider?: string;      // soft preference, not a hard constraint
  exclude_providers?: string[];  // hard exclusion
}
```

### ModelSelection

The full routing result with the five-part resolution chain.

```typescript
interface ModelSelection {
  router: string;          // 'maestro', 'openrouter', 'direct', ...
  provider: string;        // 'anthropic', 'openai', 'google', ...
  harness: string;         // 'api', 'claude-code', ...
  model: string;           // 'opus-4-6', 'sonnet-4-6', 'gpt-5', ...
  config: string;          // 'effort:deep', 'effort:standard', ...
  estimated_cost?: number; // USD estimate for this request
  rationale?: string;      // human-readable explanation
  quality_score?: number;  // 0-1 quality score from @maestro/score
}
```

### Canonical Slugs

Every routing decision produces a traceable slug built from the five-part chain:

```
openrouter-anthropic-api-opus-4-6-effort:deep
maestro-google-api-gemini-2.5-pro-effort:standard
habit-local-none-none-effort:zero
```

Use `toSlug(selection)` to generate slugs from any `ModelSelection`.

### Routing Flow

```
                         SpawnIntent
                             |
                   +---------+---------+
                   |   Habit Matcher   |
                   +---+----------+----+
                       |          |
                    matched    no match
                       |          |
              return immediately   |
             (zero tokens)        |
                             +----+-----+
                             |  Plugin  |
                             | Registry |
                             +----+-----+
                                  |
                    +-------------+-------------+
                    |                           |
               primary plugin            fallback plugin
               (e.g. maestro)           (e.g. direct)
                    |                           |
                    +-------------+-------------+
                                  |
                        +---------+---------+
                        | Resilience Policy |
                        | (retry + breaker) |
                        +---------+---------+
                                  |
                          plugin.select()
                                  |
                        +---------+---------+
                        |  ModelSelection   |
                        |  + canonical slug |
                        |  + audit entry    |
                        |  + OTel span      |
                        +-------------------+
```

### Effort Defaults

Each effort level maps to default execution parameters before model-specific clamping:

| Effort     | Thinking Budget | Timeout   | Knowledge Budget |
|------------|----------------:|----------:|-----------------:|
| `minimal`  |          0 tok  |   2 min   |       2,000 tok  |
| `standard` |      4,000 tok  |   5 min   |       8,000 tok  |
| `deep`     |     16,000 tok  |  15 min   |      16,000 tok  |

## Plugins

### Shipped Plugins

| Plugin       | ID           | Description                                             | API Key Required | Config Keys                                  |
|:-------------|:-------------|:--------------------------------------------------------|:-----------------|:---------------------------------------------|
| Direct       | `direct`     | Offline-first, zero-config, air-gapped fallback         | No               | --                                           |
| Maestro      | `maestro`    | Quality-informed routing with score bridge integration   | No               | `off_peak_enabled`, `models`, `score_bridge` |
| OpenRouter   | `openrouter` | Multi-provider aggregator, 200+ models, single API key  | Yes              | `api_key`, `base_url`                        |
| Requesty     | `requesty`   | Smart routing with sub-20ms failover                    | Yes              | `api_key`, `base_url`                        |
| Portkey      | `portkey`    | Open-source AI gateway, 250+ models, 45+ providers     | Yes              | `api_key`, `base_url`, `virtual_key`         |
| LiteLLM      | `litellm`    | Universal gateway, 2500+ models, proxy or SDK mode      | Yes (proxy)      | `api_key`, `base_url`, `mode`                |
| Mock         | `mock`       | Deterministic test router with preconfigured responses  | No               | `responses`                                  |

### Configuring Plugins

Pass plugin-specific configuration through `config.config`:

```typescript
// OpenRouter
const router = new Router({
  config: {
    plugin: 'openrouter',
    fallback: 'direct',
    config: {
      api_key: process.env.OPENROUTER_API_KEY,
    },
  },
});

// Maestro with off-peak optimization
const router = new Router({
  config: {
    plugin: 'maestro',
    fallback: 'direct',
    config: {
      off_peak_enabled: true,
    },
  },
});

// Portkey with self-hosted gateway
const router = new Router({
  config: {
    plugin: 'portkey',
    fallback: 'direct',
    config: {
      api_key: process.env.PORTKEY_API_KEY,
      base_url: 'https://gateway.internal.example.com/v1',
      virtual_key: 'my-virtual-key',
    },
  },
});

// LiteLLM proxy mode
const router = new Router({
  config: {
    plugin: 'litellm',
    config: {
      api_key: process.env.LITELLM_API_KEY,
      base_url: 'http://localhost:4000',
      mode: 'proxy',
    },
  },
});
```

### Plugin Selection Logic

All plugins share a common selection flow:

1. **Filter** -- remove models missing required capabilities
2. **Exclude** -- remove models from excluded providers
3. **Route** -- if `cost_sensitivity: 'high'`, pick cheapest; otherwise use effort-based tier ordering
4. **Prefer** -- apply `prefer_provider` as a soft tiebreaker
5. **Fallback** -- return first qualifying candidate if no preference match

The **Maestro** plugin adds quality-informed scoring via the score bridge, off-peak cost optimization, and composite score weighting based on cost sensitivity.

## Habits

Habits are known solutions the orchestra already has code for. When a habit matches, the router short-circuits entirely -- no plugin invoked, no tokens spent, no provider API call. The resolution chain becomes `habit-local-none-none-effort:zero`.

Habits are checked **before** any plugin, following the principle: "Habits (known solutions) route before AI scoring."

### Defining Habits

```typescript
import { Router, HabitMatcher } from '@maestro/router';

const habits = new HabitMatcher();

habits.register({
  slug: 'format-code',
  handler: 'local://formatters/prettier',
  triggers: ['format', 'prettier', 'lint fix'],
  capabilities: ['code'],
});

habits.register({
  slug: 'git-status',
  handler: 'local://git/status',
  triggers: ['git status', 'show changes', 'what changed'],
});

const router = new Router({ habits });
await router.initialize();

// This matches the 'format-code' habit -- zero tokens
const result = await router.route(
  { effort: 'minimal', cost_sensitivity: 'normal' },
  'please format this code with prettier',
);

console.log(result.habit_match);     // true
console.log(result.resolved_plugin); // 'habit'
console.log(result.slug);           // habit-local-none-none-effort:zero
```

### HabitDefinition

```typescript
interface HabitDefinition {
  slug: string;             // unique identifier
  handler: string;          // local handler function or code path
  triggers: string[];       // keywords that activate this habit
  capabilities?: string[];  // capabilities this habit handles
}
```

Matching evaluates trigger keywords against the task context string (case-insensitive substring match). If the intent requires capabilities, the habit must declare that it handles all of them.

## Resilience

Every plugin call is wrapped in a resilience policy: **retry with exponential backoff** feeding into a **circuit breaker**. Each plugin gets its own circuit breaker so one failing plugin does not affect others.

### Policy Chain

```
retry(exponential backoff) --> circuit breaker --> plugin.select()
```

### Configuration

```typescript
import { Router } from '@maestro/router';

const router = new Router({
  resilience: {
    maxRetries: 2,          // 3 total attempts (default: 2)
    initialDelay: 200,      // first backoff delay in ms (default: 200)
    maxDelay: 5_000,        // max backoff delay in ms (default: 5000)
    breakerThreshold: 5,    // consecutive failures to trip breaker (default: 5)
    halfOpenAfter: 30_000,  // breaker half-open test interval in ms (default: 30000)
  },
});
```

### Standalone Usage

```typescript
import { createResiliencePolicy, PluginPolicyManager } from '@maestro/router';

// Single policy
const { policy, breaker } = createResiliencePolicy({ maxRetries: 3 });
const result = await policy.execute(() => someAsyncOperation());

// Per-plugin policy manager
const manager = new PluginPolicyManager({ breakerThreshold: 3 });
const result = await manager.execute('openrouter', () => plugin.select(intent));
console.log(manager.isOpen('openrouter')); // check if breaker is tripped
```

## Observability

### OpenTelemetry Tracing

`@opentelemetry/api` is an optional peer dependency. When installed and a `TracerProvider` is registered, the router emits a span hierarchy for every routing decision. When not installed, all tracing calls are zero-overhead no-ops.

```bash
npm install @opentelemetry/api
```

#### Span Hierarchy

```
router.route                    (root span per route() call)
  |-- router.habit_check        (habit matching attempt)
  |-- router.resolve_plugin     (plugin resolution + fallback)
  +-- router.select             (plugin.select() call, wrapped by resilience)
```

#### Semantic Attributes

All spans carry structured attributes under the `maestro.router.*` namespace:

| Attribute                           | Type      | Description                        |
|:------------------------------------|:----------|:-----------------------------------|
| `maestro.router.plugin_id`         | string    | Active plugin ID                   |
| `maestro.router.effort`            | string    | Effort level from intent           |
| `maestro.router.cost_sensitivity`  | string    | Cost sensitivity from intent       |
| `maestro.router.requires`          | string[]  | Required capabilities              |
| `maestro.router.prefer_provider`   | string    | Preferred provider                 |
| `maestro.router.selected_model`    | string    | Chosen model                       |
| `maestro.router.selected_provider` | string    | Chosen provider                    |
| `maestro.router.slug`             | string    | Canonical routing slug             |
| `maestro.router.habit_match`      | boolean   | Whether a habit matched            |
| `maestro.router.habit_slug`       | string    | Matched habit slug (if applicable) |
| `maestro.router.used_fallback`    | boolean   | Whether fallback plugin was used   |
| `maestro.router.estimated_cost`   | number    | Estimated cost in USD              |
| `maestro.router.quality_score`    | number    | Quality score (0-1)                |
| `maestro.router.breaker_state`    | string    | Circuit breaker state              |

#### Programmatic Usage

```typescript
import { withSpan, withSpanSync } from '@maestro/router';

// Async span
const result = await withSpan('my.operation', { 'my.attr': 'value' }, async (span) => {
  // span is null when OTel is not installed
  span?.setAttributes({ 'my.result': 42 });
  return doWork();
});

// Sync span
const value = withSpanSync('my.sync.op', {}, (span) => computeSomething());
```

### Audit Trail

Every routing decision is recorded in a pluggable audit log. The audit system is fire-and-forget -- audit failures never block routing.

```typescript
import { Router, InMemoryAuditStore } from '@maestro/router';

const auditStore = new InMemoryAuditStore(10_000); // max 10K entries

const router = new Router({
  config: { plugin: 'maestro' },
  auditStore,
});

await router.initialize();
await router.route({ effort: 'deep', cost_sensitivity: 'normal' });

// Query recent decisions
const entries = await auditStore.query({ limit: 10 });
console.log(entries[0].decision.slug);
console.log(entries[0].intent.effort);

// Count by plugin
const maestroCount = await auditStore.count({ plugin_id: 'maestro' });
const habitCount = await auditStore.count({ habit_match: true });
```

#### Custom Audit Store

Implement the `AuditStore` interface for production backends:

```typescript
import type { AuditStore, AuditEntry, AuditQueryOptions, AuditFilter } from '@maestro/router';

class PostgresAuditStore implements AuditStore {
  async append(entry: AuditEntry): Promise<void> { /* INSERT INTO audit_log ... */ }
  async query(options: AuditQueryOptions): Promise<AuditEntry[]> { /* SELECT ... */ }
  async count(filter?: AuditFilter): Promise<number> { /* SELECT COUNT ... */ }
  async flush(): Promise<void> { /* batch commit */ }
  async dispose(): Promise<void> { /* close connection pool */ }
}
```

## Rate Limiting

Per-key sliding window rate limiter with 429 response handling.

```typescript
import { KeyRateLimiter } from '@maestro/router';

const limiter = new KeyRateLimiter({
  maxRequests: 100,   // max requests per window (default: 60)
  windowMs: 60_000,   // window duration in ms (default: 60000)
});

const apiKey = 'sk-abc123';

if (limiter.canProceed(apiKey)) {
  limiter.recordRequest(apiKey);
  const response = await callProvider(apiKey);

  if (response.status === 429) {
    const retryAfter = KeyRateLimiter.parseRetryAfter(
      response.headers['retry-after'],
    );
    limiter.recordRateLimit(apiKey, retryAfter);
  }
}

// Check state
const state = limiter.getState(apiKey);
console.log(state?.requestCount, state?.limited);

// Cleanup on key rotation
limiter.remove(apiKey);
```

## Algorithms

### SemanticRouter

Embedding-based intent classification using TF-IDF cosine similarity. Ported from [Aurelio AI's Semantic Router](https://github.com/aurelio-labs/semantic-router) (MIT). Zero external dependencies -- pure TypeScript math.

**Algorithm:**

1. Tokenize input (lowercase, strip punctuation, remove stop words)
2. Build TF-IDF vectors from route utterances
3. Compute cosine similarity against each route's centroid vector
4. Return the best match above the configured threshold

```typescript
import { SemanticRouter, createDefaultRouter } from '@maestro/router';

// Pre-loaded with default routes: code-review, code-generation,
// analysis, summarization, conversation
const router = createDefaultRouter({ threshold: 0.3 });

const match = router.classify('can you review this pull request?');
// { route: 'code-review', score: 0.72, metadata: { effort: 'standard', ... } }

// Custom routes
const custom = new SemanticRouter({ threshold: 0.4 });
custom.addRoute({
  name: 'deployment',
  utterances: ['deploy to production', 'release the build', 'push to staging'],
  metadata: { effort: 'standard' },
});

// Get all matches above threshold, sorted by score
const allMatches = custom.classifyAll('deploy the new release');
```

**Performance:** <1ms for `classify()` with <20 routes. Vocabulary and vectors are compiled lazily and cached until routes change.

### CostQualityRouter

Cost-quality threshold routing inspired by [LMSYS RouteLLM](https://github.com/lm-sys/RouteLLM) (MIT). Decides whether a task needs a strong (expensive) model or if a weak (cheap) model would suffice.

**Algorithm:**

1. Filter candidates by hard constraints (excluded providers, required capabilities)
2. Sort candidates by cost (cheapest first)
3. Compute a complexity score from the intent's effort level and capability requirements
4. Adjust the routing threshold by cost sensitivity
5. If complexity exceeds the adjusted threshold, select the strongest model; otherwise select the cheapest

```typescript
import { CostQualityRouter, createDefaultCostQualityRouter } from '@maestro/router';

const router = createDefaultCostQualityRouter(); // threshold = 0.5

const candidates = await plugin.models();
const selected = router.route(
  { effort: 'deep', cost_sensitivity: 'normal', requires: ['thinking'] },
  candidates,
);
// Selects the strongest model (complexity 0.9 + 0.2 > threshold 0.5)

const cheapResult = router.route(
  { effort: 'minimal', cost_sensitivity: 'high' },
  candidates,
);
// Selects the cheapest model (complexity 0.1 < adjusted threshold 0.35)
```

**Complexity scoring:**

| Factor           | Score / Modifier |
|:-----------------|:-----------------|
| `minimal` effort | 0.1              |
| `standard` effort| 0.5              |
| `deep` effort    | 0.9              |
| `thinking`       | +0.2             |
| `code`           | +0.15            |
| `vision`         | +0.1             |
| `tool_use`       | +0.1             |
| `long_context`   | +0.1             |
| `multi_turn`     | +0.05            |

**Cost sensitivity multipliers** adjust the threshold:

| Sensitivity | Multiplier | Effect                                  |
|:------------|:-----------|:----------------------------------------|
| `low`       | 1.3x       | Easier to trigger strong model          |
| `normal`    | 1.0x       | No adjustment                           |
| `high`      | 0.7x       | Harder to trigger strong model          |

## Custom Plugins

Implement the `RouterPlugin` interface to create your own routing backend.

### Interface

```typescript
import type { RouterPlugin, SpawnIntent, ModelSelection, ModelCapability } from '@maestro/router';

const myPlugin: RouterPlugin = {
  id: 'my-router',
  name: 'My Custom Router',

  async select(intent: SpawnIntent): Promise<ModelSelection> {
    // Your routing logic here
    return {
      router: 'my-router',
      provider: 'anthropic',
      harness: 'api',
      model: 'claude-sonnet-4-6',
      config: `effort:${intent.effort}`,
    };
  },

  async models(): Promise<ModelCapability[]> {
    return [/* your model catalog */];
  },

  async healthy(): Promise<boolean> {
    return true;
  },

  // Optional lifecycle hooks
  async initialize(config: Record<string, unknown>): Promise<void> {
    // Validate API keys, warm caches, etc.
  },

  async dispose(): Promise<void> {
    // Release connections, flush caches
  },
};

export default myPlugin;
```

### Registration

```typescript
import { Router, RouterRegistry, ROUTER_PLUGINS } from '@maestro/router';
import myPlugin from './my-plugin.js';

// Option 1: Register directly
const registry = new RouterRegistry(ROUTER_PLUGINS);
registry.register(myPlugin);

const router = new Router({ registry, config: { plugin: 'my-router' } });

// Option 2: Add to the loader registry for lazy loading
const loaders = {
  ...ROUTER_PLUGINS,
  'my-router': () => import('./my-plugin.js'),
};
const registry = new RouterRegistry(loaders);
```

### Contract Tests

Custom plugins should pass the same contract test suite used by shipped plugins. The contract verifies:

- `select()` returns a valid `ModelSelection` for all effort/cost_sensitivity combinations
- `models()` returns a non-empty array of `ModelCapability` objects
- `healthy()` returns a boolean
- `initialize()` and `dispose()` do not throw
- Required capabilities in the intent are respected in the selection

## Configuration

### RouterOptions

```typescript
interface RouterOptions {
  /** Routing configuration. */
  config?: {
    /** Active router plugin ID. Default: 'direct'. */
    plugin?: string;
    /** Fallback plugin ID when primary fails. Default: 'direct'. */
    fallback?: string;
    /** Plugin-specific config passed to plugin.initialize(). */
    config?: Record<string, unknown>;
  };

  /** Pre-built registry (for testing or custom setups). */
  registry?: RouterRegistry;

  /** Pre-built habit matcher. */
  habits?: HabitMatcher;

  /** Resilience options for plugin calls. */
  resilience?: {
    maxRetries?: number;      // default: 2
    initialDelay?: number;    // default: 200 (ms)
    maxDelay?: number;        // default: 5000 (ms)
    breakerThreshold?: number; // default: 5
    halfOpenAfter?: number;   // default: 30000 (ms)
  };

  /** Audit store for recording routing decisions. Omit to disable. */
  auditStore?: AuditStore;
}
```

### RouteResult

```typescript
interface RouteResult {
  selection: ModelSelection;    // the routing selection
  slug: string;                 // canonical slug
  habit_match: boolean;         // whether this was a habit match
  resolved_plugin: string;      // plugin ID that produced the selection
  used_fallback: boolean;       // whether fallback was used
}
```

### Error Types

| Error                    | Code                  | When                                          |
|:-------------------------|:----------------------|:----------------------------------------------|
| `PluginNotFoundError`    | `PLUGIN_NOT_FOUND`    | Plugin ID not in registry or loaders           |
| `PluginInitError`        | `PLUGIN_INIT_ERROR`   | `plugin.initialize()` threw                   |
| `PluginUnhealthyError`   | `PLUGIN_UNHEALTHY`    | `plugin.healthy()` returned false              |
| `NoModelAvailableError`  | `NO_MODEL_AVAILABLE`  | No model meets intent requirements             |
| `SelectionError`         | `SELECTION_ERROR`     | Plugin-specific selection failure (e.g. no API key) |
| `FallbackExhaustedError` | `FALLBACK_EXHAUSTED`  | Both primary and fallback plugins failed       |

All errors extend `RouterError`, which carries a `code` string for programmatic handling.

## API Reference

Full TypeDoc documentation is published to GitHub Pages:

**[https://andrewdever.github.io/maestro-router](https://andrewdever.github.io/maestro-router)**

Generate locally:

```bash
npm run docs
npm run docs:serve
```

## Contributing

### Prerequisites

- Node.js >= 20
- npm or pnpm

### Development

```bash
# Install dependencies
npm install

# Type-check
npm run typecheck

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Lint
npm run lint

# Build
npm run build

# Generate API docs
npm run docs
```

### Versioning

This project uses [Changesets](https://github.com/changesets/changesets) for versioning:

```bash
npm run changeset     # create a changeset
npm run version       # apply changesets and bump versions
npm run release       # build and publish to npm
```

## License

[MIT](./LICENSE)
