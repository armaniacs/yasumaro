/**
 * dbMaintenance.ts
 * Retention purging, FTS5 index health monitoring, binary backup/restore,
 * and a lightweight health check.
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 *
 * All methods delegate to the active StorageBackend returned by engine.getBackend().
 */

import { logWarn } from '../utils/logger.js';
import { engine } from './sqliteEngineContext.js';

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
  const backend = await engine.getBackend();
  return backend.purgeOldRecords(retentionDays, maxRecords);
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
  const backend = await engine.getBackend();
  return backend.purgeContent(retentionDays ?? undefined, maxRecords ?? undefined, includeStarred ?? undefined);
}

/**
 * Get the number of entries in the FTS5 index.
 */
export async function getFtsIndexSize(): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.getFtsIndexSize();
}

/**
 * Check FTS5 index health and log a warning if it exceeds the threshold.
 * Returns the current FTS index size.
 */
export async function checkFtsIndexHealth(): Promise<{ count: number; warning: boolean }> {
  const backend = await engine.getBackend();
  const result = await backend.getFtsIndexSize();
  if (!result.success) return { count: 0, warning: false };
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
  const backend = await engine.getBackend();
  return backend.backupDb();
}

/**
 * バイナリ .db を書き戻して履歴DBを復元する
 * OPFS パスのみサポート。一時ファイル検証は opfsWorker.ts 側で行う。
 */
export async function restoreDb(data: Uint8Array): Promise<{ success: true } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.restoreDb(data);
}

/**
 * Lightweight health check — verifies the SQLite database is reachable.
 * Returns true if a SELECT 1 succeeds on any available backend.
 */
export async function sqliteHealthCheck(): Promise<boolean> {
  const backend = await engine.getBackend();
  const result = await backend.healthCheck();
  return result.success;
}
