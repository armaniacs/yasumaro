// @vitest-environment jsdom
/**
 * archiveStaging.test.ts
 * Unit tests for the staging registry (offscreen-issued names, sweep, release).
 * OPFS access is injected via the dir-handle provider seam so tests run
 * without a real OPFS implementation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  prepareIncoming,
  prepareOutgoing,
  getStagingRecord,
  isStagingRegistered,
  releaseStaging,
  sweepOrphanStagings,
  assertRegisteredStagingName,
  setArchiveStagingDirProviderForTesting,
  resetArchiveStagingForTesting,
} from '../opfsWorker/archiveStaging.js';

interface FakeDirEntry {
  remove: ReturnType<typeof vi.fn>;
}

function makeFakeDir() {
  const files = new Map<string, FakeDirEntry>();
  const dir = {
    files,
    async getFileHandle(name: string): Promise<unknown> {
      if (!files.has(name)) throw new Error('NotFoundError');
      return { name };
    },
    async removeEntry(name: string): Promise<void> {
      if (!files.has(name)) throw new Error('NotFoundError');
      files.get(name)!.remove();
      files.delete(name);
    },
    async *entries(): AsyncGenerator<[string, FakeDirEntry]> {
      for (const [name, entry] of files) yield [name, entry];
    },
  };
  return dir;
}

describe('archiveStaging registry', () => {
  let fakeDir: ReturnType<typeof makeFakeDir>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetArchiveStagingForTesting();
    fakeDir = makeFakeDir();
    fakeDir.files.set('archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', {
      remove: vi.fn(),
    });
    setArchiveStagingDirProviderForTesting(async () => fakeDir as never);
  });

  it('issues a registered incoming name (offscreen-generated)', async () => {
    const name = await prepareIncoming();
    expect(name).toMatch(/^archive_incoming_[A-Za-z0-9-]{36}\.db$/);
    expect(isStagingRegistered(name)).toBe(true);
    expect(getStagingRecord(name)?.kind).toBe('incoming');
  });

  it('issues a registered outgoing name (offscreen-generated)', async () => {
    const name = await prepareOutgoing();
    expect(name).toMatch(/^archive_outgoing_[A-Za-z0-9-]{36}\.db$/);
    expect(getStagingRecord(name)?.kind).toBe('outgoing');
  });

  it('refuses client-specified names that were not issued (yasumaro.db protection)', () => {
    expect(() => assertRegisteredStagingName('yasumaro.db')).toThrow();
    expect(() => assertRegisteredStagingName('../yasumaro.db')).toThrow();
    expect(() => assertRegisteredStagingName('archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db')).toThrow();
  });

  it('accepts names issued by the registry', async () => {
    const name = await prepareOutgoing();
    expect(() => assertRegisteredStagingName(name)).not.toThrow();
  });

  it('releaseStaging unregisters and removes the file', async () => {
    const name = await prepareOutgoing();
    fakeDir.files.set(name, { remove: vi.fn() });
    await releaseStaging(name);
    expect(isStagingRegistered(name)).toBe(false);
    expect(fakeDir.files.has(name)).toBe(false);
  });

  it('releaseStaging for an unknown name throws (fail-closed)', async () => {
    await expect(releaseStaging('archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db')).rejects.toThrow();
  });
});

describe('sweepOrphanStagings', () => {
  let fakeDir: ReturnType<typeof makeFakeDir>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetArchiveStagingForTesting();
    fakeDir = makeFakeDir();
    setArchiveStagingDirProviderForTesting(async () => fakeDir as never);
  });

  it('removes orphan staging files but protects the excluded set', async () => {
    const orphanA = 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    const keep = 'archive_incoming_5f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    fakeDir.files.set(orphanA, { remove: vi.fn() });
    fakeDir.files.set(keep, { remove: vi.fn() });
    fakeDir.files.set('yasumaro.db', { remove: vi.fn() });

    const removed = await sweepOrphanStagings(new Set([keep]));
    expect(removed).toContain(orphanA);
    expect(removed).not.toContain(keep);
    expect(fakeDir.files.has(orphanA)).toBe(false);
    expect(fakeDir.files.has(keep)).toBe(true);
    // Non-staging files (e.g. the main DB) are never touched
    expect(fakeDir.files.has('yasumaro.db')).toBe(true);
  });

  it('protects staging files registered by the current session even without explicit exclude', async () => {
    const live = await prepareOutgoing();
    fakeDir.files.set(live, { remove: vi.fn() });
    const orphan = 'archive_outgoing_7f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    fakeDir.files.set(orphan, { remove: vi.fn() });

    const removed = await sweepOrphanStagings();
    expect(removed).toContain(orphan);
    expect(fakeDir.files.has(live)).toBe(true);
  });
});
