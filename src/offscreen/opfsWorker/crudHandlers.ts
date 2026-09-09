/**
 * crudHandlers.ts
 * CRUD operations: insert, query, update, hard delete, toggle star, get count, insert batch.
 */

import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { StorageQuery } from '../../utils/sqlite-types.js';
import type { SqliteValue } from '../sqliteEngine.js';
import { INSERT_SQL, INSERT_IGNORE_SQL, buildInsertParams, UPDATABLE_FIELDS } from '../schema.js';
import { buildQuerySpec, QUERY_CAPS, buildPlainListStatements } from '../queryPlan.js';
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
  const { limit = 20, offset = 0, tag } = payload;

  // WHERE/ORDER/tag assembly is shared with IdbVfsBackend via queryPlan.ts
  // (PBI-34). LIMIT passes through unclamped: recordsRepo.query clamps to
  // MAX_QUERY_LIMIT upstream, so re-clamping here to QUERY_CAPS.plain would
  // wrongly cap legitimate large listings.
  const spec = buildQuerySpec({ ...(payload as StorageQuery), limit, offset }, { caps: QUERY_CAPS, fts5Available: false });
  if (spec.error) {
    throw new Error(spec.error);
  }
  const stmts = buildPlainListStatements({ ...spec, limit, offset }, { tag: tag ?? null, columns: BROWSING_LOG_COLUMNS_SQL });
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
  const { id, changes } = payload;
  const sets: string[] = [];
  const vals: SqliteValue[] = [];

  // Whitelist validation — same as IdbVfsBackend.update() to prevent arbitrary field updates
  for (const field of UPDATABLE_FIELDS) {
    const val = changes[field];
    if (val !== undefined) {
      sets.push(`${field} = ?`);
      vals.push(val);
    }
  }

  if (sets.length === 0) return;
  vals.push(id);

  await sqlExec(
    ctx,
    `UPDATE browsing_logs SET ${sets.join(', ')} WHERE id = ?`,
    vals
  );
}

export async function handleHardDelete(ctx: HandlerContext, id: number): Promise<void> {
  await sqlExec(ctx, 'DELETE FROM browsing_logs WHERE id = ?', [id]);
}

export async function handleToggleStar(ctx: HandlerContext, id: number): Promise<{ is_starred: number }> {
  await sqlExec(
    ctx,
    'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id]
  );
  let isStarred = 0;
  await sqlQuery(ctx, 'SELECT is_starred AS is_starred FROM browsing_logs WHERE id = ?', [id], (row) => { isStarred = Number(row.is_starred); });
  return { is_starred: isStarred };
}

export async function handleGetCount(ctx: HandlerContext): Promise<number> {
  let count = 0;
  await sqlQuery(ctx, 'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0', [], (row) => { count = Number(row.c); });
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
      for (const record of records) {
        try {
          const domain = record.domain || extractDomain(record.url);
          await sqlExec(ctx, INSERT_IGNORE_SQL, buildInsertParams(record, domain));
          // Per-row changes(): a single read after the loop only reports the
          // last INSERT, undercounting every multi-row batch with a duplicate.
          let changed = 0;
          await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => {
            changed = Number(row.c);
          });
          if (changed > 0) inserted++;
          else skipped++;
        } catch (err) {
          if (inserted === 0 && records.indexOf(record) === 0) {
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
