// src/offscreen/FallbackStorageAdapter.ts
import type { StorageBackend, InsertResult, InsertBatchResult, QueryResult, SearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult, BackupResult, CountResult, HealthResult, AuditLogQueryResult, StatusResult, BackendOrError } from './StorageBackend.js';
import { FallbackStorage } from './storageFallback.js';
import type { BrowsingLogRecord, QueryOptions, AuditLogRecord } from '../utils/sqlite-types.js';

export class FallbackStorageAdapter implements StorageBackend {
  constructor(private fallback: FallbackStorage) {}

  async insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>> {
    return this.fallback.insert(record);
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>> {
    const result = await this.fallback.insertBatch(records);
    if (!result.success) return result;
    return { success: true, inserted: result.count, skipped: records.length - result.count };
  }

  async query(options: QueryOptions): Promise<BackendOrError<QueryResult>> {
    const result = await this.fallback.query(options);
    if (!result.success) return result;
    return { success: true, rows: result.rows as QueryResult['rows'], total: result.total };
  }

  async search(query: string, limit: number, offset: number): Promise<BackendOrError<SearchResult>> {
    const result = await this.fallback.search(query, limit, offset);
    if (!result.success) return result;
    return { success: true, rows: result.rows as SearchResult['rows'], total: result.total };
  }

  async update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>> {
    const ok = await this.fallback.update(id, changes);
    if (!ok.success) return ok;
    return { success: true };
  }

  async delete(id: number): Promise<BackendOrError<MutationResult>> {
    const ok = await this.fallback.hardDelete(id);
    if (!ok.success) return ok;
    return { success: true };
  }

  async toggleStar(id: number): Promise<BackendOrError<StarResult>> {
    return this.fallback.toggleStar(id);
  }

  async purgeOldRecords(retentionDays: number, maxRecords: number): Promise<BackendOrError<PurgeResult>> {
    return this.fallback.purgeOldRecords(retentionDays, maxRecords);
  }

  async purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> {
    return this.fallback.purgeContent(retentionDays, maxRecords, includeStarred);
  }

  async getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>> {
    return { success: true, count: 0 };
  }

  async backupDb(): Promise<BackendOrError<BackupResult>> {
    return { success: false, error: 'Binary backup requires OPFS storage.' };
  }

  async restoreDb(_data: Uint8Array): Promise<BackendOrError<MutationResult>> {
    return { success: false, error: 'Binary restore requires OPFS storage.' };
  }

  async healthCheck(): Promise<BackendOrError<HealthResult>> {
    const ok = await this.fallback.healthCheck();
    if (!ok) return { success: false, error: 'Fallback storage unavailable' };
    return { success: true };
  }

  async getStatus(): Promise<BackendOrError<StatusResult>> {
    return { initialized: true, fallback: true, fts5: false, supportsBinaryBackup: false };
  }

  async insertAuditLog(_record: AuditLogRecord): Promise<BackendOrError<InsertResult>> {
    return { success: false, error: 'Audit log not supported in fallback mode' };
  }

  async queryAuditLog(_options?: { limit?: number; offset?: number }): Promise<BackendOrError<AuditLogQueryResult>> {
    return { success: false, error: 'Audit log not supported in fallback mode' };
  }

  async getCount(): Promise<BackendOrError<CountResult>> {
    const result = await this.fallback.getCount();
    if (!result.success) return result;
    return { success: true, count: result.count };
  }

  async clearAll(): Promise<BackendOrError<MutationResult>> {
    const result = await this.fallback.clearAll();
    if (!result.success) return { success: false, error: result.error ?? 'clearAll failed' };
    return { success: true };
  }
}
