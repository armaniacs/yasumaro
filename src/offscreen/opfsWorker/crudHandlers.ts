/**
 * crudHandlers.ts
 * CRUD operations: insert, query, update, hard delete, toggle star, get count, insert batch.
 */

import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { StorageQuery } from '../../utils/sqlite-types.js';
import type { SqliteValue } from '../sqliteEngine.js';
import { INSERT_SQL, INSERT_IGNORE_RETURNING_SQL, buildInsertParams } from '../schema.js';
import {
  buildQuerySpec, buildPlainListStatements,
  DELETE_BY_ID_SQL, TOGGLE_STAR_SQL, LIVE_COUNT_SQL, buildUpdateByIdStatements,
  type AlreadyCappedQuery,
} from '../queryPlan.js';
import { QUERY_CAPS } from '../../utils/limits.js';
import { BROWSING_LOG_COLUMNS, BROWSING_LOG_COLUMNS_SQL, mapNamed } from '../rowCodec.js';
import type { QueryPayload } from './types.js';
import { sqlExec, sqlQuery, withTransaction, type HandlerContext } from './handlers.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { extractDomain } from '../../utils/domainUtils.js';

export async function handleInsert(ctx: HandlerContext, record: BrowsingLogRecord): Promise<{ id: number }> {
  const domain = record.domain || extractDomain(record.url);
  await sqlExec(ctx, INSERT_SQL, buildInsertParams(record, domain));
  let id = 0;
  await sqlQuery(ctx, 'SELECT last_insert_rowid() AS id', [], (row) => { id = Number(row.id); });
  return { id };
}

export async function handleQuery(ctx: HandlerContext, payload: QueryPayload): Promise<{ rows: BrowsingLogRecord[]; total: number }> {
  // WHERE/ORDER/tag assembly is shared with IdbVfsBackend via queryPlan.ts
  // (PBI-34). The spec is the read policy: buildQuerySpec clamps limit and
  // offset (PBI 2026-09-12-06) — the worker passes it through untouched, same
  // as IdbVfsBackend. The old `{...spec, limit, offset}` spread re-applied
  // wire values over the clamped spec (the only backend that did) and made
  // the same query return different rows per backend.
  // fts5Available: true — the OPFS engine is FTS5-enabled and the tag filter
  // uses the trigram MATCH path for terms >= 3 chars (PBI 2026-09-11).
  // Worker boundary: the AlreadyCappedQuery brand does not survive the
  // structured clone of the wire payload — the caps re-application inside
  // buildQuerySpec is the documented defensive point here.
  const spec = buildQuerySpec({ ...(payload as StorageQuery) } as unknown as AlreadyCappedQuery, { caps: QUERY_CAPS, fts5Available: true });
  if (spec.error) {
    throw new Error(spec.error);
  }
  const stmts = buildPlainListStatements(spec, { columns: BROWSING_LOG_COLUMNS_SQL });
  const params: SqliteValue[] = stmts.countParams;

  let total = 0;
  await sqlQuery(ctx, stmts.countSql, params, (row) => { total = Number(row.c); });

  const rows: BrowsingLogRecord[] = [];
  await sqlQuery(
    ctx,
    stmts.rowsSql,
    stmts.rowsParams,
    (row) => {
      rows.push(mapNamed<BrowsingLogRecord>(row, BROWSING_LOG_COLUMNS));
    }
  );

  return { rows, total };
}

export async function handleUpdate(ctx: HandlerContext, payload: { id: number; changes: Record<string, SqliteValue> }): Promise<void> {
  // Single UPDATABLE_FIELDS loop shared with IdbVfsBackend (queryPlan).
  // Skip-undefined: the same changes object must write the same row on
  // every backend — the IDB loop used to write NULL for a key present with
  // an undefined value, which this handler skipped (the data divergence).
  const stmts = buildUpdateByIdStatements(payload.id, payload.changes, 'skip-undefined');
  if (!stmts) return;

  await sqlExec(ctx, stmts.sql, stmts.params);
}

export async function handleHardDelete(ctx: HandlerContext, id: number): Promise<void> {
  await sqlExec(ctx, DELETE_BY_ID_SQL, [id]);
}

export async function handleToggleStar(ctx: HandlerContext, id: number): Promise<{ is_starred: number }> {
  await sqlExec(ctx, TOGGLE_STAR_SQL, [id]);
  let isStarred = 0;
  await sqlQuery(ctx, 'SELECT is_starred AS is_starred FROM browsing_logs WHERE id = ?', [id], (row) => { isStarred = Number(row.is_starred); });
  return { is_starred: isStarred };
}

export async function handleGetCount(ctx: HandlerContext): Promise<number> {
  let count = 0;
  await sqlQuery(ctx, LIVE_COUNT_SQL, [], (row) => { count = Number(row.c); });
  return count;
}

export async function handleInsertBatch(
  ctx: HandlerContext,
  records: BrowsingLogRecord[],
  postLog: (level: 'warn' | 'error' | 'info', message: string, details?: Record<string, unknown>) => void,
  ensureEngine: () => Promise<void>,
): Promise<{ count: number; inserted: number; skipped: number }> {
  await ensureEngine();
  let inserted = 0;
  let skipped = 0;
  try {
    await withTransaction(ctx, async () => {
      // Per-row counting via RETURNING: a single post-loop changes() only
      // reports the last INSERT, undercounting every multi-row batch with a
      // duplicate, and a total_changes() diff would include the FTS5 sync
      // triggers' shadow writes (~7 per insert). RETURNING yields exactly the
      // rows this statement inserted, so N statements give the exact count.
      for (const [index, record] of records.entries()) {
        try {
          const domain = record.domain || extractDomain(record.url);
          let insertedNow = false;
          await sqlQuery(ctx, INSERT_IGNORE_RETURNING_SQL, buildInsertParams(record, domain), () => {
            insertedNow = true;
          });
          if (insertedNow) inserted++;
          else skipped++;
        } catch (err) {
          if (index === 0) {
            postLog('error', 'OPFS Worker: first INSERT failed', { error: errorMessage(err), url: record.url });
          }
        }
      }
    });
  } catch (err) {
    postLog('error', 'OPFS Worker: insertBatch transaction failed', { error: errorMessage(err) });
  }
  return { count: inserted, inserted, skipped };
}
