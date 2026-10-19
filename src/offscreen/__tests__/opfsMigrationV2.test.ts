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

const threeRecords: BrowsingLogRecord[] = [
  {
    url: 'https://example.com/1',
    title: 'Example 1',
    summary: 'A page',
    tags: 'test',
    created_at: 1700000000001,
    domain: 'example.com',
    visit_duration: 30,
    scroll_ratio: 0.5,
    is_starred: 0,
    is_deleted: 0,
  },
  {
    url: 'https://example.com/2',
    title: 'Example 2',
    summary: 'A page',
    tags: 'test',
    created_at: 1700000000002,
    domain: 'example.com',
    visit_duration: 30,
    scroll_ratio: 0.5,
    is_starred: 0,
    is_deleted: 0,
  },
  {
    url: 'https://example.com/3',
    title: 'Example 3',
    summary: 'A page',
    tags: 'test',
    created_at: 1700000000003,
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
    // Entity-verification stub: the fixture models a NEW db that holds exactly
    // the sample records, so tests that claim a full insert pass the gate.
    countNewDbRecords: vi.fn().mockResolvedValue(sampleRecords.length),
    deleteOldDb: vi.fn().mockResolvedValue(undefined),
  };

  const deps: MigrationDeps = {
    isMigrationDone: mocks.isMigrationDone,
    setMigrationDone: mocks.setMigrationDone,
    readOldRecords: mocks.readOldRecords,
    insertBatch: mocks.insertBatch,
    countNewDbRecords: mocks.countNewDbRecords,
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

  // NOTE: the production deleteOldDb (deleteOldDbFile in opfsMigrationV2Reader.ts)
  // swallows every error and NEVER throws — this throw path is a test-only
  // escape hatch that pins the orchestrator contract, not production behavior.
  it('returns an error and skips setMigrationDone when deleteOldDb throws after insert', async () => {
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

  // Scenario 1: a non-throwing partial count (per-row errors are swallowed by
  // the INSERT OR IGNORE handler) must NOT destroy the old db — the done flag
  // stays unset so the migration retries on the next init.
  it('does NOT delete old db or mark done on a non-throwing partial count (3 rows, 1 inserted)', async () => {
    const countNewDbRecords = vi.fn().mockResolvedValue(1);
    const { deps, mocks } = makeDeps({
      readOldRecords: vi.fn().mockResolvedValue(threeRecords),
      insertBatch: vi.fn().mockResolvedValue({ count: 1, skipped: 0 }),
      countNewDbRecords,
    });

    const result = await migrateOldOpfsDb(deps);

    expect(mocks.deleteOldDb).not.toHaveBeenCalled();
    expect(mocks.setMigrationDone).not.toHaveBeenCalled();
    expect(countNewDbRecords).toHaveBeenCalledOnce();
    expect(result.migrated).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('old rows=3');
    expect(result.error).toContain('inserted=1');
  });

  // Scenario 3: INSERT OR IGNORE duplicate skips are not failures — the
  // (url, created_at) key already exists in the new db, so the row's data is
  // present there and the migration still completes.
  it('treats duplicate skips as success and completes when every row was inserted or skipped', async () => {
    const { deps, mocks } = makeDeps({
      readOldRecords: vi.fn().mockResolvedValue(threeRecords),
      insertBatch: vi.fn().mockResolvedValue({ count: 1, inserted: 1, skipped: 2 }),
      countNewDbRecords: vi.fn().mockResolvedValue(3),
    });

    const result = await migrateOldOpfsDb(deps);

    expect(result).toEqual({ migrated: 1, skipped: false });
    expect(mocks.deleteOldDb).toHaveBeenCalledOnce();
    expect(mocks.setMigrationDone).toHaveBeenCalledOnce();
  });

  // Scenario 4: withTransaction rolls back on COMMIT failure and rethrows, but
  // the insertBatch handler swallows that error and returns the counter
  // accumulated inside the rolled-back transaction — count=3 while the new db
  // holds nothing. The orchestrator must not trust the self-reported count.
  it('keeps the old db when the new db does not hold the claimed insert count (rollback over-report)', async () => {
    const { deps, mocks } = makeDeps({
      readOldRecords: vi.fn().mockResolvedValue(threeRecords),
      insertBatch: vi.fn().mockResolvedValue({ count: 3, inserted: 3, skipped: 0 }),
      countNewDbRecords: vi.fn().mockResolvedValue(0),
    });

    const result = await migrateOldOpfsDb(deps);

    expect(mocks.deleteOldDb).not.toHaveBeenCalled();
    expect(mocks.setMigrationDone).not.toHaveBeenCalled();
    expect(result.migrated).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('new db rows=0');
  });
});
