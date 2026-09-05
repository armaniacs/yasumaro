// src/offscreen/IdbVfsBackend.ts
import type { SqliteEngineHost } from './sqliteEngineHost.js';
import type { SqliteValue } from './sqliteEngine.js';
import type {
  StorageBackend, InsertResult, InsertBatchResult, QuerySearchResult,
  MutationResult, StarResult, PurgeResult, FtsSizeResult,
  BackupResult, CountResult, HealthResult, AuditLogQueryResult,
  StatusResult, BackendOrError,
} from './StorageBackend.js';
import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';
import { INSERT_SQL, INSERT_IGNORE_SQL, buildInsertParams, UPDATABLE_FIELDS } from './schema.js';
import { extractDomain, DB_FILENAME } from './sqliteEngineHost.js';
import {
  buildQuerySpec, QUERY_CAPS, clampLimit, buildExtraWhereSql,
  buildFtsMatchQuery, buildLikePattern,
  buildFtsSearchStatements, buildLikeSearchStatements, buildPlainListStatements,
  purgeCutoffMs, buildPurgeOldRecordsStatements,
  contentPurgeStarredClause, buildContentPurgeStatements,
  buildAuditLogStatements,
} from './queryPlan.js';
import { pickDefined } from '../utils/objectUtils.js';
import { withTransaction } from './opfsWorker/handlers.js';

export class IdbVfsBackend implements StorageBackend {
  constructor(private engine: SqliteEngineHost) {}

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
    await withTransaction(this.engine, async () => {
      for (const record of records) {
        const domain = record.domain || extractDomain(record.url);
        await this.engine.execWithCache(INSERT_IGNORE_SQL, buildInsertParams(record, domain));
        let changed = 0;
        await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changed = Number(row[0]); });
        if (changed > 0) inserted++;
        else skipped++;
      }
    });
    return { success: true, inserted, skipped };
  }

  async query(q: StorageQuery): Promise<BackendOrError<QuerySearchResult>> {
    this.ensureDb();

    const spec = buildQuerySpec(q, { caps: QUERY_CAPS, fts5Available: this.engine.fts5Available });
    if (spec.error) return { success: false, error: spec.error };

    const extra = buildExtraWhereSql(q);

    if (q.text) {
      const bare = spec.bareText;
      if (!bare) return { success: true, rows: [], total: 0 };

      if (spec.useFts) {
        const stmts = buildFtsSearchStatements(extra, {
          ftsQuery: buildFtsMatchQuery(bare),
          orderClause: spec.order,
          limit: spec.limit,
          offset: spec.offset,
        });

        let total = 0;
        await this.engine.execWithCache(
          stmts.countSql,
          stmts.countParams,
          (row: SqliteValue[]) => { total = Number(row[0]); }
        );

        const rows: (BrowsingLogEntry & { rank: number })[] = [];
        await this.engine.execWithCache(
          stmts.rowsSql,
          stmts.rowsParams,
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

      // LIKE fallback
      const stmts = buildLikeSearchStatements(extra, {
        likePattern: buildLikePattern(q.text),
        orderClause: spec.order,
        limit: spec.limit,
        offset: spec.offset,
      });

      let total = 0;
      await this.engine.execWithCache(
        stmts.countSql,
        stmts.countParams,
        (row: SqliteValue[]) => { total = Number(row[0]); }
      );

      const rows: (BrowsingLogEntry & { rank: number })[] = [];
      await this.engine.execWithCache(
        stmts.rowsSql,
        stmts.rowsParams,
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

    // Plain filtered listing (no text search). NOTE: the #tag filter is
    // intentionally NOT applied here — opfs QUERY honours it while this
    // backend ignores it. PBI-34 keeps that gap explicit (see
    // buildPlainListStatements) instead of silently changing results.
    const stmts = buildPlainListStatements(spec);

    const rows: (BrowsingLogEntry & { rank: number })[] = [];
    await this.engine.execWithCache(
      stmts.rowsSql,
      stmts.rowsParams,
      (row: SqliteValue[]) => { rows.push({ ...this.rowToEntry(row), rank: 0 }); }
    );

    let total = 0;
    await this.engine.execWithCache(
      stmts.countSql,
      stmts.countParams,
      (row: SqliteValue[]) => { total = Number(row[0]); }
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
    const stmts = buildPurgeOldRecordsStatements(purgeCutoffMs(retentionDays));
    let totalPurged = 0;

    await this.engine.execWithCache(stmts.deleteOldSql, stmts.deleteOldParams);
    let changes1 = 0;
    await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changes1 = Number(row[0]); });
    totalPurged += changes1;

    let totalCount = 0;
    await this.engine.execWithCache(
      stmts.countSql,
      [],
      (row: SqliteValue[]) => { totalCount = Number(row[0]); }
    );

    if (totalCount > maxRecords) {
      const excess = totalCount - maxRecords;
      await this.engine.execWithCache(stmts.deleteExcessSql, [excess]);
      let changes2 = 0;
      await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changes2 = Number(row[0]); });
      totalPurged += changes2;
    }

    return { success: true, purged: totalPurged };
  }

  async purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> {
    this.ensureDb();
    const stmts = buildContentPurgeStatements(contentPurgeStarredClause(includeStarred));
    let totalPurged = 0;

    if (retentionDays != null && retentionDays > 0) {
      const cutoffMs = purgeCutoffMs(retentionDays);
      await this.engine.execWithCache(stmts.deleteOldSql, [cutoffMs]);
      let changes1 = 0;
      await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changes1 = Number(row[0]); });
      totalPurged += changes1;
    }

    if (maxRecords != null && maxRecords > 0) {
      let count = 0;
      await this.engine.execWithCache(
        stmts.countSql,
        [],
        (row: SqliteValue[]) => { count = Number(row[0]); }
      );

      if (count > maxRecords) {
        const excess = count - maxRecords;
        await this.engine.execWithCache(stmts.clearExcessSql, [excess]);
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
      path: `IDB:${DB_FILENAME}`,
      fallback: false,
      fts5: this.engine.fts5Available,
      supportsBinaryBackup: false,
      compileOptionsSource: 'idb',
      ...pickDefined({ compileOptions: this.engine.cachedCompileOptions ?? undefined }),
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
    // NOTE: audit cap 100000 differs intentionally from the opfs worker
    // cap (1000) — preserved, see buildAuditLogStatements.
    const limit = clampLimit(options.limit, 100000, 100);
    const offset = options.offset ?? 0;
    const stmts = buildAuditLogStatements({ limit, offset });

    const rows: AuditLogEntry[] = [];
    await this.engine.execWithCache(
      stmts.rowsSql,
      stmts.rowsParams,
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
    await this.engine.execWithCache(stmts.countSql, [], (row: SqliteValue[]) => {
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
