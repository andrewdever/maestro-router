import { describe, it, expect } from 'vitest';
import {
  InMemoryAuditStore,
  RouterAuditLog,
  type AuditEntry,
} from '../../audit.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: overrides.id ?? `test_${Math.random().toString(36).slice(2)}`,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    decision: overrides.decision ?? {
      slug: 'openai/gpt-4o',
      plugin_id: 'cost-aware',
      provider: 'openai',
      model: 'gpt-4o',
      used_fallback: false,
      habit_match: false,
    },
    intent: overrides.intent ?? {
      effort: 'high',
      cost_sensitivity: 'low',
    },
    context: overrides.context,
  };
}

function makeDecision(overrides: Partial<AuditEntry['decision']> = {}) {
  return {
    slug: 'openai/gpt-4o',
    plugin_id: 'cost-aware',
    provider: 'openai',
    model: 'gpt-4o',
    used_fallback: false,
    habit_match: false,
    ...overrides,
  };
}

function makeIntent(overrides: Partial<AuditEntry['intent']> = {}) {
  return {
    effort: 'high',
    cost_sensitivity: 'low',
    ...overrides,
  };
}

// ── InMemoryAuditStore ───────────────────────────────────────────

describe('InMemoryAuditStore', () => {
  describe('append()', () => {
    it('stores entries', async () => {
      const store = new InMemoryAuditStore();
      const entry = makeEntry();

      await store.append(entry);

      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(entry);
    });

    it('stores multiple entries in order', async () => {
      const store = new InMemoryAuditStore();
      const e1 = makeEntry({ id: 'first' });
      const e2 = makeEntry({ id: 'second' });
      const e3 = makeEntry({ id: 'third' });

      await store.append(e1);
      await store.append(e2);
      await store.append(e3);

      const all = store.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].id).toBe('first');
      expect(all[1].id).toBe('second');
      expect(all[2].id).toBe('third');
    });
  });

  describe('query()', () => {
    it('returns newest first', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({ id: 'old', timestamp: '2025-01-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'mid', timestamp: '2025-06-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'new', timestamp: '2025-12-01T00:00:00Z' }));

      const result = await store.query({});

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('new');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('old');
    });

    it('filters by since (inclusive)', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({ id: 'before', timestamp: '2025-01-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'exact', timestamp: '2025-06-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'after', timestamp: '2025-12-01T00:00:00Z' }));

      const result = await store.query({ since: '2025-06-01T00:00:00Z' });

      expect(result).toHaveLength(2);
      expect(result.map(e => e.id)).toEqual(['after', 'exact']);
    });

    it('filters by until (inclusive)', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({ id: 'before', timestamp: '2025-01-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'exact', timestamp: '2025-06-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'after', timestamp: '2025-12-01T00:00:00Z' }));

      const result = await store.query({ until: '2025-06-01T00:00:00Z' });

      expect(result).toHaveLength(2);
      expect(result.map(e => e.id)).toEqual(['exact', 'before']);
    });

    it('filters by since and until together', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({ id: 'jan', timestamp: '2025-01-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'mar', timestamp: '2025-03-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'jun', timestamp: '2025-06-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'sep', timestamp: '2025-09-01T00:00:00Z' }));
      await store.append(makeEntry({ id: 'dec', timestamp: '2025-12-01T00:00:00Z' }));

      const result = await store.query({
        since: '2025-03-01T00:00:00Z',
        until: '2025-09-01T00:00:00Z',
      });

      expect(result).toHaveLength(3);
      expect(result.map(e => e.id)).toEqual(['sep', 'jun', 'mar']);
    });

    it('filters by plugin_id', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({
        id: 'a',
        decision: makeDecision({ plugin_id: 'cost-aware' }),
      }));
      await store.append(makeEntry({
        id: 'b',
        decision: makeDecision({ plugin_id: 'quality-first' }),
      }));
      await store.append(makeEntry({
        id: 'c',
        decision: makeDecision({ plugin_id: 'cost-aware' }),
      }));

      const result = await store.query({ filter: { plugin_id: 'cost-aware' } });

      expect(result).toHaveLength(2);
      expect(result.every(e => e.decision.plugin_id === 'cost-aware')).toBe(true);
    });

    it('filters by provider', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({
        id: 'oai',
        decision: makeDecision({ provider: 'openai' }),
      }));
      await store.append(makeEntry({
        id: 'anth',
        decision: makeDecision({ provider: 'anthropic' }),
      }));

      const result = await store.query({ filter: { provider: 'anthropic' } });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('anth');
    });

    it('filters by model', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({
        id: 'gpt',
        decision: makeDecision({ model: 'gpt-4o' }),
      }));
      await store.append(makeEntry({
        id: 'claude',
        decision: makeDecision({ model: 'claude-sonnet-4-20250514' }),
      }));

      const result = await store.query({ filter: { model: 'claude-sonnet-4-20250514' } });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('claude');
    });

    it('filters by caller_id', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({
        id: 'user-a',
        context: { caller_id: 'alice' },
      }));
      await store.append(makeEntry({
        id: 'user-b',
        context: { caller_id: 'bob' },
      }));
      await store.append(makeEntry({ id: 'no-ctx' }));

      const result = await store.query({ filter: { caller_id: 'alice' } });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-a');
    });

    it('filters by habit_match', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({
        id: 'habit-yes',
        decision: makeDecision({ habit_match: true }),
      }));
      await store.append(makeEntry({
        id: 'habit-no',
        decision: makeDecision({ habit_match: false }),
      }));

      const matchTrue = await store.query({ filter: { habit_match: true } });
      expect(matchTrue).toHaveLength(1);
      expect(matchTrue[0].id).toBe('habit-yes');

      const matchFalse = await store.query({ filter: { habit_match: false } });
      expect(matchFalse).toHaveLength(1);
      expect(matchFalse[0].id).toBe('habit-no');
    });

    it('combines multiple filter criteria', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({
        id: 'match',
        decision: makeDecision({ provider: 'openai', plugin_id: 'cost-aware' }),
      }));
      await store.append(makeEntry({
        id: 'provider-only',
        decision: makeDecision({ provider: 'openai', plugin_id: 'quality-first' }),
      }));
      await store.append(makeEntry({
        id: 'plugin-only',
        decision: makeDecision({ provider: 'anthropic', plugin_id: 'cost-aware' }),
      }));

      const result = await store.query({
        filter: { provider: 'openai', plugin_id: 'cost-aware' },
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('match');
    });

    it('applies limit', async () => {
      const store = new InMemoryAuditStore();
      for (let i = 0; i < 10; i++) {
        await store.append(makeEntry({ id: `e-${i}` }));
      }

      const result = await store.query({ limit: 3 });

      expect(result).toHaveLength(3);
    });

    it('defaults limit to 100', async () => {
      const store = new InMemoryAuditStore();
      for (let i = 0; i < 150; i++) {
        await store.append(makeEntry({ id: `e-${i}` }));
      }

      const result = await store.query({});

      expect(result).toHaveLength(100);
    });

    it('returns empty array when no entries match', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({
        decision: makeDecision({ provider: 'openai' }),
      }));

      const result = await store.query({ filter: { provider: 'anthropic' } });

      expect(result).toEqual([]);
    });
  });

  describe('count()', () => {
    it('returns total count when no filter is given', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry());
      await store.append(makeEntry());
      await store.append(makeEntry());

      expect(await store.count()).toBe(3);
    });

    it('returns 0 for empty store', async () => {
      const store = new InMemoryAuditStore();

      expect(await store.count()).toBe(0);
    });

    it('returns filtered count when filter is given', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({
        decision: makeDecision({ provider: 'openai' }),
      }));
      await store.append(makeEntry({
        decision: makeDecision({ provider: 'anthropic' }),
      }));
      await store.append(makeEntry({
        decision: makeDecision({ provider: 'openai' }),
      }));

      expect(await store.count({ provider: 'openai' })).toBe(2);
      expect(await store.count({ provider: 'anthropic' })).toBe(1);
      expect(await store.count({ provider: 'google' })).toBe(0);
    });
  });

  describe('bounded size', () => {
    it('evicts oldest entries when maxEntries is exceeded', async () => {
      const store = new InMemoryAuditStore(3);

      await store.append(makeEntry({ id: 'e1' }));
      await store.append(makeEntry({ id: 'e2' }));
      await store.append(makeEntry({ id: 'e3' }));
      await store.append(makeEntry({ id: 'e4' }));

      const all = store.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].id).toBe('e2');
      expect(all[1].id).toBe('e3');
      expect(all[2].id).toBe('e4');
    });

    it('keeps exactly maxEntries after many appends', async () => {
      const store = new InMemoryAuditStore(5);

      for (let i = 0; i < 20; i++) {
        await store.append(makeEntry({ id: `e-${i}` }));
      }

      const all = store.getAll();
      expect(all).toHaveLength(5);
      expect(all[0].id).toBe('e-15');
      expect(all[4].id).toBe('e-19');
    });
  });

  describe('flush()', () => {
    it('is a no-op and resolves without error', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({ id: 'x' }));

      await expect(store.flush()).resolves.toBeUndefined();

      // Entries are unaffected
      expect(store.getAll()).toHaveLength(1);
    });
  });

  describe('dispose()', () => {
    it('clears all entries', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry());
      await store.append(makeEntry());
      expect(store.getAll()).toHaveLength(2);

      await store.dispose();

      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('getAll()', () => {
    it('returns a copy, not the internal array', async () => {
      const store = new InMemoryAuditStore();
      await store.append(makeEntry({ id: 'original' }));

      const copy = store.getAll();
      copy.push(makeEntry({ id: 'injected' }));

      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].id).toBe('original');
    });
  });
});

// ── RouterAuditLog ───────────────────────────────────────────────

describe('RouterAuditLog', () => {
  describe('record()', () => {
    it('creates an entry with correct fields', async () => {
      const audit = new RouterAuditLog();
      const decision = makeDecision({ slug: 'anthropic/claude-sonnet', provider: 'anthropic' });
      const intent = makeIntent({ effort: 'medium', cost_sensitivity: 'high' });

      const entry = await audit.record(decision, intent, { caller_id: 'test-user' });

      expect(entry.decision).toEqual(decision);
      expect(entry.intent).toEqual(intent);
      expect(entry.context).toEqual({ caller_id: 'test-user' });
    });

    it('generates unique IDs', async () => {
      const audit = new RouterAuditLog();
      const decision = makeDecision();
      const intent = makeIntent();

      const e1 = await audit.record(decision, intent);
      const e2 = await audit.record(decision, intent);
      const e3 = await audit.record(decision, intent);

      const ids = new Set([e1.id, e2.id, e3.id]);
      expect(ids.size).toBe(3);
    });

    it('generates IDs with the aud_ prefix', async () => {
      const audit = new RouterAuditLog();
      const entry = await audit.record(makeDecision(), makeIntent());

      expect(entry.id).toMatch(/^aud_\d+_\d+$/);
    });

    it('includes an ISO 8601 timestamp', async () => {
      const audit = new RouterAuditLog();
      const before = new Date().toISOString();

      const entry = await audit.record(makeDecision(), makeIntent());

      const after = new Date().toISOString();
      expect(entry.timestamp).toBeTruthy();
      expect(entry.timestamp >= before).toBe(true);
      expect(entry.timestamp <= after).toBe(true);
    });

    it('context fields are optional', async () => {
      const audit = new RouterAuditLog();

      const noContext = await audit.record(makeDecision(), makeIntent());
      expect(noContext.context).toBeUndefined();

      const emptyContext = await audit.record(makeDecision(), makeIntent(), {});
      expect(emptyContext.context).toEqual({});

      const partialContext = await audit.record(makeDecision(), makeIntent(), {
        caller_id: 'user-1',
      });
      expect(partialContext.context?.caller_id).toBe('user-1');
      expect(partialContext.context?.request_id).toBeUndefined();
      expect(partialContext.context?.metadata).toBeUndefined();
    });

    it('includes metadata when provided', async () => {
      const audit = new RouterAuditLog();
      const metadata = { env: 'production', version: '1.2.3' };

      const entry = await audit.record(makeDecision(), makeIntent(), {
        caller_id: 'svc',
        request_id: 'req-42',
        metadata,
      });

      expect(entry.context?.metadata).toEqual(metadata);
      expect(entry.context?.request_id).toBe('req-42');
    });
  });

  describe('query()', () => {
    it('delegates to the underlying store', async () => {
      const store = new InMemoryAuditStore();
      const audit = new RouterAuditLog(store);

      await audit.record(makeDecision({ provider: 'openai' }), makeIntent());
      await audit.record(makeDecision({ provider: 'anthropic' }), makeIntent());

      const result = await audit.query({ filter: { provider: 'openai' } });

      expect(result).toHaveLength(1);
      expect(result[0].decision.provider).toBe('openai');
    });

    it('defaults to empty options', async () => {
      const audit = new RouterAuditLog();
      await audit.record(makeDecision(), makeIntent());

      const result = await audit.query();

      expect(result).toHaveLength(1);
    });
  });

  describe('count()', () => {
    it('delegates to the underlying store', async () => {
      const store = new InMemoryAuditStore();
      const audit = new RouterAuditLog(store);

      await audit.record(makeDecision({ provider: 'openai' }), makeIntent());
      await audit.record(makeDecision({ provider: 'anthropic' }), makeIntent());

      expect(await audit.count()).toBe(2);
      expect(await audit.count({ provider: 'openai' })).toBe(1);
    });
  });

  describe('flush()', () => {
    it('calls store.flush()', async () => {
      const store = new InMemoryAuditStore();
      const audit = new RouterAuditLog(store);

      // Should not throw
      await expect(audit.flush()).resolves.toBeUndefined();
    });
  });

  describe('dispose()', () => {
    it('calls flush then dispose on the store', async () => {
      const store = new InMemoryAuditStore();
      const audit = new RouterAuditLog(store);

      await audit.record(makeDecision(), makeIntent());
      expect(store.getAll()).toHaveLength(1);

      await audit.dispose();

      // dispose clears the InMemoryAuditStore
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('default store', () => {
    it('uses InMemoryAuditStore when no store is provided', async () => {
      const audit = new RouterAuditLog();

      expect(audit.store).toBeInstanceOf(InMemoryAuditStore);
    });

    it('works end-to-end with the default store', async () => {
      const audit = new RouterAuditLog();

      await audit.record(
        makeDecision({ provider: 'openai', model: 'gpt-4o' }),
        makeIntent({ effort: 'high' }),
        { caller_id: 'integration-test' },
      );
      await audit.record(
        makeDecision({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
        makeIntent({ effort: 'low' }),
      );

      expect(await audit.count()).toBe(2);

      const openaiOnly = await audit.query({ filter: { provider: 'openai' } });
      expect(openaiOnly).toHaveLength(1);
      expect(openaiOnly[0].decision.model).toBe('gpt-4o');
      expect(openaiOnly[0].context?.caller_id).toBe('integration-test');
    });
  });
});
