/**
 * @maestro/router — Error types.
 */

import type { SpawnIntent } from './types.js';

// ── Base Error ─────────────────────────────────────────────────────

export class RouterError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'RouterError';
  }
}

// ── Plugin Errors ──────────────────────────────────────────────────

export class PluginNotFoundError extends RouterError {
  constructor(public readonly pluginId: string) {
    super(
      `Routing plugin '${pluginId}' not registered. Available plugins can be listed via registry.list().`,
      'PLUGIN_NOT_FOUND',
    );
    this.name = 'PluginNotFoundError';
  }
}

export class PluginInitError extends RouterError {
  constructor(
    public readonly pluginId: string,
    reason: string,
  ) {
    super(
      `Failed to initialize router plugin '${pluginId}': ${reason}`,
      'PLUGIN_INIT_ERROR',
    );
    this.name = 'PluginInitError';
  }
}

export class PluginUnhealthyError extends RouterError {
  constructor(public readonly pluginId: string) {
    super(
      `Router plugin '${pluginId}' is unhealthy and cannot fulfill requests.`,
      'PLUGIN_UNHEALTHY',
    );
    this.name = 'PluginUnhealthyError';
  }
}

// ── Selection Errors ───────────────────────────────────────────────

export class NoModelAvailableError extends RouterError {
  constructor(
    public readonly intent: SpawnIntent,
    reason?: string,
  ) {
    const requires = intent.requires?.join(', ') ?? 'none';
    super(
      reason
        ? `No model available: ${reason}`
        : `No model available meeting requirements: [${requires}] at effort=${intent.effort}, cost_sensitivity=${intent.cost_sensitivity}`,
      'NO_MODEL_AVAILABLE',
    );
    this.name = 'NoModelAvailableError';
  }
}

export class SelectionError extends RouterError {
  constructor(
    public readonly pluginId: string,
    reason: string,
  ) {
    super(
      `Selection failed in plugin '${pluginId}': ${reason}`,
      'SELECTION_ERROR',
    );
    this.name = 'SelectionError';
  }
}

// ── Fallback Errors ────────────────────────────────────────────────

export class FallbackExhaustedError extends RouterError {
  constructor(
    public readonly attempted: string[],
    public readonly lastError: Error,
  ) {
    super(
      `All router plugins exhausted (tried: ${attempted.join(' → ')}). Last error: ${lastError.message}`,
      'FALLBACK_EXHAUSTED',
    );
    this.name = 'FallbackExhaustedError';
  }
}
