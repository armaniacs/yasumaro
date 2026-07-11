/**
 * dbMaintenance.ts
 * Retention purging, FTS5 index health monitoring, binary backup/restore,
 * and a lightweight health check.
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 */

import { errorMessage } from '../utils/errorUtils.js';
import { logError, logWarn, ErrorCode } from '../utils/logger.js';
import { engine } from './sqliteEngineContext.js';
import type { SqliteValue } from './sqliteEngineContext.js';

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MAX_RECORDS = 1000;
const FTS_INDEX_WARNING_THRESHOLD = 10_000;

/**
 * Purge old browsing log records based on retention policy.
 * Deletes records older than retentionDays (excluding starred items).
 * If total non-deleted records still exceed maxRecords, deletes oldest non-starred.
 */
export async function purgeOldRecords(
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  maxRecords: number = DEFAULT_MAX_RECORDS
): Promise<{ success: true; purged: number } | { success: false; error: string }> {
  try {
    const opfsResult = await engine.tryOpfsProxy<{ purged: number }>('PURGE', { retentionDays, maxRecords });
    if (opfsResult !== null) return { success: true, purged: opfsResult.purged };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.purgeOldRecords(retentionDays, maxRecords);
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let totalPurged = 0;

    await engine.execWithCache(
      `DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0`,
      [cutoffMs]
    );

    let changes1 = 0;
    await engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
      changes1 = Number(row[0]);
    });
    totalPurged += changes1;

    let totalCount = 0;
    await engine.execWithCache(
      'SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0',
      [],
      (row: SqliteValue[]) => {
        totalCount = Number(row[0]);
      }
    );

    if (totalCount > maxRecords) {
      const excess = totalCount - maxRecords;
      await engine.execWithCache(
        `DELETE FROM browsing_logs WHERE id IN (
          SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0
          ORDER BY created_at ASC LIMIT ?
        )`,
        [excess]
      );

      let changes2 = 0;
      await engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
        changes2 = Number(row[0]);
      });
      totalPurged += changes2;
    }

    return { success: true, purged: totalPurged };
  } catch (error) {
    logError('SQLite: purgeOldRecords failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Purge content (page body) from old records based on retention policy.
 * Sets content = NULL (does NOT delete records).
 * Respects is_starred protection based on includeStarred flag.
 */
export async function purgeContent(
  retentionDays?: number | null,
  maxRecords?: number | null,
  includeStarred?: boolean | null,
): Promise<{ success: true; purged: number } | { success: false; error: string }> {
  try {
    const opfsResult = await engine.tryOpfsProxy<{ purged: number }>('CONTENT_PURGE', {
      retentionDays,
      maxRecords,
      includeStarred,
    });
    if (opfsResult !== null) return { success: true, purged: opfsResult.purged };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return engine.fallbackStorage.purgeContent(
        retentionDays != null ? retentionDays : undefined,
        maxRecords != null ? maxRecords : undefined,
        includeStarred != null ? includeStarred : undefined,
      );
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const starredClause = includeStarred ? '' : 'AND is_starred = 0';
    let totalPurged = 0;

    // 1. Days-based: NULL content on old non-starred entries
    if (retentionDays != null && retentionDays > 0) {
      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      await engine.execWithCache(
        `UPDATE browsing_logs SET content = NULL
         WHERE content IS NOT NULL AND created_at < ? ${starredClause}`,
        [cutoffMs]
      );

      let changes1 = 0;
      await engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
        changes1 = Number(row[0]);
      });
      totalPurged += changes1;
    }

    // 2. Count-based: NULL oldest content when over limit
    if (maxRecords != null && maxRecords > 0) {
      let count = 0;
      await engine.execWithCache(
        `SELECT COUNT(*) FROM browsing_logs WHERE content IS NOT NULL ${starredClause}`,
        [],
        (row: SqliteValue[]) => { count = Number(row[0]); }
      );

      if (count > maxRecords) {
        const excess = count - maxRecords;
        await engine.execWithCache(
          `UPDATE browsing_logs SET content = NULL
           WHERE id IN (
             SELECT id FROM browsing_logs
             WHERE content IS NOT NULL ${starredClause}
             ORDER BY created_at ASC
             LIMIT ?
           )`,
          [excess]
        );

        let changes2 = 0;
        await engine.execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
          changes2 = Number(row[0]);
        });
        totalPurged += changes2;
      }
    }

    return { success: true, purged: totalPurged };
  } catch (error) {
    logError('SQLite: purgeContent failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Get the number of entries in the FTS5 index.
 */
export async function getFtsIndexSize(): Promise<{ success: true; count: number } | { success: false; error: string }> {
  try {
    // OPFS Worker: no FTS in sync build, always return 0
    const opfsResult = await engine.tryOpfsProxy<{ count: number }>('FTS_INDEX_SIZE');
    if (opfsResult !== null) return { success: true, count: opfsResult.count };

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.usingFallbackStorage && engine.fallbackStorage) {
      return { success: true, count: 0 };
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    let count = 0;
    await engine.execWithCache(
      'SELECT COUNT(*) FROM browsing_logs_fts',
      [],
      (row: SqliteValue[]) => {
        count = Number(row[0]);
      }
    );

    return { success: true, count };
  } catch (error) {
    logError('SQLite: getFtsIndexSize failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Check FTS5 index health and log a warning if it exceeds the threshold.
 * Returns the current FTS index size.
 */
export async function checkFtsIndexHealth(): Promise<{ count: number; warning: boolean }> {
  const result = await getFtsIndexSize();
  if (!result.success) {
    return { count: 0, warning: false };
  }

  const warning = result.count > FTS_INDEX_WARNING_THRESHOLD;
  if (warning) {
    logWarn('FTS index is large; consider evaluation', { count: result.count }, undefined, 'sqlite');
  }

  return { count: result.count, warning };
}

/**
 * バイナリ .db バックアップを取得
 * OPFS パスではバイナリ .db を返し、IDB/Fallback パスではエラーを返す
 * (JSON フォールバックは廃止 — コンシューマーに破損 .db を渡すため)
 */
export async function backupDb(): Promise<{ success: true; data: Uint8Array } | { success: false; error: string }> {
  try {
    // OPFS Worker パス: バイナリ .db エクスポート
    const opfsResult = await engine.tryOpfsProxy<Uint8Array>('BACKUP');
    if (opfsResult !== null && opfsResult.length > 0) {
      return { success: true, data: opfsResult };
    }

    // IDB/Fallback パス: バイナリバックアップ非対応
    return { success: false, error: 'Binary backup requires OPFS storage. Use JSON export instead.' };
  } catch (error) {
    logError('SQLite: backupDb failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * バイナリ .db を書き戻して履歴DBを復元する
 * OPFS パスのみサポート。一時ファイル検証は opfsWorker.ts 側で行う。
 */
export async function restoreDb(data: Uint8Array): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const opfsResult = await engine.tryOpfsProxy<{ restored: boolean }>('RESTORE', { data });
    if (opfsResult && opfsResult.restored) {
      return { success: true };
    }
    return { success: false, error: 'Binary restore requires OPFS storage.' };
  } catch (error) {
    logError('SQLite: restoreDb failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Lightweight health check — verifies the SQLite database is reachable.
 * Returns true if a SELECT 1 succeeds on any available backend.
 */
export async function sqliteHealthCheck(): Promise<boolean> {
  if (engine.opfsWorker) {
    try {
      const result = await engine.tryOpfsProxy<{ ok: boolean }>('HEALTH_CHECK');
      if (result !== null) return result.ok;
    } catch {
      return false;
    }
  }
  if (engine.usingFallbackStorage && engine.fallbackStorage) {
    return engine.fallbackStorage.healthCheck();
  }
  if (!engine.dbHandle || !engine.sqlite3) {
    return false;
  }
  try {
    let ok = false;
    await engine.execWithCache('SELECT 1', [], () => { ok = true; });
    return ok;
  } catch {
    return false;
  }
}
