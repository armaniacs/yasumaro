import { withOptimisticLock } from '../../../utils/optimisticLock.js';
import type { SqliteClient } from '../../sqliteClient.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import { addLog, LogType } from '../../../utils/logger.js';

export interface SaveSqliteStepParams {
  recordId: string | number;
  record: BrowsingLogRecord;
  sqliteClient: SqliteClient;
  obsidianSynced?: boolean;
}

export async function saveSqliteStep(params: SaveSqliteStepParams): Promise<void> {
  const lockKey = `sqlite-write-${params.record.url}-${params.record.created_at}`;

  try {
    await withOptimisticLock<number>(
      lockKey,
      (currentValue) => (currentValue || 0) + 1,
      { maxRetries: 3, initialDelay: 100 }
    );

    const insertResult = await params.sqliteClient.insert(params.record);
    if (!insertResult) {
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
