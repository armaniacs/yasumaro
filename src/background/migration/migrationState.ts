/**
 * migrationState.ts
 * Storage adapter for MigrationService state (status/progress/retryCount).
 * Extracted from migrationService.ts (PBI 2026-08-22-01).
 *
 * Production uses ChromeMigrationStateAdapter (chrome.storage.local).
 * Tests can inject InMemoryMigrationStateAdapter for isolation.
 */

import { StorageKeys } from '../../utils/storage/types.js';
import { ChromeStoragePort, type StoragePort } from '../../utils/storage/storagePort.js';
import { LogType } from '../../utils/logger/types.js';
import { addLog } from '../../utils/logger/core.js';
import { errorMessage } from '../../utils/errorUtils.js';

export type MigrationStatus = 'pending' | 'completed' | 'fresh_install' | 'failed_permanently';

/**
 * Port for persisting migration state. Production uses chrome.storage.local;
 * tests can inject an in-memory implementation.
 */
export interface MigrationStatePort {
  getStatus(): Promise<MigrationStatus | null>;
  setStatus(status: MigrationStatus): Promise<void>;
  getProgress(): Promise<number>;
  setProgress(count: number): Promise<void>;
  getRetryCount(): Promise<number>;
  setRetryCount(count: number): Promise<void>;
}

export const MIGRATION_STATUS_KEY = StorageKeys.YASUMARO_MIGRATION_STATUS;
export const MIGRATION_PROGRESS_KEY = StorageKeys.YASUMARO_MIGRATION_PROGRESS;
export const MIGRATION_RETRY_COUNT_KEY = StorageKeys.YASUMARO_MIGRATION_RETRY_COUNT;

/**
 * Chrome storage adapter for migration state.
 * Delegates each accessor to the StoragePort seam (PBI 2026-11-07-04):
 * same keys, same value shapes — the raw chrome.storage.local access lives
 * in ChromeStoragePort only. Pass a StoragePort (e.g. InMemoryStoragePort)
 * in tests to avoid chrome.
 *
 * Corrupted-value policy (fail-soft, not fail-closed): a value that is
 * neither absent nor in the valid shape is self-healed to absent
 * (unmigrated) with a WARN log, and the stored key is removed best-effort so
 * the next LegacyMigrationService.run() re-migrates from scratch. Throwing
 * here would be fail-permanent: run() funnels every getStatus/getProgress/
 * getRetryCount throw into recordFailureAndMaybeGiveUp, so an unrestorable
 * typo would burn the retry budget and end in `failed_permanently` — a
 * legitimate stuck migration the user must clear by hand. By contrast a
 * re-run is safe (idempotent): insertBatch is INSERT OR IGNORE (duplicate
 * rows surface as `skipped`, never as double rows), progress restarts at 0,
 * and `completed`/`fresh_install` short-circuit before any write. The only
 * terminal state therefore stays the explicit `failed_permanently` that the
 * retry budget owns — no quarantine path is needed because a healed re-run
 * cannot corrupt data that a dusted retry loop could leave behind.
 */
export class ChromeMigrationStateAdapter implements MigrationStatePort {
  constructor(private readonly port: StoragePort = new ChromeStoragePort()) {}

  /**
   * Best-effort repair of a corrupted migration-state key: log the shape
   * violation loudly (WARN — a human tampered value or a past writer bug is
   * worth a timeline entry), then remove the key so the state reads as
   * absent. Removal itself is best-effort: a port without remove() (or a
   * failing one) still heals the read — the re-migration overwrites the key
   * with a valid value on its next setStatus/setProgress/setRetryCount.
   */
  private async healCorruptedKey(key: string, raw: unknown): Promise<void> {
    await addLog(LogType.WARN, 'Migration state corrupted, self-healing to absent and re-running migration', {
      key,
      rawType: typeof raw,
    });
    try {
      await this.port.remove?.(key);
    } catch (error) {
      await addLog(LogType.WARN, 'Migration state self-heal could not remove the corrupted key; the re-migration will overwrite it', {
        key,
        error: errorMessage(error),
      });
    }
  }

  async getStatus(): Promise<MigrationStatus | null> {
    const result = await this.port.get(MIGRATION_STATUS_KEY);
    const raw = result[MIGRATION_STATUS_KEY];
    if (raw === undefined || raw === null) return null;
    if (
      raw === 'pending' ||
      raw === 'completed' ||
      raw === 'fresh_install' ||
      raw === 'failed_permanently'
    ) {
      return raw;
    }
    await this.healCorruptedKey(MIGRATION_STATUS_KEY, raw);
    return null;
  }

  async setStatus(status: MigrationStatus): Promise<void> {
    await this.port.set({ [MIGRATION_STATUS_KEY]: status });
  }

  async getProgress(): Promise<number> {
    const result = await this.port.get(MIGRATION_PROGRESS_KEY);
    const raw = result[MIGRATION_PROGRESS_KEY];
    if (raw === undefined || raw === null) return 0;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
    await this.healCorruptedKey(MIGRATION_PROGRESS_KEY, raw);
    return 0;
  }

  async setProgress(count: number): Promise<void> {
    await this.port.set({ [MIGRATION_PROGRESS_KEY]: count });
  }

  async getRetryCount(): Promise<number> {
    const result = await this.port.get(MIGRATION_RETRY_COUNT_KEY);
    const raw = result[MIGRATION_RETRY_COUNT_KEY];
    if (raw === undefined || raw === null) return 0;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
    await this.healCorruptedKey(MIGRATION_RETRY_COUNT_KEY, raw);
    return 0;
  }

  async setRetryCount(count: number): Promise<void> {
    await this.port.set({ [MIGRATION_RETRY_COUNT_KEY]: count });
  }
}

/**
 * In-memory adapter for testing. No chrome.storage dependency.
 */
export class InMemoryMigrationStateAdapter implements MigrationStatePort {
  private status: MigrationStatus | null = null;
  private progress = 0;
  private retryCount = 0;

  async getStatus(): Promise<MigrationStatus | null> { return this.status; }
  async setStatus(status: MigrationStatus): Promise<void> { this.status = status; }
  async getProgress(): Promise<number> { return this.progress; }
  async setProgress(count: number): Promise<void> { this.progress = count; }
  async getRetryCount(): Promise<number> { return this.retryCount; }
  async setRetryCount(count: number): Promise<void> { this.retryCount = count; }
}
