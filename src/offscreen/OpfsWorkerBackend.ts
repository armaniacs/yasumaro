// src/offscreen/OpfsWorkerBackend.ts
import type { SqliteEngineHost } from './sqliteEngineHost.js';
import type { StorageBackend, InsertResult, InsertBatchResult, QuerySearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult, BackupResult, CountResult, HealthResult, AuditLogQueryResult, StatusResult, BackendOrError, ArchivePreviewResult, ArchiveCreateResult, ArchiveCleanupResult, ArchiveExportChunkResult, ArchiveCreateParams, ArchivePrepareIncomingResult, ArchiveRestorePreviewResult, ArchiveRestoreResult, ArchiveDeleteByStagingResult } from './StorageBackend.js';
import type { ArchivePreviewData, ArchiveCreateData, ArchiveExportData, ArchiveRestorePreviewData, ArchiveRestoreData } from '../messaging/sqliteMessages.js';
import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';

export class OpfsWorkerBackend implements StorageBackend {
  constructor(private engine: SqliteEngineHost) {}

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

  async archivePreview(cutoffMs: number, includeDeleted: boolean): Promise<BackendOrError<ArchivePreviewResult>> {
    const result = await this.engine.tryOpfsProxy<ArchivePreviewData>('ARCHIVE_PREVIEW', { cutoffMs, includeDeleted });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, preview: result };
  }

  async archiveCreate(params: ArchiveCreateParams): Promise<BackendOrError<ArchiveCreateResult>> {
    const result = await this.engine.tryOpfsProxy<ArchiveCreateData>('ARCHIVE_CREATE', params);
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, stagingName: result.stagingName, recordCount: result.recordCount };
  }

  async archiveCleanup(): Promise<BackendOrError<ArchiveCleanupResult>> {
    const result = await this.engine.tryOpfsProxy<string[]>('ARCHIVE_CLEANUP');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, removed: result };
  }

  async archiveExportChunk(stagingName: string, offset: number, length: number): Promise<BackendOrError<ArchiveExportChunkResult>> {
    const result = await this.engine.tryOpfsProxy<ArchiveExportData>('ARCHIVE_EXPORT', { stagingName, offset, length });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, chunk: result.chunk, nextOffset: result.nextOffset, total: result.total, done: result.done };
  }

  async archivePrepareIncoming(): Promise<BackendOrError<ArchivePrepareIncomingResult>> {
    const result = await this.engine.tryOpfsProxy<string>('ARCHIVE_PREPARE_INCOMING');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, stagingName: result };
  }

  async archiveRestorePreview(stagingName: string): Promise<BackendOrError<ArchiveRestorePreviewResult>> {
    const result = await this.engine.tryOpfsProxy<ArchiveRestorePreviewData>('ARCHIVE_RESTORE_PREVIEW', { stagingName });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, preview: result };
  }

  async archiveRestore(stagingName: string): Promise<BackendOrError<ArchiveRestoreResult>> {
    const result = await this.engine.tryOpfsProxy<ArchiveRestoreData>('ARCHIVE_RESTORE', { stagingName });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return {
      success: true,
      restored: result.restored,
      restoredDeleted: result.restoredDeleted,
      skipped: result.skipped,
      skippedInvalid: result.skippedInvalid,
    };
  }

  async archiveDeleteByStaging(stagingName: string): Promise<BackendOrError<ArchiveDeleteByStagingResult>> {
    const result = await this.engine.tryOpfsProxy<ArchiveDeleteByStagingResult>('ARCHIVE_DELETE_BY_STAGING', { stagingName });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return {
      success: true,
      deleted: result.deleted,
      remaining: result.remaining,
      freelistBefore: result.freelistBefore,
      freelistAfter: result.freelistAfter,
      vacuumOk: result.vacuumOk,
    };
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
