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
 */
export class ChromeMigrationStateAdapter implements MigrationStatePort {
  constructor(private readonly port: StoragePort = new ChromeStoragePort()) {}

  async getStatus(): Promise<MigrationStatus | null> {
    const result = await this.port.get(MIGRATION_STATUS_KEY);
    return (result[MIGRATION_STATUS_KEY] as MigrationStatus) || null;
  }

  async setStatus(status: MigrationStatus): Promise<void> {
    await this.port.set({ [MIGRATION_STATUS_KEY]: status });
  }

  async getProgress(): Promise<number> {
    const result = await this.port.get(MIGRATION_PROGRESS_KEY);
    return (result[MIGRATION_PROGRESS_KEY] as number) || 0;
  }

  async setProgress(count: number): Promise<void> {
    await this.port.set({ [MIGRATION_PROGRESS_KEY]: count });
  }

  async getRetryCount(): Promise<number> {
    const result = await this.port.get(MIGRATION_RETRY_COUNT_KEY);
    return (result[MIGRATION_RETRY_COUNT_KEY] as number) || 0;
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
