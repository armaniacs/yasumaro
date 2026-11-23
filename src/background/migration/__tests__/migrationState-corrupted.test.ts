import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ChromeMigrationStateAdapter,
  MIGRATION_STATUS_KEY,
  MIGRATION_PROGRESS_KEY,
  MIGRATION_RETRY_COUNT_KEY,
} from '../migrationState.js';
import { InMemoryStoragePort } from '../../../utils/storage/storagePort.js';
import { LogType } from '../../../utils/logger/types.js';

const mockAddLog = vi.hoisted(() => vi.fn());

// The self-heal path logs a WARN; the real logger buffers into
// chrome.storage, so replace it with a spy like sessionStore.test.ts does.
vi.mock('../../../utils/logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: mockAddLog,
  }),
);

describe('migrationState corrupted values', () => {
  let port: InMemoryStoragePort;
  let adapter: ChromeMigrationStateAdapter;

  beforeEach(() => {
    port = new InMemoryStoragePort();
    adapter = new ChromeMigrationStateAdapter(port);
    mockAddLog.mockClear();
  });

  describe('getStatus', () => {
    it('returns null when the key is absent', async () => {
      expect(await adapter.getStatus()).toBeNull();
    });

    it('returns valid status values unchanged', async () => {
      port.seed({ [MIGRATION_STATUS_KEY]: 'completed' });
      expect(await adapter.getStatus()).toBe('completed');
    });

    it('self-heals an unknown status string to absent and removes the key so the migration re-runs', async () => {
      port.seed({ [MIGRATION_STATUS_KEY]: 'done' });
      await expect(adapter.getStatus()).resolves.toBeNull();
      expect(port.dump()[MIGRATION_STATUS_KEY]).toBeUndefined();
      expect(mockAddLog).toHaveBeenCalledWith(
        LogType.WARN,
        expect.stringContaining('self-healing'),
        expect.objectContaining({ key: MIGRATION_STATUS_KEY }),
      );
    });

    it('self-heals a non-string status value to absent', async () => {
      port.seed({ [MIGRATION_STATUS_KEY]: 42 });
      await expect(adapter.getStatus()).resolves.toBeNull();
      expect(port.dump()[MIGRATION_STATUS_KEY]).toBeUndefined();
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

    it('self-heals a string value to 0 so the migration restarts idempotently', async () => {
      port.seed({ [MIGRATION_PROGRESS_KEY]: '7' });
      await expect(adapter.getProgress()).resolves.toBe(0);
      expect(port.dump()[MIGRATION_PROGRESS_KEY]).toBeUndefined();
      expect(mockAddLog).toHaveBeenCalledWith(
        LogType.WARN,
        expect.stringContaining('self-healing'),
        expect.objectContaining({ key: MIGRATION_PROGRESS_KEY }),
      );
    });

    it('self-heals a negative value to 0', async () => {
      port.seed({ [MIGRATION_PROGRESS_KEY]: -1 });
      await expect(adapter.getProgress()).resolves.toBe(0);
    });

    it('self-heals a non-integer value to 0', async () => {
      port.seed({ [MIGRATION_PROGRESS_KEY]: 1.5 });
      await expect(adapter.getProgress()).resolves.toBe(0);
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

    it('self-heals a non-numeric value to 0', async () => {
      port.seed({ [MIGRATION_RETRY_COUNT_KEY]: 'many' });
      await expect(adapter.getRetryCount()).resolves.toBe(0);
      expect(port.dump()[MIGRATION_RETRY_COUNT_KEY]).toBeUndefined();
      expect(mockAddLog).toHaveBeenCalledWith(
        LogType.WARN,
        expect.stringContaining('self-healing'),
        expect.objectContaining({ key: MIGRATION_RETRY_COUNT_KEY }),
      );
    });
  });
});
