// src/offscreen/OpfsWorkerBackend.ts
import type { SqliteEngineContext } from './sqliteEngineContext.js';
import type { StorageBackend, InsertResult, InsertBatchResult, QueryResult, SearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult, BackupResult, CountResult, HealthResult, AuditLogQueryResult, StatusResult, BackendOrError } from './StorageBackend.js';
import type { BrowsingLogRecord, BrowsingLogEntry, QueryOptions, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';

export class OpfsWorkerBackend implements StorageBackend {
  constructor(private engine: SqliteEngineContext) {}

  async insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>> {
    const result = await this.engine.sendToOpfsWorker('INSERT', record) as { id: number };
    return { success: true, id: result.id };
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>> {
    const result = await this.engine.sendToOpfsWorker('INSERT_BATCH', records) as { inserted: number; skipped: number };
    return { success: true, inserted: result.inserted, skipped: result.skipped };
  }

  async query(options: QueryOptions): Promise<BackendOrError<QueryResult>> {
    const result = await this.engine.tryOpfsProxy<{ rows: BrowsingLogRecord[]; total: number }>('QUERY', options);
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, rows: result.rows as BrowsingLogEntry[], total: result.total };
  }

  async search(query: string, limit: number, offset: number): Promise<BackendOrError<SearchResult>> {
    const result = await this.engine.tryOpfsProxy<{ rows: (BrowsingLogRecord & { rank: number })[]; total: number }>('SEARCH', { searchQuery: query, limit, offset });
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
    if (result === null || result.length === 0) return { success: false, error: 'Binary backup failed' };
    return { success: true, data: result };
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
    return { success: true as const, ...result } as unknown as BackendOrError<StatusResult>;
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
