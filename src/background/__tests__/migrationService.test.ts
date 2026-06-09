import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MigrationService } from '../migrationService.js';
import { SqliteClient } from '../sqliteClient.js';

describe('MigrationService', () => {
  let service: MigrationService;
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

    (globalThis as any).chrome = {
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
    service = new MigrationService(sqliteClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips migration when already completed', async () => {
    mockStorage['yasumaro_migration_status'] = 'completed';
    await service.run();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('skips migration for fresh install (no legacy data)', async () => {
    mockStorage['yasumaro_migration_status'] = null;
    // No savedUrlsWithTimestamps in storage
    await service.run();
    expect(mockStorage['yasumaro_migration_status']).toBe('fresh_install');
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('migrates legacy data to SQLite', async () => {
    mockStorage['savedUrlsWithTimestamps'] = [
      { url: 'https://example.com/1', timestamp: 1000 },
      { url: 'https://example.com/2', timestamp: 2000 },
    ];

    sendMessageMock.mockImplementation(
      (_msg: unknown, callback: (response: unknown) => void) => {
        callback({ success: true, id: 1 });
      }
    );

    await service.run();

    // Should insert 2 records
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(mockStorage['yasumaro_migration_status']).toBe('completed');
  });

  it('handles empty legacy data gracefully', async () => {
    mockStorage['savedUrlsWithTimestamps'] = [];

    await service.run();

    expect(mockStorage['yasumaro_migration_status']).toBe('fresh_install');
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('resumes from progress after interruption', async () => {
    mockStorage['savedUrlsWithTimestamps'] = [
      { url: 'https://example.com/1', timestamp: 1000 },
      { url: 'https://example.com/2', timestamp: 2000 },
      { url: 'https://example.com/3', timestamp: 3000 },
      { url: 'https://example.com/4', timestamp: 4000 },
    ];
    // Simulate 2 already migrated
    mockStorage['yasumaro_migration_progress'] = 2;

    let callCount = 0;
    sendMessageMock.mockImplementation(
      (_msg: unknown, callback: (response: unknown) => void) => {
        callCount++;
        callback({ success: true, id: callCount });
      }
    );

    await service.run();

    // Should only migrate remaining 2
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(mockStorage['yasumaro_migration_status']).toBe('completed');
  });

  it('continues on insert failure, does not mark as completed', async () => {
    mockStorage['savedUrlsWithTimestamps'] = [
      { url: 'https://example.com/1', timestamp: 1000 },
    ];

    // First call fails, second succeeds (for progress save)
    let callIndex = 0;
    sendMessageMock.mockImplementation(
      (_msg: unknown, callback: (response: unknown) => void) => {
        callIndex++;
        if (callIndex === 1) {
          callback({ success: false, error: 'Insert failed' });
        } else {
          // This is the progress save check
          callback({ success: true, id: 1 });
        }
      }
    );

    await service.run();

    // Should not mark as completed since insert failed
    expect(mockStorage['yasumaro_migration_status']).not.toBe('completed');
    // Progress should still be saved
    expect(mockStorage['yasumaro_migration_progress']).toBe(1);
  });
});
