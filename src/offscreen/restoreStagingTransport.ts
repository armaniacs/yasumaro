/**
 * restoreStagingTransport.ts
 * Dedicated seam for the 4 chunked restore staging operations
 * (prepareIncoming/append/commit/abort).
 *
 * These lived on StorageBackend's Mutable facet, forcing every adapter to
 * carry 4 byte-identical unsupported stubs even though only
 * OpfsWorkerBackend implements them. They now live here, applying the
 * archive precedent (archiveStaging.ts):
 *
 * - `RestoreStagingTransport` is the interface OpfsWorkerBackend implements.
 * - `supportsRestoreStaging()` narrows a StorageBackend to it.
 * - Non-OPFS backends expose NO restore staging methods; the delegation in
 *   recordsRepo fails closed with RESTORE_STAGING_UNSUPPORTED_ERROR.
 *
 * Invariant (do not break):
 * - Wire wording and result shapes are unchanged — the fail-closed response
 *   is the same error the per-adapter stubs used to return, and the commit
 *   handler's destructive swap containment stays inside the narrowed
 *   (OPFS-only) path.
 */

import type {
  BackendOrError,
  MutationResult,
  RestorePrepareResult,
  RestoreAppendResult,
  StorageBackend,
} from './StorageBackend.js';
import { OpfsWorkerBackend } from './OpfsWorkerBackend.js';

/**
 * Chunked restore staging session. begin issues a registered
 * `restore_incoming_` staging name, append writes one chunk at its byte
 * offset, commit validates the assembled staging and swaps it in for the
 * live DB, abort discards the staging. The staging name travels with every
 * call — no session state lives in callers or the backend.
 */
export interface RestoreStagingTransport {
  restorePrepareIncoming(totalBytes: number, totalChunks: number): Promise<BackendOrError<RestorePrepareResult>>;
  restoreAppend(stagingName: string, offset: number, data: Uint8Array): Promise<BackendOrError<RestoreAppendResult>>;
  restoreCommit(stagingName: string, totalBytes: number): Promise<BackendOrError<MutationResult>>;
  restoreAbort(stagingName: string): Promise<BackendOrError<MutationResult>>;
}

/**
 * Narrow a StorageBackend to RestoreStagingTransport. A single rule —
 * `b instanceof OpfsWorkerBackend` — following the archive precedent's
 * one-owner capability check: OpfsWorkerBackend implements the whole
 * interface, the other adapters implement none of it.
 */
export function supportsRestoreStaging(
  backend: StorageBackend,
): backend is StorageBackend & RestoreStagingTransport {
  return backend instanceof OpfsWorkerBackend;
}
