/**
 * archiveStaging.ts
 * Dedicated seam for the 14 archive operations (preview/create/cleanup/
 * export/prepare/restore×2/deleteByStaging/open/query/update/save/close/status).
 *
 * These lived on StorageBackend, forcing every adapter to carry 14 stubs
 * even though only OpfsWorkerBackend implements them. They now live here:
 *
 * - `ArchiveStaging` is the interface OpfsWorkerBackend implements.
 * - `supportsArchive()` narrows a StorageBackend to ArchiveStaging.
 * - Non-staging backends expose NO archive methods; the ARCHIVE_DISPATCH
 *   layer in sqliteMessageHandlers fails closed with ARCHIVE_UNSUPPORTED_ERROR.
 *
 * Invariants (do not break):
 * - Public op names, noRetry contract, and response fields are unchanged
 *   (round 3 archiveWireTable guarantees).
 * - Archive token scope binding (round 4 PBI-01) lives in the worker
 *   handlers, untouched by this move.
 */

import type {
  ArchiveCreateParams,
  ArchivePreviewResult,
  ArchiveCreateResult,
  ArchiveCleanupResult,
  ArchiveExportChunkResult,
  ArchivePrepareIncomingResult,
  ArchiveRestorePreviewResult,
  ArchiveRestoreResult,
  ArchiveDeleteByStagingResult,
  ArchiveOpenResult,
  ArchiveQueryResult,
  ArchiveUpdateResult,
  ArchiveSaveResult,
  ArchiveCloseResult,
  ArchiveStatusResult,
  BackendOrError,
  StorageBackend,
} from './StorageBackend.js';

/** The 14 archive operations, implemented only by the OPFS worker backend. */
export interface ArchiveStaging {
  archivePreview(cutoffDate: string, cutoffMs: number, includeDeleted: boolean): Promise<BackendOrError<ArchivePreviewResult>>;
  archiveCreate(params: ArchiveCreateParams): Promise<BackendOrError<ArchiveCreateResult>>;
  archiveCleanup(): Promise<BackendOrError<ArchiveCleanupResult>>;
  archiveExportChunk(stagingName: string, offset: number, length: number): Promise<BackendOrError<ArchiveExportChunkResult>>;
  archivePrepareIncoming(): Promise<BackendOrError<ArchivePrepareIncomingResult>>;
  archiveRestorePreview(stagingName: string): Promise<BackendOrError<ArchiveRestorePreviewResult>>;
  archiveRestore(stagingName: string): Promise<BackendOrError<ArchiveRestoreResult>>;
  archiveDeleteByStaging(stagingName: string): Promise<BackendOrError<ArchiveDeleteByStagingResult>>;
  archiveOpen(stagingName: string): Promise<BackendOrError<ArchiveOpenResult>>;
  archiveQuery(stagingName: string, query: string, limit: number, offset: number): Promise<BackendOrError<ArchiveQueryResult>>;
  archiveUpdate(stagingName: string, id: number, changes: Record<string, unknown>): Promise<BackendOrError<ArchiveUpdateResult>>;
  archiveSave(stagingName: string): Promise<BackendOrError<ArchiveSaveResult>>;
  archiveClose(stagingName: string): Promise<BackendOrError<ArchiveCloseResult>>;
  archiveStatus(): Promise<BackendOrError<ArchiveStatusResult>>;
}

/**
 * Narrow a StorageBackend to ArchiveStaging. Probes a single method —
 * all 14 travel together (OpfsWorkerBackend implements the whole interface;
 * other adapters implement none).
 */
export function supportsArchive(backend: StorageBackend): backend is StorageBackend & ArchiveStaging {
  return typeof (backend as Partial<ArchiveStaging>).archiveStatus === 'function';
}
