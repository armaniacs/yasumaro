import type { SqliteClient } from '../../sqlite/offscreenGateway.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { enqueuePendingRecord } from '../../pendingSqliteQueue.js';

export interface SaveSqliteStepParams {
  recordId: string | number;
  record: BrowsingLogRecord;
  sqliteClient: SqliteClient;
  obsidianSynced?: boolean;
  traceId?: string;
}

export async function saveSqliteStep(params: SaveSqliteStepParams): Promise<void> {
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
