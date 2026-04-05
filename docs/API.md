# API Reference

> Full TypeDoc documentation: **[https://andrewdever.github.io/maestro-router](https://andrewdever.github.io/maestro-router)**
>
> Generate locally: `npm run docs && npm run docs:serve`

This document covers the primary API surface. For complete type signatures, see the generated TypeDoc output.

---

## Table of Contents

1. [Router](#1-router)
2. [RouterRegistry](#2-routerregistry)
3. [HabitMatcher](#3-habitmatcher)
4. [Resilience](#4-resilience)
5. [Tracing](#5-tracing)
6. [Audit](#6-audit)
7. [Rate Limiter](#7-rate-limiter)
8. [HTTP Utilities](#8-http-utilities)
9. [Algorithms](#9-algorithms)
10. [Types](#10-types)
11. [Errors](#11-errors)

---

## 1. Router

The main entry point. Orchestrates the full routing flow: habits, registry, resilience, plugin selection, audit.

### `new Router(options?)`

```typescript
import { Router } from '@maestro/router';

const router = new Router({
  config: { plugin: 'maestro', fallback: 'direct', config: { off_peak_enabled: true } },
  resilience: { maxRetries: 2, breakerThreshold: 5 },
  auditStore: new InMemoryAuditStore(),
});
```

#### RouterOptions

| Field | Type | Default | Description |
|:---|:---|:---|:---|
| `config.plugin` | `string` | `'direct'` | Active plugin ID |
| `config.fallback` | `string` | `'direct'` | Fallback plugin ID |
| `config.config` | `Record<string, unknown>` | `{}` | Plugin-specific configuration |
| `registry` | `RouterRegistry` | auto-created | Pre-built registry |
| `habits` | `HabitMatcher` | empty matcher | Pre-built habit matcher |
| `resilience` | `ResilienceOptions` | defaults | Circuit breaker and retry config |
| `auditStore` | `AuditStore` | `null` (disabled) | Audit storage backend |

### `router.initialize()`

Loads and initializes the configured plugin. Safe to call multiple times. Called automatically on first `route()` if not called explicitly.

```typescript
await router.initialize();
```

### `router.route(intent, taskContext?)`

Route a `SpawnIntent` to a `ModelSelection`.

```typescript
const result = await router.route(
  { effort: 'deep', cost_sensitivity: 'normal', requires: ['thinking'] },
  'analyze this complex codebase',
);
```

**Returns:** `RouteResult`

| Field | Type | Description |
|:---|:---|:---|
| `selection` | `ModelSelection` | The routing result |
| `slug` | `string` | Canonical slug (`router-provider-harness-model-config`) |
| `habit_match` | `boolean` | Whether a habit short-circuited |
| `resolved_plugin` | `string` | Plugin ID that produced the selection |
| `used_fallback` | `boolean` | Whether the fallback plugin was used |

### `router.dispose()`

Flushes the audit log and disposes all loaded plugins.

```typescript
await router.dispose();
```

### `router.audit`

The `RouterAuditLog` instance (or `null` if no audit store was provided). Use this to query routing decisions after the fact.

```typescript
if (router.audit) {
  const recent = await router.audit.query({ limit: 10 });
  const count = await router.audit.count({ plugin_id: 'maestro' });
}
```

---

## 2. RouterRegistry

Plugin lifecycle manager. Handles registration, dynamic loading, initialization, fallback resolution, and disposal.

### `new RouterRegistry(loaders?, resilienceOptions?)`

```typescript
import { RouterRegistry, ROUTER_PLUGINS } from '@maestro/router';

const registry = new RouterRegistry(ROUTER_PLUGINS, { breakerThreshold: 3 });
```

### Methods

| Method | Signature | Description |
|:---|:---|:---|
| `register(plugin)` | `(RouterPlugin) => void` | Register an instantiated plugin |
| `get(id)` | `(string) => Promise<RouterPlugin>` | Get or dynamically load a plugin |
| `initialize(id, config?)` | `(string, Record) => Promise<RouterPlugin>` | Load + initialize a plugin |
| `resolve(primaryId, fallbackId?)` | `(string, string) => Promise<RouterPlugin>` | Resolve with fallback chain |
| `list()` | `() => RouterPlugin[]` | List all loaded plugins |
| `availableIds()` | `() => string[]` | List all registered + loadable IDs |
| `fallback()` | `() => Promise<RouterPlugin>` | Get the DirectPlugin fallback |
| `disposeAll()` | `() => Promise<void>` | Dispose all plugins and reset breakers |

---

## 3. HabitMatcher

Zero-token local routing via keyword matching.

### `new HabitMatcher()`

```typescript
import { HabitMatcher } from '@maestro/router';

const habits = new HabitMatcher();
habits.register({
  slug: 'format-code',
  handler: 'local://formatters/prettier',
  triggers: ['format', 'prettier', 'lint fix'],
  capabilities: ['code'],
});
```

### Methods

| Method | Signature | Description |
|:---|:---|:---|
| `register(habit)` | `(HabitDefinition) => void` | Register a single habit |
| `registerAll(habits)` | `(HabitDefinition[]) => void` | Register multiple habits |
| `match(intent, taskContext?)` | `(SpawnIntent, string?) => HabitMatch \| null` | Try to match against habits |
| `toSelection(match)` | `(HabitMatch) => ModelSelection` | Convert a match to a ModelSelection |
| `list()` | `() => readonly HabitDefinition[]` | List registered habits |
| `clear()` | `() => void` | Remove all habits |

---

## 4. Resilience

Per-plugin circuit breakers and retry with exponential backoff, powered by [cockatiel](https://github.com/connor4312/cockatiel).

### `createResiliencePolicy(options?)`

Create a standalone resilience policy.

```typescript
import { createResiliencePolicy } from '@maestro/router';

const { policy, breaker } = createResiliencePolicy({
  maxRetries: 3,
  initialDelay: 100,
  breakerThreshold: 3,
});

const result = await policy.execute(() => riskyOperation());
```

### `PluginPolicyManager`

Manages per-plugin resilience policies. Each plugin gets its own circuit breaker.

```typescript
import { PluginPolicyManager } from '@maestro/router';

const manager = new PluginPolicyManager({ breakerThreshold: 5 });

const result = await manager.execute('openrouter', () => plugin.select(intent));
console.log(manager.isOpen('openrouter')); // false (breaker closed)
```

### ResilienceOptions

| Field | Type | Default | Description |
|:---|:---|---:|:---|
| `maxRetries` | `number` | `2` | Max retry attempts (3 total attempts) |
| `initialDelay` | `number` | `200` | First backoff delay in ms |
| `maxDelay` | `number` | `5000` | Max backoff delay in ms |
| `breakerThreshold` | `number` | `5` | Consecutive failures to trip breaker |
| `halfOpenAfter` | `number` | `30000` | Breaker half-open test interval in ms |

---

## 5. Tracing

OpenTelemetry instrumentation. Zero overhead when `@opentelemetry/api` is not installed.

### `withSpan(name, attributes, fn)`

Wrap an async operation in an OTel span.

```typescript
import { withSpan, RouterAttributes } from '@maestro/router';

const result = await withSpan('my.operation', {
  [RouterAttributes.EFFORT]: 'deep',
}, async (span) => {
  span?.setAttributes({ 'my.custom': 'value' });
  return doWork();
});
```

### `withSpanSync(name, attributes, fn)`

Wrap a synchronous operation in an OTel span.

### `RouterAttributes`

Constants for all semantic attribute keys under the `maestro.router.*` namespace. See the README [Semantic Attributes table](../README.md#semantic-attributes) for the full list.

### `resetTracer()`

Reset the cached tracer (for testing). Forces re-acquisition from the OTel API on next use.

---

## 6. Audit

Pluggable routing decision audit trail.

### `RouterAuditLog`

Convenience wrapper around an `AuditStore`.

```typescript
import { RouterAuditLog, InMemoryAuditStore } from '@maestro/router';

const audit = new RouterAuditLog(new InMemoryAuditStore(10_000));

const entry = await audit.record(
  { slug: 'maestro-anthropic-api-opus-4-6-effort:deep', plugin_id: 'maestro', provider: 'anthropic', model: 'opus-4-6', used_fallback: false, habit_match: false },
  { effort: 'deep', cost_sensitivity: 'normal' },
  { caller_id: 'orchestrator', request_id: 'req-123' },
);

const recent = await audit.query({ limit: 10, filter: { plugin_id: 'maestro' } });
const count = await audit.count({ provider: 'anthropic' });
await audit.dispose();
```

### `InMemoryAuditStore`

Bounded in-memory store for development and testing. Evicts oldest entries when `maxEntries` is exceeded.

### `AuditStore` Interface

Implement for production backends (PostgreSQL, Elasticsearch, S3, etc.):

| Method | Signature | Required |
|:---|:---|:---|
| `append(entry)` | `(AuditEntry) => Promise<void>` | Yes |
| `query(options)` | `(AuditQueryOptions) => Promise<AuditEntry[]>` | Yes |
| `count(filter?)` | `(AuditFilter?) => Promise<number>` | Yes |
| `flush()` | `() => Promise<void>` | Optional |
| `dispose()` | `() => Promise<void>` | Optional |

---

## 7. Rate Limiter

Per-key sliding window rate limiter with 429 handling.

### `KeyRateLimiter`

```typescript
import { KeyRateLimiter } from '@maestro/router';

const limiter = new KeyRateLimiter({ maxRequests: 100, windowMs: 60_000 });
```

| Method | Signature | Description |
|:---|:---|:---|
| `canProceed(key)` | `(string) => boolean` | Check if key has quota remaining |
| `recordRequest(key)` | `(string) => void` | Record a successful request |
| `recordRateLimit(key, seconds?)` | `(string, number) => void` | Record a 429 response |
| `getState(key)` | `(string) => RateLimitState \| undefined` | Get current state for a key |
| `remove(key)` | `(string) => void` | Remove state for a key (key rotation) |
| `reset()` | `() => void` | Clear all state |
| `size` | `number` | Number of tracked keys |

### `KeyRateLimiter.parseRetryAfter(value)`

Static method. Parses a `Retry-After` header value (integer seconds or HTTP-date format). Returns seconds to wait. Defaults to 60 if unparseable.

---

## 8. HTTP Utilities

Thin wrapper around [undici](https://github.com/nodejs/undici) for plugin authors.

### `fetchJson<T>(url, options?)`

Fetch JSON with typed response. Throws on non-2xx. Redacts 4xx response bodies.

```typescript
import { fetchJson } from '@maestro/router';

const response = await fetchJson<{ data: Model[] }>('https://api.example.com/models', {
  headers: { 'Authorization': 'Bearer sk-...' },
  timeout: 5000,
});
```

### `isReachable(url, options?)`

Check if a URL responds with 2xx. Swallows errors, returns boolean.

### `validateBaseUrl(url)`

Validates a URL string. Returns the URL if valid (http/https), `null` otherwise.

---

## 9. Algorithms

### `SemanticRouter`

TF-IDF cosine similarity intent classifier. See [README > Algorithms](../README.md#semanticrouter).

| Method | Signature | Description |
|:---|:---|:---|
| `addRoute(route)` | `(Route) => void` | Add a classification route |
| `classify(text)` | `(string) => RouteMatch \| null` | Best match above threshold |
| `classifyAll(text)` | `(string) => RouteMatch[]` | All matches sorted by score |
| `compile()` | `() => void` | Force recompilation of vectors |

### `CostQualityRouter`

RouteLLM-inspired threshold routing. See [README > Algorithms](../README.md#costqualityrouter).

| Method | Signature | Description |
|:---|:---|:---|
| `route(intent, candidates)` | `(SpawnIntent, ModelCapability[]) => ModelCapability` | Select model by cost-quality threshold |

---

## 10. Types

### Core Types

| Type | Description |
|:---|:---|
| `SpawnIntent` | What the orchestrator needs (effort, cost, capabilities, preferences) |
| `ModelSelection` | The 5-part routing result (router, provider, harness, model, config) |
| `ModelCapability` | Model metadata (provider, capabilities, context window, pricing) |
| `Effort` | `'minimal' \| 'standard' \| 'deep'` |
| `CostSensitivity` | `'low' \| 'normal' \| 'high'` |
| `RouterPlugin` | Plugin interface (select, models, healthy, initialize?, dispose?) |
| `RoutingConfig` | Router configuration (plugin, fallback, config) |
| `HabitMatch` | Habit match result (slug, handler, confidence) |
| `HabitDefinition` | Habit definition (slug, handler, triggers, capabilities) |

### Utility Functions

| Function | Signature | Description |
|:---|:---|:---|
| `toSlug(selection)` | `(ModelSelection) => string` | Build canonical slug from selection |
| `EFFORT_DEFAULTS` | `Record<Effort, ExecutionConfig>` | Default execution params per effort |

---

## 11. Errors

All errors extend `RouterError` and carry a `code` string.

| Error | Code | When |
|:---|:---|:---|
| `RouterError` | varies | Base error class |
| `PluginNotFoundError` | `PLUGIN_NOT_FOUND` | Plugin ID not in registry or loaders |
| `PluginInitError` | `PLUGIN_INIT_ERROR` | `plugin.initialize()` threw |
| `PluginUnhealthyError` | `PLUGIN_UNHEALTHY` | `plugin.healthy()` returned false |
| `NoModelAvailableError` | `NO_MODEL_AVAILABLE` | No model meets intent requirements |
| `SelectionError` | `SELECTION_ERROR` | Plugin-specific selection failure |
| `FallbackExhaustedError` | `FALLBACK_EXHAUSTED` | Both primary and fallback failed |

### Programmatic Error Handling

```typescript
import { FallbackExhaustedError, NoModelAvailableError } from '@maestro/router';

try {
  await router.route(intent);
} catch (err) {
  if (err instanceof FallbackExhaustedError) {
    console.error('All plugins failed:', err.attempted.join(' -> '));
    console.error('Last error:', err.lastError.message);
  } else if (err instanceof NoModelAvailableError) {
    console.error('No model for requirements:', err.intent.requires);
  }
}
```
