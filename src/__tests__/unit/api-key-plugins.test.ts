/**
 * @maestro/router — API-key-dependent plugin unit tests.
 *
 * Covers the 4 plugins that require an API key for operation:
 * openrouter, requesty, portkey, litellm. Exercises each plugin's
 * initialize/select/healthy/dispose flow using static model catalogs
 * (no HTTP calls, no mocking needed).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SpawnIntent } from '../../types.js';
import { SelectionError, NoModelAvailableError } from '../../errors.js';

import openrouter from '../../plugins/openrouter.js';
import requesty from '../../plugins/requesty.js';
import portkey from '../../plugins/portkey.js';
import litellm from '../../plugins/litellm.js';

// ── Helpers ─────────────────────────────────────────────────────────

function intent(overrides: Partial<SpawnIntent> = {}): SpawnIntent {
  return {
    effort: 'standard',
    cost_sensitivity: 'normal',
    ...overrides,
  };
}

// ── OpenRouter ──────────────────────────────────────────────────────

describe('openrouter', () => {
  beforeEach(async () => { await openrouter.dispose!(); });
  afterEach(async () => { await openrouter.dispose!(); });

  describe('initialize / API key handling', () => {
    it('accepts api_key and reports healthy', async () => {
      await openrouter.initialize!({ api_key: 'test-key' });
      expect(await openrouter.healthy()).toBe(true);
    });

    it('accepts OPENROUTER_API_KEY and reports healthy', async () => {
      await openrouter.initialize!({ OPENROUTER_API_KEY: 'test-key' });
      expect(await openrouter.healthy()).toBe(true);
    });

    it('reports unhealthy when no key provided', async () => {
      await openrouter.initialize!({});
      expect(await openrouter.healthy()).toBe(false);
    });

    it('rejects empty string as API key', async () => {
      await openrouter.initialize!({ api_key: '' });
      expect(await openrouter.healthy()).toBe(false);
    });

    it('accepts custom base_url without throwing', async () => {
      await openrouter.initialize!({ api_key: 'key', base_url: 'https://custom.url' });
      expect(await openrouter.healthy()).toBe(true);
    });
  });

  describe('select without API key', () => {
    it('throws SelectionError when no key configured', async () => {
      await openrouter.initialize!({});
      await expect(openrouter.select(intent())).rejects.toThrow(SelectionError);
    });
  });

  describe('select — effort routing', () => {
    beforeEach(async () => { await openrouter.initialize!({ api_key: 'test-key' }); });

    it('returns a high-capability model for deep effort', async () => {
      const result = await openrouter.select(intent({ effort: 'deep' }));
      expect(['claude-opus-4-6', 'gpt-5', 'gemini-2.5-pro']).toContain(result.model);
    });

    it('returns a cheaper model for minimal effort', async () => {
      const result = await openrouter.select(intent({ effort: 'minimal' }));
      expect(['claude-haiku-4-5', 'gpt-4.1-mini', 'gemini-2.5-flash', 'llama-4-maverick']).toContain(result.model);
    });

    it('returns a selection for standard effort', async () => {
      const result = await openrouter.select(intent({ effort: 'standard' }));
      expect(result.model).toBeTruthy();
      expect(result.router).toBe('openrouter');
    });
  });

  describe('select — capability filtering', () => {
    beforeEach(async () => { await openrouter.initialize!({ api_key: 'test-key' }); });

    it('filters models by thinking capability', async () => {
      const result = await openrouter.select(intent({ requires: ['thinking'] }));
      // Models with thinking: claude-opus-4-6, claude-sonnet-4-6, gpt-5, gemini-2.5-pro
      expect(['claude-opus-4-6', 'claude-sonnet-4-6', 'gpt-5', 'gemini-2.5-pro']).toContain(result.model);
    });

    it('throws NoModelAvailableError for nonexistent capability', async () => {
      await expect(
        openrouter.select(intent({ requires: ['nonexistent'] })),
      ).rejects.toThrow(NoModelAvailableError);
    });
  });

  describe('select — cost sensitivity', () => {
    beforeEach(async () => { await openrouter.initialize!({ api_key: 'test-key' }); });

    it('picks a cheaper model when cost_sensitivity is high', async () => {
      const highCost = await openrouter.select(intent({ cost_sensitivity: 'high', effort: 'standard' }));
      const lowCost = await openrouter.select(intent({ cost_sensitivity: 'low', effort: 'standard' }));
      expect(highCost.estimated_cost!).toBeLessThanOrEqual(lowCost.estimated_cost!);
    });
  });

  describe('select — provider preferences', () => {
    beforeEach(async () => { await openrouter.initialize!({ api_key: 'test-key' }); });

    it('prefers google provider when cost_sensitivity is high', async () => {
      const result = await openrouter.select(intent({
        cost_sensitivity: 'high',
        prefer_provider: 'google',
      }));
      expect(result.provider).toBe('google');
    });

    it('throws NoModelAvailableError when all providers excluded', async () => {
      await expect(
        openrouter.select(intent({
          exclude_providers: ['anthropic', 'openai', 'google', 'mistral', 'deepseek', 'meta'],
        })),
      ).rejects.toThrow(NoModelAvailableError);
    });
  });

  describe('dispose resets state', () => {
    it('reports unhealthy after dispose', async () => {
      await openrouter.initialize!({ api_key: 'key' });
      expect(await openrouter.healthy()).toBe(true);
      await openrouter.dispose!();
      expect(await openrouter.healthy()).toBe(false);
    });
  });
});

// ── Requesty ────────────────────────────────────────────────────────

describe('requesty', () => {
  beforeEach(async () => { await requesty.dispose!(); });
  afterEach(async () => { await requesty.dispose!(); });

  describe('initialize / API key handling', () => {
    it('accepts api_key and reports healthy', async () => {
      await requesty.initialize!({ api_key: 'test-key' });
      expect(await requesty.healthy()).toBe(true);
    });

    it('accepts REQUESTY_API_KEY and reports healthy', async () => {
      await requesty.initialize!({ REQUESTY_API_KEY: 'test-key' });
      expect(await requesty.healthy()).toBe(true);
    });

    it('reports unhealthy when no key provided', async () => {
      await requesty.initialize!({});
      expect(await requesty.healthy()).toBe(false);
    });

    it('rejects empty string as API key', async () => {
      await requesty.initialize!({ api_key: '' });
      expect(await requesty.healthy()).toBe(false);
    });
  });

  describe('select without API key', () => {
    it('throws SelectionError when no key configured', async () => {
      await requesty.initialize!({});
      await expect(requesty.select(intent())).rejects.toThrow(SelectionError);
    });
  });

  describe('select — effort routing', () => {
    beforeEach(async () => { await requesty.initialize!({ api_key: 'test-key' }); });

    it('returns a high-capability model for deep effort', async () => {
      const result = await requesty.select(intent({ effort: 'deep' }));
      expect(['claude-opus-4-6', 'gpt-5', 'gemini-2.5-pro']).toContain(result.model);
    });

    it('returns a cheaper model for minimal effort', async () => {
      const result = await requesty.select(intent({ effort: 'minimal' }));
      expect(['claude-haiku-4-5', 'gpt-4.1-mini', 'gemini-2.5-flash']).toContain(result.model);
    });

    it('returns a selection for standard effort', async () => {
      const result = await requesty.select(intent({ effort: 'standard' }));
      expect(result.model).toBeTruthy();
      expect(result.router).toBe('requesty');
    });
  });

  describe('select — capability filtering', () => {
    beforeEach(async () => { await requesty.initialize!({ api_key: 'test-key' }); });

    it('filters models by thinking capability', async () => {
      const result = await requesty.select(intent({ requires: ['thinking'] }));
      expect(['claude-opus-4-6', 'claude-sonnet-4-6', 'gpt-5', 'gemini-2.5-pro']).toContain(result.model);
    });

    it('throws NoModelAvailableError for nonexistent capability', async () => {
      await expect(
        requesty.select(intent({ requires: ['nonexistent'] })),
      ).rejects.toThrow(NoModelAvailableError);
    });
  });

  describe('select — cost sensitivity', () => {
    beforeEach(async () => { await requesty.initialize!({ api_key: 'test-key' }); });

    it('picks a cheaper model when cost_sensitivity is high', async () => {
      const highCost = await requesty.select(intent({ cost_sensitivity: 'high', effort: 'standard' }));
      const lowCost = await requesty.select(intent({ cost_sensitivity: 'low', effort: 'standard' }));
      expect(highCost.estimated_cost!).toBeLessThanOrEqual(lowCost.estimated_cost!);
    });
  });

  describe('select — provider preferences', () => {
    beforeEach(async () => { await requesty.initialize!({ api_key: 'test-key' }); });

    it('prefers google provider when cost_sensitivity is high', async () => {
      const result = await requesty.select(intent({
        cost_sensitivity: 'high',
        prefer_provider: 'google',
      }));
      expect(result.provider).toBe('google');
    });

    it('throws NoModelAvailableError when all providers excluded', async () => {
      await expect(
        requesty.select(intent({
          exclude_providers: ['anthropic', 'openai', 'google', 'mistral', 'deepseek', 'meta'],
        })),
      ).rejects.toThrow(NoModelAvailableError);
    });
  });

  describe('dispose resets state', () => {
    it('reports unhealthy after dispose', async () => {
      await requesty.initialize!({ api_key: 'key' });
      expect(await requesty.healthy()).toBe(true);
      await requesty.dispose!();
      expect(await requesty.healthy()).toBe(false);
    });
  });
});

// ── Portkey ─────────────────────────────────────────────────────────

describe('portkey', () => {
  beforeEach(async () => { await portkey.dispose!(); });
  afterEach(async () => { await portkey.dispose!(); });

  describe('initialize / API key handling', () => {
    it('accepts api_key and reports healthy', async () => {
      await portkey.initialize!({ api_key: 'test-key' });
      expect(await portkey.healthy()).toBe(true);
    });

    it('accepts PORTKEY_API_KEY and reports healthy', async () => {
      await portkey.initialize!({ PORTKEY_API_KEY: 'test-key' });
      expect(await portkey.healthy()).toBe(true);
    });

    it('reports unhealthy when no key provided', async () => {
      await portkey.initialize!({});
      expect(await portkey.healthy()).toBe(false);
    });

    it('rejects empty string as API key', async () => {
      await portkey.initialize!({ api_key: '' });
      expect(await portkey.healthy()).toBe(false);
    });

    it('accepts virtual_key without throwing', async () => {
      await portkey.initialize!({ api_key: 'key', virtual_key: 'vk-test' });
      expect(await portkey.healthy()).toBe(true);
    });
  });

  describe('select without API key', () => {
    it('throws SelectionError when no key configured', async () => {
      await portkey.initialize!({});
      await expect(portkey.select(intent())).rejects.toThrow(SelectionError);
    });
  });

  describe('select — effort routing', () => {
    beforeEach(async () => { await portkey.initialize!({ api_key: 'test-key' }); });

    it('returns a high-capability model for deep effort', async () => {
      const result = await portkey.select(intent({ effort: 'deep' }));
      expect(['claude-opus-4-6', 'gpt-5', 'gemini-2.5-pro']).toContain(result.model);
    });

    it('returns a cheaper model for minimal effort', async () => {
      const result = await portkey.select(intent({ effort: 'minimal' }));
      expect(['claude-haiku-4-5', 'gpt-4.1-mini', 'gemini-2.5-flash']).toContain(result.model);
    });

    it('returns a selection for standard effort', async () => {
      const result = await portkey.select(intent({ effort: 'standard' }));
      expect(result.model).toBeTruthy();
      expect(result.router).toBe('portkey');
    });
  });

  describe('select — capability filtering', () => {
    beforeEach(async () => { await portkey.initialize!({ api_key: 'test-key' }); });

    it('filters models by thinking capability', async () => {
      const result = await portkey.select(intent({ requires: ['thinking'] }));
      expect(['claude-opus-4-6', 'claude-sonnet-4-6', 'gpt-5', 'gemini-2.5-pro']).toContain(result.model);
    });

    it('throws NoModelAvailableError for nonexistent capability', async () => {
      await expect(
        portkey.select(intent({ requires: ['nonexistent'] })),
      ).rejects.toThrow(NoModelAvailableError);
    });
  });

  describe('select — cost sensitivity', () => {
    beforeEach(async () => { await portkey.initialize!({ api_key: 'test-key' }); });

    it('picks a cheaper model when cost_sensitivity is high', async () => {
      const highCost = await portkey.select(intent({ cost_sensitivity: 'high', effort: 'standard' }));
      const lowCost = await portkey.select(intent({ cost_sensitivity: 'low', effort: 'standard' }));
      expect(highCost.estimated_cost!).toBeLessThanOrEqual(lowCost.estimated_cost!);
    });
  });

  describe('select — provider preferences', () => {
    beforeEach(async () => { await portkey.initialize!({ api_key: 'test-key' }); });

    it('prefers google provider when cost_sensitivity is high', async () => {
      const result = await portkey.select(intent({
        cost_sensitivity: 'high',
        prefer_provider: 'google',
      }));
      expect(result.provider).toBe('google');
    });

    it('throws NoModelAvailableError when all providers excluded', async () => {
      await expect(
        portkey.select(intent({
          exclude_providers: ['anthropic', 'openai', 'google', 'mistral', 'deepseek', 'meta'],
        })),
      ).rejects.toThrow(NoModelAvailableError);
    });
  });

  describe('dispose resets state', () => {
    it('reports unhealthy after dispose', async () => {
      await portkey.initialize!({ api_key: 'key' });
      expect(await portkey.healthy()).toBe(true);
      await portkey.dispose!();
      expect(await portkey.healthy()).toBe(false);
    });
  });
});

// ── LiteLLM ─────────────────────────────────────────────────────────

describe('litellm', () => {
  beforeEach(async () => { await litellm.dispose!(); });
  afterEach(async () => { await litellm.dispose!(); });

  describe('initialize / API key handling', () => {
    it('accepts api_key and reports healthy', async () => {
      await litellm.initialize!({ api_key: 'test-key' });
      expect(await litellm.healthy()).toBe(true);
    });

    it('accepts LITELLM_API_KEY and reports healthy', async () => {
      await litellm.initialize!({ LITELLM_API_KEY: 'test-key' });
      expect(await litellm.healthy()).toBe(true);
    });

    it('reports unhealthy when no key provided (proxy mode)', async () => {
      await litellm.initialize!({});
      expect(await litellm.healthy()).toBe(false);
    });

    it('rejects empty string as API key', async () => {
      await litellm.initialize!({ api_key: '' });
      expect(await litellm.healthy()).toBe(false);
    });
  });

  describe('select without API key (proxy mode)', () => {
    it('throws SelectionError when no key configured', async () => {
      await litellm.initialize!({});
      await expect(litellm.select(intent())).rejects.toThrow(SelectionError);
    });
  });

  describe('sdk mode', () => {
    it('reports healthy without API key in sdk mode', async () => {
      await litellm.initialize!({ mode: 'sdk' });
      expect(await litellm.healthy()).toBe(true);
    });

    it('select succeeds without API key in sdk mode', async () => {
      await litellm.initialize!({ mode: 'sdk' });
      const result = await litellm.select(intent());
      expect(result.router).toBe('litellm');
      expect(result.model).toBeTruthy();
    });

    it('proxy mode requires API key for healthy', async () => {
      await litellm.initialize!({ mode: 'proxy' });
      expect(await litellm.healthy()).toBe(false);
    });
  });

  describe('select — effort routing', () => {
    beforeEach(async () => { await litellm.initialize!({ api_key: 'test-key' }); });

    it('returns a high-capability model for deep effort', async () => {
      const result = await litellm.select(intent({ effort: 'deep' }));
      expect(['claude-opus-4-6', 'gpt-5', 'gemini-2.5-pro', 'deepseek-r1']).toContain(result.model);
    });

    it('returns a cheaper model for minimal effort', async () => {
      const result = await litellm.select(intent({ effort: 'minimal' }));
      expect(['claude-haiku-4-5', 'gpt-4.1-mini', 'gemini-2.5-flash', 'deepseek-r1']).toContain(result.model);
    });

    it('returns a selection for standard effort', async () => {
      const result = await litellm.select(intent({ effort: 'standard' }));
      expect(result.model).toBeTruthy();
      expect(result.router).toBe('litellm');
    });
  });

  describe('select — capability filtering', () => {
    beforeEach(async () => { await litellm.initialize!({ api_key: 'test-key' }); });

    it('filters models by thinking capability', async () => {
      const result = await litellm.select(intent({ requires: ['thinking'] }));
      expect([
        'claude-opus-4-6', 'claude-sonnet-4-6', 'gpt-5', 'gemini-2.5-pro', 'deepseek-r1',
      ]).toContain(result.model);
    });

    it('throws NoModelAvailableError for nonexistent capability', async () => {
      await expect(
        litellm.select(intent({ requires: ['nonexistent'] })),
      ).rejects.toThrow(NoModelAvailableError);
    });
  });

  describe('select — cost sensitivity', () => {
    beforeEach(async () => { await litellm.initialize!({ api_key: 'test-key' }); });

    it('picks a cheaper model when cost_sensitivity is high', async () => {
      const highCost = await litellm.select(intent({ cost_sensitivity: 'high', effort: 'standard' }));
      const lowCost = await litellm.select(intent({ cost_sensitivity: 'low', effort: 'standard' }));
      expect(highCost.estimated_cost!).toBeLessThanOrEqual(lowCost.estimated_cost!);
    });
  });

  describe('select — provider preferences', () => {
    beforeEach(async () => { await litellm.initialize!({ api_key: 'test-key' }); });

    it('prefers google provider when cost_sensitivity is high', async () => {
      const result = await litellm.select(intent({
        cost_sensitivity: 'high',
        prefer_provider: 'google',
      }));
      expect(result.provider).toBe('google');
    });

    it('throws NoModelAvailableError when all providers excluded', async () => {
      await expect(
        litellm.select(intent({
          exclude_providers: ['anthropic', 'openai', 'google', 'mistral', 'deepseek', 'meta'],
        })),
      ).rejects.toThrow(NoModelAvailableError);
    });
  });

  describe('dispose resets state', () => {
    it('reports unhealthy after dispose (defaults to proxy mode)', async () => {
      await litellm.initialize!({ api_key: 'key' });
      expect(await litellm.healthy()).toBe(true);
      await litellm.dispose!();
      expect(await litellm.healthy()).toBe(false);
    });

    it('resets mode to proxy after dispose', async () => {
      await litellm.initialize!({ mode: 'sdk' });
      expect(await litellm.healthy()).toBe(true);
      await litellm.dispose!();
      // After dispose, mode resets to 'proxy' and no API key → unhealthy
      expect(await litellm.healthy()).toBe(false);
    });
  });
});
