/**
 * purgeHandlers.ts
 * Purge operations: delete old records, clear content, clear all.
 */

import { sqlExec, sqlQuery, withTransaction, type HandlerContext } from './handlers.js';
import { errorMessage } from '../../utils/errorUtils.js';

export interface PurgeLogCallback {
  postLog: (level: 'warn' | 'error' | 'info', message: string, details?: Record<string, unknown>) => void;
}

export async function handlePurgeOldRecords(
  ctx: HandlerContext,
  payload: { retentionDays: number; maxRecords: number },
  log: PurgeLogCallback,
): Promise<{ purged: number }> {
  const { retentionDays, maxRecords } = payload;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let totalPurged = 0;

  try {
    await withTransaction(ctx, async () => {
      await sqlExec(
        ctx,
        'DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0',
        [cutoffMs]
      );

      await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => { totalPurged = Number(row.c); });

      let count = 0;
      await sqlQuery(ctx, 'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0', [], (row) => { count = Number(row.c); });

      if (count > maxRecords) {
        const toDelete = count - maxRecords;
        await sqlExec(
          ctx,
          `DELETE FROM browsing_logs WHERE id IN (
             SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0
             ORDER BY created_at ASC LIMIT ?
           )`,
          [toDelete]
        );
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
  const starredClause = payload.includeStarred ? '' : 'AND is_starred = 0';
  let totalPurged = 0;

  if (payload.retentionDays != null && payload.retentionDays > 0) {
    const cutoffMs = Date.now() - payload.retentionDays * 24 * 60 * 60 * 1000;
    await sqlExec(
      ctx,
      `UPDATE browsing_logs SET content = NULL
       WHERE content IS NOT NULL AND created_at < ? ${starredClause}`,
      [cutoffMs]
    );
    await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => { totalPurged += Number(row.c); });
  }

  if (payload.maxRecords != null && payload.maxRecords > 0) {
    let count = 0;
    await sqlQuery(
      ctx,
      `SELECT COUNT(*) AS c FROM browsing_logs WHERE content IS NOT NULL ${starredClause}`,
      [],
      (row) => { count = Number(row.c); }
    );

    if (count > payload.maxRecords) {
      const excess = count - payload.maxRecords;
      await sqlExec(
        ctx,
        `UPDATE browsing_logs SET content = NULL
         WHERE id IN (
           SELECT id FROM browsing_logs
           WHERE content IS NOT NULL ${starredClause}
           ORDER BY created_at ASC
           LIMIT ?
         )`,
        [excess]
      );
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
