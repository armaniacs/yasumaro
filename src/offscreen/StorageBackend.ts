import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';

export interface InsertResult { success: true; id: number }
export interface InsertBatchResult { success: true; inserted: number; skipped: number }
export interface QueryResult { success: true; rows: BrowsingLogEntry[]; total: number }
export interface SearchResult { success: true; rows: (BrowsingLogEntry & { rank: number })[]; total: number }

/**
 * Unified result type for StorageBackend.query(StorageQuery).
 * When the query carries `text`, the backend performs FTS5 or LIKE search
 * and may populate `rank` (FTS5 bm25) — otherwise rank stays 0.
 */
export interface QuerySearchResult {
  success: true;
  rows: (BrowsingLogEntry & { rank: number })[];
  total: number;
}

export interface MutationResult { success: true }
export interface StarResult { success: true; is_starred: number }
export interface PurgeResult { success: true; purged: number }
export interface FtsSizeResult { success: true; count: number }
export interface BackupResult { success: true; data: Uint8Array }
export interface CountResult { success: true; count: number }
export interface HealthResult { success: true } // healthCheck — success means alive, failure means error
export interface AuditLogQueryResult { success: true; rows: AuditLogEntry[]; total: number }
export type BackendOrError<T> = T | { success: false; error: string };

export interface StatusResult {
  initialized: boolean;
  fallback: boolean;
  fts5: boolean;
  supportsBinaryBackup: boolean;
  path?: string;
  compileOptions?: string[];
  compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback';
  initError?: string;
}

/**
 * Queryable — read-only facet of storage.
 * Covers query/search/status/health/count/auditLog read operations.
 */
export interface Queryable {
  /**
   * Unified read path — replaces the separate query(QueryOptions) and
   * search(query, limit, offset, options) signatures.
   *
   * When q.text is present, the backend internally decides FTS5 vs LIKE
   * based on trigram length.  Otherwise returns a plain filtered listing.
   */
  query(q: StorageQuery): Promise<BackendOrError<QuerySearchResult>>;
  healthCheck(): Promise<BackendOrError<HealthResult>>;
  getStatus(): Promise<BackendOrError<StatusResult>>;
  getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>>;
  queryAuditLog(options: { limit?: number; offset?: number }): Promise<BackendOrError<AuditLogQueryResult>>;
  getCount(): Promise<BackendOrError<CountResult>>;
}

/**
 * Mutable — write facet of storage.
 * Covers insert/update/delete/purge/backup/restore operations.
 */
export interface Mutable {
  insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>>;
  insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>>;
  update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>>;
  delete(id: number): Promise<BackendOrError<MutationResult>>;
  toggleStar(id: number): Promise<BackendOrError<StarResult>>;
  purgeOldRecords(retentionDays: number, maxRecords: number): Promise<BackendOrError<PurgeResult>>;
  purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>>;
  backupDb(): Promise<BackendOrError<BackupResult>>;
  restoreDb(data: Uint8Array): Promise<BackendOrError<MutationResult>>;
  insertAuditLog(record: AuditLogRecord): Promise<BackendOrError<InsertResult>>;
  clearAll(): Promise<BackendOrError<MutationResult>>;
}

export interface StorageBackend extends Queryable, Mutable {}

const NOT_INITIALIZED = 'Database not initialized';

export class NoopBackend implements StorageBackend {
  private err = (): { success: false; error: string } => ({ success: false, error: NOT_INITIALIZED });
  async insert() { return this.err(); }
  async insertBatch() { return this.err(); }
  async query() { return this.err(); }
  async update() { return this.err(); }
  async delete() { return this.err(); }
  async toggleStar() { return this.err(); }
  async purgeOldRecords() { return this.err(); }
  async purgeContent() { return this.err(); }
  async getFtsIndexSize() { return this.err(); }
  async backupDb() { return this.err(); }
  async restoreDb() { return this.err(); }
  async healthCheck() { return this.err(); }
  async getStatus() { return this.err(); }
  async insertAuditLog() { return this.err(); }
  async queryAuditLog() { return this.err(); }
  async getCount() { return this.err(); }
  async clearAll() { return this.err(); }
}
