# Quick Start

Get routing in under 5 minutes.

---

## What you're building

The router is a **decision engine**. You tell it what you need ("deep thinking, code capability, prefer Anthropic"), and it tells you which provider and model to use. That's it.

It never touches your prompts. It never sees your responses. It doesn't proxy traffic. Your orchestrator calls the provider directly -- the router just tells it who to call.

```
Your code  ---SpawnIntent--->  Router  ---ModelSelection--->  Your code  ---API call--->  Provider
```

Everything below follows that pattern: describe what you need, get a recommendation, act on it yourself.

---

## 1. Install

```bash
npm install @maestro/router
```

Optional -- for OpenTelemetry tracing:

```bash
npm install @opentelemetry/api
```

## 2. Basic Routing (No API Keys)

The `direct` plugin works offline with zero configuration. Good for development and testing.

```typescript
import { Router } from '@maestro/router';

const router = new Router();

const result = await router.route({
  effort: 'standard',
  cost_sensitivity: 'normal',
  requires: ['code'],
});

console.log(result.slug);
// direct-anthropic-api-claude-sonnet-4-6-effort:standard

console.log(result.selection.model);
// claude-sonnet-4-6

console.log(result.selection.estimated_cost);
// 0.000048

await router.dispose();
```

## 3. Production Routing (With API Key)

Use a provider plugin for **smarter** model selection. The API key gives the plugin access to the provider's model catalog (pricing, availability) -- it does NOT route your AI traffic through that provider:

```typescript
import { Router } from '@maestro/router';

const router = new Router({
  config: {
    plugin: 'openrouter',
    fallback: 'direct',
    config: {
      api_key: process.env.OPENROUTER_API_KEY,
    },
  },
});

await router.initialize();

// Route a complex task -- selects a strong model
const deep = await router.route({
  effort: 'deep',
  cost_sensitivity: 'low',
  requires: ['thinking', 'code'],
});
console.log(deep.slug);
// openrouter-anthropic-api-claude-opus-4-6-effort:deep

// Route a simple task -- selects a cheap model
const quick = await router.route({
  effort: 'minimal',
  cost_sensitivity: 'high',
});
console.log(quick.slug);
// openrouter-google-api-gemini-2.5-flash-effort:minimal

await router.dispose();
```

## 4. Add Habits (Zero-Token Shortcuts)

Habits short-circuit routing for known tasks. No API call, no tokens, no cost.

```typescript
import { Router, HabitMatcher } from '@maestro/router';

const habits = new HabitMatcher();
habits.register({
  slug: 'format-code',
  handler: 'local://formatters/prettier',
  triggers: ['format', 'prettier', 'lint fix'],
  capabilities: ['code'],
});

const router = new Router({ habits });

// This matches the habit -- instant, free
const result = await router.route(
  { effort: 'minimal', cost_sensitivity: 'normal' },
  'format this code with prettier',
);

console.log(result.habit_match);     // true
console.log(result.resolved_plugin); // 'habit'
console.log(result.slug);            // habit-local-none-none-effort:zero

await router.dispose();
```

## 5. Enable Audit Trail

Record every routing decision for debugging and compliance:

```typescript
import { Router, InMemoryAuditStore } from '@maestro/router';

const auditStore = new InMemoryAuditStore();

const router = new Router({
  config: { plugin: 'direct' },
  auditStore,
});

// Route some requests
await router.route({ effort: 'deep', cost_sensitivity: 'normal' });
await router.route({ effort: 'minimal', cost_sensitivity: 'high' });
await router.route({ effort: 'standard', cost_sensitivity: 'normal' });

// Query the audit log
const entries = await auditStore.query({ limit: 10 });
console.log(`${entries.length} routing decisions recorded`);

for (const entry of entries) {
  console.log(`  ${entry.decision.slug} (${entry.intent.effort})`);
}

// Count by provider
const anthropicCount = await auditStore.count({ provider: 'anthropic' });
console.log(`${anthropicCount} requests routed to Anthropic`);

await router.dispose();
```

## 6. Configure Resilience

Protect against provider failures with circuit breakers and retry:

```typescript
import { Router } from '@maestro/router';

const router = new Router({
  config: {
    plugin: 'openrouter',
    fallback: 'direct',  // auto-failover when OpenRouter is down
    config: { api_key: process.env.OPENROUTER_API_KEY },
  },
  resilience: {
    maxRetries: 2,          // retry twice on transient failures
    initialDelay: 200,      // 200ms first backoff
    breakerThreshold: 5,    // trip breaker after 5 consecutive failures
    halfOpenAfter: 30_000,  // test again after 30 seconds
  },
});

// If OpenRouter fails 5 times in a row, the circuit breaker opens
// and all subsequent requests route through DirectPlugin until
// the breaker half-opens and tests a probe request.

const result = await router.route({
  effort: 'standard',
  cost_sensitivity: 'normal',
});

// Check if fallback was used
if (result.used_fallback) {
  console.warn('Primary plugin failed, used fallback:', result.resolved_plugin);
}

await router.dispose();
```

## 7. Full Production Setup

Putting it all together:

```typescript
import { Router, HabitMatcher, InMemoryAuditStore } from '@maestro/router';

// 1. Define habits for common tasks
const habits = new HabitMatcher();
habits.registerAll([
  {
    slug: 'format-code',
    handler: 'local://formatters/prettier',
    triggers: ['format', 'prettier', 'beautify'],
    capabilities: ['code'],
  },
  {
    slug: 'run-tests',
    handler: 'local://test-runner/vitest',
    triggers: ['run tests', 'test suite', 'vitest'],
    capabilities: ['code'],
  },
]);

// 2. Create audit store (use a database-backed store in real production)
const auditStore = new InMemoryAuditStore(50_000);

// 3. Build the router
const router = new Router({
  config: {
    plugin: 'openrouter',
    fallback: 'direct',
    config: { api_key: process.env.OPENROUTER_API_KEY },
  },
  habits,
  auditStore,
  resilience: {
    maxRetries: 2,
    breakerThreshold: 5,
    halfOpenAfter: 30_000,
  },
});

// 4. Initialize
await router.initialize();

// 5. Route requests
const result = await router.route(
  {
    effort: 'deep',
    cost_sensitivity: 'normal',
    requires: ['thinking', 'code'],
    prefer_provider: 'anthropic',
  },
  'analyze this complex legacy codebase and suggest refactoring strategy',
);

console.log(result.slug);
console.log(result.selection.rationale);
console.log(`Estimated cost: $${result.selection.estimated_cost}`);

// 6. Clean up
await router.dispose();
```

---

## Next Steps

- [Configuration Guide](./CONFIGURATION.md) -- all options and presets
- [Plugin Guide](./PLUGINS.md) -- shipped plugins, comparison matrix, custom plugin development
- [API Reference](./API.md) -- complete method and type reference
- [Security Guide](./SECURITY.md) -- threat model, defense layers, production recommendations
- [Contributing](../CONTRIBUTING.md) -- how to add features, roadmap, known debt
