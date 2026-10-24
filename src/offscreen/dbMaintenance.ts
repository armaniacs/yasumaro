/**
 * dbMaintenance.ts
 * Backward-compatible re-export shim (PBI: fold thin delegation trio).
 *
 * The maintenance operations (retention purging, binary backup/restore,
 * health check) now live in the single SQLite secondary-store module
 * (recordsRepo.ts). This file re-exports them so existing importers keep
 * working with unchanged results.
 */

export * from './recordsRepo.js';

/**
 * Backup shape query re-export (PBI 2026-10-24-06): importers that reach the
 * binary backup through this legacy path get the single select/dispatch
 * interface from the same place. The query itself lives in StorageBackend.
 */
export {
  capabilitiesFromFlags,
  capabilitiesForBackend,
  hasArchiveCapability,
  resolveBackupShape,
  restoreTargetForShape,
  classifyBackupPayload,
} from './StorageBackend.js';
export type {
  BackupShape,
  BackupKind,
  BackupWants,
  BackupCapabilities,
  BackupRestoreTarget,
  BackupPayloadFields,
} from './StorageBackend.js';
