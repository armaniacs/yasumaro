/**
 * sqliteEngineContext.ts
 * Shared SQLite engine state and low-level plumbing (OPFS Worker proxying,
 * IDB/wa-sqlite initialization, prepared-statement cache, fallback storage)
 * used by recordsRepo.ts, dbMaintenance.ts, and auditLogRepo.ts.
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 */

import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import * as SQLite from 'wa-sqlite';
import { errorMessage } from '../utils/errorUtils.js';
import { logError, logInfo, ErrorCode } from '../utils/logger.js';
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js';
import { FallbackStorage } from './storageFallback.js';
import { LruCache } from './lruCache.js';
import { StorageKeys } from '../utils/storage/types.js';
import { SCHEMA_SQL, GIST_SYNCED_INDEX_SQL, FTS5_SQL, AUDIT_LOG_SCHEMA_SQL, INSERT_IGNORE_SQL, buildInsertParams } from './schema.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type SqliteValue = number | string | Uint8Array | Array<number> | bigint | null;

export const DB_FILENAME = 'yasumaro.db';

/** Hard cap on query()/search() result size, so a caller can't force the entire table into JS memory at once (M13). */
export const MAX_QUERY_LIMIT = 100000;

const PREPARED_STMT_CACHE_MAX_SIZE = 50;

/**
 * Owns all mutable engine state (db handle, OPFS worker, fallback storage,
 * prepared-statement cache) and the low-level helpers that operate on it.
 * A single module-level instance (`engine`, below) is shared by all repos —
 * this mirrors the original sqlite.ts, which had this state at module scope.
 */
export class SqliteEngineContext {
  dbHandle: number | null = null;
  sqlite3: SQLiteAPI | null = null;
  initPromise: Promise<boolean> | null = null;
  usingFallbackStorage = false;
  fallbackStorage: FallbackStorage | null = null;
  lastInitError: string | null = null;
  fts5Available = false;
  cachedCompileOptions: string[] | null = null;

  // OPFS Worker state
  opfsWorker: Worker | null = null;
  opfsRequestId = 0;
  opfsPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  preparedStmtCache = new LruCache<string, number>(PREPARED_STMT_CACHE_MAX_SIZE, (_key, stmt) => {
    this.sqlite3?.finalize(stmt).catch(() => {});
  });

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
    if (this.dbHandle) return true;
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

      // 2. Try IDBBatchAtomicVFS (IndexedDB) as fallback

      // Load the SQLite WASM module (async build for IDB VFS compatibility)
      const asyncModule = await SQLiteESMFactory();

      // Compatibility shim for wa-sqlite npm wrapper (v1.0.0)
      if (!asyncModule.registerVFS && typeof asyncModule.vfs_register === 'function') {
        asyncModule.registerVFS = asyncModule.vfs_register;
      }

      this.sqlite3 = SQLite.Factory(asyncModule);

      const VFS_NAME = 'idb-batch-atomic';
      const vfs = new IDBBatchAtomicVFS(VFS_NAME);

      // Compatibility shim for v1.0.0 IDBBatchAtomicVFS
      if (typeof (vfs as { hasAsyncMethod?: unknown }).hasAsyncMethod !== 'function') {
        (vfs as unknown as { hasAsyncMethod: (m: string) => boolean }).hasAsyncMethod = () => false;
      }

      // IDBBatchAtomicVFS の xRead シグネチャが SQLiteVFS と異なる場合があるためキャスト
      // wa-sqlite の example VFS と本体の型定義のバージョン差異によるもの
      this.sqlite3.vfs_register(vfs as unknown as SQLiteVFS, true);

      // Open the database on IndexedDB
      this.dbHandle = await this.sqlite3.open_v2(
        DB_FILENAME,
        SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE,
        VFS_NAME
      );

      // M32: Enable WAL mode before any schema/migration operations for journal consistency
      await this.sqlite3.exec(this.dbHandle, 'PRAGMA journal_mode=WAL;');
      await this.sqlite3.exec(this.dbHandle, 'PRAGMA wal_autocheckpoint=1000;');

      // Execute schema creation
      await this.sqlite3.exec(this.dbHandle, SCHEMA_SQL);
      await this.sqlite3.exec(this.dbHandle, AUDIT_LOG_SCHEMA_SQL);

      // Schema migration: add obsidian_synced column if not present (Phase 6)
      try {
        await this.sqlite3.exec(this.dbHandle, 'ALTER TABLE browsing_logs ADD COLUMN obsidian_synced INTEGER DEFAULT 0');
      } catch {
        // Column already exists — that's fine
      }

      // PBI-11: add gist_synced column for per-target sync flags
      try {
        await this.sqlite3.exec(this.dbHandle, 'ALTER TABLE browsing_logs ADD COLUMN gist_synced INTEGER DEFAULT 0');
      } catch {
        // Column already exists — that's fine
      }
      await this.sqlite3.exec(this.dbHandle, GIST_SYNCED_INDEX_SQL);

      // FTS5 virtual table (optional — WASM build may not include FTS5)
      this.fts5Available = false;
      try {
        await this.sqlite3.exec(this.dbHandle, FTS5_SQL);
        this.fts5Available = true;

        // I2: If base table has rows but FTS index is empty, rebuild the index.
        // This handles the case where rows existed before FTS triggers were added.
        try {
          let baseCount = 0;
          await this.execWithCache('SELECT COUNT(*) FROM browsing_logs', [], (row: SqliteValue[]) => { baseCount = Number(row[0]); });
          let ftsCount = 0;
          await this.execWithCache('SELECT COUNT(*) FROM browsing_logs_fts', [], (row: SqliteValue[]) => { ftsCount = Number(row[0]); });
          if (baseCount > 0 && ftsCount === 0) {
            console.info('SQLite IDB: FTS index empty, rebuilding...');
            await this.sqlite3.exec(this.dbHandle, "INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')");
            console.info('SQLite IDB: FTS index rebuild complete');
          }
        } catch (rebuildErr) {
          console.warn('SQLite IDB: FTS rebuild check failed:', rebuildErr);
        }
      } catch (ftsErr) {
        console.warn('SQLite: FTS5 not available, using LIKE-based search fallback', ftsErr);
      }

      // PBI-1: ALTER TABLE migration for new diagnostic metadata columns
      const newColumns = [
        'content TEXT',
        'masked_count INTEGER',
        'cleansed_reason TEXT',
        'ai_provider TEXT',
        'ai_model TEXT',
        'ai_duration_ms INTEGER',
        'obsidian_duration_ms INTEGER',
        'sent_tokens INTEGER',
        'received_tokens INTEGER',
        'original_tokens INTEGER',
        'cleansed_tokens INTEGER',
        'page_bytes INTEGER',
        'candidate_bytes INTEGER',
        'original_bytes INTEGER',
        'cleansed_bytes INTEGER',
        'ai_summary_original_bytes INTEGER',
        'ai_summary_cleansed_bytes INTEGER',
        'extracted_sentences_bytes INTEGER',
        'extracted_sentences_original_bytes INTEGER',
        'fallback_triggered INTEGER DEFAULT 0',
      ];

      for (const colDef of newColumns) {
        try {
          await this.sqlite3.exec(this.dbHandle, `ALTER TABLE browsing_logs ADD COLUMN ${colDef}`);
        } catch (err) {
          // Column already exists — safe to ignore
          // Log unexpected errors (disk full, corruption, etc.) so they are surfaced
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('duplicate column name')) {
            console.warn('SQLite: unexpected ALTER TABLE error:', msg);
          }
        }
      }

      // Log available extensions
      const compileOptions: string[] = [];
      await this.execWithCache('PRAGMA compile_options', [], (row: SqliteValue[]) => {
        compileOptions.push(String(row[0]));
      });
      this.cachedCompileOptions = compileOptions;
      // Attempt migration from fallback storage if it has data
      await this.tryMigrateFallbackToSqlite();

      return true;
    } catch (error) {
      this.lastInitError = errorMessage(error);
      console.error('SQLite: init failed', error);
      this.dbHandle = null;
      this.sqlite3 = null;
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

      if (!this.dbHandle || !this.sqlite3) {
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
  // Prepared Statement Cache
  // ==========================================================================

  private async getOrPrepare(sql: string): Promise<number> {
    const cached = this.preparedStmtCache.get(sql);
    if (cached !== undefined) {
      await this.sqlite3!.reset(cached);
      return cached;
    }

    const str = this.sqlite3!.str_new(this.dbHandle!, sql);
    try {
      const prepared = await this.sqlite3!.prepare_v2(this.dbHandle!, this.sqlite3!.str_value(str));
      if (!prepared) throw new Error(`Failed to prepare: ${sql}`);
      const stmt = prepared.stmt;

      this.preparedStmtCache.set(sql, stmt);
      return stmt;
    } finally {
      this.sqlite3!.str_finish(str);
    }
  }

  async execWithCache(
    sql: string,
    params: SqliteValue[] = [],
    callback?: (row: SqliteValue[]) => void
  ): Promise<void> {
    const stmt = await this.getOrPrepare(sql);

    if (params.length > 0) {
      this.sqlite3!.bind_collection(stmt, params);
    }

    try {
      if (callback) {
        while (await this.sqlite3!.step(stmt) === SQLite.SQLITE_ROW) {
          callback(this.sqlite3!.row(stmt));
        }
      } else {
        await this.sqlite3!.step(stmt);
      }
    } finally {
      await this.sqlite3!.reset(stmt);
    }
  }

  private clearPreparedStmtCache(): void {
    for (const stmt of this.preparedStmtCache.values()) {
      this.sqlite3?.finalize(stmt).catch(() => {});
    }
    this.preparedStmtCache.clear();
  }

  /**
   * Ensure a storage backend is initialized and return the appropriate handler.
   * Priority: OPFS Worker > IDBBatchAtomicVFS > FallbackStorage
   */
  async ensureBackend(): Promise<'opfs' | 'idb' | 'fallback' | 'none'> {
    // Already initialized?
    if (this.opfsWorker) return 'opfs';
    if (this.dbHandle) return 'idb';
    if (this.usingFallbackStorage && this.fallbackStorage) return 'fallback';

    // Try to initialize
    await this.init();

    // Re-check after init
    if (this.opfsWorker) return 'opfs';
    if (this.dbHandle) return 'idb';
    if (this.usingFallbackStorage && this.fallbackStorage) return 'fallback';

    return 'none';
  }

  /** Reset the module state for testing. */
  resetForTesting(): void {
    this.clearPreparedStmtCache();
    this.dbHandle = null;
    this.sqlite3 = null;
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
