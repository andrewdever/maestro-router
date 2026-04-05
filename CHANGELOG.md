# Changelog

All notable changes to `@maestro/router` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-05

### Added

- **Core routing engine**: Intent-based routing via `SpawnIntent` producing `ModelSelection` with canonical 5-part slugs (`router-provider-harness-model-config`).
- **7 plugins**: Direct (offline, zero-config), Maestro (score-informed), OpenRouter (200+ models), Requesty (sub-20ms failover), Portkey (self-hosted gateway), LiteLLM (2500+ models), Mock (testing).
- **Habit-based local routing**: Zero-token pattern matching that short-circuits before any plugin call. Define keyword triggers mapped to model selections.
- **Resilience layer**: Per-plugin circuit breakers, retry with exponential backoff, via [cockatiel](https://github.com/connor4312/cockatiel). Configurable thresholds, delays, and half-open recovery.
- **OpenTelemetry instrumentation**: Full span hierarchy (`router.route` > `router.habit_check` > `router.resolve_plugin` > `router.select`) with 13 semantic attributes. Optional peer dependency -- zero overhead when not installed.
- **Per-key rate limiting**: Sliding window rate limiter with 429 `Retry-After` header parsing (integer seconds and HTTP-date formats).
- **Pluggable audit trail**: `AuditStore` interface with `InMemoryAuditStore` default. Every routing decision is recorded with intent, decision, and caller context.
- **Routing algorithms**: `SemanticRouter` (bag-of-words intent classification) and `CostQualityRouter` (matrix factorization threshold routing).
- **Off-peak pricing intelligence**: Provider-specific time windows (e.g., DeepSeek 16:30--00:30 UTC at 50% off) with midnight-crossing logic.
- **Cost-quality tradeoff**: Configurable `cost_sensitivity` (low/normal/high) influences model selection across all plugins.
- **HTTP utilities**: `fetchJson<T>()` and `isReachable()` via [undici](https://github.com/nodejs/undici) with timeout, 4xx response body redaction, and URL validation.
- **Plugin fallback chains**: Primary plugin fails gracefully to a configured fallback. `DirectPlugin` is always available as the last resort.
- **Concurrent cache coalescing**: Multiple simultaneous `models()` calls share a single HTTP request instead of stampeding the provider API.
- **250 tests** across 15 test files: unit, contract, stress, and boundary tests.

### Security

- API keys never appear in error messages or rationale strings.
- 4xx response bodies are redacted to prevent credential reflection.
- Base URL validation ensures only http/https protocols.
- URL query parameters stripped from error messages.

[0.1.0]: https://github.com/andrewdever/maestro-router/releases/tag/v0.1.0
