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

/** @deprecated Use direct module imports instead (see file header). */
export { engine as sqliteEngine } from './sqliteEngineContext.js';

/** @deprecated Use engine.init() from sqliteEngineContext.js directly. */
export async function init(): Promise<boolean> {
  return engine.init();
}

/** @deprecated Use direct module imports instead (see file header). */
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

/** @deprecated Use direct module imports instead (see file header). */
export {
  purgeOldRecords,
  purgeContent,
  getFtsIndexSize,
  checkFtsIndexHealth,
  backupDb,
  restoreDb,
  sqliteHealthCheck,
} from './dbMaintenance.js';

/** @deprecated Use direct module imports instead (see file header). */
export {
  insertAuditLog,
  queryAuditLog,
} from './auditLogRepo.js';

/** @deprecated Use direct module imports instead (see file header). */
/** @deprecated Use direct module imports instead (see file header). */
export { NoopBackend } from './StorageBackend.js';
/** @deprecated Use direct module imports instead (see file header). */
export type { StorageBackend, StatusResult } from './StorageBackend.js';
/** @deprecated Use direct module imports instead (see file header). */
export { OpfsWorkerBackend } from './OpfsWorkerBackend.js';
/** @deprecated Use direct module imports instead (see file header). */
export { IdbVfsBackend } from './IdbVfsBackend.js';
/** @deprecated Use direct module imports instead (see file header). */
export { FallbackStorageAdapter } from './FallbackStorageAdapter.js';

/** @deprecated Use engine.resetForTesting() from sqliteEngineContext.js directly. */
export function _resetForTesting(): void {
  engine.resetForTesting();
}
