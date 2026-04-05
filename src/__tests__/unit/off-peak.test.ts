/**
 * @maestro/router — Off-peak boundary logic tests.
 *
 * Tests the DeepSeek off-peak window (16:30–00:30 UTC daily) via the
 * Maestro plugin's select() method. The getOffPeakDiscount() function
 * is module-private, so we verify its behavior indirectly through
 * the rationale string in ModelSelection.
 *
 * Two observable effects during off-peak:
 *   1. cost_sensitivity shifts to 'high' (when original is not 'low')
 *   2. DeepSeek models get a discount note in the rationale
 *
 * To test effect #2, we inject a DeepSeek model into the catalog.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import maestro from '../../plugins/maestro.js';
import type { SpawnIntent, ModelCapability } from '../../types.js';

// ── Test Fixtures ────────────────────────────────────────────────

/** A DeepSeek model so the off-peak discount note actually fires. */
const DEEPSEEK_MODEL: ModelCapability = {
  provider: 'deepseek',
  model: 'deepseek-v3',
  capabilities: ['tool_use', 'code'],
  context_window: 128_000,
  max_thinking_budget: 0,
  cost_per_million_input: 0.27,
  cost_per_million_output: 1.10,
};

/** A baseline Anthropic model for comparison. */
const ANTHROPIC_MODEL: ModelCapability = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  capabilities: ['thinking', 'tool_use', 'vision', 'code'],
  context_window: 200_000,
  max_thinking_budget: 16_000,
  cost_per_million_input: 3.0,
  cost_per_million_output: 15.0,
};

const standardIntent: SpawnIntent = {
  effort: 'standard',
  cost_sensitivity: 'normal',
};

async function selectRationale(intent: SpawnIntent = standardIntent): Promise<string> {
  const result = await maestro.select(intent);
  return result.rationale ?? '';
}

// ── Off-Peak Boundary Tests (with DeepSeek in catalog) ──────────

describe('off-peak boundaries via select()', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    // Inject a DeepSeek model so the off-peak discount note appears
    await maestro.initialize!({
      off_peak_enabled: true,
      models: [DEEPSEEK_MODEL, ANTHROPIC_MODEL],
      score_bridge: {
        getQuality: (_provider: string, _model: string) => ({
          provider: _provider,
          model: _model,
          task_type: '*',
          quality: 0.85,
          sample_size: 0,
          updated_at: new Date().toISOString(),
        }),
        getProviderQuality: () => [],
      },
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await maestro.dispose!();
  });

  it('16:30 UTC — boundary start, should be IN off-peak window', async () => {
    vi.setSystemTime(new Date('2026-04-05T16:30:00Z'));
    const rationale = await selectRationale();
    expect(rationale.toLowerCase()).toContain('off-peak');
  });

  it('16:29 UTC — just before window, should NOT be in off-peak', async () => {
    vi.setSystemTime(new Date('2026-04-05T16:29:00Z'));
    const rationale = await selectRationale();
    expect(rationale.toLowerCase()).not.toContain('off-peak');
  });

  it('00:00 UTC — midnight, should be IN off-peak window', async () => {
    vi.setSystemTime(new Date('2026-04-05T00:00:00Z'));
    const rationale = await selectRationale();
    expect(rationale.toLowerCase()).toContain('off-peak');
  });

  it('00:29 UTC — near window end, should be IN off-peak window', async () => {
    vi.setSystemTime(new Date('2026-04-05T00:29:00Z'));
    const rationale = await selectRationale();
    expect(rationale.toLowerCase()).toContain('off-peak');
  });

  it('00:30 UTC — boundary end, should NOT be in off-peak window', async () => {
    vi.setSystemTime(new Date('2026-04-05T00:30:00Z'));
    const rationale = await selectRationale();
    expect(rationale.toLowerCase()).not.toContain('off-peak');
  });

  it('12:00 UTC — midday, should NOT be in off-peak window', async () => {
    vi.setSystemTime(new Date('2026-04-05T12:00:00Z'));
    const rationale = await selectRationale();
    expect(rationale.toLowerCase()).not.toContain('off-peak');
  });

  it('23:59 UTC — late night, should be IN off-peak window', async () => {
    vi.setSystemTime(new Date('2026-04-05T23:59:00Z'));
    const rationale = await selectRationale();
    expect(rationale.toLowerCase()).toContain('off-peak');
  });
});

// ── Cost sensitivity shift during off-peak ───────────────────────

describe('off-peak cost_sensitivity shift', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await maestro.initialize!({
      off_peak_enabled: true,
      models: [DEEPSEEK_MODEL, ANTHROPIC_MODEL],
      score_bridge: {
        getQuality: (_provider: string, _model: string) => ({
          provider: _provider,
          model: _model,
          task_type: '*',
          quality: 0.85,
          sample_size: 0,
          updated_at: new Date().toISOString(),
        }),
        getProviderQuality: () => [],
      },
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await maestro.dispose!();
  });

  it('cost_sensitivity shifts to high during off-peak when original is normal', async () => {
    vi.setSystemTime(new Date('2026-04-05T17:00:00Z'));
    const rationale = await selectRationale({ effort: 'standard', cost_sensitivity: 'normal' });
    expect(rationale).toContain('cost_sensitivity=high');
  });

  it('cost_sensitivity stays low during off-peak when original is low', async () => {
    vi.setSystemTime(new Date('2026-04-05T17:00:00Z'));
    const rationale = await selectRationale({ effort: 'standard', cost_sensitivity: 'low' });
    expect(rationale).toContain('cost_sensitivity=low');
  });
});

// ── Off-Peak Disabled ────────────────────────────────────────────

describe('off-peak disabled', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await maestro.dispose!();
  });

  it('no off-peak text when off_peak_enabled is false', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T16:30:00Z'));
    await maestro.initialize!({
      off_peak_enabled: false,
      models: [DEEPSEEK_MODEL, ANTHROPIC_MODEL],
      score_bridge: {
        getQuality: (_provider: string, _model: string) => ({
          provider: _provider,
          model: _model,
          task_type: '*',
          quality: 0.85,
          sample_size: 0,
          updated_at: new Date().toISOString(),
        }),
        getProviderQuality: () => [],
      },
    });
    const rationale = await selectRationale();
    expect(rationale.toLowerCase()).not.toContain('off-peak');
  });

  it('no off-peak text when off_peak_enabled is omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T16:30:00Z'));
    await maestro.initialize!({
      models: [DEEPSEEK_MODEL, ANTHROPIC_MODEL],
      score_bridge: {
        getQuality: (_provider: string, _model: string) => ({
          provider: _provider,
          model: _model,
          task_type: '*',
          quality: 0.85,
          sample_size: 0,
          updated_at: new Date().toISOString(),
        }),
        getProviderQuality: () => [],
      },
    });
    const rationale = await selectRationale();
    expect(rationale.toLowerCase()).not.toContain('off-peak');
  });
});

// ── Off-Peak with Provider Preference ────────────────────────────

describe('off-peak with non-deepseek preference', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await maestro.initialize!({
      off_peak_enabled: true,
      models: [DEEPSEEK_MODEL, ANTHROPIC_MODEL],
      score_bridge: {
        getQuality: (_provider: string, _model: string) => ({
          provider: _provider,
          model: _model,
          task_type: '*',
          quality: 0.85,
          sample_size: 0,
          updated_at: new Date().toISOString(),
        }),
        getProviderQuality: () => [],
      },
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await maestro.dispose!();
  });

  it('anthropic preference during off-peak — selected anthropic model has no discount note', async () => {
    vi.setSystemTime(new Date('2026-04-05T17:00:00Z'));
    const result = await maestro.select({
      effort: 'standard',
      cost_sensitivity: 'normal',
      prefer_provider: 'anthropic',
    });
    // With anthropic preference (5% composite boost), if anthropic is selected,
    // it should NOT have a deepseek-specific off-peak discount note.
    if (result.provider === 'anthropic') {
      expect(result.rationale?.toLowerCase()).not.toContain('discount');
    }
    expect(result.provider).toBeDefined();
    expect(result.model).toBeDefined();
  });
});
