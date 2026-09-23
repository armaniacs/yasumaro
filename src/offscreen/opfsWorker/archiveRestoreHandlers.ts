/**
 * archiveRestoreHandlers.ts
 * OPFS-worker handlers for restoring an archive-format .db into the main DB
 * (PBI 2026-09-06-03).
 *
 * Safety invariants:
 * - The staging name must have been issued by the registry (fail-closed).
 * - `validateArchiveEngine` runs in reject mode before a single row moves.
 * - Worker-side resource ceilings (MAX_ARCHIVE_RESTORE_ROWS/_BYTES) gate both
 *   validation and every restore batch; a ceiling breach aborts with
 *   ARC_CAP_001/ARC_CAP_002 and discards the staging so no partial restore
 *   remains behind.
 * - Rows are re-numbered (archive `id` is NOT carried over) and deduplicated
 *   by the main DB's UNIQUE(url, created_at) via INSERT OR IGNORE.
 * - Per-row error handling: a CHECK/type violation never aborts the restore;
 *   it is counted in `skippedInvalid` (Checking Team requirement).
 * - Batches of 5000 with BEGIN IMMEDIATE/COMMIT. A mid-restore failure leaves
 *   the main DB consistent; re-running the same archive converges because
 *   already-inserted rows are skipped by the UNIQUE constraint.
 * - `domain` is re-derived from the URL at restore time (archive values are
 *   untrusted input).
 * - Single-flight: one restore at a time (module-level flag).
 */

import type { HandlerContext } from './handlers.js';
import { sqlExec, withTransaction } from './handlers.js';
import type { ArchiveRestorePreviewPayload, ArchiveRestorePayload } from './types.js';
import { createEngine, type SqliteValue } from '../sqliteEngine.js';
import { COLUMN_NAMES, INSERT_IGNORE_SQL, buildInsertParams } from '../schema.js';
import { validateArchiveEngine } from './archiveValidation.js';
import {
  ARC_CAP_BYTES,
  ARC_CAP_ROWS,
  MAX_ARCHIVE_RESTORE_BYTES,
  MAX_ARCHIVE_RESTORE_ROWS,
  assertRowTotalWithinCap,
  estimateBatchBytes,
} from './archiveGuards.js';
import {
  prepareIncoming,
  releaseStaging,
  assertRegisteredStagingName,
} from './archiveStaging.js';
import { extractDomain } from '../../utils/domainUtils.js';

const WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href;
const RESTORE_BATCH = 5000;

let archiveRestoreInFlight = false;

/**
 * Abort a restore that exceeded a resource ceiling. Unlike transient
 * failures (which keep the staging for retry), an oversized file is
 * permanently rejected, so the staging is discarded best-effort and the
 * ARC_CAP_* error propagates. Engine close and the in-flight reset stay
 * with the caller's finally blocks, as on every other error path.
 */
async function abortRestoreOverCap(stagingName: string, message: string): Promise<never> {
  try {
    await releaseStaging(stagingName);
  } catch {
    // Release failure must not mask the ceiling violation.
  }
  throw new Error(message);
}

/** Issue a registered incoming staging name for the dashboard to fill. */
export async function handleArchivePrepareIncoming(
  _ctx: HandlerContext,
): Promise<{ stagingName: string }> {
  const stagingName = await prepareIncoming();
  return { stagingName };
}

/** Read-only preview of a validated staging file (engine always closed). */
export async function handleArchiveRestorePreview(
  _ctx: HandlerContext,
  payload: ArchiveRestorePreviewPayload,
): Promise<{
  recordCount: number;
  cutoffDate: string;
  cutoffMs: number;
  includeDeleted: boolean;
  oldest: number | null;
  newest: number | null;
}> {
  assertRegisteredStagingName(payload.stagingName);
  const engine = await createEngine(payload.stagingName, WASM_URL);
  try {
    const validation = await validateArchiveEngine(engine, { recordCountMismatch: 'reject' });
    const meta = validation.meta;
    if (!meta) {
      throw new Error('Archive restore preview failed: meta unavailable');
    }
    const oldest = await engine.queryValue('SELECT MIN(created_at) AS m FROM browsing_logs');
    const newest = await engine.queryValue('SELECT MAX(created_at) AS m FROM browsing_logs');
    return {
      recordCount: validation.recordCount,
      cutoffDate: meta.cutoffDate,
      cutoffMs: meta.cutoffCreatedAt,
      includeDeleted: meta.includeDeleted === 1,
      oldest: typeof oldest === 'number' ? oldest : null,
      newest: typeof newest === 'number' ? newest : null,
    };
  } finally {
    await engine.close();
  }
}

/**
 * Merge-restore: SELECT rows from the staging archive (id excluded — the main
 * DB renumbers) and INSERT OR IGNORE into the main engine. Counts are taken
 * per row via `SELECT changes()` (COUNT-difference would conflate concurrent
 * recordings).
 */
export async function handleArchiveRestore(
  ctx: HandlerContext,
  payload: ArchiveRestorePayload,
): Promise<{ restored: number; restoredDeleted: number; skipped: number; skippedInvalid: number }> {
  if (archiveRestoreInFlight) {
    throw new Error('Archive restore already in progress (ARC_ALR_001)');
  }
  archiveRestoreInFlight = true;
  try {
    assertRegisteredStagingName(payload.stagingName);
    const archiveEngine = await createEngine(payload.stagingName, WASM_URL);
    try {
      const validation = await validateArchiveEngine(archiveEngine, {
        recordCountMismatch: 'reject',
      });
      // Re-check the observed total here: validation already enforces the
      // ceilings, but the handler must not trust that step blindly.
      try {
        assertRowTotalWithinCap(validation.recordCount, true);
      } catch (error) {
        await abortRestoreOverCap(payload.stagingName, String((error as Error).message ?? error));
      }

      const restored = { restored: 0, restoredDeleted: 0, skipped: 0, skippedInvalid: 0 };
      const selectColumns = ['id', ...COLUMN_NAMES].join(', ');
      let cursor = 0;
      let seenRows = 0;
      let seenBytes = 0;
      for (;;) {
        const rows = await archiveEngine.query(
          `SELECT ${selectColumns} FROM browsing_logs WHERE id > ? ORDER BY id LIMIT ${RESTORE_BATCH}`,
          [cursor],
        );
        if (rows.length === 0) break;

        // Mid-loop backstop: validation counts can go stale (or be bypassed),
        // so each batch is gated BEFORE any of its rows reach the main DB.
        // A lying archive is stopped here even if it slipped past validation.
        if (seenRows + rows.length > MAX_ARCHIVE_RESTORE_ROWS) {
          await abortRestoreOverCap(
            payload.stagingName,
            `Archive restore aborted: archive exceeds the restore limit of ` +
              `${MAX_ARCHIVE_RESTORE_ROWS} rows ` +
              `— split the archive by date and retry (${ARC_CAP_ROWS})`,
          );
        }
        const batchBytes = estimateBatchBytes(rows);
        if (seenBytes + batchBytes > MAX_ARCHIVE_RESTORE_BYTES) {
          await abortRestoreOverCap(
            payload.stagingName,
            `Archive restore aborted: archive exceeds the restore limit of ` +
              `${MAX_ARCHIVE_RESTORE_BYTES} bytes ` +
              `— split the archive by date and retry (${ARC_CAP_BYTES})`,
          );
        }
        seenRows += rows.length;
        seenBytes += batchBytes;

        await withTransaction(ctx, async () => {
          for (const row of rows) {
            const record = row as unknown as Record<string, SqliteValue> & {
              url: string;
              created_at: number;
            };
            const domain =
              typeof record.domain === 'string' && record.domain !== ''
                ? record.domain
                : extractDomain(String(record.url ?? ''));
            try {
              await sqlExec(ctx, INSERT_IGNORE_SQL, buildInsertParams(record, domain));
              const changed = Number(
                (await ctx.engine.queryValue('SELECT changes() AS c')) ?? 0,
              );
              if (changed > 0) {
                restored.restored++;
                if (Number(row.is_deleted) === 1) restored.restoredDeleted++;
              } else {
                restored.skipped++;
              }
            } catch {
              restored.skippedInvalid++;
            }
          }
        });

        const lastRow = rows[rows.length - 1];
        cursor = Number(lastRow?.id ?? cursor);
        if (rows.length < RESTORE_BATCH) break;
      }

      await releaseStaging(payload.stagingName);
      return restored;
    } finally {
      await archiveEngine.close();
    }
  } finally {
    archiveRestoreInFlight = false;
  }
}
