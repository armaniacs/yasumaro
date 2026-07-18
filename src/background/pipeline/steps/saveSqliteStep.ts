import type { SqliteClient } from '../../sqliteClient.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { enqueuePendingRecord } from '../../pendingSqliteQueue.js';

export interface SaveSqliteStepParams {
  recordId: string | number;
  record: BrowsingLogRecord;
  sqliteClient: SqliteClient;
  obsidianSynced?: boolean;
}

export async function saveSqliteStep(params: SaveSqliteStepParams): Promise<void> {
  try {
    const insertResult = await params.sqliteClient.insert(params.record);
    if (!insertResult) {
      // SQLite unavailable/failing: queue the record instead of losing it (M14).
      await enqueuePendingRecord(params.record);
      throw new Error(`SQLite insert returned null for url=${params.record.url}`);
    }
    if (params.obsidianSynced !== undefined) {
      await params.sqliteClient.update(insertResult.id, {
        obsidian_synced: params.obsidianSynced ? 1 : 0,
      });
    }
  } catch (err) {
    addLog(LogType.ERROR, 'saveSqliteStep: failed', {
      url: params.record.url,
      error: String(err),
    });
    throw err;
  }
}
