/**
 * opfsMigrationV2.ts
 * Orchestrator: migrate old AccessHandlePoolVFS db (wa-sqlite) to new OPFSCoopSyncVFS db.
 *
 * All I/O is dependency-injected so this module is fully unit-testable
 * without any OPFS or wa-sqlite infrastructure.
 */

import { errorMessage } from '../utils/errorUtils.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MigrationDeps {
  /** Returns true if migration has already been completed. */
  isMigrationDone(): Promise<boolean>;
  /** Persists the "migration done" flag. */
  setMigrationDone(): Promise<void>;
  /** Reads all rows from the OLD (AccessHandlePoolVFS) database. Returns [] if absent. */
  readOldRecords(): Promise<BrowsingLogRecord[]>;
  /** Inserts records into the NEW database, returning the number actually inserted. */
  insertBatch(records: BrowsingLogRecord[]): Promise<{ count: number }>;
  /** Removes the old OPFS directory/file so it cannot be processed again. */
  deleteOldDb(): Promise<void>;
}

export interface MigrationResult {
  /** Number of records migrated (0 when skipped or empty). */
  migrated: number;
  /** True when migration was skipped because it was already done. */
  skipped: boolean;
  /** Present only when an error prevented migration. */
  error?: string;
}

/**
 * Orchestrates a one-time migration from the old wa-sqlite AccessHandlePoolVFS
 * database to the new @subframe7536/sqlite-wasm OPFSCoopSyncVFS database.
 *
 * Idempotent: subsequent calls are no-ops once the done flag is set.
 * On failure, the done flag is NOT set so the migration retries on next init.
 */
export async function migrateOldOpfsDb(deps: MigrationDeps): Promise<MigrationResult> {
  try {
    if (await deps.isMigrationDone()) {
      return { migrated: 0, skipped: true };
    }

    const records = await deps.readOldRecords();

    if (records.length === 0) {
      await deps.setMigrationDone();
      return { migrated: 0, skipped: false };
    }

    const { count } = await deps.insertBatch(records);
    await deps.deleteOldDb();
    await deps.setMigrationDone();

    return { migrated: count, skipped: false };
  } catch (err) {
    // Do NOT set the done flag — allow retry on next init.
    return { migrated: 0, skipped: false, error: errorMessage(err) };
  }
}
