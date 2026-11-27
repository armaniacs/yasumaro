/**
 * stagingRegistryCap.test.ts
 * VULN-001 (CWE-400) new contract, ported from the VulnHunter exploit test
 * (yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/exploit_tests/
 * test_vuln_001_staging_registry_unbounded.test.ts). The exploit pinned the
 * OLD behavior (5000/2000 prepares all retained, no cap constant anywhere);
 * this file pins the FIX:
 *   - create-spam up to cap is accepted, the next prepare fails closed
 *     (registry and OPFS root stay bounded)
 *   - at cap, TTL-expired sessions are evicted and their OPFS files are
 *     removed by the registry's own orphan sweep, recovering the registry
 *   - the archive and restore caps are independent constants (one path's
 *     spam cannot starve the other)
 * TTL tests inject the clock (fake Date only); no real-time waits.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRootFromUrl } from '../../../testDir/repoRoot.js';
import {
  MAX_ARCHIVE_STAGING_SESSIONS,
  MAX_RESTORE_STAGING_SESSIONS,
  STAGING_SESSION_TTL,
} from '../../utils/limits.js';
import {
  prepareIncoming,
  prepareOutgoing,
  isStagingRegistered,
  resetArchiveStagingForTesting,
  setArchiveStagingDirProviderForTesting,
} from '../opfsWorker/archiveStaging.js';
import {
  prepareRestoreIncoming,
  getRestoreStagingRecord,
  resetRestoreStagingForTesting,
  setRestoreStagingDirProviderForTesting,
} from '../opfsWorker/restoreStaging.js';

const T0 = 1_760_000_000_000;

interface FakeArchiveFile {
  remove: Mock;
}

/** Archive root: prepare issues names only; clients write the staged bytes. */
function makeArchiveFakeDir() {
  const files = new Map<string, FakeArchiveFile>();
  return {
    files,
    async removeEntry(name: string): Promise<void> {
      if (!files.has(name)) throw new Error('NotFoundError');
      files.get(name)!.remove();
      files.delete(name);
    },
    async *entries(): AsyncGenerator<[string, FakeArchiveFile]> {
      for (const [name, entry] of files) yield [name, entry];
    },
  };
}

/** Restore root: begin creates (truncates) the staging file itself. */
function makeRestoreFakeRoot() {
  const files = new Set<string>();
  return {
    files,
    async getFileHandle(name: string, opts?: { create?: boolean }): Promise<unknown> {
      if (!opts?.create && !files.has(name)) throw new Error(`NotFoundError: ${name}`);
      files.add(name);
      return {
        createSyncAccessHandle: async () => ({
          truncate: (_size: number) => undefined,
          flush: () => undefined,
          close: () => undefined,
        }),
      };
    },
    async removeEntry(name: string): Promise<void> {
      if (!files.has(name)) throw new Error('NotFoundError');
      files.delete(name);
    },
    async *entries(): AsyncGenerator<[string, unknown]> {
      for (const name of [...files]) yield [name, {}];
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('archive staging registry cap (VULN-001 fix)', () => {
  let fakeDir: ReturnType<typeof makeArchiveFakeDir>;

  beforeEach(() => {
    resetArchiveStagingForTesting();
    fakeDir = makeArchiveFakeDir();
    setArchiveStagingDirProviderForTesting(async () => fakeDir as never);
  });

  it('accepts a create-spam up to the cap, both kinds sharing the cap', async () => {
    const names: string[] = [];
    for (let i = 0; i < MAX_ARCHIVE_STAGING_SESSIONS; i++) {
      names.push(i % 2 === 0 ? await prepareIncoming() : await prepareOutgoing());
      fakeDir.files.set(names[i]!, { remove: vi.fn() });
    }
    expect(names).toHaveLength(MAX_ARCHIVE_STAGING_SESSIONS);
    expect(names.every((n) => isStagingRegistered(n))).toBe(true);
  });

  it('fails closed at cap +1; registry and OPFS root stay exactly at cap', async () => {
    const names: string[] = [];
    for (let i = 0; i < MAX_ARCHIVE_STAGING_SESSIONS; i++) {
      names.push(await prepareIncoming());
      fakeDir.files.set(names[i]!, { remove: vi.fn() });
    }

    await expect(prepareIncoming()).rejects.toThrow(/archive staging registry is full/);
    await expect(prepareOutgoing()).rejects.toThrow(/archive staging registry is full/);

    // Fail-closed means nothing extra was issued: the rejected prepare must
    // not have left a half-registered session or a new OPFS file behind.
    expect(names.filter((n) => isStagingRegistered(n))).toHaveLength(MAX_ARCHIVE_STAGING_SESSIONS);
    expect(fakeDir.files.size).toBe(MAX_ARCHIVE_STAGING_SESSIONS);
  });

  it('evicts TTL-expired sessions (and their OPFS files) to recover at cap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const expiredNames: string[] = [];
    for (let i = 0; i < MAX_ARCHIVE_STAGING_SESSIONS - 1; i++) {
      const n = await prepareIncoming();
      fakeDir.files.set(n, { remove: vi.fn() });
      expiredNames.push(n);
    }
    // Last slot is filled later and is still inside its TTL at recovery time.
    vi.setSystemTime(T0 + STAGING_SESSION_TTL - 1);
    const liveName = await prepareOutgoing();
    fakeDir.files.set(liveName, { remove: vi.fn() });
    expect(fakeDir.files.size).toBe(MAX_ARCHIVE_STAGING_SESSIONS);

    // Exactly the TTL boundary: the first cap-1 sessions are evictable, the
    // late one (age 1ms) is not.
    vi.setSystemTime(T0 + STAGING_SESSION_TTL);
    const recovered = await prepareIncoming();

    expect(isStagingRegistered(recovered)).toBe(true);
    for (const n of expiredNames) {
      expect(isStagingRegistered(n)).toBe(false);
      // The orphan sweep removed the evicted session's OPFS file.
      expect(fakeDir.files.has(n)).toBe(false);
    }
    // The still-live session survives the eviction sweep. The recovered
    // session has no file yet — incoming bytes are written by the client
    // after prepare — so exactly one file remains.
    expect(isStagingRegistered(liveName)).toBe(true);
    expect(fakeDir.files.has(liveName)).toBe(true);
    expect(fakeDir.files.size).toBe(1);
  });
});

describe('restore staging registry cap (VULN-001 fix)', () => {
  let fakeRoot: ReturnType<typeof makeRestoreFakeRoot>;

  beforeEach(() => {
    resetRestoreStagingForTesting();
    fakeRoot = makeRestoreFakeRoot();
    setRestoreStagingDirProviderForTesting(async () => fakeRoot as never);
  });

  it('accepts a create-spam up to the cap, then fails closed before touching OPFS', async () => {
    const names: string[] = [];
    for (let i = 0; i < MAX_RESTORE_STAGING_SESSIONS; i++) {
      names.push(await prepareRestoreIncoming(1, 1));
    }
    expect(fakeRoot.files.size).toBe(MAX_RESTORE_STAGING_SESSIONS);

    await expect(prepareRestoreIncoming(1, 1)).rejects.toThrow(/restore staging registry is full/);

    // No staging file may be created for a rejected begin.
    expect(fakeRoot.files.size).toBe(MAX_RESTORE_STAGING_SESSIONS);
    for (const n of names) expect(getRestoreStagingRecord(n)).toBeDefined();
  });

  it('evicts TTL-expired sessions and sweeps their OPFS files to recover at cap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const names: string[] = [];
    for (let i = 0; i < MAX_RESTORE_STAGING_SESSIONS; i++) {
      names.push(await prepareRestoreIncoming(1, 1));
    }
    expect(fakeRoot.files.size).toBe(MAX_RESTORE_STAGING_SESSIONS);

    vi.setSystemTime(T0 + STAGING_SESSION_TTL);
    const recovered = await prepareRestoreIncoming(1, 1);

    expect(getRestoreStagingRecord(recovered)).toBeDefined();
    expect(fakeRoot.files.has(recovered)).toBe(true);
    for (const n of names) {
      expect(getRestoreStagingRecord(n)).toBeUndefined();
      expect(fakeRoot.files.has(n)).toBe(false);
    }
    expect(fakeRoot.files.size).toBe(1);
  });
});

describe('archive and restore caps are independent (VULN-001 fix)', () => {
  let fakeDir: ReturnType<typeof makeArchiveFakeDir>;
  let fakeRoot: ReturnType<typeof makeRestoreFakeRoot>;

  beforeEach(() => {
    resetArchiveStagingForTesting();
    resetRestoreStagingForTesting();
    fakeDir = makeArchiveFakeDir();
    fakeRoot = makeRestoreFakeRoot();
    setArchiveStagingDirProviderForTesting(async () => fakeDir as never);
    setRestoreStagingDirProviderForTesting(async () => fakeRoot as never);
  });

  it('a full archive registry cannot starve restore sessions and vice versa', async () => {
    for (let i = 0; i < MAX_ARCHIVE_STAGING_SESSIONS; i++) await prepareIncoming();
    await expect(prepareIncoming()).rejects.toThrow(/archive staging registry is full/);
    // The restore registry is a separate Map behind a separate cap.
    await expect(prepareRestoreIncoming(1, 1)).resolves.toMatch(/^restore_incoming_/);

    for (let i = 1; i < MAX_RESTORE_STAGING_SESSIONS; i++) await prepareRestoreIncoming(1, 1);
    await expect(prepareRestoreIncoming(1, 1)).rejects.toThrow(/restore staging registry is full/);
    // Filling restore does not lift or shift the archive cap either.
    await expect(prepareIncoming()).rejects.toThrow(/archive staging registry is full/);
  });
});

describe('new contract: both registries consume the SSOT cap constants', () => {
  const repoRoot = repoRootFromUrl(import.meta.url);
  const archiveSource = readFileSync(
    join(repoRoot, 'src/offscreen/opfsWorker/archiveStaging.ts'),
    'utf-8',
  );
  const restoreSource = readFileSync(
    join(repoRoot, 'src/offscreen/opfsWorker/restoreStaging.ts'),
    'utf-8',
  );

  it('archiveStaging gates on MAX_ARCHIVE_STAGING_SESSIONS + STAGING_SESSION_TTL', () => {
    expect(archiveSource).toContain('MAX_ARCHIVE_STAGING_SESSIONS');
    expect(archiveSource).toContain('STAGING_SESSION_TTL');
    // Caps stay path-scoped: the archive registry must not read the restore cap.
    expect(archiveSource).not.toContain('MAX_RESTORE_STAGING_SESSIONS');
  });

  it('restoreStaging gates on MAX_RESTORE_STAGING_SESSIONS + STAGING_SESSION_TTL', () => {
    expect(restoreSource).toContain('MAX_RESTORE_STAGING_SESSIONS');
    expect(restoreSource).toContain('STAGING_SESSION_TTL');
    expect(restoreSource).not.toContain('MAX_ARCHIVE_STAGING_SESSIONS');
  });
});
