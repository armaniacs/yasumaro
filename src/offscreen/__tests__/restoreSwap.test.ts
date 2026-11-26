/**
 * restoreSwap.test.ts
 * Unit tests for swapVerifiedStagingIntoLive — the engine-independent OPFS
 * procedure that replaces the live DB with a verified staging file
 * (backup the live DB, move the staging file in, roll back on failure, clean
 * up the backup after success). Pure OPFS fakes; no mocks and no real OPFS
 * is touched. The handler-level call order
 * (validateFullBackupFile → swap → initSqlite) stays pinned in
 * restoreStagingHandlers.test.ts and restoreStagingHandlers-hardening.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { DB_FILENAME } from '../dbFilename.js';
import { swapVerifiedStagingIntoLive } from '../opfsWorker/restoreSwap.js';

const BACKUP_NAME = `${DB_FILENAME}.pre-restore`;
const STAGING_NAME = 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';

interface FakeRoot {
  files: Map<string, number>;
  removed: string[];
  getFileHandle(name: string, options?: { create?: boolean }): Promise<unknown>;
  removeEntry(name: string): Promise<void>;
}

function makeFakeRoot(options: {
  failMoveFor?: (name: string) => boolean;
  failRemoveEntryFor?: (name: string) => boolean;
} = {}): FakeRoot {
  const files = new Map<string, number>();
  const removed: string[] = [];
  const failMoveFor = options.failMoveFor ?? (() => false);
  const failRemoveEntryFor = options.failRemoveEntryFor ?? (() => false);
  return {
    files,
    removed,
    async getFileHandle(name: string, options?: { create?: boolean }): Promise<unknown> {
      if (!options?.create && !files.has(name)) {
        throw new Error(`NotFoundError: ${name}`);
      }
      files.set(name, files.get(name) ?? 0);
      return {
        // WHY: Chromium's FileSystemFileHandle.move() exists at runtime but not in TS types
        move: async (newName: string) => {
          if (failMoveFor(name)) {
            throw new Error('Simulated move failure (quota exhausted)');
          }
          const size = files.get(name);
          files.delete(name);
          files.set(newName, size ?? 0);
        },
        getFile: async () => ({ size: files.get(name) ?? 0 }),
      };
    },
    async removeEntry(name: string): Promise<void> {
      if (!files.has(name)) {
        throw new Error(`NotFoundError: ${name}`);
      }
      if (failRemoveEntryFor(name)) {
        throw new Error('Simulated removeEntry failure');
      }
      removed.push(name);
      files.delete(name);
    },
  };
}

function asDirectoryHandle(fake: FakeRoot): FileSystemDirectoryHandle {
  return fake as unknown as FileSystemDirectoryHandle;
}

async function handleOf(fake: FakeRoot, name: string): Promise<FileSystemFileHandle> {
  return (await fake.getFileHandle(name)) as FileSystemFileHandle;
}

describe('swapVerifiedStagingIntoLive', () => {
  it('backs the live DB up, lands the staging file on the live path, and deletes the backup', async () => {
    const fake = makeFakeRoot();
    fake.files.set(DB_FILENAME, 999);
    fake.files.set(STAGING_NAME, 4);

    await swapVerifiedStagingIntoLive(asDirectoryHandle(fake), await handleOf(fake, STAGING_NAME));

    expect(fake.files.get(DB_FILENAME)).toBe(4);
    expect(fake.files.has(STAGING_NAME)).toBe(false);
    // The backup is gone once the swap lands, so a crash cannot leave the
    // history DB plus a stale backup pair behind.
    expect(fake.files.has(BACKUP_NAME)).toBe(false);
    // The replacement goes through move, not copy+delete: only the backup
    // name is ever removed via removeEntry.
    expect(fake.removed).toEqual([BACKUP_NAME]);
  });

  it('rolls the live DB back when the staging move fails', async () => {
    const fake = makeFakeRoot({ failMoveFor: (name) => name === STAGING_NAME });
    fake.files.set(DB_FILENAME, 999);
    fake.files.set(STAGING_NAME, 4);

    await expect(
      swapVerifiedStagingIntoLive(asDirectoryHandle(fake), await handleOf(fake, STAGING_NAME)),
    ).rejects.toThrow('Simulated move failure (quota exhausted)');

    // The old history DB survived the failed swap (backed up before the
    // move and rolled back on failure), and the rollback leaves no backup
    // name behind.
    expect(fake.files.get(DB_FILENAME)).toBe(999);
    expect(fake.files.has(BACKUP_NAME)).toBe(false);
    // The staging file is not consumed on failure — the caller can retry the
    // commit or abort it explicitly.
    expect(fake.files.has(STAGING_NAME)).toBe(true);
    // No cleanup ran on the failure path.
    expect(fake.removed).toEqual([]);
  });

  it('swaps the staging file in when no live DB exists yet', async () => {
    const fake = makeFakeRoot();
    fake.files.set(STAGING_NAME, 4);

    await swapVerifiedStagingIntoLive(asDirectoryHandle(fake), await handleOf(fake, STAGING_NAME));

    expect(fake.files.get(DB_FILENAME)).toBe(4);
    expect(fake.files.has(STAGING_NAME)).toBe(false);
    expect(fake.files.has(BACKUP_NAME)).toBe(false);
    expect(fake.removed).toEqual([]);
  });

  it('treats the backup cleanup as best-effort: a failed backup removal does not fail the swap', async () => {
    const fake = makeFakeRoot({ failRemoveEntryFor: (name) => name === BACKUP_NAME });
    fake.files.set(DB_FILENAME, 999);
    fake.files.set(STAGING_NAME, 4);

    await swapVerifiedStagingIntoLive(asDirectoryHandle(fake), await handleOf(fake, STAGING_NAME));

    expect(fake.files.get(DB_FILENAME)).toBe(4);
    // A stale backup may survive a transient removeEntry failure; the swap
    // itself still succeeds and the staged DB is live.
    expect(fake.files.has(BACKUP_NAME)).toBe(true);
  });
});
