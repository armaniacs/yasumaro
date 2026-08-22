import type { SqliteClient } from '../../sqliteClient.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import { addLog, LogType } from '../../../utils/logger.js';
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
     const insertResult = await params.sqliteClient.mutate({ type: 'insert', record: params.record, traceId: params.traceId } as { type: 'insert'; record: BrowsingLogRecord; traceId?: string });
     if (!insertResult.success) {
       // SQLite unavailable/failing: queue the record instead of losing it (M14).
       await enqueuePendingRecord(params.record);
       throw new Error(`SQLite insert failed for url=${params.record.url}`);
}
if (params.obsidianSynced !== undefined) {
          await params.sqliteClient.mutate({ type: 'update', id: insertResult.data.id, changes: { obsidian_synced: params.obsidianSynced ? 1 : 0 }, traceId: params.traceId } as { type: 'update'; id: number; changes: Partial<Record<string, unknown>>; traceId?: string });
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
