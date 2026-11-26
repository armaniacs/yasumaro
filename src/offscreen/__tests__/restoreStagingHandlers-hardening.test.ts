/**
 * restoreStagingHandlers-hardening.test.ts
 * Phase 5 hardening expectations from the 2026-11-26 checking-team review of
 * the chunked restore session, pinned at the handler level:
 *   1. the session declares a total-size ceiling (symmetric with the
 *      encrypted-backup file budget) and append stays inside it —
 *      Red Team / Blue Team / System Architect / SRE / API Contract.
 *   2. commit cross-checks the received chunk count against the declared
 *      totalChunks — Red Team / Legacy Bridge / Domain Logic.
 *
 * The guarded live-DB swap (backup the live DB, move the staging file in,
 * roll back on failure, clean up the backup after success) is unit-tested in
 * restoreSwap.test.ts against the extracted engine-independent
 * swapVerifiedStagingIntoLive procedure.
 *
 * The boundary constant used here is MAX_BACKUP_FILE_BYTES (50 MiB, the
 * create-side gate); if a dedicated SSOT constant replaces it, swap the
 * import — the semantic boundary being pinned is "the encrypted-backup
 * budget".
 *
 * Fakes mirror restoreStagingHandlers.test.ts; no real OPFS is touched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DB_FILENAME } from '../dbFilename.js';
import { MAX_BACKUP_FILE_BYTES } from '../../utils/limits.js';
import { DashboardSqliteValidator, ValidationError } from '../../messaging/validators.js';

interface FakeAccess {
  writes: Array<{ at: number | undefined; length: number }>;
  truncate: (size: number) => void;
  write: (data: ArrayBuffer, options?: { at?: number }) => number;
  flush: () => void;
  close: () => void;
}

const REMOVED: string[] = [];

function makeFakeRoot(options: { failMoveFor?: (name: string) => boolean } = {}) {
  const files = new Map<string, number>();
  const accesses: FakeAccess[] = [];
  const failMoveFor = options.failMoveFor ?? (() => false);
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
          if (failMoveFor(name)) {
            throw new Error('Simulated move failure (quota exhausted)');
          }
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

function makeQueryFn(archiveTablePresent: boolean): QueryFn {
  return async (sql: string) => {
    if (sql.includes("name = 'yasumaro_archive_meta'")) {
      return archiveTablePresent ? [{ name: 'yasumaro_archive_meta' }] : [];
    }
    if (sql.includes("type = 'trigger'")) return [];
    if (sql.includes('count(*)')) return [{ c: 2 }];
    return [];
  };
}

let currentQueryFn: QueryFn = makeQueryFn(false);
let fakeRoot: ReturnType<typeof makeFakeRoot>;
let moveFailTarget: string | null;
let initSqliteCalls = 0;

type Handlers = typeof import('../opfsWorker/restoreStagingHandlers.js');
type Staging = typeof import('../opfsWorker/restoreStaging.js');

let handlers: Handlers;
let staging: Staging;

async function loadModules() {
  vi.resetModules();
  vi.doMock('../sqliteBoot.js', () => ({
    createEngine: vi.fn(async (_path: string, _url: string) => ({
      exec: async (_sql: string) => undefined,
      query: currentQueryFn,
      close: async () => undefined,
    })),
  }));
  handlers = await import('../opfsWorker/restoreStagingHandlers.js');
  staging = await import('../opfsWorker/restoreStaging.js');
  staging.setRestoreStagingDirProviderForTesting(async () => fakeRoot as unknown as FileSystemDirectoryHandle);
}

const CTX = {} as import('../opfsWorker/handlers.js').HandlerContext;
const getEngine = () => null;
const setEngine = () => undefined;
const initSqlite = async () => { initSqliteCalls += 1; };

async function beginAndFill(totalBytes: number, totalChunks = 1): Promise<string> {
  const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes, totalChunks });
  await handlers.handleStageRestoreAppend(CTX, {
    stagingName,
    offset: 0,
    data: new Uint8Array(totalBytes),
  });
  return stagingName;
}

beforeEach(async () => {
  REMOVED.length = 0;
  moveFailTarget = null;
  initSqliteCalls = 0;
  currentQueryFn = makeQueryFn(false);
  fakeRoot = makeFakeRoot({ failMoveFor: (name) => name === moveFailTarget });
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    get: () => ({ getDirectory: async () => fakeRoot }),
  });
  await loadModules();
});

describe('restore session size ceiling (Phase 5 hardening expectation — RED until the fix lands)', () => {
  it('rejects a begin whose totalBytes exceeds the encrypted-backup budget before touching OPFS', async () => {
    await expect(
      handlers.handleStageRestoreBegin(CTX, { totalBytes: MAX_BACKUP_FILE_BYTES + 1, totalChunks: 1 }),
    ).rejects.toThrow(/totalBytes/);
    expect(fakeRoot.files.size).toBe(0);
  });

  it('accepts a begin at the exact encrypted-backup budget', async () => {
    const { stagingName } = await handlers.handleStageRestoreBegin(
      CTX, { totalBytes: MAX_BACKUP_FILE_BYTES, totalChunks: 1 },
    );
    expect(staging.getRestoreStagingRecord(stagingName)).toBeDefined();
  });

  it('rejects an append chunk that would extend past the declared totalBytes without writing', async () => {
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 4, totalChunks: 1 });
    const accessCountBefore = fakeRoot.accesses.length;

    await expect(
      handlers.handleStageRestoreAppend(CTX, {
        stagingName,
        offset: 2,
        data: new Uint8Array(4),
      }),
    ).rejects.toThrow(/totalBytes/);

    // No write may reach the staging file for an out-of-budget chunk
    // (accesses[0] is begin's truncate handle).
    expect(fakeRoot.accesses.length).toBe(accessCountBefore);
    expect(fakeRoot.files.get(stagingName)).toBe(0);
  });

  it('accepts an append chunk that ends exactly at the declared totalBytes', async () => {
    // Adjusted during the Phase 5 integration: the fix adopts strict offset
    // progression (an append must start at the session's expected offset, a
    // retry may only re-send the previous chunk), so the boundary case runs
    // from offset 0 — the boundary being pinned ("ends exactly at
    // totalBytes") is unchanged.
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 4, totalChunks: 1 });
    const result = await handlers.handleStageRestoreAppend(CTX, {
      stagingName,
      offset: 0,
      data: new Uint8Array(4),
    });
    expect(result).toEqual({ written: 4 });
    expect(fakeRoot.files.get(stagingName)).toBe(4);
  });

  it('caps totalBytes on the wire for restore_begin and restore_commit', () => {
    const v = new DashboardSqliteValidator();
    expect(() =>
      v.validate({ subtype: 'restore_begin', totalBytes: MAX_BACKUP_FILE_BYTES + 1, totalChunks: 1 }),
    ).toThrow(ValidationError);
    expect(() =>
      v.validate({
        subtype: 'restore_commit',
        stagingName: 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db',
        totalBytes: MAX_BACKUP_FILE_BYTES + 1,
      }),
    ).toThrow(ValidationError);
  });
});

describe('totalChunks cross-check at commit (Phase 5 hardening expectation — RED until the fix lands)', () => {
  it('rejects a commit that received fewer chunks than declared even when the size matches', async () => {
    // One oversized append reaches declared totalBytes, but the session
    // declared 2 chunks — a missing chunk hidden by overlapping writes must
    // not pass the size check alone.
    fakeRoot.files.set(DB_FILENAME, 999);
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 4, totalChunks: 2 });
    await handlers.handleStageRestoreAppend(CTX, {
      stagingName,
      offset: 0,
      data: new Uint8Array(4),
    });

    await expect(
      handlers.handleStageRestoreCommit(CTX, { stagingName, totalBytes: 4 }, getEngine, setEngine, initSqlite),
    ).rejects.toThrow(/totalChunks/);

    expect(fakeRoot.files.get(DB_FILENAME)).toBe(999);
    expect(initSqliteCalls).toBe(0);
  });

  it('accepts a commit that received exactly the declared chunk count', async () => {
    const { stagingName } = await handlers.handleStageRestoreBegin(CTX, { totalBytes: 4, totalChunks: 2 });
    await handlers.handleStageRestoreAppend(CTX, { stagingName, offset: 0, data: new Uint8Array(2) });
    await handlers.handleStageRestoreAppend(CTX, { stagingName, offset: 2, data: new Uint8Array(2) });

    const result = await handlers.handleStageRestoreCommit(
      CTX, { stagingName, totalBytes: 4 }, getEngine, setEngine, initSqlite,
    );
    expect(result).toEqual({ committed: true });
    expect(fakeRoot.files.get(DB_FILENAME)).toBe(4);
  });
});
