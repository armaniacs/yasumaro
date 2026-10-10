// src/offscreen/IdbVfsBackend.ts
import type { SqliteEngine, SqliteValue } from './sqliteEngine.js';
import type {
  StorageBackend, InsertResult, InsertBatchResult, QuerySearchResult,
  MutationResult, StarResult, PurgeResult, FtsSizeResult,
  BackupResult, CountResult, HealthResult, AuditLogQueryResult,
  StatusResult, BackendOrError,
} from './StorageBackend.js';
import { BINARY_BACKUP_UNSUPPORTED_ERROR, BINARY_RESTORE_UNSUPPORTED_ERROR } from './StorageBackend.js';
import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';
import { INSERT_SQL, INSERT_IGNORE_SQL, buildInsertParams } from './schema.js';
import { extractDomain, DB_FILENAME } from './sqliteEngineHost.js';
import {
  buildQuerySpec, buildPlainListStatements, buildFtsMatchQuery,
  purgeCutoffMs, buildPurgeOldRecordsStatements,
  contentPurgeStarredClause, buildContentPurgeStatements,
  buildAuditLogStatements, buildAuditLogPurgeStatements, runPurgeSequence,
  DELETE_BY_ID_SQL, TOGGLE_STAR_SQL, LIVE_COUNT_SQL,
  AUDIT_INSERT_SQL, buildAuditInsertParams, buildUpdateByIdStatements,
  type AlreadyCappedQuery, type PurgeExecutor,
} from './queryPlan.js';
import { QUERY_CAPS } from '../utils/limits.js';
import { pickDefined } from '../utils/objectUtils.js';
import { withTransaction, type TransactionExecutor } from './sqliteTransaction.js';
import { planAuditLog } from './queryPlanner.js';
import { AUDIT_CAP_IDB } from '../utils/limits.js';
import { buildExportEnvelope, EXPORT_COLUMNS } from './exportEnvelope.js';
import type { SerializeResult } from './StorageBackend.js';
import {
  SEARCH_COLUMNS_WITH_RANK, BROWSING_LOG_FULL_COLUMNS, BROWSING_LOG_FULL_COLUMNS_SQL,
  AUDIT_LOG_COLUMNS, mapPositional,
} from './rowCodec.js';
import { runSearch, type SearchInput, type SearchRowSource } from './searchExecution.js';

/** What the two search paths and the plain listing hand back. */
type SearchRow = BrowsingLogEntry & { rank: number };

/**
 * The narrow host surface the IDB backend needs (PBI-05): the exec seam plus
 * the two boot-time reads. The host hands a live view of these over at
 * construction; the backend never reaches the host's mutable state directly.
 */
export interface IdbVfsBackendHost {
  execWithCache(sql: string, params?: SqliteValue[], callback?: (row: SqliteValue[]) => void): Promise<void>;
  idbEngine: SqliteEngine | null;
  fts5Available: boolean;
  cachedCompileOptions: string[] | null;
}

export class IdbVfsBackend implements StorageBackend {
  constructor(private engine: IdbVfsBackendHost) {}

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
   * Single-cell scalar read: runs `sql` with `params` and returns the first
   * cell of the first row, Number-coerced. The engine seam hands rows back as
   * positional arrays and yields nothing (Promise<void>), so this first-cell
   * rule used to be re-spelled at every read site; the helper is its one owner.
   * Semantics preserved from those sites: no row returns the 0 initialiser, a
   * NULL cell coerces to 0, an absent cell to NaN.
   */
  private async scalar(sql: string, params: SqliteValue[] = []): Promise<number> {
    let value = 0;
    await this.engine.execWithCache(sql, params, (row: SqliteValue[]) => { value = Number(row[0]); });
    return value;
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
    const id = await this.scalar('SELECT last_insert_rowid()');
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
        const changed = await this.scalar('SELECT changes()');
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

    const total = await this.scalar(stmts.countSql, stmts.countParams);

    return { success: true, rows, total };
  }

  async update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>> {
    this.ensureDb();
    // Single UPDATABLE_FIELDS loop shared with the OPFS worker (queryPlan).
    // Skip-undefined: the same changes object must write the same row on
    // every backend — the IDB loop used to write NULL for a key present with
    // an undefined value, which the worker skipped (the data divergence).
    const stmts = buildUpdateByIdStatements(id, changes, 'skip-undefined');
    if (!stmts) {
      return { success: true };
    }

    await this.engine.execWithCache(stmts.sql, stmts.params);

    return { success: true };
  }

  async delete(id: number): Promise<BackendOrError<MutationResult>> {
    this.ensureDb();
    await this.engine.execWithCache(DELETE_BY_ID_SQL, [id]);
    return { success: true };
  }

  async toggleStar(id: number): Promise<BackendOrError<StarResult>> {
    this.ensureDb();
    await this.engine.execWithCache(TOGGLE_STAR_SQL, [id]);
    const newStarred = await this.scalar('SELECT is_starred FROM browsing_logs WHERE id = ?', [id]);
    return { success: true, is_starred: newStarred };
  }

  /**
   * Executor seam onto the shared purge sequence (queryPlan.runPurgeSequence,
   * whose header owns the counting rule and the transaction policy). This
   * adapter supplies the engine binding and the two scalar reads in the shape
   * this backend's positional reader needs (a COUNT/changes row is its first
   * cell).
   */
  private get purgeExecutor(): PurgeExecutor {
    return {
      exec: (sql, params) => this.engine.execWithCache(sql, params),
      count: (sql, params) => this.scalar(sql, params),
      changes: () => this.scalar('SELECT changes()'),
    };
  }

  async purgeOldRecords(retentionDays?: number | undefined, maxRecords?: number | undefined): Promise<BackendOrError<PurgeResult>> {
    this.ensureDb();
    // Skip guards live in runPurgeSequence; the gate reads the RAW retentionDays
    // (not a defaulted one), so an absent window still skips the retention
    // delete. countPolicy 'always': purgeOldRecords has always run the cap
    // COUNT even without a maxRecords cap.
    const purged = await runPurgeSequence(this.purgeExecutor, buildPurgeOldRecordsStatements(), {
      retentionDays, maxRecords, countPolicy: 'always',
    });
    return { success: true, purged };
  }

  async purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> {
    this.ensureDb();
    // countPolicy 'when-max-records': content purge has always skipped the cap
    // COUNT entirely unless a positive cap is present.
    const purged = await runPurgeSequence(
      this.purgeExecutor,
      buildContentPurgeStatements(contentPurgeStarredClause(includeStarred)),
      { retentionDays, maxRecords, countPolicy: 'when-max-records' },
    );
    return { success: true, purged };
  }

  async purgeAuditLog(retentionDays?: number | undefined): Promise<BackendOrError<PurgeResult>> {
    this.ensureDb();
    // Not routed through runPurgeSequence: the trail has no cap dimension
    // (no COUNT, no excess step) and its skip guard must return WITHOUT
    // opening a transaction, whereas the shared runner always wraps its
    // sequence in one. Same skip guard as the other purges: without a positive
    // window there is no cutoff, and "no window" must not degrade into
    // "cutoff = now".
    if (retentionDays == null || retentionDays <= 0) {
      return { success: true, purged: 0 };
    }
    const stmts = buildAuditLogPurgeStatements(purgeCutoffMs(retentionDays));
    let purged = 0;
    await withTransaction(this.transaction, async () => {
      await this.engine.execWithCache(stmts.deleteOldSql, stmts.deleteOldParams);
      purged = await this.scalar('SELECT changes()');
    });
    return { success: true, purged };
  }

  async getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>> {
    this.ensureDb();
    const count = await this.scalar('SELECT COUNT(*) FROM browsing_logs_fts');
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
      AUDIT_INSERT_SQL,
      buildAuditInsertParams(record)
    );
    const newId = await this.scalar('SELECT last_insert_rowid()');
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
        rows.push(mapPositional<AuditLogEntry>(row, AUDIT_LOG_COLUMNS));
      }
    );

    const total = await this.scalar(stmts.countSql);

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
    const count = await this.scalar(LIVE_COUNT_SQL);
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
