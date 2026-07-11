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
        callback({ success: true, count: 2 });
      }
    );

    await service.run();

    // Should insert batch with 2 records (1 batch call)
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const callArgs = sendMessageMock.mock.calls[0][0];
    expect(callArgs.type).toBe('SQLITE_INSERT_BATCH');
    expect(callArgs.payload.records).toHaveLength(2);
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

    sendMessageMock.mockImplementation(
      (_msg: unknown, callback: (response: unknown) => void) => {
        callback({ success: true, count: 2 });
      }
    );

    await service.run();

    // Should only migrate remaining 2 in 1 batch call
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const callArgs = sendMessageMock.mock.calls[0][0];
    expect(callArgs.payload.records).toHaveLength(2);
    expect(mockStorage['yasumaro_migration_status']).toBe('completed');
  });

  it('does not advance progress for failed inserts', async () => {
    mockStorage['savedUrlsWithTimestamps'] = [
      { url: 'https://example.com/1', timestamp: 1000 },
    ];

    // Insert fails
    sendMessageMock.mockImplementation(
      (_msg: unknown, callback: (response: unknown) => void) => {
        callback({ success: false, error: 'Insert failed' });
      }
    );

    await service.run();

    // Should not mark as completed since insert failed
    expect(mockStorage['yasumaro_migration_status']).not.toBe('completed');
    // Progress should NOT advance — 0 entries were successfully inserted
    expect(mockStorage['yasumaro_migration_progress']).toBe(0);
  });

  it('progress reflects only successfully inserted entries in a batch', async () => {
    mockStorage['savedUrlsWithTimestamps'] = [
      { url: 'https://example.com/1', timestamp: 1000 },
      { url: 'https://example.com/2', timestamp: 2000 },
      { url: 'https://example.com/3', timestamp: 3000 },
    ];

    sendMessageMock.mockImplementation(
      (_msg: unknown, callback: (response: unknown) => void) => {
        callback({ success: true, count: 2 });
      }
    );

    await service.run();

    // 2 of 3 entries were inserted (1 was duplicate/ignored)
    expect(mockStorage['yasumaro_migration_progress']).toBe(2);
    // Should not mark as completed since not all entries were inserted
    expect(mockStorage['yasumaro_migration_status']).not.toBe('completed');
  });

  it('retries previously failed entries on restart', async () => {
    mockStorage['savedUrlsWithTimestamps'] = [
      { url: 'https://example.com/1', timestamp: 1000 },
      { url: 'https://example.com/2', timestamp: 2000 },
      { url: 'https://example.com/3', timestamp: 3000 },
      { url: 'https://example.com/4', timestamp: 4000 },
    ];

    // First run: batch returns count 3 (1 duplicate/failed)
    sendMessageMock.mockImplementation(
      (_msg: unknown, callback: (response: unknown) => void) => {
        callback({ success: true, count: 3 });
      }
    );

    await service.run();

    // 3 out of 4 succeeded
    expect(mockStorage['yasumaro_migration_progress']).toBe(3);

    // Simulate restart — remaining entry should be retried
    sendMessageMock.mockClear();
    sendMessageMock.mockImplementation(
      (_msg: unknown, callback: (response: unknown) => void) => {
        callback({ success: true, count: 1 });
      }
    );

    // Reset status but keep same data + progress from first run
    mockStorage['yasumaro_migration_status'] = null;
    await service.run();

    // Remaining entry at index 3 should be retried
    expect(sendMessageMock).toHaveBeenCalled();
  });
});
