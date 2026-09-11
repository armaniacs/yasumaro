// src/offscreen/IdbVfsBackend.ts
import type { SqliteEngineHost } from './sqliteEngineHost.js';
import type { SqliteValue } from './sqliteEngine.js';
import type {
  StorageBackend, InsertResult, InsertBatchResult, QuerySearchResult,
  MutationResult, StarResult, PurgeResult, FtsSizeResult,
  BackupResult, CountResult, HealthResult, AuditLogQueryResult,
  StatusResult, BackendOrError,
} from './StorageBackend.js';
import { archiveUnsupported, BINARY_BACKUP_UNSUPPORTED_ERROR, BINARY_RESTORE_UNSUPPORTED_ERROR } from './StorageBackend.js';
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
import {
  SEARCH_COLUMNS_WITH_RANK, BROWSING_LOG_FULL_COLUMNS, BROWSING_LOG_FULL_COLUMNS_SQL,
  mapPositional,
} from './rowCodec.js';

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
            rows.push(mapPositional<BrowsingLogEntry & { rank: number }>(row, SEARCH_COLUMNS_WITH_RANK));
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
          // LIKE rows carry no rank column; the codec defaults rank to 0.
          rows.push(mapPositional<BrowsingLogEntry & { rank: number }>(row, SEARCH_COLUMNS_WITH_RANK));
        }
      );
      return { success: true, rows, total };
    }

    // Plain filtered listing (no text search). The tag filter rides on the
    // spec (QuerySpec.tagFilter, built with this backend's fts5Available) —
    // PBI 2026-09-11 unified tag semantics: this backend honours the tag the
    // same way the OPFS worker does (the former PBI-34 divergence is gone).
    // Columns are explicit (was SELECT *): same 33 fields, codec order.
    const stmts = buildPlainListStatements(spec, { columns: BROWSING_LOG_FULL_COLUMNS_SQL });

    const rows: (BrowsingLogEntry & { rank: number })[] = [];
    await this.engine.execWithCache(
      stmts.rowsSql,
      stmts.rowsParams,
      (row: SqliteValue[]) => { rows.push({ ...mapPositional<BrowsingLogEntry>(row, BROWSING_LOG_FULL_COLUMNS), rank: 0 }); }
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
    return { success: false, error: BINARY_BACKUP_UNSUPPORTED_ERROR };
  }

  async archivePreview(): Promise<BackendOrError<import('./StorageBackend.js').ArchivePreviewResult>> {
    return archiveUnsupported();
  }

  async archiveCreate(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveCreateResult>> {
    return archiveUnsupported();
  }

  async archiveCleanup(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveCleanupResult>> {
    return archiveUnsupported();
  }

  async archiveExportChunk(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveExportChunkResult>> {
    return archiveUnsupported();
  }

  async archivePrepareIncoming(): Promise<BackendOrError<import('./StorageBackend.js').ArchivePrepareIncomingResult>> {
    return archiveUnsupported();
  }

  async archiveRestorePreview(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveRestorePreviewResult>> {
    return archiveUnsupported();
  }

  async archiveRestore(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveRestoreResult>> {
    return archiveUnsupported();
  }

  async archiveDeleteByStaging(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveDeleteByStagingResult>> {
    return archiveUnsupported();
  }

  async archiveOpen(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveOpenResult>> {
    return archiveUnsupported();
  }

  async archiveQuery(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveQueryResult>> {
    return archiveUnsupported();
  }

  async archiveUpdate(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveUpdateResult>> {
    return archiveUnsupported();
  }

  async archiveSave(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveSaveResult>> {
    return archiveUnsupported();
  }

  async archiveClose(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveCloseResult>> {
    return archiveUnsupported();
  }

  async archiveStatus(): Promise<BackendOrError<import('./StorageBackend.js').ArchiveStatusResult>> {
    return archiveUnsupported();
  }

  async restoreDb(_data: Uint8Array): Promise<BackendOrError<MutationResult>> {
    return { success: false, error: BINARY_RESTORE_UNSUPPORTED_ERROR };
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
}
