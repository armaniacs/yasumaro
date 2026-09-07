// src/offscreen/OpfsWorkerBackend.ts
import type { SqliteEngineHost } from './sqliteEngineHost.js';
import type { StorageBackend, InsertResult, InsertBatchResult, QuerySearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult, BackupResult, CountResult, HealthResult, AuditLogQueryResult, StatusResult, BackendOrError, ArchivePreviewResult, ArchiveCreateResult, ArchiveCleanupResult, ArchiveExportChunkResult, ArchiveCreateParams, ArchivePrepareIncomingResult, ArchiveRestorePreviewResult, ArchiveRestoreResult, ArchiveDeleteByStagingResult, ArchiveOpenResult, ArchiveQueryResult, ArchiveUpdateResult, ArchiveSaveResult, ArchiveCloseResult, ArchiveStatusResult } from './StorageBackend.js';
import type { ArchivePreviewData, ArchiveCreateData, ArchiveExportData, ArchiveRestorePreviewData, ArchiveRestoreData, ArchiveSessionRow, ArchiveSessionStatusData } from '../messaging/sqliteMessages.js';
import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';

export class OpfsWorkerBackend implements StorageBackend {
  constructor(private engine: SqliteEngineHost) {}

  /**
   * Single construction point for `{ success: true, ...data }` over the
   * worker proxy. The projection returns data fields only (never a `success`
   * flag), so a bare proxy result cannot be double-wrapped here — the shape
   * is enforced by construction instead of per-method comments.
   */
  private async proxyArchive<W, D extends object>(
    workerType: string,
    payload: unknown,
    project: (raw: W) => D,
  ): Promise<BackendOrError<{ success: true } & D>> {
    const result = await this.engine.tryOpfsProxy<W>(workerType, payload);
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, ...project(result) };
  }

  async insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>> {
    const result = await this.engine.sendToOpfsWorker('INSERT', record) as { id: number };
    return { success: true, id: result.id };
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>> {
    const result = await this.engine.sendToOpfsWorker('INSERT_BATCH', records) as { inserted: number; skipped: number };
    return { success: true, inserted: result.inserted, skipped: result.skipped };
  }

  async query(q: StorageQuery): Promise<BackendOrError<QuerySearchResult>> {
    const result = await this.engine.tryOpfsProxy<{ rows: (BrowsingLogEntry & { rank: number })[]; total: number }>('QUERY', q);
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, rows: result.rows as (BrowsingLogEntry & { rank: number })[], total: result.total };
  }

  async update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>> {
    await this.engine.sendToOpfsWorker('UPDATE', { id, changes });
    return { success: true };
  }

  async delete(id: number): Promise<BackendOrError<MutationResult>> {
    await this.engine.sendToOpfsWorker('DELETE', { id });
    return { success: true };
  }

  async toggleStar(id: number): Promise<BackendOrError<StarResult>> {
    const result = await this.engine.sendToOpfsWorker('TOGGLE_STAR', { id }) as { is_starred: number };
    return { success: true, is_starred: result.is_starred };
  }

  async purgeOldRecords(retentionDays: number, maxRecords: number): Promise<BackendOrError<PurgeResult>> {
    const result = await this.engine.tryOpfsProxy<{ purged: number }>('PURGE', { retentionDays, maxRecords });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, purged: result.purged };
  }

  async purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> {
    const result = await this.engine.tryOpfsProxy<{ purged: number }>('CONTENT_PURGE', { retentionDays, maxRecords, includeStarred });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, purged: result.purged };
  }

  async getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>> {
    const result = await this.engine.tryOpfsProxy<{ count: number }>('FTS_INDEX_SIZE');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, count: result.count };
  }

  async backupDb(): Promise<BackendOrError<BackupResult>> {
    const result = await this.engine.tryOpfsProxy<Uint8Array>('BACKUP');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, data: result };
  }

  async archivePreview(cutoffDate: string, cutoffMs: number, includeDeleted: boolean): Promise<BackendOrError<ArchivePreviewResult>> {
    return this.proxyArchive<ArchivePreviewData, { preview: ArchivePreviewData }>(
      'ARCHIVE_PREVIEW', { cutoffDate, cutoffMs, includeDeleted }, (result) => ({ preview: result }),
    );
  }

  async archiveCreate(params: ArchiveCreateParams): Promise<BackendOrError<ArchiveCreateResult>> {
    return this.proxyArchive<ArchiveCreateData, { stagingName: string; recordCount: number }>(
      'ARCHIVE_CREATE', params, (result) => ({ stagingName: result.stagingName, recordCount: result.recordCount }),
    );
  }

  async archiveCleanup(): Promise<BackendOrError<ArchiveCleanupResult>> {
    return this.proxyArchive<{ removed: string[] }, { removed: string[] }>(
      'ARCHIVE_CLEANUP', undefined, (result) => ({ removed: result.removed }),
    );
  }

  async archiveExportChunk(stagingName: string, offset: number, length: number): Promise<BackendOrError<ArchiveExportChunkResult>> {
    return this.proxyArchive<ArchiveExportData, ArchiveExportData>(
      'ARCHIVE_EXPORT', { stagingName, offset, length },
      (result) => ({ chunk: result.chunk, nextOffset: result.nextOffset, total: result.total, done: result.done }),
    );
  }

  async archivePrepareIncoming(): Promise<BackendOrError<ArchivePrepareIncomingResult>> {
    return this.proxyArchive<{ stagingName: string }, { stagingName: string }>(
      'ARCHIVE_PREPARE_INCOMING', undefined, (result) => ({ stagingName: result.stagingName }),
    );
  }

  async archiveRestorePreview(stagingName: string): Promise<BackendOrError<ArchiveRestorePreviewResult>> {
    return this.proxyArchive<ArchiveRestorePreviewData, { preview: ArchiveRestorePreviewData }>(
      'ARCHIVE_RESTORE_PREVIEW', { stagingName }, (result) => ({ preview: result }),
    );
  }

  async archiveRestore(stagingName: string): Promise<BackendOrError<ArchiveRestoreResult>> {
    return this.proxyArchive<ArchiveRestoreData, ArchiveRestoreData>(
      'ARCHIVE_RESTORE', { stagingName },
      (result) => ({ restored: result.restored, restoredDeleted: result.restoredDeleted, skipped: result.skipped, skippedInvalid: result.skippedInvalid }),
    );
  }

  async archiveDeleteByStaging(stagingName: string): Promise<BackendOrError<ArchiveDeleteByStagingResult>> {
    return this.proxyArchive<ArchiveDeleteByStagingResult, Omit<ArchiveDeleteByStagingResult, 'success'>>(
      'ARCHIVE_DELETE_BY_STAGING', { stagingName },
      (result) => ({ deleted: result.deleted, remaining: result.remaining, freelistBefore: result.freelistBefore, freelistAfter: result.freelistAfter, vacuumOk: result.vacuumOk }),
    );
  }

  async archiveOpen(stagingName: string): Promise<BackendOrError<ArchiveOpenResult>> {
    return this.proxyArchive<void, Record<string, never>>('ARCHIVE_OPEN', { stagingName }, () => ({}));
  }

  async archiveQuery(stagingName: string, query: string, limit: number, offset: number): Promise<BackendOrError<ArchiveQueryResult>> {
    return this.proxyArchive<{ rows: ArchiveSessionRow[]; total: number }, { rows: ArchiveSessionRow[]; total: number }>(
      'ARCHIVE_QUERY', { stagingName, query, limit, offset }, (result) => ({ rows: result.rows, total: result.total }),
    );
  }

  async archiveUpdate(stagingName: string, id: number, changes: Record<string, unknown>): Promise<BackendOrError<ArchiveUpdateResult>> {
    return this.proxyArchive<{ dirty: boolean }, { dirty: boolean }>(
      'ARCHIVE_UPDATE', { stagingName, id, changes }, (result) => ({ dirty: result.dirty }),
    );
  }

  async archiveSave(stagingName: string): Promise<BackendOrError<ArchiveSaveResult>> {
    return this.proxyArchive<{ dirty: boolean }, { dirty: boolean }>(
      'ARCHIVE_SAVE', { stagingName }, (result) => ({ dirty: result.dirty }),
    );
  }

  async archiveClose(stagingName: string): Promise<BackendOrError<ArchiveCloseResult>> {
    return this.proxyArchive<{ dirty: boolean }, { dirty: boolean }>(
      'ARCHIVE_CLOSE', { stagingName }, (result) => ({ dirty: result.dirty }),
    );
  }

  async archiveStatus(): Promise<BackendOrError<ArchiveStatusResult>> {
    return this.proxyArchive<ArchiveSessionStatusData, { status: ArchiveSessionStatusData }>(
      'ARCHIVE_STATUS', undefined, (result) => ({ status: result }),
    );
  }

  async restoreDb(data: Uint8Array): Promise<BackendOrError<MutationResult>> {
    const result = await this.engine.tryOpfsProxy<{ restored: boolean }>('RESTORE', { data });
    if (result && result.restored) return { success: true };
    return { success: false, error: 'Binary restore failed' };
  }

  async healthCheck(): Promise<BackendOrError<HealthResult>> {
    const result = await this.engine.tryOpfsProxy<{ ok: boolean }>('HEALTH_CHECK');
    if (result !== null && result.ok) return { success: true };
    return { success: false, error: 'Health check failed' };
  }

  async getStatus(): Promise<BackendOrError<StatusResult>> {
    const result = await this.engine.tryOpfsProxy<StatusResult>('STATUS');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return result;
  }

  async insertAuditLog(record: AuditLogRecord): Promise<BackendOrError<InsertResult>> {
    const result = await this.engine.sendToOpfsWorker('AUDIT_LOG_INSERT', record) as { id: number };
    return { success: true, id: result.id };
  }

  async queryAuditLog(options: { limit?: number; offset?: number }): Promise<BackendOrError<AuditLogQueryResult>> {
    const result = await this.engine.tryOpfsProxy<{ rows: AuditLogRecord[]; total: number }>('AUDIT_LOG_QUERY', options);
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, rows: result.rows as AuditLogEntry[], total: result.total };
  }

  async getCount(): Promise<BackendOrError<CountResult>> {
    const result = await this.engine.tryOpfsProxy<{ count: number }>('GET_COUNT');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, count: result.count };
  }

  async clearAll(): Promise<BackendOrError<MutationResult>> {
    await this.engine.sendToOpfsWorker('CLEAR_ALL', {});
    return { success: true };
  }
}
