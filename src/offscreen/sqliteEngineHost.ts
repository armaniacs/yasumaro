/**
 * sqliteEngineHost.ts — SqliteEngineHost (thin Host, PBI-14)
 * Owns all mutable engine state via private #state; low-level plumbing lives
 * in sqliteEngineContext/{opfsWorkerProxy,idbEngineLifecycle,
 * migrationBackup,fallbackMigration}.ts — each module operates on a plain
 * state object, and Host passes its private #state to them.
 *
 * The 4 State casts (`get opfsProxyState(): OpfsProxyState { return this }`)
 * are replaced by `return this.#state`, encapsulating shared mutable `this`.
 *
 * Why #state + Mutex:
 * - Why leak: facade shared same `this` as 4 State types, init order only in facade.
 * - Why split hurt: pure functions but cognition 1 facade -> 4 files; 718->268 already done.
 * - Why Host: encapsulate in #state, serialize concurrent init() via Mutex, keep
 *   migrationBackup sunset gate outside Host (git rm on 2026-12-17).
 */

import { errorMessage } from '../utils/errorUtils.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logError, logWarn } from '../utils/logger/api.js';
import { FallbackStorage } from './storageFallback.js';
import { StorageKeys } from '../utils/storage/types.js';
import type { StorageBackend, StatusResult, BackendOrError } from './StorageBackend.js';
import { NoopBackend } from './StorageBackend.js';
import type { SqliteValue } from './sqliteEngine.js';
import { resolveBackend, type BackendType } from './backendResolver.js';
// Static imports (not dynamic): the Firefox background hosts the engine
// in-page, and nested dynamic imports inside an IIFE library build force
// rolldown into code-splitting, which IIFE rejects. The adapters are small.
import { OpfsWorkerBackend } from './OpfsWorkerBackend.js';
import { IdbVfsBackend, type IdbVfsBackendHost } from './IdbVfsBackend.js';
import { FallbackStorageAdapter } from './FallbackStorageAdapter.js';
import {
  sendToOpfsWorker,
  tryOpfsProxy,
  initOpfsWorker,
  terminateOpfsWorker,
  type OpfsProxyState,
} from './sqliteEngineContext/opfsWorkerProxy.js';
import {
  DB_FILENAME,
  initIdbEngine,
  execWithCache as execWithCacheOnEngine,
  type IdbeEngineState,
} from './sqliteEngineContext/idbEngineLifecycle.js';
import {
  runMigrationBackup,
  runMigrationRestore,
  type MigrationBackupState,
} from './sqliteEngineContext/migrationBackup.js';
import {
  tryMigrateFallbackToSqlite,
  type FallbackMigrationState,
} from './sqliteEngineContext/fallbackMigration.js';
import { Mutex } from '../utils/Mutex.js';

// Re-export from the canonical source so callers importing from either module get the same type.
export type { SqliteValue };

export { DB_FILENAME };

/** Hard cap on query()/search() result size, so a caller can't force the entire table into JS memory at once (M13).
 * Defined in utils/limits.ts (the cap registry); re-exported here
 * because MAX_QUERY_LIMIT was previously a second 100000 literal (ADR 2026-08-27-limit-policy drift). */
export { MAX_QUERY_LIMIT } from '../utils/limits.js';

export { extractDomain } from '../utils/domainUtils.js';

/**
 * How far the runtime-degrade ladder has descended in this offscreen document's
 * life. Mirrors resolveBackend's BackendType minus 'none': there is nothing to
 * degrade from before init and nothing left to degrade to after fallback.
 */
type DegradeStage = 'opfs' | 'idb' | 'fallback';

/**
 * Host owns all mutable engine state via private #state. External callers
 * (IdbVfsBackend, OpfsWorkerBackend, backendResolver, recordsRepo) access
 * state via public getters/setters that proxy to #state — this keeps the
 * 4 extracted modules pure (they receive OpfsProxyState etc.) while
 * encapsulating the shared-mutable `this` that previously leaked.
 */
export class SqliteEngineHost {
  #state: OpfsProxyState &
    IdbeEngineState &
    MigrationBackupState &
    FallbackMigrationState & {
      initPromise: Promise<boolean> | null;
      usingFallbackStorage: boolean;
      fallbackStorage: FallbackStorage | null;
      _backend: StorageBackend | null;
    } = {
    // OpfsProxyState
    opfsWorker: null,
    opfsRequestId: 0,
    opfsPending: new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(),
    // IdbeEngineState (+ MigrationBackupState + FallbackMigrationState share idbEngine)
    idbEngine: null,
    fts5Available: false,
    cachedCompileOptions: null,
    lastInitError: null,
    // Host extras
    initPromise: null,
    usingFallbackStorage: false,
    fallbackStorage: null,
    _backend: null,
  };

  #mutex = new Mutex();

  /** Rung of the runtime-degrade ladder the host has settled on — see degradeFromOpfs. */
  #degradeStage: DegradeStage = 'opfs';
  /** In-flight re-resolution, so concurrent signals join one run. */
  #degradeRun: Promise<BackendType> | null = null;

  /**
   * Current post-init state in the shape resolveBackend takes. One literal for
   * every caller — the three call sites used to spell the same four flags out
   * separately, and the degradation path would have been a fourth copy.
   */
  private get resolverState(): Parameters<typeof resolveBackend>[0] {
    return {
      opfsWorker: !!this.#state.opfsWorker,
      idbEngine: !!this.#state.idbEngine,
      usingFallbackStorage: this.#state.usingFallbackStorage,
      fallbackStorage: !!this.#state.fallbackStorage,
    };
  }

  // ── Narrow views for the adapters (private) ──────────────────────
  //
  // PBI-05: the public get/set state accessors are gone. IdbVfsBackend reads
  // these off a duck type, so the host hands a live view of exactly the exec
  // seam plus the two boot-time reads — nothing else reaches #state.

  private get idbBackendView(): IdbVfsBackendHost {
    const host = this;
    return {
      execWithCache: (sql: string, params?: SqliteValue[], callback?: (row: SqliteValue[]) => void) =>
        host.execWithCache(sql, params, callback),
      get idbEngine() { return host.#state.idbEngine; },
      get fts5Available() { return host.#state.fts5Available; },
      get cachedCompileOptions() { return host.#state.cachedCompileOptions; },
    };
  }

  // ==========================================================================
  // OPFS Worker Proxy — delegates to sqliteEngineContext/opfsWorkerProxy.ts
  // ==========================================================================

  private get opfsProxyState(): OpfsProxyState {
    return this.#state;
  }

  sendToOpfsWorker(type: string, payload?: unknown): Promise<unknown> {
    return sendToOpfsWorker(this.opfsProxyState, type, payload);
  }

  /**
   * Try to proxy a call to the OPFS Worker. Returns the result if the Worker
   * is available and succeeds, otherwise returns null (caller should use fallback).
   */
  tryOpfsProxy<T>(type: string, payload?: unknown): Promise<T | null> {
    return tryOpfsProxy<T>(this.opfsProxyState, type, payload);
  }

  private terminateOpfsWorker(): void {
    terminateOpfsWorker(this.opfsProxyState);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the SQLite database. Safe to call multiple times —
   * concurrent calls are serialized by Mutex and deduplicated via initPromise.
   */
  async init(): Promise<boolean> {
    await this.#mutex.acquire();
    try {
      if (this.#state.opfsWorker) return true;
      if (this.#state.idbEngine) return true;
      if (this.#state.usingFallbackStorage) return false;
      if (this.#state.initPromise) return this.#state.initPromise;

      this.#state.initPromise = this._doInit();
      return await this.#state.initPromise;
    } finally {
      this.#mutex.release();
    }
  }

  private get idbLifecycleState(): IdbeEngineState {
    return this.#state;
  }

  private get migrationBackupState(): MigrationBackupState {
    return this.#state;
  }

  private get fallbackMigrationState(): FallbackMigrationState {
    return this.#state;
  }

  private async _doInit(options: { skipOpfs?: boolean } = {}): Promise<boolean> {
    try {
      // 1. Try OPFS Worker first (preferred — persistent, fast). Skipped only
      //    by the degradation path, which already knows the worker is dead.
      if (!options.skipOpfs) {
        const opfsOk = await initOpfsWorker(this.opfsProxyState);
        if (opfsOk) {
          this.#state.fts5Available = true; // new engine includes FTS5
          return true;
        }
      }

      // 2. IndexedDB VFS as fallback (@subframe7536/sqlite-wasm).
      // If a pre-existing wa-sqlite IDBBatchAtomicVFS database is detected
      // (old IDB database name 'idb-batch-atomic'), back it up to
      // chrome.storage.local before opening it under the new engine, since
      // the migration renames the IndexedDB database.
      await runMigrationBackup(this.migrationBackupState);

      const idbOk = await initIdbEngine(this.idbLifecycleState);
      if (!idbOk) {
        throw new Error(this.#state.lastInitError ?? 'SQLite: IDB engine init failed');
      }

      // Restore from the pre-migration backup if verification found a mismatch
      // (runMigrationBackup leaves the backup in place only on failure).
      await runMigrationRestore(this.migrationBackupState);

      // Attempt migration from fallback storage if it has data
      await tryMigrateFallbackToSqlite(this.fallbackMigrationState);

      return true;
    } catch (error) {
      this.#state.lastInitError = errorMessage(error);
      logError('SQLite: init failed', { error: errorMessage(error) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'sqlite');
      this.#state.idbEngine = null;
      this.#state.initPromise = null;

      // If OPFS Worker was created but failed, clean it up
      if (this.#state.opfsWorker) {
        this.terminateOpfsWorker();
      }

      // Fall back to chrome.storage.local when both OPFS and IDB are unavailable
      this.#state.usingFallbackStorage = true;
      this.#state.fallbackStorage = new FallbackStorage();
      try {
        await chrome.storage.local.set({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
      } catch {
        /* offscreen context */
      }
      return false;
    }
  }

  // ==========================================================================
  // SQL Execution (IDB engine)
  // ==========================================================================

  /**
   * Execute SQL against the IDB engine (@subframe7536/sqlite-wasm), invoking
   * callback once per result row with column values in SELECT order.
   * Named execWithCache for compatibility with existing callers
   * (IdbVfsBackend.ts, recordsRepo.ts) — @subframe7536 has no
   * prepared-statement cache API, so this now calls exec()/query() directly.
   */
  execWithCache(
    sql: string,
    params: SqliteValue[] = [],
    callback?: (row: SqliteValue[]) => void
  ): Promise<void> {
    return execWithCacheOnEngine(this.#state.idbEngine!, sql, params, callback);
  }

  /**
   * Ensure a storage backend is initialized and return the appropriate handler.
   * Priority: OPFS Worker > IDB VFS > FallbackStorage > None.
   * Delegates to resolveBackend() — the single source of truth for priority.
   */
  async ensureBackend(): Promise<BackendType> {
    // Already initialized?
    const current: BackendType = resolveBackend(this.resolverState);
    if (current !== 'none') return current;

    // Try to initialize
    await this.init();

    // Re-check after init
    return resolveBackend(this.resolverState);
  }

  async getBackend(): Promise<StorageBackend> {
    if (this.#state._backend) return this.#state._backend;

    // Ensure initialization has been attempted
    if (!this.#state.opfsWorker && !this.#state.idbEngine && !this.#state.usingFallbackStorage) {
      await this.init();
    }

    const resolved = resolveBackend(this.resolverState);

    this.#state._backend = await this.createBackendFor(resolved);
    return this.#state._backend;
  }

  /**
   * Backend adapter registry (moved from backendResolver.ts, PBI-05): the
   * factory table is the single place that knows a backend was chosen from
   * this context, and the IDB rung's init precondition is init-order
   * knowledge that belongs to the host — backendResolver.ts stays a pure
   * decision table. Falls back to NoopBackend when the resolved type has no
   * matching adapter.
   */
  private async createBackendFor(resolved: BackendType): Promise<StorageBackend> {
    switch (resolved) {
      // The degrade signal is wired here because this is the only place that
      // knows a backend was chosen from this context — the adapter itself
      // only counts failures and cannot reach the host's init ladder.
      case 'opfs':
        return new OpfsWorkerBackend(this, () => this.degradeFromOpfs());
      case 'idb': {
        // Defensive belt: the resolver may have returned 'idb' before the
        // engine is fully set up.
        if (!this.#state.idbEngine) {
          await this.init();
        }
        if (this.#state.idbEngine) {
          return new IdbVfsBackend(this.idbBackendView);
        }
        return new NoopBackend();
      }
      case 'fallback':
        return this.#state.fallbackStorage
          ? new FallbackStorageAdapter(this.#state.fallbackStorage)
          : new NoopBackend();
      case 'none':
        return new NoopBackend();
    }
  }

  /**
   * Re-resolve the backend after the OPFS worker died mid-session, and report
   * which one won. Public because backendResolver wires it into
   * OpfsWorkerBackend's constructor: the adapter holds no engine state, and the
   * ladder below is the only place that can run it.
   *
   * The rung is latched, so the ladder only ever descends: 'opfs' → 'idb' →
   * 'fallback'. A second signal therefore skips straight to fallback storage
   * instead of re-running the IDB rung, and a third is a no-op — the backend is
   * never climbed back up, which is what stops OPFS→IDB→OPFS flapping.
   *
   * Never rejects — a failed re-resolution is logged here so the caller still
   * gets the ordinary `{ success: false }` for the operation that tripped it.
   */
  async degradeFromOpfs(): Promise<BackendType> {
    if (this.#degradeStage === 'fallback') return resolveBackend(this.resolverState);
    // Concurrent signals join the run already in flight rather than queueing a
    // second ladder walk behind it.
    this.#degradeRun ??= this.#runDegrade(this.#degradeStage);
    return this.#degradeRun;
  }

  async #runDegrade(from: DegradeStage): Promise<BackendType> {
    try {
      if (from === 'opfs') {
        await this.#reinitWithoutOpfs();
      } else {
        await this.#enterFallbackStorage();
      }
    } catch (error) {
      logError('SQLite: OPFS degradation re-resolve failed', { error: errorMessage(error) }, ErrorCode.INTERNAL_ERROR, 'sqlite');
    } finally {
      // Dropped once the re-resolution has settled, failed or not: until then
      // `_backend` still holds the adapter pointing at the dead worker, and a
      // cache that outlives a failed re-resolution would hand that same dead
      // adapter to every later getBackend().
      this.resetBackend();
      this.#degradeRun = null;
    }

    const resolved = resolveBackend(this.resolverState);
    // 'none' counts as 'fallback': nothing is serving, so the next signal must
    // descend to storage rather than sit on a rung that resolved to nothing.
    this.#degradeStage = resolved === 'idb' ? 'idb' : 'fallback';
    logWarn(
      'SQLite: OPFS worker degraded, backend re-resolved',
      { from, resolvedTo: resolved, ladderRung: this.#degradeStage },
      undefined,
      'sqlite'
    );
    return resolved;
  }

  /**
   * Enter chrome.storage.local fallback storage directly, skipping the IDB rung.
   * Mirrors what _doInit's catch does on a cold start, so both entries into
   * fallback mode set the same flags and the same durable marker.
   */
  async #enterFallbackStorage(): Promise<void> {
    if (this.#state.opfsWorker) {
      this.terminateOpfsWorker();
    }
    this.#state.idbEngine = null;
    this.#state.initPromise = null;
    this.#state.usingFallbackStorage = true;
    this.#state.fallbackStorage = new FallbackStorage();
    try {
      await chrome.storage.local.set({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
    } catch {
      /* offscreen context */
    }
  }

  /**
   * Re-run the existing init ladder with the OPFS rung removed.
   *
   * Skipped rather than retried on purpose: a worker that failed
   * OPFS_DEGRADE_FAILURE_THRESHOLD proxy calls in a row does not come back by
   * being constructed again, and resolveBackend would pick it again the moment
   * it did — the flapping this path exists to prevent. What remains of the
   * ladder (IDB, then fallback storage) is untouched, so the priority order is
   * still decided by resolveBackend and not re-implemented here.
   */
  async #reinitWithoutOpfs(): Promise<boolean> {
    await this.#mutex.acquire();
    try {
      // A concurrent init() can bring a worker up while we wait for the lock;
      // drop it here so the re-resolution cannot land back on OPFS.
      if (this.#state.opfsWorker) {
        this.terminateOpfsWorker();
      }
      if (this.#state.idbEngine) return true;
      if (this.#state.usingFallbackStorage) return false;
      return await this._doInit({ skipOpfs: true });
    } finally {
      this.#mutex.release();
    }
  }

  /** Proxy getStatus via the resolved StorageBackend (PBI-14 Host re-export). */
  async getStatus(): Promise<BackendOrError<StatusResult>> {
    const backend = await this.getBackend();
    return backend.getStatus();
  }

  /**
   * Reset backend selection so the next getBackend() re-resolves through
   * resolveBackend. Production reachability: degradeFromOpfs() after the OPFS
   * worker dies mid-session, plus resetForTesting().
   */
  private resetBackend(): void {
    this.#state._backend = null;
  }

  /** Reset the module state for testing. */
  resetForTesting(): void {
    this.resetBackend();
    this.#degradeStage = 'opfs';
    this.#degradeRun = null;
    this.#state.idbEngine = null;
    this.#state.initPromise = null;
    this.#state.usingFallbackStorage = false;
    this.#state.fallbackStorage = null;
    if (this.#state.opfsWorker) {
      this.#state.opfsWorker.terminate();
      this.#state.opfsWorker = null;
    }
    this.#state.opfsPending.clear();
    this.#state.fts5Available = false;
    this.#state.lastInitError = null;
    this.#state.cachedCompileOptions = null;
    // Drop any in-flight init() serialization state so a stale lock holder or
    // queued waiter from a previous test cannot leak into the next one. The
    // old Mutex instance is discarded (its waiters settle against the old
    // instance); production never calls this method — only the test seam
    // (_resetSqliteForTesting) does — so live behavior is unchanged.
    this.#mutex = new Mutex();
  }
}

/**
 * Shared engine instance used by all repos (records, maintenance, audit log).
 * Mirrors the original sqlite.ts, which held this state at module scope.
 */
export const engine = new SqliteEngineHost();
