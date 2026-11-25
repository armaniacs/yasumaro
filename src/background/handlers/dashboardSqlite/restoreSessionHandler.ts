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
        if (!result.success) return toFailure(result);
        return { success: true, stagingName: result.data };
      case 'restore_chunk':
        result = await deps.restoreAppendChunk(payload.stagingName, payload.offset, payload.data);
        if (!result.success) return toFailure(result);
        return { success: true, written: result.data };
      case 'restore_commit':
        result = await deps.restoreCommit(payload.stagingName, payload.totalBytes);
        if (!result.success) return toFailure(result);
        return { success: true };
      case 'restore_abort':
        result = await deps.restoreAbort(payload.stagingName);
        if (!result.success) return toFailure(result);
        return { success: true };
      default:
        return { success: false, error: `Unknown subtype: ${String((payload as { subtype?: unknown }).subtype)}` };
    }
  };
}
