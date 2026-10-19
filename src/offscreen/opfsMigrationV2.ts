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
  /**
   * Inserts records into the NEW database. `count` is the number of rows this
   * call claims to have inserted; `skipped` (optional) is the number of rows
   * ignored because their (url, created_at) key already exists in the NEW db.
   * A duplicate skip is NOT a failure — the row's data is already in the NEW db.
   */
  insertBatch(records: BrowsingLogRecord[]): Promise<{ count: number; skipped?: number }>;
  /**
   * Reads the current total row count of the NEW database (entity verification,
   * same discipline as sqliteEngineContext/migrationBackup.ts: the orchestrator
   * must not trust insertBatch's self-reported count).
   */
  countNewDbRecords(): Promise<number>;
  /**
   * Removes the old OPFS directory/file so it cannot be processed again.
   * NOTE: the production implementation (deleteOldDbFile in
   * opfsMigrationV2Reader.ts) swallows every error and never throws — the
   * throwing path here is a test-only escape hatch.
   */
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
 * Completion — and with it discarding the safety net (deleteOldDb +
 * setMigrationDone) — requires verification: every row read from the old db
 * must be accounted for (inserted-claimed or duplicate-skipped) AND the NEW
 * db must hold at least the claimed inserts. On failure or mismatch the done
 * flag is NOT set so the migration retries on next init, and the old db is
 * preserved (the data it holds is the last restore opportunity).
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

    const { count, skipped = 0 } = await deps.insertBatch(records);

    // Verify before discarding the safety net (same discipline as
    // sqliteEngineContext/migrationBackup.ts). Both partial-failure modes of
    // insertBatch return a "success shape" WITHOUT throwing:
    // - per-row errors are swallowed by the INSERT OR IGNORE handler, so
    //   count + skipped < records.length means rows were neither inserted
    //   nor duplicate-skipped;
    // - the inserted counter survives a ROLLBACK, so count can be
    //   over-reported while nothing persisted — the NEW db row count must
    //   cover the claim.
    // On either mismatch the old db is KEPT and the done flag is NOT set, so
    // the migration retries on the next init.
    const newDbCount = await deps.countNewDbRecords();
    if (count + skipped !== records.length || newDbCount < count) {
      return {
        migrated: 0,
        skipped: false,
        error: `V2 migration incomplete: old rows=${records.length}, reported inserted=${count} skipped=${skipped}, new db rows=${newDbCount}`,
      };
    }

    await deps.deleteOldDb();
    await deps.setMigrationDone();

    return { migrated: count, skipped: false };
  } catch (err) {
    // Do NOT set the done flag — allow retry on next init.
    return { migrated: 0, skipped: false, error: errorMessage(err) };
  }
}
