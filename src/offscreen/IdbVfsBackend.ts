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
  buildQuerySpec, buildPlainListStatements, buildFtsMatchQuery,
  purgeCutoffMs, buildPurgeOldRecordsStatements,
  contentPurgeStarredClause, buildContentPurgeStatements,
  buildAuditLogStatements, buildAuditLogPurgeStatements,
  type AlreadyCappedQuery,
} from './queryPlan.js';
import { QUERY_CAPS } from '../utils/limits.js';
import { pickDefined } from '../utils/objectUtils.js';
import { withTransaction, type TransactionExecutor } from './sqliteTransaction.js';
import { planAuditLog, DEFAULT_RETENTION_DAYS as DEFAULT_PURGE_RETENTION_DAYS } from './queryPlanner.js';
import { AUDIT_CAP_IDB } from '../utils/limits.js';
import { buildExportEnvelope, EXPORT_COLUMNS } from './exportEnvelope.js';
import type { SerializeResult } from './StorageBackend.js';
import {
  SEARCH_COLUMNS_WITH_RANK, BROWSING_LOG_FULL_COLUMNS, BROWSING_LOG_FULL_COLUMNS_SQL,
  mapPositional,
} from './rowCodec.js';
import { runSearch, type SearchInput, type SearchRowSource } from './searchExecution.js';

/** What the two search paths and the plain listing hand back. */
type SearchRow = BrowsingLogEntry & { rank: number };

export class IdbVfsBackend implements StorageBackend {
  constructor(private engine: SqliteEngineHost) {}

  private ensureDb(): void {
    if (!this.engine.idbEngine) throw new Error('IDB VFS database not initialized');
  }

  /**
   * One-line adapter onto the neutral transaction discipline. Reused by every
   * multi-statement write so the wrap policy below is stated once, not
   * re-decided per method.
   */
  private get transaction(): TransactionExecutor {
    return { exec: (sql) => this.engine.execWithCache(sql) };
  }

  /**
   * The host's half of the shared search skeleton: `execWithCache` yields
   * positional values in SELECT order, so rows decode positionally and a COUNT
   * row is its first cell. `per-path` qualification qualifies the FTS JOIN's
   * filter columns and leaves the unaliased LIKE path alone — one unqualified
   * projection for both throws `no such column: b.is_deleted` on the short-text
   * path, so the two paths cannot share one projection.
   */
  private get searchRowSource(): SearchRowSource<SqliteValue[], SearchRow> {
    return {
      run: (sql, params, onRow) => this.engine.execWithCache(sql, params, onRow),
      count: (row) => Number(row[0]),
      decode: (row) => mapPositional<SearchRow>(row, SEARCH_COLUMNS_WITH_RANK),
    };
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
    await withTransaction(this.transaction, async () => {
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

    // q is the planQuery output that reached this backend through the engine;
    // the worker-boundary cast is the documented defensive re-clamp point.
    const spec = buildQuerySpec(q as unknown as AlreadyCappedQuery, { caps: QUERY_CAPS, fts5Available: this.engine.fts5Available });
    if (spec.error) return { success: false, error: spec.error };

    if (spec.mode === 'search') {
      const bare = spec.bareText;
      if (!bare) return { success: true, rows: [], total: 0 };

      // FTS takes the phrase-quoted sanitized term, LIKE the raw text
      // (buildLikePattern applies it) — the same split the worker makes.
      const input: SearchInput = spec.useFts
        ? { path: 'fts', ftsQuery: buildFtsMatchQuery(bare) }
        // Non-null: spec.mode === 'search' is derived from `q.text` truthiness
        // (planQueryMode), so this branch has text.
        : { path: 'like', rawTerm: q.text! };

      const { rows, total } = await runSearch({
        reader: this.searchRowSource,
        input,
        query: q,
        limit: spec.limit,
        offset: spec.offset,
        orderBy: q.orderBy,
        orderDir: q.orderDir,
        // 'error' is the host's policy, and spec.error above already rejected
        // anything out of the whitelist — this is the belt to that braces.
        onInvalid: 'error',
        extraQualification: 'per-path',
        fts5Available: this.engine.fts5Available,
      });
      return { success: true, rows, total };
    }

    // Plain filtered listing (no text search). The tag filter rides on the
    // spec (QuerySpec.tagFilter, built with this backend's fts5Available) —
    // PBI 2026-09-11 unified tag semantics: this backend honours the tag the
    // same way the OPFS worker does (the former PBI-34 divergence is gone).
    // Columns are explicit (was SELECT *): same 33 fields, codec order.
    const stmts = buildPlainListStatements(spec, { columns: BROWSING_LOG_FULL_COLUMNS_SQL });

    const rows: SearchRow[] = [];
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

  /**
   * Transaction policy for the purge family, shared verbatim with
   * opfsWorker/purgeHandlers.ts: a purge runs its whole sequence inside one
   * `withTransaction`. Every purge here reads (`SELECT changes()` after a
   * write, or a COUNT that decides the next write's LIMIT), and a purge
   * interleaved with a recording would otherwise report a count taken from one
   * snapshot while deleting rows selected from another. `clearAll` is the one
   * deliberate exception: its statements are unconditional deletes with no
   * read between writes, and its closing `wal_checkpoint` is rejected inside
   * a transaction.
   */
  async purgeOldRecords(retentionDays?: number | undefined, maxRecords?: number | undefined): Promise<BackendOrError<PurgeResult>> {
    this.ensureDb();
    // PBI 2026-09-12-36: skip guards — same contract as purgeContent. Before
    // this, (0,0) purged everything (cutoff = now) while content-purge(0,0)
    // was a no-op. Statements are built unconditionally (plain SQL strings);
    // only their EXECUTION is gated.
    const stmts = buildPurgeOldRecordsStatements(purgeCutoffMs(retentionDays ?? DEFAULT_PURGE_RETENTION_DAYS));
    let totalPurged = 0;

    await withTransaction(this.transaction, async () => {
      if (retentionDays != null && retentionDays > 0) {
        await this.engine.execWithCache(stmts.deleteOldSql, stmts.deleteOldParams);
        let changes1 = 0;
        await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changes1 = Number(row[0]); });
        totalPurged += changes1;
      }

      let totalCount = 0;
      await this.engine.execWithCache(
        stmts.countSql,
        [],
        (row: SqliteValue[]) => { totalCount = Number(row[0]); }
      );

      if (maxRecords != null && maxRecords > 0 && totalCount > maxRecords) {
        const excess = totalCount - maxRecords;
        await this.engine.execWithCache(stmts.deleteExcessSql, [excess]);
        let changes2 = 0;
        await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { changes2 = Number(row[0]); });
        totalPurged += changes2;
      }
    });

    return { success: true, purged: totalPurged };
  }

  async purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> {
    this.ensureDb();
    const stmts = buildContentPurgeStatements(contentPurgeStarredClause(includeStarred));
    let totalPurged = 0;

    await withTransaction(this.transaction, async () => {
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
    });

    return { success: true, purged: totalPurged };
  }

  async purgeAuditLog(retentionDays?: number | undefined): Promise<BackendOrError<PurgeResult>> {
    this.ensureDb();
    // Same skip guard as the other purges: without a positive window there is
    // no cutoff, and "no window" must not degrade into "cutoff = now".
    if (retentionDays == null || retentionDays <= 0) {
      return { success: true, purged: 0 };
    }
    const stmts = buildAuditLogPurgeStatements(purgeCutoffMs(retentionDays));
    let purged = 0;
    await withTransaction(this.transaction, async () => {
      await this.engine.execWithCache(stmts.deleteOldSql, stmts.deleteOldParams);
      await this.engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => { purged = Number(row[0]); });
    });
    return { success: true, purged };
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
    // The documented exception to the purge transaction policy above: every
    // statement here is an unconditional delete with no read between writes,
    // and `wal_checkpoint` cannot run inside a transaction.
    await this.engine.execWithCache('DELETE FROM browsing_logs');
    await this.engine.execWithCache('DELETE FROM browsing_logs_fts');
    // audit_log is a separate table with its own retention sweep, so clearing
    // the browsing history without it would leave the send trail behind.
    await this.engine.execWithCache('DELETE FROM audit_log');
    await this.engine.execWithCache('PRAGMA wal_checkpoint(TRUNCATE)');
    return { success: true };
  }
}
