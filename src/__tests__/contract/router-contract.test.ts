/**
 * @maestro/router — Contract test suite for RouterPlugin implementations.
 *
 * Every plugin that implements the RouterPlugin interface MUST pass this suite.
 * This is the fitness function: if a plugin breaks a contract test, it is
 * not a valid router plugin.
 *
 * Tests: direct, maestro, mock (no API keys required).
 * Plugins that need API keys (openrouter, requesty, portkey, litellm) are
 * skipped in CI — they run only when their env vars are present.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type {
  SpawnIntent,
  ModelSelection,
  ModelCapability,
  RouterPlugin,
} from '../../types.js';
import { NoModelAvailableError } from '../../errors.js';

// ── Plugin Loader Definitions ────────────────────────────────────

interface PluginTestEntry {
  id: string;
  loader: () => Promise<RouterPlugin>;
  /** Whether this plugin requires external API keys to function. */
  needsApiKey: boolean;
}

const pluginsToTest: PluginTestEntry[] = [
  {
    id: 'direct',
    loader: async () => (await import('../../plugins/direct.js')).default,
    needsApiKey: false,
  },
  {
    id: 'maestro',
    loader: async () => (await import('../../plugins/maestro.js')).default,
    needsApiKey: false,
  },
  {
    id: 'mock',
    loader: async () => (await import('../../plugins/mock.js')).default,
    needsApiKey: false,
  },
];

// ── Contract Suite ───────────────────────────────────────────────

for (const entry of pluginsToTest) {
  const shouldSkip = entry.needsApiKey && !process.env.CI_HAS_API_KEYS;

  const suiteFn = shouldSkip ? describe.skip : describe;

  suiteFn(`RouterPlugin contract: ${entry.id}`, () => {
    let plugin: RouterPlugin;

    beforeAll(async () => {
      plugin = await entry.loader();
      if (plugin.initialize) {
        await plugin.initialize({});
      }
    });

    afterAll(async () => {
      if (plugin?.dispose) {
        await plugin.dispose();
      }
    });

    // ── 1. Interface compliance ────────────────────────────────

    it('has id as a string', () => {
      expect(typeof plugin.id).toBe('string');
      expect(plugin.id.length).toBeGreaterThan(0);
    });

    it('has name as a string', () => {
      expect(typeof plugin.name).toBe('string');
      expect(plugin.name.length).toBeGreaterThan(0);
    });

    it('has select as a function', () => {
      expect(typeof plugin.select).toBe('function');
    });

    it('has models as a function', () => {
      expect(typeof plugin.models).toBe('function');
    });

    it('has healthy as a function', () => {
      expect(typeof plugin.healthy).toBe('function');
    });

    // ── 2. select() returns valid ModelSelection ───────────────

    it('select() returns a ModelSelection with all 5 required fields', async () => {
      const intent: SpawnIntent = {
        effort: 'standard',
        cost_sensitivity: 'normal',
      };
      const selection = await plugin.select(intent);

      expect(selection).toHaveProperty('router');
      expect(selection).toHaveProperty('provider');
      expect(selection).toHaveProperty('harness');
      expect(selection).toHaveProperty('model');
      expect(selection).toHaveProperty('config');

      expect(typeof selection.router).toBe('string');
      expect(typeof selection.provider).toBe('string');
      expect(typeof selection.harness).toBe('string');
      expect(typeof selection.model).toBe('string');
      expect(typeof selection.config).toBe('string');
    });

    it('select() router field matches plugin.id', async () => {
      const intent: SpawnIntent = {
        effort: 'standard',
        cost_sensitivity: 'normal',
      };
      const selection = await plugin.select(intent);
      expect(selection.router).toBe(plugin.id);
    });

    // ── 3. select() with minimal effort ────────────────────────

    it('select() with minimal effort returns a selection', async () => {
      const intent: SpawnIntent = {
        effort: 'minimal',
        cost_sensitivity: 'normal',
      };
      const selection = await plugin.select(intent);
      expect(selection).toBeDefined();
      expect(selection.model.length).toBeGreaterThan(0);
    });

    // ── 4. select() with deep effort + thinking ────────────────

    it('select() with deep effort and thinking requirement returns model with thinking capability (or throws NoModelAvailableError)', async () => {
      const intent: SpawnIntent = {
        effort: 'deep',
        cost_sensitivity: 'normal',
        requires: ['thinking'],
      };

      try {
        const selection = await plugin.select(intent);
        expect(selection).toBeDefined();
        expect(selection.model.length).toBeGreaterThan(0);

        // Verify the selected model actually has thinking capability
        const models = await plugin.models();
        const selectedModel = models.find(
          (m) => m.model === selection.model && m.provider === selection.provider,
        );
        // If the plugin exposes the model in its models() list, check capability
        if (selectedModel) {
          expect(selectedModel.capabilities).toContain('thinking');
        }
      } catch (err) {
        // Only NoModelAvailableError is acceptable
        expect(err).toBeInstanceOf(NoModelAvailableError);
      }
    });

    // ── 5. select() with high cost_sensitivity ─────────────────

    it('select() with high cost_sensitivity returns a model no more expensive than with low cost_sensitivity', async () => {
      const highCostIntent: SpawnIntent = {
        effort: 'standard',
        cost_sensitivity: 'high',
      };
      const lowCostIntent: SpawnIntent = {
        effort: 'standard',
        cost_sensitivity: 'low',
      };

      const highSelection = await plugin.select(highCostIntent);
      const lowSelection = await plugin.select(lowCostIntent);

      // Both must return valid selections
      expect(highSelection).toBeDefined();
      expect(lowSelection).toBeDefined();

      // If estimated_cost is populated, cheap selection should be <= expensive selection
      if (
        highSelection.estimated_cost !== undefined &&
        lowSelection.estimated_cost !== undefined
      ) {
        expect(highSelection.estimated_cost).toBeLessThanOrEqual(
          lowSelection.estimated_cost + 0.0001, // float tolerance
        );
      }
    });

    // ── 6. models() returns array with correct shape ───────────

    it('models() returns an array of ModelCapability entries', async () => {
      const models = await plugin.models();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      for (const model of models) {
        expect(typeof model.provider).toBe('string');
        expect(typeof model.model).toBe('string');
        expect(Array.isArray(model.capabilities)).toBe(true);
        expect(typeof model.context_window).toBe('number');
        expect(typeof model.cost_per_million_input).toBe('number');
        expect(typeof model.cost_per_million_output).toBe('number');
      }
    });

    // ── 7. healthy() returns boolean ───────────────────────────

    it('healthy() returns a boolean', async () => {
      const result = await plugin.healthy();
      expect(typeof result).toBe('boolean');
    });

    it('healthy() returns true for plugins without external dependencies', async () => {
      if (!entry.needsApiKey) {
        const result = await plugin.healthy();
        expect(result).toBe(true);
      }
    });
  });
}
