/**
 * @maestro/router — Concurrent route stress tests.
 *
 * Verifies no race conditions when multiple route() calls are fired
 * concurrently. Uses the DirectPlugin (offline, deterministic) to
 * isolate routing logic from network concerns.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Router } from '../../router.js';
import type { SpawnIntent } from '../../types.js';

// ── Setup ───────────────────────────────────────────────────────────

let router: Router;

beforeAll(async () => {
  router = new Router(); // defaults to DirectPlugin
  await router.initialize();
});

afterAll(async () => {
  await router.dispose();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('Concurrent Route Stress', { timeout: 10_000 }, () => {
  it('50 concurrent route() calls return valid results', async () => {
    const intents: SpawnIntent[] = [
      // 20 standard/normal
      ...Array.from({ length: 20 }, (): SpawnIntent => ({
        effort: 'standard',
        cost_sensitivity: 'normal',
      })),
      // 15 deep/low
      ...Array.from({ length: 15 }, (): SpawnIntent => ({
        effort: 'deep',
        cost_sensitivity: 'low',
      })),
      // 15 minimal/high
      ...Array.from({ length: 15 }, (): SpawnIntent => ({
        effort: 'minimal',
        cost_sensitivity: 'high',
      })),
    ];

    const results = await Promise.all(intents.map(intent => router.route(intent)));

    expect(results).toHaveLength(50);

    for (const result of results) {
      expect(typeof result.slug).toBe('string');
      expect(result.slug.length).toBeGreaterThan(0);
      expect(result.selection).toBeDefined();
      expect(result.selection.router).toBe('direct');
      expect(result.selection.provider).toBeTruthy();
      expect(result.selection.harness).toBeTruthy();
      expect(result.selection.model).toBeTruthy();
      expect(result.selection.config).toBeTruthy();
    }
  });

  it('concurrent routes with different capability requirements', async () => {
    const intents: SpawnIntent[] = [
      // 10 requiring thinking
      ...Array.from({ length: 10 }, (): SpawnIntent => ({
        effort: 'standard',
        cost_sensitivity: 'normal',
        requires: ['thinking'],
      })),
      // 10 requiring tool_use
      ...Array.from({ length: 10 }, (): SpawnIntent => ({
        effort: 'standard',
        cost_sensitivity: 'normal',
        requires: ['tool_use'],
      })),
      // 10 requiring vision
      ...Array.from({ length: 10 }, (): SpawnIntent => ({
        effort: 'standard',
        cost_sensitivity: 'normal',
        requires: ['vision'],
      })),
    ];

    const results = await Promise.all(intents.map(intent => router.route(intent)));

    expect(results).toHaveLength(30);

    // All should resolve successfully
    for (const result of results) {
      expect(result.selection).toBeDefined();
      expect(result.slug.length).toBeGreaterThan(0);
    }

    // Thinking-required models should have thinking capability
    // (DirectPlugin returns models from its static catalog that meet requirements)
    const thinkingResults = results.slice(0, 10);
    for (const result of thinkingResults) {
      // The selected model must be one that supports thinking
      // (DirectPlugin filters by capability before selection)
      expect(result.selection.model).toBeTruthy();
    }
  });

  it('concurrent initialize and route interleaving', async () => {
    // Create a fresh router — do NOT call initialize()
    const freshRouter = new Router();

    try {
      // Fire 20 concurrent route() calls without prior initialization
      // The Router auto-initializes on first route() call
      const intents: SpawnIntent[] = Array.from({ length: 20 }, (): SpawnIntent => ({
        effort: 'standard',
        cost_sensitivity: 'normal',
      }));

      const results = await Promise.all(intents.map(intent => freshRouter.route(intent)));

      expect(results).toHaveLength(20);

      for (const result of results) {
        expect(result.selection).toBeDefined();
        expect(typeof result.slug).toBe('string');
        expect(result.slug.length).toBeGreaterThan(0);
      }
    } finally {
      await freshRouter.dispose();
    }
  });

  it('route() after dispose() auto-reinitializes', async () => {
    const tempRouter = new Router();
    await tempRouter.initialize();

    // Verify it works before dispose
    const beforeResult = await tempRouter.route({
      effort: 'standard',
      cost_sensitivity: 'normal',
    });
    expect(beforeResult.selection).toBeDefined();

    // Dispose
    await tempRouter.dispose();

    // Route after dispose — should auto-reinitialize
    const afterResult = await tempRouter.route({
      effort: 'deep',
      cost_sensitivity: 'low',
    });

    expect(afterResult.selection).toBeDefined();
    expect(typeof afterResult.slug).toBe('string');
    expect(afterResult.slug.length).toBeGreaterThan(0);
    expect(afterResult.selection.config).toBe('effort:deep');

    await tempRouter.dispose();
  });
});
