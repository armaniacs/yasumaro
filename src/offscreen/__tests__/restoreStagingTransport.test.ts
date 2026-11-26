/**
 * restoreStagingTransport.test.ts (PBI 2026-11-26-10)
 *
 * Pins the restore staging seam split out of StorageBackend:
 * - `supportsRestoreStaging` narrows to OPFS only (instanceof single rule):
 *   true for OpfsWorkerBackend, false for every other adapter.
 * - Non-OPFS backends carry NO restore staging methods; the recordsRepo
 *   delegation fails closed with the exact pre-refactor error (constant
 *   wording, `{ success: false; error: string }` shape) and never reaches a
 *   backend method.
 * - The OPFS path delegates unchanged through recordsRepo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoopBackend, RESTORE_STAGING_UNSUPPORTED_ERROR } from '../StorageBackend.js';
import { OpfsWorkerBackend } from '../OpfsWorkerBackend.js';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { FallbackStorageAdapter } from '../FallbackStorageAdapter.js';
import { supportsRestoreStaging } from '../restoreStagingTransport.js';

const engineMock = vi.hoisted(() => ({
  getBackend: vi.fn(),
}));

vi.mock('../sqliteEngineHost.js', () => ({
  engine: engineMock,
  DB_FILENAME: 'yasumaro.db',
  MAX_QUERY_LIMIT: 100000,
  // Only referenced inside adapter methods this test never calls.
  extractDomain: () => '',
  SqliteEngineHost: class {},
}));

import {
  restorePrepareIncoming,
  restoreAppend,
  restoreCommit,
  restoreAbort,
} from '../recordsRepo.js';

const STAGING = 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';

/** An OpfsWorkerBackend whose worker proxy answers one canned value per call. */
function makeOpfsBackend(result: unknown): { backend: OpfsWorkerBackend; proxy: ReturnType<typeof vi.fn> } {
  const proxy = vi.fn(async () => result);
  return { backend: new OpfsWorkerBackend({ tryOpfsProxy: proxy } as never), proxy };
}

beforeEach(() => {
  engineMock.getBackend.mockReset();
});

describe('supportsRestoreStaging narrowing', () => {
  it('narrows an OpfsWorkerBackend to RestoreStagingTransport (OPFS: true)', () => {
    const { backend } = makeOpfsBackend(null);
    expect(supportsRestoreStaging(backend)).toBe(true);
  });

  it.each([
    ['NoopBackend', () => new NoopBackend()],
    ['IdbVfsBackend', () => new IdbVfsBackend({ idbEngine: null, fts5Available: false, cachedCompileOptions: null } as never)],
    ['FallbackStorageAdapter', () => new FallbackStorageAdapter({} as never)],
  ])('rejects a non-OPFS backend (%s): false', (_name, make) => {
    expect(supportsRestoreStaging(make())).toBe(false);
  });

  it('makes the 4 staging methods callable on the narrowed type only', async () => {
    const { backend, proxy } = makeOpfsBackend({ stagingName: STAGING, written: 2 });
    if (!supportsRestoreStaging(backend)) {
      throw new Error('narrowing failed');
    }
    await backend.restorePrepareIncoming(4, 1);
    await backend.restoreAppend(STAGING, 0, new Uint8Array([1]));
    await backend.restoreCommit(STAGING, 4);
    await backend.restoreAbort(STAGING);
    expect(proxy).toHaveBeenCalledTimes(4);
  });
});

describe('StorageBackend common interface carries no restore staging methods', () => {
  it('NoopBackend exposes none of the 4 methods at runtime', () => {
    const noop = new NoopBackend() as unknown as Record<string, unknown>;
    for (const method of ['restorePrepareIncoming', 'restoreAppend', 'restoreCommit', 'restoreAbort']) {
      expect(noop[method]).toBeUndefined();
    }
  });
});

describe('recordsRepo delegation — fail-closed outside the narrowing', () => {
  it.each([
    ['restorePrepareIncoming', () => restorePrepareIncoming(8, 1)],
    ['restoreAppend', () => restoreAppend(STAGING, 0, new Uint8Array([1]))],
    ['restoreCommit', () => restoreCommit(STAGING, 8)],
    ['restoreAbort', () => restoreAbort(STAGING)],
  ])('%s returns the pre-refactor unsupported error on a non-OPFS backend', async (_name, call) => {
    engineMock.getBackend.mockResolvedValue(new NoopBackend());
    await expect(call()).resolves.toEqual({ success: false, error: RESTORE_STAGING_UNSUPPORTED_ERROR });
  });

  it('never reaches a non-OPFS backend even when it somehow carries staging methods', async () => {
    const backend = {
      restorePrepareIncoming: vi.fn(),
      restoreAppend: vi.fn(),
      restoreCommit: vi.fn(),
      restoreAbort: vi.fn(),
    };
    engineMock.getBackend.mockResolvedValue(backend);
    await restorePrepareIncoming(8, 1);
    await restoreAppend(STAGING, 0, new Uint8Array([1]));
    await restoreCommit(STAGING, 8);
    await restoreAbort(STAGING);
    for (const method of Object.values(backend)) {
      expect(method).not.toHaveBeenCalled();
    }
  });
});

describe('recordsRepo delegation — OPFS path unchanged', () => {
  it('restorePrepareIncoming delegates to the OPFS worker and returns the staging name', async () => {
    const { backend, proxy } = makeOpfsBackend({ stagingName: STAGING });
    engineMock.getBackend.mockResolvedValue(backend);
    await expect(restorePrepareIncoming(8, 1)).resolves.toEqual({ success: true, stagingName: STAGING });
    expect(proxy).toHaveBeenCalledWith('STAGE_RESTORE_BEGIN', { totalBytes: 8, totalChunks: 1 });
  });

  it('restoreAppend delegates and reports the written count', async () => {
    const { backend, proxy } = makeOpfsBackend({ written: 2 });
    engineMock.getBackend.mockResolvedValue(backend);
    const data = new Uint8Array([10, 20]);
    await expect(restoreAppend(STAGING, 0, data)).resolves.toEqual({ success: true, written: 2 });
    expect(proxy).toHaveBeenCalledWith('STAGE_RESTORE_APPEND', { stagingName: STAGING, offset: 0, data });
  });

  it('restoreCommit and restoreAbort delegate and return bare success', async () => {
    const { backend, proxy } = makeOpfsBackend({});
    engineMock.getBackend.mockResolvedValue(backend);
    await expect(restoreCommit(STAGING, 8)).resolves.toEqual({ success: true });
    await expect(restoreAbort(STAGING)).resolves.toEqual({ success: true });
    expect(proxy).toHaveBeenCalledWith('STAGE_RESTORE_COMMIT', { stagingName: STAGING, totalBytes: 8 });
    expect(proxy).toHaveBeenCalledWith('STAGE_RESTORE_ABORT', { stagingName: STAGING });
  });
});
