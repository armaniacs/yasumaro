/**
 * purgeHandlers.ts
 * Purge operations: delete old records, clear content, clear all.
 *
 * DELETE/UPDATE conditions come from queryPlan.ts shared builders (PBI-34),
 * mirroring IdbVfsBackend.purgeOldRecords/purgeContent. Only the execution
 * wrapper differs (sqlExec over the worker's engine): the conditions, the
 * counting rule and the transaction policy are shared.
 *
 * TRANSACTION POLICY (identical to IdbVfsBackend): every purge runs its whole
 * sequence inside one `withTransaction`, because each one reads between its
 * writes — `SELECT changes()` feeds the reported count, and the cap COUNT
 * decides the next statement's LIMIT. A recording landing between the two
 * would otherwise make the count describe one snapshot and the delete another.
 * `handleClearAll` is the single documented exception: unconditional deletes
 * with no read between writes, so a transaction buys nothing.
 *
 * COUNTING: `purged` is the executed-row count (`SELECT changes()`) on every
 * path, both backends. The computed excess is only what the cap statement was
 * asked to touch, not what it touched, so reporting it turned a disagreement
 * between the count and the delete into a wrong number. The transaction above
 * is what keeps that disagreement from arising; changes() is what keeps the
 * report true either way.
 */

import { sqlExec, sqlQuery, withTransaction, type HandlerContext } from './handlers.js';
import {
  purgeCutoffMs,
  buildPurgeOldRecordsStatements,
  contentPurgeStarredClause,
  buildContentPurgeStatements,
  buildAuditLogPurgeStatements,
} from '../queryPlan.js';
import { DEFAULT_RETENTION_DAYS as DEFAULT_PURGE_RETENTION_DAYS } from '../queryPlanner.js';
import { errorMessage } from '../../utils/errorUtils.js';

export interface PurgeLogCallback {
  postLog: (level: 'warn' | 'error' | 'info', message: string, details?: Record<string, unknown>) => void;
}

export async function handlePurgeOldRecords(
  ctx: HandlerContext,
  payload: { retentionDays?: number; maxRecords?: number },
  log: PurgeLogCallback,
): Promise<{ purged: number }> {
  const { retentionDays, maxRecords } = payload;
  // PBI 2026-09-12-36: skip guards — same contract as purgeContent. Before
  // this, (0,0) purged everything (cutoff = now) while content-purge(0,0)
  // was a no-op.
  const stmts = buildPurgeOldRecordsStatements(purgeCutoffMs(retentionDays ?? DEFAULT_PURGE_RETENTION_DAYS));
  let totalPurged = 0;

  try {
    await withTransaction(ctx, async () => {
      if (retentionDays != null && retentionDays > 0) {
        await sqlExec(ctx, stmts.deleteOldSql, [...stmts.deleteOldParams]);

        await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => { totalPurged = Number(row.c); });
      }

      let count = 0;
      await sqlQuery(ctx, stmts.countSql, [], (row) => { count = Number(row.c); });

      if (maxRecords != null && maxRecords > 0 && count > maxRecords) {
        const toDelete = count - maxRecords;
        await sqlExec(ctx, stmts.deleteExcessSql, [toDelete]);
        await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => { totalPurged += Number(row.c); });
      }
    });
  } catch (err) {
    log.postLog('error', 'OPFS Worker: purge transaction failed', { error: errorMessage(err) });
    throw err;
  }

  return { purged: totalPurged };
}

export async function handleContentPurge(
  ctx: HandlerContext,
  payload: {
    retentionDays?: number | null;
    maxRecords?: number | null;
    includeStarred?: boolean | null;
  },
): Promise<{ purged: number }> {
  const stmts = buildContentPurgeStatements(contentPurgeStarredClause(payload.includeStarred));
  let totalPurged = 0;

  await withTransaction(ctx, async () => {
    if (payload.retentionDays != null && payload.retentionDays > 0) {
      const cutoffMs = purgeCutoffMs(payload.retentionDays);
      await sqlExec(ctx, stmts.deleteOldSql, [cutoffMs]);
      await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => { totalPurged += Number(row.c); });
    }

    if (payload.maxRecords != null && payload.maxRecords > 0) {
      let count = 0;
      await sqlQuery(ctx, stmts.countSql, [], (row) => { count = Number(row.c); });

      if (count > payload.maxRecords) {
        const excess = count - payload.maxRecords;
        await sqlExec(ctx, stmts.clearExcessSql, [excess]);
        await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => { totalPurged += Number(row.c); });
      }
    }
  });

  return { purged: totalPurged };
}

export async function handleAuditLogPurge(
  ctx: HandlerContext,
  payload: { retentionDays?: number },
): Promise<{ purged: number }> {
  // Same skip guard as the sibling purges: without a positive window there is
  // no cutoff, and "no window" must not degrade into "cutoff = now".
  if (payload.retentionDays == null || payload.retentionDays <= 0) {
    return { purged: 0 };
  }
  const stmts = buildAuditLogPurgeStatements(purgeCutoffMs(payload.retentionDays));
  let purged = 0;
  await withTransaction(ctx, async () => {
    await sqlExec(ctx, stmts.deleteOldSql, [...stmts.deleteOldParams]);
    await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => { purged = Number(row.c); });
  });
  return { purged };
}

export async function handleClearAll(ctx: HandlerContext, fts5Available: boolean): Promise<void> {
  // The documented exception to the transaction policy in the file header:
  // unconditional deletes, nothing read between writes.
  await sqlExec(ctx, 'DELETE FROM browsing_logs', []);
  // audit_log is a separate table with its own retention sweep, so clearing
  // the browsing history without it would leave the send trail behind.
  await sqlExec(ctx, 'DELETE FROM audit_log', []);
  if (fts5Available) {
    await sqlExec(ctx, "INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')", []);
  }
}
