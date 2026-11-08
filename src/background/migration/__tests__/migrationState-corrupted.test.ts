import { describe, it, expect, beforeEach } from 'vitest';
import {
  ChromeMigrationStateAdapter,
  MIGRATION_STATUS_KEY,
  MIGRATION_PROGRESS_KEY,
  MIGRATION_RETRY_COUNT_KEY,
} from '../migrationState.js';
import { InMemoryStoragePort } from '../../../utils/storage/storagePort.js';

describe('migrationState corrupted values', () => {
  let port: InMemoryStoragePort;
  let adapter: ChromeMigrationStateAdapter;

  beforeEach(() => {
    port = new InMemoryStoragePort();
    adapter = new ChromeMigrationStateAdapter(port);
  });

  describe('getStatus', () => {
    it('returns null when the key is absent', async () => {
      expect(await adapter.getStatus()).toBeNull();
    });

    it('returns valid status values unchanged', async () => {
      port.seed({ [MIGRATION_STATUS_KEY]: 'completed' });
      expect(await adapter.getStatus()).toBe('completed');
    });

    it('rejects with a detectable error for an unknown status string', async () => {
      port.seed({ [MIGRATION_STATUS_KEY]: 'done' });
      await expect(adapter.getStatus()).rejects.toThrow(/corrupted/);
    });

    it('rejects with a detectable error for a non-string status value', async () => {
      port.seed({ [MIGRATION_STATUS_KEY]: 42 });
      await expect(adapter.getStatus()).rejects.toThrow(/corrupted/);
    });
  });

  describe('getProgress', () => {
    it('returns 0 when the key is absent', async () => {
      expect(await adapter.getProgress()).toBe(0);
    });

    it('returns a stored non-negative integer unchanged', async () => {
      port.seed({ [MIGRATION_PROGRESS_KEY]: 7 });
      expect(await adapter.getProgress()).toBe(7);
    });

    it('rejects with a detectable error for a string value', async () => {
      port.seed({ [MIGRATION_PROGRESS_KEY]: '7' });
      await expect(adapter.getProgress()).rejects.toThrow(/corrupted/);
    });

    it('rejects with a detectable error for a negative value', async () => {
      port.seed({ [MIGRATION_PROGRESS_KEY]: -1 });
      await expect(adapter.getProgress()).rejects.toThrow(/corrupted/);
    });

    it('rejects with a detectable error for a non-integer value', async () => {
      port.seed({ [MIGRATION_PROGRESS_KEY]: 1.5 });
      await expect(adapter.getProgress()).rejects.toThrow(/corrupted/);
    });
  });

  describe('getRetryCount', () => {
    it('returns 0 when the key is absent', async () => {
      expect(await adapter.getRetryCount()).toBe(0);
    });

    it('returns a stored non-negative integer unchanged', async () => {
      port.seed({ [MIGRATION_RETRY_COUNT_KEY]: 3 });
      expect(await adapter.getRetryCount()).toBe(3);
    });

    it('rejects with a detectable error for a non-numeric value', async () => {
      port.seed({ [MIGRATION_RETRY_COUNT_KEY]: 'many' });
      await expect(adapter.getRetryCount()).rejects.toThrow(/corrupted/);
    });
  });
});
