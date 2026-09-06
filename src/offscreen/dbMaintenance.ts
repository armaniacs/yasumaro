/**
 * dbMaintenance.ts
 * Retention purging, FTS5 index health monitoring, binary backup/restore,
 * and a lightweight health check.
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 *
 * All methods delegate to the active StorageBackend returned by engine.getBackend().
 */

import { engine } from './sqliteEngineHost.js';

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MAX_RECORDS = 1000;

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

// ============================================================================
// Archive (PBI 2026-09-06-02) — OPFS path only (staging registry + second
// engine live in the OPFS worker). IDB/Fallback backends reject.
// ============================================================================

export type ArchivePreviewBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archivePreview']>>;
export type ArchiveCreateBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveCreate']>>;
export type ArchiveCleanupBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveCleanup']>>;
export type ArchiveExportBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveExportChunk']>>;

export async function archivePreview(cutoffMs: number, includeDeleted: boolean): Promise<ArchivePreviewBackendResult> {
  const backend = await engine.getBackend();
  return backend.archivePreview(cutoffMs, includeDeleted);
}

export async function archiveCreate(params: { cutoffDate: string; cutoffMs: number; includeDeleted: boolean; yasumaroVersion: string }): Promise<ArchiveCreateBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveCreate(params);
}

export async function archiveCleanup(): Promise<ArchiveCleanupBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveCleanup();
}

export async function archiveExportChunk(stagingName: string, offset: number, length: number): Promise<ArchiveExportBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveExportChunk(stagingName, offset, length);
}

export type ArchivePrepareIncomingBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archivePrepareIncoming']>>;
export type ArchiveRestorePreviewBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveRestorePreview']>>;
export type ArchiveRestoreBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveRestore']>>;

export async function archivePrepareIncoming(): Promise<ArchivePrepareIncomingBackendResult> {
  const backend = await engine.getBackend();
  return backend.archivePrepareIncoming();
}

export async function archiveRestorePreview(stagingName: string): Promise<ArchiveRestorePreviewBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveRestorePreview(stagingName);
}

export async function archiveRestore(stagingName: string): Promise<ArchiveRestoreBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveRestore(stagingName);
}

export type ArchiveDeleteByStagingBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveDeleteByStaging']>>;

export async function archiveDeleteByStaging(stagingName: string): Promise<ArchiveDeleteByStagingBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveDeleteByStaging(stagingName);
}

export type ArchiveOpenBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveOpen']>>;
export type ArchiveQueryBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveQuery']>>;
export type ArchiveUpdateBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveUpdate']>>;
export type ArchiveSaveBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveSave']>>;
export type ArchiveCloseBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveClose']>>;
export type ArchiveStatusBackendResult = Awaited<ReturnType<import('./StorageBackend.js').StorageBackend['archiveStatus']>>;

export async function archiveOpen(stagingName: string): Promise<ArchiveOpenBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveOpen(stagingName);
}

export async function archiveQuery(stagingName: string, query: string, limit: number, offset: number): Promise<ArchiveQueryBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveQuery(stagingName, query, limit, offset);
}

export async function archiveUpdate(stagingName: string, id: number, changes: Record<string, unknown>): Promise<ArchiveUpdateBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveUpdate(stagingName, id, changes);
}

export async function archiveSave(stagingName: string): Promise<ArchiveSaveBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveSave(stagingName);
}

export async function archiveClose(stagingName: string): Promise<ArchiveCloseBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveClose(stagingName);
}

export async function archiveStatus(): Promise<ArchiveStatusBackendResult> {
  const backend = await engine.getBackend();
  return backend.archiveStatus();
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
