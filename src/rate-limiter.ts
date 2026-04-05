/**
 * @maestro/router — Per-key rate limiter.
 *
 * Tracks API usage per key and handles 429 responses.
 * Each API key gets an independent rate limit state.
 * Supports sliding window rate limiting and retry-after parsing.
 */

// ── Rate Limit State ──────────────────────────────────────────────

export interface RateLimitState {
  /** Number of requests in current window. */
  requestCount: number;
  /** Window start timestamp (ms). */
  windowStart: number;
  /** When this key can next be used (ms epoch). 0 = now. */
  retryAfter: number;
  /** Whether this key is currently rate-limited. */
  limited: boolean;
}

export interface RateLimiterOptions {
  /** Max requests per window. Default: 60. */
  maxRequests?: number;
  /** Window duration in ms. Default: 60_000 (1 minute). */
  windowMs?: number;
}

const DEFAULTS: Required<RateLimiterOptions> = {
  maxRequests: 60,
  windowMs: 60_000,
};

// ── Rate Limiter ──────────────────────────────────────────────────

/**
 * Per-key sliding window rate limiter.
 *
 * Tracks request counts per API key within a configurable time window.
 * Handles 429 responses by parsing Retry-After headers and blocking
 * the key until the cooldown expires.
 *
 * Usage:
 * ```typescript
 * const limiter = new KeyRateLimiter({ maxRequests: 100, windowMs: 60_000 });
 * if (limiter.canProceed('sk-abc')) {
 *   limiter.recordRequest('sk-abc');
 *   // ... make API call
 * }
 * // On 429 response:
 * limiter.recordRateLimit('sk-abc', retryAfterSeconds);
 * ```
 */
export class KeyRateLimiter {
  private state = new Map<string, RateLimitState>();
  private readonly config: Required<RateLimiterOptions>;

  constructor(options: RateLimiterOptions = {}) {
    this.config = { ...DEFAULTS, ...options };
  }

  /**
   * Check if a key can proceed with a request.
   * Returns false if the key is rate-limited or has exceeded the window quota.
   */
  canProceed(key: string): boolean {
    const now = Date.now();
    const entry = this.state.get(key);
    if (!entry) return true;

    // Check retry-after from 429 response
    if (entry.retryAfter > now) return false;

    // Reset window if expired
    if (now - entry.windowStart >= this.config.windowMs) {
      entry.requestCount = 0;
      entry.windowStart = now;
      entry.limited = false;
      entry.retryAfter = 0;
    }

    return entry.requestCount < this.config.maxRequests;
  }

  /**
   * Record a successful request for a key.
   */
  recordRequest(key: string): void {
    const now = Date.now();
    let entry = this.state.get(key);

    if (!entry) {
      entry = { requestCount: 0, windowStart: now, retryAfter: 0, limited: false };
      this.state.set(key, entry);
    }

    // Reset window if expired
    if (now - entry.windowStart >= this.config.windowMs) {
      entry.requestCount = 0;
      entry.windowStart = now;
      entry.limited = false;
    }

    entry.requestCount++;

    if (entry.requestCount >= this.config.maxRequests) {
      entry.limited = true;
    }
  }

  /**
   * Record a 429 rate limit response for a key.
   *
   * @param key — The API key that was rate-limited
   * @param retryAfterSeconds — Retry-After header value in seconds. Default: 60.
   */
  recordRateLimit(key: string, retryAfterSeconds: number = 60): void {
    const now = Date.now();
    let entry = this.state.get(key);

    if (!entry) {
      entry = { requestCount: 0, windowStart: now, retryAfter: 0, limited: false };
      this.state.set(key, entry);
    }

    entry.retryAfter = now + retryAfterSeconds * 1000;
    entry.limited = true;
  }

  /**
   * Get the current rate limit state for a key.
   * Returns undefined if the key has no recorded activity.
   */
  getState(key: string): RateLimitState | undefined {
    return this.state.get(key);
  }

  /**
   * Parse a Retry-After header value.
   * Supports both seconds (integer) and HTTP-date formats.
   * Returns seconds to wait.
   */
  static parseRetryAfter(value: string | undefined): number {
    if (!value) return 60; // default 60s

    // Try as integer (seconds)
    const seconds = parseInt(value, 10);
    if (!isNaN(seconds) && seconds >= 0) return seconds;

    // Try as HTTP-date
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      const diff = Math.max(0, (date.getTime() - Date.now()) / 1000);
      return Math.ceil(diff);
    }

    return 60; // fallback
  }

  /**
   * Get the number of keys currently being tracked.
   */
  get size(): number {
    return this.state.size;
  }

  /**
   * Clear all rate limit state.
   */
  reset(): void {
    this.state.clear();
  }

  /**
   * Remove state for a specific key (e.g., on key rotation).
   */
  remove(key: string): void {
    this.state.delete(key);
  }
}
