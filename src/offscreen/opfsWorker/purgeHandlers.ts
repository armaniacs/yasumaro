/**
 * purgeHandlers.ts
 * Purge operations: delete old records, clear content, clear all.
 *
 * DELETE/UPDATE conditions come from queryPlan.ts shared builders (PBI-34),
 * mirroring IdbVfsBackend.purgeOldRecords/purgeContent. Only the execution
 * wrapper differs (transaction here): the conditions themselves are shared.
 */

import { sqlExec, sqlQuery, withTransaction, type HandlerContext } from './handlers.js';
import {
  purgeCutoffMs,
  buildPurgeOldRecordsStatements,
  contentPurgeStarredClause,
  buildContentPurgeStatements,
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
      // NOTE (preserved, PBI-34): reports the computed excess rather than
      // changes() (which the idb backend uses). Equal in the normal case;
      // see buildContentPurgeStatements docs.
      totalPurged += excess;
    }
  }

  return { purged: totalPurged };
}

export async function handleClearAll(ctx: HandlerContext, fts5Available: boolean): Promise<void> {
  await sqlExec(ctx, 'DELETE FROM browsing_logs', []);
  if (fts5Available) {
    await sqlExec(ctx, "INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')", []);
  }
}
