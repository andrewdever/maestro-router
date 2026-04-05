/**
 * @maestro/router — Resilience layer unit tests.
 *
 * Tests for createResiliencePolicy() and PluginPolicyManager:
 * - Policy creation and composition (retry + circuit breaker)
 * - Circuit breaker tripping after consecutive failures
 * - Per-plugin isolation in PluginPolicyManager
 * - Retry + breaker integration scenarios
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitState, BrokenCircuitError } from 'cockatiel';
import { createResiliencePolicy, PluginPolicyManager } from '../../resilience.js';

// ── createResiliencePolicy ──────────────────────────────────────

describe('createResiliencePolicy', () => {
  it('returns an object with policy and breaker properties', () => {
    const result = createResiliencePolicy();
    expect(result).toHaveProperty('policy');
    expect(result).toHaveProperty('breaker');
    expect(typeof result.policy.execute).toBe('function');
    expect(result.breaker.state).toBe(CircuitState.Closed);
  });

  it('policy.execute calls fn and returns its result', async () => {
    const { policy } = createResiliencePolicy();
    const result = await policy.execute(async () => 'hello');
    expect(result).toBe('hello');
  });

  it('policy.execute retries on failure then succeeds', async () => {
    const { policy } = createResiliencePolicy({
      maxRetries: 2,
      initialDelay: 1,
      maxDelay: 1,
    });

    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount === 1) throw new Error('transient');
      return 'recovered';
    };

    const result = await policy.execute(fn);
    expect(result).toBe('recovered');
    expect(callCount).toBe(2);
  });

  it('circuit breaker opens after N consecutive failures', async () => {
    const { policy, breaker } = createResiliencePolicy({
      breakerThreshold: 3,
      maxRetries: 0,
      halfOpenAfter: 60_000,
      initialDelay: 1,
      maxDelay: 1,
    });

    // Trip the breaker with 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      await expect(
        policy.execute(async () => { throw new Error(`fail-${i}`); })
      ).rejects.toThrow();
    }

    // 4th call should fail fast with BrokenCircuitError
    try {
      await policy.execute(async () => 'should not reach');
      expect.fail('should have thrown BrokenCircuitError');
    } catch (err) {
      expect(err instanceof BrokenCircuitError).toBe(true);
    }
  });

  it('breaker.state is Open after tripping', async () => {
    const { policy, breaker } = createResiliencePolicy({
      breakerThreshold: 3,
      maxRetries: 0,
      halfOpenAfter: 60_000,
      initialDelay: 1,
      maxDelay: 1,
    });

    for (let i = 0; i < 3; i++) {
      await policy.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }

    expect(breaker.state).toBe(CircuitState.Open);
  });

  it('breaker.state starts as Closed', () => {
    const { breaker } = createResiliencePolicy();
    expect(breaker.state).toBe(CircuitState.Closed);
  });

  it('successful calls keep the breaker closed', async () => {
    const { policy, breaker } = createResiliencePolicy({
      breakerThreshold: 3,
      maxRetries: 0,
    });

    await policy.execute(async () => 'ok');
    await policy.execute(async () => 'ok');
    expect(breaker.state).toBe(CircuitState.Closed);
  });

  it('a success resets the consecutive failure count', async () => {
    const { policy, breaker } = createResiliencePolicy({
      breakerThreshold: 3,
      maxRetries: 0,
      halfOpenAfter: 60_000,
      initialDelay: 1,
      maxDelay: 1,
    });

    // 2 failures, then a success, then 2 more failures — should NOT trip
    for (let i = 0; i < 2; i++) {
      await policy.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    await policy.execute(async () => 'ok');
    for (let i = 0; i < 2; i++) {
      await policy.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }

    expect(breaker.state).toBe(CircuitState.Closed);
  });
});

// ── PluginPolicyManager ─────────────────────────────────────────

describe('PluginPolicyManager', () => {
  let manager: PluginPolicyManager;

  beforeEach(() => {
    manager = new PluginPolicyManager({
      maxRetries: 1,
      initialDelay: 1,
      maxDelay: 1,
      breakerThreshold: 3,
      halfOpenAfter: 60_000,
    });
  });

  it('get(pluginId) returns same policy for same ID', () => {
    const first = manager.get('alpha');
    const second = manager.get('alpha');
    expect(first).toBe(second);
  });

  it('get(pluginId) returns different policies for different IDs', () => {
    const alpha = manager.get('alpha');
    const beta = manager.get('beta');
    expect(alpha).not.toBe(beta);
  });

  it('isOpen(pluginId) returns false for unknown plugin', () => {
    expect(manager.isOpen('nonexistent')).toBe(false);
  });

  it('isOpen(pluginId) returns false for healthy plugin', async () => {
    await manager.execute('alpha', async () => 'ok');
    expect(manager.isOpen('alpha')).toBe(false);
  });

  it('isOpen(pluginId) returns true after breaker trips', async () => {
    const mgr = new PluginPolicyManager({
      breakerThreshold: 2,
      maxRetries: 0,
      halfOpenAfter: 60_000,
      initialDelay: 1,
      maxDelay: 1,
    });

    for (let i = 0; i < 2; i++) {
      await mgr.execute('alpha', async () => { throw new Error('fail'); }).catch(() => {});
    }

    expect(mgr.isOpen('alpha')).toBe(true);
  });

  it('execute(pluginId, fn) calls fn and returns result', async () => {
    const result = await manager.execute('alpha', async () => 42);
    expect(result).toBe(42);
  });

  it('execute(pluginId, fn) retries transient failures', async () => {
    let calls = 0;
    const result = await manager.execute('alpha', async () => {
      calls++;
      if (calls === 1) throw new Error('transient');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('reset() clears all cached policies', () => {
    const before = manager.get('alpha');
    manager.reset();
    const after = manager.get('alpha');
    expect(before).not.toBe(after);
  });

  it('per-plugin isolation: failing plugin A does not affect plugin B', async () => {
    const mgr = new PluginPolicyManager({
      breakerThreshold: 2,
      maxRetries: 0,
      halfOpenAfter: 60_000,
      initialDelay: 1,
      maxDelay: 1,
    });

    // Trip plugin A's breaker
    for (let i = 0; i < 2; i++) {
      await mgr.execute('pluginA', async () => { throw new Error('fail'); }).catch(() => {});
    }

    expect(mgr.isOpen('pluginA')).toBe(true);
    expect(mgr.isOpen('pluginB')).toBe(false);

    // Plugin B should still work fine
    const result = await mgr.execute('pluginB', async () => 'B works');
    expect(result).toBe('B works');
  });

  it('manager with no options uses defaults', () => {
    const defaultManager = new PluginPolicyManager();
    const entry = defaultManager.get('x');
    expect(entry.breaker.state).toBe(CircuitState.Closed);
  });
});

// ── Integration: retry + circuit breaker ────────────────────────

describe('resilience integration: retry + circuit breaker', () => {
  it('transient failure with retry succeeds', async () => {
    const { policy } = createResiliencePolicy({
      maxRetries: 2,
      initialDelay: 1,
      maxDelay: 1,
    });

    let calls = 0;
    const result = await policy.execute(async () => {
      calls++;
      if (calls <= 2) throw new Error('transient');
      return 'success';
    });

    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  it('all retries exhausted throws after max attempts', async () => {
    const { policy } = createResiliencePolicy({
      maxRetries: 2,
      initialDelay: 1,
      maxDelay: 1,
      breakerThreshold: 100, // high threshold so breaker does not interfere
    });

    let calls = 0;
    await expect(
      policy.execute(async () => {
        calls++;
        throw new Error('always fails');
      })
    ).rejects.toThrow('always fails');

    // maxRetries=2 means 3 total attempts (initial + 2 retries)
    expect(calls).toBe(3);
  });

  it('fn is called the expected number of times on partial failure', async () => {
    const { policy } = createResiliencePolicy({
      maxRetries: 3,
      initialDelay: 1,
      maxDelay: 1,
    });

    let calls = 0;
    const result = await policy.execute(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'done';
    });

    expect(result).toBe('done');
    expect(calls).toBe(3);
  });

  it('retries feed into the circuit breaker failure count', async () => {
    // With maxRetries=2 and breakerThreshold=3, a single execute
    // that always fails produces 3 failures (initial + 2 retries),
    // which should trip a threshold-3 breaker.
    const { policy, breaker } = createResiliencePolicy({
      maxRetries: 2,
      breakerThreshold: 3,
      halfOpenAfter: 60_000,
      initialDelay: 1,
      maxDelay: 1,
    });

    await policy.execute(async () => { throw new Error('boom'); }).catch(() => {});

    expect(breaker.state).toBe(CircuitState.Open);
  });

  it('successful retry does not trip the breaker', async () => {
    const { policy, breaker } = createResiliencePolicy({
      maxRetries: 2,
      breakerThreshold: 5,
      initialDelay: 1,
      maxDelay: 1,
    });

    let calls = 0;
    await policy.execute(async () => {
      calls++;
      if (calls === 1) throw new Error('transient');
      return 'ok';
    });

    expect(breaker.state).toBe(CircuitState.Closed);
  });

  it('open breaker causes immediate BrokenCircuitError even with retries', async () => {
    const { policy, breaker } = createResiliencePolicy({
      maxRetries: 2,
      breakerThreshold: 2,
      halfOpenAfter: 60_000,
      initialDelay: 1,
      maxDelay: 1,
    });

    // Trip the breaker: with maxRetries=2 and threshold=2,
    // a single failing execute will send 3 failures through the breaker,
    // which trips it after 2.
    await policy.execute(async () => { throw new Error('fail'); }).catch(() => {});

    // Now the breaker is open. Next call should fail fast.
    let callCount = 0;
    try {
      await policy.execute(async () => {
        callCount++;
        return 'should not run';
      });
      expect.fail('should have thrown');
    } catch (err) {
      // The fn should never have been called because the breaker is open
      expect(callCount).toBe(0);
      expect(err instanceof BrokenCircuitError).toBe(true);
    }
  });
});
