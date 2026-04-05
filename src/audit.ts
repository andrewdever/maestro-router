/**
 * @maestro/router — Audit log for routing decisions.
 *
 * Records every routing decision with full context for compliance,
 * debugging, and cost analysis. Supports pluggable storage backends
 * via the AuditStore interface.
 *
 * Default: InMemoryAuditStore (development/testing).
 * Production: implement AuditStore backed by your database or log aggregator.
 */

// ── Audit Entry ───────────────────────────────────────────────────

export interface AuditEntry {
  /** Unique entry ID. */
  id: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** The routing decision result. */
  decision: {
    /** Selected model slug. */
    slug: string;
    /** Router plugin that made the selection. */
    plugin_id: string;
    /** Selected provider. */
    provider: string;
    /** Selected model. */
    model: string;
    /** Whether a fallback was used. */
    used_fallback: boolean;
    /** Whether this was a habit match. */
    habit_match: boolean;
    /** Estimated cost (USD). */
    estimated_cost?: number;
    /** Quality score (0-1). */
    quality_score?: number;
  };
  /** The original intent that triggered routing. */
  intent: {
    effort: string;
    cost_sensitivity: string;
    requires?: string[];
    prefer_provider?: string;
  };
  /** Optional context from the caller. */
  context?: {
    /** User or service making the request. */
    caller_id?: string;
    /** Task or request ID for correlation. */
    request_id?: string;
    /** Additional metadata. */
    metadata?: Record<string, unknown>;
  };
}

// ── Audit Store Interface ─────────────────────────────────────────

/**
 * Pluggable storage backend for audit entries.
 *
 * Implement this interface to store audit logs in your preferred backend:
 * - Database (SQLite, PostgreSQL, etc.)
 * - Log aggregator (Elasticsearch, Loki, etc.)
 * - File system (JSONL rotation)
 * - Cloud (S3, GCS, etc.)
 */
export interface AuditStore {
  /** Append an entry to the audit log. */
  append(entry: AuditEntry): Promise<void>;
  /** Query entries by time range. Returns newest first. */
  query(options: AuditQueryOptions): Promise<AuditEntry[]>;
  /** Count entries matching a filter. */
  count(filter?: AuditFilter): Promise<number>;
  /** Flush any buffered entries (for batch writers). */
  flush?(): Promise<void>;
  /** Dispose the store (close connections, etc.). */
  dispose?(): Promise<void>;
}

export interface AuditQueryOptions {
  /** Start of time range (ISO 8601). */
  since?: string;
  /** End of time range (ISO 8601). */
  until?: string;
  /** Max entries to return. Default: 100. */
  limit?: number;
  /** Filter criteria. */
  filter?: AuditFilter;
}

export interface AuditFilter {
  /** Filter by plugin ID. */
  plugin_id?: string;
  /** Filter by provider. */
  provider?: string;
  /** Filter by model. */
  model?: string;
  /** Filter by caller. */
  caller_id?: string;
  /** Filter by habit match. */
  habit_match?: boolean;
}

// ── In-Memory Store ───────────────────────────────────────────────

/**
 * In-memory audit store for development and testing.
 *
 * Stores entries in a bounded array with automatic eviction of oldest entries.
 * NOT suitable for production — entries are lost on process restart.
 */
export class InMemoryAuditStore implements AuditStore {
  private entries: AuditEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries: number = 10_000) {
    this.maxEntries = maxEntries;
  }

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  async query(options: AuditQueryOptions): Promise<AuditEntry[]> {
    let result = [...this.entries];

    if (options.since) {
      result = result.filter(e => e.timestamp >= options.since!);
    }
    if (options.until) {
      result = result.filter(e => e.timestamp <= options.until!);
    }
    if (options.filter) {
      result = this.applyFilter(result, options.filter);
    }

    // Newest first
    result.reverse();

    return result.slice(0, options.limit ?? 100);
  }

  async count(filter?: AuditFilter): Promise<number> {
    if (!filter) return this.entries.length;
    return this.applyFilter(this.entries, filter).length;
  }

  async flush(): Promise<void> {
    // No-op for in-memory store
  }

  async dispose(): Promise<void> {
    this.entries = [];
  }

  /** Get all entries (for testing). */
  getAll(): AuditEntry[] {
    return [...this.entries];
  }

  private applyFilter(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
    return entries.filter(e => {
      if (filter.plugin_id && e.decision.plugin_id !== filter.plugin_id) return false;
      if (filter.provider && e.decision.provider !== filter.provider) return false;
      if (filter.model && e.decision.model !== filter.model) return false;
      if (filter.caller_id && e.context?.caller_id !== filter.caller_id) return false;
      if (filter.habit_match !== undefined && e.decision.habit_match !== filter.habit_match) return false;
      return true;
    });
  }
}

// ── Audit Logger ──────────────────────────────────────────────────

let idCounter = 0;

/**
 * Generate a unique audit entry ID.
 * Format: `aud_{timestamp}_{counter}`
 */
function generateId(): string {
  return `aud_${Date.now()}_${++idCounter}`;
}

/**
 * Router audit logger.
 *
 * Wraps an AuditStore and provides convenience methods for recording
 * routing decisions. Designed to be integrated into the Router class.
 *
 * Usage:
 * ```typescript
 * const audit = new RouterAuditLog();
 * // After each route() call:
 * await audit.record(routeResult, intent, { caller_id: 'orchestrator' });
 * // Query recent decisions:
 * const recent = await audit.query({ limit: 10 });
 * ```
 */
export class RouterAuditLog {
  readonly store: AuditStore;

  constructor(store?: AuditStore) {
    this.store = store ?? new InMemoryAuditStore();
  }

  /**
   * Record a routing decision.
   */
  async record(
    decision: {
      slug: string;
      plugin_id: string;
      provider: string;
      model: string;
      used_fallback: boolean;
      habit_match: boolean;
      estimated_cost?: number;
      quality_score?: number;
    },
    intent: {
      effort: string;
      cost_sensitivity: string;
      requires?: string[];
      prefer_provider?: string;
    },
    context?: {
      caller_id?: string;
      request_id?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      decision,
      intent,
      context,
    };

    await this.store.append(entry);
    return entry;
  }

  /**
   * Query audit entries.
   */
  async query(options: AuditQueryOptions = {}): Promise<AuditEntry[]> {
    return this.store.query(options);
  }

  /**
   * Count audit entries.
   */
  async count(filter?: AuditFilter): Promise<number> {
    return this.store.count(filter);
  }

  /**
   * Flush buffered entries.
   */
  async flush(): Promise<void> {
    if (this.store.flush) await this.store.flush();
  }

  /**
   * Dispose the audit log.
   */
  async dispose(): Promise<void> {
    if (this.store.flush) await this.store.flush();
    if (this.store.dispose) await this.store.dispose();
  }
}
