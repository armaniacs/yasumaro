/**
 * recordsRepo.ts
 * Browsing-log record CRUD, FTS5 search, and JSON export.
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 */

import { errorMessage } from '../utils/errorUtils.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { INSERT_SQL, INSERT_IGNORE_SQL, UPDATABLE_FIELDS, buildInsertParams, FTS_QUERY_MAX_LENGTH, sanitizeFtsTerm } from './schema.js';
import { engine, extractDomain, DB_FILENAME, MAX_QUERY_LIMIT } from './sqliteEngineContext.js';
import type { SqliteValue } from './sqliteEngineContext.js';

import type { BrowsingLogRecord, QueryOptions, SearchResult } from '../utils/sqlite-types.js';

/** Column names allowed in ORDER BY clauses (prevents SQL injection). */
const ALLOWED_ORDER_COLUMNS = [
  'id', 'url', 'title', 'summary', 'tags', 'created_at',
  'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
  'ai_duration_ms', 'obsidian_duration_ms',
  'sent_tokens', 'received_tokens',
  'page_bytes', 'candidate_bytes',
  'fallback_triggered',
] as const;

/**
 * Insert a new browsing log record and return the auto-generated row id.
 */
export async function insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  try {
    // OPFS Worker path
    if (engine.opfsWorker) {
      const result = await engine.sendToOpfsWorker('INSERT', record) as { id: number };
      return { success: true, id: result.id };
    }

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.opfsWorker) {
      const result = await engine.sendToOpfsWorker('INSERT', record) as { id: number };
      return { success: true, id: result.id };
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.insert(record);
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const domain = record.domain || extractDomain(record.url);

    await engine.execWithCache(INSERT_SQL, buildInsertParams(record, domain));

    let newId = 0;
    await engine.execWithCache('SELECT last_insert_rowid()', [], (row: SqliteValue[]) => {
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
    const opfsResult = await engine.tryOpfsProxy<{ count: number }>('INSERT_BATCH', records);
    if (opfsResult !== null) return { success: true, count: opfsResult.count };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.insertBatch(records);
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await engine.sqlite3!.exec(engine.dbHandle!, 'BEGIN IMMEDIATE');

    try {
      let insertedCount = 0;

      for (const record of records) {
        const domain = record.domain || extractDomain(record.url);

        await engine.execWithCache(INSERT_IGNORE_SQL, buildInsertParams(record, domain));
        // Track count locally (INSERT OR IGNORE may slightly overcount duplicates)
        insertedCount++;
      }

      await engine.sqlite3!.exec(engine.dbHandle!, 'COMMIT');
      return { success: true, count: insertedCount };
    } catch (innerError) {
      await engine.sqlite3!.exec(engine.dbHandle!, 'ROLLBACK');
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
    // Apply FTS_QUERY_MAX_LENGTH limit to tagFilter before passing to either path
    const tagFilter = options.tagFilter ? options.tagFilter.slice(0, FTS_QUERY_MAX_LENGTH) : options.tagFilter;

    // OPFS Worker proxy
    const queryLimit = Math.min(options.limit ?? 100, MAX_QUERY_LIMIT);
    const opfsResult = await engine.tryOpfsProxy<{ rows: BrowsingLogRecord[]; total: number }>('QUERY', {
      limit: queryLimit, offset: options.offset, since: options.since, until: options.until,
      domain: options.domain, isStarred: options.isStarred, orderBy: options.orderBy, orderDir: options.orderDir,
      ids: options.ids,
      tagFilter,
    });
    if (opfsResult !== null) return { success: true, rows: opfsResult.rows, total: opfsResult.total };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.query({ ...options, limit: queryLimit });
    }

    if (!engine.dbHandle) {
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
    if (tagFilter) {
      // Strip FTS5 operator keywords and special chars, but preserve # prefix for trigram matching
      // (length already limited above via FTS_QUERY_MAX_LENGTH)
      const cleanTag = tagFilter
        .replace(/["'*^~:()+\-\\]/g, ' ')
        .replace(/\b(OR|AND|NOT|NEAR)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const ftsExpr = `"#${cleanTag}"`;
      conditions.push('id IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH ?)');
      params.push(ftsExpr);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = options.orderBy && ALLOWED_ORDER_COLUMNS.includes(options.orderBy as typeof ALLOWED_ORDER_COLUMNS[number])
      ? options.orderBy : 'created_at';
    const orderDir = options.orderDir === 'ASC' ? 'ASC' : 'DESC';
    const limit = queryLimit;
    const offset = options.offset ?? 0;

    const countSql = `SELECT COUNT(*) FROM browsing_logs ${whereClause}`;
    let total = 0;
    await engine.execWithCache(countSql, params, (row: SqliteValue[]) => {
      total = Number(row[0]);
    });

    const selectSql = `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted,
         obsidian_synced, gist_synced,
         content, masked_count, cleansed_reason, ai_provider, ai_model, ai_duration_ms, obsidian_duration_ms,
         sent_tokens, received_tokens, original_tokens, cleansed_tokens,
         page_bytes, candidate_bytes, original_bytes, cleansed_bytes,
         ai_summary_original_bytes, ai_summary_cleansed_bytes, extracted_sentences_bytes, extracted_sentences_original_bytes, fallback_triggered
         FROM browsing_logs ${whereClause}
         ORDER BY ${orderBy} ${orderDir}
         LIMIT ? OFFSET ?`;
    const rows: BrowsingLogRecord[] = [];
    await engine.execWithCache(selectSql, [...params, limit, offset], (row: SqliteValue[]) => {
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
        obsidian_synced: Number(row[11]),
        gist_synced: Number(row[12]),
        content: row[13] as string | null,
        masked_count: row[14] != null ? Number(row[14]) : null,
        cleansed_reason: row[15] as string | null,
        ai_provider: row[16] as string | null,
        ai_model: row[17] as string | null,
        ai_duration_ms: row[18] != null ? Number(row[18]) : null,
        obsidian_duration_ms: row[19] != null ? Number(row[19]) : null,
        sent_tokens: row[20] != null ? Number(row[20]) : null,
        received_tokens: row[21] != null ? Number(row[21]) : null,
        original_tokens: row[22] != null ? Number(row[22]) : null,
        cleansed_tokens: row[23] != null ? Number(row[23]) : null,
        page_bytes: row[24] != null ? Number(row[24]) : null,
        candidate_bytes: row[25] != null ? Number(row[25]) : null,
        original_bytes: row[26] != null ? Number(row[26]) : null,
        cleansed_bytes: row[27] != null ? Number(row[27]) : null,
        ai_summary_original_bytes: row[28] != null ? Number(row[28]) : null,
        ai_summary_cleansed_bytes: row[29] != null ? Number(row[29]) : null,
        extracted_sentences_bytes: row[30] != null ? Number(row[30]) : null,
        extracted_sentences_original_bytes: row[31] != null ? Number(row[31]) : null,
        fallback_triggered: row[32] != null ? Number(row[32]) : null,
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
  limit = Math.min(limit, MAX_QUERY_LIMIT);
  try {
    // OPFS Worker: real FTS5 search via the worker's SEARCH handler.
    const opfsResult = await engine.tryOpfsProxy<{ rows: SearchResult[]; total: number }>('SEARCH', {
      searchQuery, limit, offset,
    });
    if (opfsResult !== null) {
      return { success: true, rows: opfsResult.rows, total: opfsResult.total };
    }

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.search(searchQuery, limit, offset);
    }

    if (!engine.dbHandle) {
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
    if (engine.fts5Available && charLen >= 3) {
      const ftsQuery = `"${bare}"`;

      let total = 0;
      await engine.execWithCache(
        `SELECT COUNT(*) FROM browsing_logs_fts WHERE browsing_logs_fts MATCH ?`,
        [ftsQuery],
        (row: SqliteValue[]) => {
          total = Number(row[0]);
        }
      );

      const rows: SearchResult[] = [];
      await engine.execWithCache(
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
    await engine.execWithCache(
      `SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)`,
      [likePattern, likePattern, likePattern, likePattern],
      (row: SqliteValue[]) => {
        total = Number(row[0]);
      }
    );

    const rows: SearchResult[] = [];
    await engine.execWithCache(
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
    const opfsResult = await engine.tryOpfsProxy<{ updated: boolean }>('UPDATE', { id, changes });
    if (opfsResult !== null) return { success: true };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.update(id, changes);
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const setClauses: string[] = [];
    const params: SqliteValue[] = [];

    for (const field of UPDATABLE_FIELDS) {
      const f = field as keyof BrowsingLogRecord;
      if (f in changes) {
        setClauses.push(`${f} = ?`);
        params.push(changes[f] ?? null);
      }
    }

    if (setClauses.length === 0) {
      return { success: true };
    }

    params.push(id);
    await engine.execWithCache(
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
    const opfsResult = await engine.tryOpfsProxy<{ deleted: boolean }>('DELETE', id);
    if (opfsResult !== null) return { success: true };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.hardDelete(id);
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await engine.execWithCache('DELETE FROM browsing_logs WHERE id = ?', [id]);
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
    const opfsResult = await engine.tryOpfsProxy<{ is_starred: number }>('TOGGLE_STAR', id);
    if (opfsResult !== null) return { success: true, is_starred: opfsResult.is_starred };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.toggleStar(id);
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await engine.execWithCache(
      'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?',
      [id]
    );
    let newStarred = 0;
    await engine.execWithCache(
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
    const opfsResult = await engine.tryOpfsProxy<{ count: number }>('GET_COUNT');
    if (opfsResult !== null) return { success: true, count: opfsResult.count };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.getCount();
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    let count = 0;
    await engine.execWithCache(
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
    const opfsResult = await engine.tryOpfsProxy<{ initialized: boolean; path: string; fallback: boolean; fts5: boolean; count: number; compileOptions?: string[] }>('STATUS');
    if (opfsResult !== null) {
      return { success: true, initialized: opfsResult.initialized, path: opfsResult.path, fallback: opfsResult.fallback, fts5: opfsResult.fts5, compileOptions: opfsResult.compileOptions, compileOptionsSource: 'opfs-worker' };
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      const countResult = await engine.fallbackStorage.getCount();
      const count = countResult.success ? countResult.count : 0;
      return { success: true, initialized: count >= 0, path: 'chrome.storage.local', fallback: true, fts5: false, compileOptionsSource: 'fallback' };
    }

    if (!engine.dbHandle || !engine.sqlite3) {
      // Try to initialize if not yet initialized (consistent with query/search)
      await engine.init();
      // If init switched to fallback, return fallback status
      if (engine.usingFallbackStorage && engine.fallbackStorage) {
        return { success: true, initialized: true, path: 'chrome.storage.local', fallback: true, fts5: false, compileOptionsSource: 'fallback' };
      }
      if (!engine.dbHandle) {
        return { success: true, initialized: false, path: DB_FILENAME, fallback: false, initError: engine.lastInitError || 'Init returned false', fts5: false, compileOptionsSource: 'idb' };
      }
    }

    let count = 0;
    await engine.execWithCache(
      'SELECT COUNT(*) FROM browsing_logs',
      [],
      (row: SqliteValue[]) => {
        count = Number(row[0]);
      }
    );

    return { success: true, initialized: true, path: DB_FILENAME, fallback: false, fts5: engine.fts5Available, compileOptions: engine.cachedCompileOptions ?? undefined, compileOptionsSource: 'idb' };
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
    const opfsResult = await engine.tryOpfsProxy<{ cleared: boolean }>('CLEAR_ALL');
    if (opfsResult !== null) return { success: true };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.clearAll();
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await engine.sqlite3!.exec(engine.dbHandle!, `BEGIN IMMEDIATE;
      DELETE FROM browsing_logs;
      DELETE FROM browsing_logs_fts;
      COMMIT;
    `);

    await engine.sqlite3!.exec(engine.dbHandle!, 'PRAGMA wal_checkpoint(TRUNCATE);');

    return { success: true };
  } catch (error) {
    logError('SQLite: clearAll failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
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
