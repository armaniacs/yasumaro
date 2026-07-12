/**
 * recordsRepo.ts
 * Browsing-log record CRUD, FTS5 search, and JSON export.
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 *
 * All methods delegate to the active StorageBackend returned by engine.getBackend().
 */

import { errorMessage } from '../utils/errorUtils.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { engine, DB_FILENAME, MAX_QUERY_LIMIT } from './sqliteEngineContext.js';
import type { SqliteValue } from './sqliteEngineContext.js';
import { FTS_QUERY_MAX_LENGTH } from './schema.js';

import type { BrowsingLogRecord, QueryOptions, SearchResult } from '../utils/sqlite-types.js';

/**
 * Insert a new browsing log record and return the auto-generated row id.
 */
export async function insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.insert(record);
}

/**
 * Insert a batch of records atomically using a transaction.
 * Uses INSERT OR IGNORE to handle UNIQUE constraint violations (url, created_at).
 */
export async function insertBatch(records: BrowsingLogRecord[]): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  const result = await backend.insertBatch(records);
  if (!result.success) return result;
  return { success: true, count: result.inserted };
}

/**
 * Query browsing logs with optional filters.
 */
export async function query(options: QueryOptions = {}): Promise<{
  success: true; rows: BrowsingLogRecord[]; total: number
} | { success: false; error: string }> {
  const tagFilter = options.tagFilter ? options.tagFilter.slice(0, FTS_QUERY_MAX_LENGTH) : options.tagFilter;
  const queryLimit = Math.min(options.limit ?? 100, MAX_QUERY_LIMIT);
  const backend = await engine.getBackend();
  return backend.query({ ...options, limit: queryLimit, tagFilter });
}

/**
 * Full-text search using FTS5.
 */
export async function search(searchQuery: string, limit: number = 50, offset: number = 0): Promise<{
  success: true; rows: SearchResult[]; total: number
} | { success: false; error: string }> {
  limit = Math.min(limit, MAX_QUERY_LIMIT);
  const backend = await engine.getBackend();
  return backend.search(searchQuery, limit, offset);
}

/**
 * Update a browsing log record by id.
 */
export async function update(id: number, changes: Partial<BrowsingLogRecord>): Promise<{ success: true } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.update(id, changes as Record<string, unknown>);
}

/**
 * Hard-delete a browsing log record by id (physical DELETE, GDPR Art.17).
 * FTS5 triggers automatically clean up the FTS index.
 */
export async function hardDelete(id: number): Promise<{ success: true } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.delete(id);
}

/**
 * Toggle the starred status of a record.
 */
export async function toggleStar(id: number): Promise<{ success: true; is_starred: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.toggleStar(id);
}

/**
 * Get the total number of records (excluding soft-deleted).
 */
export async function getCount(): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.getCount();
}

/**
 * Check if the database is initialized and accessible.
 */
export async function getStatus(): Promise<{ success: true; initialized: boolean; path: string; fallback: boolean; initError?: string; fts5: boolean; compileOptions?: string[]; compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback' } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  const result = await backend.getStatus();
  if (!result.success) return result;
  return { ...result, path: DB_FILENAME };
}

/**
 * Clear all browsing logs from the database (GDPR Art.17 hard delete).
 */
export async function clearAll(): Promise<{ success: boolean; error?: string }> {
  const backend = await engine.getBackend();
  return backend.clearAll();
}

/**
 * Export all browsing_logs as a JSON Uint8Array (NOT a SQLite binary .db file).
 * For true SQLite binary serialization, use wa-sqlite backup API.
 */
export async function serialize(): Promise<{ success: true; data: Uint8Array } | { success: false; error: string }> {
  try {
    const opfsResult = await engine.tryOpfsProxy<Uint8Array>('SERIALIZE');
    if (opfsResult !== null) return { success: true, data: opfsResult };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      const queryResult = await engine.fallbackStorage.query({ excludeDeleted: true, orderBy: 'created_at', orderDir: 'DESC', limit: 100000 });
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
    await engine.execWithCache(
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
