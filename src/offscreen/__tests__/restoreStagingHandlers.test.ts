// @vitest-environment wasm-quickjs-dom
/**
 * restoreStagingHandlers.test.ts
 * Offscreen worker integration for the chunked restore staging session:
 * sweep-on-begin, offset append, size-checked + validated commit that swaps
 * the live DB, fail-closed unknown names, and abort cleanup. The OPFS root
 * and the SQLite engines are fakes; no real OPFS is touched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const REMOVED: string[] = [];

interface FakeAccess {
  writes: Array<{ at: number | undefined; length: number }>;
  truncate: (size: number) => void;
  write: (data: ArrayBuffer, options?: { at?: number }) => number;
  flush: () => void;
  close: () => void;
}

function makeFakeRoot() {
  const files = new Map<string, number>();
  const accesses: FakeAccess[] = [];
  return {
    files,
    accesses,
    async getFileHandle(name: string, options?: { create?: boolean }): Promise<unknown> {
      if (!options?.create && !files.has(name)) {
        throw new Error(`NotFoundError: ${name}`);
      }
      files.set(name, files.get(name) ?? 0);
      return {
        createSyncAccessHandle: async (): Promise<FakeAccess> => {
          const access: FakeAccess = {
            writes: [],
            truncate: (size: number) => { files.set(name, size); },
            write: (data: ArrayBuffer, opts?: { at?: number }) => {
              const at = opts?.at ?? 0;
              access.writes.push({ at, length: data.byteLength });
              const end = at + data.byteLength;
              files.set(name, Math.max(files.get(name) ?? 0, end));
              return data.byteLength;
            },
            flush: () => undefined,
            close: () => undefined,
          };
          accesses.push(access);
          return access;
        },
        getFile: async () => ({ size: files.get(name) ?? 0 }),
        createWritable: async () => ({
          write: async () => undefined,
          close: async () => undefined,
        }),
        // WHY: Chromium's FileSystemFileHandle.move() exists at runtime but not in TS types
        move: async (newName: string) => {
          const size = files.get(name);
          files.delete(name);
          files.set(newName, size ?? 0);
        },
      };
    },
    async removeEntry(name: string): Promise<void> {
      REMOVED.push(name);
      files.delete(name);
    },
    async *entries(): AsyncGenerator<[string, unknown]> {
      for (const name of [...files.keys()]) yield [name, {}];
    },
  };
}

type QueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>;

function makeEngine(query: QueryFn) {
  return {
    exec: async (_sql: string) => undefined,
    query,
    close: async () => undefined,
  };
}

function makeQueryFn(archiveTablePresent: boolean, triggerRows: Array<Record<string, unknown>> = []): QueryFn {
  return async (sql: string) => {
    if (sql.includes("name = 'yasumaro_archive_meta'")) {
      return archiveTablePresent ? [{ name: 'yasumaro_archive_meta' }] : [];
    }
    if (sql.includes("type = 'trigger'")) return triggerRows;
    if (sql.includes('count(*)')) return [{ c: 2 }];
    return [];
  };
}

let currentQueryFn: QueryFn = makeQueryFn(false);
let fakeRoot: ReturnType<typeof makeFakeRoot>;
let engineClosed = false;
let initSqliteCalls = 0;

type Handlers = typeof import('../opfsWorker/restoreStagingHandlers.js');
type Staging = typeof import('../opfsWorker/restoreStaging.js');

let handlers: Handlers;
let staging: Staging;

async function loadModules() {
  vi.resetModules();
  vi.doMock('../sqliteBoot.js', () => ({
    createEngine: vi.fn(async (_path: string, _url: string) => makeEngine(currentQueryFn)),
  }));
  handlers = await import('../opfsWorker/restoreStagingHandlers.js');
  staging = await import('../opfsWorker/restoreStaging.js');
  staging.setRestoreStagingDirProviderForTesting(async () => fakeRoot as unknown as FileSystemDirectoryHandle);
}

const CTX = {} as import('../opfsWorker/handlers.js').HandlerContext;

beforeEach(async () => {
  REMOVED.length = 0;
  fakeRoot = makeFakeRoot();
  currentQueryFn = makeQueryFn(false);
  engineClosed = false;
  initSqliteCalls = 0;
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    get: () => ({ getDirectory: async () => fakeRoot }),
  });
  await loadModules();
});

describe('STAGE_RESTORE_BEGIN', () => {
  it('issues a registered restore_incoming_ name and creates a truncated staging file', async () => {
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 100, totalChunks: 1 });
    expect(stagingName).toMatch(/^restore_incoming_[A-Za-z0-9-]{36}\.db$/);
    expect(staging.getRestoreStagingRecord(stagingName)).toBeDefined();
    expect(fakeRoot.files.get(stagingName)).toBe(0);
  });

  it('sweeps leftover staging files of previous sessions before issuing', async () => {
    fakeRoot.files.set('restore_incoming_00000000-0000-4000-8000-000000000000.db', 5);
    fakeRoot.files.set('yasumaro.db', 9);
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 100, totalChunks: 1 });
    expect(REMOVED).toContain('restore_incoming_00000000-0000-4000-8000-000000000000.db');
    expect(REMOVED).not.toContain('yasumaro.db');
    expect(fakeRoot.files.has('yasumaro.db')).toBe(true);
    expect(fakeRoot.files.has(stagingName)).toBe(true);
  });

  it.each([
    { totalBytes: 0, totalChunks: 1 },
    { totalBytes: -1, totalChunks: 1 },
    { totalBytes: 1, totalChunks: 0 },
  ])('rejects %p before touching OPFS', async (payload) => {
    await expect(handlers.handleStageRestoreBegin(CTX, payload)).rejects.toThrow(/must be a positive integer/);
    expect(fakeRoot.files.size).toBe(0);
  });
});

describe('STAGE_RESTORE_APPEND', () => {
  it('writes the chunk at its byte offset and reports the written count', async () => {
    // Adjusted in the Phase 5 integration: appends must follow the session's
    // offset progression (review hardening — a gap or overwrite behind the
    // size check can no longer be committed), so the write runs from 0 and a
    // second chunk continues at the expected offset.
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 6, totalChunks: 2 });
    const first = await handlers.handleStageRestoreAppend(CTX, {
      stagingName,
      offset: 0,
      data: new Uint8Array([10, 20]),
    });
    expect(first).toEqual({ written: 2 });
    const second = await handlers.handleStageRestoreAppend(CTX, {
      stagingName,
      offset: 2,
      data: new Uint8Array([30, 40]),
    });
    expect(second).toEqual({ written: 2 });
    // accesses[0] is begin's truncate handle; the append writes are the last two.
    expect(fakeRoot.accesses.at(-2)!.writes).toEqual([{ at: 0, length: 2 }]);
    expect(fakeRoot.accesses.at(-1)!.writes).toEqual([{ at: 2, length: 2 }]);
    expect(fakeRoot.files.get(stagingName)).toBe(4);
  });

  it('fail-closes on an append that skips ahead of the offset progression', async () => {
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 8, totalChunks: 2 });
    await handlers.handleStageRestoreAppend(CTX, { stagingName, offset: 0, data: new Uint8Array([1]) });
    await expect(
      handlers.handleStageRestoreAppend(CTX, { stagingName, offset: 4, data: new Uint8Array([1]) }),
    ).rejects.toThrow(/does not match the expected session offset/);
    // accesses[0] is begin's truncate handle; the rejected append never
    // opened a second handle. The accepted append is accesses[1].
    expect(fakeRoot.accesses).toHaveLength(2);
  });

  it('fail-closes on a name that was never issued', async () => {
    await expect(
      handlers.handleStageRestoreAppend(CTX, {
        stagingName: 'restore_incoming_00000000-0000-4000-8000-000000000000.db',
        offset: 0,
        data: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/Unknown restore staging file/);
    expect(fakeRoot.accesses).toHaveLength(0);
  });

  it('fail-closes on a negative offset', async () => {
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 4, totalChunks: 1 });
    await expect(
      handlers.handleStageRestoreAppend(CTX, { stagingName, offset: -1, data: new Uint8Array([1]) }),
    ).rejects.toThrow(/offset/);
  });
});

describe('STAGE_RESTORE_COMMIT', () => {
  const getEngine = () => null;
  const setEngine = () => undefined;
  const initSqlite = async () => { initSqliteCalls += 1; };

  async function beginAndFill(totalBytes: number): Promise<string> {
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes, totalChunks: 1 });
    await handlers.handleStageRestoreAppend(CTX, {
      stagingName,
      offset: 0,
      data: new Uint8Array(totalBytes),
    });
    return stagingName;
  }

  it('validates the staged file, swaps it onto the live DB path, and re-initializes', async () => {
    const stagingName = await beginAndFill(4);
    fakeRoot.files.set('yasumaro.db', 999);

    const result = await handlers.handleStageRestoreCommit(
      CTX, { stagingName, totalBytes: 4 }, getEngine, setEngine, initSqlite,
    );

    expect(result).toEqual({ committed: true });
    // Adjusted in the Phase 5 integration: the live DB is moved to a backup
    // name during the swap and the backup is removed after the swap succeeds,
    // so a failed move can no longer lose the live DB.
    expect(REMOVED).toContain('yasumaro.db.pre-restore');
    expect(REMOVED).not.toContain('yasumaro.db');
    expect(fakeRoot.files.has(stagingName)).toBe(false);
    expect(fakeRoot.files.get('yasumaro.db')).toBe(4);
    expect(initSqliteCalls).toBe(1);
    // The staging name is retired: a second commit is fail-closed.
    await expect(
      handlers.handleStageRestoreCommit(CTX, { stagingName, totalBytes: 4 }, getEngine, setEngine, initSqlite),
    ).rejects.toThrow(/Unknown restore staging file/);
  });

  it('rejects a staged size that does not match the declared totalBytes and keeps the live DB', async () => {
    // Declared size matches the session record, but only part of the bytes
    // arrived (a lost chunk) — the size check is what refuses the swap.
    // Adjusted in the Phase 5 integration: begin declares totalChunks: 1 so
    // the run reaches the size check (the chunk-count cross-check fires
    // first when the counts disagree — see the hardening tests).
    fakeRoot.files.set('yasumaro.db', 999);
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 4, totalChunks: 1 });
    await handlers.handleStageRestoreAppend(CTX, {
      stagingName,
      offset: 0,
      data: new Uint8Array(2),
    });

    await expect(
      handlers.handleStageRestoreCommit(CTX, { stagingName, totalBytes: 4 }, getEngine, setEngine, initSqlite),
    ).rejects.toThrow(/staged size \(2\) does not match declared totalBytes \(4\)/);

    expect(REMOVED).not.toContain('yasumaro.db');
    expect(fakeRoot.files.get('yasumaro.db')).toBe(999);
    expect(initSqliteCalls).toBe(0);
  });

  it('rejects a commit whose declared total differs from the session begin', async () => {
    const stagingName = await beginAndFill(4);
    await expect(
      handlers.handleStageRestoreCommit(CTX, { stagingName, totalBytes: 40 }, getEngine, setEngine, initSqlite),
    ).rejects.toThrow(/does not match the session's begin totalBytes/);
  });

  it('accepts an idempotent resend of the previous chunk without double-counting it', async () => {
    // A retry (RETRY_SAFE transport) re-sends the previous chunk; the
    // progression ledger must not inflate the chunk count, or the commit
    // would fail the totalChunks cross-check for a transport retry.
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 4, totalChunks: 2 });
    await handlers.handleStageRestoreAppend(CTX, { stagingName, offset: 0, data: new Uint8Array([1, 2]) });
    await handlers.handleStageRestoreAppend(CTX, { stagingName, offset: 0, data: new Uint8Array([1, 2]) });
    await handlers.handleStageRestoreAppend(CTX, { stagingName, offset: 2, data: new Uint8Array([3, 4]) });

    const result = await handlers.handleStageRestoreCommit(
      CTX, { stagingName, totalBytes: 4 }, getEngine, setEngine, initSqlite,
    );
    expect(result).toEqual({ committed: true });
  });

  it('rejects an archive-format staging file and keeps the live DB untouched', async () => {
    currentQueryFn = makeQueryFn(true);
    const stagingName = await beginAndFill(4);
    fakeRoot.files.set('yasumaro.db', 999);

    await expect(
      handlers.handleStageRestoreCommit(CTX, { stagingName, totalBytes: 4 }, getEngine, setEngine, initSqlite),
    ).rejects.toThrow(/Archive database detected/);

    expect(REMOVED).not.toContain('yasumaro.db');
    // The staging stays registered so the caller can abort it explicitly.
    expect(staging.getRestoreStagingRecord(stagingName)).toBeDefined();
  });

  it('fail-closes on a name that was never issued', async () => {
    await expect(
      handlers.handleStageRestoreCommit(
        CTX,
        { stagingName: 'restore_incoming_00000000-0000-4000-8000-000000000000.db', totalBytes: 4 },
        getEngine, setEngine, initSqlite,
      ),
    ).rejects.toThrow(/Unknown restore staging file/);
  });
});

describe('STAGE_RESTORE_ABORT', () => {
  it('removes the staging file and retires the name', async () => {
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 4, totalChunks: 1 });
    const result = await handlers.handleStageRestoreAbort(CTX, { stagingName });
    expect(result).toEqual({ aborted: true });
    expect(REMOVED).toContain(stagingName);
    expect(staging.getRestoreStagingRecord(stagingName)).toBeUndefined();
  });

  it('fail-closes on a name that was never issued', async () => {
    await expect(
      handlers.handleStageRestoreAbort(CTX, { stagingName: 'yasumaro.db' }),
    ).rejects.toThrow(/Unknown restore staging file/);
    expect(REMOVED).not.toContain('yasumaro.db');
  });
});
