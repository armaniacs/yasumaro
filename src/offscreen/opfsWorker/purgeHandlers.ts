/**
 * purgeHandlers.ts
 * Purge operations: delete old records, clear content, clear all.
 *
 * DELETE/UPDATE conditions come from queryPlan.ts shared builders (PBI-34),
 * and the gate → changes() → COUNT → excess delete → changes() sequence runs
 * through the shared runner `runPurgeSequence` (whose header owns the
 * transaction policy and the changes()-based counting rule), mirroring
 * IdbVfsBackend.purgeOldRecords/purgeContent. Only the engine binding (the
 * executor seam) differs here: sqlExec/sqlQuery over the worker's engine.
 */

import { sqlExec, sqlQuery, withTransaction, type HandlerContext } from './handlers.js';
import {
  purgeCutoffMs,
  buildPurgeOldRecordsStatements,
  contentPurgeStarredClause,
  buildContentPurgeStatements,
  buildAuditLogPurgeStatements,
  runPurgeSequence,
  type PurgeExecutor,
} from '../queryPlan.js';
import { errorMessage } from '../../utils/errorUtils.js';

export interface PurgeLogCallback {
  postLog: (level: 'warn' | 'error' | 'info', message: string, details?: Record<string, unknown>) => void;
}

/** Engine binding for the shared purge sequence; named-row reader (`row.c`). */
function makePurgeExecutor(ctx: HandlerContext): PurgeExecutor {
  return {
    exec: (sql, params) => sqlExec(ctx, sql, params),
    count: async (sql, params) => {
      let value = 0;
      await sqlQuery(ctx, sql, params, (row) => { value = Number(row.c); });
      return value;
    },
    changes: async () => {
      let value = 0;
      await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => { value = Number(row.c); });
      return value;
    },
  };
}

export async function handlePurgeOldRecords(
  ctx: HandlerContext,
  payload: { retentionDays?: number; maxRecords?: number },
  log: PurgeLogCallback,
): Promise<{ purged: number }> {
  // Skip guards live in runPurgeSequence; the gate reads the RAW retentionDays
  // (not a defaulted one), so an absent window still skips the retention
  // delete. countPolicy 'always': purgeOldRecords has always run the cap COUNT
  // even without a maxRecords cap.
  let purged = 0;
  try {
    purged = await runPurgeSequence(makePurgeExecutor(ctx), buildPurgeOldRecordsStatements(), {
      retentionDays: payload.retentionDays,
      maxRecords: payload.maxRecords,
      countPolicy: 'always',
    });
  } catch (err) {
    log.postLog('error', 'OPFS Worker: purge transaction failed', { error: errorMessage(err) });
    throw err;
  }
  return { purged };
}

export async function handleContentPurge(
  ctx: HandlerContext,
  payload: {
    retentionDays?: number | null;
    maxRecords?: number | null;
    includeStarred?: boolean | null;
  },
): Promise<{ purged: number }> {
  // countPolicy 'when-max-records': content purge has always skipped the cap
  // COUNT entirely unless a positive cap is present.
  const purged = await runPurgeSequence(
    makePurgeExecutor(ctx),
    buildContentPurgeStatements(contentPurgeStarredClause(payload.includeStarred)),
    {
      retentionDays: payload.retentionDays,
      maxRecords: payload.maxRecords,
      countPolicy: 'when-max-records',
    },
  );
  return { purged };
}

export async function handleAuditLogPurge(
  ctx: HandlerContext,
  payload: { retentionDays?: number },
): Promise<{ purged: number }> {
  // Not routed through runPurgeSequence: the trail has no cap dimension (no
  // COUNT, no excess step) and its skip guard must return WITHOUT opening a
  // transaction, whereas the shared runner always wraps its sequence in one.
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
  // The documented exception to the transaction policy in runPurgeSequence's
  // header: unconditional deletes, nothing read between writes.
  await sqlExec(ctx, 'DELETE FROM browsing_logs', []);
  // audit_log is a separate table with its own retention sweep, so clearing
  // the browsing history without it would leave the send trail behind.
  await sqlExec(ctx, 'DELETE FROM audit_log', []);
  if (fts5Available) {
    await sqlExec(ctx, "INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')", []);
  }
}
