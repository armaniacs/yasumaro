/**
 * migrationService.ts
 * Backward-compatible facade for the migration module.
 *
 * The actual implementation has been split into:
 * - migration/legacyMigration.ts — Legacy chrome.storage → SQLite migration
 * - migration/opfsRecovery.ts — OPFS fallback → SQLite recovery
 * - migration/migrationState.ts — Storage adapter for state persistence
 *
 * This file re-exports the public API so existing consumers
 * (deferredMigrations.ts, dashboardSqliteWiring.ts, test files)
 * continue to work without import changes.
 *
 * PBI: 2026-08-22-01 (MigrationService split)
 */

import { SqliteClient } from './sqliteClient.js';
import { ChromeMigrationStateAdapter } from './migration/migrationState.js';
import { LegacyMigrationService } from './migration/legacyMigration.js';
import { OpfsRecoveryService } from './migration/opfsRecovery.js';

export type { LegacyUrlEntry } from './migration/legacyMigration.js';
export { mapLegacyEntryToRecord } from './migration/legacyMigration.js';

/**
 * MigrationService — backward-compatible class that composes
 * LegacyMigrationService and OpfsRecoveryService under the same API.
 *
 * Existing consumers call:
 *   new MigrationService(sqliteClient).run()
 *   new MigrationService(sqliteClient).needsOpfsRecoveryMigration()
 *   new MigrationService(sqliteClient).migrateOpfsRecovery()
 *   new MigrationService(sqliteClient).backfillDiagnosticMetadata()
 *   new MigrationService(sqliteClient).cleanupLegacyStorage()
 */
export class MigrationService {
  private readonly legacy: LegacyMigrationService;
  private readonly opfs: OpfsRecoveryService;

  constructor(sqliteClient: SqliteClient) {
    const state = new ChromeMigrationStateAdapter();
    this.legacy = new LegacyMigrationService(sqliteClient, state);
    this.opfs = new OpfsRecoveryService(sqliteClient);
  }

  /** Run legacy chrome.storage → SQLite migration */
  run(): Promise<void> {
    return this.legacy.run();
  }

  /** Backfill diagnostic metadata for already-migrated entries */
  backfillDiagnosticMetadata(): Promise<{ updated: number; total: number }> {
    return this.legacy.backfillDiagnosticMetadata();
  }

  /** Remove legacy chrome.storage keys (destructive, user-confirmed) */
  cleanupLegacyStorage(): Promise<{ removed: string[]; totalBytes: number }> {
    return this.legacy.cleanupLegacyStorage();
  }

  /** Check if OPFS fallback → SQLite recovery is needed */
  needsOpfsRecoveryMigration(): Promise<boolean> {
    return this.opfs.needsMigration();
  }

  /** Migrate OPFS fallback data to SQLite */
  migrateOpfsRecovery(): Promise<{ success: boolean; migrated: number; error?: string }> {
    return this.opfs.migrate();
  }
}
