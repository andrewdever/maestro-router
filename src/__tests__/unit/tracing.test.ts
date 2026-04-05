/**
 * @maestro/router — OTel tracing tests.
 *
 * Verifies that the tracing instrumentation correctly creates spans,
 * records attributes, and handles errors. Uses @opentelemetry/api
 * which is installed as a devDependency.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import {
  withSpan,
  withSpanSync,
  resetTracer,
  RouterAttributes,
} from '../../tracing.js';
import { Router } from '../../router.js';
import type { SpawnIntent } from '../../types.js';

// ── In-Memory Span Collector ──────────────────────────────────────

interface CollectedSpan {
  name: string;
  attributes: Record<string, unknown>;
  status: { code: number; message?: string };
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
  ended: boolean;
}

const collectedSpans: CollectedSpan[] = [];

/** Minimal in-memory span for test assertions. */
function createTestSpan(name: string, options?: { attributes?: Record<string, unknown> }): CollectedSpan & {
  setAttribute: (key: string, value: unknown) => void;
  setAttributes: (attrs: Record<string, unknown>) => void;
  setStatus: (status: { code: number; message?: string }) => void;
  recordException: (err: Error) => void;
  end: () => void;
  isRecording: () => boolean;
} {
  const span: CollectedSpan = {
    name,
    attributes: { ...(options?.attributes ?? {}) },
    status: { code: SpanStatusCode.UNSET },
    events: [],
    ended: false,
  };
  collectedSpans.push(span);

  return {
    ...span,
    setAttribute(key: string, value: unknown) {
      span.attributes[key] = value;
    },
    setAttributes(attrs: Record<string, unknown>) {
      Object.assign(span.attributes, attrs);
    },
    setStatus(status: { code: number; message?: string }) {
      span.status = status;
    },
    recordException(err: Error) {
      span.events.push({ name: 'exception', attributes: { 'exception.message': err.message } });
    },
    end() {
      span.ended = true;
    },
    isRecording() {
      return !span.ended;
    },
  };
}

/** Register a test tracer provider that captures spans. */
function registerTestTracer(): void {
  const testTracer = {
    startSpan(name: string, options?: { attributes?: Record<string, unknown> }) {
      return createTestSpan(name, options);
    },
    startActiveSpan<T>(
      name: string,
      optionsOrFn: unknown,
      maybeFn?: unknown,
    ): T {
      // Handle the overloaded signature: (name, options, fn) or (name, fn)
      let options: { attributes?: Record<string, unknown> } = {};
      let fn: (span: ReturnType<typeof createTestSpan>) => T;

      if (typeof optionsOrFn === 'function') {
        fn = optionsOrFn as typeof fn;
      } else {
        options = optionsOrFn as typeof options;
        fn = maybeFn as typeof fn;
      }

      const span = createTestSpan(name, options);
      return fn(span);
    },
  };

  const testProvider = {
    getTracer() {
      return testTracer;
    },
    register() {},
    forceFlush() { return Promise.resolve(); },
    shutdown() { return Promise.resolve(); },
  };

  trace.setGlobalTracerProvider(testProvider as never);
}

// ── Tests ─────────────────────────────────────────────────────────

describe('OTel tracing', () => {
  beforeEach(() => {
    collectedSpans.length = 0;
    resetTracer();
    registerTestTracer();
  });

  afterEach(() => {
    collectedSpans.length = 0;
    resetTracer();
    trace.disable();
  });

  describe('withSpan', () => {
    it('creates a span with attributes and ends it on success', async () => {
      const result = await withSpan('test.span', {
        'test.key': 'value',
        'test.num': 42,
      }, async () => {
        return 'hello';
      });

      expect(result).toBe('hello');
      expect(collectedSpans).toHaveLength(1);
      expect(collectedSpans[0].name).toBe('test.span');
      expect(collectedSpans[0].attributes['test.key']).toBe('value');
      expect(collectedSpans[0].attributes['test.num']).toBe(42);
      expect(collectedSpans[0].status.code).toBe(SpanStatusCode.OK);
      expect(collectedSpans[0].ended).toBe(true);
    });

    it('records exception and sets error status on failure', async () => {
      await expect(
        withSpan('test.error', {}, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(collectedSpans).toHaveLength(1);
      expect(collectedSpans[0].status.code).toBe(SpanStatusCode.ERROR);
      expect(collectedSpans[0].status.message).toBe('boom');
      expect(collectedSpans[0].events).toHaveLength(1);
      expect(collectedSpans[0].events[0].name).toBe('exception');
      expect(collectedSpans[0].ended).toBe(true);
    });

    it('allows setting additional attributes from within the span', async () => {
      await withSpan('test.dynamic', { 'initial': 'yes' }, async (span) => {
        span?.setAttributes({ 'dynamic': 'added' });
        return null;
      });

      expect(collectedSpans[0].attributes['initial']).toBe('yes');
      expect(collectedSpans[0].attributes['dynamic']).toBe('added');
    });
  });

  describe('withSpanSync', () => {
    it('creates a span for synchronous operations', () => {
      const result = withSpanSync('test.sync', { 'sync': true }, () => 42);

      expect(result).toBe(42);
      expect(collectedSpans).toHaveLength(1);
      expect(collectedSpans[0].name).toBe('test.sync');
      expect(collectedSpans[0].status.code).toBe(SpanStatusCode.OK);
      expect(collectedSpans[0].ended).toBe(true);
    });

    it('records errors in sync spans', () => {
      expect(() =>
        withSpanSync('test.sync_error', {}, () => {
          throw new Error('sync boom');
        }),
      ).toThrow('sync boom');

      expect(collectedSpans[0].status.code).toBe(SpanStatusCode.ERROR);
      expect(collectedSpans[0].ended).toBe(true);
    });
  });

  describe('Router integration', () => {
    it('route() creates router.route, router.habit_check, router.resolve_plugin, and router.select spans', async () => {
      const router = new Router();
      await router.initialize();

      const intent: SpawnIntent = {
        effort: 'standard',
        cost_sensitivity: 'normal',
      };

      const result = await router.route(intent);
      expect(result.selection).toBeDefined();

      // Should have 4 spans: route, habit_check, resolve_plugin, select
      const spanNames = collectedSpans.map(s => s.name);
      expect(spanNames).toContain('router.route');
      expect(spanNames).toContain('router.habit_check');
      expect(spanNames).toContain('router.resolve_plugin');
      expect(spanNames).toContain('router.select');

      // Route span should have intent attributes
      const routeSpan = collectedSpans.find(s => s.name === 'router.route')!;
      expect(routeSpan.attributes[RouterAttributes.EFFORT]).toBe('standard');
      expect(routeSpan.attributes[RouterAttributes.COST_SENSITIVITY]).toBe('normal');

      // Route span should have result attributes
      expect(routeSpan.attributes[RouterAttributes.SLUG]).toBeDefined();
      expect(routeSpan.attributes[RouterAttributes.HABIT_MATCH]).toBe(false);

      // Select span should have model selection attributes
      const selectSpan = collectedSpans.find(s => s.name === 'router.select')!;
      expect(selectSpan.attributes[RouterAttributes.SELECTED_MODEL]).toBeDefined();
      expect(selectSpan.attributes[RouterAttributes.SELECTED_PROVIDER]).toBeDefined();

      await router.dispose();
    });

    it('habit match produces router.route and router.habit_check spans only', async () => {
      const router = new Router();
      await router.initialize();

      router.habits.register({
        slug: 'test-habit',
        handler: 'test-handler',
        triggers: ['format code'],
        capabilities: [],
      });

      const intent: SpawnIntent = {
        effort: 'minimal',
        cost_sensitivity: 'normal',
      };

      const result = await router.route(intent, 'please format code');
      expect(result.habit_match).toBe(true);

      const spanNames = collectedSpans.map(s => s.name);
      expect(spanNames).toContain('router.route');
      expect(spanNames).toContain('router.habit_check');
      // No resolve or select spans for habit matches
      expect(spanNames).not.toContain('router.resolve_plugin');
      expect(spanNames).not.toContain('router.select');

      // Route span should indicate habit match
      const routeSpan = collectedSpans.find(s => s.name === 'router.route')!;
      expect(routeSpan.attributes[RouterAttributes.HABIT_MATCH]).toBe(true);
      expect(routeSpan.attributes[RouterAttributes.HABIT_SLUG]).toBe('test-habit');

      await router.dispose();
    });

    it('all spans end with OK status on successful route', async () => {
      const router = new Router();
      await router.initialize();

      await router.route({ effort: 'deep', cost_sensitivity: 'low' });

      for (const span of collectedSpans) {
        expect(span.status.code).toBe(SpanStatusCode.OK);
        expect(span.ended).toBe(true);
      }

      await router.dispose();
    });
  });
});
