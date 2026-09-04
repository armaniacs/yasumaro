/**
 * sqliteEngineHost.ts — SqliteEngineHost (thin Host, PBI-14)
 * Owns all mutable engine state via private #state; low-level plumbing lives
 * in sqliteEngineContext/{opfsWorkerProxy,idbEngineLifecycle,
 * migrationBackup,fallbackMigration}.ts — each module operates on a plain
 * state object, and Host passes its private #state to them.
 *
 * SqliteEngineContext is a thin alias to this class for backward compat.
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
import { logError, ErrorCode } from '../utils/logger.js';
import { FallbackStorage } from './storageFallback.js';
import { StorageKeys } from '../utils/storage/types.js';
import type { StorageBackend, StatusResult, BackendOrError } from './StorageBackend.js';
import type { SqliteEngine } from './sqliteEngine.js';
import { resolveBackend, createBackend, type BackendType } from './backendResolver.js';
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
import type { SqliteValue } from './sqliteEngine.js';
import { Mutex } from '../utils/Mutex.js';

// Re-export from the canonical source so callers importing from either module get the same type.
export type { SqliteValue };

export { DB_FILENAME };

/** Hard cap on query()/search() result size, so a caller can't force the entire table into JS memory at once (M13). */
export const MAX_QUERY_LIMIT = 100000;

export { extractDomain } from '../utils/domainUtils.js';

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

  // ── Public accessors for backward compat (proxy to #state) ──────

  get idbEngine(): SqliteEngine | null {
    return this.#state.idbEngine;
  }
  set idbEngine(v: SqliteEngine | null) {
    this.#state.idbEngine = v;
  }

  get initPromise(): Promise<boolean> | null {
    return this.#state.initPromise;
  }
  set initPromise(v: Promise<boolean> | null) {
    this.#state.initPromise = v;
  }

  get usingFallbackStorage(): boolean {
    return this.#state.usingFallbackStorage;
  }
  set usingFallbackStorage(v: boolean) {
    this.#state.usingFallbackStorage = v;
  }

  get fallbackStorage(): FallbackStorage | null {
    return this.#state.fallbackStorage;
  }
  set fallbackStorage(v: FallbackStorage | null) {
    this.#state.fallbackStorage = v;
  }

  get lastInitError(): string | null {
    return this.#state.lastInitError;
  }
  set lastInitError(v: string | null) {
    this.#state.lastInitError = v;
  }

  get fts5Available(): boolean {
    return this.#state.fts5Available;
  }
  set fts5Available(v: boolean) {
    this.#state.fts5Available = v;
  }

  get cachedCompileOptions(): string[] | null {
    return this.#state.cachedCompileOptions;
  }
  set cachedCompileOptions(v: string[] | null) {
    this.#state.cachedCompileOptions = v;
  }

  // _backend is private in original but accessed via resetForTesting; keep private field name with accessor
  get _backend(): StorageBackend | null {
    return this.#state._backend;
  }
  set _backend(v: StorageBackend | null) {
    this.#state._backend = v;
  }

  get opfsWorker(): Worker | null {
    return this.#state.opfsWorker;
  }
  set opfsWorker(v: Worker | null) {
    this.#state.opfsWorker = v;
  }

  get opfsRequestId(): number {
    return this.#state.opfsRequestId;
  }
  set opfsRequestId(v: number) {
    this.#state.opfsRequestId = v;
  }

  get opfsPending(): Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> {
    return this.#state.opfsPending;
  }
  set opfsPending(v: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>) {
    this.#state.opfsPending = v;
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

  terminateOpfsWorker(): void {
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

  private async _doInit(): Promise<boolean> {
    try {
      // 1. Try OPFS Worker first (preferred — persistent, fast)
      const opfsOk = await initOpfsWorker(this.opfsProxyState);
      if (opfsOk) {
        this.#state.fts5Available = true; // new engine includes FTS5
        return true;
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
    const current: BackendType = resolveBackend({
      opfsWorker: !!this.#state.opfsWorker,
      idbEngine: !!this.#state.idbEngine,
      usingFallbackStorage: this.#state.usingFallbackStorage,
      fallbackStorage: !!this.#state.fallbackStorage,
    });
    if (current !== 'none') return current;

    // Try to initialize
    await this.init();

    // Re-check after init
    return resolveBackend({
      opfsWorker: !!this.#state.opfsWorker,
      idbEngine: !!this.#state.idbEngine,
      usingFallbackStorage: this.#state.usingFallbackStorage,
      fallbackStorage: !!this.#state.fallbackStorage,
    });
  }

  async getBackend(): Promise<StorageBackend> {
    if (this.#state._backend) return this.#state._backend;

    // Ensure initialization has been attempted
    if (!this.#state.opfsWorker && !this.#state.idbEngine && !this.#state.usingFallbackStorage) {
      await this.init();
    }

    const resolved = resolveBackend({
      opfsWorker: !!this.#state.opfsWorker,
      idbEngine: !!this.#state.idbEngine,
      usingFallbackStorage: this.#state.usingFallbackStorage,
      fallbackStorage: !!this.#state.fallbackStorage,
    });

    this.#state._backend = await createBackend(this as unknown as never, resolved);
    return this.#state._backend;
  }

  /** Proxy getStatus via the resolved StorageBackend (PBI-14 Host re-export). */
  async getStatus(): Promise<BackendOrError<StatusResult>> {
    const backend = await this.getBackend();
    return backend.getStatus();
  }

  /** Reset backend selection (used by resetForTesting / offscreen recreate). */
  resetBackend(): void {
    this.#state._backend = null;
  }

  /** Reset the module state for testing. */
  resetForTesting(): void {
    this.resetBackend();
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
