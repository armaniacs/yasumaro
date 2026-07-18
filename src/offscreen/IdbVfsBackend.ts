// src/offscreen/IdbVfsBackend.ts
import type { SqliteEngineContext, SqliteValue } from './sqliteEngineContext.js';
import type {
  StorageBackend, InsertResult, InsertBatchResult, QueryResult,
  SearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult,
  BackupResult, CountResult, HealthResult, AuditLogQueryResult,
  StatusResult, BackendOrError,
} from './StorageBackend.js';
import type { BrowsingLogRecord, BrowsingLogEntry, QueryOptions, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';
import { INSERT_SQL, INSERT_IGNORE_SQL, buildInsertParams, UPDATABLE_FIELDS } from './schema.js';
import { sanitizeFtsTerm } from './schema.js';
import { extractDomain } from './sqliteEngineContext.js';

const ALLOWED_ORDER_COLUMNS = [
  'id', 'url', 'title', 'summary', 'tags', 'created_at',
  'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
] as const;

const ALLOWED_ORDER_DIRECTIONS = ['ASC', 'DESC'] as const;

export class IdbVfsBackend implements StorageBackend {
  constructor(private engine: SqliteEngineContext) {}

  private ensureDb(): void {
    if (!this.engine.idbEngine) throw new Error('IDB VFS database not initialized');
  }

  async insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>> {
    this.ensureDb();
    const domain = record.domain || extractDomain(record.url);
    const params = buildInsertParams(record, domain);
    await this.engine.execWithCache(INSERT_SQL, params);
    let id = 0;
    await this.engine.execWithCache('SELECT last_insert_rowid()', [], (row: SqliteValue[]) => { id = Number(row[0]); });
    return { success: true, id };
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>> {
    this.ensureDb();
    if (records.length === 0) return { success: true, inserted: 0, skipped: 0 };

    let inserted = 0;
    let skipped = 0;
    await this.engine.execWithCache('BEGIN IMMEDIATE');
    try {
      for (const record of records) {
        const domain = record.domain || extractDomain(record.url);
        await this.engine.execWithCache(INSERT_IGNORE_SQL, buildInsertParams(record, domain));
        let changed = 0;
        await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changed = Number(row[0]); });
        if (changed > 0) inserted++;
        else skipped++;
      }
      await this.engine.execWithCache('COMMIT');
      return { success: true, inserted, skipped };
    } catch (error) {
      await this.engine.execWithCache('ROLLBACK');
      throw error;
    }
  }

  async query(options: QueryOptions): Promise<BackendOrError<QueryResult>> {
    this.ensureDb();
    const limit = Math.min(options.limit ?? 100, 1000);
    const offset = options.offset ?? 0;
    const conditions: string[] = ['is_deleted = 0'];
    const params: SqliteValue[] = [];

    if (options.since != null) { conditions.push('created_at >= ?'); params.push(options.since); }
    if (options.until != null) { conditions.push('created_at <= ?'); params.push(options.until); }
    if (options.domain) { conditions.push('domain = ?'); params.push(options.domain); }
    if (options.isStarred != null) { conditions.push('is_starred = ?'); params.push(options.isStarred ? 1 : 0); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate ORDER BY to prevent SQL injection
    const orderBy = options.orderBy || 'created_at';
    if (!ALLOWED_ORDER_COLUMNS.includes(orderBy as typeof ALLOWED_ORDER_COLUMNS[number])) {
      return { success: false, error: `Invalid orderBy: ${orderBy}` };
    }
    const orderDir = (options.orderDir || 'DESC').toUpperCase();
    if (!ALLOWED_ORDER_DIRECTIONS.includes(orderDir as typeof ALLOWED_ORDER_DIRECTIONS[number])) {
      return { success: false, error: `Invalid orderDir: ${orderDir}` };
    }

    const rows: BrowsingLogEntry[] = [];
    await this.engine.execWithCache(
      `SELECT * FROM browsing_logs ${where} ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
      (row: SqliteValue[]) => { rows.push(this.rowToEntry(row)); }
    );

    let total = 0;
    await this.engine.execWithCache(
      `SELECT COUNT(*) FROM browsing_logs ${where}`,
      params,
      (row: SqliteValue[]) => { total = Number(row[0]); }
    );

    return { success: true, rows, total };
  }

  async search(searchQuery: string, limit: number, offset: number): Promise<BackendOrError<SearchResult>> {
    this.ensureDb();
    const capLimit = Math.min(limit, 100000);
    const bare = sanitizeFtsTerm(searchQuery);
    if (!bare) {
      return { success: true, rows: [], total: 0 };
    }

    const charLen = [...bare].length;
    if (this.engine.fts5Available && charLen >= 3) {
      const ftsQuery = `"${bare}"`;
      let total = 0;
      await this.engine.execWithCache(
        `SELECT COUNT(*) FROM browsing_logs_fts WHERE browsing_logs_fts MATCH ?`,
        [ftsQuery],
        (row: SqliteValue[]) => { total = Number(row[0]); }
      );

      const rows: (BrowsingLogEntry & { rank: number })[] = [];
      await this.engine.execWithCache(
        `SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, rank
         FROM browsing_logs_fts
         JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
         WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0
         ORDER BY rank
         LIMIT ? OFFSET ?`,
        [ftsQuery, capLimit, offset],
        (row: SqliteValue[]) => {
          rows.push({
            id: Number(row[0]), url: String(row[1]),
            title: row[2] != null ? String(row[2]) : null,
            summary: row[3] != null ? String(row[3]) : null,
            tags: row[4] != null ? String(row[4]) : null,
            created_at: Number(row[5]),
            domain: row[6] != null ? String(row[6]) : null,
            visit_duration: row[7] != null ? Number(row[7]) : null,
            scroll_ratio: row[8] != null ? Number(row[8]) : null,
            is_starred: Number(row[9]),
            rank: Number(row[10]),
          });
        }
      );
      return { success: true, rows, total };
    }

    const likePattern = `%${searchQuery}%`;
    let total = 0;
    await this.engine.execWithCache(
      `SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)`,
      [likePattern, likePattern, likePattern, likePattern],
      (row: SqliteValue[]) => { total = Number(row[0]); }
    );

    const rows: (BrowsingLogEntry & { rank: number })[] = [];
    await this.engine.execWithCache(
      `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred
       FROM browsing_logs
       WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [likePattern, likePattern, likePattern, likePattern, capLimit, offset],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]), url: String(row[1]),
          title: row[2] != null ? String(row[2]) : null,
          summary: row[3] != null ? String(row[3]) : null,
          tags: row[4] != null ? String(row[4]) : null,
          created_at: Number(row[5]),
          domain: row[6] != null ? String(row[6]) : null,
          visit_duration: row[7] != null ? Number(row[7]) : null,
          scroll_ratio: row[8] != null ? Number(row[8]) : null,
          is_starred: Number(row[9]),
          rank: 0,
        });
      }
    );

    return { success: true, rows, total };
  }

  async update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>> {
    this.ensureDb();
    const setClauses: string[] = [];
    const params: SqliteValue[] = [];

    for (const field of UPDATABLE_FIELDS) {
      const f = field as keyof BrowsingLogRecord;
      if (f in changes) {
        setClauses.push(`${f} = ?`);
        params.push((changes[f] ?? null) as SqliteValue);
      }
    }

    if (setClauses.length === 0) {
      return { success: true };
    }

    params.push(id);
    await this.engine.execWithCache(
      `UPDATE browsing_logs SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    return { success: true };
  }

  async delete(id: number): Promise<BackendOrError<MutationResult>> {
    this.ensureDb();
    await this.engine.execWithCache('DELETE FROM browsing_logs WHERE id = ?', [id]);
    return { success: true };
  }

  async toggleStar(id: number): Promise<BackendOrError<StarResult>> {
    this.ensureDb();
    await this.engine.execWithCache(
      'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?',
      [id]
    );
    let newStarred = 0;
    await this.engine.execWithCache(
      'SELECT is_starred FROM browsing_logs WHERE id = ?',
      [id],
      (row: SqliteValue[]) => { newStarred = Number(row[0]); }
    );
    return { success: true, is_starred: newStarred };
  }

  async purgeOldRecords(retentionDays: number, maxRecords: number): Promise<BackendOrError<PurgeResult>> {
    this.ensureDb();
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let totalPurged = 0;

    await this.engine.execWithCache(
      `DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0`,
      [cutoffMs]
    );
    let changes1 = 0;
    await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changes1 = Number(row[0]); });
    totalPurged += changes1;

    let totalCount = 0;
    await this.engine.execWithCache(
      'SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0',
      [],
      (row: SqliteValue[]) => { totalCount = Number(row[0]); }
    );

    if (totalCount > maxRecords) {
      const excess = totalCount - maxRecords;
      await this.engine.execWithCache(
        `DELETE FROM browsing_logs WHERE id IN (
          SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0
          ORDER BY created_at ASC LIMIT ?
        )`,
        [excess]
      );
      let changes2 = 0;
      await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changes2 = Number(row[0]); });
      totalPurged += changes2;
    }

    return { success: true, purged: totalPurged };
  }

  async purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> {
    this.ensureDb();
    const starredClause = includeStarred ? '' : 'AND is_starred = 0';
    let totalPurged = 0;

    if (retentionDays != null && retentionDays > 0) {
      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      await this.engine.execWithCache(
        `UPDATE browsing_logs SET content = NULL
         WHERE content IS NOT NULL AND created_at < ? ${starredClause}`,
        [cutoffMs]
      );
      let changes1 = 0;
      await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changes1 = Number(row[0]); });
      totalPurged += changes1;
    }

    if (maxRecords != null && maxRecords > 0) {
      let count = 0;
      await this.engine.execWithCache(
        `SELECT COUNT(*) FROM browsing_logs WHERE content IS NOT NULL ${starredClause}`,
        [],
        (row: SqliteValue[]) => { count = Number(row[0]); }
      );

      if (count > maxRecords) {
        const excess = count - maxRecords;
        await this.engine.execWithCache(
          `UPDATE browsing_logs SET content = NULL
           WHERE id IN (
             SELECT id FROM browsing_logs
             WHERE content IS NOT NULL ${starredClause}
             ORDER BY created_at ASC
             LIMIT ?
           )`,
          [excess]
        );
        let changes2 = 0;
        await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changes2 = Number(row[0]); });
        totalPurged += changes2;
      }
    }

    return { success: true, purged: totalPurged };
  }

  async getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>> {
    this.ensureDb();
    let count = 0;
    await this.engine.execWithCache(
      'SELECT COUNT(*) FROM browsing_logs_fts',
      [],
      (row: SqliteValue[]) => { count = Number(row[0]); }
    );
    return { success: true, count };
  }

  async backupDb(): Promise<BackendOrError<BackupResult>> {
    return { success: false, error: 'Binary backup requires OPFS storage.' };
  }

  async restoreDb(_data: Uint8Array): Promise<BackendOrError<MutationResult>> {
    return { success: false, error: 'Binary restore requires OPFS storage.' };
  }

  async healthCheck(): Promise<BackendOrError<HealthResult>> {
    this.ensureDb();
    let ok = false;
    await this.engine.execWithCache('SELECT 1', [], () => { ok = true; });
    if (ok) return { success: true };
    return { success: false, error: 'Health check failed' };
  }

  async getStatus(): Promise<BackendOrError<StatusResult>> {
    this.ensureDb();
    return {
      initialized: true,
      fallback: false,
      fts5: this.engine.fts5Available,
      supportsBinaryBackup: false,
      compileOptions: this.engine.cachedCompileOptions ?? undefined,
      compileOptionsSource: 'idb',
    };
  }

  async insertAuditLog(record: AuditLogRecord): Promise<BackendOrError<InsertResult>> {
    this.ensureDb();
    await this.engine.execWithCache(
      `INSERT INTO audit_log (provider, url, created_at) VALUES (?, ?, ?)`,
      [record.provider, record.url, record.created_at]
    );
    let newId = 0;
    await this.engine.execWithCache('SELECT last_insert_rowid()', [], (row: SqliteValue[]) => {
      newId = Number(row[0]);
    });
    return { success: true, id: newId };
  }

  async queryAuditLog(options: { limit?: number; offset?: number }): Promise<BackendOrError<AuditLogQueryResult>> {
    this.ensureDb();
    const limit = Math.min(options.limit ?? 100, 100000);
    const offset = options.offset ?? 0;

    const rows: AuditLogEntry[] = [];
    await this.engine.execWithCache(
      `SELECT id, provider, url, created_at FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]),
          provider: String(row[1]),
          url: String(row[2]),
          created_at: Number(row[3]),
        });
      }
    );

    let total = 0;
    await this.engine.execWithCache('SELECT COUNT(*) FROM audit_log', [], (row: SqliteValue[]) => {
      total = Number(row[0]);
    });

    return { success: true, rows, total };
  }

  async getCount(): Promise<BackendOrError<CountResult>> {
    this.ensureDb();
    let count = 0;
    await this.engine.execWithCache(
      'SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0',
      [],
      (row: SqliteValue[]) => { count = Number(row[0]); }
    );
    return { success: true, count };
  }

  async clearAll(): Promise<BackendOrError<MutationResult>> {
    this.ensureDb();
    await this.engine.execWithCache('DELETE FROM browsing_logs');
    await this.engine.execWithCache('DELETE FROM browsing_logs_fts');
    await this.engine.execWithCache('PRAGMA wal_checkpoint(TRUNCATE)');
    return { success: true };
  }

  private rowToEntry(row: SqliteValue[]): BrowsingLogEntry {
    return {
      id: Number(row[0]),
      url: String(row[1]),
      title: row[2] != null ? String(row[2]) : null,
      summary: row[3] != null ? String(row[3]) : null,
      tags: row[4] != null ? String(row[4]) : null,
      created_at: Number(row[5]),
      domain: row[6] != null ? String(row[6]) : null,
      visit_duration: row[7] != null ? Number(row[7]) : null,
      scroll_ratio: row[8] != null ? Number(row[8]) : null,
      is_starred: Number(row[9]),
      is_deleted: Number(row[10]),
      obsidian_synced: Number(row[11]),
      gist_synced: Number(row[12]),
      content: row[13] != null ? String(row[13]) : null,
      masked_count: row[14] != null ? Number(row[14]) : null,
      cleansed_reason: row[15] != null ? String(row[15]) : null,
      ai_provider: row[16] != null ? String(row[16]) : null,
      ai_model: row[17] != null ? String(row[17]) : null,
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
      fallback_triggered: Number(row[32]),
    };
  }
}
