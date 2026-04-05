/**
 * @maestro/router — RouterRegistry.
 *
 * Plugin lifecycle manager. Registers plugins by name, resolves the
 * active plugin, manages fallback chains, supports dynamic loading
 * via `await import()`. Same pattern as @maestro/sandbox and @maestro/db.
 */

import type { RouterPlugin, PluginLoaderRegistry } from './types.js';
import { PluginNotFoundError, PluginInitError, FallbackExhaustedError } from './errors.js';
import { PluginPolicyManager, type ResilienceOptions } from './resilience.js';

export class RouterRegistry {
  private readonly plugins = new Map<string, RouterPlugin>();
  private readonly loaders: PluginLoaderRegistry;
  readonly resilience: PluginPolicyManager;

  constructor(loaders: PluginLoaderRegistry = {}, resilienceOptions?: ResilienceOptions) {
    this.loaders = loaders;
    this.resilience = new PluginPolicyManager(resilienceOptions);
  }

  /** Register an already-instantiated plugin. */
  register(plugin: RouterPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * Get a plugin by ID.
   *
   * If the plugin is registered, returns it. Otherwise, attempts
   * to dynamically load it from the loader registry.
   */
  async get(id: string): Promise<RouterPlugin> {
    const existing = this.plugins.get(id);
    if (existing) return existing;

    const loader = this.loaders[id];
    if (!loader) throw new PluginNotFoundError(id);

    const mod = await loader();
    const plugin = mod.default;
    this.plugins.set(plugin.id, plugin);
    return plugin;
  }

  /**
   * Initialize a plugin with config.
   *
   * Loads the plugin if needed, calls initialize() with the config,
   * and registers it. Throws PluginInitError on failure.
   */
  async initialize(id: string, config: Record<string, unknown> = {}): Promise<RouterPlugin> {
    const plugin = await this.get(id);
    if (plugin.initialize) {
      try {
        await plugin.initialize(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new PluginInitError(id, message);
      }
    }
    return plugin;
  }

  /** The DirectPlugin fallback — always available. */
  async fallback(): Promise<RouterPlugin> {
    return this.get('direct');
  }

  /** List all registered (loaded) plugins. */
  list(): RouterPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** List all available plugin IDs (registered + loadable). */
  availableIds(): string[] {
    const ids = new Set<string>([
      ...this.plugins.keys(),
      ...Object.keys(this.loaders),
    ]);
    return Array.from(ids);
  }

  /**
   * Resolve with fallback chain.
   *
   * Tries the primary plugin, then the fallback. If both fail,
   * throws FallbackExhaustedError.
   */
  async resolve(primaryId: string, fallbackId: string = 'direct'): Promise<RouterPlugin> {
    let primaryError: string | undefined;
    let fallbackError: string | undefined;

    try {
      const primary = await this.get(primaryId);
      if (await primary.healthy()) return primary;
      primaryError = `'${primaryId}' loaded but unhealthy`;
    } catch (err) {
      primaryError = `'${primaryId}' failed to load: ${err instanceof Error ? err.message : String(err)}`;
    }

    try {
      const fb = await this.get(fallbackId);
      if (await fb.healthy()) return fb;
      fallbackError = `'${fallbackId}' loaded but unhealthy`;
    } catch (err) {
      fallbackError = `'${fallbackId}' failed to load: ${err instanceof Error ? err.message : String(err)}`;
    }

    throw new FallbackExhaustedError(
      [primaryId, fallbackId],
      new Error(`${primaryError}; ${fallbackError}`),
    );
  }

  /** Dispose all registered plugins and reset resilience policies. */
  async disposeAll(): Promise<void> {
    const disposals = this.list().map(async (p) => {
      if (p.dispose) await p.dispose();
    });
    await Promise.allSettled(disposals);
    this.plugins.clear();
    this.resilience.reset();
  }
}
