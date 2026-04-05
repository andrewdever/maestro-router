/**
 * @maestro/router — Main router.
 *
 * Orchestrates the full routing flow:
 *   1. Check habits (local-first, zero tokens)
 *   2. Resolve plugin (primary → fallback)
 *   3. Call plugin.select(intent)
 *   4. Return ModelSelection with canonical slug
 *
 * This is the entry point for the orchestrator.
 */

import type { SpawnIntent, ModelSelection, RoutingConfig } from './types.js';
import { toSlug } from './types.js';
import { RouterRegistry } from './registry.js';
import { HabitMatcher } from './habits.js';
import { ROUTER_PLUGINS } from './plugins/registry.js';
import { FallbackExhaustedError } from './errors.js';
import { type ResilienceOptions } from './resilience.js';
import { withSpan, withSpanSync, RouterAttributes } from './tracing.js';
import { RouterAuditLog, type AuditStore } from './audit.js';

// ── Router Options ─────────────────────────────────────────────────

export interface RouterOptions {
  /** Routing configuration. */
  config?: RoutingConfig;
  /** Pre-built registry (for testing or custom setups). */
  registry?: RouterRegistry;
  /** Pre-built habit matcher. */
  habits?: HabitMatcher;
  /** Resilience options for plugin calls (circuit breaker, retry, backoff). */
  resilience?: ResilienceOptions;
  /** Audit store for recording routing decisions. Omit to disable auditing. */
  auditStore?: AuditStore;
}

// ── Router Result ──────────────────────────────────────────────────

export interface RouteResult {
  /** The routing selection. */
  selection: ModelSelection;
  /** Canonical slug: router-provider-harness-model-config. */
  slug: string;
  /** Whether this was a habit match (zero tokens). */
  habit_match: boolean;
  /** Plugin ID that produced the selection. */
  resolved_plugin: string;
  /** Whether the fallback plugin was used. */
  used_fallback: boolean;
}

// ── Router ─────────────────────────────────────────────────────────

/**
 * The main Maestro router.
 *
 * Usage:
 * ```typescript
 * const router = new Router({ config: { plugin: 'maestro' } });
 * await router.initialize();
 * const result = await router.route(intent);
 * console.log(result.slug); // maestro-anthropic-api-opus-4-6-effort:deep
 * ```
 */
export class Router {
  readonly registry: RouterRegistry;
  readonly habits: HabitMatcher;
  readonly audit: RouterAuditLog | null;
  private readonly config: Required<RoutingConfig>;
  private initialized = false;

  constructor(options: RouterOptions = {}) {
    this.registry = options.registry ?? new RouterRegistry(ROUTER_PLUGINS, options.resilience);
    this.habits = options.habits ?? new HabitMatcher();
    this.audit = options.auditStore ? new RouterAuditLog(options.auditStore) : null;
    this.config = {
      plugin: options.config?.plugin ?? 'direct',
      fallback: options.config?.fallback ?? 'direct',
      config: options.config?.config ?? {},
    };
  }

  /**
   * Initialize the router and its configured plugin.
   *
   * Loads and initializes the primary plugin. If it fails,
   * logs a warning and falls through to the fallback at route time.
   */
  async initialize(): Promise<void> {
    try {
      await this.registry.initialize(this.config.plugin, this.config.config);
    } catch {
      // Primary plugin failed to init — will fall back at route time.
      // This is by design: DirectPlugin is always available.
    }

    // Ensure fallback is loadable (but don't fail if it's not ready)
    if (this.config.fallback !== this.config.plugin) {
      try {
        await this.registry.get(this.config.fallback);
      } catch {
        // Fallback will be loaded on demand
      }
    }

    this.initialized = true;
  }

  /**
   * Route a SpawnIntent to a ModelSelection.
   *
   * Flow:
   *   1. Check habits — if matched, return immediately (zero tokens)
   *   2. Resolve plugin (primary → fallback via registry)
   *   3. Call plugin.select(intent)
   *   4. Return RouteResult with canonical slug
   */
  async route(intent: SpawnIntent, taskContext?: string): Promise<RouteResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    return withSpan('router.route', {
      [RouterAttributes.EFFORT]: intent.effort,
      [RouterAttributes.COST_SENSITIVITY]: intent.cost_sensitivity,
      ...(intent.requires?.length ? { [RouterAttributes.REQUIRES]: intent.requires } : {}),
      ...(intent.prefer_provider ? { [RouterAttributes.PREFER_PROVIDER]: intent.prefer_provider } : {}),
    }, async (routeSpan) => {
      // Step 1: Habit check — local-first, zero tokens
      const habitMatch = withSpanSync('router.habit_check', {
        [RouterAttributes.EFFORT]: intent.effort,
      }, () => this.habits.match(intent, taskContext));

      if (habitMatch) {
        const selection = this.habits.toSelection(habitMatch);
        const result: RouteResult = {
          selection,
          slug: toSlug(selection),
          habit_match: true,
          resolved_plugin: 'habit',
          used_fallback: false,
        };
        routeSpan?.setAttributes({
          [RouterAttributes.HABIT_MATCH]: true,
          [RouterAttributes.HABIT_SLUG]: habitMatch.habit_slug,
          [RouterAttributes.SLUG]: result.slug,
        });

        // Record habit match to audit log
        if (this.audit) {
          this.audit.record(
            {
              slug: result.slug,
              plugin_id: 'habit',
              provider: selection.provider,
              model: selection.model,
              used_fallback: false,
              habit_match: true,
              estimated_cost: selection.estimated_cost,
              quality_score: selection.quality_score,
            },
            {
              effort: intent.effort,
              cost_sensitivity: intent.cost_sensitivity,
              requires: intent.requires,
              prefer_provider: intent.prefer_provider,
            },
          ).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Router] Audit write failed (non-blocking): ${msg}`);
          });
        }

        return result;
      }

      // Step 2: Resolve plugin with fallback
      let usedFallback = false;
      let resolvedPluginId = this.config.plugin;

      const plugin = await withSpan('router.resolve_plugin', {
        [RouterAttributes.PLUGIN_ID]: this.config.plugin,
      }, async () => {
        return this.registry.resolve(this.config.plugin, this.config.fallback);
      });

      if (plugin.id !== this.config.plugin) {
        usedFallback = true;
        resolvedPluginId = plugin.id;
      }

      // Step 3: Select model (through resilience policy: retry + circuit breaker)
      const selection = await withSpan('router.select', {
        [RouterAttributes.PLUGIN_ID]: resolvedPluginId,
        [RouterAttributes.EFFORT]: intent.effort,
        [RouterAttributes.COST_SENSITIVITY]: intent.cost_sensitivity,
      }, async (selectSpan) => {
        const sel = await this.registry.resilience.execute(
          resolvedPluginId,
          () => plugin.select(intent),
        );
        selectSpan?.setAttributes({
          [RouterAttributes.SELECTED_MODEL]: sel.model,
          [RouterAttributes.SELECTED_PROVIDER]: sel.provider,
          [RouterAttributes.BREAKER_STATE]: this.registry.resilience.isOpen(resolvedPluginId) ? 'open' : 'closed',
          ...(sel.estimated_cost !== undefined ? { [RouterAttributes.ESTIMATED_COST]: sel.estimated_cost } : {}),
          ...(sel.quality_score !== undefined ? { [RouterAttributes.QUALITY_SCORE]: sel.quality_score } : {}),
        });
        return sel;
      });

      // Step 4: Return result with slug
      const result: RouteResult = {
        selection,
        slug: toSlug(selection),
        habit_match: false,
        resolved_plugin: resolvedPluginId,
        used_fallback: usedFallback,
      };

      routeSpan?.setAttributes({
        [RouterAttributes.HABIT_MATCH]: false,
        [RouterAttributes.SLUG]: result.slug,
        [RouterAttributes.USED_FALLBACK]: usedFallback,
        [RouterAttributes.PLUGIN_ID]: resolvedPluginId,
      });

      // Record to audit log (fire-and-forget — audit failures must not block routing)
      if (this.audit) {
        this.audit.record(
          {
            slug: result.slug,
            plugin_id: result.resolved_plugin,
            provider: selection.provider,
            model: selection.model,
            used_fallback: result.used_fallback,
            habit_match: false,
            estimated_cost: selection.estimated_cost,
            quality_score: selection.quality_score,
          },
          {
            effort: intent.effort,
            cost_sensitivity: intent.cost_sensitivity,
            requires: intent.requires,
            prefer_provider: intent.prefer_provider,
          },
        ).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Router] Audit write failed (non-blocking): ${msg}`);
          });
      }

      return result;
    });
  }

  /** Dispose the router and all loaded plugins. */
  async dispose(): Promise<void> {
    if (this.audit) await this.audit.dispose();
    await this.registry.disposeAll();
    this.initialized = false;
  }
}
