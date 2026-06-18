/**
 * opfsWorker.ts
 * Production OPFS Worker using @subframe7536/sqlite-wasm with OPFSCoopSyncVFS + FTS5.
 *
 * Runs inside a Worker (where createSyncAccessHandle is permitted) and handles
 * all SQLite operations. Communicates with the offscreen document via postMessage.
 *
 * Replaces the old wa-sqlite sync build (AccessHandlePoolVFS, no FTS5).
 */
/// <reference lib="webworker" />

import { createEngine, type SqliteEngine, type SqliteValue, type SqliteRow } from './sqliteEngine.js';
import { errorMessage } from '../utils/errorUtils.js';
import { migrateOldOpfsDb } from './opfsMigrationV2.js';
import { readOldDbRecords, deleteOldDbFile } from './opfsMigrationV2Reader.js';
import { StorageKeys } from '../utils/storage/types.js';

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

interface SearchResultRecord {
  id: number;
  url: string;
  title: string | null;
  summary: string | null;
  tags: string | null;
  created_at: number;
  domain: string | null;
  visit_duration: number | null;
  scroll_ratio: number | null;
  is_starred: number;
  rank: number;
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
  ids?: number[];
}

interface SearchPayload {
  searchQuery: string;
  limit?: number;
  offset?: number;
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
// Constants
// ---------------------------------------------------------------------------

const DB_FILENAME = 'yasumaro.db';
const ALLOWED_ORDER_COLUMNS = [
  'id', 'url', 'title', 'summary', 'tags', 'created_at',
  'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
] as const;

const WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href;
const FTS_QUERY_MAX_LENGTH = 200;

import { SCHEMA_SQL, FTS5_STATEMENTS } from './schema.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let engine: SqliteEngine | null = null;
let cachedCompileOptions: string[] | null = null;
let fts5Available = false;

// ---------------------------------------------------------------------------
// FTS query sanitization
// ---------------------------------------------------------------------------

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
    .replace(/[^A-Za-z0-9぀-ゟ゠-ヿ一-鿿㐀-䶿\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Init helpers
// ---------------------------------------------------------------------------

async function initSqlite(): Promise<void> {
  if (engine !== null) return;

  engine = await createEngine(DB_FILENAME, WASM_URL);

  await engine.exec(SCHEMA_SQL);

  // Schema migration: add obsidian_synced column if not present
  try {
    await engine.exec('ALTER TABLE browsing_logs ADD COLUMN obsidian_synced INTEGER DEFAULT 0');
  } catch {
    // Column already exists
  }

  // Try to enable FTS5 — execute each DDL statement individually because
  // @subframe7536/sqlite-wasm's run() does not support multi-statement SQL.
  fts5Available = false;
  try {
    for (const stmt of FTS5_STATEMENTS) {
      await engine.exec(stmt);
    }
    fts5Available = true;

    // I2: If base table has rows but FTS index is empty, rebuild the index.
    // This handles the case where rows existed before FTS triggers were added.
    try {
      const baseCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs') ?? 0);
      const ftsCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs_fts') ?? 0);
      if (baseCount > 0 && ftsCount === 0) {
        console.info('OPFS Worker: FTS index empty, rebuilding...');
        await engine.exec("INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')");
        console.info('OPFS Worker: FTS index rebuild complete');
      }
    } catch (rebuildErr) {
      console.warn('OPFS Worker: FTS rebuild check failed:', errorMessage(rebuildErr));
    }
  } catch (err) {
    console.warn('OPFS Worker: FTS5 unavailable, falling back to LIKE search:', errorMessage(err));
  }

  // Cache compile options for diagnostics
  const opts = await engine.query('PRAGMA compile_options');
  cachedCompileOptions = opts.map((r) => String(Object.values(r)[0] ?? ''));

  // Migrate old AccessHandlePoolVFS database (one-time, idempotent)
  await runMigrationV2();
}

// ---------------------------------------------------------------------------
// V2 Migration helpers
// ---------------------------------------------------------------------------

/**
 * Module-level guard to avoid redundant migration attempts within the same
 * Worker lifetime (covers the case where chrome.storage is unavailable).
 */
let migrationV2AttemptedThisSession = false;

async function runMigrationV2(): Promise<void> {
  if (migrationV2AttemptedThisSession) return;
  migrationV2AttemptedThisSession = true;

  try {
    // chrome.storage.local may not be available inside a Worker depending on the
    // browser version and extension manifest.  We guard before each access and
    // fall back to a purely idempotent strategy:
    //   - isMigrationDone: check chrome.storage if available; otherwise treat
    //     the old OPFS dir absence (which readOldDbRecords already handles by
    //     returning []) as "nothing to do".
    //   - setMigrationDone: write to chrome.storage if available; otherwise the
    //     module-level guard + deleteOldDb ensure we don't re-migrate.
    const chromeStorageAvailable =
      typeof chrome !== 'undefined' && chrome.storage?.local !== undefined;

    const result = await migrateOldOpfsDb({
      isMigrationDone: async () => {
        if (!chromeStorageAvailable) return false; // rely on old-dir absence check
        return new Promise<boolean>((resolve) => {
          chrome.storage.local.get(StorageKeys.OPFS_MIGRATION_V2_DONE, (items) => {
            resolve(items[StorageKeys.OPFS_MIGRATION_V2_DONE] === true);
          });
        });
      },
      setMigrationDone: async () => {
        if (!chromeStorageAvailable) return;
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ [StorageKeys.OPFS_MIGRATION_V2_DONE]: true }, resolve);
        });
      },
      readOldRecords: readOldDbRecords,
      insertBatch: handleInsertBatch,
      deleteOldDb: deleteOldDbFile,
    });

    if (result.skipped) {
      // Already done — nothing to log
    } else if (result.error) {
      console.warn('OPFS Worker: V2 migration failed (will retry next init):', result.error);
    } else {
      console.info(`OPFS Worker: V2 migration complete — ${result.migrated} records migrated`);
    }
  } catch (err) {
    console.warn('OPFS Worker: runMigrationV2 unexpected error:', errorMessage(err));
  }
}

function getEngine(): SqliteEngine {
  if (!engine) throw new Error('OPFS SQLite not initialized');
  return engine;
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
// SQL execution helpers
// ---------------------------------------------------------------------------

async function sqlExec(sql: string, params: SqliteValue[] = []): Promise<void> {
  await getEngine().exec(sql, params);
}

async function sqlQuery(
  sql: string, params: SqliteValue[], callback: (row: SqliteRow) => void
): Promise<void> {
  const rows = await getEngine().query(sql, params);
  for (const row of rows) callback(row);
}

// ---------------------------------------------------------------------------
// CRUD Handlers
// ---------------------------------------------------------------------------

async function handleInsert(record: BrowsingLogRecord): Promise<{ id: number }> {
  const domain = record.domain || extractDomain(record.url);

  await sqlExec(
    `INSERT INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.url, record.title ?? null, record.summary ?? null, record.tags ?? null,
      record.created_at, domain, record.visit_duration ?? null, record.scroll_ratio ?? null,
      record.is_starred ?? 0, record.is_deleted ?? 0,
    ]
  );

  let id = 0;
  await sqlQuery('SELECT last_insert_rowid() AS id', [], (row) => { id = Number(row.id); });
  return { id };
}

async function handleQuery(payload: QueryPayload): Promise<{ rows: BrowsingLogRecord[]; total: number }> {
  const {
    limit = 20, offset = 0, since, until, domain,
    isStarred, orderBy = 'created_at', orderDir = 'DESC', ids,
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
  if (ids !== undefined && ids.length > 0) {
    conditions.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count
  let total = 0;
  await sqlQuery(`SELECT COUNT(*) AS c FROM browsing_logs ${where}`, params, (row) => { total = Number(row.c); });

  // Select
  const rows: BrowsingLogRecord[] = [];
  await sqlQuery(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced
     FROM browsing_logs ${where}
     ORDER BY ${orderBy} ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        is_deleted: Number(row.is_deleted),
        obsidian_synced: Number(row.obsidian_synced),
      });
    }
  );

  return { rows, total };
}

async function handleUpdate(payload: { id: number; changes: Record<string, SqliteValue> }): Promise<void> {
  const { id, changes } = payload;
  const sets: string[] = [];
  const vals: SqliteValue[] = [];

  for (const [key, val] of Object.entries(changes)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }

  if (sets.length === 0) return;
  vals.push(id);

  await sqlExec(
    `UPDATE browsing_logs SET ${sets.join(', ')} WHERE id = ?`,
    vals
  );
}

async function handleHardDelete(id: number): Promise<void> {
  await sqlExec('DELETE FROM browsing_logs WHERE id = ?', [id]);
}

async function handleToggleStar(id: number): Promise<{ is_starred: number }> {
  await sqlExec(
    'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id]
  );
  let isStarred = 0;
  await sqlQuery('SELECT is_starred AS is_starred FROM browsing_logs WHERE id = ?', [id], (row) => { isStarred = Number(row.is_starred); });
  return { is_starred: isStarred };
}

async function handleGetCount(): Promise<number> {
  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0', [], (row) => { count = Number(row.c); });
  return count;
}

async function handleFtsIndexSize(): Promise<{ count: number }> {
  if (!engine || !fts5Available) return { count: 0 };
  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs_fts', [], (row) => { count = Number(row.c); });
  return { count };
}

async function handleInsertBatch(records: BrowsingLogRecord[]): Promise<{ count: number }> {
  if (!engine) await initSqlite();
  let inserted = 0;
  for (const record of records) {
    try {
      const domain = record.domain || extractDomain(record.url);
      await sqlExec(
        `INSERT OR IGNORE INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.url, record.title ?? null, record.summary ?? null, record.tags ?? null,
          record.created_at, domain, record.visit_duration ?? null, record.scroll_ratio ?? null,
          record.is_starred ?? 0, record.is_deleted ?? 0,
        ]
      );
      await sqlQuery('SELECT changes() AS c', [], (row) => { inserted += Number(row.c); });
    } catch (err) {
      // Log first error for diagnosis, silently skip the rest
      if (inserted === 0 && records.indexOf(record) === 0) {
        console.error('OPFS Worker: first INSERT failed:', err, 'record:', record.url);
      }
    }
  }
  return { count: inserted };
}

async function handleGetStatus(): Promise<{ initialized: boolean; path: string; fallback: boolean; fts5: boolean; count: number; compileOptions?: string[] }> {
  if (!engine) {
    return { initialized: false, path: DB_FILENAME, fallback: false, fts5: false, count: 0 };
  }

  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs', [], (row) => { count = Number(row.c); });

  return {
    initialized: true,
    path: `OPFS:${DB_FILENAME}`,
    fallback: false,
    fts5: fts5Available,
    count,
    compileOptions: cachedCompileOptions ?? undefined,
  };
}

async function handlePurgeOldRecords(payload: { retentionDays: number; maxRecords: number }): Promise<{ purged: number }> {
  const { retentionDays, maxRecords } = payload;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let totalPurged = 0;

  // Delete old non-starred records
  await sqlExec(
    'DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0',
    [cutoffMs]
  );

  // Get change count via query
  await sqlQuery('SELECT changes() AS c', [], (row) => { totalPurged = Number(row.c); });

  // If still over max, delete oldest non-starred records
  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0', [], (row) => { count = Number(row.c); });

  if (count > maxRecords) {
    const toDelete = count - maxRecords;
    await sqlExec(
      `DELETE FROM browsing_logs WHERE id IN (
         SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0
         ORDER BY created_at ASC LIMIT ?
       )`,
      [toDelete]
    );
    totalPurged += toDelete;
  }

  return { purged: totalPurged };
}

async function handleClearAll(): Promise<void> {
  await sqlExec('DELETE FROM browsing_logs', []);
  if (fts5Available) {
    await sqlExec("INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')", []);
  }
}

async function handleSerialize(): Promise<Uint8Array> {
  const rows: BrowsingLogRecord[] = [];
  await sqlQuery(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced
     FROM browsing_logs WHERE is_deleted = 0 ORDER BY created_at DESC`,
    [],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        is_deleted: Number(row.is_deleted),
        obsidian_synced: Number(row.obsidian_synced),
      });
    }
  );

  const encoder = new TextEncoder();
  return encoder.encode(JSON.stringify(rows));
}

async function handleSearch(payload: SearchPayload): Promise<{ rows: SearchResultRecord[]; total: number }> {
  const { searchQuery, limit = 50, offset = 0 } = payload;
  const bare = sanitizeFtsTerm(searchQuery);
  if (!bare) return { rows: [], total: 0 };

  // trigram MATCH requires >= 3 unicode code points; shorter terms fall back to LIKE.
  const charLen = [...bare].length;
  if (fts5Available && charLen >= 3) {
    return handleSearchFts(`"${bare}"`, limit, offset);
  }
  return handleSearchLike(searchQuery, limit, offset);
}

async function handleSearchFts(
  sanitizedQuery: string, limit: number, offset: number
): Promise<{ rows: SearchResultRecord[]; total: number }> {
  let total = 0;
  await sqlQuery(
    `SELECT COUNT(*) AS c FROM browsing_logs_fts
JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0`,
    [sanitizedQuery],
    (row) => { total = Number(row.c); }
  );

  const rows: SearchResultRecord[] = [];
  await sqlQuery(
    `SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, rank AS rank
     FROM browsing_logs_fts
     JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
     WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0
     ORDER BY rank LIMIT ? OFFSET ?`,
    [sanitizedQuery, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        rank: Number(row.rank),
      });
    }
  );

  return { rows, total };
}

async function handleSearchLike(
  rawQuery: string, limit: number, offset: number
): Promise<{ rows: SearchResultRecord[]; total: number }> {
  const like = `%${rawQuery}%`;
  const conditions = 'is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)';
  const params: SqliteValue[] = [like, like, like, like];

  let total = 0;
  await sqlQuery(
    `SELECT COUNT(*) AS c FROM browsing_logs WHERE ${conditions}`,
    params,
    (row) => { total = Number(row.c); }
  );

  const rows: SearchResultRecord[] = [];
  await sqlQuery(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred
     FROM browsing_logs WHERE ${conditions}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        rank: 0,
      });
    }
  );

  return { rows, total };
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
        if (!engine) await initSqlite();
        result = await handleInsert(payload as BrowsingLogRecord);
        break;
      }
      case 'QUERY': {
        if (!engine) await initSqlite();
        result = await handleQuery(payload as QueryPayload);
        break;
      }
      case 'SEARCH': {
        if (!engine) await initSqlite();
        result = await handleSearch(payload as SearchPayload);
        break;
      }
      case 'UPDATE': {
        if (!engine) await initSqlite();
        await handleUpdate(payload as { id: number; changes: Record<string, SqliteValue> });
        result = { updated: true };
        break;
      }
      case 'DELETE': {
        if (!engine) await initSqlite();
        await handleHardDelete(payload as number);
        result = { deleted: true };
        break;
      }
      case 'TOGGLE_STAR': {
        if (!engine) await initSqlite();
        result = await handleToggleStar(payload as number);
        break;
      }
      case 'GET_COUNT': {
        if (!engine) await initSqlite();
        result = { count: await handleGetCount() };
        break;
      }
      case 'STATUS': {
        if (!engine) await initSqlite();
        result = await handleGetStatus();
        break;
      }
      case 'PURGE': {
        if (!engine) await initSqlite();
        result = await handlePurgeOldRecords(payload as { retentionDays: number; maxRecords: number });
        break;
      }
      case 'CLEAR_ALL': {
        if (!engine) await initSqlite();
        await handleClearAll();
        result = { cleared: true };
        break;
      }
      case 'SERIALIZE': {
        if (!engine) await initSqlite();
        result = await handleSerialize();
        break;
      }
      case 'FTS_INDEX_SIZE': {
        result = await handleFtsIndexSize();
        break;
      }
      case 'INSERT_BATCH': {
        if (!engine) await initSqlite();
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
