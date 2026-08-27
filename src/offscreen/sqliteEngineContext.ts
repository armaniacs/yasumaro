/**
 * sqliteEngineContext.ts
 * Thin facade over the engine state (SqliteEngineContext class) used by
 * recordsRepo.ts, dbMaintenance.ts, and auditLogRepo.ts. Low-level plumbing
 * lives in sqliteEngineContext/{opfsWorkerProxy,idbEngineLifecycle,
 * migrationBackup,fallbackMigration}.ts — each module operates on a plain
 * state object, and SqliteEngineContext itself satisfies every module's
 * state interface, so this class just wires calls through.
 *
 * IDB fallback path migrated from wa-sqlite's IDBBatchAtomicVFS to
 * @subframe7536/sqlite-wasm's useIdbStorage (PBI: 2026-07-16-06). See
 * createIdbEngine() in sqliteEngine.ts for why the IndexedDB database name
 * must now equal DB_FILENAME (the old VFS_NAME/DB_FILENAME split is gone).
 */

import { errorMessage } from '../utils/errorUtils.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { FallbackStorage } from './storageFallback.js';
import { StorageKeys } from '../utils/storage/types.js';
import type { StorageBackend } from './StorageBackend.js';
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

// Re-export from the canonical source so callers importing from either module get the same type.
export type { SqliteValue };

export { DB_FILENAME };

/** Hard cap on query()/search() result size, so a caller can't force the entire table into JS memory at once (M13). */
export const MAX_QUERY_LIMIT = 100000;

/**
 * Owns all mutable engine state (IDB engine handle, OPFS worker, fallback
 * storage) and the low-level helpers that operate on it. A single
 * module-level instance (`engine`, below) is shared by all repos — this
 * mirrors the original sqlite.ts, which had this state at module scope.
 */
export class SqliteEngineContext {
  /** Non-null once the IDB fallback path (@subframe7536/sqlite-wasm) is initialized. */
  idbEngine: SqliteEngine | null = null;
  initPromise: Promise<boolean> | null = null;
  usingFallbackStorage = false;
  fallbackStorage: FallbackStorage | null = null;
  lastInitError: string | null = null;
  fts5Available = false;
  cachedCompileOptions: string[] | null = null;

  private _backend: StorageBackend | null = null;

  // OPFS Worker state
  opfsWorker: Worker | null = null;
  opfsRequestId = 0;
  opfsPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // ==========================================================================
  // OPFS Worker Proxy — delegates to sqliteEngineContext/opfsWorkerProxy.ts
  // ==========================================================================

  private get opfsProxyState(): OpfsProxyState {
    return this;
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
   * subsequent calls are no-ops.
   */
  async init(): Promise<boolean> {
    if (this.opfsWorker) return true;
    if (this.idbEngine) return true;
    if (this.usingFallbackStorage) return false;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private get idbLifecycleState(): IdbeEngineState {
    return this;
  }

  private get migrationBackupState(): MigrationBackupState {
    return this;
  }

  private get fallbackMigrationState(): FallbackMigrationState {
    return this;
  }

  private async _doInit(): Promise<boolean> {
    try {
      // 1. Try OPFS Worker first (preferred — persistent, fast)
      const opfsOk = await initOpfsWorker(this.opfsProxyState);
      if (opfsOk) {
        this.fts5Available = true; // new engine includes FTS5
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
        throw new Error(this.lastInitError ?? 'SQLite: IDB engine init failed');
      }

      // Restore from the pre-migration backup if verification found a mismatch
      // (runMigrationBackup leaves the backup in place only on failure).
      await runMigrationRestore(this.migrationBackupState);

      // Attempt migration from fallback storage if it has data
      await tryMigrateFallbackToSqlite(this.fallbackMigrationState);

      return true;
    } catch (error) {
      this.lastInitError = errorMessage(error);
      logError('SQLite: init failed', { error: errorMessage(error) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'sqlite');
      this.idbEngine = null;
      this.initPromise = null;

      // If OPFS Worker was created but failed, clean it up
      if (this.opfsWorker) {
        this.terminateOpfsWorker();
      }

      // Fall back to chrome.storage.local when both OPFS and IDB are unavailable
      this.usingFallbackStorage = true;
      this.fallbackStorage = new FallbackStorage();
      try { await chrome.storage.local.set({ [StorageKeys.OPFS_FALLBACK_MODE]: true }); } catch { /* offscreen context */ }
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
    return execWithCacheOnEngine(this.idbEngine!, sql, params, callback);
  }

  /**
   * Ensure a storage backend is initialized and return the appropriate handler.
   * Priority: OPFS Worker > IDB VFS > FallbackStorage > None.
   * Delegates to resolveBackend() — the single source of truth for priority.
   */
  async ensureBackend(): Promise<BackendType> {
    // Already initialized?
    const current: BackendType = resolveBackend({
      opfsWorker: !!this.opfsWorker,
      idbEngine: !!this.idbEngine,
      usingFallbackStorage: this.usingFallbackStorage,
      fallbackStorage: !!this.fallbackStorage,
    });
    if (current !== 'none') return current;

    // Try to initialize
    await this.init();

    // Re-check after init
    return resolveBackend({
      opfsWorker: !!this.opfsWorker,
      idbEngine: !!this.idbEngine,
      usingFallbackStorage: this.usingFallbackStorage,
      fallbackStorage: !!this.fallbackStorage,
    });
  }

  async getBackend(): Promise<StorageBackend> {
    if (this._backend) return this._backend;

    // Ensure initialization has been attempted
    if (!this.opfsWorker && !this.idbEngine && !this.usingFallbackStorage) {
      await this.init();
    }

    const resolved = resolveBackend({
      opfsWorker: !!this.opfsWorker,
      idbEngine: !!this.idbEngine,
      usingFallbackStorage: this.usingFallbackStorage,
      fallbackStorage: !!this.fallbackStorage,
    });

    this._backend = await createBackend(this, resolved);
    return this._backend;
  }

  /** Reset backend selection (used by resetForTesting / offscreen recreate). */
  resetBackend(): void {
    this._backend = null;
  }

  /** Reset the module state for testing. */
  resetForTesting(): void {
    this.resetBackend();
    this.idbEngine = null;
    this.initPromise = null;
    this.usingFallbackStorage = false;
    this.fallbackStorage = null;
    if (this.opfsWorker) {
      this.opfsWorker.terminate();
      this.opfsWorker = null;
    }
    this.opfsPending.clear();
    this.fts5Available = false;
    this.lastInitError = null;
    this.cachedCompileOptions = null;
  }
}

export { extractDomain } from '../utils/domainUtils.js';

/**
 * Shared engine instance used by all repos (records, maintenance, audit log).
 * Mirrors the original sqlite.ts, which held this state at module scope.
 */
export const engine = new SqliteEngineContext();
