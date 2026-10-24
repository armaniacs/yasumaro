import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';
import type { ArchiveDescriptor, DescriptorResponse } from '../messaging/archiveWireTable.js';
import { isExportEnvelopePayload } from './exportEnvelope.js';

/**
 * Archive result shapes derive from the wire-table descriptors
 * (PBI 2026-09-09-05): the field set each backend method returns is the
 * descriptor's projected wire set, so the interface cannot drift from the
 * dashboard decode, the background re-projection, or the worker project.
 */
type ArchiveWire<Op extends ArchiveDescriptor['op']> = DescriptorResponse<Extract<ArchiveDescriptor, { op: Op }>>;

export type ArchivePreviewResult = ArchiveWire<'archivePreview'>;
export interface ArchiveCreateParams { cutoffDate: string; cutoffMs: number; includeDeleted: boolean; yasumaroVersion: string }
export type ArchiveCreateResult = ArchiveWire<'archiveCreate'>;
export type ArchiveCleanupResult = ArchiveWire<'archiveCleanup'>;
export type ArchiveExportChunkResult = ArchiveWire<'archiveExport'>;
export type ArchivePrepareIncomingResult = ArchiveWire<'archivePrepareIncoming'>;
export type ArchiveRestorePreviewResult = ArchiveWire<'archiveRestorePreview'>;
export type ArchiveRestoreResult = ArchiveWire<'archiveRestore'>;
export type ArchiveDeleteByStagingResult = ArchiveWire<'archiveDeleteByStaging'>;
export type ArchiveOpenResult = ArchiveWire<'archiveOpen'>;
export type ArchiveQueryResult = ArchiveWire<'archiveQuery'>;
export type ArchiveUpdateResult = ArchiveWire<'archiveUpdate'>;
export type ArchiveSaveResult = ArchiveWire<'archiveSave'>;
export type ArchiveCloseResult = ArchiveWire<'archiveClose'>;
export type ArchiveStatusResult = ArchiveWire<'archiveStatus'>;

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
export interface SerializeResult { success: true; data: Uint8Array }
export interface CountResult { success: true; count: number }
export interface HealthResult { success: true } // healthCheck — success means alive, failure means error
export interface AuditLogQueryResult { success: true; rows: AuditLogEntry[]; total: number }
export type BackendOrError<T> = T | { success: false; error: string };

import type { SqliteStatusExtras } from '../messaging/sqliteMessages.js';

export interface StatusResult extends SqliteStatusExtras {
  initialized: boolean;
  fallback: boolean;
  supportsBinaryBackup: boolean;
  path?: string;
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
  /**
   * JSON export as a Uint8Array (PBI 2026-09-12-22).
   *
   * Every backend MUST return the same envelope — `JSON.stringify(BUILD_EXPORT_ENVELOPE(rows))`
   * over the shared EXPORT_COLUMNS projection — so a caller decoding
   * SQLITE_EXPORT gets one schema regardless of backend. Previously the OPFS
   * worker returned a bare array over 13 columns while IDB/fallback returned
   * the envelope over 11.
   */
  serialize(): Promise<BackendOrError<SerializeResult>>;
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
  /**
   * PBI 2026-09-12-36: `undefined` means "skip this dimension" — the same
   * contract `purgeContent` already had via its `!= null && > 0` guards.
   * Before this, `purgeOldRecords(0, 0)` deleted everything (cutoff = now)
   * while `purgeContent(0, 0)` was a no-op: one plan output, opposite
   * destructive meanings.
   */
  purgeOldRecords(retentionDays?: number | undefined, maxRecords?: number | undefined): Promise<BackendOrError<PurgeResult>>;
  purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>>;
  /**
   * Delete audit-log rows older than the retention window.
   *
   * Age-only by design (audit_log has no starred/deleted columns and no cap),
   * and `undefined` means "skip this dimension" for the same reason
   * purgeOldRecords takes it: there is nothing to purge without a window.
   */
  purgeAuditLog(retentionDays?: number | undefined): Promise<BackendOrError<PurgeResult>>;
  backupDb(): Promise<BackendOrError<BackupResult>>;
  restoreDb(data: Uint8Array): Promise<BackendOrError<MutationResult>>;
  // Archive operations are NOT part of this interface — see ArchiveStaging
  // (archiveStaging.ts), implemented only by OpfsWorkerBackend. The
  // ARCHIVE_DISPATCH layer narrows via supportsArchive() and fails closed.
  insertAuditLog(record: AuditLogRecord): Promise<BackendOrError<InsertResult>>;
  clearAll(): Promise<BackendOrError<MutationResult>>;
}

export interface StorageBackend extends Queryable, Mutable {}

const NOT_INITIALIZED = 'Database not initialized';

// ============================================================================
// Capability policy (PBI 2026-09-11-08, narrowed by 2026-09-11-06): archive /
// binary backup-restore need the OPFS backend; the audit log needs the OPFS
// or IDB engine. Archive rejection now happens in the ARCHIVE_DISPATCH layer
// (sqliteMessageHandlers narrows via supportsArchive() and fails closed with
// ARCHIVE_UNSUPPORTED_ERROR) — adapters carry no archive stubs. The pinned
// acceptance test (archiveFallbackRejection.test.ts) asserts the constant,
// so a wording change is a one-place edit.
// ============================================================================

export const ARCHIVE_UNSUPPORTED_ERROR = 'Archive requires OPFS storage.';
export const BINARY_BACKUP_UNSUPPORTED_ERROR = 'Binary backup requires OPFS storage.';
export const BINARY_RESTORE_UNSUPPORTED_ERROR = 'Binary restore requires OPFS storage.';

// ============================================================================
// Backup shape query (PBI 2026-10-24-06): the single interface that maps
// retire wants plus adapter capability to one of the four backup shapes.
// Codecs stay inside their own seams (envelope projection in exportEnvelope,
// settings generations in settingsBackup, encrypted open/seal in the crypto
// codec, archive wire table in archiveStaging); restore dispatches from the
// shape to those untouched codecs. Archive stays OPFS-exclusive: no fallback
// shape exists for the archive kind, the query returns null instead.
// ============================================================================

/** The four retire shapes callers can receive. */
export type BackupShape = 'binary' | 'envelope' | 'settings' | 'archive';

/** What the retire wants to back up. */
export type BackupKind = 'database' | 'settings' | 'archive';

/** Retire wants: the kind plus the binary preference for database backups. */
export interface BackupWants {
  kind: BackupKind;
  preferBinary?: boolean;
}

/** Adapter capability the shape decision reads. No per-caller re-derivation. */
export interface BackupCapabilities {
  supportsBinaryBackup: boolean;
  supportsArchive: boolean;
}

/** Build capabilities from already-known flags (status + archive probe). */
export function capabilitiesFromFlags(flags: {
  supportsBinaryBackup: boolean;
  supportsArchive: boolean;
}): BackupCapabilities {
  return {
    supportsBinaryBackup: flags.supportsBinaryBackup,
    supportsArchive: flags.supportsArchive,
  };
}

/**
 * Structural probe for the archive seam. This is the single rule behind the
 * archive capability: `supportsArchive` in archiveStaging delegates here so
 * the "all 14 ops travel together, implemented only by OpfsWorkerBackend"
 * invariant has exactly one owner.
 */
export interface ArchiveProbe {
  archiveStatus?: () => Promise<BackendOrError<ArchiveStatusResult>>;
}

/** True when the backend carries the archive seam (OPFS only). */
export function hasArchiveCapability(backend: StorageBackend): boolean {
  return typeof (backend as ArchiveProbe).archiveStatus === 'function';
}

/**
 * Build capabilities from a live backend: the binary flag comes from its
 * async status, the archive flag from the single probe above.
 */
export async function capabilitiesForBackend(backend: StorageBackend): Promise<BackupCapabilities> {
  const status = await backend.getStatus();
  if ('error' in status) {
    return {
      supportsBinaryBackup: false,
      supportsArchive: hasArchiveCapability(backend),
    };
  }
  return {
    supportsBinaryBackup: status.supportsBinaryBackup,
    supportsArchive: hasArchiveCapability(backend),
  };
}

/**
 * Select the retire shape for the wants under the adapter capability.
 * Returns null when no shape satisfies the wants (archive without OPFS):
 * callers fail closed with ARCHIVE_UNSUPPORTED_ERROR instead of silently
 * picking another shape. Database retire prefers the single-step binary
 * payload only when asked and capable, otherwise the JSON envelope that
 * every backend can produce.
 */
export function resolveBackupShape(wants: BackupWants, caps: BackupCapabilities): BackupShape | null {
  if (wants.kind === 'archive') {
    return caps.supportsArchive ? 'archive' : null;
  }
  if (wants.kind === 'settings') {
    return 'settings';
  }
  if (wants.preferBinary === true && caps.supportsBinaryBackup === true) {
    return 'binary';
  }
  return 'envelope';
}

/** Restore entry point per shape. Codecs behind each target are unchanged. */
export type BackupRestoreTarget = 'restoreDb' | 'envelopeImport' | 'settingsImport' | 'archiveRestore';

/** Dispatch restore from the shape (no per-caller shape branching). */
export function restoreTargetForShape(shape: BackupShape): BackupRestoreTarget {
  if (shape === 'binary') {
    return 'restoreDb';
  }
  if (shape === 'archive') {
    return 'archiveRestore';
  }
  if (shape === 'settings') {
    return 'settingsImport';
  }
  return 'envelopeImport';
}

/**
 * Classifiable retire payload fields. Structural on purpose: the binary shape
 * travels as bytes, the archive shape as a staging name, the file shapes as
 * parsed JSON. Each codec module owns its predicate; the shape decision here
 * only orders them.
 */
export interface BackupPayloadFields {
  encrypted?: boolean;
  version?: string | number;
  table?: string;
  settings?: object;
  exportedAt?: string;
}

/**
 * Classify a retire payload back to its shape for restore dispatch.
 * Bytes are always the binary shape (the envelope is classified after JSON
 * parsing, never from raw bytes); staging names are always the archive shape.
 * Settings covers both the plaintext and the encrypted file variants — the
 * encrypted/plaintext split stays inside the settings codec seam.
 */
export function classifyBackupPayload(
  payload: Uint8Array | string | BackupPayloadFields | null | undefined,
): BackupShape | null {
  if (payload === null || payload === undefined) {
    return null;
  }
  if (payload instanceof Uint8Array) {
    return 'binary';
  }
  if (typeof payload === 'string') {
    return 'archive';
  }
  if (payload.encrypted === true) {
    return 'settings';
  }
  if (isExportEnvelopePayload(payload)) {
    return 'envelope';
  }
  if (typeof payload.settings === 'object' && payload.settings !== null) {
    return 'settings';
  }
  return null;
}

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
  async purgeAuditLog() { return this.err(); }
  async getFtsIndexSize() { return this.err(); }
  async backupDb() { return this.err(); }
  async restoreDb() { return this.err(); }
  async healthCheck() { return this.err(); }
  async getStatus() { return this.err(); }
  async insertAuditLog() { return this.err(); }
  async queryAuditLog() { return this.err(); }
  async getCount() { return this.err(); }
  async clearAll() { return this.err(); }
  async serialize() { return this.err(); }
}
