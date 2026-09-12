// src/offscreen/IdbVfsBackend.ts
import type { SqliteEngineHost } from './sqliteEngineHost.js';
import type { SqliteValue } from './sqliteEngine.js';
import type {
  StorageBackend, InsertResult, InsertBatchResult, QuerySearchResult,
  MutationResult, StarResult, PurgeResult, FtsSizeResult,
  BackupResult, CountResult, HealthResult, AuditLogQueryResult,
  StatusResult, BackendOrError,
} from './StorageBackend.js';
import { BINARY_BACKUP_UNSUPPORTED_ERROR, BINARY_RESTORE_UNSUPPORTED_ERROR } from './StorageBackend.js';
import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';
import { INSERT_SQL, INSERT_IGNORE_SQL, buildInsertParams, UPDATABLE_FIELDS } from './schema.js';
import { extractDomain, DB_FILENAME } from './sqliteEngineHost.js';
import {
  buildQuerySpec, QUERY_CAPS, buildExtraWhereSql,
  buildFtsMatchQuery, buildLikePattern,
  buildFtsSearchStatements, buildLikeSearchStatements, buildPlainListStatements,
  purgeCutoffMs, buildPurgeOldRecordsStatements,
  contentPurgeStarredClause, buildContentPurgeStatements,
  buildAuditLogStatements,
} from './queryPlan.js';
import { buildTagFilterCondition } from './sqliteQueryBuilder.js';
import { pickDefined } from '../utils/objectUtils.js';
import { withTransaction } from './sqliteTransaction.js';
import { planAuditLog } from './queryPlanner.js';
import { AUDIT_CAP_IDB } from '../messaging/limits.js';
import { buildExportEnvelope, EXPORT_COLUMNS } from './exportEnvelope.js';
import type { SerializeResult } from './StorageBackend.js';
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
    await withTransaction({ exec: (sql) => this.engine.execWithCache(sql) }, async () => {
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
        // PBI 2026-09-11-06 (round 5): text+tag applies BOTH conditions — the
        // tag rides on the FTS/LIKE statements like any other extra filter.
        const tagFilter = q.tag
          ? buildTagFilterCondition(q.tag, { fts5Available: this.engine.fts5Available, idColumn: 'b.id' })
          : null;
        const stmts = buildFtsSearchStatements(extra, {
          ftsQuery: buildFtsMatchQuery(bare),
          orderClause: spec.order,
          limit: spec.limit,
          offset: spec.offset,
          tagFilter,
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
      const likeTagFilter = q.tag
        ? buildTagFilterCondition(q.tag, { fts5Available: false })
        : null;
      const stmts = buildLikeSearchStatements(extra, {
        likePattern: buildLikePattern(q.text),
        orderClause: spec.order,
        limit: spec.limit,
        offset: spec.offset,
        tagFilter: likeTagFilter,
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
    // PBI 2026-09-12-17: paging policy lives in the planner seam — this
    // backend receives already-clamped values (was a per-backend re-derivation
    // riding QUERY_CAPS.fts with no offset policy).
    const { limit, offset } = planAuditLog(options, AUDIT_CAP_IDB);
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

  async serialize(): Promise<BackendOrError<SerializeResult>> {
    this.ensureDb();
    // PBI 2026-09-12-22: shared envelope + column SSOT (was an 11-column
    // hand-mapped positional SELECT inside recordsRepo).
    const rows: Record<string, unknown>[] = [];
    await this.engine.execWithCache(
      `SELECT ${EXPORT_COLUMNS.join(', ')} FROM browsing_logs WHERE is_deleted = 0 ORDER BY created_at DESC`,
      [],
      (row: SqliteValue[]) => {
        const named: Record<string, unknown> = {};
        EXPORT_COLUMNS.forEach((col, i) => { named[col] = row[i]; });
        rows.push(named);
      }
    );
    return { success: true, data: buildExportEnvelope(rows as unknown as Parameters<typeof buildExportEnvelope>[0]) };
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
