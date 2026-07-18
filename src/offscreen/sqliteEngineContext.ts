/**
 * sqliteEngineContext.ts
 * Shared SQLite engine state and low-level plumbing (OPFS Worker proxying,
 * IDB initialization via @subframe7536/sqlite-wasm, fallback storage)
 * used by recordsRepo.ts, dbMaintenance.ts, and auditLogRepo.ts.
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 *
 * IDB fallback path migrated from wa-sqlite's IDBBatchAtomicVFS to
 * @subframe7536/sqlite-wasm's useIdbStorage (PBI: 2026-07-16-06). See
 * createIdbEngine() in sqliteEngine.ts for why the IndexedDB database name
 * must now equal DB_FILENAME (the old VFS_NAME/DB_FILENAME split is gone).
 */

import { errorMessage } from '../utils/errorUtils.js';
import { logError, logInfo, logWarn, ErrorCode } from '../utils/logger.js';
import { FallbackStorage } from './storageFallback.js';
import { StorageKeys } from '../utils/storage/types.js';
import { NoopBackend } from './StorageBackend.js';
import type { StorageBackend } from './StorageBackend.js';
import { SCHEMA_SQL, AUDIT_LOG_SCHEMA_SQL, INSERT_IGNORE_SQL, buildInsertParams, COLUMN_NAMES } from './schema.js';
import { runMigrations } from './migrations.js';
import { createIdbEngine, type SqliteEngine, type SqliteRow } from './sqliteEngine.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

export type SqliteValue = number | string | Uint8Array | Array<number> | bigint | null;

export const DB_FILENAME = 'yasumaro.db';

const IDB_WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm-async', import.meta.url).href;

/** Columns selected by the pre-migration backup / post-migration restore, in order. */
const MIGRATION_BACKUP_COLUMNS = [...COLUMN_NAMES];

function mapMigrationBackupRow(row: SqliteValue[]): BrowsingLogRecord {
  const idx = (name: typeof COLUMN_NAMES[number]) => COLUMN_NAMES.indexOf(name);
  const getString = (name: typeof COLUMN_NAMES[number]): string | null => {
    const v = row[idx(name)];
    return v != null ? String(v) : null;
  };
  const getNumber = (name: typeof COLUMN_NAMES[number]): number | null => {
    const v = row[idx(name)];
    return v != null ? Number(v) : null;
  };
  const getInt = (name: typeof COLUMN_NAMES[number]): number => {
    const v = row[idx(name)];
    return v != null ? Number(v) : 0;
  };
  return {
    url: String(row[idx('url')]),
    title: getString('title'),
    summary: getString('summary'),
    tags: getString('tags'),
    created_at: Number(row[idx('created_at')]),
    domain: getString('domain'),
    visit_duration: getNumber('visit_duration'),
    scroll_ratio: getNumber('scroll_ratio'),
    is_starred: getInt('is_starred'),
    is_deleted: getInt('is_deleted'),
    obsidian_synced: getInt('obsidian_synced'),
    gist_synced: getInt('gist_synced'),
    content: getString('content'),
    masked_count: getNumber('masked_count'),
    cleansed_reason: getString('cleansed_reason'),
    ai_provider: getString('ai_provider'),
    ai_model: getString('ai_model'),
    ai_duration_ms: getNumber('ai_duration_ms'),
    obsidian_duration_ms: getNumber('obsidian_duration_ms'),
    sent_tokens: getNumber('sent_tokens'),
    received_tokens: getNumber('received_tokens'),
    original_tokens: getNumber('original_tokens'),
    cleansed_tokens: getNumber('cleansed_tokens'),
    page_bytes: getNumber('page_bytes'),
    candidate_bytes: getNumber('candidate_bytes'),
    original_bytes: getNumber('original_bytes'),
    cleansed_bytes: getNumber('cleansed_bytes'),
    ai_summary_original_bytes: getNumber('ai_summary_original_bytes'),
    ai_summary_cleansed_bytes: getNumber('ai_summary_cleansed_bytes'),
    extracted_sentences_bytes: getNumber('extracted_sentences_bytes'),
    extracted_sentences_original_bytes: getNumber('extracted_sentences_original_bytes'),
    fallback_triggered: getInt('fallback_triggered'),
  };
}

interface MigrationBackupPayload {
  version: 1;
  createdAt: number;
  records: BrowsingLogRecord[];
}

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
  // OPFS Worker Proxy
  // ==========================================================================

  private isOpfsAvailable(): boolean {
    try {
      return typeof navigator?.storage?.getDirectory === 'function';
    } catch {
      return false;
    }
  }

  private canCreateWorker(): boolean {
    try {
      return 'Worker' in globalThis;
    } catch {
      return false;
    }
  }

  private createOpfsWorker(): Worker | null {
    try {
      const worker = new Worker(
        new URL('./opfsWorker.js', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e: MessageEvent<{ id: number; success: boolean; result?: unknown; error?: string }>) => {
        const { id, success, result, error } = e.data;
        const pending = this.opfsPending.get(id);
        if (pending) {
          this.opfsPending.delete(id);
          if (success) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error || 'OPFS Worker error'));
          }
        }
      };

      worker.onerror = (e: ErrorEvent) => {
        console.error('OPFS Worker error:', e.message);
        // Reject all pending requests
        for (const [id, pending] of this.opfsPending) {
          pending.reject(new Error(`OPFS Worker error: ${e.message}`));
          this.opfsPending.delete(id);
        }
      };

      return worker;
    } catch (err) {
      console.warn('Failed to create OPFS Worker:', errorMessage(err));
      return null;
    }
  }

  sendToOpfsWorker(type: string, payload?: unknown): Promise<unknown> {
    if (!this.opfsWorker) {
      return Promise.reject(new Error('OPFS Worker not available'));
    }

    const id = ++this.opfsRequestId;
    return new Promise((resolve, reject) => {
      this.opfsPending.set(id, { resolve, reject });

      // Timeout after 15 seconds
      const timeout = setTimeout(() => {
        this.opfsPending.delete(id);
        reject(new Error(`OPFS Worker timeout: ${type}`));
      }, 15000);

      const originalResolve = resolve;
      const originalReject = reject;

      this.opfsPending.set(id, {
        resolve: (v) => { clearTimeout(timeout); originalResolve(v); },
        reject: (e) => { clearTimeout(timeout); originalReject(e); },
      });

      this.opfsWorker!.postMessage({ id, type, payload });
    });
  }

  /**
   * Try to proxy a call to the OPFS Worker. Returns the result if the Worker
   * is available and succeeds, otherwise returns null (caller should use fallback).
   */
  async tryOpfsProxy<T>(type: string, payload?: unknown): Promise<T | null> {
    if (!this.opfsWorker) return null;
    try {
      return await this.sendToOpfsWorker(type, payload) as T;
    } catch (err) {
      console.warn(`OPFS Worker call failed (${type}), falling back:`, errorMessage(err));
      return null;
    }
  }

  private async initOpfsWorker(): Promise<boolean> {
    try {
      if (!this.isOpfsAvailable()) {
        return false;
      }

      if (!this.canCreateWorker()) {
        return false;
      }

      this.opfsWorker = this.createOpfsWorker();
      if (!this.opfsWorker) {
        return false;
      }

      // Send INIT to the worker
      const result = await this.sendToOpfsWorker('INIT') as { initialized: boolean } | undefined;
      if (result?.initialized) {
        return true;
      }

      console.warn('OPFS: Worker INIT returned unexpected result:', result);
      return false;
    } catch (err) {
      console.warn('OPFS: Worker init failed:', errorMessage(err));
      return false;
    }
  }

  terminateOpfsWorker(): void {
    if (this.opfsWorker) {
      this.opfsWorker.terminate();
      this.opfsWorker = null;
      for (const [, pending] of this.opfsPending) {
        pending.reject(new Error('OPFS Worker terminated'));
      }
      this.opfsPending.clear();
    }
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

  private async _doInit(): Promise<boolean> {
    try {
      // 1. Try OPFS Worker first (preferred — persistent, fast)
      const opfsOk = await this.initOpfsWorker();
      if (opfsOk) {
        this.fts5Available = true; // new engine includes FTS5
        return true;
      }

      // 2. IndexedDB VFS as fallback (@subframe7536/sqlite-wasm).
      // If a pre-existing wa-sqlite IDBBatchAtomicVFS database is detected
      // (old IDB database name 'idb-batch-atomic'), back it up to
      // chrome.storage.local before opening it under the new engine, since
      // the migration renames the IndexedDB database (see migrateIdbIfNeeded).
      await this.migrateIdbIfNeeded();

      this.idbEngine = await createIdbEngine(DB_FILENAME, IDB_WASM_URL);

      // M32: Enable WAL mode before any schema/migration operations for journal consistency
      await this.idbEngine.exec('PRAGMA journal_mode=WAL;');
      await this.idbEngine.exec('PRAGMA wal_autocheckpoint=1000;');

      // Execute schema creation
      await this.idbEngine.exec(SCHEMA_SQL);
      await this.idbEngine.exec(AUDIT_LOG_SCHEMA_SQL);

      // Run schema migrations through shared migration engine
      const idbEngine = this.idbEngine;
      const { fts5Available } = await runMigrations({
        exec: (sql) => idbEngine.exec(sql),
        queryValue: async (sql) => {
          const value = await idbEngine.queryValue(sql);
          return value != null ? Number(value) : null;
        },
      });
      this.fts5Available = fts5Available;

      // Log available extensions
      const compileOptions: string[] = [];
      const rows = await this.idbEngine.query('PRAGMA compile_options');
      for (const row of rows) {
        compileOptions.push(String(Object.values(row)[0]));
      }
      this.cachedCompileOptions = compileOptions;

      // Restore from the pre-migration backup if verification found a mismatch
      // (migrateIdbIfNeeded leaves the backup in place only on failure).
      await this.restoreFromMigrationBackupIfPresent();

      // Attempt migration from fallback storage if it has data
      await this.tryMigrateFallbackToSqlite();

      return true;
    } catch (error) {
      this.lastInitError = errorMessage(error);
      console.error('SQLite: init failed', error);
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
  // Migration: wa-sqlite IDBBatchAtomicVFS → @subframe7536 IDB VFS
  // ==========================================================================

  /**
   * Detect a pre-existing wa-sqlite IndexedDB database (old database name
   * 'idb-batch-atomic') and, if found, back its records up to
   * chrome.storage.local before this init proceeds to open DB_FILENAME under
   * the new engine. useIdbStorage's automatic onupgradeneeded migration
   * (verified in the PBI 2026-07-16-06 E2E spike) only fires if the
   * IndexedDB database name matches DB_FILENAME — the old wa-sqlite setup
   * used a distinct name ('idb-batch-atomic'), so there is nothing to migrate
   * unless that old database is still present under its old name.
   */
  private async migrateIdbIfNeeded(): Promise<void> {
    const OLD_IDB_NAME = 'idb-batch-atomic';
    try {
      const done = await this.isIdbMigrationDone();
      if (done) return;

      const databases = await indexedDB.databases?.() ?? [];
      const oldDbExists = databases.some((d) => d.name === OLD_IDB_NAME);
      if (!oldDbExists) {
        await this.setIdbMigrationDone();
        return;
      }

      await this.backupOldWaSqliteIdb(OLD_IDB_NAME);
    } catch (error) {
      logWarn(
        'SQLite: IDB migration pre-check failed, proceeding without backup',
        { error: errorMessage(error) },
        ErrorCode.STORAGE_MIGRATION_FAILURE,
        'sqlite'
      );
    }
  }

  private async isIdbMigrationDone(): Promise<boolean> {
    try {
      const items = await chrome.storage.local.get(StorageKeys.IDB_MIGRATION_V2_DONE);
      return items[StorageKeys.IDB_MIGRATION_V2_DONE] === true;
    } catch {
      return false;
    }
  }

  private async setIdbMigrationDone(): Promise<void> {
    try { await chrome.storage.local.set({ [StorageKeys.IDB_MIGRATION_V2_DONE]: true }); } catch { /* offscreen context */ }
  }

  /**
   * Read all records from the old wa-sqlite IDBBatchAtomicVFS database and
   * save them to chrome.storage.local as a JSON snapshot, so they can be
   * restored if the new engine's post-migration record count doesn't match.
   * Dynamically imports wa-sqlite — this is the ONLY place it is still
   * referenced from sqliteEngineContext.ts, isolated to the one-time backup
   * path so the module is not loaded once migration is done.
   */
  private async backupOldWaSqliteIdb(oldIdbName: string): Promise<void> {
    const [{ default: SQLiteESMFactory }, SQLite, { IDBBatchAtomicVFS }] = await Promise.all([
      import('wa-sqlite/dist/wa-sqlite-async.mjs'),
      import('wa-sqlite'),
      import('wa-sqlite/src/examples/IDBBatchAtomicVFS.js'),
    ]);

    const asyncModule = await SQLiteESMFactory();
    if (!asyncModule.registerVFS && typeof asyncModule.vfs_register === 'function') {
      asyncModule.registerVFS = asyncModule.vfs_register;
    }
    const sqlite3 = SQLite.Factory(asyncModule);
    const vfs = new IDBBatchAtomicVFS(oldIdbName);
    if (typeof (vfs as { hasAsyncMethod?: unknown }).hasAsyncMethod !== 'function') {
      (vfs as unknown as { hasAsyncMethod: (m: string) => boolean }).hasAsyncMethod = () => false;
    }
    sqlite3.vfs_register(vfs as unknown as SQLiteVFS, true);

    let dbHandle: number | null = null;
    try {
      dbHandle = await sqlite3.open_v2(
        DB_FILENAME,
        SQLite.SQLITE_OPEN_READWRITE,
        oldIdbName
      );

      const records: BrowsingLogRecord[] = [];
      await sqlite3.exec(
        dbHandle,
        `SELECT ${MIGRATION_BACKUP_COLUMNS.join(', ')} FROM browsing_logs`,
        (row) => {
          records.push(mapMigrationBackupRow(row));
        }
      );

      const payload: MigrationBackupPayload = { version: 1, createdAt: Date.now(), records };
      await chrome.storage.local.set({ [StorageKeys.IDB_MIGRATION_BACKUP]: JSON.stringify(payload) });
      logInfo(
        `SQLite: backed up ${records.length} records before IDB engine migration`,
        { count: records.length },
        'sqlite'
      );
    } finally {
      if (dbHandle !== null) {
        await sqlite3.close(dbHandle).catch(() => {});
      }
      // Critical: the old VFS's IndexedDB connection MUST be closed, or the
      // new engine's indexedDB.open(DB_FILENAME, N) upgrade below hangs
      // indefinitely (verified in the E2E spike for this PBI).
      await (vfs as unknown as { close: () => Promise<void> }).close().catch(() => {});
    }
  }

  /**
   * After the new IDB engine (@subframe7536) has initialized, verify the
   * migration by comparing record counts against the pre-migration backup.
   * On success, clear the backup and mark migration done. On mismatch or if
   * the new DB is unexpectedly empty, restore from the backup via
   * INSERT OR IGNORE (idempotent) and leave the backup in place for the next
   * init attempt, and do NOT mark migration done — this init run's caller
   * may still succeed at the record level even though the migration itself
   * needs re-verification.
   */
  private async restoreFromMigrationBackupIfPresent(): Promise<void> {
    let backupJson: string | undefined;
    try {
      const items = await chrome.storage.local.get(StorageKeys.IDB_MIGRATION_BACKUP);
      const value = items[StorageKeys.IDB_MIGRATION_BACKUP];
      backupJson = typeof value === 'string' ? value : undefined;
    } catch {
      return;
    }
    if (!backupJson) {
      await this.setIdbMigrationDone();
      return;
    }

    try {
      const payload = JSON.parse(backupJson) as MigrationBackupPayload;
      const expectedCount = payload.records.length;

      let actualCount = 0;
      await this.execWithCache('SELECT COUNT(*) FROM browsing_logs', [], (row) => { actualCount = Number(row[0]); });

      if (actualCount >= expectedCount && expectedCount > 0) {
        // Migration succeeded (useIdbStorage's built-in upgrade preserved
        // the records) — safe to discard the backup.
        await chrome.storage.local.remove(StorageKeys.IDB_MIGRATION_BACKUP);
        await this.setIdbMigrationDone();
        logInfo('SQLite: IDB migration verified, backup cleared', { expectedCount, actualCount }, 'sqlite');
        return;
      }

      // Mismatch: restore from backup via idempotent INSERT OR IGNORE.
      let restored = 0;
      for (const record of payload.records) {
        try {
          const domain = record.domain || extractDomain(record.url);
          await this.execWithCache(INSERT_IGNORE_SQL, buildInsertParams(record, domain));
          restored++;
        } catch {
          // Skip rows that fail to insert; do not abort the whole restore.
        }
      }
      logWarn(
        'SQLite: IDB migration record count mismatch, restored from backup',
        { expectedCount, actualCount, restored },
        ErrorCode.MIGRATION_ROLLBACK_FAILED,
        'sqlite'
      );
      // Intentionally leave the backup in chrome.storage.local and the
      // IDB_MIGRATION_V2_DONE flag unset, so the next init retries
      // verification instead of silently accepting a partial migration.
    } catch (error) {
      logError(
        'SQLite: failed to process IDB migration backup',
        { error: errorMessage(error) },
        ErrorCode.MIGRATION_ROLLBACK_FAILED,
        'sqlite'
      );
    }
  }

  // ==========================================================================
  // Migration: Fallback → SQLite
  // ==========================================================================

  private async tryMigrateFallbackToSqlite(): Promise<void> {
    try {
      const tempFallback = new FallbackStorage();
      const records = await tempFallback.getAllRecords();

      if (records.length === 0) {
        // No records to migrate, but OPFS is available so clear the fallback flag
        try { await chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE); } catch { /* offscreen context */ }
        return;
      }

      if (!this.idbEngine) {
        return;
      }

      let migrated = 0;
      for (const record of records) {
        try {
          const domain = record.domain || extractDomain(record.url);
          await this.execWithCache(INSERT_IGNORE_SQL, buildInsertParams(record, domain));
          migrated++;
        } catch {
        }
      }

      if (migrated > 0) {
        logInfo(`SQLite: migrated ${migrated} records from fallback storage`, { migrated }, 'sqlite');
        await tempFallback.clearAll();
      }
      try { await chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE); } catch { /* offscreen context */ }
    } catch (error) {
      logError('SQLite: fallback migration failed', { error: errorMessage(error) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'sqlite');
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
  async execWithCache(
    sql: string,
    params: SqliteValue[] = [],
    callback?: (row: SqliteValue[]) => void
  ): Promise<void> {
    if (!callback) {
      await this.idbEngine!.exec(sql, params);
      return;
    }
    const rows = await this.idbEngine!.query(sql, params);
    for (const row of rows) {
      callback(Object.values(row as SqliteRow) as SqliteValue[]);
    }
  }

  /**
   * Ensure a storage backend is initialized and return the appropriate handler.
   * Priority: OPFS Worker > IDB VFS > FallbackStorage
   */
  async ensureBackend(): Promise<'opfs' | 'idb' | 'fallback' | 'none'> {
    // Already initialized?
    if (this.opfsWorker) return 'opfs';
    if (this.idbEngine) return 'idb';
    if (this.usingFallbackStorage && this.fallbackStorage) return 'fallback';

    // Try to initialize
    await this.init();

    // Re-check after init
    if (this.opfsWorker) return 'opfs';
    if (this.idbEngine) return 'idb';
    if (this.usingFallbackStorage && this.fallbackStorage) return 'fallback';

    return 'none';
  }

  async getBackend(): Promise<StorageBackend> {
    if (this._backend) return this._backend;

    // Ensure initialization has been attempted
    if (!this.opfsWorker && !this.idbEngine && !this.usingFallbackStorage) {
      await this.init();
    }

    // Try OPFS Worker only if it was successfully initialized
    if (this.opfsWorker) {
      try {
        const { OpfsWorkerBackend } = await import('./OpfsWorkerBackend.js');
        this._backend = new OpfsWorkerBackend(this);
        return this._backend;
      } catch {
        // fall through
      }
    }

    // Try IDB VFS
    try {
      if (!this.usingFallbackStorage) {
        await this.init();
        if (this.idbEngine) {
          const { IdbVfsBackend } = await import('./IdbVfsBackend.js');
          this._backend = new IdbVfsBackend(this);
          return this._backend;
        }
      }
    } catch {
      // fall through
    }

    // Try Fallback
    if (this.fallbackStorage) {
      const { FallbackStorageAdapter } = await import('./FallbackStorageAdapter.js');
      this._backend = new FallbackStorageAdapter(this.fallbackStorage);
      return this._backend;
    }

    // Null Object — never throw
    this._backend = new NoopBackend();
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

/**
 * Extract the domain from a URL string.
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Shared engine instance used by all repos (records, maintenance, audit log).
 * Mirrors the original sqlite.ts, which held this state at module scope.
 */
export const engine = new SqliteEngineContext();
