/**
 * @maestro/router — Resilience layer using cockatiel.
 *
 * Wraps plugin operations with circuit breaker, retry, and backoff.
 * Each plugin gets its own circuit breaker instance so one failing
 * plugin doesn't trip the breaker for others.
 *
 * Policy chain: retry(backoff) → circuitBreaker → plugin.select()
 */

import {
  CircuitBreakerPolicy,
  CircuitState,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  retry,
  circuitBreaker,
  wrap,
  type IPolicy,
} from 'cockatiel';

// ── Configuration ─────────────────────────────────────────────────

export interface ResilienceOptions {
  /** Max retry attempts before giving up. Default: 2 (3 total attempts). */
  maxRetries?: number;
  /** Initial backoff delay in ms. Default: 200. */
  initialDelay?: number;
  /** Max backoff delay in ms. Default: 5000. */
  maxDelay?: number;
  /** Number of consecutive failures to trip the circuit breaker. Default: 5. */
  breakerThreshold?: number;
  /** How long the circuit stays open (half-open test interval) in ms. Default: 30000. */
  halfOpenAfter?: number;
}

const DEFAULTS: Required<ResilienceOptions> = {
  maxRetries: 2,
  initialDelay: 200,
  maxDelay: 5_000,
  breakerThreshold: 5,
  halfOpenAfter: 30_000,
};

// ── Policy Factory ────────────────────────────────────────────────

/**
 * Create a resilience policy for a plugin.
 *
 * Returns a wrapped policy: retry(exponential backoff) → circuit breaker.
 * The circuit breaker tracks consecutive failures and opens after
 * `breakerThreshold` consecutive errors, staying open for `halfOpenAfter` ms.
 *
 * Usage:
 * ```typescript
 * const { policy, breaker } = createResiliencePolicy({ maxRetries: 2 });
 * const result = await policy.execute(() => plugin.select(intent));
 * ```
 */
export function createResiliencePolicy(
  options: ResilienceOptions = {},
): { policy: IPolicy; breaker: CircuitBreakerPolicy } {
  const config = { ...DEFAULTS, ...options };

  // Retry with exponential backoff
  const retryPolicy = retry(handleAll, {
    maxAttempts: config.maxRetries,
    backoff: new ExponentialBackoff({
      initialDelay: config.initialDelay,
      maxDelay: config.maxDelay,
    }),
  });

  // Circuit breaker — opens after N consecutive failures
  const breakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: config.halfOpenAfter,
    breaker: new ConsecutiveBreaker(config.breakerThreshold),
  });

  // Compose: retry wraps the circuit breaker
  const combined = wrap(retryPolicy, breakerPolicy);

  return { policy: combined, breaker: breakerPolicy };
}

// ── Plugin Policy Manager ─────────────────────────────────────────

/**
 * Manages per-plugin resilience policies.
 *
 * Each plugin gets its own circuit breaker so failures in one plugin
 * don't affect others. Policies are created on first access and
 * cached for the lifetime of the manager.
 */
export class PluginPolicyManager {
  private policies = new Map<string, { policy: IPolicy; breaker: CircuitBreakerPolicy }>();
  private readonly options: ResilienceOptions;

  constructor(options: ResilienceOptions = {}) {
    this.options = options;
  }

  /**
   * Get or create a resilience policy for the given plugin ID.
   */
  get(pluginId: string): { policy: IPolicy; breaker: CircuitBreakerPolicy } {
    let entry = this.policies.get(pluginId);
    if (!entry) {
      entry = createResiliencePolicy(this.options);
      this.policies.set(pluginId, entry);
    }
    return entry;
  }

  /**
   * Check if a plugin's circuit breaker is open (tripped).
   */
  isOpen(pluginId: string): boolean {
    const entry = this.policies.get(pluginId);
    if (!entry) return false;
    return entry.breaker.state === CircuitState.Open;
  }

  /**
   * Reset all circuit breakers and clear cached policies.
   */
  reset(): void {
    this.policies.clear();
  }

  /**
   * Execute a function through the plugin's resilience policy.
   */
  async execute<T>(pluginId: string, fn: () => Promise<T>): Promise<T> {
    const { policy } = this.get(pluginId);
    return policy.execute(fn);
  }
}
