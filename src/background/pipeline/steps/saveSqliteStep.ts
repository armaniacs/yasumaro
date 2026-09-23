import type { SqliteClient } from '../../sqlite/offscreenGateway.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { enqueuePendingRecord } from '../../pendingSqliteQueue.js';
import { buildRegenerateUpdateFields, type RegenerateUpdateFieldKey } from '../mappers/regenerateUpdateFields.js';

/**
 * Regenerate UPDATE failure. Typed so decideStepOutcome can route it to a
 * terminal error WITHOUT pending-recovery registration (the pending queue
 * replays MANUAL records as INSERTs — recovering this failure that way would
 * duplicate the very row the update was replacing). Message text is part of
 * the test contract.
 */
export class RegenerateUpdateError extends Error {}

export interface SaveSqliteStepParams {
  recordId: string | number;
  record: BrowsingLogRecord;
  sqliteClient: SqliteClient;
  obsidianSynced?: boolean;
  traceId?: string;
  /** PBI 04: when set, UPDATE this row instead of inserting (regenerate). */
  targetEntryId?: number;
  /**
   * PBI 2026-09-22-04 follow-up: mirrors context.privacyResult.aiSucceeded.
   * When false, the AI produced only an error string — skip the UPDATE so a
   * failed regeneration never overwrites a good row. The handler surfaces
   * the failure separately ('ai_failed'); this gate protects the write.
   */
  aiSucceeded?: boolean;
  /**
   * Mirrors toBrowsingLogRecord's gate: when content storage is disabled the
   * UPDATE must OMIT the content key (undefined = untouched) instead of
   * writing null — null would wipe content stored while the setting was ON.
   */
  contentEnabled?: boolean;
}

export async function saveSqliteStep(params: SaveSqliteStepParams): Promise<void> {
   // PBI 04: UPDATE-in-place for REGENERATE_SUMMARY. Failures never enqueue
   // the pending-record retry (that queue replays INSERTs — a retried insert
   // would duplicate the row the update was replacing).
   if (params.targetEntryId !== undefined) {
     if (params.aiSucceeded === false) {
       // The AI call failed (its error text sits in the mapped summary).
       // Leave the existing row untouched — the caller reports the failure.
       addLog(LogType.INFO, 'saveSqliteStep: skipping regenerate UPDATE (AI failed)', {
         id: params.targetEntryId,
         url: params.record.url,
         traceId: params.traceId,
       });
       return;
     }
     try {
       const changes: Partial<Record<RegenerateUpdateFieldKey, unknown>> = buildRegenerateUpdateFields(params.record);
       if (params.contentEnabled === false) {
         delete changes.content;
       }
       const updateResult = await params.sqliteClient.mutate({
         type: 'update',
         id: params.targetEntryId,
         changes,
         traceId: params.traceId,
       } as { type: 'update'; id: number; changes: Partial<Record<string, unknown>>; traceId?: string });
       if (!updateResult.success) {
         throw new RegenerateUpdateError(`SQLite regenerate update failed for id=${params.targetEntryId}`);
       }
       addLog(LogType.INFO, 'saveSqliteStep: regenerated row updated', {
         id: params.targetEntryId,
         url: params.record.url,
         traceId: params.traceId,
       });
     } catch (err) {
       addLog(LogType.ERROR, 'saveSqliteStep: regenerate update failed', {
         id: params.targetEntryId,
         url: params.record.url,
         error: String(err),
         traceId: params.traceId,
       });
       throw err;
     }
     return;
   }
   try {
     const mutateResult = await params.sqliteClient.mutate({ type: 'insert', record: params.record, traceId: params.traceId } as { type: 'insert'; record: BrowsingLogRecord; traceId?: string });
      if (!mutateResult.success) {
        // SQLite unavailable/failing: queue the record instead of losing it (M14).
        const queued = await enqueuePendingRecord(params.record);
        if (!queued) {
          // Double failure: the insert failed and even the fallback queue
          // could not persist the record. Report it instead of pretending
          // the record survived.
          addLog(LogType.ERROR, 'saveSqliteStep: failed to queue record for retry', {
            url: params.record.url,
            traceId: params.traceId,
          });
        }
        throw new Error(`SQLite insert failed for url=${params.record.url}`);
}
if (params.obsidianSynced !== undefined) {
          await params.sqliteClient.mutate({ type: 'update', id: mutateResult.data.id, changes: { obsidian_synced: params.obsidianSynced ? 1 : 0 }, traceId: params.traceId } as { type: 'update'; id: number; changes: Partial<Record<string, unknown>>; traceId?: string });
        }
    } catch (err) {
     addLog(LogType.ERROR, 'saveSqliteStep: failed', {
       url: params.record.url,
       error: String(err),
       traceId: params.traceId,
     });
    throw err;
  }
}
