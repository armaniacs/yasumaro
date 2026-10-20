// src/offscreen/OpfsWorkerBackend.ts
import type { SqliteEngineHost } from './sqliteEngineHost.js';
import type { StorageBackend, InsertResult, InsertBatchResult, QuerySearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult, BackupResult, SerializeResult, CountResult, HealthResult, AuditLogQueryResult, StatusResult, BackendOrError, ArchivePreviewResult, ArchiveCreateResult, ArchiveCleanupResult, ArchiveExportChunkResult, ArchiveCreateParams, ArchivePrepareIncomingResult, ArchiveRestorePreviewResult, ArchiveRestoreResult, ArchiveDeleteByStagingResult, ArchiveOpenResult, ArchiveQueryResult, ArchiveUpdateResult, ArchiveSaveResult, ArchiveCloseResult, ArchiveStatusResult } from './StorageBackend.js';
import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';
import type { ArchiveStaging } from './archiveStaging.js';
import { ARCHIVE_DESCRIPTORS, type ArchiveDescriptor, type ArchiveOpType, type DescriptorResponse } from '../messaging/archiveWireTable.js';
import { planQueryMode } from './queryPlan.js';
import type { WorkerMessageType } from './opfsWorker/types.js';

/**
 * The one reason string for "the worker proxy answered null". Every proxy call
 * folds its null into this constant, so the value cannot drift per method and
 * stays greppable for callers that match on it.
 */
export const OPFS_WORKER_UNAVAILABLE_ERROR = 'OPFS Worker unavailable';

/**
 * Consecutive null proxy responses that count as a dead worker.
 *
 * One null is not evidence of death: a worker GC pause or a dropped
 * postMessage race loses a single call on a perfectly healthy engine, and
 * degrading on it would move a live session's data path onto a different
 * engine for a transient hiccup. Three in a row with no intervening success
 * leaves "the worker is alive but slow" as the only explanation left, and that
 * is the point where the host must re-resolve.
 */
export const OPFS_DEGRADE_FAILURE_THRESHOLD = 3;

/**
 * Notified once when the consecutive-failure threshold is reached. The return
 * value is ignored — only the side effect (a finished re-resolution) matters,
 * which is why the parameter is loose about its type.
 */
export type OpfsDegradeSignal = () => unknown;

/**
 * Per-op worker-payload packers (PBI 2026-10-16-08): the positional→payload
 * glue the 14 hand-written archive proxies used to inline per method.
 *
 * Keyed by descriptor.backendMethod; the install loop below pairs each pack
 * with its ARCHIVE_DESCRIPTORS row, so adding an op is one wire-table row
 * plus one pack here (the "runner実装"). The two compile-time asserts pin
 * the pairing both ways: a row without a pack, or a pack without a row, is
 * a type error — not a runtime drift.
 */
export const ARCHIVE_BACKEND_PACKS = {
  archivePreview: (cutoffDate: string, cutoffMs: number, includeDeleted: boolean) => ({
    cutoffDate,
    cutoffMs,
    includeDeleted,
  }),
  archiveCreate: (params: ArchiveCreateParams) => params,
  archiveCleanup: () => undefined,
  archiveExportChunk: (stagingName: string, offset: number, length: number) => ({ stagingName, offset, length }),
  archivePrepareIncoming: () => undefined,
  archiveRestorePreview: (stagingName: string) => ({ stagingName }),
  archiveRestore: (stagingName: string) => ({ stagingName }),
  archiveDeleteByStaging: (stagingName: string) => ({ stagingName }),
  archiveOpen: (stagingName: string) => ({ stagingName }),
  archiveQuery: (stagingName: string, query: string, limit: number, offset: number) => ({ stagingName, query, limit, offset }),
  archiveUpdate: (stagingName: string, id: number, changes: Record<string, unknown>) => ({ stagingName, id, changes }),
  archiveSave: (stagingName: string) => ({ stagingName }),
  archiveClose: (stagingName: string) => ({ stagingName }),
  archiveStatus: () => undefined,
};

export type ArchiveBackendPackMethod = keyof typeof ARCHIVE_BACKEND_PACKS;

type _BackendPacksCovered = Exclude<ArchiveDescriptor['backendMethod'], ArchiveBackendPackMethod> extends never
  ? true
  : never;
const _checkBackendPacksCovered: _BackendPacksCovered = true;
type _BackendPacksLive = Exclude<ArchiveBackendPackMethod, ArchiveDescriptor['backendMethod']> extends never
  ? true
  : never;
const _checkBackendPacksLive: _BackendPacksLive = true;

export class OpfsWorkerBackend implements StorageBackend, ArchiveStaging {
  #consecutiveFailures = 0;
  #degradeSignalled = false;

  /**
   * `onDegraded` is injected rather than reached through `engine` because this
   * adapter is also constructed with a bare host-shaped object in tests, and
   * the signal is the only thing the host has to add — keeping it a parameter
   * leaves the degradation policy (threshold, one-shot) here and the storage
   * policy (re-resolve, latch) in SqliteEngineHost.
   */
  constructor(
    private engine: SqliteEngineHost,
    private onDegraded: OpfsDegradeSignal = () => {},
  ) {}

  /**
   * Single point where a worker call is observed. Routing every proxy call
   * through it is what makes the failure counter complete: the per-method
   * `if (result === null)` checks it replaces each saw only their own call, so
   * a mixed success/failure workload could never accumulate evidence.
   *
   * Mutation calls (insert/insertBatch/update/delete/toggleStar/insertAuditLog/
   * clearAll) route through it too. `sendToOpfsWorker` throws raw rejections
   * and never reaches this counter, so a mutation that bypasses this method
   * fails forever without tripping the degrade ladder onto IDB.
   *
   * The type parameter is bound to WORKER_MESSAGE_TYPES (PBI 2026-10-20-23):
   * the 17 non-archive methods used to pass raw `string` literals that
   * compiled even when misspelled, so a wire-side type rename or a new
   * WORKER_MESSAGE_TYPES entry had no compile-time coupling here. A literal
   * that is not a key of the SSOT array is now a type error; the runtime
   * enumeration sync lives in opfsWorkerBackend-workerTypeSync.test.ts (the
   * ARCHIVE_* side stays synced by archiveWireTable.test.ts, because
   * archiveWireTable.ts must not import offscreen).
   */
  private async callWorker<T>(type: WorkerMessageType, payload?: unknown): Promise<T | null> {
    const result = await this.engine.tryOpfsProxy<T>(type, payload);
    if (result === null) {
      this.#consecutiveFailures += 1;
      await this.#signalDegrade();
    } else {
      this.#consecutiveFailures = 0;
    }
    return result;
  }

  async #signalDegrade(): Promise<void> {
    if (this.#consecutiveFailures < OPFS_DEGRADE_FAILURE_THRESHOLD) return;
    // A dead worker answers null for the rest of the session, so signalling
    // once per adapter is enough: a re-armed counter could only re-run a
    // re-resolution that has already happened (or already failed).
    if (this.#degradeSignalled) return;
    this.#degradeSignalled = true;
    this.#consecutiveFailures = 0;
    // Awaited on purpose. Fire-and-forget would let every call between the
    // signal and the finished re-resolution pick the same dead backend out of
    // the cache and fail again; awaiting makes the next call the one that sees
    // the re-resolved backend.
    try {
      await this.onDegraded();
    } catch {
      // The host reports a failed re-resolution itself, and this call still
      // returns its ordinary `{ success: false }` — a degraded re-resolve must
      // not turn one failed operation into a thrown one.
    }
  }

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
    const result = await this.callWorker<unknown>(
      // archiveWireTable.ts keeps workerType as a string literal on purpose
      // (messaging must not import offscreen); archiveWireTable.test.ts pins
      // every ARCHIVE_* worker type to WORKER_MESSAGE_TYPES, so the runtime
      // value is a valid key even though the descriptor type cannot say so.
      descriptor.workerType as WorkerMessageType,
      payload,
    );
    if (result === null) return { success: false, error: OPFS_WORKER_UNAVAILABLE_ERROR };
    return { success: true, ...descriptor.project(result) } as DescriptorResponse<D>;
  }

  /**
   * The non-archive twin of `proxyArchive`: folds a null worker answer into the
   * shared reason and hands a non-null answer to the caller's projection. The
   * archive side reads its projection from a descriptor row; the ops here have
   * no descriptor, so the project lambda is passed in. The failure counter and
   * degrade signal stay in `callWorker` — this only folds its result.
   */
  private async callWorkerOk<T, R>(
    type: WorkerMessageType,
    payload: unknown,
    project: (result: T) => R,
  ): Promise<BackendOrError<R>> {
    const result = await this.callWorker<T>(type, payload);
    if (result === null) return { success: false, error: OPFS_WORKER_UNAVAILABLE_ERROR };
    return project(result);
  }

  async insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>> {
    return this.callWorkerOk<{ id: number }, InsertResult>('INSERT', record, (result) => ({ success: true, id: result.id }));
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>> {
    return this.callWorkerOk<{ count: number; inserted: number; skipped: number }, InsertBatchResult>(
      'INSERT_BATCH',
      records,
      (result) => ({ success: true, inserted: result.inserted, skipped: result.skipped }),
    );
  }

  async query(q: StorageQuery): Promise<BackendOrError<QuerySearchResult>> {
    // Text search MUST route to the worker SEARCH handler (FTS5/LIKE), not
    // the plain-listing QUERY handler — the plain path ignores `text` and
    // rejects `orderBy: 'rank'` (which dashboard text search sends), so every
    // text search on the OPFS backend returned empty. Dispatch is decided
    // once by queryPlanner.planQueryMode (PBI 2026-09-14-01) and mirrored by
    // IdbVfsBackend.query's `spec.mode` check and FallbackStorage.query's.
    const workerType: WorkerMessageType = planQueryMode(q) === 'search' ? 'SEARCH' : 'QUERY';
    return this.callWorkerOk<{ rows: (BrowsingLogEntry & { rank: number })[]; total: number }, QuerySearchResult>(
      workerType,
      q,
      (result) => ({ success: true, rows: result.rows as (BrowsingLogEntry & { rank: number })[], total: result.total }),
    );
  }

  async update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>> {
    return this.callWorkerOk<unknown, MutationResult>('UPDATE', { id, changes }, () => ({ success: true }));
  }

  async delete(id: number): Promise<BackendOrError<MutationResult>> {
    return this.callWorkerOk<unknown, MutationResult>('DELETE', { id }, () => ({ success: true }));
  }

  async toggleStar(id: number): Promise<BackendOrError<StarResult>> {
    return this.callWorkerOk<{ is_starred: number }, StarResult>('TOGGLE_STAR', { id }, (result) => ({
      success: true,
      is_starred: result.is_starred,
    }));
  }

  async purgeOldRecords(retentionDays: number, maxRecords: number): Promise<BackendOrError<PurgeResult>> {
    return this.callWorkerOk<{ purged: number }, PurgeResult>('PURGE', { retentionDays, maxRecords }, (result) => ({
      success: true,
      purged: result.purged,
    }));
  }

  async purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> {
    return this.callWorkerOk<{ purged: number }, PurgeResult>(
      'CONTENT_PURGE',
      { retentionDays, maxRecords, includeStarred },
      (result) => ({ success: true, purged: result.purged }),
    );
  }

  async purgeAuditLog(retentionDays?: number | undefined): Promise<BackendOrError<PurgeResult>> {
    return this.callWorkerOk<{ purged: number }, PurgeResult>('AUDIT_LOG_PURGE', { retentionDays }, (result) => ({
      success: true,
      purged: result.purged,
    }));
  }

  async getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>> {
    return this.callWorkerOk<{ count: number }, FtsSizeResult>('FTS_INDEX_SIZE', undefined, (result) => ({
      success: true,
      count: result.count,
    }));
  }

  async backupDb(): Promise<BackendOrError<BackupResult>> {
    return this.callWorkerOk<Uint8Array, BackupResult>('BACKUP', undefined, (data) => ({ success: true, data }));
  }

  declare archivePreview: (cutoffDate: string, cutoffMs: number, includeDeleted: boolean) => Promise<BackendOrError<ArchivePreviewResult>>;
  declare archiveCreate: (params: ArchiveCreateParams) => Promise<BackendOrError<ArchiveCreateResult>>;
  declare archiveCleanup: () => Promise<BackendOrError<ArchiveCleanupResult>>;
  declare archiveExportChunk: (stagingName: string, offset: number, length: number) => Promise<BackendOrError<ArchiveExportChunkResult>>;
  declare archivePrepareIncoming: () => Promise<BackendOrError<ArchivePrepareIncomingResult>>;
  declare archiveRestorePreview: (stagingName: string) => Promise<BackendOrError<ArchiveRestorePreviewResult>>;
  declare archiveRestore: (stagingName: string) => Promise<BackendOrError<ArchiveRestoreResult>>;
  declare archiveDeleteByStaging: (stagingName: string) => Promise<BackendOrError<ArchiveDeleteByStagingResult>>;
  declare archiveOpen: (stagingName: string) => Promise<BackendOrError<ArchiveOpenResult>>;
  declare archiveQuery: (stagingName: string, query: string, limit: number, offset: number) => Promise<BackendOrError<ArchiveQueryResult>>;
  declare archiveUpdate: (stagingName: string, id: number, changes: Record<string, unknown>) => Promise<BackendOrError<ArchiveUpdateResult>>;
  declare archiveSave: (stagingName: string) => Promise<BackendOrError<ArchiveSaveResult>>;
  declare archiveClose: (stagingName: string) => Promise<BackendOrError<ArchiveCloseResult>>;
  declare archiveStatus: () => Promise<BackendOrError<ArchiveStatusResult>>;

  /**
   * Descriptor-loop install (PBI 2026-10-16-08): every archive proxy is the
   * same shape — pack positional args, proxyArchive through the descriptor —
   * so the 14 methods are installed from ARCHIVE_DESCRIPTORS ×
   * ARCHIVE_BACKEND_PACKS instead of hand-written. The `declare` fields above
   * keep the precise per-op public signatures (call sites stay type-checked;
   * cf. the deliberate hand-written delegates in
   * background/handlers/dashboardSqlite/deps.ts which keep theirs for the same
   * reason) while the runtime comes from this loop. A missing pack throws at
   * class-definition time, before any instance exists.
   */
  static {
    for (const op of Object.keys(ARCHIVE_DESCRIPTORS) as ArchiveOpType[]) {
      const descriptor = ARCHIVE_DESCRIPTORS[op];
      const pack = (ARCHIVE_BACKEND_PACKS as Record<string, (...args: never[]) => unknown>)[
        descriptor.backendMethod
      ];
      if (typeof pack !== 'function') {
        throw new Error(`OpfsWorkerBackend: missing archive pack for ${descriptor.backendMethod}`);
      }
      (OpfsWorkerBackend.prototype as unknown as Record<string, (...args: never[]) => Promise<unknown>>)[
        descriptor.backendMethod
      ] = async function (this: OpfsWorkerBackend, ...args: never[]): Promise<unknown> {
        return this.proxyArchive(descriptor, pack(...args));
      };
    }
  }

  async restoreDb(data: Uint8Array): Promise<BackendOrError<MutationResult>> {
    const result = await this.callWorker<{ restored: boolean }>('RESTORE', { data });
    if (result && result.restored) return { success: true };
    return { success: false, error: 'Binary restore failed' };
  }

  async healthCheck(): Promise<BackendOrError<HealthResult>> {
    const result = await this.callWorker<{ ok: boolean }>('HEALTH_CHECK');
    if (result !== null && result.ok) return { success: true };
    return { success: false, error: 'Health check failed' };
  }

  async getStatus(): Promise<BackendOrError<StatusResult>> {
    return this.callWorkerOk<StatusResult, StatusResult>('STATUS', undefined, (result) => result);
  }

  async insertAuditLog(record: AuditLogRecord): Promise<BackendOrError<InsertResult>> {
    return this.callWorkerOk<{ id: number }, InsertResult>('AUDIT_LOG_INSERT', record, (result) => ({ success: true, id: result.id }));
  }

  async queryAuditLog(options: { limit?: number; offset?: number }): Promise<BackendOrError<AuditLogQueryResult>> {
    return this.callWorkerOk<{ rows: AuditLogRecord[]; total: number }, AuditLogQueryResult>(
      'AUDIT_LOG_QUERY',
      options,
      (result) => ({ success: true, rows: result.rows as AuditLogEntry[], total: result.total }),
    );
  }

  async serialize(): Promise<BackendOrError<SerializeResult>> {
    // PBI 2026-09-12-22: the worker handler now returns the shared envelope
    // (was a bare array over 13 hand-mapped columns).
    return this.callWorkerOk<Uint8Array, SerializeResult>('SERIALIZE', undefined, (data) => ({ success: true, data }));
  }

  async getCount(): Promise<BackendOrError<CountResult>> {
    return this.callWorkerOk<{ count: number }, CountResult>('GET_COUNT', undefined, (result) => ({
      success: true,
      count: result.count,
    }));
  }

  async clearAll(): Promise<BackendOrError<MutationResult>> {
    return this.callWorkerOk<unknown, MutationResult>('CLEAR_ALL', {}, () => ({ success: true }));
  }
}
