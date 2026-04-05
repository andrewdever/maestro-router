/**
 * @maestro/router — Decoupled routing layer for the Maestro orchestration platform.
 *
 * Receives a SpawnIntent from the orchestrator and resolves it to a
 * router → provider → harness → model → config combination.
 *
 * Self-contained: no dependencies on @maestro/spec or @maestro/score at runtime.
 * Can be published and used as a standalone package.
 */

// ── Main API ───────────────────────────────────────────────────────

/** The main router — orchestrates habits, registry, and plugin selection. */
export { Router } from './router.js';
export type { RouterOptions, RouteResult } from './router.js';

/** Plugin lifecycle manager with fallback chains and dynamic loading. */
export { RouterRegistry } from './registry.js';

/** Resilience policies (circuit breaker, retry, backoff). */
export {
  createResiliencePolicy,
  PluginPolicyManager,
} from './resilience.js';
export type { ResilienceOptions } from './resilience.js';

/** Habit matching — local-first routing, zero tokens. */
export { HabitMatcher } from './habits.js';
export type { HabitDefinition } from './habits.js';

/** Score engine integration bridge. */
export {
  StaticScoreBridge,
  createDefaultScoreBridge,
} from './score-bridge.js';
export type { ScoreBridge, ModelQualityData } from './score-bridge.js';

// ── Types ──────────────────────────────────────────────────────────

export type {
  Effort,
  CostSensitivity,
  SpawnIntent,
  ModelSelection,
  ModelCapability,
  RouterPlugin,
  PluginLoader,
  PluginLoaderRegistry,
  RoutingConfig,
  ExecutionConfig,
  HabitMatch,
} from './types.js';

export { EFFORT_DEFAULTS, toSlug } from './types.js';

// ── Shipped Plugins ────────────────────────────────────────────────

/** Dynamic plugin loader registry — only loads what you use. */
export { ROUTER_PLUGINS } from './plugins/registry.js';

// ── Algorithms ─────────────────────────────────────────────────────

/** Embedding-based intent classification. */
export { SemanticRouter, createDefaultRouter } from './algorithms/semantic-router.js';
export type { Route, RouteMatch } from './algorithms/semantic-router.js';

/** Cost-quality threshold routing. */
export { CostQualityRouter, createDefaultCostQualityRouter } from './algorithms/routellm-mf.js';

// ── Tracing ───────────────────────────────────────────────────────

/** OpenTelemetry instrumentation (no-op when OTel is not installed). */
export { withSpan, withSpanSync, resetTracer, RouterAttributes } from './tracing.js';

// ── HTTP Utilities ────────────────────────────────────────────────

/** HTTP utilities for plugin authors. */
export { fetchJson, isReachable, validateBaseUrl } from './http.js';
export type { HttpOptions, HttpResponse } from './http.js';

// ── Rate Limiting ────────────────────────────────────────────────

/** Per-key rate limiter with sliding window and 429 handling. */
export { KeyRateLimiter } from './rate-limiter.js';
export type { RateLimitState, RateLimiterOptions } from './rate-limiter.js';

// ── Audit ─────────────────────────────────────────────────────────

/** Routing decision audit log with pluggable storage. */
export { RouterAuditLog, InMemoryAuditStore } from './audit.js';
export type {
  AuditEntry,
  AuditStore,
  AuditQueryOptions,
  AuditFilter,
} from './audit.js';

// ── Errors ─────────────────────────────────────────────────────────

export {
  RouterError,
  PluginNotFoundError,
  PluginInitError,
  PluginUnhealthyError,
  NoModelAvailableError,
  SelectionError,
  FallbackExhaustedError,
} from './errors.js';
