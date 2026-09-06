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
        const p = payload as { cutoffMs?: unknown; includeDeleted?: unknown };
        if (typeof p.cutoffMs !== 'number' || !Number.isFinite(p.cutoffMs) || p.cutoffMs <= 0) {
          return { success: false, error: 'archive_preview: cutoffMs must be a positive number' };
        }
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchivePreviewData> =
          await deps.archivePreview(p.cutoffMs, p.includeDeleted === true);
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
        if (typeof p.yasumaroVersion !== 'string' || p.yasumaroVersion.length === 0 || p.yasumaroVersion.length > 64) {
          return { success: false, error: 'archive_create: yasumaroVersion must be 1-64 chars' };
        }
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchiveCreateData> =
          await deps.archiveCreate({
            cutoffDate: p.cutoffDate,
            cutoffMs: p.cutoffMs,
            includeDeleted: p.includeDeleted === true,
            yasumaroVersion: p.yasumaroVersion,
          });
        return result.success
          ? { success: true, stagingName: result.data.stagingName, recordCount: result.data.recordCount }
          : toFailure(result);
      }
      case 'archive_delete_by_staging': {
        const p = payload as { stagingName?: unknown };
        if (typeof p.stagingName !== 'string' || p.stagingName.length === 0) {
          return { success: false, error: 'archive_delete_by_staging: stagingName is required' };
        }
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchivePurgeData> =
          await deps.archiveDeleteByStaging(p.stagingName);
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
        if (typeof p.stagingName !== 'string' || p.stagingName.length === 0) {
          return { success: false, error: 'archive_restore_preview: stagingName is required' };
        }
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchiveRestorePreviewData> =
          await deps.archiveRestorePreview(p.stagingName);
        return result.success
          ? { success: true, preview: result.data }
          : toFailure(result);
      }
      case 'archive_restore': {
        const p = payload as { stagingName?: unknown };
        if (typeof p.stagingName !== 'string' || p.stagingName.length === 0) {
          return { success: false, error: 'archive_restore: stagingName is required' };
        }
        const result: DepsResult<import('../../../messaging/sqliteMessages.js').ArchiveRestoreData> =
          await deps.archiveRestore(p.stagingName);
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
      default: {
        const unknownSubtype = (payload as { subtype?: string }).subtype;
        return { success: false, error: `Unknown archive subtype: ${String(unknownSubtype)}` };
      }
    }
  };
}
