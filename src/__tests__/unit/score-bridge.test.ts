/**
 * @maestro/router — StaticScoreBridge unit tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  StaticScoreBridge,
  createDefaultScoreBridge,
  type ModelQualityData,
} from '../../score-bridge.js';

// ── Tests ────────────────────────────────────────────────────────

describe('StaticScoreBridge', () => {
  let bridge: StaticScoreBridge;

  beforeEach(() => {
    bridge = new StaticScoreBridge();
  });

  // ── register() and getQuality() ──────────────────────────────

  it('register() and getQuality() return registered data', () => {
    const entry: ModelQualityData = {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      task_type: 'code-review',
      quality: 0.95,
      sample_size: 100,
      updated_at: '2026-04-01T00:00:00Z',
    };
    bridge.register(entry);

    const result = bridge.getQuality('anthropic', 'claude-opus-4-6', 'code-review');
    expect(result).not.toBeNull();
    expect(result!.quality).toBe(0.95);
    expect(result!.provider).toBe('anthropic');
    expect(result!.model).toBe('claude-opus-4-6');
    expect(result!.task_type).toBe('code-review');
    expect(result!.sample_size).toBe(100);
  });

  // ── getQuality() for unknown model ───────────────────────────

  it('getQuality() returns null for an unknown model', () => {
    const result = bridge.getQuality('unknown', 'unknown-model', 'code-review');
    expect(result).toBeNull();
  });

  it('getQuality() returns null for unknown task_type when no wildcard', () => {
    bridge.register({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      task_type: 'code-review',
      quality: 0.95,
      sample_size: 100,
      updated_at: '2026-04-01T00:00:00Z',
    });

    const result = bridge.getQuality('anthropic', 'claude-opus-4-6', 'summarization');
    expect(result).toBeNull();
  });

  // ── getQuality() wildcard fallback ───────────────────────────

  it('getQuality() falls back to wildcard (*) task_type', () => {
    bridge.register({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      task_type: '*',
      quality: 0.90,
      sample_size: 0,
      updated_at: '2026-04-01T00:00:00Z',
    });

    // No exact match for 'analysis', should fall back to '*'
    const result = bridge.getQuality('anthropic', 'claude-opus-4-6', 'analysis');
    expect(result).not.toBeNull();
    expect(result!.quality).toBe(0.90);
    expect(result!.task_type).toBe('*');
  });

  it('getQuality() prefers exact task_type over wildcard', () => {
    bridge.register({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      task_type: '*',
      quality: 0.90,
      sample_size: 0,
      updated_at: '2026-04-01T00:00:00Z',
    });
    bridge.register({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      task_type: 'code-review',
      quality: 0.97,
      sample_size: 50,
      updated_at: '2026-04-01T00:00:00Z',
    });

    const result = bridge.getQuality('anthropic', 'claude-opus-4-6', 'code-review');
    expect(result).not.toBeNull();
    expect(result!.quality).toBe(0.97);
  });

  it('getQuality() without task_type returns wildcard entry', () => {
    bridge.register({
      provider: 'openai',
      model: 'gpt-5',
      task_type: '*',
      quality: 0.93,
      sample_size: 0,
      updated_at: '2026-04-01T00:00:00Z',
    });

    const result = bridge.getQuality('openai', 'gpt-5');
    expect(result).not.toBeNull();
    expect(result!.quality).toBe(0.93);
  });

  // ── getProviderQuality() ─────────────────────────────────────

  it('getProviderQuality() returns all entries for a provider', () => {
    bridge.registerAll([
      {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        task_type: '*',
        quality: 0.95,
        sample_size: 0,
        updated_at: '2026-04-01T00:00:00Z',
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        task_type: '*',
        quality: 0.90,
        sample_size: 0,
        updated_at: '2026-04-01T00:00:00Z',
      },
      {
        provider: 'openai',
        model: 'gpt-5',
        task_type: '*',
        quality: 0.93,
        sample_size: 0,
        updated_at: '2026-04-01T00:00:00Z',
      },
    ]);

    const anthropicModels = bridge.getProviderQuality('anthropic');
    expect(anthropicModels).toHaveLength(2);
    expect(anthropicModels.every((m) => m.provider === 'anthropic')).toBe(true);
  });

  it('getProviderQuality() returns empty array for unknown provider', () => {
    const result = bridge.getProviderQuality('nonexistent');
    expect(result).toEqual([]);
  });

  // ── registerAll() ────────────────────────────────────────────

  it('registerAll() registers multiple entries', () => {
    bridge.registerAll([
      {
        provider: 'a',
        model: 'm1',
        task_type: '*',
        quality: 0.8,
        sample_size: 0,
        updated_at: '2026-04-01T00:00:00Z',
      },
      {
        provider: 'b',
        model: 'm2',
        task_type: '*',
        quality: 0.7,
        sample_size: 0,
        updated_at: '2026-04-01T00:00:00Z',
      },
    ]);

    expect(bridge.getQuality('a', 'm1')).not.toBeNull();
    expect(bridge.getQuality('b', 'm2')).not.toBeNull();
  });
});

// ── createDefaultScoreBridge() ───────────────────────────────────

describe('createDefaultScoreBridge', () => {
  it('returns a StaticScoreBridge pre-populated with known models', () => {
    const bridge = createDefaultScoreBridge();
    expect(bridge).toBeInstanceOf(StaticScoreBridge);

    // Should have quality data for known models
    const opus = bridge.getQuality('anthropic', 'claude-opus-4-6');
    expect(opus).not.toBeNull();
    expect(opus!.quality).toBe(0.95);

    const sonnet = bridge.getQuality('anthropic', 'claude-sonnet-4-6');
    expect(sonnet).not.toBeNull();
    expect(sonnet!.quality).toBe(0.90);

    const haiku = bridge.getQuality('anthropic', 'claude-haiku-4-5');
    expect(haiku).not.toBeNull();
    expect(haiku!.quality).toBe(0.78);

    const gpt5 = bridge.getQuality('openai', 'gpt-5');
    expect(gpt5).not.toBeNull();
    expect(gpt5!.quality).toBe(0.93);

    const geminiPro = bridge.getQuality('google', 'gemini-2.5-pro');
    expect(geminiPro).not.toBeNull();
    expect(geminiPro!.quality).toBe(0.91);
  });

  it('default bridge entries use wildcard task_type', () => {
    const bridge = createDefaultScoreBridge();
    const opus = bridge.getQuality('anthropic', 'claude-opus-4-6');
    expect(opus!.task_type).toBe('*');
  });

  it('default bridge entries have sample_size 0', () => {
    const bridge = createDefaultScoreBridge();
    const opus = bridge.getQuality('anthropic', 'claude-opus-4-6');
    expect(opus!.sample_size).toBe(0);
  });
});
