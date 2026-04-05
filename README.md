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

## Design Philosophy

@maestro/router is built on principles drawn from production orchestration systems. These aren't aspirational -- they're enforced in the architecture.

### Defense in Depth

No single point of failure compromises routing. Validation happens at every boundary:

- **Intake**: SpawnIntent is typed and constrained (effort, cost_sensitivity, capabilities)
- **Plugin**: Circuit breaker isolates each provider independently
- **Fallback**: Primary fails, fallback activates transparently
- **DirectPlugin**: Always available, zero network, pure deterministic fallback
- **Audit**: Every decision is recorded regardless of outcome

### Fail Fast, Recover Faster

Errors surface immediately at the point of failure rather than propagating corrupt state. Circuit breakers trip after consecutive failures and recover via half-open probing. The goal is not zero failures -- it's minimal time and blast radius per failure.

### Measure Everything, Optimize What Matters

Every routing decision emits structured data: OTel spans with 14 semantic attributes, audit entries with full decision context, cost estimates, quality scores. But measurement without action is surveillance. The router is designed for closed-loop optimization: route, measure, adjust, repeat.

### Prompts Are Code

For systems that use prompt-driven intent detection, the routing logic deserves the same engineering rigor as source code: version control, peer review, automated testing, regression detection. A routing rule change is a behavioral change -- it alters how every subsequent request is handled.

### Decision Quality Over Outcome Quality

Good routing decisions can produce bad outcomes (model has a bad day). Bad routing decisions can produce good outcomes (got lucky with a cheap model). The audit trail logs the decision *process* -- why this provider was selected, what alternatives were considered, what constraints were active -- not just whether it succeeded. This enables decision audits that separate process quality from outcome quality.

## Security Considerations

### Credential Management

- API keys are accepted via `plugin.initialize()` and stored in module-level state (one instance per process via ES module caching)
- Keys are **never** included in error messages, rationale strings, OTel span attributes, or audit log entries
- 4xx response bodies are redacted to prevent credential reflection attacks
- Base URLs are validated (http/https only) before use
- URL query parameters are stripped from error messages to prevent key leakage via query strings

### Input Validation

- `validateBaseUrl()` rejects non-http/https protocols
- `safeParseFloat()` prevents NaN propagation from malformed API responses
- SpawnIntent is typed at compile time; plugins validate capabilities at runtime
- Plugin configuration is validated at initialization, not at selection time (fail fast)

### Rate Limiting and Abuse Prevention

- `KeyRateLimiter` enforces per-key sliding window quotas
- 429 responses are parsed (`Retry-After` header: integer seconds and HTTP-date formats) and keys are blocked until cooldown expires
- Rate limit state is independent per key -- one key hitting limits does not affect others

### Audit Trail Independence

Following the principle of **separation of detection and remediation**: the audit system records routing decisions (detection) but has no authority to modify routing behavior (remediation). The entity publishing quality findings has no power to prioritize or execute fixes. This structural separation prevents audit corruption.

### Threat Model

| Threat | Mitigation |
|:---|:---|
| API key exposure in logs | Keys never appear in error messages, rationale, or OTel attributes |
| Credential reflection via 4xx bodies | Response bodies redacted for all 4xx status codes |
| Provider impersonation via bad base URL | `validateBaseUrl()` rejects non-http/https; only configured URLs are used |
| Cache poisoning via concurrent model refresh | Promise coalescing ensures single HTTP request per cache miss |
| Audit log tampering | `AuditStore` interface is append-only; in-memory store has no delete API |
| Rate limit bypass | Per-key enforcement; `canProceed()` checks both window quota and 429 cooldown |
| NaN propagation from malformed API data | `safeParseFloat()` returns 0 for unparseable values |

### Recommendations for Production

- Store API keys in environment variables or a secrets manager -- never in source code or config files
- Implement a custom `AuditStore` backed by an append-only database with retention policies
- Enable OTel tracing with a production-grade collector (Jaeger, Tempo, Datadog) for full request correlation
- Set up alerting on circuit breaker state transitions (closed -> open) and audit store write failures
- Rotate API keys periodically and use `limiter.remove(oldKey)` to clear stale rate limit state

## Cost Optimization

### Cost-Quality Tradeoff

The router treats cost optimization as an explicit dimension of every routing decision, not an afterthought. Every `SpawnIntent` carries a `cost_sensitivity` field that directly influences model selection:

| Sensitivity | Behavior | Use Case |
|:---|:---|:---|
| `low` | Prefer quality over cost. Strong models selected even when cheaper alternatives qualify. | Critical tasks, customer-facing output, complex reasoning |
| `normal` | Balanced. Effort-based tier ordering with cost as a tiebreaker. | General workloads |
| `high` | Cheapest qualifying model wins. Quality is sacrificed for cost. | Bulk processing, internal tooling, non-critical tasks |

### Off-Peak Pricing Intelligence

Providers offer time-based discounts that the router exploits automatically. The Maestro plugin maintains provider-specific off-peak windows:

| Provider | Off-Peak Window (UTC) | Discount | Notes |
|:---|:---|:---|:---|
| DeepSeek | 16:30 -- 00:30 | 50% | Midnight-crossing logic handles the UTC day boundary |

During off-peak windows, the effective cost of qualifying models is reduced by the discount factor, making them more competitive in cost-quality scoring. The midnight-crossing logic uses an OR condition (`currentMinutes >= startMinutes || currentMinutes < endMinutes`) to correctly handle windows that span midnight.

### Cost Scoring

The Maestro plugin computes a composite score that weights cost and quality based on sensitivity:

```
composite = (quality_weight * quality_score) - (cost_weight * normalized_cost)
```

Cost weights by sensitivity:

| Sensitivity | Quality Weight | Cost Weight |
|:---|---:|---:|
| `low` | 0.8 | 0.2 |
| `normal` | 0.5 | 0.5 |
| `high` | 0.2 | 0.8 |

### Provider Pricing Dimensions

The v1.4 spec documents 6 pricing dimensions across 12+ providers:

1. **Batch API discounts** -- Anthropic (50%), OpenAI (50%), Google (50%) for async workloads
2. **Prompt caching** -- Anthropic (90% off cached), OpenAI (50% off), Google (75% off)
3. **Time-based pricing** -- DeepSeek off-peak (50% off), others TBD
4. **Service tiers** -- Anthropic Build/Scale/Enterprise with volume discounts
5. **Provisioned capacity** -- AWS Bedrock, Azure OpenAI reserved throughput
6. **Gateway markups** -- OpenRouter (0%), Portkey (0%), Requesty (varies)

### Cost Tracking Habits

Following the principle of "track burn rate daily":

- Use the audit trail to monitor API spend per provider, per model, per caller
- Set up alerts when daily spend exceeds thresholds
- Compare estimated costs (from routing decisions) against actual invoices to detect drift
- Use `cost_sensitivity: 'high'` for non-critical workloads to reduce spend without manual intervention

## Roadmap

### v0.2.0 -- Provider Expansion

- **Anthropic direct plugin** -- Bypass aggregators for Anthropic-only deployments with Messages API
- **Azure OpenAI plugin** -- Enterprise customers with Azure-managed OpenAI endpoints
- **AWS Bedrock plugin** -- Cross-model routing through Bedrock's unified API
- **Google Vertex AI plugin** -- Gemini routing through Google Cloud
- **DeepSeek plugin** -- Direct integration for off-peak pricing exploitation
- **Mistral plugin** -- Mistral La Plateforme direct API
- **Groq plugin** -- Ultra-low-latency inference for latency-sensitive routing
- **Together AI plugin** -- Open-source model hosting with competitive pricing
- **Fireworks AI plugin** -- Optimized open-source model inference
- **Ollama plugin** -- Local model routing for air-gapped and development environments

### v0.3.0 -- Closed-Loop Optimization

- **Feedback loop** -- Execution outcomes (latency, actual cost, success/failure, quality score) feed back into routing weights automatically
- **Dynamic pricing refresh** -- Poll provider pricing APIs hourly instead of using static data
- **Latency-aware routing** -- Track p50/p95/p99 latency per provider per model and factor into selection
- **Token budget enforcement** -- Reject or downgrade requests that would exceed per-user/per-org token budgets
- **A/B routing** -- Split traffic between providers to continuously evaluate alternatives
- **Prompt caching hints** -- Detect cache-eligible requests and route to providers with caching discounts

### v0.4.0 -- Advanced Intelligence

- **Context window management** -- Estimate input tokens and route to models with sufficient context windows
- **Multi-region routing** -- Geographic preference in SpawnIntent, route based on latency + cost + availability
- **Batch API routing** -- Detect async-eligible workloads and route to batch endpoints for 50% cost savings
- **Canary deployments** -- Gradually shift traffic to new providers/models with automatic rollback on quality regression
- **Custom scoring functions** -- User-defined scoring that plugs into the cost-quality evaluation pipeline

### v0.5.0 -- Benchmarking and Cost Verification

- **Provider cost benchmarking suite** -- Automated tests that route identical workloads through each provider and compare actual billed costs against estimated costs. Detect pricing drift before it hits production budgets.
- **Routing decision benchmarks** -- Measure routing latency (p50/p95/p99) across plugin counts, model catalog sizes, and habit table sizes. Regression-test against baseline on every CI run.
- **Cost accuracy scoring** -- Track `estimated_cost` vs `actual_cost` per provider per model over time. Surface providers where estimates drift >10% from reality.
- **A/B cost comparison** -- Split identical traffic across two providers and compare total spend, latency, and success rate. Automated reports with statistical significance testing.
- **Chaos cost testing** -- Simulate provider pricing changes (rate increases, discount removal, new tiers) and verify the router re-optimizes correctly without manual intervention.
- **Load testing harness** -- Sustained throughput testing (1K, 10K, 100K routing decisions/sec) to find the ceiling before the Rust port. Profile memory, CPU, and GC pressure.
- **Provider SLA verification** -- Automated checks against provider-advertised uptime, latency, and rate limits. Compare marketing claims against observed behavior.
- **Cost optimization regression tests** -- Golden-file tests that assert: "given this model catalog and these 100 intents, the total estimated cost must not exceed $X." Catch regressions where routing changes silently increase spend.

### v1.0.0 -- Production Hardening

- **Rust core** -- Port the hot path (intent matching, cost scoring, model filtering) to Rust via napi-rs for sub-microsecond routing decisions. The plugin interface stays in TypeScript; the scoring engine compiles to native. Target: <100us p99 for habit matching, <500us p99 for full routing decisions.
- **Persistent rate limiter** -- Redis-backed sliding window for distributed rate limiting across process boundaries
- **Schema validation** -- JSONSchema-based plugin config validation at `initialize()` time
- **Chaos testing suite** -- Automated provider failure injection (latency, errors, rate limits) to verify resilience
- **SLA monitoring** -- Track routing SLA compliance (availability, latency, cost accuracy) with alerting

### Potential Rust Port

The router's architecture is designed for incremental native compilation:

| Component | Port Priority | Rationale |
|:---|:---|:---|
| Habit matching (keyword scan) | High | Hot path, pure CPU, no I/O. Regex/keyword matching in Rust is 10-100x faster. |
| Cost-quality scoring | High | Numeric computation over model catalogs. SIMD-friendly. |
| SemanticRouter (TF-IDF) | Medium | Vector math, cosine similarity. Benefits from native BLAS. |
| Model capability filtering | Medium | Array filtering with predicate evaluation. Cache-friendly in Rust. |
| Plugin interface | Low | Async I/O bound (HTTP calls). TypeScript is fine here. |
| OTel instrumentation | None | Already zero-cost when disabled. OTel SDK is JS-native. |
| Audit trail | None | I/O bound (database writes). No benefit from native. |

The napi-rs bridge would expose a `NativeRouter` class that handles the scoring/matching hot path while delegating plugin I/O to the existing TypeScript plugins. This is the same pattern used by [swc](https://github.com/swc-project/swc) (Rust core, JS API) and [Turbopack](https://github.com/vercel/turbopack).

## Contributing

### Prerequisites

- Node.js >= 20
- npm

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

### Project Structure

```
src/
  index.ts                  # barrel exports
  router.ts                 # main Router class
  registry.ts               # plugin lifecycle manager
  types.ts                  # core type definitions
  errors.ts                 # error hierarchy
  habits.ts                 # habit matcher
  resilience.ts             # circuit breaker + retry
  tracing.ts                # OTel instrumentation
  http.ts                   # undici HTTP utilities
  audit.ts                  # audit trail
  rate-limiter.ts           # per-key rate limiter
  score-bridge.ts           # score engine bridge
  plugins/
    registry.ts             # plugin loader registry
    direct.ts               # offline fallback
    maestro.ts              # score-informed routing
    openrouter.ts           # OpenRouter aggregator
    requesty.ts             # Requesty gateway
    portkey.ts              # Portkey gateway
    litellm.ts              # LiteLLM proxy/SDK
    mock.ts                 # test plugin
  algorithms/
    semantic-router.ts      # TF-IDF intent classification
    routellm-mf.ts          # cost-quality threshold routing
  __tests__/
    unit/                   # 14 unit test files
    contract/               # plugin contract test suite
```

### Adding a New Plugin

1. Create `src/plugins/your-plugin.ts` implementing `RouterPlugin`
2. Add a loader entry in `src/plugins/registry.ts`
3. Export from `src/index.ts`
4. Run the contract test suite against your plugin
5. Add plugin-specific unit tests in `src/__tests__/unit/`
6. Document in the Plugins table in this README

Every plugin must pass the contract test suite (`src/__tests__/contract/router-contract.test.ts`), which validates:

- `select()` returns valid `ModelSelection` for all effort/cost combinations
- `models()` returns a non-empty `ModelCapability[]`
- `healthy()` returns a boolean
- Required capabilities in the intent are respected
- `initialize()` and `dispose()` do not throw

### Code Quality Standards

- **Test behavior, not implementation** -- test public interfaces and observable outcomes
- **Arrange-act-assert** -- every test follows this structure
- **One variable at a time** -- when optimizing routing logic, change one parameter and measure
- **Explicit trade-offs** -- every PR that changes routing behavior must document what it gains, what it costs, and what breaks if wrong
- **No silent failures** -- errors are surfaced, logged, or explicitly caught with documented rationale

### Versioning

This project uses [Changesets](https://github.com/changesets/changesets) for versioning:

```bash
npm run changeset     # create a changeset describing your change
npm run version       # apply changesets and bump version
npm run release       # build and publish to npm
```

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with tests
3. Run `npm run typecheck && npm test && npm run build`
4. Create a changeset: `npm run changeset`
5. Open a PR with a clear description of what changed and why
6. CI must pass (typecheck + test on Node 20/22)

## Acknowledgments

- [cockatiel](https://github.com/connor4312/cockatiel) -- Circuit breaker and retry policies
- [undici](https://github.com/nodejs/undici) -- HTTP/1.1 client
- [Aurelio AI Semantic Router](https://github.com/aurelio-labs/semantic-router) -- Inspiration for the SemanticRouter algorithm
- [LMSYS RouteLLM](https://github.com/lm-sys/RouteLLM) -- Inspiration for the CostQualityRouter algorithm
- [Release It!](https://pragprog.com/titles/mnee2/release-it-second-edition/) by Michael Nygard -- Stability patterns (circuit breakers, bulkheads, timeouts)

## License

[MIT](./LICENSE)
