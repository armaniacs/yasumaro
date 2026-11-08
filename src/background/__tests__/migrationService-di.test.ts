import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MigrationService } from '../migrationService.js';
import { InMemoryMigrationStateAdapter } from '../migration/migrationState.js';
import { SqliteClient } from '../sqlite/offscreenGateway.js';

describe('MigrationService state injection', () => {
  let sqliteClient: SqliteClient;
  let sendMessageMock: ReturnType<typeof vi.fn>;
  let mockStorage: Record<string, unknown>;

  beforeEach(() => {
    sendMessageMock = vi.fn();
    mockStorage = {};
    const storageGetMock = vi.fn().mockImplementation((keys: string | string[] | Record<string, unknown> | null) => {
      if (keys === null) return Promise.resolve(mockStorage);
      if (typeof keys === 'string') {
        const val = mockStorage[keys];
        return Promise.resolve({ [keys]: val ?? undefined });
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const k of keys) {
          result[k] = mockStorage[k];
        }
        return Promise.resolve(result);
      }
      return Promise.resolve({});
    });
    const storageSetMock = vi.fn().mockImplementation((items: Record<string, unknown>) => {
      Object.assign(mockStorage, items);
      return Promise.resolve();
    });
    const storageRemoveMock = vi.fn().mockImplementation((_keys: string | string[]) => {
      return Promise.resolve();
    });

    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        sendMessage: sendMessageMock,
        lastError: undefined,
      },
      offscreen: {
        hasDocument: vi.fn().mockResolvedValue(true),
        createDocument: vi.fn().mockResolvedValue(undefined),
        Reason: { WORKERS: 'WORKERS' },
      },
      storage: {
        local: {
          get: storageGetMock,
          set: storageSetMock,
          remove: storageRemoveMock,
        },
      },
    };

    sqliteClient = new SqliteClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('persists status through the injected adapter instead of chrome.storage', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://example.com/1', timestamp: 1000 },
        { url: 'https://example.com/2', timestamp: 2000 },
      ];
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true, count: 2 });
        }
      );
      const injected = new InMemoryMigrationStateAdapter();
      const service = new MigrationService(sqliteClient, injected);

      await service.run();

      expect(await injected.getStatus()).toBe('completed');
      expect(mockStorage['yasumaro_migration_status']).toBeUndefined();
    });

    it('keeps the default chrome-backed adapter when no state is injected', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://example.com/1', timestamp: 1000 },
      ];
      sendMessageMock.mockImplementation(
        (_msg: unknown, callback: (response: unknown) => void) => {
          callback({ success: true, count: 1 });
        }
      );
      const service = new MigrationService(sqliteClient);

      await service.run();

      expect(mockStorage['yasumaro_migration_status']).toBe('completed');
    });

    it('does not run a full re-migration when the stored status is corrupted', async () => {
      mockStorage['yasumaro_migration_status'] = 'bogus-status';
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://example.com/1', timestamp: 1000 },
      ];
      const service = new MigrationService(sqliteClient);

      await service.run();

      expect(sendMessageMock).not.toHaveBeenCalled();
      expect(mockStorage['yasumaro_migration_status']).toBe('bogus-status');
      expect(mockStorage['yasumaro_migration_retry_count']).toBe(1);
    });
  });
});
