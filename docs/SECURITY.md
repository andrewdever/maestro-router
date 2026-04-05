# Security Architecture

Version: 1.0
Last updated: 2026-04-05

---

## Table of Contents

1. [Security Model](#1-security-model)
2. [Trust Boundaries](#2-trust-boundaries)
3. [Credential Management](#3-credential-management)
4. [Input Validation](#4-input-validation)
5. [Output Sanitization](#5-output-sanitization)
6. [Rate Limiting](#6-rate-limiting)
7. [Audit Trail](#7-audit-trail)
8. [Threat Model](#8-threat-model)
9. [Defense Layers](#9-defense-layers)
10. [Incident Response](#10-incident-response)
11. [Recommendations for Production](#11-recommendations-for-production)

---

## 1. Security Model

@maestro/router is a **pure decision engine** -- it tells your orchestrator which provider and model to use, then gets out of the way. It never executes model calls, never sees prompts or completions, never stores conversation data, and never proxies provider traffic. Plugins that query external services (OpenRouter, Portkey, LiteLLM) do so only to read model catalog data -- pricing, availability, capabilities -- not to route AI requests.

This means the router has **zero access to sensitive content** by design. Its security surface is limited to:

- **API credentials** -- plugin API keys passed at initialization
- **Routing decisions** -- which provider/model is selected for each intent
- **Provider communication** -- HTTP calls to discover model catalogs
- **Audit data** -- records of every routing decision

The security model follows **defense in depth**: multiple independent layers, each designed to function even if upstream layers fail.

---

## 2. Trust Boundaries

```
+------------------------------------------+
|              ORCHESTRATOR                 |
|  (trusted: constructs SpawnIntent)       |
+------------------------------------------+
                    |
            SpawnIntent (typed, constrained)
                    |
+------------------------------------------+
|            @maestro/router               |
|                                          |
|  +-----------+    +------------------+   |
|  |  Habits   |    |  Plugin Registry |   |
|  | (local,   |    |  (manages keys,  |   |
|  |  no I/O)  |    |   makes HTTP)    |   |
|  +-----------+    +------------------+   |
|                          |               |
|                   +------+------+        |
|                   | Resilience  |        |
|                   | (breaker,   |        |
|                   |  retry)     |        |
|                   +------+------+        |
|                          |               |
+------------------------------------------+
                    |
           HTTP (with credentials)
                    |
+------------------------------------------+
|          PROVIDER APIs                   |
|  (untrusted: responses may contain       |
|   reflected credentials, errors,         |
|   malformed data)                        |
+------------------------------------------+
```

**Key trust boundary:** Provider API responses are **untrusted**. The router must not:
- Include raw provider error responses in its own error messages
- Trust provider-reported pricing without validation
- Assume provider model catalogs are well-formed

---

## 3. Credential Management

### Storage

API keys are stored in module-level `let` variables within each plugin module. One instance per process via ES module caching.

```
initialize(config) --> sets module-level apiKey
select(intent)     --> uses apiKey for HTTP headers
dispose()          --> resets apiKey to null
```

### Security Properties

| Property | Status | Implementation |
|:---|:---|:---|
| Keys never in error messages | Enforced | `SelectionError` uses generic messages |
| Keys never in rationale strings | Enforced | Rationale includes model/effort, never credentials |
| Keys never in OTel spans | Enforced | `RouterAttributes` excludes credential fields |
| Keys never in audit entries | Enforced | `AuditEntry` schema has no credential fields |
| Keys never in URL query params | Enforced | All plugins use `Authorization` headers |
| Keys cleared on dispose | Enforced | Every plugin resets `apiKey = null` in `dispose()` |

### Recommendations

- Pass API keys via environment variables, not hardcoded strings
- Use a secrets manager (Vault, AWS Secrets Manager, etc.) in production
- Rotate keys periodically and call `limiter.remove(oldKey)` to clear stale state
- Never log the Router config object (it contains keys)

---

## 4. Input Validation

### SpawnIntent Validation

`SpawnIntent` is typed at compile time:

- `effort` is a union type: `'minimal' | 'standard' | 'deep'`
- `cost_sensitivity` is a union type: `'low' | 'normal' | 'high'`
- `requires` is an optional string array
- `exclude_providers` is an optional string array

Plugins validate capabilities at runtime (filtering models that don't match `requires`).

### Plugin Config Validation

- `validateBaseUrl(url)` rejects non-http/https protocols
- API key presence is checked in `initialize()` (fail fast)
- Unknown config keys are silently ignored (forward-compatible)

> **Note:** There is no JSONSchema validation on plugin config yet. This is tracked as technical debt and planned for v1.0.0.

### HTTP Response Validation

- `safeParseFloat(value)` returns 0 for NaN (prevents NaN propagation from malformed API responses)
- Model catalog parsing uses null checks and falls back to static data
- Cache timestamp is always set, even on parse failure (prevents infinite retry loops)

---

## 5. Output Sanitization

### Error Messages

Provider API responses may contain reflected credentials, PII, or injection payloads. The router sanitizes error output:

```typescript
// 4xx responses are redacted entirely
const detail = response.statusCode >= 400 && response.statusCode < 500
  ? '[client error response redacted]'
  : JSON.stringify(data).slice(0, 200);
```

This prevents:
- Credential reflection (provider echoes back API key in 401 response)
- Verbose error leakage (provider includes internal state in 400 response)
- Injection via error messages (reflected XSS in error rendering)

### URL Sanitization

Error messages include the request URL but this could contain query-string credentials:

```
GET https://api.example.com/v1/models?api_key=sk-secret
```

> **Recommendation:** Avoid passing credentials as query parameters. All shipped plugins use `Authorization` headers. If you build a custom plugin, use headers.

---

## 6. Rate Limiting

### Per-Key Isolation

Each API key gets an independent sliding window. One key hitting limits does not affect others.

### 429 Handling

When a provider returns 429 (Too Many Requests), the rate limiter:

1. Parses the `Retry-After` header (integer seconds or HTTP-date)
2. Blocks the key until the cooldown expires
3. `canProceed(key)` returns `false` during cooldown

### Window Reset

Windows reset automatically after `windowMs` elapses. No manual intervention needed.

### Abuse Prevention

The rate limiter prevents accidental API abuse from your own application. It does not protect against external attacks (that's the provider's responsibility).

---

## 7. Audit Trail

### Independence Principle

The audit system follows **separation of detection and remediation**:

- **Detection**: The audit store records routing decisions (append-only)
- **Remediation**: Cost adjustments, provider failover, rule changes happen elsewhere

The entity recording decisions has no authority to modify routing behavior. This structural separation prevents audit corruption.

### Audit Entry Schema

Every routing decision records:

- `id` -- unique entry ID (`aud_{timestamp}_{counter}`)
- `timestamp` -- ISO 8601
- `decision` -- slug, plugin_id, provider, model, used_fallback, habit_match, estimated_cost, quality_score
- `intent` -- effort, cost_sensitivity, requires, prefer_provider
- `context` -- caller_id, request_id, metadata (all optional)

### What Is NOT Recorded

- API keys or credentials
- User content or prompts
- Provider response bodies
- Error stack traces

### Fire-and-Forget

Audit writes are non-blocking. If the audit store fails, routing continues. Failures are logged to `console.error` for observability.

---

## 8. Threat Model

| # | Threat | Likelihood | Impact | Mitigation | Status |
|---:|:---|:---|:---|:---|:---|
| 1 | API key exposure in logs/errors | Medium | High | Keys excluded from all output paths | Mitigated |
| 2 | Credential reflection via 4xx bodies | Medium | High | 4xx response bodies redacted | Mitigated |
| 3 | Provider impersonation via bad base URL | Low | High | `validateBaseUrl()` rejects non-http/https | Mitigated |
| 4 | Cache poisoning via concurrent refresh | Low | Medium | Promise coalescing (single HTTP request) | Mitigated |
| 5 | Audit log tampering | Low | Medium | Append-only interface, no delete API | Mitigated |
| 6 | Rate limit bypass | Low | Low | Per-key enforcement, cooldown from 429 | Mitigated |
| 7 | NaN propagation from malformed data | Low | Low | `safeParseFloat()` returns 0 | Mitigated |
| 8 | Plugin config injection | Low | Medium | Type checking, no eval/Function | Mitigated |
| 9 | Denial of service via large model catalog | Low | Low | Response body truncation (200 chars) | Partial |
| 10 | Module-level state leak across requests | Low | Low | Singleton pattern, registry lifecycle | Accepted |

### Accepted Risks

- **Module-level state**: Plugin singletons share state across all requests in a process. This is by design (ES module caching). The risk is minimal because the registry manages lifecycle, but direct imports could bypass this.
- **Static pricing**: Model pricing is embedded at build time. If a provider changes pricing, the router uses stale data until redeployed. Tracked for v0.3.0 (dynamic pricing refresh).

---

## 9. Defense Layers

Following the **Swiss Cheese Model**: each layer has holes, but the layers are stacked so no single failure path exists.

```
Layer 1: Type System
  TypeScript enforces SpawnIntent shape, ModelSelection shape, error codes
  Holes: runtime type coercion, unvalidated plugin config

Layer 2: Input Validation
  validateBaseUrl(), safeParseFloat(), capability filtering
  Holes: no JSONSchema for plugin config (planned v1.0)

Layer 3: Credential Isolation
  Keys in headers only, redacted in errors, excluded from audit/spans
  Holes: query-string credentials in custom plugins

Layer 4: Resilience
  Circuit breaker per plugin, retry with backoff, fallback chains
  Holes: all providers down simultaneously

Layer 5: Output Sanitization
  4xx body redaction, response truncation, error code mapping
  Holes: 5xx responses include truncated body (200 chars)

Layer 6: Observability
  OTel spans, audit trail, console.error for failures
  Holes: audit store can fail (fire-and-forget)

Layer 7: Rate Limiting
  Per-key sliding window, 429 cooldown
  Holes: in-memory only (not distributed)
```

---

## 10. Incident Response

If you suspect a credential leak or routing compromise:

1. **Rotate all provider API keys immediately**
2. **Review the audit trail** for unexpected routing patterns (unusual providers, models, or caller IDs)
3. **Check OTel traces** for anomalous span patterns (long durations, unexpected breaker states)
4. **Inspect rate limiter state** for keys with unexpectedly high request counts
5. **Dispose and re-initialize** the router with new credentials

---

## 11. Recommendations for Production

### Must-Do

- [ ] Store API keys in a secrets manager, not environment files
- [ ] Implement a durable `AuditStore` (PostgreSQL, Elasticsearch, etc.)
- [ ] Enable OTel tracing with a production collector
- [ ] Set up alerting on circuit breaker state transitions (closed -> open)
- [ ] Monitor audit store write failures

### Should-Do

- [ ] Rotate API keys on a schedule (monthly minimum)
- [ ] Run automated dependency vulnerability scanning in CI
- [ ] Compare estimated costs against actual provider invoices weekly
- [ ] Review audit logs for anomalous routing patterns

### Could-Do

- [ ] Implement a Redis-backed rate limiter for distributed deployments
- [ ] Add JSONSchema validation for plugin configs
- [ ] Set up chaos testing (provider failure injection)
- [ ] Implement geographic routing restrictions
