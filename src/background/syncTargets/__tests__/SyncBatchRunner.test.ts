/**
 * SyncBatchRunner.test.ts
 * Relocated batch-policy pins (PBI 2026-10-24-05): the SyncBatchRunner module
 * was folded into gistSyncTarget.ts as an internal seam, so these pins drive
 * the public GistSyncTarget.syncBatch seam instead of runner ports.
 * Policy under test: default batch size 50, empty-batch stop, zero-progress
 * stop, max-iterations cap, error propagation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetAll = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());

import { GistSyncTarget } from '../gistSyncTarget.js';

// WHY: fetchWithTimeout runs a CSP gate that resolves settings through the
// shared settingsRepository singleton. Mock the module (same pattern as the
// gistSyncTarget suite) so the gate and the default reader stay in effect.
vi.mock('../../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const getManyFromAll = async (keys: readonly string[]) => {
    const all = await mockGetAll();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = all?.[k];
    return out;
  };
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      get: vi.fn(),
      set: mockSet,
      setAll: vi.fn(),
      getMany: getManyFromAll,
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      get = vi.fn();
      set = mockSet;
      setAll = vi.fn();
      getMany = getManyFromAll;
    },
  };
});

vi.mock('../../../utils/logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  }),
);
vi.mock('../../../utils/logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  }),
);
vi.mock('../../../utils/logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  }),
);

import { addLog } from '../../../utils/logger/core.js';

interface MockSqlite {
  query: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
  maintain: ReturnType<typeof vi.fn>;
}

function gistRow(id: number): Record<string, unknown> {
  return { id, url: `https://example.com/${id}`, title: `title-${id}`, summary: null, gist_synced: 0 };
}

function emptyPage(): Record<string, unknown> {
  return { success: true, data: { rows: [], total: 0 } };
}

function pageOf(ids: number[]): Record<string, unknown> {
  return { success: true, data: { rows: ids.map(gistRow), total: ids.length } };
}

function buildTarget(queryImpl: (...args: unknown[]) => unknown): { target: GistSyncTarget; sqlite: MockSqlite } {
  const sqlite: MockSqlite = {
    query: vi.fn(queryImpl),
    mutate: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    maintain: vi.fn(),
  };
  const target = new GistSyncTarget(sqlite as never);
  return { target, sqlite };
}

function stubFetchOk(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'gist-new' }) });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchFail(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 422 });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GistSyncTarget batch policy (folded runner)', () => {
  it('fetches with the default batch size (50) as the query limit', async () => {
    const { target, sqlite } = buildTarget(() => Promise.resolve(emptyPage()));
    stubFetchOk();

    await target.syncBatch();

    expect(sqlite.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it('syncs one row per pending record and counts successes', async () => {
    const { target, sqlite } = buildTarget(() => Promise.resolve(emptyPage()));
    sqlite.query.mockResolvedValueOnce(pageOf([1, 2, 3])).mockResolvedValueOnce(emptyPage());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'gist-new' }) })
      .mockResolvedValueOnce({ ok: false, status: 422 })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'gist-new' }) });
    vi.stubGlobal('fetch', fetchMock);

    const total = await target.syncBatch();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sqlite.mutate).toHaveBeenCalledTimes(2);
    expect(total).toBe(2);
  });

  it('stops iterating once the query returns an empty page', async () => {
    const { target, sqlite } = buildTarget(() => Promise.resolve(emptyPage()));
    sqlite.query.mockResolvedValueOnce(pageOf([1])).mockResolvedValueOnce(emptyPage());
    stubFetchOk();

    await target.syncBatch();

    expect(sqlite.query).toHaveBeenCalledTimes(2);
  });

  it('stops iterating when a batch makes no progress (all syncs fail)', async () => {
    const { target, sqlite } = buildTarget(() => Promise.resolve(pageOf([1])));
    stubFetchFail();

    const total = await target.syncBatch();

    expect(sqlite.query).toHaveBeenCalledTimes(1);
    expect(total).toBe(0);
  });

  it('stops iterating when marking rows fails (zero progress via mutate rejection)', async () => {
    const { target, sqlite } = buildTarget(() => Promise.resolve(pageOf([1])));
    sqlite.mutate.mockRejectedValue(new Error('mutate failed'));
    stubFetchOk();

    const total = await target.syncBatch();

    expect(sqlite.query).toHaveBeenCalledTimes(1);
    expect(total).toBe(0);
  });

  it('respects maxIterations as a hard cap even when progress keeps being made', async () => {
    const { target, sqlite } = buildTarget(() => Promise.resolve(pageOf([1])));
    stubFetchOk();

    const total = await target.syncBatch();

    expect(sqlite.query).toHaveBeenCalledTimes(100);
    expect(total).toBe(100);
  });

  it('propagates query failure and logs the batch failure', async () => {
    const { target } = buildTarget(() => Promise.reject(new Error('db error')));
    stubFetchOk();

    await expect(target.syncBatch()).rejects.toThrow('db error');
    expect(addLog).toHaveBeenCalledWith('WARN', 'GistSync: batch failed', expect.any(Object));
  });

  it('propagates an unsuccessful query result', async () => {
    const { target } = buildTarget(() =>
      Promise.resolve({
        success: false,
        error: { kind: 'sqlite', message: 'query returned null', retriable: false },
      }),
    );
    stubFetchOk();

    await expect(target.syncBatch()).rejects.toThrow('query returned null');
  });

  it('returns 0 and syncs nothing when there is nothing pending', async () => {
    const { target, sqlite } = buildTarget(() => Promise.resolve(emptyPage()));
    const fetchMock = stubFetchOk();

    const total = await target.syncBatch();

    expect(total).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sqlite.mutate).not.toHaveBeenCalled();
  });

  it('returns 0 without querying when not configured', async () => {
    mockGetAll.mockResolvedValue({});
    const { target, sqlite } = buildTarget(() => Promise.resolve(pageOf([1])));
    stubFetchOk();

    const total = await target.syncBatch();

    expect(total).toBe(0);
    expect(sqlite.query).not.toHaveBeenCalled();
  });
});
