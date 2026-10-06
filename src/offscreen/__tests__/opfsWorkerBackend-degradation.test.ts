// @vitest-environment jsdom
/**
 * opfsWorkerBackend-degradation.test.ts
 *
 * The adapter half of the runtime-degradation seam, fault-injected at the
 * worker boundary: a proxy that answers null. What is pinned here:
 *   - the consecutive-failure counter and the one-shot degrade signal;
 *   - that a single failure, or failures broken by a success, never degrade;
 *   - that every method folds its null into the one reason constant.
 *
 * The host half (re-resolution, latching, logging) lives in
 * opfsDegradation.integration.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  OpfsWorkerBackend,
  OPFS_WORKER_UNAVAILABLE_ERROR,
  OPFS_DEGRADE_FAILURE_THRESHOLD,
} from '../OpfsWorkerBackend.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

const deadWorkerRecord: BrowsingLogRecord = { url: 'https://example.com/', created_at: 1 };

type Reply = (type: string) => unknown;

/** A backend whose worker proxy answers whatever `reply` returns. */
function makeBackend(reply: Reply, onDegraded: () => unknown = () => {}) {
  const tryOpfsProxy = vi.fn(async (type: string) => reply(type));
  return {
    backend: new OpfsWorkerBackend({ tryOpfsProxy } as never, onDegraded),
    tryOpfsProxy,
  };
}

/** A proxy that answers null `failures` times, then succeeds forever. */
function failsThenRecovers(failures: number): Reply {
  let seen = 0;
  return () => (seen++ < failures ? null : { count: 1 });
}

describe('OpfsWorkerBackend — consecutive-failure counter', () => {
  it('does not degrade on a single failure when the next call succeeds', async () => {
    const onDegraded = vi.fn();
    const { backend } = makeBackend(failsThenRecovers(1), onDegraded);

    expect(await backend.getCount()).toEqual({ success: false, error: OPFS_WORKER_UNAVAILABLE_ERROR });
    await expect(backend.getCount()).resolves.toEqual({ success: true, count: 1 });

    expect(onDegraded).not.toHaveBeenCalled();
  });

  it('resets the counter when a success lands between failures', async () => {
    const onDegraded = vi.fn();
    const { backend } = makeBackend(failsThenRecovers(2), onDegraded);

    // Two failures, one success, two failures: never N in a row.
    for (let i = 0; i < 5; i++) await backend.getCount();

    expect(onDegraded).not.toHaveBeenCalled();
  });

  it(`signals exactly once at ${OPFS_DEGRADE_FAILURE_THRESHOLD} consecutive failures`, async () => {
    const onDegraded = vi.fn();
    const { backend } = makeBackend(() => null, onDegraded);

    for (let i = 0; i < OPFS_DEGRADE_FAILURE_THRESHOLD - 1; i++) {
      await backend.getCount();
    }
    expect(onDegraded).not.toHaveBeenCalled();

    await backend.getCount();
    expect(onDegraded).toHaveBeenCalledOnce();

    // A dead worker answers null forever; the signal must not repeat, or the
    // host would re-run a re-resolution per operation.
    await backend.getCount();
    await backend.getCount();
    expect(onDegraded).toHaveBeenCalledOnce();
  });

  it('counts failures across different worker messages, not per method', async () => {
    const onDegraded = vi.fn();
    const { backend } = makeBackend(() => null, onDegraded);

    await backend.getCount();
    await backend.query({ limit: 10 });
    await backend.serialize();

    expect(onDegraded).toHaveBeenCalledOnce();
  });

  it('reports the ordinary failure when the degrade signal itself rejects', async () => {
    const onDegraded = vi.fn().mockRejectedValue(new Error('re-resolve blew up'));
    const { backend } = makeBackend(() => null, onDegraded);

    // The host logs its own failure; the operation must still come back as a
    // result object rather than a throw.
    for (let i = 0; i < OPFS_DEGRADE_FAILURE_THRESHOLD; i++) {
      await expect(backend.getCount()).resolves.toEqual({
        success: false,
        error: OPFS_WORKER_UNAVAILABLE_ERROR,
      });
    }
    expect(onDegraded).toHaveBeenCalledOnce();
  });

  it('awaits the degrade signal before returning the failed call', async () => {
    let finished = false;
    const onDegraded = vi.fn(async () => {
      await Promise.resolve();
      finished = true;
    });
    const { backend } = makeBackend(() => null, onDegraded);

    for (let i = 0; i < OPFS_DEGRADE_FAILURE_THRESHOLD; i++) await backend.getCount();

    // Fire-and-forget would let the next operation pick the dead backend out of
    // the cache again; awaiting makes the re-resolution complete first.
    expect(finished).toBe(true);
  });

  it('leaves the adapter usable without a degrade signal', async () => {
    const { backend } = makeBackend(() => null);

    await expect(backend.getCount()).resolves.toEqual({
      success: false,
      error: OPFS_WORKER_UNAVAILABLE_ERROR,
    });
  });

  it('counts the restore and health misses too, though they report another reason', async () => {
    const onDegraded = vi.fn();
    const { backend } = makeBackend(() => null, onDegraded);

    // Their own wording must not also exempt them from the streak: a worker
    // that cannot answer a health probe is the same dead worker.
    await backend.healthCheck();
    await backend.restoreDb(new Uint8Array([1]));
    await backend.healthCheck();

    expect(onDegraded).toHaveBeenCalledOnce();
  });

  it('counts mutation failures toward the degrade ladder too', async () => {
    const onDegraded = vi.fn();
    const { backend } = makeBackend(() => null, onDegraded);

    for (let i = 0; i < OPFS_DEGRADE_FAILURE_THRESHOLD; i++) {
      await expect(backend.insert(deadWorkerRecord)).resolves.toEqual({
        success: false,
        error: OPFS_WORKER_UNAVAILABLE_ERROR,
      });
    }
    expect(onDegraded).toHaveBeenCalledOnce();
  });

  it('counts mutation failures across methods, not per method', async () => {
    const onDegraded = vi.fn();
    const { backend } = makeBackend(() => null, onDegraded);

    await backend.insert(deadWorkerRecord);
    await backend.update(1, { title: 'x' });
    await backend.toggleStar(1);

    expect(onDegraded).toHaveBeenCalledOnce();
  });
});

describe('OpfsWorkerBackend — one unavailable-reason constant', () => {
  it('pins the constant value other modules match on', () => {
    expect(OPFS_WORKER_UNAVAILABLE_ERROR).toBe('OPFS Worker unavailable');
  });

  const proxyMethods: Array<[string, (b: OpfsWorkerBackend) => Promise<unknown>]> = [
    ['getCount', (b) => b.getCount()],
    ['getStatus', (b) => b.getStatus()],
    ['query', (b) => b.query({ limit: 10 })],
    ['serialize', (b) => b.serialize()],
    ['backupDb', (b) => b.backupDb()],
    ['purgeOldRecords', (b) => b.purgeOldRecords(7, 100)],
    ['purgeContent', (b) => b.purgeContent(7, 100)],
    ['purgeAuditLog', (b) => b.purgeAuditLog(7)],
    ['getFtsIndexSize', (b) => b.getFtsIndexSize()],
    ['queryAuditLog', (b) => b.queryAuditLog({ limit: 10 })],
    ['archiveStatus', (b) => b.archiveStatus()],
    ['archiveCreate', (b) => b.archiveCreate({ cutoffDate: '2026-09-01', cutoffMs: 1, includeDeleted: false, yasumaroVersion: '1' })],
    ['insert', (b) => b.insert(deadWorkerRecord)],
    ['insertBatch', (b) => b.insertBatch([deadWorkerRecord])],
    ['update', (b) => b.update(1, { title: 'x' })],
    ['delete', (b) => b.delete(1)],
    ['toggleStar', (b) => b.toggleStar(1)],
    ['insertAuditLog', (b) => b.insertAuditLog({ provider: 'openai', url: 'https://example.com/', created_at: 1 })],
    ['clearAll', (b) => b.clearAll()],
  ];

  it.each(proxyMethods)('%s reports the shared reason when the worker is gone', async (_name, call) => {
    const { backend } = makeBackend(() => null);

    await expect(call(backend)).resolves.toEqual({
      success: false,
      error: OPFS_WORKER_UNAVAILABLE_ERROR,
    });
  });

  // These two answer with a different reason on purpose — a failed restore and a
  // failed health probe are their own diagnoses, not "the worker is gone".
  it('keeps the restore and health reasons separate', async () => {
    const { backend } = makeBackend(() => null);

    await expect(backend.restoreDb(new Uint8Array([1]))).resolves.toEqual({
      success: false,
      error: 'Binary restore failed',
    });
    await expect(backend.healthCheck()).resolves.toEqual({
      success: false,
      error: 'Health check failed',
    });
  });
});
