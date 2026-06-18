/**
 * sqlite.ts
 * SQLite (wa-sqlite + OPFS) operations for the offscreen document.
 * Provides CRUD operations and FTS5 full-text search for browsing logs.
 */

import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import * as SQLite from 'wa-sqlite';
import { errorMessage } from '../utils/errorUtils.js';
import { logError, logWarn, logInfo, ErrorCode } from '../utils/logger.js';
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js';
import { FallbackStorage } from './storageFallback.js';
import { StorageKeys } from '../utils/storage/types.js';

// The wa-sqlite package uses ambient type declarations for SQLiteAPI and SQLiteCompatibleType
// that are not directly exported. We define local aliases for the types we need.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type SqliteValue = number | string | Uint8Array | null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type WaSqliteAPI = any;

/** Column names allowed in ORDER BY clauses (prevents SQL injection). */
const ALLOWED_ORDER_COLUMNS = [
  'id', 'url', 'title', 'summary', 'tags', 'created_at',
  'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
] as const;

// ============================================================================
// Schema definition
// ============================================================================

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS browsing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    tags TEXT,
    created_at INTEGER NOT NULL,
    domain TEXT,
    visit_duration INTEGER CHECK(visit_duration IS NULL OR visit_duration >= 0),
    scroll_ratio REAL CHECK(scroll_ratio IS NULL OR (scroll_ratio >= 0 AND scroll_ratio <= 1)),
    is_starred INTEGER DEFAULT 0 CHECK(is_starred IN (0, 1)),
    is_deleted INTEGER DEFAULT 0 CHECK(is_deleted IN (0, 1)),
    obsidian_synced INTEGER DEFAULT 0,
    UNIQUE(url, created_at)
  );

  CREATE INDEX IF NOT EXISTS idx_logs_created ON browsing_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_domain ON browsing_logs(domain);
  CREATE INDEX IF NOT EXISTS idx_logs_active ON browsing_logs(is_deleted, created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_obsidian ON browsing_logs(obsidian_synced);
`;

const FTS5_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS browsing_logs_fts USING fts5(
    url, title, summary, tags,
    content='browsing_logs',
    content_rowid='id',
    tokenize='trigram'
  );

  -- Triggers to keep FTS index in sync with the main table
  CREATE TRIGGER IF NOT EXISTS browsing_logs_ai AFTER INSERT ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS browsing_logs_ad AFTER DELETE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS browsing_logs_au AFTER UPDATE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END;
`;

const DB_FILENAME = 'yasumaro.db';

// ============================================================================
// Types
// ============================================================================

import type { BrowsingLogRecord, QueryOptions, SearchResult } from '../utils/sqlite-types.js';

// ============================================================================
// Module-level state
// ============================================================================

let dbHandle: number | null = null;
let sqlite3: WaSqliteAPI | null = null;
let initPromise: Promise<boolean> | null = null;
let usingFallbackStorage = false;
let fallbackStorage: FallbackStorage | null = null;
let lastInitError: string | null = null;
let fts5Available = false;
let cachedCompileOptions: string[] | null = null;

// OPFS Worker state
let opfsWorker: Worker | null = null;
let opfsRequestId = 0;
const opfsPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

const PREPARED_STMT_CACHE_MAX_SIZE = 50;
const preparedStmtCache = new Map<string, number>();

// ============================================================================
// OPFS Worker Proxy
// ============================================================================

function isOpfsAvailable(): boolean {
  try {
    return typeof navigator?.storage?.getDirectory === 'function';
  } catch {
    return false;
  }
}

function canCreateWorker(): boolean {
  try {
    return typeof (globalThis as any).Worker !== 'undefined';
  } catch {
    return false;
  }
}

function createOpfsWorker(): Worker | null {
  try {
    const worker = new Worker(
      new URL('./opfsWorker.js', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent<{ id: number; success: boolean; result?: unknown; error?: string }>) => {
      const { id, success, result, error } = e.data;
      const pending = opfsPending.get(id);
      if (pending) {
        opfsPending.delete(id);
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
      for (const [id, pending] of opfsPending) {
        pending.reject(new Error(`OPFS Worker error: ${e.message}`));
        opfsPending.delete(id);
      }
    };

    return worker;
  } catch (err) {
    console.warn('Failed to create OPFS Worker:', errorMessage(err));
    return null;
  }
}

function sendToOpfsWorker(type: string, payload?: unknown): Promise<unknown> {
  if (!opfsWorker) {
    return Promise.reject(new Error('OPFS Worker not available'));
  }

  const id = ++opfsRequestId;
  return new Promise((resolve, reject) => {
    opfsPending.set(id, { resolve, reject });

    // Timeout after 15 seconds
    const timeout = setTimeout(() => {
      opfsPending.delete(id);
      reject(new Error(`OPFS Worker timeout: ${type}`));
    }, 15000);

    const originalResolve = resolve;
    const originalReject = reject;

    opfsPending.set(id, {
      resolve: (v) => { clearTimeout(timeout); originalResolve(v); },
      reject: (e) => { clearTimeout(timeout); originalReject(e); },
    });

    opfsWorker!.postMessage({ id, type, payload });
  });
}

async function initOpfsWorker(): Promise<boolean> {
  try {
    if (!isOpfsAvailable()) {
      console.log('OPFS: not available (missing getDirectory or createSyncAccessHandle)');
      return false;
    }

    if (!canCreateWorker()) {
      console.log('OPFS: Worker constructor not available');
      return false;
    }

    opfsWorker = createOpfsWorker();
    if (!opfsWorker) {
      console.log('OPFS: failed to create Worker');
      return false;
    }

    // Send INIT to the worker
    const result = await sendToOpfsWorker('INIT') as { initialized: boolean } | undefined;
    if (result?.initialized) {
      console.log('OPFS: Worker initialized successfully');
      return true;
    }

    console.warn('OPFS: Worker INIT returned unexpected result:', result);
    return false;
  } catch (err) {
    console.warn('OPFS: Worker init failed:', errorMessage(err));
    return false;
  }
}

function terminateOpfsWorker(): void {
  if (opfsWorker) {
    opfsWorker.terminate();
    opfsWorker = null;
    for (const [, pending] of opfsPending) {
      pending.reject(new Error('OPFS Worker terminated'));
    }
    opfsPending.clear();
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the SQLite database. Safe to call multiple times —
 * subsequent calls are no-ops.
 */
export async function init(): Promise<boolean> {
  if (opfsWorker) return true;
  if (dbHandle) return true;
  if (usingFallbackStorage) return false;
  if (initPromise) return initPromise;

  initPromise = _doInit();
  return initPromise;
}

async function _doInit(): Promise<boolean> {
  try {
    // 1. Try OPFS Worker first (preferred — persistent, fast)
    const opfsOk = await initOpfsWorker();
    if (opfsOk) {
      console.log('SQLite: using OPFS Worker (OPFSCoopSyncVFS + FTS5)');
      fts5Available = true; // new engine includes FTS5
      return true;
    }

    // 2. Try IDBBatchAtomicVFS (IndexedDB) as fallback
    console.log('SQLite: OPFS not available, trying IDBBatchAtomicVFS');

    // Load the SQLite WASM module (async build for IDB VFS compatibility)
    const asyncModule = await SQLiteESMFactory();

    // Compatibility shim for wa-sqlite npm wrapper (v1.0.0)
    if (!asyncModule.registerVFS && typeof asyncModule.vfs_register === 'function') {
      asyncModule.registerVFS = asyncModule.vfs_register;
    }

    sqlite3 = SQLite.Factory(asyncModule);

    const VFS_NAME = 'idb-batch-atomic';
    const vfs = new IDBBatchAtomicVFS(VFS_NAME);

    // Compatibility shim for v1.0.0 IDBBatchAtomicVFS
    if (typeof (vfs as { hasAsyncMethod?: unknown }).hasAsyncMethod !== 'function') {
      (vfs as unknown as { hasAsyncMethod: (m: string) => boolean }).hasAsyncMethod = () => false;
    }

    sqlite3.vfs_register(vfs, true);

    // Open the database on IndexedDB
    dbHandle = await sqlite3.open_v2(
      DB_FILENAME,
      SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE,
      VFS_NAME
    );

    // Execute schema creation
    await sqlite3.exec(dbHandle, SCHEMA_SQL);

    // Schema migration: add obsidian_synced column if not present (Phase 6)
    try {
      await sqlite3.exec(dbHandle, 'ALTER TABLE browsing_logs ADD COLUMN obsidian_synced INTEGER DEFAULT 0');
    } catch {
      // Column already exists — that's fine
    }

    // FTS5 virtual table (optional — WASM build may not include FTS5)
    fts5Available = false;
    try {
      await sqlite3.exec(dbHandle, FTS5_SQL);
      fts5Available = true;

      // I2: If base table has rows but FTS index is empty, rebuild the index.
      // This handles the case where rows existed before FTS triggers were added.
      try {
        let baseCount = 0;
        await execWithCache('SELECT COUNT(*) FROM browsing_logs', [], (row: SqliteValue[]) => { baseCount = Number(row[0]); });
        let ftsCount = 0;
        await execWithCache('SELECT COUNT(*) FROM browsing_logs_fts', [], (row: SqliteValue[]) => { ftsCount = Number(row[0]); });
        if (baseCount > 0 && ftsCount === 0) {
          console.info('SQLite IDB: FTS index empty, rebuilding...');
          await sqlite3.exec(dbHandle, "INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')");
          console.info('SQLite IDB: FTS index rebuild complete');
        }
      } catch (rebuildErr) {
        console.warn('SQLite IDB: FTS rebuild check failed:', rebuildErr);
      }
    } catch (ftsErr) {
      console.warn('SQLite: FTS5 not available, using LIKE-based search fallback', ftsErr);
    }

    // Log available extensions
    const compileOptions: string[] = [];
    await execWithCache('PRAGMA compile_options', [], (row: SqliteValue[]) => {
      compileOptions.push(String(row[0]));
    });
    cachedCompileOptions = compileOptions;
    console.log('SQLite compile options:', compileOptions.filter(o => o.includes('FTS') || o.includes('VFS')));

    // Enable WAL mode for better concurrent read performance
    await sqlite3.exec(dbHandle, 'PRAGMA journal_mode=WAL;');
    await sqlite3.exec(dbHandle, 'PRAGMA wal_autocheckpoint=1000;');

    // Attempt migration from fallback storage if it has data
    await tryMigrateFallbackToSqlite();

    console.log('SQLite: using IDBBatchAtomicVFS (IndexedDB)');
    return true;
  } catch (error) {
    lastInitError = errorMessage(error);
    console.error('SQLite: init failed', error);
    dbHandle = null;
    sqlite3 = null;
    initPromise = null;

    // If OPFS Worker was created but failed, clean it up
    if (opfsWorker) {
      terminateOpfsWorker();
    }

    // Fall back to chrome.storage.local when both OPFS and IDB are unavailable
    usingFallbackStorage = true;
    fallbackStorage = new FallbackStorage();
    try { await chrome.storage.local.set({ [StorageKeys.OPFS_FALLBACK_MODE]: true }); } catch { /* offscreen context */ }
    return false;
  }
}

// ============================================================================
// Migration: Fallback → SQLite
// ============================================================================

async function tryMigrateFallbackToSqlite(): Promise<void> {
  try {
    const tempFallback = new FallbackStorage();
    const records = await tempFallback.getAllRecords();

    if (records.length === 0) {
      // No records to migrate, but OPFS is available so clear the fallback flag
      try { await chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE); } catch { /* offscreen context */ }
      return;
    }

    if (!dbHandle || !sqlite3) {
      return;
    }

    let migrated = 0;
    const insertSql = `INSERT OR IGNORE INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    for (const record of records) {
      try {
        const domain = record.domain || extractDomain(record.url);
        await execWithCache(insertSql, [
          record.url,
          record.title ?? null,
          record.summary ?? null,
          record.tags ?? null,
          record.created_at,
          domain,
          record.visit_duration ?? null,
          record.scroll_ratio ?? null,
          record.is_starred ?? 0,
          record.is_deleted ?? 0,
        ]);
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

// ============================================================================
// Prepared Statement Cache
// ============================================================================

async function getOrPrepare(sql: string): Promise<number> {
  const cached = preparedStmtCache.get(sql);
  if (cached !== undefined) {
    await sqlite3!.reset(cached);
    return cached;
  }

  const str = sqlite3!.str_new(dbHandle!, sql);
  try {
    const prepared = await sqlite3!.prepare_v2(dbHandle!, sqlite3!.str_value(str));
    if (!prepared) throw new Error(`Failed to prepare: ${sql}`);
    const stmt = prepared.stmt;

    if (preparedStmtCache.size >= PREPARED_STMT_CACHE_MAX_SIZE) {
      const oldestKey = preparedStmtCache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldestStmt = preparedStmtCache.get(oldestKey);
        if (oldestStmt !== undefined) {
          await sqlite3!.finalize(oldestStmt);
        }
        preparedStmtCache.delete(oldestKey);
      }
    }

    preparedStmtCache.set(sql, stmt);
    return stmt;
  } finally {
    sqlite3!.str_finish(str);
  }
}

async function execWithCache(
  sql: string,
  params: SqliteValue[] = [],
  callback?: (row: SqliteValue[]) => void
): Promise<void> {
  const stmt = await getOrPrepare(sql);

  if (params.length > 0) {
    sqlite3!.bind_collection(stmt, params);
  }

  try {
    if (callback) {
      while (await sqlite3!.step(stmt) === SQLite.SQLITE_ROW) {
        callback(sqlite3!.row(stmt));
      }
    } else {
      await sqlite3!.step(stmt);
    }
  } finally {
    await sqlite3!.reset(stmt);
  }
}

function clearPreparedStmtCache(): void {
  for (const stmt of preparedStmtCache.values()) {
    sqlite3?.finalize(stmt).catch(() => {});
  }
  preparedStmtCache.clear();
}

// ============================================================================
// OPFS Worker CRUD proxy helpers
// ============================================================================

/**
 * Try to proxy a call to the OPFS Worker. Returns the result if the Worker
 * is available and succeeds, otherwise returns null (caller should use fallback).
 */
async function tryOpfsProxy<T>(type: string, payload?: unknown): Promise<T | null> {
  if (!opfsWorker) return null;
  try {
    return await sendToOpfsWorker(type, payload) as T;
  } catch (err) {
    console.warn(`OPFS Worker call failed (${type}), falling back:`, errorMessage(err));
    return null;
  }
}

/**
 * Ensure a storage backend is initialized and return the appropriate handler.
 * Priority: OPFS Worker > IDBBatchAtomicVFS > FallbackStorage
 */
async function ensureBackend(): Promise<'opfs' | 'idb' | 'fallback' | 'none'> {
  // Already initialized?
  if (opfsWorker) return 'opfs';
  if (dbHandle) return 'idb';
  if (usingFallbackStorage && fallbackStorage) return 'fallback';

  // Try to initialize
  await init();

  // Re-check after init
  if (opfsWorker) return 'opfs';
  if (dbHandle) return 'idb';
  if (usingFallbackStorage && fallbackStorage) return 'fallback';

  return 'none';
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Insert a new browsing log record and return the auto-generated row id.
 */
export async function insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  try {
    // OPFS Worker path
    if (opfsWorker) {
      const result = await sendToOpfsWorker('INSERT', record) as { id: number };
      return { success: true, id: result.id };
    }

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (opfsWorker) {
      const result = await sendToOpfsWorker('INSERT', record) as { id: number };
      return { success: true, id: result.id };
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.insert(record);
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const domain = record.domain || extractDomain(record.url);

    await execWithCache(
      `INSERT INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.url,
        record.title ?? null,
        record.summary ?? null,
        record.tags ?? null,
        record.created_at,
        domain,
        record.visit_duration ?? null,
        record.scroll_ratio ?? null,
        record.is_starred ?? 0,
        record.is_deleted ?? 0,
      ]
    );

    let newId = 0;
    await execWithCache('SELECT last_insert_rowid()', [], (row: SqliteValue[]) => {
      newId = Number(row[0]);
    });

    return { success: true, id: newId };
  } catch (error) {
    logError('SQLite: insert failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Insert a batch of records atomically using a transaction.
 * Uses INSERT OR IGNORE to handle UNIQUE constraint violations (url, created_at).
 */
export async function insertBatch(records: BrowsingLogRecord[]): Promise<{ success: true; count: number } | { success: false; error: string }> {
  if (records.length === 0) {
    return { success: true, count: 0 };
  }

  try {
    const opfsResult = await tryOpfsProxy<{ count: number }>('INSERT_BATCH', records);
    if (opfsResult !== null) return { success: true, count: opfsResult.count };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.insertBatch(records);
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await sqlite3!.exec(dbHandle!, 'BEGIN IMMEDIATE');

    try {
      let insertedCount = 0;
      const insertSql = `INSERT OR IGNORE INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      for (const record of records) {
        const domain = record.domain || extractDomain(record.url);

        await execWithCache(insertSql, [
          record.url,
          record.title ?? null,
          record.summary ?? null,
          record.tags ?? null,
          record.created_at,
          domain,
          record.visit_duration ?? null,
          record.scroll_ratio ?? null,
          record.is_starred ?? 0,
          record.is_deleted ?? 0,
        ]);

        let changes = 0;
        await execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
          changes = Number(row[0]);
        });
        insertedCount += changes;
      }

      await sqlite3!.exec(dbHandle!, 'COMMIT');
      return { success: true, count: insertedCount };
    } catch (innerError) {
      await sqlite3!.exec(dbHandle!, 'ROLLBACK');
      throw innerError;
    }
  } catch (error) {
    logError('SQLite: insertBatch failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Query browsing logs with optional filters.
 */
export async function query(options: QueryOptions = {}): Promise<{
  success: true; rows: BrowsingLogRecord[]; total: number
} | { success: false; error: string }> {
  try {
    // OPFS Worker proxy
    const opfsResult = await tryOpfsProxy<{ rows: BrowsingLogRecord[]; total: number }>('QUERY', {
      limit: options.limit, offset: options.offset, since: options.since, until: options.until,
      domain: options.domain, isStarred: options.isStarred, orderBy: options.orderBy, orderDir: options.orderDir,
      ids: options.ids,
    });
    if (opfsResult !== null) return { success: true, rows: opfsResult.rows, total: opfsResult.total };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.query(options);
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const conditions: string[] = [];
    const params: SqliteValue[] = [];

    if (options.excludeDeleted !== false) {
      conditions.push('is_deleted = 0');
    }
    if (options.domain) {
      conditions.push('domain = ?');
      params.push(options.domain);
    }
    if (options.isStarred !== undefined) {
      conditions.push('is_starred = ?');
      params.push(options.isStarred ? 1 : 0);
    }
    if (options.since !== undefined) {
      conditions.push('created_at >= ?');
      params.push(options.since);
    }
    if (options.until !== undefined) {
      conditions.push('created_at <= ?');
      params.push(options.until);
    }
    if (options.ids !== undefined && Array.isArray(options.ids) && options.ids.length > 0) {
      const placeholders = options.ids.map(() => '?').join(',');
      conditions.push(`id IN (${placeholders})`);
      params.push(...options.ids);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = options.orderBy && ALLOWED_ORDER_COLUMNS.includes(options.orderBy as typeof ALLOWED_ORDER_COLUMNS[number])
      ? options.orderBy : 'created_at';
    const orderDir = options.orderDir === 'ASC' ? 'ASC' : 'DESC';
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const countSql = `SELECT COUNT(*) FROM browsing_logs ${whereClause}`;
    let total = 0;
    await execWithCache(countSql, params, (row: SqliteValue[]) => {
      total = Number(row[0]);
    });

    const selectSql = `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted
         FROM browsing_logs ${whereClause}
         ORDER BY ${orderBy} ${orderDir}
         LIMIT ? OFFSET ?`;
    const rows: BrowsingLogRecord[] = [];
    await execWithCache(selectSql, [...params, limit, offset], (row: SqliteValue[]) => {
      rows.push({
        id: Number(row[0]),
        url: String(row[1]),
        title: row[2] as string | null,
        summary: row[3] as string | null,
        tags: row[4] as string | null,
        created_at: Number(row[5]),
        domain: row[6] as string | null,
        visit_duration: row[7] != null ? Number(row[7]) : null,
        scroll_ratio: row[8] != null ? Number(row[8]) : null,
        is_starred: Number(row[9]),
        is_deleted: Number(row[10]),
      });
    });

    return { success: true, rows, total };
  } catch (error) {
    logError('SQLite: query failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Full-text search using FTS5.
 */
export async function search(searchQuery: string, limit: number = 50, offset: number = 0): Promise<{
  success: true; rows: SearchResult[]; total: number
} | { success: false; error: string }> {
  try {
    // OPFS Worker: real FTS5 search via the worker's SEARCH handler.
    const opfsResult = await tryOpfsProxy<{ rows: SearchResult[]; total: number }>('SEARCH', {
      searchQuery, limit, offset,
    });
    if (opfsResult !== null) {
      return { success: true, rows: opfsResult.rows, total: opfsResult.total };
    }

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.search(searchQuery, limit, offset);
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    // FTS5 full-text search (preferred) or LIKE-based fallback.
    // trigram MATCH requires >= 3 unicode code points; shorter terms fall back to LIKE.
    const bare = sanitizeFtsTerm(searchQuery);
    // Empty/punctuation-only input: return early with empty results (consistent with OPFS path).
    if (!bare) {
      return { success: true, rows: [], total: 0 };
    }
    const charLen = [...bare].length;
    if (fts5Available && charLen >= 3) {
      const ftsQuery = `"${bare}"`;

      let total = 0;
      await execWithCache(
        `SELECT COUNT(*) FROM browsing_logs_fts WHERE browsing_logs_fts MATCH ?`,
        [ftsQuery],
        (row: SqliteValue[]) => {
          total = Number(row[0]);
        }
      );

      const rows: SearchResult[] = [];
      await execWithCache(
        `SELECT
           b.id, b.url, b.title, b.summary, b.tags,
           b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred,
           rank
         FROM browsing_logs_fts
         JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
         WHERE browsing_logs_fts MATCH ?
           AND b.is_deleted = 0
         ORDER BY rank
         LIMIT ? OFFSET ?`,
        [ftsQuery, limit, offset],
        (row: SqliteValue[]) => {
          rows.push({
            id: Number(row[0]),
            url: String(row[1]),
            title: row[2] as string | null,
            summary: row[3] as string | null,
            tags: row[4] as string | null,
            created_at: Number(row[5]),
            domain: row[6] as string | null,
            visit_duration: row[7] != null ? Number(row[7]) : null,
            scroll_ratio: row[8] != null ? Number(row[8]) : null,
            is_starred: Number(row[9]),
            rank: Number(row[10]),
          });
        }
      );

      return { success: true, rows, total };
    }

    // LIKE-based fallback: FTS5 not available, or query is < 3 unicode chars (trigram can't match)
    const likePattern = `%${searchQuery}%`;
    let total = 0;
    await execWithCache(
      `SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)`,
      [likePattern, likePattern, likePattern, likePattern],
      (row: SqliteValue[]) => {
        total = Number(row[0]);
      }
    );

    const rows: SearchResult[] = [];
    await execWithCache(
      `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred
       FROM browsing_logs
       WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [likePattern, likePattern, likePattern, likePattern, limit, offset],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]),
          url: String(row[1]),
          title: row[2] as string | null,
          summary: row[3] as string | null,
          tags: row[4] as string | null,
          created_at: Number(row[5]),
          domain: row[6] as string | null,
          visit_duration: row[7] != null ? Number(row[7]) : null,
          scroll_ratio: row[8] != null ? Number(row[8]) : null,
          is_starred: Number(row[9]),
          rank: 0,
        });
      }
    );

    return { success: true, rows, total };
  } catch (error) {
    logError('SQLite: search failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Update a browsing log record by id.
 */
export async function update(id: number, changes: Partial<BrowsingLogRecord>): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const opfsResult = await tryOpfsProxy<{ updated: boolean }>('UPDATE', { id, changes });
    if (opfsResult !== null) return { success: true };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.update(id, changes);
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const setClauses: string[] = [];
    const params: SqliteValue[] = [];

    const updatableFields: (keyof BrowsingLogRecord)[] = [
      'url', 'title', 'summary', 'tags', 'domain',
      'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted'
    ];

    for (const field of updatableFields) {
      if (field in changes) {
        setClauses.push(`${field} = ?`);
        params.push(changes[field] ?? null);
      }
    }

    if (setClauses.length === 0) {
      return { success: true };
    }

    params.push(id);
    await execWithCache(
      `UPDATE browsing_logs SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    return { success: true };
  } catch (error) {
    logError('SQLite: update failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Hard-delete a browsing log record by id (physical DELETE, GDPR Art.17).
 * FTS5 triggers automatically clean up the FTS index.
 */
export async function hardDelete(id: number): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const opfsResult = await tryOpfsProxy<{ deleted: boolean }>('DELETE', id);
    if (opfsResult !== null) return { success: true };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.hardDelete(id);
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await execWithCache('DELETE FROM browsing_logs WHERE id = ?', [id]);
    return { success: true };
  } catch (error) {
    logError('SQLite: hardDelete failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Toggle the starred status of a record.
 */
export async function toggleStar(id: number): Promise<{ success: true; is_starred: number } | { success: false; error: string }> {
  try {
    const opfsResult = await tryOpfsProxy<{ is_starred: number }>('TOGGLE_STAR', id);
    if (opfsResult !== null) return { success: true, is_starred: opfsResult.is_starred };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.toggleStar(id);
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await execWithCache(
      'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?',
      [id]
    );
    let newStarred = 0;
    await execWithCache(
      'SELECT is_starred FROM browsing_logs WHERE id = ?',
      [id],
      (row: SqliteValue[]) => {
        newStarred = Number(row[0]);
      }
    );
    return { success: true, is_starred: newStarred };
  } catch (error) {
    logError('SQLite: toggleStar failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Get the total number of records (excluding soft-deleted).
 */
export async function getCount(): Promise<{ success: true; count: number } | { success: false; error: string }> {
  try {
    const opfsResult = await tryOpfsProxy<{ count: number }>('GET_COUNT');
    if (opfsResult !== null) return { success: true, count: opfsResult.count };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.getCount();
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    let count = 0;
    await execWithCache(
      'SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0',
      [],
      (row: SqliteValue[]) => {
        count = Number(row[0]);
      }
    );

    return { success: true, count };
  } catch (error) {
    logError('SQLite: getCount failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Check if the database is initialized and accessible.
 */
export async function getStatus(): Promise<{ success: true; initialized: boolean; path: string; fallback: boolean; initError?: string; fts5: boolean; compileOptions?: string[]; compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback' } | { success: false; error: string }> {
  try {
    // OPFS Worker path
    const opfsResult = await tryOpfsProxy<{ initialized: boolean; path: string; fallback: boolean; fts5: boolean; count: number; compileOptions?: string[] }>('STATUS');
    if (opfsResult !== null) {
      return { success: true, initialized: opfsResult.initialized, path: opfsResult.path, fallback: opfsResult.fallback, fts5: opfsResult.fts5, compileOptions: opfsResult.compileOptions, compileOptionsSource: 'opfs-worker' };
    }

    if (usingFallbackStorage && fallbackStorage) {
      const countResult = await fallbackStorage.getCount();
      const count = countResult.success ? countResult.count : 0;
      return { success: true, initialized: count >= 0, path: 'chrome.storage.local', fallback: true, fts5: false, compileOptionsSource: 'fallback' };
    }

    if (!dbHandle || !sqlite3) {
      // Try to initialize if not yet initialized (consistent with query/search)
      await init();
      // If init switched to fallback, return fallback status
      if (usingFallbackStorage && fallbackStorage) {
        return { success: true, initialized: true, path: 'chrome.storage.local', fallback: true, fts5: false, compileOptionsSource: 'fallback' };
      }
      if (!dbHandle) {
        return { success: true, initialized: false, path: DB_FILENAME, fallback: false, initError: lastInitError || 'Init returned false', fts5: false, compileOptionsSource: 'idb' };
      }
    }

    let count = 0;
    await execWithCache(
      'SELECT COUNT(*) FROM browsing_logs',
      [],
      (row: SqliteValue[]) => {
        count = Number(row[0]);
      }
    );

    return { success: true, initialized: true, path: DB_FILENAME, fallback: false, fts5: fts5Available, compileOptions: cachedCompileOptions ?? undefined, compileOptionsSource: 'idb' };
  } catch (error) {
    logError('SQLite: getStatus failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Clear all browsing logs from the database (GDPR Art.17 hard delete).
 */
export async function clearAll(): Promise<{ success: boolean; error?: string }> {
  try {
    const opfsResult = await tryOpfsProxy<{ cleared: boolean }>('CLEAR_ALL');
    if (opfsResult !== null) return { success: true };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.clearAll();
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await sqlite3!.exec(dbHandle!, `BEGIN IMMEDIATE;
      DELETE FROM browsing_logs;
      DELETE FROM browsing_logs_fts;
      COMMIT;
    `);

    await sqlite3!.exec(dbHandle!, 'PRAGMA wal_checkpoint(TRUNCATE);');

    return { success: true };
  } catch (error) {
    logError('SQLite: clearAll failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

// ============================================================================
// Data Retention
// ============================================================================

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MAX_RECORDS = 1000;

/**
 * Purge old browsing log records based on retention policy.
 * Deletes records older than retentionDays (excluding starred items).
 * If total non-deleted records still exceed maxRecords, deletes oldest non-starred.
 */
export async function purgeOldRecords(
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  maxRecords: number = DEFAULT_MAX_RECORDS
): Promise<{ success: true; purged: number } | { success: false; error: string }> {
  try {
    const opfsResult = await tryOpfsProxy<{ purged: number }>('PURGE', { retentionDays, maxRecords });
    if (opfsResult !== null) return { success: true, purged: opfsResult.purged };

if (!dbHandle && !usingFallbackStorage) {
await init();
}

if (usingFallbackStorage && fallbackStorage) {
return fallbackStorage.purgeOldRecords(retentionDays, maxRecords);
}

if (!dbHandle) {
return { success: false, error: 'Database not initialized' };
}

    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let totalPurged = 0;

    await execWithCache(
      `DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0`,
      [cutoffMs]
    );

    let changes1 = 0;
    await execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
      changes1 = Number(row[0]);
    });
    totalPurged += changes1;

    let totalCount = 0;
    await execWithCache(
      'SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0',
      [],
      (row: SqliteValue[]) => {
        totalCount = Number(row[0]);
      }
    );

    if (totalCount > maxRecords) {
      const excess = totalCount - maxRecords;
      await execWithCache(
        `DELETE FROM browsing_logs WHERE id IN (
          SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0
          ORDER BY created_at ASC LIMIT ?
        )`,
        [excess]
      );

      let changes2 = 0;
      await execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
        changes2 = Number(row[0]);
      });
      totalPurged += changes2;
    }

    return { success: true, purged: totalPurged };
  } catch (error) {
    logError('SQLite: purgeOldRecords failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

// ============================================================================
// FTS5 Index Monitoring
// ============================================================================

const FTS_INDEX_WARNING_THRESHOLD = 10_000;

/**
 * Get the number of entries in the FTS5 index.
 */
export async function getFtsIndexSize(): Promise<{ success: true; count: number } | { success: false; error: string }> {
  try {
    // OPFS Worker: no FTS in sync build, always return 0
    const opfsResult = await tryOpfsProxy<{ count: number }>('FTS_INDEX_SIZE');
    if (opfsResult !== null) return { success: true, count: opfsResult.count };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return { success: true, count: 0 };
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    let count = 0;
    await execWithCache(
      'SELECT COUNT(*) FROM browsing_logs_fts',
      [],
      (row: SqliteValue[]) => {
        count = Number(row[0]);
      }
    );

    return { success: true, count };
  } catch (error) {
    logError('SQLite: getFtsIndexSize failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Check FTS5 index health and log a warning if it exceeds the threshold.
 * Returns the current FTS index size.
 */
export async function checkFtsIndexHealth(): Promise<{ count: number; warning: boolean }> {
  const result = await getFtsIndexSize();
  if (!result.success) {
    return { count: 0, warning: false };
  }

  const warning = result.count > FTS_INDEX_WARNING_THRESHOLD;
  if (warning) {
    logWarn('FTS index is large; consider evaluation', { count: result.count }, undefined, 'sqlite');
  }

  return { count: result.count, warning };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the domain from a URL string.
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Sanitize user input for FTS5 query syntax.
 * Uses a whitelist approach to prevent SQL injection via FTS5 operators.
 */
const FTS_QUERY_MAX_LENGTH = 200;

/**
 * Returns the sanitized bare term (no surrounding quotes).
 * Used for length-checking before deciding FTS5 vs LIKE.
 */
function sanitizeFtsTerm(query: string): string {
  if (!query) return '';

  // Limit input length to prevent DoS via extremely long queries
  const truncated = query.slice(0, FTS_QUERY_MAX_LENGTH);

  // Whitelist: only allow alphanumeric, CJK characters, and spaces
  // This prevents FTS5 operator injection (OR, AND, NOT, NEAR, etc.)
  // and special character injection (*, ", ~, ^, :, (, ), +, -)
  return truncated
    .replace(/[^A-Za-z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export all browsing_logs as a JSON Uint8Array (NOT a SQLite binary .db file).
 * For true SQLite binary serialization, use wa-sqlite backup API.
 */
export async function serialize(): Promise<{ success: true; data: Uint8Array } | { success: false; error: string }> {
  try {
    const opfsResult = await tryOpfsProxy<Uint8Array>('SERIALIZE');
    if (opfsResult !== null) return { success: true, data: opfsResult };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      const queryResult = await fallbackStorage.query({ excludeDeleted: true, orderBy: 'created_at', orderDir: 'DESC', limit: 100000 });
      if (!queryResult.success) {
        return { success: false, error: queryResult.error };
      }
      const rows = queryResult.rows.map(r => ({
        id: r.id,
        url: r.url,
        title: r.title,
        summary: r.summary,
        tags: r.tags,
        created_at: r.created_at,
        domain: r.domain,
        visit_duration: r.visit_duration,
        scroll_ratio: r.scroll_ratio,
        is_starred: r.is_starred,
        is_deleted: r.is_deleted,
      }));
      const json = JSON.stringify({ version: 1, table: 'browsing_logs', rows }, null, 2);
      const encoder = new TextEncoder();
      return { success: true, data: encoder.encode(json) };
    }

    // Export all rows as a JSON byte array
    // (wa-sqlite doesn't support sqlite3_serialize; for true .db export use backup API)
    const rows: Record<string, unknown>[] = [];
    await execWithCache(
      `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted
       FROM browsing_logs WHERE is_deleted = 0 ORDER BY created_at DESC`,
      [],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]),
          url: String(row[1]),
          title: row[2],
          summary: row[3],
          tags: row[4],
          created_at: Number(row[5]),
          domain: row[6],
          visit_duration: row[7],
          scroll_ratio: row[8],
          is_starred: Number(row[9]),
          is_deleted: Number(row[10]),
        });
      }
    );

    const json = JSON.stringify({ version: 1, table: 'browsing_logs', rows }, null, 2);
    const encoder = new TextEncoder();
    return { success: true, data: encoder.encode(json) };
  } catch (error) {
    logError('SQLite: serialize failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

// ============================================================================
// Testing helper
// ============================================================================

/** Reset the module state for testing. */
export function _resetForTesting(): void {
  clearPreparedStmtCache();
  dbHandle = null;
  sqlite3 = null;
  initPromise = null;
  usingFallbackStorage = false;
  fallbackStorage = null;
  if (opfsWorker) {
    opfsWorker.terminate();
    opfsWorker = null;
  }
  opfsPending.clear();
  fts5Available = false;
  lastInitError = null;
  cachedCompileOptions = null;
}
