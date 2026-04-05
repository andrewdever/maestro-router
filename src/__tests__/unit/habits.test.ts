/**
 * @maestro/router — HabitMatcher unit tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SpawnIntent } from '../../types.js';
import { HabitMatcher, type HabitDefinition } from '../../habits.js';

// ── Tests ────────────────────────────────────────────────────────

describe('HabitMatcher', () => {
  let matcher: HabitMatcher;

  beforeEach(() => {
    matcher = new HabitMatcher();
  });

  // ── match() with no habits ───────────────────────────────────

  it('match() returns null when no habits are registered', () => {
    const intent: SpawnIntent = { effort: 'standard', cost_sensitivity: 'normal' };
    const result = matcher.match(intent, 'some task context');
    expect(result).toBeNull();
  });

  // ── match() with matching trigger ────────────────────────────

  it('match() returns a HabitMatch when trigger matches task context', () => {
    const habit: HabitDefinition = {
      slug: 'format-code',
      handler: 'handlers/format.ts',
      triggers: ['format', 'prettier', 'lint fix'],
    };
    matcher.register(habit);

    const intent: SpawnIntent = { effort: 'minimal', cost_sensitivity: 'normal' };
    const result = matcher.match(intent, 'please format this file');

    expect(result).not.toBeNull();
    expect(result!.habit_slug).toBe('format-code');
    expect(result!.handler).toBe('handlers/format.ts');
    expect(result!.confidence).toBe(1.0);
  });

  // ── match() is case-insensitive ──────────────────────────────

  it('match() is case-insensitive for triggers and context', () => {
    matcher.register({
      slug: 'test-runner',
      handler: 'handlers/test.ts',
      triggers: ['run tests'],
    });

    const intent: SpawnIntent = { effort: 'minimal', cost_sensitivity: 'normal' };
    const result = matcher.match(intent, 'RUN TESTS for this module');

    expect(result).not.toBeNull();
    expect(result!.habit_slug).toBe('test-runner');
  });

  // ── match() returns null when no trigger matches ─────────────

  it('match() returns null when no trigger matches the context', () => {
    matcher.register({
      slug: 'deploy',
      handler: 'handlers/deploy.ts',
      triggers: ['deploy', 'ship it'],
    });

    const intent: SpawnIntent = { effort: 'standard', cost_sensitivity: 'normal' };
    const result = matcher.match(intent, 'refactor the database module');

    expect(result).toBeNull();
  });

  // ── match() returns null with no task context ────────────────

  it('match() returns null when no task context is provided', () => {
    matcher.register({
      slug: 'deploy',
      handler: 'handlers/deploy.ts',
      triggers: ['deploy'],
    });

    const intent: SpawnIntent = { effort: 'standard', cost_sensitivity: 'normal' };
    const result = matcher.match(intent);

    expect(result).toBeNull();
  });

  // ── match() respects capability requirements ─────────────────

  it('match() skips habits that do not cover all required capabilities', () => {
    matcher.register({
      slug: 'simple-format',
      handler: 'handlers/format.ts',
      triggers: ['format'],
      capabilities: ['code'],
    });

    const intent: SpawnIntent = {
      effort: 'minimal',
      cost_sensitivity: 'normal',
      requires: ['code', 'vision'],
    };
    const result = matcher.match(intent, 'format this file');

    // Habit only handles 'code', not 'vision' — should not match
    expect(result).toBeNull();
  });

  it('match() matches when habit covers all required capabilities', () => {
    matcher.register({
      slug: 'full-format',
      handler: 'handlers/format.ts',
      triggers: ['format'],
      capabilities: ['code', 'vision'],
    });

    const intent: SpawnIntent = {
      effort: 'minimal',
      cost_sensitivity: 'normal',
      requires: ['code', 'vision'],
    };
    const result = matcher.match(intent, 'format this file');

    expect(result).not.toBeNull();
    expect(result!.habit_slug).toBe('full-format');
  });

  it('match() matches when habit has no capability constraint', () => {
    matcher.register({
      slug: 'universal-format',
      handler: 'handlers/format.ts',
      triggers: ['format'],
      // No capabilities defined — accepts any
    });

    const intent: SpawnIntent = {
      effort: 'minimal',
      cost_sensitivity: 'normal',
      requires: ['code', 'thinking'],
    };
    const result = matcher.match(intent, 'format this file');

    expect(result).not.toBeNull();
  });

  // ── toSelection() ────────────────────────────────────────────

  it('toSelection() returns the correct habit slug format', () => {
    const selection = matcher.toSelection({
      habit_slug: 'format-code',
      handler: 'handlers/format.ts',
      confidence: 1.0,
    });

    expect(selection.router).toBe('habit');
    expect(selection.provider).toBe('local');
    expect(selection.harness).toBe('none');
    expect(selection.model).toBe('none');
    expect(selection.config).toBe('effort:zero');
    expect(selection.estimated_cost).toBe(0);
    expect(selection.rationale).toContain('format-code');
  });

  // ── register() and list() ────────────────────────────────────

  it('register() adds habits and list() returns them', () => {
    matcher.register({
      slug: 'a',
      handler: 'a.ts',
      triggers: ['alpha'],
    });
    matcher.register({
      slug: 'b',
      handler: 'b.ts',
      triggers: ['beta'],
    });

    const habits = matcher.list();
    expect(habits).toHaveLength(2);
    expect(habits.map((h) => h.slug)).toEqual(['a', 'b']);
  });

  // ── clear() ──────────────────────────────────────────────────

  it('clear() removes all registered habits', () => {
    matcher.register({
      slug: 'a',
      handler: 'a.ts',
      triggers: ['alpha'],
    });
    matcher.register({
      slug: 'b',
      handler: 'b.ts',
      triggers: ['beta'],
    });

    matcher.clear();

    expect(matcher.list()).toHaveLength(0);
    const result = matcher.match(
      { effort: 'standard', cost_sensitivity: 'normal' },
      'alpha beta',
    );
    expect(result).toBeNull();
  });

  // ── registerAll() ────────────────────────────────────────────

  it('registerAll() adds multiple habits at once', () => {
    matcher.registerAll([
      { slug: 'x', handler: 'x.ts', triggers: ['x-trigger'] },
      { slug: 'y', handler: 'y.ts', triggers: ['y-trigger'] },
    ]);

    expect(matcher.list()).toHaveLength(2);
  });
});
