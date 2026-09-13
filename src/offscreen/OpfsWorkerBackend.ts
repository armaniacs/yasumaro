// src/offscreen/OpfsWorkerBackend.ts
import type { SqliteEngineHost } from './sqliteEngineHost.js';
import type { StorageBackend, InsertResult, InsertBatchResult, QuerySearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult, BackupResult, SerializeResult, CountResult, HealthResult, AuditLogQueryResult, StatusResult, BackendOrError, ArchivePreviewResult, ArchiveCreateResult, ArchiveCleanupResult, ArchiveExportChunkResult, ArchiveCreateParams, ArchivePrepareIncomingResult, ArchiveRestorePreviewResult, ArchiveRestoreResult, ArchiveDeleteByStagingResult, ArchiveOpenResult, ArchiveQueryResult, ArchiveUpdateResult, ArchiveSaveResult, ArchiveCloseResult, ArchiveStatusResult } from './StorageBackend.js';
import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';
import type { ArchiveStaging } from './archiveStaging.js';
import { ARCHIVE_DESCRIPTORS, type ArchiveDescriptor, type DescriptorResponse } from '../messaging/archiveWireTable.js';

export class OpfsWorkerBackend implements StorageBackend, ArchiveStaging {
  constructor(private engine: SqliteEngineHost) {}

  /**
   * Single construction point for `{ success: true, ...data }` over the
   * worker proxy. The field projection lives in the wire-table descriptor,
   * so a bare proxy result cannot be double-wrapped here — the shape is
   * enforced by construction instead of per-method lambdas.
   */
  private async proxyArchive<D extends ArchiveDescriptor>(
    descriptor: D,
    payload: unknown,
  ): Promise<BackendOrError<DescriptorResponse<D>>> {
    const result = await this.engine.tryOpfsProxy<unknown>(descriptor.workerType, payload);
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, ...descriptor.project(result) } as DescriptorResponse<D>;
  }

  async insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>> {
    const result = await this.engine.sendToOpfsWorker('INSERT', record) as { id: number };
    return { success: true, id: result.id };
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>> {
    const result = await this.engine.sendToOpfsWorker('INSERT_BATCH', records) as { count: number; inserted: number; skipped: number };
    return { success: true, inserted: result.inserted, skipped: result.skipped };
  }

  async query(q: StorageQuery): Promise<BackendOrError<QuerySearchResult>> {
    // Text search MUST route to the worker SEARCH handler (FTS5/LIKE), not
    // the plain-listing QUERY handler — the plain path ignores `text` and
    // rejects `orderBy: 'rank'` (which dashboard text search sends), so every
    // text search on the OPFS backend returned empty. Mirrors
    // IdbVfsBackend.query's `if (q.text)` branch and FallbackStorage.query.
    const workerType = q.text ? 'SEARCH' : 'QUERY';
    const result = await this.engine.tryOpfsProxy<{ rows: (BrowsingLogEntry & { rank: number })[]; total: number }>(workerType, q);
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
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archivePreview, { cutoffDate, cutoffMs, includeDeleted });
  }

  async archiveCreate(params: ArchiveCreateParams): Promise<BackendOrError<ArchiveCreateResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveCreate, params);
  }

  async archiveCleanup(): Promise<BackendOrError<ArchiveCleanupResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveCleanup, undefined);
  }

  async archiveExportChunk(stagingName: string, offset: number, length: number): Promise<BackendOrError<ArchiveExportChunkResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveExport, { stagingName, offset, length });
  }

  async archivePrepareIncoming(): Promise<BackendOrError<ArchivePrepareIncomingResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archivePrepareIncoming, undefined);
  }

  async archiveRestorePreview(stagingName: string): Promise<BackendOrError<ArchiveRestorePreviewResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveRestorePreview, { stagingName });
  }

  async archiveRestore(stagingName: string): Promise<BackendOrError<ArchiveRestoreResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveRestore, { stagingName });
  }

  async archiveDeleteByStaging(stagingName: string): Promise<BackendOrError<ArchiveDeleteByStagingResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveDeleteByStaging, { stagingName });
  }

  async archiveOpen(stagingName: string): Promise<BackendOrError<ArchiveOpenResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveOpen, { stagingName });
  }

  async archiveQuery(stagingName: string, query: string, limit: number, offset: number): Promise<BackendOrError<ArchiveQueryResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveQuery, { stagingName, query, limit, offset });
  }

  async archiveUpdate(stagingName: string, id: number, changes: Record<string, unknown>): Promise<BackendOrError<ArchiveUpdateResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveUpdate, { stagingName, id, changes });
  }

  async archiveSave(stagingName: string): Promise<BackendOrError<ArchiveSaveResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveSave, { stagingName });
  }

  async archiveClose(stagingName: string): Promise<BackendOrError<ArchiveCloseResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveClose, { stagingName });
  }

  async archiveStatus(): Promise<BackendOrError<ArchiveStatusResult>> {
    return this.proxyArchive(ARCHIVE_DESCRIPTORS.archiveStatus, undefined);
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

  async serialize(): Promise<BackendOrError<SerializeResult>> {
    // PBI 2026-09-12-22: the worker handler now returns the shared envelope
    // (was a bare array over 13 hand-mapped columns).
    const result = await this.engine.tryOpfsProxy<Uint8Array>('SERIALIZE');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, data: result };
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
