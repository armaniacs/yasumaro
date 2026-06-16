/**
 * opfsMigrationV2.test.ts
 * Unit tests for the AccessHandlePoolVFS → OPFSCoopSyncVFS migration orchestrator.
 * All OPFS/wa-sqlite deps are injected via MigrationDeps so no module mocking is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateOldOpfsDb, type MigrationDeps } from '../opfsMigrationV2.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

const sampleRecords: BrowsingLogRecord[] = [
  {
    url: 'https://example.com',
    title: 'Example',
    summary: 'A page',
    tags: 'test',
    created_at: 1700000000000,
    domain: 'example.com',
    visit_duration: 30,
    scroll_ratio: 0.5,
    is_starred: 0,
    is_deleted: 0,
  },
];

function makeDeps(overrides: Partial<MigrationDeps> = {}): { deps: MigrationDeps; mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const mocks = {
    isMigrationDone: vi.fn().mockResolvedValue(false),
    setMigrationDone: vi.fn().mockResolvedValue(undefined),
    readOldRecords: vi.fn().mockResolvedValue([]),
    insertBatch: vi.fn().mockResolvedValue({ count: 0 }),
    deleteOldDb: vi.fn().mockResolvedValue(undefined),
  };

  const deps: MigrationDeps = {
    isMigrationDone: mocks.isMigrationDone,
    setMigrationDone: mocks.setMigrationDone,
    readOldRecords: mocks.readOldRecords,
    insertBatch: mocks.insertBatch,
    deleteOldDb: mocks.deleteOldDb,
    ...overrides,
  };

  return { deps, mocks };
}

describe('migrateOldOpfsDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips migration if already done', async () => {
    const { deps, mocks } = makeDeps({
      isMigrationDone: vi.fn().mockResolvedValue(true),
    });

    const result = await migrateOldOpfsDb(deps);

    expect(result).toEqual({ migrated: 0, skipped: true });
    expect(mocks.readOldRecords).not.toHaveBeenCalled();
    expect(mocks.insertBatch).not.toHaveBeenCalled();
    expect(mocks.setMigrationDone).not.toHaveBeenCalled();
    expect(mocks.deleteOldDb).not.toHaveBeenCalled();
  });

  it('marks done without insert/delete when old db has 0 records', async () => {
    const { deps, mocks } = makeDeps({
      readOldRecords: vi.fn().mockResolvedValue([]),
    });

    const result = await migrateOldOpfsDb(deps);

    expect(result).toEqual({ migrated: 0, skipped: false });
    expect(mocks.insertBatch).not.toHaveBeenCalled();
    expect(mocks.deleteOldDb).not.toHaveBeenCalled();
    expect(mocks.setMigrationDone).toHaveBeenCalledOnce();
  });

  it('inserts records then deletes old db then marks done (happy path)', async () => {
    const callOrder: string[] = [];
    const insertBatch = vi.fn().mockImplementation(async () => {
      callOrder.push('insertBatch');
      return { count: sampleRecords.length };
    });
    const deleteOldDb = vi.fn().mockImplementation(async () => { callOrder.push('deleteOldDb'); });
    const setMigrationDone = vi.fn().mockImplementation(async () => { callOrder.push('setMigrationDone'); });

    const { deps } = makeDeps({
      readOldRecords: vi.fn().mockResolvedValue(sampleRecords),
      insertBatch,
      deleteOldDb,
      setMigrationDone,
    });

    const result = await migrateOldOpfsDb(deps);

    expect(result).toEqual({ migrated: sampleRecords.length, skipped: false });
    expect(insertBatch).toHaveBeenCalledWith(sampleRecords);
    // Verify order: insert → delete → mark done
    expect(callOrder).toEqual(['insertBatch', 'deleteOldDb', 'setMigrationDone']);
  });

  it('returns error and does NOT call setMigrationDone/deleteOldDb when insertBatch throws', async () => {
    const { deps, mocks } = makeDeps({
      readOldRecords: vi.fn().mockResolvedValue(sampleRecords),
      insertBatch: vi.fn().mockRejectedValue(new Error('disk full')),
    });

    const result = await migrateOldOpfsDb(deps);

    expect(result.skipped).toBe(false);
    expect(result.migrated).toBe(0);
    expect(result.error).toContain('disk full');
    expect(mocks.setMigrationDone).not.toHaveBeenCalled();
    expect(mocks.deleteOldDb).not.toHaveBeenCalled();
  });

  it('returns error and does NOT call setMigrationDone when readOldRecords throws', async () => {
    const { deps, mocks } = makeDeps({
      readOldRecords: vi.fn().mockRejectedValue(new Error('OPFS unavailable')),
    });

    const result = await migrateOldOpfsDb(deps);

    expect(result.skipped).toBe(false);
    expect(result.migrated).toBe(0);
    expect(result.error).toContain('OPFS unavailable');
    expect(mocks.setMigrationDone).not.toHaveBeenCalled();
    expect(mocks.deleteOldDb).not.toHaveBeenCalled();
  });

  it('deleteOldDb が insert 後に throw した場合、error を返し setMigrationDone を呼ばない', async () => {
    const insertBatch = vi.fn().mockResolvedValue({ count: sampleRecords.length });
    const { deps, mocks } = makeDeps({
      readOldRecords: vi.fn().mockResolvedValue(sampleRecords),
      insertBatch,
      deleteOldDb: vi.fn().mockRejectedValue(new Error('delete failed')),
    });

    const result = await migrateOldOpfsDb(deps);

    expect(result.skipped).toBe(false);
    expect(result.error).toContain('delete failed');
    expect(insertBatch).toHaveBeenCalledWith(sampleRecords);
    expect(mocks.setMigrationDone).not.toHaveBeenCalled();
  });
});
