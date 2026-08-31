/**
 * sqliteClient.ts
 * Shim — delegates to SqliteGateway (PBI-05).
 * The unified RPC lives in sqliteGateway.ts; this file remains as the
 * public import path for Service Worker callers and tests.
 */

import type {
  SqliteRpcResult,
  SqliteRpcClient,
  QueryOp,
  MutateOp,
  MaintainOp,
  AuditLogRecord,
} from '../messaging/sqliteRpcClient.js';
import type { OffscreenTransport } from './offscreenTransport.js';
import type { BrowsingLogRecord, StorageQuery } from '../utils/sqlite-types.js';
import type { OffscreenStatusData } from '../messaging/sqliteMessages.js';
import { SqliteGateway, type SqliteResult } from './sqliteGateway.js';

export type { SqliteRpcResult as CallResult, SqliteError } from '../messaging/sqliteRpcClient.js';
export { categorizeError } from '../messaging/sqliteRpcClient.js';
export type { SqliteResult } from './sqliteGateway.js';

export class SqliteClient implements SqliteRpcClient {
  private readonly gateway: SqliteGateway;

  constructor(transport?: OffscreenTransport) {
    this.gateway = new SqliteGateway(transport);
  }

  // query — delegates to gateway
  async query(q?: StorageQuery): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'search' }>): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'count' }>): Promise<SqliteRpcResult<number>>;
  async query(op: Extract<QueryOp, { kind: 'auditLog' }>): Promise<SqliteRpcResult<{ rows: AuditLogRecord[]; total: number }>>;
  async query(op: QueryOp | StorageQuery = {}): Promise<SqliteRpcResult<unknown>> {
    return this.gateway.query(op as QueryOp & StorageQuery) as Promise<SqliteRpcResult<unknown>>;
  }

  // mutate — delegates to gateway
  async mutate(op: Extract<MutateOp, { type: 'insert' }>): Promise<SqliteRpcResult<{ id: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertBatch' }>): Promise<SqliteRpcResult<{ count: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'update' } | Extract<MutateOp, { type: 'delete' }>>): Promise<SqliteRpcResult<void>>;
  async mutate(op: Extract<MutateOp, { type: 'toggleStar' }>): Promise<SqliteRpcResult<{ is_starred: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertAuditLog' }>): Promise<SqliteRpcResult<{ id: number }>>;
  async mutate(op: MutateOp): Promise<SqliteRpcResult<unknown>> {
    const mutate = this.gateway.mutate.bind(this.gateway) as (op: MutateOp) => Promise<SqliteRpcResult<unknown>>;
    return mutate(op);
  }

  // maintain — delegates to gateway
  async maintain(op: { type: 'init' }): Promise<SqliteRpcResult<boolean>>;
  async maintain(op: { type: 'backup' }): Promise<SqliteRpcResult<Uint8Array>>;
  async maintain(op: { type: 'restore'; data: Uint8Array } | { type: 'clearAll' }): Promise<SqliteRpcResult<void>>;
  async maintain(
    op: { type: 'purgeOldRecords'; retentionDays?: number; maxRecords?: number } | { type: 'purgeContent'; retentionDays?: number; maxRecords?: number; includeStarred?: boolean },
  ): Promise<SqliteRpcResult<{ purged: number }>>;
  async maintain(op: { type: 'opfsSpike' }): Promise<SqliteRpcResult<import('../offscreen/opfsSpike.js').OpfsSpikeReport>>;
  async maintain(op: { type: 'healthCheck' }): Promise<SqliteRpcResult<boolean>>;
  async maintain(op: MaintainOp): Promise<SqliteRpcResult<unknown>> {
    const maintain = this.gateway.maintain.bind(this.gateway) as (op: MaintainOp) => Promise<SqliteRpcResult<unknown>>;
    return maintain(op);
  }

  async getStatus(): Promise<Omit<OffscreenStatusData, 'success'> | null> {
    return this.gateway.getStatus();
  }

  /** Unified status — exposes the gateway's SqliteResult vocabulary directly. */
  async status(): Promise<SqliteResult<Omit<OffscreenStatusData, 'success'>>> {
    return this.gateway.status();
  }
}

// ============================================================================
// Shared instance (M8)
// ============================================================================

let sharedInstance: SqliteClient | null = null;

export function getSharedSqliteClient(): SqliteClient {
  if (!sharedInstance) {
    sharedInstance = new SqliteClient();
  }
  return sharedInstance;
}
