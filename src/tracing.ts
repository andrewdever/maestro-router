/**
 * @maestro/router — OpenTelemetry instrumentation.
 *
 * Provides span creation for the routing pipeline:
 *   route() → habit check → plugin resolve → plugin.select()
 *
 * Uses @opentelemetry/api as an optional peer dependency.
 * When no tracer is registered (the default), all operations are no-ops
 * with zero overhead — OTel's API is designed for this.
 *
 * Span hierarchy:
 *   router.route                    (root span per route() call)
 *   ├── router.habit_check          (habit matching attempt)
 *   ├── router.resolve_plugin       (plugin resolution + fallback)
 *   └── router.select               (plugin.select() call, wrapped by resilience)
 */

import type { Span, Tracer, SpanStatusCode as SpanStatusCodeType } from '@opentelemetry/api';

// ── Lazy OTel Resolution ──────────────────────────────────────────

/**
 * Lazily resolved OTel API module.
 *
 * We don't import at the top level because @opentelemetry/api is an
 * optional peer dependency. If it's not installed, all tracing calls
 * become no-ops via the fallback noop tracer.
 */
let _otel: typeof import('@opentelemetry/api') | null | undefined;
let _tracer: Tracer | null = null;

function getOtel(): typeof import('@opentelemetry/api') | null {
  if (_otel === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _otel = require('@opentelemetry/api') as typeof import('@opentelemetry/api');
    } catch {
      _otel = null;
    }
  }
  return _otel;
}

/**
 * Get or create the router tracer.
 *
 * Returns null if @opentelemetry/api is not installed.
 * When OTel IS installed but no TracerProvider is registered,
 * the returned tracer produces no-op spans (by OTel design).
 */
function getTracer(): Tracer | null {
  if (_tracer) return _tracer;
  const otel = getOtel();
  if (!otel) return null;
  _tracer = otel.trace.getTracer('@maestro/router', '0.0.1');
  return _tracer;
}

// ── Span Attribute Keys ───────────────────────────────────────────

/** Semantic attribute keys for router spans. */
export const RouterAttributes = {
  PLUGIN_ID: 'maestro.router.plugin_id',
  EFFORT: 'maestro.router.effort',
  COST_SENSITIVITY: 'maestro.router.cost_sensitivity',
  REQUIRES: 'maestro.router.requires',
  PREFER_PROVIDER: 'maestro.router.prefer_provider',
  SELECTED_MODEL: 'maestro.router.selected_model',
  SELECTED_PROVIDER: 'maestro.router.selected_provider',
  SLUG: 'maestro.router.slug',
  HABIT_MATCH: 'maestro.router.habit_match',
  HABIT_SLUG: 'maestro.router.habit_slug',
  USED_FALLBACK: 'maestro.router.used_fallback',
  ESTIMATED_COST: 'maestro.router.estimated_cost',
  QUALITY_SCORE: 'maestro.router.quality_score',
  BREAKER_STATE: 'maestro.router.breaker_state',
} as const;

// ── Tracing Helpers ───────────────────────────────────────────────

/**
 * Start a span and execute an async function within it.
 *
 * Automatically records exceptions and sets span status on error.
 * If OTel is not available, executes `fn` directly with no wrapping.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | string[]>,
  fn: (span: Span | null) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  if (!tracer) return fn(null);

  const otel = getOtel()!;
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: otel.SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: otel.SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error) {
        span.recordException(err);
      }
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Start a synchronous span and execute a function within it.
 *
 * Used for synchronous operations like habit matching.
 */
export function withSpanSync<T>(
  name: string,
  attributes: Record<string, string | number | boolean | string[]>,
  fn: (span: Span | null) => T,
): T {
  const tracer = getTracer();
  if (!tracer) return fn(null);

  const otel = getOtel()!;
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = fn(span);
    span.setStatus({ code: otel.SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({
      code: otel.SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof Error) {
      span.recordException(err);
    }
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Reset the cached tracer (for testing).
 */
export function resetTracer(): void {
  _tracer = null;
}
