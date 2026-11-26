/**
 * restoreSessionHandler.ts
 * Service-Worker-side handler for the chunked restore session subtypes
 * (restore_begin / restore_chunk / restore_commit / restore_abort).
 *
 * The actual work happens in the offscreen document / OPFS worker, where the
 * restore staging registry and the live DB file live. This handler validates
 * the payload shape (single interpreter via evaluateSubtypeSpec, so a direct
 * call without the envelope gate still rejects), delegates to the client-
 * backed restore deps, and forwards the failure reason.
 *
 * Statelessness pin: the staging name travels with every request — nothing
 * session-shaped is held in this module, so an MV3 service worker restart
 * mid-session degrades to per-request failures instead of losing a hidden
 * cursor.
 */

import type { DashboardSqliteRequest } from '../../../messaging/dashboardSqliteProtocol.js';
import type { DepsResult, RestoreSessionDeps } from './deps.js';
import { toFailure } from './deps.js';
import { evaluateSubtypeSpec } from '../../../messaging/validators.js';
import { logInfo, logWarn } from '../../../utils/logger/api.js';

/** Subtypes this handler owns. The router partitions on this set. */
export const RESTORE_SESSION_SUBTYPES = new Set<DashboardSqliteRequest['subtype']>([
  'restore_begin',
  'restore_chunk',
  'restore_commit',
  'restore_abort',
]);

/** Deps the restore session group needs (subset view over the full union). */
export type RestoreSessionHandlerDeps = RestoreSessionDeps;

export function createRestoreSessionHandler(deps: RestoreSessionHandlerDeps) {
  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    const raw = payload as unknown as Record<string, unknown>;
    // The spec table is the only validation truth (same discipline as the
    // archive handler entry): a direct call without the envelope gate still
    // rejects before deps.
    const invalid = evaluateSubtypeSpec(payload.subtype, raw);
    if (invalid !== null) {
      return { success: false, error: invalid };
    }

    let result: DepsResult<unknown>;
    switch (payload.subtype) {
      case 'restore_begin':
        result = await deps.restoreBegin(payload.totalBytes, payload.totalChunks);
        if (!result.success) {
          // Best-effort diagnostics for a multi-minute transfer: which session
          // failed at which stage must stay reconstructible from the log
          // alone (the staging name is a worker-issued UUID, safe to log).
          void logWarn('restoreSession: restore_begin failed', {
            totalBytes: payload.totalBytes,
            totalChunks: payload.totalChunks,
            error: result.error,
          });
          return toFailure(result);
        }
        void logInfo('restoreSession: restore_begin accepted', {
          stagingName: result.data,
          totalBytes: payload.totalBytes,
          totalChunks: payload.totalChunks,
        });
        return { success: true, stagingName: result.data };
      case 'restore_chunk':
        result = await deps.restoreAppendChunk(payload.stagingName, payload.offset, payload.data);
        if (!result.success) {
          void logWarn('restoreSession: restore_chunk failed', {
            stagingName: payload.stagingName,
            offset: payload.offset,
            error: result.error,
          });
          return toFailure(result);
        }
        return { success: true, written: result.data };
      case 'restore_commit':
        result = await deps.restoreCommit(payload.stagingName, payload.totalBytes);
        if (!result.success) {
          void logWarn('restoreSession: restore_commit rejected', {
            stagingName: payload.stagingName,
            totalBytes: payload.totalBytes,
            error: result.error,
          });
          return toFailure(result);
        }
        void logInfo('restoreSession: restore_commit applied', {
          stagingName: payload.stagingName,
          totalBytes: payload.totalBytes,
        });
        return { success: true };
      case 'restore_abort':
        result = await deps.restoreAbort(payload.stagingName);
        if (!result.success) {
          void logWarn('restoreSession: restore_abort failed', {
            stagingName: payload.stagingName,
            error: result.error,
          });
          return toFailure(result);
        }
        void logInfo('restoreSession: restore_abort done', { stagingName: payload.stagingName });
        return { success: true };
      default:
        return { success: false, error: `Unknown subtype: ${String((payload as { subtype?: unknown }).subtype)}` };
    }
  };
}
