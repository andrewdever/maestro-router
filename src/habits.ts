/**
 * @maestro/router — Habit matching.
 *
 * Habits are knowledge entities with priority: 1, weight: 1.00 that
 * represent known solutions the orchestra already has code for.
 *
 * If a habit matches the task, the router short-circuits entirely —
 * no tokens spent, no provider API call, no model invoked.
 * The resolution chain becomes: habit-local-none-none-effort:zero
 *
 * This is a router-core concern, not a plugin concern.
 * Habits are checked BEFORE any RouterPlugin.select() call.
 * All plugins benefit from habit routing.
 *
 * Per signals spec principle P5:
 *   "Habits (known solutions) route before AI scoring."
 */

import type { SpawnIntent, ModelSelection, HabitMatch } from './types.js';

// ── Habit Definition ───────────────────────────────────────────────

/** A registered habit with its matcher and handler. */
export interface HabitDefinition {
  /** Unique habit entity slug. */
  slug: string;
  /** Local handler function or code path. */
  handler: string;
  /** Keywords or patterns that trigger this habit. */
  triggers: string[];
  /** Required capabilities the habit handles (must match intent.requires). */
  capabilities?: string[];
}

// ── Habit Matcher ──────────────────────────────────────────────────

/**
 * The habit matcher.
 *
 * Evaluates registered habits against a SpawnIntent.
 * On match, returns a HabitMatch; otherwise returns null.
 */
export class HabitMatcher {
  private habits: HabitDefinition[] = [];

  /** Register a habit. */
  register(habit: HabitDefinition): void {
    this.habits.push(habit);
  }

  /** Register multiple habits at once. */
  registerAll(habits: HabitDefinition[]): void {
    this.habits.push(...habits);
  }

  /** Clear all registered habits. */
  clear(): void {
    this.habits = [];
  }

  /** List registered habits. */
  list(): readonly HabitDefinition[] {
    return this.habits;
  }

  /**
   * Try to match a SpawnIntent against registered habits.
   *
   * Returns the best HabitMatch if a habit can handle the intent,
   * or null if no habit matches. Matching considers:
   * - Trigger keywords (any match in task context)
   * - Capability requirements (habit must handle all required caps)
   */
  match(intent: SpawnIntent, taskContext?: string): HabitMatch | null {
    if (this.habits.length === 0) return null;

    for (const habit of this.habits) {
      // If the intent requires capabilities the habit doesn't handle, skip
      if (intent.requires && habit.capabilities) {
        const unmet = intent.requires.filter(r => !habit.capabilities!.includes(r));
        if (unmet.length > 0) continue;
      }

      // Check triggers against task context
      if (taskContext) {
        const lower = taskContext.toLowerCase();
        const matched = habit.triggers.some(t => lower.includes(t.toLowerCase()));
        if (matched) {
          return {
            habit_slug: habit.slug,
            handler: habit.handler,
            confidence: 1.0,
          };
        }
      }
    }

    return null;
  }

  /**
   * Create the short-circuit ModelSelection for a habit match.
   *
   * Slug: habit-local-none-none-effort:zero
   */
  toSelection(match: HabitMatch): ModelSelection {
    return {
      router: 'habit',
      provider: 'local',
      harness: 'none',
      model: 'none',
      config: 'effort:zero',
      estimated_cost: 0,
      rationale: `Habit match: ${match.habit_slug} (confidence: ${match.confidence})`,
      quality_score: match.confidence,
    };
  }
}
