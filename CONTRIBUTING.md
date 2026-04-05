# Contributing to @maestro/router

Thank you for your interest in contributing. This document covers how to get started, how to run tests, and where to find work.

## Getting Started

```bash
git clone https://github.com/andrewdever/maestro-router.git
cd maestro-router
nvm use 22  # or any Node >= 20
npm install
npm test
```

Verify everything works:

```bash
npm run typecheck   # TypeScript compilation check
npm test            # 286 tests across 15 files
npm run build       # Produces dist/ with declarations
npm run docs        # Generates TypeDoc API reference
```

## Running Tests

```bash
# All tests
npm test

# Watch mode (re-runs on change)
npm run test:watch

# With coverage report
npm run test:coverage

# Specific test file
npx vitest run src/__tests__/unit/router.test.ts

# Specific test pattern
npx vitest run -t "circuit breaker"
```

### Test Categories

| Category | Location | Count | What It Tests |
|:---|:---|---:|:---|
| Unit | `src/__tests__/unit/` | 14 files | Individual modules in isolation |
| Contract | `src/__tests__/contract/` | 1 file | All plugins against the RouterPlugin interface |
| Stress | `src/__tests__/unit/concurrent-stress.test.ts` | 4 tests | Concurrent routing, race conditions |
| Boundary | `src/__tests__/unit/off-peak.test.ts` | 12 tests | Time boundary edge cases |

## Pull Request Process

1. Create a feature branch from `main`: `git checkout -b feature/your-change`
2. Make your changes with tests
3. Run the full check: `npm run typecheck && npm test && npm run build`
4. Create a changeset: `npm run changeset`
5. Push and open a PR against `main`
6. CI must pass (typecheck + test on Node 20 and 22)

### Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(router): add batch API routing support
fix(openrouter): handle empty model list response
docs: update plugin development guide
test: add latency benchmark suite
chore: update cockatiel to v3.3
```

Header must be 72 characters or fewer.

### What Makes a Good PR

- **One concern per PR** -- a bug fix, a feature, a refactor. Not all three.
- **Tests included** -- if you change behavior, add or update tests.
- **Changeset included** -- run `npm run changeset` to describe what changed and why.
- **Trade-offs documented** -- if your change has trade-offs, state them in the PR description.

## Adding a New Plugin

See [docs/PLUGINS.md](./docs/PLUGINS.md) for the full plugin development guide. The short version:

1. Create `src/plugins/your-plugin.ts` implementing `RouterPlugin`
2. Add a loader entry in `src/plugins/registry.ts`
3. Export from `src/index.ts`
4. Run the contract test suite: `npx vitest run src/__tests__/contract/`
5. Add plugin-specific unit tests
6. Document in the Plugins table in README.md and docs/PLUGINS.md

## Roadmap

### v0.2.0 -- Provider Expansion

- [ ] Anthropic direct plugin (Messages API, no aggregator)
- [ ] Azure OpenAI plugin (enterprise Azure-managed endpoints)
- [ ] AWS Bedrock plugin (cross-model routing through Bedrock)
- [ ] Google Vertex AI plugin (Gemini through Google Cloud)
- [ ] DeepSeek plugin (direct API for off-peak pricing)
- [ ] Mistral plugin (La Plateforme direct API)
- [ ] Groq plugin (ultra-low-latency inference)
- [ ] Together AI plugin (open-source model hosting)
- [ ] Fireworks AI plugin (optimized open-source inference)
- [ ] Ollama plugin (local model routing, air-gapped)

### v0.3.0 -- Closed-Loop Optimization

- [ ] Feedback loop: execution outcomes update routing weights
- [ ] Dynamic pricing refresh from provider APIs
- [ ] Latency-aware routing (p50/p95/p99 tracking per provider)
- [ ] Token budget enforcement per user/org
- [ ] A/B routing for continuous provider evaluation
- [ ] Prompt caching hints for cache-eligible requests

### v0.4.0 -- Advanced Intelligence

- [ ] Context window management (estimate tokens, route by capacity)
- [ ] Multi-region routing (geographic preference in intent)
- [ ] Batch API routing (detect async-eligible workloads)
- [ ] Canary deployments with automatic rollback
- [ ] Custom scoring functions (user-defined evaluation)

### v0.5.0 -- Benchmarking and Cost Verification

- [ ] Provider cost benchmarking suite
- [ ] Routing decision latency benchmarks (p50/p95/p99)
- [ ] Cost accuracy scoring (estimated vs actual)
- [ ] A/B cost comparison with statistical significance
- [ ] Chaos cost testing (pricing change simulation)
- [ ] Load testing harness (1K-100K decisions/sec)
- [ ] Provider SLA verification
- [ ] Cost optimization regression tests (golden-file assertions)

### v1.0.0 -- Production Hardening

- [ ] Rust core via napi-rs (habit matching, cost scoring)
- [ ] Redis-backed distributed rate limiter
- [ ] JSONSchema plugin config validation
- [ ] Chaos testing suite (provider failure injection)
- [ ] SLA monitoring with alerting

### Research

- [ ] Reinforcement learning for routing weight optimization
- [ ] Embedding-based intent detection (replace bag-of-words)
- [ ] Provider reliability prediction from historical data
- [ ] Cost forecasting from usage patterns

## Known Technical Debt

| Issue | Impact | Location |
|:---|:---|:---|
| Static model catalogs duplicated across 7 plugins | Update cost when pricing changes | `src/plugins/*.ts` |
| Module-level singleton state in plugins | Fragile if imported outside registry | `src/plugins/*.ts` |
| Audit ID uses monotonic counter | Overflow after ~2^53 entries | `src/audit.ts:178` |
| SemanticRouter uses naive tokenization | Reduced accuracy for non-English | `src/algorithms/semantic-router.ts` |
| No schema validation on plugin config | Silent misconfiguration | `src/registry.ts:53` |

## Where to Start

### Good First Contributions

- Add a new plugin (Ollama, Groq, or Together AI are good starting points)
- Add missing test cases (concurrent cache refresh, audit store edge cases)
- Improve SemanticRouter tokenization (stemming, lemmatization)
- Add JSDoc to exported types that are missing documentation

### Larger Contributions

- Implement the feedback loop (v0.3.0 feature)
- Build the cost benchmarking suite (v0.5.0 feature)
- Port habit matching to Rust via napi-rs (v1.0.0 feature)
- Implement a Redis-backed rate limiter

## Code of Conduct

Be respectful, constructive, and professional. We're building infrastructure that routes real money through real APIs -- precision and care matter.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
