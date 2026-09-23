// @layer 1 — OffscreenGateway (background → offscreen hop)
// Extracted from sqliteGateway.ts (390l) to give each hop its own locality (PBI 07).

import { ErrorCode } from '../../utils/logger/types.js';
import { logError, logInfo } from '../../utils/logger/api.js';
import { getOffscreenTransportName } from '../offscreenTransport.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { pickStatusExtras } from '../../messaging/sqliteValidators.js';
import { recordSqliteFailure, recordSqliteSuccess } from '../sqliteAlert.js';
import type { SqliteError, QueryOp, MutateOp, MaintainOp, AuditLogRecord } from '../../messaging/sqliteRpcClient.js';
import { categorizeError } from '../../messaging/sqliteRpcClient.js';
import type { SqliteMessageType } from '../../messaging/sqliteMessages.js';
import type {
  OffscreenBinaryResponse,
  OffscreenStatusResponse,
  OffscreenStatusData,
  OffscreenPurgeResponse,
  OffscreenContentPurgeResponse,
  OffscreenWriteResponse,
  OffscreenHealthResponse,
  ArchiveSessionRow,
  ArchiveSessionStatusData,
  ArchivePurgeData,
  ArchivePreviewData,
  ArchiveCreateData,
  ArchiveExportData,
  ArchiveRestorePreviewData,
  ArchiveRestoreData,
} from '../../messaging/sqliteMessages.js';
import type { OffscreenTransport } from '../offscreenTransport.js';
import { createOffscreenTransport } from '../offscreenTransport.js';
import type { BrowsingLogRecord, StorageQuery } from '../../utils/sqlite-types.js';
import { archiveWireFor, archiveNoRetry, isArchiveOpType, type ArchiveOpType } from '../../messaging/archiveWireTable.js';
import { SQLITE_WIRE_DESCRIPTORS, sqliteWireFor } from '../../messaging/sqliteWireTable.js';

export type SqliteResult<T> = { success: true; data: T } | { success: false; error: SqliteError };
export type { SqliteError };
export { categorizeError };

type GatewaySuccessResponse = { success: true } & Record<string, unknown>;

export class OffscreenGateway {
  private readonly injectedTransport: OffscreenTransport | null;
  private transportPromise: Promise<OffscreenTransport> | null = null;
  constructor(transport?: OffscreenTransport) { this.injectedTransport = transport ?? null; }

  /** Resolve the container transport once (build-time browser split inside). */
  private getTransport(): Promise<OffscreenTransport> {
    if (this.injectedTransport) return Promise.resolve(this.injectedTransport);
    this.transportPromise ??= (async () => {
      const transport = await createOffscreenTransport();
      await logInfo(`Offscreen transport selected: ${getOffscreenTransportName()}`, { source: 'sqlite' });
      return transport;
    })();
    return this.transportPromise;
  }

  private async callInternal<T, R = unknown>(type: SqliteMessageType, payload: Record<string, unknown> = {}, transform?: (res: Extract<R, { success: true }>) => T, traceId?: string, transportOpts?: { noRetry?: boolean }): Promise<SqliteResult<T>> {
    try {
      const transport = await this.getTransport();
      const res = await transport.msgOffscreen(type, payload, traceId, transportOpts);
      if (!res?.success) {
        const msg = res && 'error' in res ? String(res.error) : `${type} failed`;
        recordSqliteFailure(type, msg);
        logError('SQLite Gateway: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
        return { success: false, error: categorizeError(msg) };
      }
      recordSqliteSuccess();
      return { success: true, data: transform ? transform(res as Extract<R, { success: true }>) : (res as unknown as T) };
    } catch (error) {
      const msg = errorMessage(error);
      recordSqliteFailure(type, msg);
      logError('SQLite Gateway: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
      return { success: false, error: categorizeError(msg) };
    }
  }

  async query(q?: StorageQuery): Promise<SqliteResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'search' }>): Promise<SqliteResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'count' }>): Promise<SqliteResult<number>>;
  async query(op: Extract<QueryOp, { kind: 'auditLog' }>): Promise<SqliteResult<{ rows: AuditLogRecord[]; total: number }>>;
  async query(op: QueryOp | StorageQuery = {}): Promise<SqliteResult<unknown>> {
    // Query ops (PBI 2026-09-20-16): routed through SQLITE_WIRE_TABLE. The
    // row supplies the message type, the wire payload, and the response
    // decoder — the per-kind switch (including the search -> StorageQuery
    // fold, now the search row's encodePayload) is dissolved. A plain
    // StorageQuery still enters as the records op. Adding a QueryOp kind
    // without a row fails the table's compile-time sync assert; a drifted
    // lookup fails closed here.
    if (isQueryOp(op)) {
      const row = sqliteWireFor(op.kind);
      if (!row || row.family !== 'query') throw new Error('Unhandled query op');
      return this.callInternal<unknown>(
        row.messageType,
        row.encodePayload(op),
        (res) => row.decodeGateway(res),
      );
    }
    const recordsRow = SQLITE_WIRE_DESCRIPTORS.records;
    return this.callInternal<unknown>(
      recordsRow.messageType,
      recordsRow.encodePayload(recordsRow.encodeOp(op)),
      (res) => recordsRow.decodeGateway(res),
    );
  }

  async mutate(op: Extract<MutateOp, { type: 'insert' }>): Promise<SqliteResult<{ id: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertBatch' }>): Promise<SqliteResult<{ count: number; skipped: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'update' }> | Extract<MutateOp, { type: 'delete' }>): Promise<SqliteResult<void>>;
  async mutate(op: Extract<MutateOp, { type: 'toggleStar' }>): Promise<SqliteResult<{ is_starred: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertAuditLog' }>): Promise<SqliteResult<{ id: number }>>;
  async mutate(op: MutateOp): Promise<SqliteResult<unknown>> {
    // Mutate ops (PBI 2026-09-20-16): routed through SQLITE_WIRE_TABLE, same
    // shape as query() above. The flattened update contract lives in the
    // update row's encodePayload now (see its comment).
    const row = sqliteWireFor(op.type);
    if (!row || row.family !== 'mutate') throw new Error('Unhandled mutate op');
    return this.callInternal<unknown>(
      row.messageType,
      row.encodePayload(op),
      (res) => row.decodeGateway(res),
      (op as { traceId?: string }).traceId,
    );
  }

  async maintain(op: { type: 'init' }): Promise<SqliteResult<boolean>>;
  async maintain(op: { type: 'backup' }): Promise<SqliteResult<Uint8Array>>;
  async maintain(op: { type: 'restore'; data: Uint8Array } | { type: 'clearAll' }): Promise<SqliteResult<void>>;
  async maintain(op: { type: 'purgeOldRecords'; retentionDays?: number; maxRecords?: number } | { type: 'purgeContent'; retentionDays?: number; maxRecords?: number; includeStarred?: boolean }): Promise<SqliteResult<{ purged: number }>>;
  async maintain(op: { type: 'healthCheck' }): Promise<SqliteResult<boolean>>;
  async maintain(op: { type: 'archivePreview'; cutoffDate: string; cutoffMs: number; includeDeleted: boolean }): Promise<SqliteResult<ArchivePreviewData>>;
  async maintain(op: { type: 'archiveCreate'; cutoffDate: string; cutoffMs: number; includeDeleted: boolean; yasumaroVersion: string }): Promise<SqliteResult<ArchiveCreateData>>;
  async maintain(op: { type: 'archiveCleanup' }): Promise<SqliteResult<{ removed: string[] }>>;
  async maintain(op: { type: 'archiveExport'; stagingName: string; offset: number; length: number }): Promise<SqliteResult<ArchiveExportData>>;
  async maintain(op: { type: 'archivePrepareIncoming' }): Promise<SqliteResult<string>>;
  async maintain(op: { type: 'archiveRestorePreview'; stagingName: string }): Promise<SqliteResult<ArchiveRestorePreviewData>>;
  async maintain(op: { type: 'archiveRestore'; stagingName: string }): Promise<SqliteResult<ArchiveRestoreData>>;
  async maintain(op: { type: 'archiveDeleteByStaging'; stagingName: string }): Promise<SqliteResult<ArchivePurgeData>>;
  async maintain(op: { type: 'archiveOpen'; stagingName: string }): Promise<SqliteResult<void>>;
  async maintain(op: { type: 'archiveQuery'; stagingName: string; query: string; limit: number; offset: number }): Promise<SqliteResult<{ rows: ArchiveSessionRow[]; total: number }>>;
  async maintain(op: { type: 'archiveUpdate'; stagingName: string; id: number; changes: Record<string, unknown> }): Promise<SqliteResult<{ dirty: boolean }>>;
  async maintain(op: { type: 'archiveSave'; stagingName: string }): Promise<SqliteResult<{ dirty: boolean }>>;
  async maintain(op: { type: 'archiveClose'; stagingName: string }): Promise<SqliteResult<{ dirty: boolean }>>;
  async maintain(op: { type: 'archiveStatus' }): Promise<SqliteResult<ArchiveSessionStatusData>>;
  async maintain(op: MaintainOp): Promise<SqliteResult<unknown>> {
    // Archive ops (PBI 2026-09-07-22): routed through ARCHIVE_WIRE_TABLE.
    // The op object minus its discriminator is the wire payload; the table
    // supplies the message type, the response decoder, and the noRetry flag
    // (bulk/state-changing ops where a timeout does not mean failure, so a
    // blind retry would double-execute).
    if (isArchiveOpType(op.type)) {
      const entry = archiveWireFor(op.type);
      if (!entry) throw new Error(`Unhandled maintain op: ${op.type}`);
      const { type: _discriminator, ...payload } = op as unknown as Record<string, unknown>;
      // Decode ownership lives in the wire-table row (PBI 2026-09-23-02):
      // the gateway references entry.decodeResponse instead of a local
      // decoder copy, so a shape change fails in the row's codec, not here.
      // (PBI 2026-09-15-04: decode throws still surface as SqliteResult
      // errors instead of silent undefined.)
      const decode = (res: GatewaySuccessResponse) => entry.decodeResponse(res);
      return this.callInternal<unknown>(
        entry.messageType,
        payload,
        decode,
        undefined,
        archiveNoRetry(op.type) ? { noRetry: true } : undefined,
      );
    }
    // Archive ops return above, so the switch below only sees the
    // non-archive remainder; the cast makes that explicit to the checker.
    const rest = op as Exclude<MaintainOp, { type: ArchiveOpType }>;
    switch (rest.type) {
      case 'init': { const result = await this.callInternal<boolean, OffscreenHealthResponse>('SQLITE_INIT'); return result.success ? { success: true, data: true } : result; }
      case 'backup': return this.callInternal<Uint8Array, OffscreenBinaryResponse>('SQLITE_BACKUP', {}, (res) => new Uint8Array(res.data));
      case 'restore': return this.callInternal<void, OffscreenWriteResponse>('SQLITE_RESTORE', { data: Array.from(rest.data) }, () => undefined);
      case 'clearAll': return this.callInternal<void, OffscreenWriteResponse>('SQLITE_CLEAR_ALL', {}, () => undefined);
      case 'purgeOldRecords': return this.callInternal<{ purged: number }, OffscreenPurgeResponse>('SQLITE_PURGE', { retentionDays: rest.retentionDays, maxRecords: rest.maxRecords }, (res) => ({ purged: res.purged }));
      case 'purgeContent': return this.callInternal<{ purged: number }, OffscreenContentPurgeResponse>('CONTENT_PURGE', { retentionDays: rest.retentionDays, maxRecords: rest.maxRecords, includeStarred: rest.includeStarred }, (res) => ({ purged: res.purged }));
      case 'healthCheck': { const result = await this.callInternal<boolean, OffscreenHealthResponse>('SQLITE_HEALTH_CHECK', {}); return result.success ? { success: true, data: true } : result; }
      default: { const exhaustive: never = rest; void exhaustive; throw new Error('Unhandled maintain op'); }
    }
  }

  async status(): Promise<SqliteResult<Omit<OffscreenStatusData, 'success'>>> {
    // PBI 2026-09-11-03 (round 5): the extras projection is DERIVED from
    // SqliteStatusExtras via pickStatusExtras — adding a field to the STATUS
    // contract compiles here automatically (round 4's silent-drop bug class
    // is closed by construction instead of by list maintenance).
    const result = await this.callInternal<Omit<OffscreenStatusData, 'success'>, OffscreenStatusResponse>('SQLITE_STATUS', {}, (r) => ({ initialized: r.initialized, path: r.path, fallback: r.fallback, ...pickStatusExtras(r) }));
    return result;
  }

  async getStatus(): Promise<Omit<OffscreenStatusData, 'success'> | null> {
    const result = await this.status();
    if (result.success) return result.data;
    return { initialized: false, path: '', fallback: false, fts5: false, initError: result.error.message || 'Unknown error' };
  }
}

function isQueryOp(op: QueryOp | StorageQuery): op is QueryOp { return typeof op === 'object' && op !== null && 'kind' in op; }

// Backward compat — keep both value and type for callers that use
// SqliteGateway / SqliteClient as types. SqliteClient used to be a
// pass-through class repeating the gateway's full overload surface; the
// gateway is the single implementation (SqliteResult<T> and SqliteRpcResult<T>
// are structurally identical, so existing type annotations keep working).
export const SqliteGateway = OffscreenGateway;
export type SqliteGateway = OffscreenGateway;
export const SqliteClient = OffscreenGateway;
export type SqliteClient = OffscreenGateway;

export type { SqliteRpcResult as CallResult } from '../../messaging/sqliteRpcClient.js';

/**
 * Lazy singleton shared with the container: the manifest's sqliteClient entry
 * delegates to getSharedSqliteClient, so both paths observe one instance.
 * Module state is an SW-lifetime cache only; durable state lives offscreen.
 * See dev-docs/ADR/2026-09-17-module-singleton-policy.md.
 */
let sharedInstance: SqliteClient | null = null;
export function getSharedSqliteClient(): SqliteClient { if (!sharedInstance) sharedInstance = new SqliteClient(); return sharedInstance; }
