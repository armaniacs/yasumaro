/**
 * archiveHandler.ts
 * Service-Worker-side handler for the archive subtype group (4th partition).
 *
 * The actual work happens in the offscreen document / OPFS worker (staging
 * registry + second engine live there). This handler validates the payload
 * shape, delegates to the client-backed archive deps, and forwards the
 * failure reason (see toFailure).
 */

import type { DashboardSqliteRequest } from '../dashboardSqliteProtocol.js';
import type { ArchiveDeps, DepsResult } from './deps.js';
import { toFailure } from './deps.js';
import { ARCHIVE_SUBTYPES } from './archiveSubtypes.js';

export { ARCHIVE_SUBTYPES };

/** Deps the archive group needs (subset view over the full union). */
export type ArchiveHandlerDeps = ArchiveDeps;

export function createArchiveHandler(deps: ArchiveHandlerDeps) {
  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    switch (payload.subtype) {
      case 'archive_preview': {
        const p = payload as { cutoffDate?: unknown; cutoffMs?: unknown; includeDeleted?: unknown };
        if (typeof p.cutoffDate !== 'string' || p.cutoffDate.length === 0) {
          return { success: false, error: 'archive_preview: cutoffDate is required' };
        }
        if (typeof p.cutoffMs !== 'number' || !Number.isFinite(p.cutoffMs) || p.cutoffMs <= 0) {
          return { success: false, error: 'archive_preview: cutoffMs must be a positive number' };
        }
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchivePreviewData> =
          await deps.archivePreview(p.cutoffDate, p.cutoffMs, p.includeDeleted === true);
        return result.success
          ? { success: true, preview: result.data }
          : toFailure(result);
      }
      case 'archive_create': {
        const p = payload as {
          cutoffDate?: unknown;
          cutoffMs?: unknown;
          includeDeleted?: unknown;
          yasumaroVersion?: unknown;
        };
        if (typeof p.cutoffDate !== 'string' || p.cutoffDate.length === 0) {
          return { success: false, error: 'archive_create: cutoffDate is required' };
        }
        if (typeof p.cutoffMs !== 'number' || !Number.isFinite(p.cutoffMs) || p.cutoffMs <= 0) {
          return { success: false, error: 'archive_create: cutoffMs must be a positive number' };
        }
        // NOTE (PBI 2026-09-07-21): yasumaroVersion shape is enforced by
        // DashboardSqliteValidator (identical message), which always runs
        // first via MessageRouter.dispatch — no handler-side duplicate.
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchiveCreateData> =
          await deps.archiveCreate({
            cutoffDate: p.cutoffDate,
            cutoffMs: p.cutoffMs,
            includeDeleted: p.includeDeleted === true,
            yasumaroVersion: p.yasumaroVersion as string,
          });
        return result.success
          ? { success: true, stagingName: result.data.stagingName, recordCount: result.data.recordCount }
          : toFailure(result);
      }
      case 'archive_export': {
        const p = payload as { stagingName?: unknown; offset?: unknown; length?: unknown };
        // NOTE (PBI 2026-09-07-21): stagingName shape is enforced by
        // DashboardSqliteValidator via MessageRouter.dispatch — the cast below
        // is safe on the validated path; unvalidated direct calls fail closed
        // downstream at assertRegisteredStagingName.
        if (typeof p.offset !== 'number' || !Number.isInteger(p.offset) || p.offset < 0) {
          return { success: false, error: 'archive_export: offset must be a non-negative integer' };
        }
        if (typeof p.length !== 'number' || !Number.isFinite(p.length) || p.length < 1) {
          return { success: false, error: 'archive_export: length must be a positive number' };
        }
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchiveExportData> =
          await deps.archiveExportChunk(p.stagingName as string, p.offset, p.length);
        return result.success
          ? {
              success: true,
              chunk: result.data.chunk,
              nextOffset: result.data.nextOffset,
              total: result.data.total,
              done: result.data.done,
            }
          : toFailure(result);
      }
      case 'archive_delete_by_staging': {
        const p = payload as { stagingName?: unknown };
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchivePurgeData> =
          await deps.archiveDeleteByStaging(p.stagingName as string);
        return result.success
          ? {
              success: true,
              deleted: result.data.deleted,
              remaining: result.data.remaining,
              freelistBefore: result.data.freelistBefore,
              freelistAfter: result.data.freelistAfter,
              vacuumOk: result.data.vacuumOk,
            }
          : toFailure(result);
      }
      case 'archive_cleanup': {
        const result: DepsResult<{ removed: string[] }> = await deps.archiveCleanup();
        return result.success
          ? { success: true, removed: result.data.removed }
          : toFailure(result);
      }
      case 'archive_prepare_incoming': {
        const result: DepsResult<string> = await deps.archivePrepareIncoming();
        return result.success
          ? { success: true, stagingName: result.data }
          : toFailure(result);
      }
      case 'archive_restore_preview': {
        const p = payload as { stagingName?: unknown };
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchiveRestorePreviewData> =
          await deps.archiveRestorePreview(p.stagingName as string);
        return result.success
          ? { success: true, preview: result.data }
          : toFailure(result);
      }
      case 'archive_restore': {
        const p = payload as { stagingName?: unknown };
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchiveRestoreData> =
          await deps.archiveRestore(p.stagingName as string);
        return result.success
          ? {
              success: true,
              restored: result.data.restored,
              restoredDeleted: result.data.restoredDeleted,
              skipped: result.data.skipped,
              skippedInvalid: result.data.skippedInvalid,
            }
          : toFailure(result);
      }
      case 'archive_open': {
        const p = payload as { stagingName?: unknown };
        const result: DepsResult<void> = await deps.archiveOpen(p.stagingName as string);
        return result.success ? { success: true } : toFailure(result);
      }
      case 'archive_query': {
        const p = payload as { stagingName?: unknown; query?: unknown; limit?: unknown; offset?: unknown };
        if (typeof p.query !== 'string') {
          return { success: false, error: 'archive_query: query must be string' };
        }
        if (typeof p.limit !== 'number' || !Number.isInteger(p.limit) || p.limit < 1 || p.limit > 500) {
          return { success: false, error: 'archive_query: limit must be 1..500' };
        }
        if (typeof p.offset !== 'number' || !Number.isInteger(p.offset) || p.offset < 0) {
          return { success: false, error: 'archive_query: offset must be a non-negative integer' };
        }
        const result: DepsResult<{ rows: import('../../../messaging/sqliteMessages.js').ArchiveSessionRow[]; total: number }> =
          await deps.archiveQuery(p.stagingName as string, p.query, p.limit, p.offset);
        return result.success
          ? { success: true, rows: result.data.rows, total: result.data.total }
          : toFailure(result);
      }
      case 'archive_update': {
        const p = payload as { stagingName?: unknown; id?: unknown; changes?: unknown };
        if (typeof p.id !== 'number' || !Number.isInteger(p.id) || p.id <= 0) {
          return { success: false, error: 'archive_update: id must be a positive integer' };
        }
        if (!p.changes || typeof p.changes !== 'object' || Array.isArray(p.changes)) {
          return { success: false, error: 'archive_update: changes must be an object' };
        }
        const result: DepsResult<{ dirty: boolean }> =
          await deps.archiveUpdate(p.stagingName as string, p.id, p.changes as Record<string, unknown>);
        return result.success
          ? { success: true, dirty: result.data.dirty }
          : toFailure(result);
      }
      case 'archive_save': {
        const p = payload as { stagingName?: unknown };
        const result: DepsResult<{ dirty: boolean }> = await deps.archiveSave(p.stagingName as string);
        return result.success
          ? { success: true, dirty: result.data.dirty }
          : toFailure(result);
      }
      case 'archive_close': {
        const p = payload as { stagingName?: unknown };
        const result: DepsResult<{ dirty: boolean }> = await deps.archiveClose(p.stagingName as string);
        return result.success
          ? { success: true, dirty: result.data.dirty }
          : toFailure(result);
      }
      case 'archive_status': {
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchiveSessionStatusData> =
          await deps.archiveStatus();
        return result.success
          ? { success: true, status: result.data }
          : toFailure(result);
      }
      default: {
        const unknownSubtype = (payload as { subtype?: string }).subtype;
        return { success: false, error: `Unknown archive subtype: ${String(unknownSubtype)}` };
      }
    }
  };
}
