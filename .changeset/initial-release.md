---
"@maestro/router": minor
---

Initial release of @maestro/router v0.1.0

- Intent-based routing: SpawnIntent -> ModelSelection with canonical 5-part slugs
- 7 plugins: Direct, Maestro, OpenRouter, Requesty, Portkey, LiteLLM, Mock
- Habit-based local routing: zero-token pattern matching before plugin calls
- Cockatiel resilience: per-plugin circuit breakers, retry with exponential backoff
- OpenTelemetry instrumentation: full span hierarchy (optional peer dep)
- Per-key rate limiting with sliding window and 429 Retry-After parsing
- Pluggable audit trail for routing decision compliance and debugging
- 2 routing algorithms: SemanticRouter (intent classification) + CostQualityRouter (MF threshold)
- Off-peak pricing intelligence (provider-specific time windows)
- Cost-quality tradeoff optimization with configurable sensitivity
- Standalone: zero internal dependencies, publish-ready
