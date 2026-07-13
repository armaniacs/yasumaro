/**
 * sqlite.ts
 * SQLite (wa-sqlite + OPFS) operations for the offscreen document.
 * Provides CRUD operations and FTS5 full-text search for browsing logs.
 *
 * 【リファクタリング履歴】
 * 単一ファイル（1594行、22 export）を4つの深いモジュールへ分割:
 * - sqliteEngineContext.ts - 共有エンジン状態（dbHandle, opfsWorker, 等）
 *                            + init/execWithCache/ensureBackend 等の共通基盤
 * - recordsRepo.ts         - browsing_logs レコードCRUD・FTS5検索・JSON export
 * - dbMaintenance.ts       - 保持期間パージ・FTS索引監視・バイナリbackup/restore・healthCheck
 * - auditLogRepo.ts        - audit_log（AIプロバイダ送信イベント記録）テーブル操作
 *
 * このファイルは後方互換のための再エクスポート層。新規コードは上記の
 * 各モジュールから直接importすることを推奨する。
 */

import { engine } from './sqliteEngineContext.js';

export { engine as sqliteEngine } from './sqliteEngineContext.js';

export async function init(): Promise<boolean> {
  return engine.init();
}

export {
  insert,
  insertBatch,
  query,
  search,
  update,
  hardDelete,
  toggleStar,
  getCount,
  getStatus,
  clearAll,
  serialize,
} from './recordsRepo.js';

export {
  purgeOldRecords,
  purgeContent,
  getFtsIndexSize,
  checkFtsIndexHealth,
  backupDb,
  restoreDb,
  sqliteHealthCheck,
} from './dbMaintenance.js';

export {
  insertAuditLog,
  queryAuditLog,
} from './auditLogRepo.js';

export { NoopBackend } from './StorageBackend.js';
export type { StorageBackend, StatusResult } from './StorageBackend.js';
export { OpfsWorkerBackend } from './OpfsWorkerBackend.js';
export { IdbVfsBackend } from './IdbVfsBackend.js';
export { FallbackStorageAdapter } from './FallbackStorageAdapter.js';

/** Reset the module state for testing. */
export function _resetForTesting(): void {
  engine.resetForTesting();
}
