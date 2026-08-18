/**
 * opfsWorker.ts
 * Production OPFS Worker using @subframe7536/sqlite-wasm with OPFSCoopSyncVFS + FTS5.
 *
 * Runs inside a Worker (where createSyncAccessHandle is permitted) and handles
 * all SQLite operations. Communicates with the offscreen document via postMessage.
 *
 * Replaces the old wa-sqlite sync build (AccessHandlePoolVFS, no FTS5).
 *
 * This file is the thin message router. Actual handler logic lives in
 * src/offscreen/opfsWorker/handlers/*.
 */
/// <reference lib="webworker" />

import { createEngine, type SqliteEngine, type SqliteValue } from './sqliteEngine.js';
import { errorMessage } from '../utils/errorUtils.js';
import { SCHEMA_SQL, AUDIT_LOG_SCHEMA_SQL } from './schema.js';
import { runMigrations, type MigrationEngine } from './migrations.js';

import type { WorkerRequestMessage, WorkerResponseMessage, WorkerLogMessage } from './opfsWorker/types.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import { handleInsert, handleQuery, handleUpdate, handleHardDelete, handleToggleStar, handleGetCount, handleInsertBatch } from './opfsWorker/crudHandlers.js';
import { handleSearch as handleSearchImpl, handleSearchFts as handleSearchFtsImpl, handleSearchLike as handleSearchLikeImpl } from './opfsWorker/searchHandlers.js';
import { handleBackup, handleSerialize } from './opfsWorker/backupHandlers.js';
import { handlePurgeOldRecords, handleContentPurge, handleClearAll } from './opfsWorker/purgeHandlers.js';
import { handleAuditLogInsert, handleAuditLogQuery } from './opfsWorker/auditHandlers.js';
import { handleGetStatus, handleFtsIndexSize } from './opfsWorker/statusHandlers.js';
import { runMigrationV2, type MigrationContext } from './opfsWorker/migrationV2.js';
import { type HandlerContext } from './opfsWorker/handlers.js';

// Re-export types so existing imports from 'opfsWorker.js' still work
export type { WorkerLogMessage } from './opfsWorker/types.js';

// Re-export handler functions for tests that import them directly.
// These wrappers close over the module-level handlerCtx so tests can call
// them with the original positional signature (no context parameter).

/**
 * Thin wrapper for tests — supplies the handler context automatically.
 */
export async function handleSearchFts(
  sanitizedQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC'
): Promise<{ rows: import('../utils/sqlite-types.js').SearchResult[]; total: number }> {
  return handleSearchFtsImpl(handlerCtx, sanitizedQuery, limit, offset, orderBy, orderDir);
}

/**
 * Thin wrapper for tests — supplies the handler context automatically.
 */
export async function handleSearchLike(
  rawQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC'
): Promise<{ rows: import('../utils/sqlite-types.js').SearchResult[]; total: number }> {
  return handleSearchLikeImpl(handlerCtx, rawQuery, limit, offset, orderBy, orderDir);
}

/**
 * Thin wrapper around backupHandlers.handleRestore that closes over the
 * module-level engine/initSqlite state. Tests import this function with the
 * single-argument signature (data only), so we keep this adapter here rather
 * than re-exporting the 4-argument version.
 */
export async function handleRestore(data: Uint8Array): Promise<{ restored: true }> {
  const { handleRestore: restoreImpl } = await import('./opfsWorker/backupHandlers.js');
  return restoreImpl(data, () => engine, (e) => { engine = e; }, initSqlite);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_FILENAME = 'yasumaro.db';
const WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let engine: SqliteEngine | null = null;
let cachedCompileOptions: string[] | null = null;
let fts5Available = false;

// ---------------------------------------------------------------------------
// Log relay
// ---------------------------------------------------------------------------

function postWorkerLog(level: WorkerLogMessage['level'], message: string, details?: Record<string, unknown>): void {
  try {
    // WHY: `self` is typed as `Window` in non-Worker contexts; cast is needed for Worker global scope
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ __log: true, level, message, details } satisfies WorkerLogMessage);
  } catch {
    // Non-Worker global (e.g. jsdom's Window.postMessage requires a
    // targetOrigin argument) — fall back to console so nothing is lost.
    console[level === 'info' ? 'log' : level](message, details ?? '');
  }
}

// ---------------------------------------------------------------------------
// Init helpers
// ---------------------------------------------------------------------------

async function initSqlite(): Promise<void> {
  if (engine !== null) return;

  try {
    await initSqliteInner();
  } catch (err) {
    engine = null;
    throw err;
  }
}

async function initSqliteInner(): Promise<void> {
  engine = await createEngine(DB_FILENAME, WASM_URL);

  await engine.exec('PRAGMA journal_mode=WAL;');
  await engine.exec(SCHEMA_SQL);
  await engine.exec(AUDIT_LOG_SCHEMA_SQL);

  const workerEngine: MigrationEngine = {
    exec: async (sql) => {
      await engine!.exec(sql);
    },
    queryValue: async (sql) => {
      const v = await engine!.queryValue(sql);
      return v !== undefined ? Number(v) : null;
    },
  };
  const { fts5Available: fts } = await runMigrations(workerEngine);
  fts5Available = fts;

  const opts = await engine.query('PRAGMA compile_options');
  cachedCompileOptions = opts.map((r) => String(Object.values(r)[0] ?? ''));

  // Migrate old AccessHandlePoolVFS database (one-time, idempotent)
  const migrationCtx: MigrationContext = {
    handleInsertBatch: (records) => handleInsertBatch(handlerCtx, records, postWorkerLog, ensureEngine),
    postLog: postWorkerLog,
  };
  await runMigrationV2(migrationCtx);
}

function getEngine(): SqliteEngine {
  if (!engine) throw new Error('OPFS SQLite not initialized');
  return engine;
}

async function ensureEngine(): Promise<void> {
  if (!engine) await initSqlite();
}

/**
 * Test seam only — lets tests inject a fake engine and fts5Available value
 * without driving the full initSqlite() path.
 */
export function __setEngineForTesting(fakeEngine: SqliteEngine | null, fts5: boolean): void {
  engine = fakeEngine;
  fts5Available = fts5;
}

// ---------------------------------------------------------------------------
// Handler context — shared state passed to all handler modules
// ---------------------------------------------------------------------------

const handlerCtx: HandlerContext = {
  get engine() { return getEngine(); },
};

// ---------------------------------------------------------------------------
// Message handler (thin router)
// ---------------------------------------------------------------------------

export async function handleRequest(req: WorkerRequestMessage): Promise<WorkerResponseMessage> {
  const { id, type, payload } = req;

  try {
    let result: unknown;

    // Ensure engine is initialized for all operations except INIT
    if (type !== 'INIT' && !engine) {
      await initSqlite();
    }

    switch (type) {
      case 'INIT': {
        result = { initialized: true };
        break;
      }
      case 'INSERT': {
        result = await handleInsert(handlerCtx, payload as BrowsingLogRecord);
        break;
      }
      case 'QUERY': {
        result = await handleQuery(handlerCtx, payload as import('./opfsWorker/types.js').QueryPayload);
        break;
      }
      case 'SEARCH': {
        result = await handleSearchImpl(handlerCtx, payload as import('./opfsWorker/types.js').SearchPayload, fts5Available);
        break;
      }
      case 'UPDATE': {
        await handleUpdate(handlerCtx, payload as { id: number; changes: Record<string, SqliteValue> });
        result = { updated: true };
        break;
      }
      case 'DELETE': {
        await handleHardDelete(handlerCtx, (payload as { id: number }).id);
        result = { deleted: true };
        break;
      }
      case 'TOGGLE_STAR': {
        result = await handleToggleStar(handlerCtx, (payload as { id: number }).id);
        break;
      }
      case 'GET_COUNT': {
        result = { count: await handleGetCount(handlerCtx) };
        break;
      }
      case 'STATUS': {
        result = await handleGetStatus(handlerCtx, fts5Available, cachedCompileOptions);
        break;
      }
      case 'PURGE': {
        result = await handlePurgeOldRecords(handlerCtx, payload as { retentionDays: number; maxRecords: number }, { postLog: postWorkerLog });
        break;
      }
      case 'CONTENT_PURGE': {
        result = await handleContentPurge(handlerCtx, payload as { retentionDays?: number; maxRecords?: number; includeStarred?: boolean });
        break;
      }
      case 'CLEAR_ALL': {
        await handleClearAll(handlerCtx, fts5Available);
        result = { cleared: true };
        break;
      }
      case 'SERIALIZE': {
        result = await handleSerialize(handlerCtx);
        break;
      }
      case 'BACKUP': {
        result = await handleBackup(handlerCtx);
        break;
      }
      case 'RESTORE': {
        const restorePayload = payload as { data: number[] | Uint8Array };
        const bytes = restorePayload.data instanceof Uint8Array
          ? restorePayload.data
          : new Uint8Array(restorePayload.data);
        result = await handleRestore(bytes);
        break;
      }
      case 'FTS_INDEX_SIZE': {
        result = await handleFtsIndexSize(handlerCtx, fts5Available);
        break;
      }
      case 'INSERT_BATCH': {
        result = await handleInsertBatch(handlerCtx, payload as BrowsingLogRecord[], postWorkerLog, ensureEngine);
        break;
      }
      case 'HEALTH_CHECK': {
        result = { ok: engine !== null };
        break;
      }
      case 'AUDIT_LOG_INSERT': {
        result = await handleAuditLogInsert(handlerCtx, payload as { provider: string; url: string; created_at: number });
        break;
      }
      case 'AUDIT_LOG_QUERY': {
        result = await handleAuditLogQuery(handlerCtx, payload as import('./opfsWorker/types.js').AuditLogQueryPayload);
        break;
      }
      // WARNING: SQL_EXEC / SQL_QUERY accept raw SQL strings.
      // Use ONLY for schema migrations (MigrationEngine). Never expose to user input.
      case 'SQL_EXEC': {
        const { sql, params = [] } = payload as { sql: string; params: SqliteValue[] };
        await initSqlite();
        await engine!.exec(sql, params);
        result = { changes: 0 };
        break;
      }
      case 'SQL_QUERY': {
        const { sql, params = [] } = payload as { sql: string; params: SqliteValue[] };
        await initSqlite();
        const rows = await engine!.query(sql, params);
        result = { rows };
        break;
      }
      default:
        return { id, success: false, error: `Unknown worker type: ${type}` };
    }

    return { id, success: true, result };
  } catch (err) {
    return { id, success: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Request serialization queue
// Prevents concurrent SQLite access which causes SQLITE_LOCKED errors.
// ---------------------------------------------------------------------------

type QueueTask = () => Promise<void>;
const requestQueue: QueueTask[] = [];
let queueProcessing = false;

async function processQueue(): Promise<void> {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    while (requestQueue.length > 0) {
      const task = requestQueue.shift()!;
      try { await task(); } catch { /* individual task errors are handled inside task */ }
    }
  } finally {
    queueProcessing = false;
  }
}

function enqueue(task: QueueTask): void {
  requestQueue.push(task);
  void processQueue();
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<WorkerRequestMessage>) => {
  enqueue(async () => {
    const response = await handleRequest(e.data);
    // WHY: `self` is typed as `Window` in non-Worker contexts; cast is needed for Worker global scope
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(response);
  });
};
