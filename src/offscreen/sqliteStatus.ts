/**
 * sqliteStatus.ts (PBI 2026-09-11-06) — single owner of the STATUS enrichment.
 *
 * "What can a STATUS response contain, and where does each field come from?"
 * is answered here: the base shape comes from the active backend
 * (recordsRepo.getStatus), and the migration extras (flags + legacy-DB
 * existence probes) are collected below. The legacy storage-location names
 * live in sqliteMessages.ts — they are part of the STATUS message contract
 * that both hops (offscreen handler and dashboard decode) reference, so a
 * rename is a compile-time change instead of a comment-enforced one.
 *
 * Enrichment is field-isolated: a failing storage read or probe contributes
 * nothing instead of discarding all extras (the previous single Promise.all
 * was fail-whole).
 */

import { StorageKeys } from '../utils/storage/types.js';
import {
  type SqliteStatusExtras,
  LEGACY_OPFS_POOL_DIR,
  LEGACY_OPFS_DB_FILENAME,
  LEGACY_IDB_NAME,
} from '../messaging/sqliteMessages.js';

/**
 * Migration extras carried on a STATUS response (all optional — a field the
 * collector could not fill is simply absent, never silently defaulted).
 * PBI 2026-09-11-03 (round 5): this is a slice of the shared SqliteStatusExtras
 * contract (sqliteMessages.ts) — the collector fills the migration-related
 * subset; fts5/initError/compileOptions come from the backend's base status.
 */
export type SqliteMigrationExtras = Pick<
  SqliteStatusExtras,
  'opfsMigrationV2Done' | 'opfsMigrationV2LastAttemptedAt' | 'opfsMigrationV2CompletedAt' | 'opfsMigrationV2RecordCount' | 'idbMigrationV2Done' | 'opfsLegacyDbPath' | 'idbLegacyDbName'
>;

/** OPFS has no path API — only directory/file existence can be checked. */
async function probeLegacyOpfsDb(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(LEGACY_OPFS_POOL_DIR, { create: false });
    await dir.getFileHandle(LEGACY_OPFS_DB_FILENAME, { create: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true/false when the presence could be determined; null when the
 * environment does not implement indexedDB.databases() (then the field is
 * omitted downstream instead of asserting "no legacy DB" — asserting absence
 * from a missing probe would make the diagnostics panel report
 * "Not applicable" on browsers without the API).
 */
async function probeLegacyIdbDb(): Promise<boolean | null> {
  try {
    if (typeof indexedDB.databases !== 'function') return null;
    const databases = await indexedDB.databases();
    return databases.some((d) => d.name === LEGACY_IDB_NAME);
  } catch {
    return false;
  }
}

/** Collect the migration extras with per-field isolation (allSettled). */
export async function collectMigrationExtras(): Promise<SqliteMigrationExtras> {
  const [storageResult, opfsProbe, idbProbe] = await Promise.allSettled([
    chrome.storage.local.get([
      StorageKeys.OPFS_MIGRATION_V2_DONE,
      StorageKeys.OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT,
      StorageKeys.OPFS_MIGRATION_V2_COMPLETED_AT,
      StorageKeys.OPFS_MIGRATION_V2_RECORD_COUNT,
      StorageKeys.IDB_MIGRATION_V2_DONE,
    ]),
    probeLegacyOpfsDb(),
    probeLegacyIdbDb(),
  ]);

  const extras: SqliteMigrationExtras = {};

  if (storageResult.status === 'fulfilled') {
    const items = storageResult.value as Record<string, unknown>;
    extras.opfsMigrationV2Done = (items[StorageKeys.OPFS_MIGRATION_V2_DONE] as boolean | undefined) ?? false;
    extras.opfsMigrationV2LastAttemptedAt = (items[StorageKeys.OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT] as string | null | undefined) ?? null;
    extras.opfsMigrationV2CompletedAt = (items[StorageKeys.OPFS_MIGRATION_V2_COMPLETED_AT] as string | null | undefined) ?? null;
    extras.opfsMigrationV2RecordCount = (items[StorageKeys.OPFS_MIGRATION_V2_RECORD_COUNT] as number | null | undefined) ?? null;
    extras.idbMigrationV2Done = (items[StorageKeys.IDB_MIGRATION_V2_DONE] as boolean | undefined) ?? false;
  }

  if (opfsProbe.status === 'fulfilled' && opfsProbe.value) {
    extras.opfsLegacyDbPath = `${LEGACY_OPFS_POOL_DIR}/${LEGACY_OPFS_DB_FILENAME}`;
  } else if (opfsProbe.status === 'fulfilled') {
    // Probe ran and confirmed absence — explicit null ("Not applicable" in the panel).
    extras.opfsLegacyDbPath = null;
  }
  // rejected probe → omit: the panel treats a missing value as "not confirmed
  // absent", which is the safe direction (Pending instead of Not applicable).

  if (idbProbe.status === 'fulfilled') {
    if (idbProbe.value === true) extras.idbLegacyDbName = LEGACY_IDB_NAME;
    else if (idbProbe.value === false) extras.idbLegacyDbName = null;
    // null (API unsupported) → omit, same safe direction as above.
  }

  return extras;
}
