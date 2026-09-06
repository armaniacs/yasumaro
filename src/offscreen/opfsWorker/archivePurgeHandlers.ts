/**
 * archivePurgeHandlers.ts
 * OPFS-worker handler for phase B: deleting main-DB rows covered by a
 * verified staging archive (PBI 2026-09-06-04).
 *
 * Safety invariants:
 * - The staging name must be registered AND of kind 'outgoing' (restore-flow
 *   incoming staging must never be purgeable).
 * - The archive file's meta (cutoff / include_deleted / max_id) must match
 *   the values the registry captured at phase A — a swapped file fails
 *   closed and asks for a re-preview.
 * - The DELETE predicate carries `id <= max_id_at_archive`, so rows that
 *   arrived after phase A (restores, JSON imports) survive phase B.
 * - VACUUM runs OUTSIDE the transaction: a VACUUM failure leaves the data
 *   intact (only the freelist stays large) and is reported via vacuumOk.
 * - Single-flight (module-level flag).
 * - Quota preflight: VACUUM rewrites the DB, so available space must exceed
 *   the current usage before the DELETE is allowed.
 */

import type { HandlerContext } from './handlers.js';
import { sqlExec, withTransaction } from './handlers.js';
import { createEngine, type SqliteEngine, type SqliteValue } from '../sqliteEngine.js';
import { validateArchiveEngine } from './archiveValidation.js';
import {
  getStagingRecord,
  releaseStaging,
  assertRegisteredStagingName,
} from './archiveStaging.js';
const WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href;

type LogFn = (level: 'warn' | 'error' | 'info', message: string, details?: Record<string, unknown>) => void;

let archivePurgeInFlight = false;

export interface ArchivePurgeOutcome {
  deleted: number;
  remaining: number;
  freelistBefore: number;
  freelistAfter: number;
  vacuumOk: boolean;
}

async function freelistCount(engine: SqliteEngine): Promise<number> {
  const value = await engine.queryValue('PRAGMA freelist_count');
  return Number(value ?? 0);
}

async function countMainRows(engine: SqliteEngine): Promise<number> {
  const value = await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs');
  return Number(value ?? 0);
}

async function hasAvailableQuotaForVacuum(): Promise<boolean> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (
      !estimate ||
      typeof estimate.quota !== 'number' ||
      typeof estimate.usage !== 'number'
    ) {
      return true; // cannot measure — do not block
    }
    // VACUUM roughly doubles the DB footprint while rewriting it.
    return estimate.quota - estimate.usage >= estimate.usage;
  } catch {
    return true;
  }
}

export async function handleArchiveDeleteByStaging(
  ctx: HandlerContext,
  payload: { stagingName: string },
  log: LogFn,
): Promise<ArchivePurgeOutcome> {
  if (archivePurgeInFlight) {
    throw new Error('Archive purge already in progress (ARC_ALR_001)');
  }
  archivePurgeInFlight = true;
  try {
    // 1. The staging name must be a registered OUTGOING archive.
    assertRegisteredStagingName(payload.stagingName);
    const record = getStagingRecord(payload.stagingName);
    if (!record || record.kind !== 'outgoing') {
      throw new Error(
        `Refusing to purge: staging is not an outgoing archive (kind=${record?.kind ?? 'unknown'})`,
      );
    }
    if (
      record.cutoffMs === undefined ||
      record.includeDeleted === undefined ||
      record.maxIdAtArchive === undefined
    ) {
      throw new Error(
        'Staging has no captured phase-A scope — re-preview required (ARC_EXP_001)',
      );
    }

    // 2. Quota preflight (VACUUM rewrites the DB) — before any DELETE.
    if (!(await hasAvailableQuotaForVacuum())) {
      throw new Error(
        'Archive purge failed: insufficient storage quota for VACUUM — free space or split by date (ARC_QUOTA_001)',
      );
    }

    // 3. Read the archive file's meta and cross-check against the registry.
    const archiveEngine = await createEngine(payload.stagingName, WASM_URL);
    let meta: {
      cutoffMs: number;
      includeDeleted: boolean;
      maxIdAtArchive: number;
      recordCount: number;
    };
    try {
      const validation = await validateArchiveEngine(archiveEngine, {
        recordCountMismatch: 'reject',
      });
      const m = validation.meta;
      if (!m) {
        throw new Error('Archive validation failed: meta unavailable');
      }
      if (
        m.cutoffCreatedAt !== record.cutoffMs ||
        (m.includeDeleted === 1) !== record.includeDeleted ||
        m.maxIdAtArchive !== record.maxIdAtArchive
      ) {
        throw new Error(
          `Staging meta does not match the registry — re-preview required (ARC_EXP_001): ` +
            `file(cutoff=${m.cutoffCreatedAt}, includeDeleted=${m.includeDeleted}, maxId=${m.maxIdAtArchive}) ` +
            `registry(cutoff=${record.cutoffMs}, includeDeleted=${record.includeDeleted}, maxId=${record.maxIdAtArchive})`,
        );
      }
      meta = {
        cutoffMs: m.cutoffCreatedAt,
        includeDeleted: m.includeDeleted === 1,
        maxIdAtArchive: m.maxIdAtArchive,
        recordCount: validation.recordCount,
      };
    } finally {
      await archiveEngine.close();
    }

    // 4. Quota re-check with the meta-known scope (defensive double-check).
    if (!(await hasAvailableQuotaForVacuum())) {
      throw new Error(
        'Archive purge failed: insufficient storage quota for VACUUM (ARC_QUOTA_001)',
      );
    }

    // 5. DELETE inside an IMMEDIATE transaction; VACUUM outside it.
    const freelistBefore = await freelistCount(ctx.engine);
    const predicate = 'created_at <= ?' + (meta.includeDeleted ? '' : ' AND is_deleted = 0') + ' AND id <= ?';
    const params: SqliteValue[] = [meta.cutoffMs, meta.maxIdAtArchive];
    let deleted = 0;
    await withTransaction(ctx, async () => {
      await sqlExec(
        ctx,
        `DELETE FROM browsing_logs WHERE ${predicate}`,
        params,
      );
      const changed = Number((await ctx.engine.queryValue('SELECT changes() AS c')) ?? 0);
      deleted = changed;
    });
    let vacuumOk = true;
    try {
      await sqlExec(ctx, 'VACUUM');
    } catch (err) {
      // Data is intact (DELETE already committed); only the freelist stays.
      vacuumOk = false;
      log('warn', 'Archive purge: VACUUM failed — freelist not reclaimed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const freelistAfter = await freelistCount(ctx.engine);
    const remaining = await countMainRows(ctx.engine);

    // 6. The staging archive has served its purpose: download happened in
    // phase A and the user explicitly confirmed deletion — release it.
    await releaseStaging(payload.stagingName);

    log('info', 'Archive purge completed', {
      deleted,
      remaining,
      freelistBefore,
      freelistAfter,
      vacuumOk,
      cutoffMs: meta.cutoffMs,
      includeDeleted: meta.includeDeleted,
      maxIdAtArchive: meta.maxIdAtArchive,
    });

    return { deleted, remaining, freelistBefore, freelistAfter, vacuumOk };
  } catch (error) {
    log('error', 'Archive purge failed', {
      error: error instanceof Error ? error.message : String(error),
      stagingName: payload.stagingName,
    });
    throw error;
  } finally {
    archivePurgeInFlight = false;
  }
}
