// @vitest-environment jsdom
/**
 * opfsWorker.test.ts
 * Tests for opfsWorker.ts — handleRestore with temp file validation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock createEngine to avoid WASM dependency
vi.mock('../sqliteEngine.js', () => ({
  createEngine: vi.fn(),
  SqliteEngine: class {},
}));

vi.mock('../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../opfsMigrationV2Reader.js', () => ({
  readOldDbRecords: vi.fn().mockResolvedValue([]),
  deleteOldDbFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock chrome.storage for runMigrationV2
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((_keys: string | string[], callback: (items: Record<string, unknown>) => void) => {
        callback({ opfs_migration_v2_done: false });
      }),
      set: vi.fn((_items: Record<string, unknown>, callback?: () => void) => {
        if (callback) callback();
      }),
    },
  },
} as never);

import { handleRestore } from '../opfsWorker.js';

function createFakeOpfsFileSystem() {
  const files = new Map<string, Uint8Array>();
  const root = {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!opts?.create) throw new DOMException('NotFoundError', 'NotFoundError');
        files.set(name, new Uint8Array());
      }
      return {
        async getFile() {
          const bytes = files.get(name)!;
          return new Blob([bytes]) as unknown as File;
        },
        async createWritable() {
          return {
            async write(chunk: Uint8Array) { files.set(name, chunk); },
            async close() {},
          };
        },
        async move(newName: string) {
          const bytes = files.get(name)!;
          files.delete(name);
          files.set(newName, bytes);
        },
        remove: async () => { files.delete(name); },
      };
    },
    async removeEntry(name: string) { files.delete(name); },
  };
  return { root, files };
}

describe('handleRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid SQLite data without touching the production file', async () => {
    const { root, files } = createFakeOpfsFileSystem();
    files.set('yasumaro.db', new Uint8Array([0x53, 0x51, 0x4c])); // fake "existing" prod db
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    // Mock createEngine to reject (simulating invalid SQLite)
    const { createEngine } = await import('../sqliteEngine.js');
    vi.mocked(createEngine).mockRejectedValue(new Error('not a valid database'));

    const invalidData = new Uint8Array([0, 1, 2, 3]); // not a valid SQLite file

    await expect(handleRestore(invalidData)).rejects.toThrow('Restore validation failed');
    expect(files.get('yasumaro.db')).toEqual(new Uint8Array([0x53, 0x51, 0x4c]));
    expect(files.has('yasumaro.db.restore-tmp')).toBe(false);
  });

  it('replaces the production file when validation succeeds', async () => {
    const { root, files } = createFakeOpfsFileSystem();
    files.set('yasumaro.db', new Uint8Array([0x00])); // old prod db content
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    // Mock createEngine to return a valid engine
    const { createEngine } = await import('../sqliteEngine.js');
    vi.mocked(createEngine).mockResolvedValue({
      exec: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      queryValue: vi.fn().mockResolvedValue(0),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const validData = new Uint8Array([1, 2, 3, 4]);

    const result = await handleRestore(validData);

    expect(result).toEqual({ restored: true });
    expect(files.get('yasumaro.db')).toEqual(validData);
    expect(files.has('yasumaro.db.restore-tmp')).toBe(false);
  });
});
