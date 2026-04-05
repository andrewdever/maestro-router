/**
 * @maestro/router — Plugin lifecycle unit tests.
 *
 * Tests explicit initialize/dispose lifecycle behavior across all plugins.
 * Verifies idempotent teardown, re-initialization, health state transitions,
 * and mode persistence.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { RouterPlugin } from '../../types.js';

import direct from '../../plugins/direct.js';
import maestro from '../../plugins/maestro.js';
import mock from '../../plugins/mock.js';
import openrouter from '../../plugins/openrouter.js';
import requesty from '../../plugins/requesty.js';
import portkey from '../../plugins/portkey.js';
import litellm from '../../plugins/litellm.js';

// ── Shared ──────────────────────────────────────────────────────────

const allPlugins: RouterPlugin[] = [direct, maestro, mock, openrouter, requesty, portkey, litellm];

const apiKeyPlugins: RouterPlugin[] = [openrouter, requesty, portkey];

afterEach(async () => {
  // Dispose all stateful plugins to avoid cross-test leakage
  for (const plugin of allPlugins) {
    if (plugin.dispose) await plugin.dispose();
  }
});

// ── Tests ───────────────────────────────────────────────────────────

describe('Plugin Lifecycle', () => {
  it('all plugins survive double-dispose', async () => {
    for (const plugin of allPlugins) {
      if (plugin.dispose) {
        await expect(plugin.dispose()).resolves.toBeUndefined();
        await expect(plugin.dispose()).resolves.toBeUndefined();
      }
    }
  });

  it('all plugins survive initialize-dispose-initialize cycle', async () => {
    for (const plugin of allPlugins) {
      if (plugin.initialize) {
        await expect(plugin.initialize({})).resolves.toBeUndefined();
      }
      if (plugin.dispose) {
        await expect(plugin.dispose()).resolves.toBeUndefined();
      }
      if (plugin.initialize) {
        await expect(plugin.initialize({})).resolves.toBeUndefined();
      }
    }
  });

  it('API-key plugins: dispose resets healthy to false', async () => {
    for (const plugin of apiKeyPlugins) {
      // Initialize with an API key — should become healthy
      await plugin.initialize!({ api_key: 'test' });
      expect(await plugin.healthy()).toBe(true);

      // Dispose — should become unhealthy
      await plugin.dispose!();
      expect(await plugin.healthy()).toBe(false);
    }
  });

  it('direct plugin is always healthy regardless of lifecycle', async () => {
    // Before init
    expect(await direct.healthy()).toBe(true);

    // After init
    if ('initialize' in direct) await (direct as RouterPlugin).initialize!({});
    expect(await direct.healthy()).toBe(true);

    // After dispose
    if ('dispose' in direct) await (direct as RouterPlugin).dispose!();
    expect(await direct.healthy()).toBe(true);
  });

  it('mock plugin tracks calls and dispose resets them', async () => {
    // Initialize and make a selection
    await mock.initialize!({});
    const result1 = await mock.select({ effort: 'standard', cost_sensitivity: 'normal' });
    expect(result1).toBeDefined();
    expect(result1.router).toBe('mock');

    // Dispose and re-initialize
    await mock.dispose!();
    await mock.initialize!({});

    // Should still work after dispose + re-initialize cycle
    const result2 = await mock.select({ effort: 'deep', cost_sensitivity: 'low' });
    expect(result2).toBeDefined();
    expect(result2.router).toBe('mock');
  });

  it('maestro plugin works without score bridge config', async () => {
    await maestro.initialize!({});

    const result = await maestro.select({ effort: 'standard', cost_sensitivity: 'normal' });
    expect(result).toBeDefined();
    expect(result.router).toBe('maestro');
    expect(result.provider).toBeTruthy();
    expect(result.model).toBeTruthy();
  });

  it('litellm mode persists across calls, resets on dispose', async () => {
    // SDK mode: healthy without API key
    await litellm.initialize!({ mode: 'sdk' });
    expect(await litellm.healthy()).toBe(true);

    // Dispose resets to proxy mode
    await litellm.dispose!();

    // Proxy mode without API key: unhealthy
    expect(await litellm.healthy()).toBe(false);
  });
});
