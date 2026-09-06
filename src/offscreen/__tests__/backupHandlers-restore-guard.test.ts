// @vitest-environment jsdom
/**
 * backupHandlers-restore-guard.test.ts
 * PBI 2026-09-06-01: the existing full restore (restore_db) must reject an
 * archive-format .db (yasumaro_archive_meta present) and point the user to
 * the archive restore panel. The main DB must remain untouched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const REMOVED: string[] = [];

function makeFakeRoot() {
  const files = new Map<string, boolean>();
  return {
    files,
    async getFileHandle(name: string): Promise<unknown> {
      files.set(name, true);
      return {
        createWritable: async () => ({
          write: async (_data: unknown) => undefined,
          close: async () => undefined,
        }),
        // WHY: Chromium's FileSystemFileHandle.move() exists at runtime but
        // not in TS types — handleRestore uses it to swap the temp file in.
        move: async (newName: string) => {
          files.set(newName, true);
          files.delete(name);
        },
      };
    },
    async removeEntry(name: string): Promise<void> {
      REMOVED.push(name);
      files.delete(name);
    },
  };
}

type QueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>;

function makeTmpEngine(query: QueryFn) {
  return {
    exec: async (_sql: string) => undefined,
    query,
    queryValue: async (sql: string) => {
      const rows = await query(sql);
      const first = rows[0];
      if (!first) return null;
      const key = Object.keys(first)[0];
      return key !== undefined ? (first[key] ?? null) : null;
    },
    close: async () => undefined,
  };
}

function makeQueryFn(archiveTablePresent: boolean): QueryFn {
  return async (sql: string) => {
    if (sql.includes("name = 'yasumaro_archive_meta'")) {
      return archiveTablePresent ? [{ name: 'yasumaro_archive_meta' }] : [];
    }
    if (sql.includes("type = 'trigger'")) return [{ c: 0 }];
    if (sql.includes('count(*)')) return [{ c: 2 }];
    return [];
  };
}

async function loadHandleRestore() {
  vi.resetModules();
  vi.doMock('../sqliteEngine.js', () => ({
    createEngine: vi.fn(async (_path: string, _url: string) =>
      makeTmpEngine(currentQueryFn),
    ),
  }));
  const mod = await import('../opfsWorker/backupHandlers.js');
  return mod.handleRestore as (
    data: Uint8Array,
    getEngine: () => null,
    setEngine: (e: null) => void,
    initSqlite: () => Promise<void>,
  ) => Promise<{ restored: true }>;
}

let currentQueryFn: QueryFn = makeQueryFn(false);
let fakeRoot: ReturnType<typeof makeFakeRoot>;

beforeEach(() => {
  REMOVED.length = 0;
  fakeRoot = makeFakeRoot();
  currentQueryFn = makeQueryFn(false);
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    get: () => ({ getDirectory: async () => fakeRoot }),
  });
});

describe('handleRestore — archive database rejection guard (PBI 2026-09-06-01)', () => {
  it('rejects an archive-format .db (yasumaro_archive_meta present) and cleans up the temp file', async () => {
    currentQueryFn = makeQueryFn(true);
    const handleRestore = await loadHandleRestore();
    await expect(
      handleRestore(new Uint8Array([1]), () => null, () => undefined, async () => undefined),
    ).rejects.toThrow(/archive/i);
    const tmpRemoved = REMOVED.find((n) => n.endsWith('.restore-tmp'));
    expect(tmpRemoved).toBeDefined();
  });

  it('allows a regular .db without yasumaro_archive_meta (existing behavior)', async () => {
    currentQueryFn = makeQueryFn(false);
    const handleRestore = await loadHandleRestore();
    await expect(
      handleRestore(new Uint8Array([1]), () => null, () => undefined, async () => undefined),
    ).resolves.toEqual({ restored: true });
  });
});
