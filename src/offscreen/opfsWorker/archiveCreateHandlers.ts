/**
 * archiveCreateHandlers.ts
 * OPFS-worker handlers for archive preview / create / cleanup / chunked
 * export (PBI 2026-09-06-02).
 *
 * Safety invariants:
 * - Phase A never mutates the main DB (SELECT + wal_checkpoint only).
 * - The staging file is created, filled, validated, and only then handed to
 *   the caller; any failure releases the staging (registry + OPFS file).
 * - `max_id_at_archive` is recorded so phase B (04) can protect rows that
 *   arrive after phase A.
 * - Creation is single-flight (module-level flag) — double execution is
 *   blocked at the worker, independent of any UI state.
 */

import type { HandlerContext } from './handlers.js';
import type {
  ArchivePreviewPayload,
  ArchiveCreatePayload,
  ArchiveExportPayload,
} from './types.js';
import { createEngine, type SqliteEngine, type SqliteValue } from '../sqliteEngine.js';
import {
  SCHEMA_SQL,
  ARCHIVE_META_SCHEMA_SQL,
  ARCHIVE_INSERT_SQL,
  ARCHIVE_INSERT_COLUMN_NAMES,
  buildArchiveInsertParams,
  type InsertableRecord,
} from '../schema.js';
import { validateArchiveEngine } from './archiveValidation.js';
import {
  prepareOutgoing,
  releaseStaging,
  assertRegisteredStagingName,
  sweepOrphanStagings,
} from './archiveStaging.js';
import {
  cutoffMsFromLocalDate,
  MAX_ARCHIVE_FILE_BYTES,
  ARCHIVE_FORMAT_VERSION,
} from '../../utils/archiveGuards.js';

const WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href;
const ARCHIVE_INSERT_BATCH = 5000;

let archiveCreateInFlight = false;

/** Re-derive the cutoff on the worker side: a fabricated cutoffMs pair from
 * the client is rejected here even if it passed message validation. */
function resolveCutoffMs(payload: { cutoffDate: string; cutoffMs: number }): number {
  const derived = cutoffMsFromLocalDate(payload.cutoffDate);
  if (payload.cutoffMs !== derived) {
    throw new Error(
      `Archive validation failed: cutoffMs (${payload.cutoffMs}) does not match cutoffDate (${payload.cutoffDate})`,
    );
  }
  return derived;
}

async function countRows(
  engine: SqliteEngine,
  sql: string,
  params: SqliteValue[],
): Promise<number> {
  const value = await engine.queryValue(sql, params);
  return Number(value ?? 0);
}

export async function handleArchivePreview(
  ctx: HandlerContext,
  payload: ArchivePreviewPayload,
): Promise<{
  total: number;
  starred: number;
  deleted: number;
  oldest: number | null;
  newest: number | null;
  includeDeleted: boolean;
}> {
  const includeDeleted = payload.includeDeleted === true;
  const cutoffMs = resolveCutoffMs(payload);
  const scope = `created_at <= ?${includeDeleted ? '' : ' AND is_deleted = 0'}`;
  const params: SqliteValue[] = [cutoffMs];

  const total = await countRows(
    ctx.engine,
    `SELECT COUNT(*) AS c FROM browsing_logs WHERE ${scope}`,
    params,
  );
  const starred = await countRows(
    ctx.engine,
    `SELECT COUNT(*) AS c FROM browsing_logs WHERE ${scope} AND is_starred = 1`,
    params,
  );
  const deleted = await countRows(
    ctx.engine,
    'SELECT COUNT(*) AS c FROM browsing_logs WHERE created_at <= ? AND is_deleted = 1',
    params,
  );
  const oldestValue = await ctx.engine.queryValue(
    `SELECT MIN(created_at) AS m FROM browsing_logs WHERE ${scope}`,
    params,
  );
  const newestValue = await ctx.engine.queryValue(
    `SELECT MAX(created_at) AS m FROM browsing_logs WHERE ${scope}`,
    params,
  );

  return {
    total,
    starred,
    deleted,
    oldest: typeof oldestValue === 'number' ? oldestValue : null,
    newest: typeof newestValue === 'number' ? newestValue : null,
    includeDeleted,
  };
}

export async function handleArchiveCreate(
  ctx: HandlerContext,
  payload: ArchiveCreatePayload,
): Promise<{ stagingName: string; recordCount: number }> {
  if (archiveCreateInFlight) {
    throw new Error('Archive create already in progress (ARC_ALR_001)');
  }
  archiveCreateInFlight = true;
  let stagingName: string | null = null;
  let archiveEngine: SqliteEngine | null = null;
  try {
    const includeDeleted = payload.includeDeleted === true;
    const cutoffMs = resolveCutoffMs(payload);

    // Quota preflight: the staging file can be up to the size cap.
    const estimate = await navigator.storage?.estimate?.();
    if (
      estimate &&
      typeof estimate.quota === 'number' &&
      typeof estimate.usage === 'number' &&
      estimate.quota - estimate.usage < MAX_ARCHIVE_FILE_BYTES
    ) {
      throw new Error(
        'Archive create failed: insufficient storage quota — free space or split by date (ARC_QUOTA_001)',
      );
    }

    // Record the main DB high-water id so phase B can protect rows that
    // arrive between phase A and phase B (restores, JSON imports).
    const maxIdRows = await ctx.engine.query(
      'SELECT COALESCE(MAX(id), 0) AS m FROM browsing_logs',
    );
    const maxIdAtArchive = Number(maxIdRows[0]?.m ?? 0);
    // Flush the WAL so the SELECTs below (and phase B's checkpoint) see a
    // consistent snapshot.
    await ctx.engine.exec('PRAGMA wal_checkpoint(TRUNCATE)');

    stagingName = await prepareOutgoing();
    archiveEngine = await createEngine(stagingName, WASM_URL);

    // Archive schema: browsing_logs + indexes, NO FTS5, NO triggers, no audit_log.
    await archiveEngine.exec(SCHEMA_SQL);
    await archiveEngine.exec(ARCHIVE_META_SCHEMA_SQL);

    const scope = `created_at <= ?${includeDeleted ? '' : ' AND is_deleted = 0'}`;
    let inserted = 0;
    let cursor = 0;
    for (;;) {
      const rows = await ctx.engine.query(
        `SELECT ${ARCHIVE_INSERT_COLUMN_NAMES.join(', ')} FROM browsing_logs ` +
          `WHERE ${scope} AND id > ? ORDER BY id LIMIT ${ARCHIVE_INSERT_BATCH}`,
        [cutoffMs, cursor],
      );
      if (rows.length === 0) break;
      await archiveEngine.exec('BEGIN');
      for (const row of rows) {
        const record = row as unknown as InsertableRecord & { id: number };
        const domain = typeof row.domain === 'string' ? row.domain : null;
        await archiveEngine.exec(
          ARCHIVE_INSERT_SQL,
          buildArchiveInsertParams(record, domain),
        );
      }
      await archiveEngine.exec('COMMIT');
      inserted += rows.length;
      const lastRow = rows[rows.length - 1];
      cursor = Number(lastRow?.id ?? cursor);
      if (rows.length < ARCHIVE_INSERT_BATCH) break;
    }

    await archiveEngine.exec(
      `INSERT INTO yasumaro_archive_meta ` +
        `(archived_at, cutoff_created_at, cutoff_date, record_count, include_deleted, max_id_at_archive, archive_format_version, yasumaro_version) ` +
        `VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Date.now(),
        cutoffMs,
        payload.cutoffDate,
        inserted,
        includeDeleted ? 1 : 0,
        maxIdAtArchive,
        ARCHIVE_FORMAT_VERSION,
        payload.yasumaroVersion,
      ],
    );

    // Structural validation before handing the file over. On failure this
    // closes the engine; we then release the staging (registry + OPFS file)
    // so no half-built archive is ever downloadable.
    await validateArchiveEngine(archiveEngine, { recordCountMismatch: 'reject' });
    await archiveEngine.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    await archiveEngine.close();
    archiveEngine = null;

    return { stagingName, recordCount: inserted };
  } catch (error) {
    if (archiveEngine) {
      try {
        await archiveEngine.close();
      } catch {
        // close failure must not mask the original error
      }
    }
    if (stagingName) {
      await releaseStaging(stagingName).catch(() => {});
    }
    throw error;
  } finally {
    archiveCreateInFlight = false;
  }
}

export async function handleArchiveCleanup(
  _ctx: HandlerContext,
): Promise<{ removed: string[] }> {
  const removed = await sweepOrphanStagings();
  return { removed };
}

/**
 * Chunked export of a registered staging file. Reads are idempotent, so a
 * transport retry on a chunk is safe (unlike create/delete).
 */
export async function handleArchiveExport(
  _ctx: HandlerContext,
  payload: ArchiveExportPayload,
): Promise<{ chunk: number[]; nextOffset: number; total: number; done: boolean }> {
  assertRegisteredStagingName(payload.stagingName);
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(payload.stagingName);
  const file = await handle.getFile();
  const offset = Math.max(0, Math.floor(payload.offset));
  const end = Math.min(offset + Math.max(1, Math.floor(payload.length)), file.size);
  const slice = await file.slice(offset, end).arrayBuffer();
  return {
    chunk: Array.from(new Uint8Array(slice)),
    nextOffset: end,
    total: file.size,
    done: end >= file.size,
  };
}
