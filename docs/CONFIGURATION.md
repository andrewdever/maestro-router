# Configuration Guide

This document covers all configuration options for @maestro/router.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Router Options](#2-router-options)
3. [Plugin Configuration](#3-plugin-configuration)
4. [Resilience Configuration](#4-resilience-configuration)
5. [Habit Configuration](#5-habit-configuration)
6. [Audit Configuration](#6-audit-configuration)
7. [Rate Limiter Configuration](#7-rate-limiter-configuration)
8. [Environment Variables](#8-environment-variables)
9. [Presets](#9-presets)

---

## 1. Quick Start

```typescript
import { Router } from '@maestro/router';

// Minimal -- uses DirectPlugin, no API keys needed
const router = new Router();

// Standard -- Maestro plugin with Direct fallback
const router = new Router({
  config: { plugin: 'maestro', fallback: 'direct' },
});

// Production -- full configuration
const router = new Router({
  config: {
    plugin: 'openrouter',
    fallback: 'direct',
    config: { api_key: process.env.OPENROUTER_API_KEY },
  },
  resilience: { maxRetries: 3, breakerThreshold: 5 },
  auditStore: new InMemoryAuditStore(50_000),
});
```

---

## 2. Router Options

### Full Reference

```typescript
interface RouterOptions {
  config?: {
    plugin?: string;                    // default: 'direct'
    fallback?: string;                  // default: 'direct'
    config?: Record<string, unknown>;   // default: {}
  };
  registry?: RouterRegistry;            // default: auto-created
  habits?: HabitMatcher;                // default: empty
  resilience?: ResilienceOptions;       // default: see below
  auditStore?: AuditStore;             // default: null (disabled)
}
```

| Field | Type | Default | Description |
|:---|:---|:---|:---|
| `config.plugin` | `string` | `'direct'` | Primary plugin ID. Must be a registered or loadable plugin. |
| `config.fallback` | `string` | `'direct'` | Fallback plugin ID. Used when primary is unhealthy or fails. |
| `config.config` | `Record<string, unknown>` | `{}` | Passed to `plugin.initialize()`. Plugin-specific. |
| `registry` | `RouterRegistry` | auto-created with `ROUTER_PLUGINS` | Pre-built registry for custom setups or testing. |
| `habits` | `HabitMatcher` | empty matcher | Pre-built habit matcher with registered habits. |
| `resilience` | `ResilienceOptions` | see [Resilience](#4-resilience-configuration) | Circuit breaker and retry configuration. |
| `auditStore` | `AuditStore` | `null` | Audit storage backend. Omit to disable auditing. |

---

## 3. Plugin Configuration

Each plugin accepts specific config keys through `config.config`.

### Direct Plugin

No configuration needed. Always available, always healthy.

```typescript
const router = new Router({ config: { plugin: 'direct' } });
```

### Maestro Plugin

| Key | Type | Default | Description |
|:---|:---|:---|:---|
| `off_peak_enabled` | `boolean` | `true` | Enable off-peak pricing optimization |
| `score_bridge` | `ScoreBridge` | `StaticScoreBridge` | Quality scoring backend |
| `models` | `ModelCapability[]` | built-in catalog | Custom model catalog |

```typescript
const router = new Router({
  config: {
    plugin: 'maestro',
    config: { off_peak_enabled: true },
  },
});
```

### OpenRouter Plugin

| Key | Type | Required | Description |
|:---|:---|:---|:---|
| `api_key` or `OPENROUTER_API_KEY` | `string` | Yes | OpenRouter API key |
| `base_url` | `string` | No | API base URL (default: `https://openrouter.ai/api/v1`) |

```typescript
const router = new Router({
  config: {
    plugin: 'openrouter',
    fallback: 'direct',
    config: { api_key: process.env.OPENROUTER_API_KEY },
  },
});
```

### Requesty Plugin

| Key | Type | Required | Description |
|:---|:---|:---|:---|
| `api_key` or `REQUESTY_API_KEY` | `string` | Yes | Requesty API key |
| `base_url` | `string` | No | API base URL (default: `https://router.requesty.ai/v1`) |

### Portkey Plugin

| Key | Type | Required | Description |
|:---|:---|:---|:---|
| `api_key` or `PORTKEY_API_KEY` | `string` | Yes | Portkey API key |
| `base_url` | `string` | No | Gateway URL (default: `https://api.portkey.ai/v1`) |
| `virtual_key` | `string` | No | Portkey virtual key for key management |

```typescript
// Self-hosted Portkey gateway
const router = new Router({
  config: {
    plugin: 'portkey',
    config: {
      api_key: process.env.PORTKEY_API_KEY,
      base_url: 'https://gateway.internal.example.com/v1',
      virtual_key: 'my-team-key',
    },
  },
});
```

### LiteLLM Plugin

| Key | Type | Required | Description |
|:---|:---|:---|:---|
| `api_key` or `LITELLM_API_KEY` | `string` | Proxy mode | LiteLLM proxy API key |
| `base_url` | `string` | No | Proxy URL (default: `http://localhost:4000`) |
| `mode` | `'proxy' \| 'sdk'` | No | Operating mode (default: `'proxy'`) |

```typescript
// Proxy mode
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

### Mock Plugin

| Key | Type | Required | Description |
|:---|:---|:---|:---|
| `responses` | `Record<Effort, ModelSelection>` | No | Pre-configured responses by effort |

```typescript
// Testing
const router = new Router({
  config: {
    plugin: 'mock',
    config: {
      responses: {
        deep: { router: 'mock', provider: 'test', harness: 'api', model: 'test-deep', config: 'effort:deep' },
        standard: { router: 'mock', provider: 'test', harness: 'api', model: 'test-standard', config: 'effort:standard' },
        minimal: { router: 'mock', provider: 'test', harness: 'api', model: 'test-minimal', config: 'effort:minimal' },
      },
    },
  },
});
```

---

## 4. Resilience Configuration

### ResilienceOptions

| Field | Type | Default | Description |
|:---|:---|---:|:---|
| `maxRetries` | `number` | `2` | Retry attempts before giving up. Total attempts = maxRetries + 1. |
| `initialDelay` | `number` | `200` | First backoff delay in milliseconds. |
| `maxDelay` | `number` | `5000` | Maximum backoff delay in milliseconds. |
| `breakerThreshold` | `number` | `5` | Consecutive failures before the circuit breaker opens. |
| `halfOpenAfter` | `number` | `30000` | Milliseconds before the breaker tries a half-open probe. |

### Presets

| Preset | maxRetries | initialDelay | breakerThreshold | halfOpenAfter | Use Case |
|:---|---:|---:|---:|---:|:---|
| **Conservative** | 1 | 500 | 3 | 60000 | Production with tight latency budgets |
| **Balanced** (default) | 2 | 200 | 5 | 30000 | General workloads |
| **Aggressive** | 4 | 100 | 10 | 15000 | Batch processing, tolerant of retries |

```typescript
// Conservative
const router = new Router({
  resilience: { maxRetries: 1, initialDelay: 500, breakerThreshold: 3, halfOpenAfter: 60_000 },
});

// Aggressive
const router = new Router({
  resilience: { maxRetries: 4, initialDelay: 100, breakerThreshold: 10, halfOpenAfter: 15_000 },
});
```

> **Important:** The circuit breaker is per-plugin. One failing plugin does not affect others. When a breaker trips (opens), the plugin is bypassed and the fallback is used until the half-open interval expires.

---

## 5. Habit Configuration

Habits are registered on a `HabitMatcher` instance and passed to the Router.

```typescript
import { Router, HabitMatcher } from '@maestro/router';

const habits = new HabitMatcher();

habits.registerAll([
  {
    slug: 'format-code',
    handler: 'local://formatters/prettier',
    triggers: ['format', 'prettier', 'lint fix', 'beautify'],
    capabilities: ['code'],
  },
  {
    slug: 'git-status',
    handler: 'local://git/status',
    triggers: ['git status', 'show changes', 'what changed'],
  },
  {
    slug: 'run-tests',
    handler: 'local://test-runner/vitest',
    triggers: ['run tests', 'test suite', 'vitest'],
    capabilities: ['code'],
  },
]);

const router = new Router({ habits });
```

### HabitDefinition

| Field | Type | Required | Description |
|:---|:---|:---|:---|
| `slug` | `string` | Yes | Unique identifier for this habit |
| `handler` | `string` | Yes | Local handler path or function reference |
| `triggers` | `string[]` | Yes | Keywords that activate this habit (case-insensitive substring match) |
| `capabilities` | `string[]` | No | Capabilities this habit handles. If the intent requires capabilities, the habit must declare all of them. |

### Matching Rules

1. Habits are checked **before** any plugin call
2. Trigger matching is case-insensitive substring matching against the `taskContext` string
3. If `intent.requires` is set and the habit declares `capabilities`, all required capabilities must be present
4. First matching habit wins (registration order)
5. On match: zero tokens, zero API calls, zero cost

---

## 6. Audit Configuration

### Enabling Auditing

Pass an `AuditStore` to the Router:

```typescript
import { Router, InMemoryAuditStore } from '@maestro/router';

const router = new Router({
  auditStore: new InMemoryAuditStore(10_000),
});
```

### InMemoryAuditStore Options

| Parameter | Type | Default | Description |
|:---|:---|---:|:---|
| `maxEntries` | `number` | `10000` | Maximum entries before oldest are evicted |

> **Important:** `InMemoryAuditStore` is for development and testing only. Entries are lost on process restart. For production, implement the `AuditStore` interface backed by a durable store.

### AuditQueryOptions

| Field | Type | Default | Description |
|:---|:---|:---|:---|
| `since` | `string` (ISO 8601) | none | Start of time range (inclusive) |
| `until` | `string` (ISO 8601) | none | End of time range (inclusive) |
| `limit` | `number` | `100` | Maximum entries to return |
| `filter` | `AuditFilter` | none | Filter criteria |

### AuditFilter

| Field | Type | Description |
|:---|:---|:---|
| `plugin_id` | `string` | Filter by plugin ID |
| `provider` | `string` | Filter by provider |
| `model` | `string` | Filter by model |
| `caller_id` | `string` | Filter by caller |
| `habit_match` | `boolean` | Filter by habit match status |

---

## 7. Rate Limiter Configuration

### RateLimiterOptions

| Field | Type | Default | Description |
|:---|:---|---:|:---|
| `maxRequests` | `number` | `60` | Maximum requests per window per key |
| `windowMs` | `number` | `60000` | Window duration in milliseconds |

```typescript
import { KeyRateLimiter } from '@maestro/router';

// 100 requests per minute per key
const limiter = new KeyRateLimiter({ maxRequests: 100, windowMs: 60_000 });

// 1000 requests per hour per key
const limiter = new KeyRateLimiter({ maxRequests: 1000, windowMs: 3_600_000 });
```

---

## 8. Environment Variables

The router itself does not read environment variables. Plugins accept API keys through their `config` object at initialization time. The recommended pattern is to read from the environment in your application code:

```typescript
const router = new Router({
  config: {
    plugin: 'openrouter',
    fallback: 'direct',
    config: {
      api_key: process.env.OPENROUTER_API_KEY,
    },
  },
});
```

### Common Environment Variables

| Variable | Plugin | Description |
|:---|:---|:---|
| `OPENROUTER_API_KEY` | OpenRouter | API key for openrouter.ai |
| `REQUESTY_API_KEY` | Requesty | API key for requesty.ai |
| `PORTKEY_API_KEY` | Portkey | API key for portkey.ai |
| `LITELLM_API_KEY` | LiteLLM | API key for LiteLLM proxy |

---

## 9. Presets

Common configuration combinations for different deployment scenarios.

### Development

```typescript
const router = new Router(); // DirectPlugin, no API keys, no audit
```

### Staging

```typescript
const router = new Router({
  config: { plugin: 'openrouter', fallback: 'direct', config: { api_key: process.env.OPENROUTER_API_KEY } },
  resilience: { maxRetries: 1, breakerThreshold: 3 },
  auditStore: new InMemoryAuditStore(),
});
```

### Production

```typescript
const router = new Router({
  config: { plugin: 'maestro', fallback: 'openrouter', config: { off_peak_enabled: true } },
  resilience: { maxRetries: 2, breakerThreshold: 5, halfOpenAfter: 30_000 },
  auditStore: new PostgresAuditStore(connectionPool), // your implementation
  habits: productionHabits, // pre-registered habits
});
```

### Air-Gapped

```typescript
const habits = new HabitMatcher();
habits.registerAll(allKnownPatterns);

const router = new Router({
  config: { plugin: 'direct' },
  habits,
  // No API keys, no network, no audit (or file-based audit)
});
```
