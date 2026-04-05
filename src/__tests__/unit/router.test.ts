/**
 * @maestro/router — Main Router class unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  RouterPlugin,
  SpawnIntent,
  ModelSelection,
  ModelCapability,
} from '../../types.js';
import { toSlug } from '../../types.js';
import { Router } from '../../router.js';
import { RouterRegistry } from '../../registry.js';
import { HabitMatcher, type HabitDefinition } from '../../habits.js';

// ── Mock Plugin Factory ──────────────────────────────────────────

function createMockPlugin(overrides: Partial<RouterPlugin> = {}): RouterPlugin {
  return {
    id: overrides.id ?? 'test-plugin',
    name: overrides.name ?? 'Test Plugin',
    select: overrides.select ?? (async (intent: SpawnIntent): Promise<ModelSelection> => ({
      router: overrides.id ?? 'test-plugin',
      provider: 'test-provider',
      harness: 'api',
      model: 'test-model',
      config: `effort:${intent.effort}`,
    })),
    models: overrides.models ?? (async (): Promise<ModelCapability[]> => []),
    healthy: overrides.healthy ?? (async () => true),
    initialize: overrides.initialize,
    dispose: overrides.dispose,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Router', () => {
  let registry: RouterRegistry;
  let habits: HabitMatcher;
  let router: Router;

  beforeEach(() => {
    registry = new RouterRegistry();
    habits = new HabitMatcher();
  });

  afterEach(async () => {
    if (router) await router.dispose();
  });

  // ── Routes via mock plugin ───────────────────────────────────

  it('routes via the configured plugin', async () => {
    const plugin = createMockPlugin({ id: 'mock' });
    registry.register(plugin);

    router = new Router({
      config: { plugin: 'mock', fallback: 'mock' },
      registry,
      habits,
    });

    const intent: SpawnIntent = { effort: 'standard', cost_sensitivity: 'normal' };
    const result = await router.route(intent);

    expect(result.selection.router).toBe('mock');
    expect(result.selection.provider).toBe('test-provider');
    expect(result.selection.harness).toBe('api');
    expect(result.selection.model).toBe('test-model');
    expect(result.selection.config).toBe('effort:standard');
    expect(result.habit_match).toBe(false);
    expect(result.resolved_plugin).toBe('mock');
    expect(result.used_fallback).toBe(false);
  });

  // ── Habit match short-circuits plugin ────────────────────────

  it('habit match short-circuits plugin selection', async () => {
    const plugin = createMockPlugin({ id: 'mock' });
    registry.register(plugin);

    habits.register({
      slug: 'format-code',
      handler: 'handlers/format.ts',
      triggers: ['format'],
    });

    router = new Router({
      config: { plugin: 'mock', fallback: 'mock' },
      registry,
      habits,
    });

    const intent: SpawnIntent = { effort: 'minimal', cost_sensitivity: 'normal' };
    const result = await router.route(intent, 'please format this file');

    expect(result.habit_match).toBe(true);
    expect(result.resolved_plugin).toBe('habit');
    expect(result.selection.router).toBe('habit');
    expect(result.selection.provider).toBe('local');
    expect(result.selection.model).toBe('none');
    expect(result.selection.config).toBe('effort:zero');
    expect(result.used_fallback).toBe(false);
  });

  // ── Falls back when primary is unavailable ───────────────────

  it('falls back to fallback plugin when primary is unhealthy', async () => {
    const primary = createMockPlugin({
      id: 'primary',
      healthy: async () => false,
    });
    const fallback = createMockPlugin({ id: 'fallback' });
    registry.register(primary);
    registry.register(fallback);

    router = new Router({
      config: { plugin: 'primary', fallback: 'fallback' },
      registry,
      habits,
    });

    const intent: SpawnIntent = { effort: 'standard', cost_sensitivity: 'normal' };
    const result = await router.route(intent);

    expect(result.used_fallback).toBe(true);
    expect(result.resolved_plugin).toBe('fallback');
    expect(result.selection.router).toBe('fallback');
  });

  // ── Correct slug format ──────────────────────────────────────

  it('returns correct slug format: router-provider-harness-model-config', async () => {
    const plugin = createMockPlugin({
      id: 'direct',
      select: async (intent: SpawnIntent): Promise<ModelSelection> => ({
        router: 'direct',
        provider: 'anthropic',
        harness: 'api',
        model: 'opus-4-6',
        config: `effort:${intent.effort}`,
      }),
    });
    registry.register(plugin);

    router = new Router({
      config: { plugin: 'direct', fallback: 'direct' },
      registry,
      habits,
    });

    const intent: SpawnIntent = { effort: 'deep', cost_sensitivity: 'normal' };
    const result = await router.route(intent);

    expect(result.slug).toBe('direct-anthropic-api-opus-4-6-effort:deep');
    expect(result.slug).toBe(toSlug(result.selection));
  });

  // ── RouteResult has correct fields ───────────────────────────

  it('RouteResult has all expected fields', async () => {
    const plugin = createMockPlugin({ id: 'mock' });
    registry.register(plugin);

    router = new Router({
      config: { plugin: 'mock', fallback: 'mock' },
      registry,
      habits,
    });

    const intent: SpawnIntent = { effort: 'standard', cost_sensitivity: 'normal' };
    const result = await router.route(intent);

    expect(result).toHaveProperty('selection');
    expect(result).toHaveProperty('slug');
    expect(result).toHaveProperty('habit_match');
    expect(result).toHaveProperty('resolved_plugin');
    expect(result).toHaveProperty('used_fallback');

    expect(typeof result.slug).toBe('string');
    expect(typeof result.habit_match).toBe('boolean');
    expect(typeof result.resolved_plugin).toBe('string');
    expect(typeof result.used_fallback).toBe('boolean');
  });

  // ── Auto-initializes on first route() ────────────────────────

  it('auto-initializes on first route() call if not explicitly initialized', async () => {
    const plugin = createMockPlugin({ id: 'auto' });
    registry.register(plugin);

    router = new Router({
      config: { plugin: 'auto', fallback: 'auto' },
      registry,
      habits,
    });

    // Do not call router.initialize() explicitly
    const intent: SpawnIntent = { effort: 'minimal', cost_sensitivity: 'normal' };
    const result = await router.route(intent);

    expect(result.selection).toBeDefined();
    expect(result.selection.router).toBe('auto');
  });

  // ── Habit slug format in RouteResult ─────────────────────────

  it('habit match produces slug: habit-local-none-none-effort:zero', async () => {
    registry.register(createMockPlugin({ id: 'mock' }));

    habits.register({
      slug: 'test-habit',
      handler: 'test.ts',
      triggers: ['test keyword'],
    });

    router = new Router({
      config: { plugin: 'mock', fallback: 'mock' },
      registry,
      habits,
    });

    const intent: SpawnIntent = { effort: 'standard', cost_sensitivity: 'normal' };
    const result = await router.route(intent, 'test keyword here');

    expect(result.slug).toBe('habit-local-none-none-effort:zero');
  });
});
