// @vitest-environment jsdom
/**
 * opfsDegradation.integration.test.ts
 *
 * The host half of the runtime-degradation seam. A scripted OPFS worker is
 * installed on a real SqliteEngineHost, so the whole production path runs for
 * real: OpfsWorkerBackend's counter → the injected signal →
 * SqliteEngineHost.degradeFromOpfs() → the init ladder without its OPFS rung →
 * resolveBackend → the next getBackend().
 *
 * Fault injection is the worker's own reply: a dead worker answers each
 * request with a failure, which is what tryOpfsProxy folds into null. The
 * destination engines are stubbed — standing up the IDB WASM engine is not
 * what this seam is about, and initIdbEngine is mocked the same way the
 * host coverage suite mocks it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// addLog is the sink the criterion names, so it is spied at the source rather
// than at logger/api: everything the host logs must arrive there.
const addLogSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../utils/logger/core.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/logger/core.js')>();
  return { ...actual, addLog: addLogSpy };
});

const mockInitIdbEngine = vi.hoisted(() => vi.fn());
vi.mock('../sqliteEngineContext/idbEngineLifecycle.js', () => ({
  DB_FILENAME: 'yasumaro.db',
  initIdbEngine: (...args: unknown[]) => mockInitIdbEngine(...args),
  execWithCache: vi.fn().mockResolvedValue(undefined),
}));

// PBI-05: the host's public state accessors are gone. The suite observes the
// ladder's state transitions through the state object the host hands its
// context modules — captured by wrapping the real initOpfsWorker (call-through,
// so the OPFS routing stays the real one).
let hostState: {
  opfsWorker: unknown;
  _backend: unknown;
  usingFallbackStorage: boolean;
  fallbackStorage: unknown;
} | null = null;
vi.mock('../sqliteEngineContext/opfsWorkerProxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sqliteEngineContext/opfsWorkerProxy.js')>();
  return {
    ...actual,
    initOpfsWorker: async (state: NonNullable<typeof hostState>) => {
      hostState = state;
      return actual.initOpfsWorker(state);
    },
  };
});

vi.mock('../sqliteEngineContext/migrationBackup.js', () => ({
  runMigrationBackup: vi.fn().mockResolvedValue(undefined),
  runMigrationRestore: vi.fn().mockResolvedValue(undefined),
  extractDomain: (url: string) => url,
}));

vi.mock('../sqliteEngineContext/fallbackMigration.js', () => ({
  tryMigrateFallbackToSqlite: vi.fn().mockResolvedValue(undefined),
}));

const idbBackend = vi.hoisted(() => ({
  kind: 'idb',
  getCount: vi.fn().mockResolvedValue({ success: true, count: 42 }),
}));
vi.mock('../IdbVfsBackend.js', () => ({
  IdbVfsBackend: class { constructor() { return idbBackend as never; } },
}));

const fallbackBackend = vi.hoisted(() => ({
  kind: 'fallback',
  getCount: vi.fn().mockResolvedValue({ success: true, count: 7 }),
}));
vi.mock('../FallbackStorageAdapter.js', () => ({
  FallbackStorageAdapter: class { constructor() { return fallbackBackend as never; } },
}));

import { SqliteEngineHost } from '../sqliteEngineHost.js';
import { setOpfsWorkerFactory } from '../sqliteEngineContext/opfsWorkerProxy.js';
import {
  OpfsWorkerBackend,
  OPFS_WORKER_UNAVAILABLE_ERROR,
  OPFS_DEGRADE_FAILURE_THRESHOLD,
} from '../OpfsWorkerBackend.js';

/**
 * A worker whose replies are switchable. `dead` answers with a failure, which
 * is how a worker that died mid-session looks to tryOpfsProxy: a rejected call
 * folded into null. INIT answers `initialized` so the real init ladder accepts
 * it, and everything else answers `result`.
 *
 * Installed through setOpfsWorkerFactory + host.init() rather than assigned to
 * host.opfsWorker, so createOpfsWorker's reply routing is the real one.
 */
function scriptedWorker() {
  const state: {
    dead: boolean;
    result: unknown;
    onmessage: ((e: { data: unknown }) => void) | null;
    onerror: ((e: { message: string }) => void) | null;
    terminate: () => void;
    postMessage: (msg: { id: number; type: string }) => void;
  } = {
    dead: false,
    result: { count: 1 },
    onmessage: null,
    onerror: null,
    terminate: vi.fn(),
    postMessage: (msg) => {
      if (state.dead) {
        state.onmessage?.({ data: { id: msg.id, success: false, error: 'worker gone' } });
        return;
      }
      const result = msg.type === 'INIT' ? { initialized: true } : state.result;
      state.onmessage?.({ data: { id: msg.id, success: true, result } });
    },
  };
  return state;
}

/** The two capability probes initOpfsWorker runs before creating a worker. */
function enableOpfs(): void {
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: { getDirectory: vi.fn().mockResolvedValue({}) },
    configurable: true,
    writable: true,
  } as unknown as PropertyDescriptor);
  (globalThis as unknown as { Worker: unknown }).Worker = class {};
}


/** IDB engine that comes up, so the ladder settles on 'idb'. */
function idbSucceeds(): void {
  mockInitIdbEngine.mockImplementation(async (state: { idbEngine: unknown }) => {
    state.idbEngine = {} as never;
    return true;
  });
}

/** IDB engine that stays down, so the ladder has to fall through. */
function idbFails(): void {
  mockInitIdbEngine.mockImplementation(async (state: { idbEngine: unknown; lastInitError: string }) => {
    state.idbEngine = null;
    state.lastInitError = 'WASM unavailable';
    return false;
  });
}

/** A host already serving the OPFS worker, with its backend resolved. */
async function hostOnOpfs() {
  enableOpfs();
  const worker = scriptedWorker();
  setOpfsWorkerFactory(() => worker as unknown as Worker);
  const host = new SqliteEngineHost();
  await expect(host.init()).resolves.toBe(true);
  const backend = await host.getBackend();
  expect(backend).toBeInstanceOf(OpfsWorkerBackend);
  return { host, worker, backend };
}

/** Kill the worker mid-session. */
function kill(worker: ReturnType<typeof scriptedWorker>): void {
  worker.dead = true;
}

/** Drive the adapter until the threshold trips. */
async function failUntilDegraded(backend: OpfsWorkerBackend): Promise<void> {
  for (let i = 0; i < OPFS_DEGRADE_FAILURE_THRESHOLD; i++) {
    await expect(backend.getCount()).resolves.toEqual({
      success: false,
      error: OPFS_WORKER_UNAVAILABLE_ERROR,
    });
  }
}

describe('OPFS worker dies mid-session — runtime degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addLogSpy.mockResolvedValue(undefined);
    idbBackend.getCount.mockResolvedValue({ success: true, count: 42 });
    fallbackBackend.getCount.mockResolvedValue({ success: true, count: 7 });
    idbSucceeds();
  });

  it('re-resolves to IDB and keeps serving operations', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);

    await failUntilDegraded(backend);

    const next = await host.getBackend();
    expect(next).toBe(idbBackend);
    expect(await next.getCount()).toEqual({ success: true, count: 42 });
    // The dead worker is gone from the host, not merely bypassed.
    expect(hostState?.opfsWorker).toBeNull();
  });

  it('terminates the dead worker and clears the cached backend', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    const cached = hostState?._backend;
    kill(worker);

    await failUntilDegraded(backend);

    expect(worker.terminate).toHaveBeenCalled();
    expect(hostState?._backend).toBeNull();
  });

  it('records the degradation through addLog', async () => {
    const { worker, backend } = await hostOnOpfs();
    kill(worker);

    await failUntilDegraded(backend);

    expect(addLogSpy).toHaveBeenCalledWith(
      'WARN',
      'SQLite: OPFS worker degraded, backend re-resolved',
      expect.objectContaining({ resolvedTo: 'idb', _source: 'sqlite' })
    );
  });

  it('stays on OPFS when a failure is not followed by more of them', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    const opfs = backend as OpfsWorkerBackend;

    // Two failures, a success, then one more: the counter resets in between,
    // so the session must not be migrated off a worker that is still there.
    await opfs.getCount();
    await opfs.getCount();
    expect(await opfs.getCount()).toEqual({ success: true, count: 1 });
    await opfs.getCount();

    expect(await host.getBackend()).toBe(opfs);
    expect(hostState?.opfsWorker).not.toBeNull();
  });

  it('sends a repeated signal past the IDB rung instead of re-running it', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);

    await failUntilDegraded(backend);
    expect(mockInitIdbEngine).toHaveBeenCalledOnce();

    // A second signal means the rung it landed on is failing too. Re-running the
    // IDB ladder would only repeat a decision that already failed, so the host
    // descends the rest of the way to fallback storage instead.
    const again = await host.degradeFromOpfs();
    expect(again).toBe('fallback');
    expect(mockInitIdbEngine).toHaveBeenCalledOnce();
    expect(hostState?.usingFallbackStorage).toBe(true);
  });

  it('never climbs back to OPFS and never re-enters the ladder afterwards', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);
    await failUntilDegraded(backend);

    await host.degradeFromOpfs();
    expect(await host.getBackend()).toBe(fallbackBackend);

    // Third and later signals are inert: no new fallback storage, no flap.
    const fallbackStorage = hostState?.fallbackStorage;
    expect(await host.degradeFromOpfs()).toBe('fallback');
    expect(hostState?.fallbackStorage).toBe(fallbackStorage);
  });

  it('falls through to fallback storage when IDB cannot come up', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);
    idbFails();

    await failUntilDegraded(backend);

    const next = await host.getBackend();
    expect(next).toBe(fallbackBackend);
    expect(await next.getCount()).toEqual({ success: true, count: 7 });
  });

  it('degrades exactly once even when the fallback path is the destination', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);
    idbFails();

    await failUntilDegraded(backend);
    expect(mockInitIdbEngine).toHaveBeenCalledOnce();

    expect(await host.degradeFromOpfs()).toBe('fallback');
    expect(mockInitIdbEngine).toHaveBeenCalledOnce();
  });

  it('re-opens the degradation latch for a fresh host', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);
    await failUntilDegraded(backend);

    host.resetForTesting();
    idbSucceeds();
    enableOpfs();
    setOpfsWorkerFactory(() => scriptedWorker() as unknown as Worker);
    await host.init();
    await host.getBackend();

    // Without the reset the latch would suppress the signal for the rest of the
    // document's life, so the test seam has to clear it too.
    expect(await host.degradeFromOpfs()).toBe('idb');
    expect(mockInitIdbEngine).toHaveBeenCalledTimes(2);
  });

  it('logs and stays put when the ladder cannot be re-entered', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);
    idbFails();

    await failUntilDegraded(backend);

    // The failed call still returned a result object; the re-resolve outcome
    // was reported instead of thrown at the operation.
    expect(addLogSpy).toHaveBeenCalledWith(
      'WARN',
      'SQLite: OPFS worker degraded, backend re-resolved',
      expect.objectContaining({ resolvedTo: 'fallback' })
    );
    expect(hostState?.usingFallbackStorage).toBe(true);
  });

  it('drops the cached adapter even when the re-resolution itself fails', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);
    // A worker that refuses to terminate stands in for any failure the ladder
    // walk itself can hit — the point is that the dead adapter does not outlive
    // a re-resolution that did not complete.
    worker.terminate = () => {
      throw new Error('terminate blew up');
    };

    for (let i = 0; i < OPFS_DEGRADE_FAILURE_THRESHOLD; i++) {
      await backend.getCount();
    }

    expect(addLogSpy).toHaveBeenCalledWith(
      'ERROR',
      'SQLite: OPFS degradation re-resolve failed',
      expect.objectContaining({ error: 'terminate blew up' })
    );
    expect(hostState?._backend).toBeNull();
  });

  it('joins concurrent signals into a single ladder run', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);

    for (let i = 0; i < OPFS_DEGRADE_FAILURE_THRESHOLD - 1; i++) {
      await backend.getCount();
    }

    // The threshold-crossing call signals while another caller asks directly.
    // Both must observe one run — and the join must not read as a second
    // degradation that would descend to fallback storage.
    const [, resolved] = await Promise.all([backend.getCount(), host.degradeFromOpfs()]);

    expect(resolved).toBe('idb');
    expect(mockInitIdbEngine).toHaveBeenCalledOnce();
    expect(hostState?.usingFallbackStorage).toBe(false);
  });

  it('does not re-create an OPFS worker on a later init()', async () => {
    const { host, worker, backend } = await hostOnOpfs();
    kill(worker);

    await failUntilDegraded(backend);

    await host.init();

    // init() takes the idbEngine early return, so the dead rung is never walked
    // again — that is what keeps the backend from climbing back to OPFS.
    expect(hostState?.opfsWorker).toBeNull();
    expect(mockInitIdbEngine).toHaveBeenCalledOnce();
  });
});
