/**
 * opfsWorker.ts
 * Production OPFS Worker for wa-sqlite with AccessHandlePoolVFS.
 *
 * Runs inside a Worker (where createSyncAccessHandle is permitted) and handles
 * all SQLite operations. Communicates with the offscreen document via postMessage.
 *
 * Uses the npm synchronous wa-sqlite build which lacks FTS5.
 * Full-text search falls back to LIKE queries in the offscreen proxy.
 */
/// <reference lib="webworker" />

import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { AccessHandlePoolVFS } from 'wa-sqlite/src/examples/AccessHandlePoolVFS.js';
import { errorMessage } from '../utils/errorUtils.js';

// ---------------------------------------------------------------------------
// Types (worker-internal — mirrors BrowsingLogRecord / QueryOptions / SearchResult)
// ---------------------------------------------------------------------------

interface BrowsingLogRecord {
  id?: number;
  url: string;
  title?: string | null;
  summary?: string | null;
  tags?: string | null;
  created_at: number;
  domain?: string | null;
  visit_duration?: number | null;
  scroll_ratio?: number | null;
  is_starred?: number;
  is_deleted?: number;
  obsidian_synced?: number;
}

interface QueryPayload {
  limit?: number;
  offset?: number;
  since?: number;
  until?: number;
  domain?: string;
  isStarred?: number;
  orderBy?: string;
  orderDir?: string;
  // LIKE fallback search
  searchQuery?: string;
}

interface RequestMessage {
  id: number;
  type: string;
  payload: unknown;
}

interface ResponseMessage {
  id: number;
  success: boolean;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// SQL type helpers
// ---------------------------------------------------------------------------

type SqliteValue = number | string | Uint8Array | null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POOL_DIR = '/yasumaro-opfs';
const DB_FILENAME = 'yasumaro.db';
const VFS_NAME = 'opfs-pool';
const PREPARED_STMT_CACHE_MAX = 50;
const ALLOWED_ORDER_COLUMNS = [
  'id', 'url', 'title', 'summary', 'tags', 'created_at',
  'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
] as const;

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

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let sqlite3: ReturnType<typeof SQLite.Factory> | null = null;
let dbHandle: number | null = null;
let preparedStmtCache = new Map<string, number>();

// ---------------------------------------------------------------------------
// Init helpers
// ---------------------------------------------------------------------------

function wrapModule(module: ReturnType<typeof SQLiteESMFactory> extends Promise<infer M> ? M : never) {
  if (!module.registerVFS && typeof module.vfs_register === 'function') {
    module.registerVFS = module.vfs_register;
  }
  return module;
}

async function initSqlite(): Promise<void> {
  if (dbHandle !== null) return;

  const module = wrapModule(await SQLiteESMFactory());
  sqlite3 = SQLite.Factory(module);

  const vfs = new AccessHandlePoolVFS(POOL_DIR);
  if (typeof (vfs as unknown as { hasAsyncMethod?: unknown }).hasAsyncMethod !== 'function') {
    (vfs as unknown as { hasAsyncMethod: () => boolean }).hasAsyncMethod = () => false;
  }

  await (vfs as unknown as { isReady: Promise<void> }).isReady;
  sqlite3.vfs_register(vfs as unknown as Parameters<typeof sqlite3.vfs_register>[0], true);

  dbHandle = await sqlite3.open_v2(
    DB_FILENAME,
    SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE,
    VFS_NAME
  );

  await sqlite3.exec(dbHandle, SCHEMA_SQL);

  // Schema migration: add obsidian_synced column if not present
  try {
    await sqlite3.exec(dbHandle, 'ALTER TABLE browsing_logs ADD COLUMN obsidian_synced INTEGER DEFAULT 0');
  } catch {
    // Column already exists
  }

  await sqlite3.exec(dbHandle, 'PRAGMA journal_mode=WAL;');
  await sqlite3.exec(dbHandle, 'PRAGMA wal_autocheckpoint=1000;');
}

function getSqlite(): { sqlite3: NonNullable<typeof sqlite3>; db: number } {
  if (!sqlite3 || dbHandle === null) throw new Error('OPFS SQLite not initialized');
  return { sqlite3, db: dbHandle };
}

function extractDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prepared statement cache
// ---------------------------------------------------------------------------

async function execWithCache(
  sql: string, params: SqliteValue[], rowCallback?: (row: SqliteValue[]) => void
): Promise<void> {
  const { sqlite3: s, db } = getSqlite();

  let stmt = preparedStmtCache.get(sql) ?? null;
  if (stmt === null) {
    // wa-sqlite sync build: statements() is synchronous (returns number), but TS types
    // may report AsyncIterable. Use explicit cast for the synchronous API.
    const rawStmts = s.statements(db, sql) as unknown as number;
    stmt = rawStmts;
    if (stmt === null) throw new Error(`Failed to prepare: ${sql.slice(0, 80)}`);

    // LRU eviction
    if (preparedStmtCache.size >= PREPARED_STMT_CACHE_MAX) {
      const oldest = preparedStmtCache.keys().next().value;
      if (oldest) {
        const oldStmt = preparedStmtCache.get(oldest);
        if (oldStmt !== undefined) {
          s.finalize(oldStmt).catch(() => {});
          preparedStmtCache.delete(oldest);
        }
      }
    }
    preparedStmtCache.set(sql, stmt);
  }

  (s.bind_collection as unknown as (stmt: number, params: unknown[]) => void)(stmt, params);

  if (rowCallback) {
    while ((await (s.step as unknown as (stmt: number) => Promise<number>)(stmt)) === SQLite.SQLITE_ROW) {
      rowCallback((s.column_names as unknown as (stmt: number) => string[])(stmt).map((_name, i) => (s.column as unknown as (stmt: number, col: number) => SqliteValue)(stmt, i)));
    }
  } else {
    if ((await (s.step as unknown as (stmt: number) => Promise<number>)(stmt)) !== SQLite.SQLITE_DONE) {
      throw new Error(`Expected SQLITE_DONE after exec: ${sql.slice(0, 80)}`);
    }
  }

  (s.reset as unknown as (stmt: number) => void)(stmt);
}

// ---------------------------------------------------------------------------
// CRUD Handlers
// ---------------------------------------------------------------------------

async function handleInsert(record: BrowsingLogRecord): Promise<{ id: number }> {
  const domain = record.domain || extractDomain(record.url);

  await execWithCache(
    `INSERT INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.url, record.title ?? null, record.summary ?? null, record.tags ?? null,
      record.created_at, domain, record.visit_duration ?? null, record.scroll_ratio ?? null,
      record.is_starred ?? 0, record.is_deleted ?? 0,
    ]
  );

  let id = 0;
  await execWithCache('SELECT last_insert_rowid()', [], (row) => { id = Number(row[0]); });
  return { id };
}

async function handleQuery(payload: QueryPayload): Promise<{ rows: BrowsingLogRecord[]; total: number }> {
  const {
    limit = 20, offset = 0, since, until, domain,
    isStarred, orderBy = 'created_at', orderDir = 'DESC', searchQuery,
  } = payload;

  // Validate sort columns
  if (!ALLOWED_ORDER_COLUMNS.includes(orderBy as typeof ALLOWED_ORDER_COLUMNS[number])) {
    throw new Error(`Invalid orderBy: ${orderBy}`);
  }
  const dir = orderDir === 'ASC' ? 'ASC' : 'DESC';

  // Build WHERE clause
  const conditions: string[] = ['is_deleted = 0'];
  const params: SqliteValue[] = [];

  if (since !== undefined) { conditions.push('created_at >= ?'); params.push(since); }
  if (until !== undefined) { conditions.push('created_at <= ?'); params.push(until); }
  if (domain) { conditions.push('domain = ?'); params.push(domain); }
  if (isStarred !== undefined) { conditions.push('is_starred = ?'); params.push(isStarred); }

  // LIKE fallback search (no FTS5 in sync build)
  if (searchQuery) {
    const like = `%${searchQuery}%`;
    conditions.push('(url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)');
    params.push(like, like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count
  let total = 0;
  await execWithCache(`SELECT COUNT(*) FROM browsing_logs ${where}`, params, (row) => { total = Number(row[0]); });

  // Select
  const rows: BrowsingLogRecord[] = [];
  await execWithCache(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced
     FROM browsing_logs ${where}
     ORDER BY ${orderBy} ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (row) => {
      rows.push({
        id: Number(row[0]), url: String(row[1]), title: row[2] as string | null,
        summary: row[3] as string | null, tags: row[4] as string | null,
        created_at: Number(row[5]), domain: row[6] as string | null,
        visit_duration: row[7] as number | null, scroll_ratio: row[8] as number | null,
        is_starred: Number(row[9]), is_deleted: Number(row[10]),
        obsidian_synced: Number(row[11]),
      });
    }
  );

  return { rows, total };
}

async function handleUpdate(payload: { id: number; changes: Record<string, unknown> }): Promise<void> {
  const { id, changes } = payload;
  const sets: string[] = [];
  const vals: SqliteValue[] = [];

  for (const [key, val] of Object.entries(changes)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(val as SqliteValue);
    }
  }

  if (sets.length === 0) return;
  vals.push(id);

  await execWithCache(
    `UPDATE browsing_logs SET ${sets.join(', ')} WHERE id = ?`,
    vals
  );
}

async function handleHardDelete(id: number): Promise<void> {
  await execWithCache('DELETE FROM browsing_logs WHERE id = ?', [id]);
}

async function handleToggleStar(id: number): Promise<{ is_starred: number }> {
  await execWithCache(
    'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id]
  );
  let isStarred = 0;
  await execWithCache('SELECT is_starred FROM browsing_logs WHERE id = ?', [id], (row) => { isStarred = Number(row[0]); });
  return { is_starred: isStarred };
}

async function handleGetCount(): Promise<number> {
  let count = 0;
  await execWithCache('SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0', [], (row) => { count = Number(row[0]); });
  return count;
}

async function handleFtsIndexSize(): Promise<{ count: number }> {
  // sync build lacks FTS5 — always returns 0
  return { count: 0 };
}

async function handleInsertBatch(records: BrowsingLogRecord[]): Promise<{ count: number }> {
  if (!dbHandle) await initSqlite();
  let inserted = 0;
  for (const record of records) {
    try {
      const domain = record.domain || extractDomain(record.url);
      await execWithCache(
        `INSERT OR IGNORE INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.url, record.title ?? null, record.summary ?? null, record.tags ?? null,
          record.created_at, domain, record.visit_duration ?? null, record.scroll_ratio ?? null,
          record.is_starred ?? 0, record.is_deleted ?? 0,
        ]
      );
      inserted++;
    } catch {
      // INSERT OR IGNORE handles duplicates, individual errors are non-fatal
    }
  }
  return { count: inserted };
}

async function handleGetStatus(): Promise<{ initialized: boolean; path: string; fallback: boolean; fts5: boolean; count: number }> {
  if (!dbHandle) {
    return { initialized: false, path: DB_FILENAME, fallback: false, fts5: false, count: 0 };
  }

  let count = 0;
  await execWithCache('SELECT COUNT(*) FROM browsing_logs', [], (row) => { count = Number(row[0]); });

  return {
    initialized: true,
    path: `OPFS:${POOL_DIR}/${DB_FILENAME}`,
    fallback: false,
    fts5: false, // sync build lacks FTS5
    count,
  };
}

async function handlePurgeOldRecords(payload: { retentionDays: number; maxRecords: number }): Promise<{ purged: number }> {
  const { retentionDays, maxRecords } = payload;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let totalPurged = 0;

  // Delete old non-starred records
  await execWithCache(
    'DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0',
    [cutoffMs]
  );
  totalPurged = sqlite3 ? await getChangeCount() : 0;

  // If still over max, delete oldest non-starred records
  let count = 0;
  await execWithCache('SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0', [], (row) => { count = Number(row[0]); });

  if (count > maxRecords) {
    const toDelete = count - maxRecords;
    await execWithCache(
      `DELETE FROM browsing_logs WHERE id IN (
         SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0
         ORDER BY created_at ASC LIMIT ?
       )`,
      [toDelete]
    );
    totalPurged += toDelete;
  }

  // Trigger checkpoint to reclaim space
  try { await sqlite3?.exec(dbHandle!, 'PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }

  return { purged: totalPurged };
}

async function getChangeCount(): Promise<number> {
  let count = 0;
  await execWithCache('SELECT changes()', [], (row) => { count = Number(row[0]); });
  return count;
}

async function handleClearAll(): Promise<void> {
  await execWithCache('DELETE FROM browsing_logs', []);
  try { await sqlite3?.exec(dbHandle!, 'PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
}

async function handleSerialize(): Promise<Uint8Array> {
  const rows: BrowsingLogRecord[] = [];
  await execWithCache(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced
     FROM browsing_logs WHERE is_deleted = 0 ORDER BY created_at DESC`,
    [],
    (row) => {
      rows.push({
        id: Number(row[0]), url: String(row[1]), title: row[2] as string | null,
        summary: row[3] as string | null, tags: row[4] as string | null,
        created_at: Number(row[5]), domain: row[6] as string | null,
        visit_duration: row[7] as number | null, scroll_ratio: row[8] as number | null,
        is_starred: Number(row[9]), is_deleted: Number(row[10]),
        obsidian_synced: Number(row[11]),
      });
    }
  );

  const encoder = new TextEncoder();
  return encoder.encode(JSON.stringify(rows));
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function handleRequest(req: RequestMessage): Promise<ResponseMessage> {
  const { id, type, payload } = req;

  try {
    let result: unknown;

    switch (type) {
      case 'INIT': {
        await initSqlite();
        result = { initialized: true };
        break;
      }
      case 'INSERT': {
        if (!dbHandle) await initSqlite();
        result = await handleInsert(payload as BrowsingLogRecord);
        break;
      }
      case 'QUERY': {
        if (!dbHandle) await initSqlite();
        result = await handleQuery(payload as QueryPayload);
        break;
      }
      case 'UPDATE': {
        if (!dbHandle) await initSqlite();
        await handleUpdate(payload as { id: number; changes: Record<string, unknown> });
        result = { updated: true };
        break;
      }
      case 'DELETE': {
        if (!dbHandle) await initSqlite();
        await handleHardDelete(payload as number);
        result = { deleted: true };
        break;
      }
      case 'TOGGLE_STAR': {
        if (!dbHandle) await initSqlite();
        result = await handleToggleStar(payload as number);
        break;
      }
      case 'GET_COUNT': {
        if (!dbHandle) await initSqlite();
        result = { count: await handleGetCount() };
        break;
      }
      case 'STATUS': {
        result = await handleGetStatus();
        break;
      }
      case 'PURGE': {
        if (!dbHandle) await initSqlite();
        result = await handlePurgeOldRecords(payload as { retentionDays: number; maxRecords: number });
        break;
      }
      case 'CLEAR_ALL': {
        if (!dbHandle) await initSqlite();
        await handleClearAll();
        result = { cleared: true };
        break;
      }
      case 'SERIALIZE': {
        if (!dbHandle) await initSqlite();
        result = await handleSerialize();
        break;
      }
      case 'FTS_INDEX_SIZE': {
        result = await handleFtsIndexSize();
        break;
      }
      case 'INSERT_BATCH': {
        if (!dbHandle) await initSqlite();
        result = await handleInsertBatch(payload as BrowsingLogRecord[]);
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
// Worker entry point
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent<RequestMessage>) => {
  const response = await handleRequest(e.data);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(response);
};
