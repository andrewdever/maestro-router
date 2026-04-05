/**
 * @maestro/router — RouterRegistry unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouterPlugin, SpawnIntent, ModelSelection, ModelCapability } from '../../types.js';
import { RouterRegistry } from '../../registry.js';
import { PluginNotFoundError, FallbackExhaustedError } from '../../errors.js';

// ── Mock Plugin Factory ──────────────────────────────────────────

function createMockPlugin(overrides: Partial<RouterPlugin> = {}): RouterPlugin {
  return {
    id: overrides.id ?? 'test-plugin',
    name: overrides.name ?? 'Test Plugin',
    select: overrides.select ?? (async (intent: SpawnIntent): Promise<ModelSelection> => ({
      router: overrides.id ?? 'test-plugin',
      provider: 'test',
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

describe('RouterRegistry', () => {
  let registry: RouterRegistry;

  beforeEach(() => {
    registry = new RouterRegistry();
  });

  // ── register() and get() ─────────────────────────────────────

  it('register() and get() work for an instantiated plugin', async () => {
    const plugin = createMockPlugin({ id: 'alpha' });
    registry.register(plugin);

    const retrieved = await registry.get('alpha');
    expect(retrieved).toBe(plugin);
    expect(retrieved.id).toBe('alpha');
  });

  // ── get() with unknown ID ────────────────────────────────────

  it('get() throws PluginNotFoundError for unknown ID', async () => {
    await expect(registry.get('nonexistent')).rejects.toThrow(PluginNotFoundError);
    await expect(registry.get('nonexistent')).rejects.toThrow(
      /not registered/,
    );
  });

  // ── get() with loader ────────────────────────────────────────

  it('get() dynamically loads a plugin from the loader registry', async () => {
    const plugin = createMockPlugin({ id: 'lazy-plugin' });
    const loaders = {
      'lazy-plugin': async () => ({ default: plugin }),
    };

    const registryWithLoaders = new RouterRegistry(loaders);
    const loaded = await registryWithLoaders.get('lazy-plugin');
    expect(loaded.id).toBe('lazy-plugin');
  });

  // ── resolve() primary succeeds ───────────────────────────────

  it('resolve() returns primary when primary is healthy', async () => {
    const primary = createMockPlugin({ id: 'primary' });
    const fallback = createMockPlugin({ id: 'fallback' });
    registry.register(primary);
    registry.register(fallback);

    const resolved = await registry.resolve('primary', 'fallback');
    expect(resolved.id).toBe('primary');
  });

  // ── resolve() fallback on unhealthy primary ──────────────────

  it('resolve() uses fallback when primary is unhealthy', async () => {
    const primary = createMockPlugin({
      id: 'primary',
      healthy: async () => false,
    });
    const fallback = createMockPlugin({ id: 'fallback' });
    registry.register(primary);
    registry.register(fallback);

    const resolved = await registry.resolve('primary', 'fallback');
    expect(resolved.id).toBe('fallback');
  });

  // ── resolve() fallback on missing primary ────────────────────

  it('resolve() uses fallback when primary is not registered', async () => {
    const fallback = createMockPlugin({ id: 'fallback' });
    registry.register(fallback);

    const resolved = await registry.resolve('missing-primary', 'fallback');
    expect(resolved.id).toBe('fallback');
  });

  // ── resolve() both fail ──────────────────────────────────────

  it('resolve() throws FallbackExhaustedError when both primary and fallback fail', async () => {
    const primary = createMockPlugin({
      id: 'primary',
      healthy: async () => false,
    });
    const fallback = createMockPlugin({
      id: 'fallback',
      healthy: async () => false,
    });
    registry.register(primary);
    registry.register(fallback);

    await expect(registry.resolve('primary', 'fallback')).rejects.toThrow(
      FallbackExhaustedError,
    );
  });

  // ── list() ───────────────────────────────────────────────────

  it('list() returns all registered plugins', () => {
    const a = createMockPlugin({ id: 'a' });
    const b = createMockPlugin({ id: 'b' });
    registry.register(a);
    registry.register(b);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('list() returns empty array when no plugins registered', () => {
    expect(registry.list()).toEqual([]);
  });

  // ── availableIds() ───────────────────────────────────────────

  it('availableIds() includes both registered and loadable plugins', () => {
    const loaders = {
      lazy: async () => ({ default: createMockPlugin({ id: 'lazy' }) }),
    };
    const registryWithLoaders = new RouterRegistry(loaders);
    registryWithLoaders.register(createMockPlugin({ id: 'eager' }));

    const ids = registryWithLoaders.availableIds();
    expect(ids).toContain('eager');
    expect(ids).toContain('lazy');
  });

  it('availableIds() deduplicates when a plugin is both registered and loadable', async () => {
    const plugin = createMockPlugin({ id: 'both' });
    const loaders = {
      both: async () => ({ default: plugin }),
    };
    const registryWithLoaders = new RouterRegistry(loaders);
    registryWithLoaders.register(plugin);

    const ids = registryWithLoaders.availableIds();
    const count = ids.filter((id) => id === 'both').length;
    expect(count).toBe(1);
  });

  // ── disposeAll() ─────────────────────────────────────────────

  it('disposeAll() calls dispose on all registered plugins', async () => {
    const disposeA = vi.fn(async () => {});
    const disposeB = vi.fn(async () => {});

    registry.register(createMockPlugin({ id: 'a', dispose: disposeA }));
    registry.register(createMockPlugin({ id: 'b', dispose: disposeB }));

    await registry.disposeAll();

    expect(disposeA).toHaveBeenCalledOnce();
    expect(disposeB).toHaveBeenCalledOnce();
  });

  it('disposeAll() clears the registry', async () => {
    registry.register(createMockPlugin({ id: 'a' }));
    registry.register(createMockPlugin({ id: 'b' }));

    await registry.disposeAll();

    expect(registry.list()).toEqual([]);
  });

  it('disposeAll() tolerates plugins without dispose()', async () => {
    registry.register(createMockPlugin({ id: 'no-dispose' }));

    // Should not throw
    await expect(registry.disposeAll()).resolves.toBeUndefined();
  });
});
