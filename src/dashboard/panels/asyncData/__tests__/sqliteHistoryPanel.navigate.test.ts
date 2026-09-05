// @vitest-environment jsdom
/**
 * sqliteHistoryPanel.navigate.test.ts
 * Panel+Model navigation order contract (PBI-14): the registry calls
 * init → load on every tab switch and destroy only on teardown.
 * init() must stay side-effect-free (it may run without a container);
 * load() performs the single onNavigateIn; destroy() the onNavigateOut.
 * NavigationRegistry itself is not covered here: it trivially calls init→load (NavigationRegistry.ts:33-67).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
  searchLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
  toggleStar: vi.fn(),
  deleteLog: vi.fn(),
  getSqliteStatus: vi.fn().mockResolvedValue({ initialized: true, fallback: false }),
  appendToLogs: vi.fn(),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));

import type { SqliteHistoryModel } from '../sqliteHistoryModel.js';

type TrackedModel = SqliteHistoryModel & {
  onNavigateIn: Mock;
  onNavigateOut: Mock;
};

// Spy on the Model's navigation entry points while delegating to the real
// implementation, so each panel's init→load / destroy cycle is observable.
const { createdModels } = vi.hoisted(() => ({ createdModels: [] as Array<TrackedModel> }));

vi.mock('../sqliteHistoryModel.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sqliteHistoryModel.js')>();
  return {
    ...actual,
    createSqliteHistoryModel: (...args: Parameters<typeof actual.createSqliteHistoryModel>) => {
      const model = actual.createSqliteHistoryModel(...args);
      const tracked = {
        ...model,
        onNavigateIn: vi.fn((params?: { searchTag?: string; searchDomain?: string }) => model.onNavigateIn(params)),
        onNavigateOut: vi.fn(() => model.onNavigateOut()),
      } as TrackedModel;
      createdModels.push(tracked);
      return tracked;
    },
  };
});

import { createSqliteHistoryPanel } from '../sqliteHistoryPanel.js';
import * as db from '../../../dashboardSqliteService.js';

const mockedDb = db as unknown as {
  queryLogs: ReturnType<typeof vi.fn>;
  searchLogs: ReturnType<typeof vi.fn>;
};

function makeRow(id: number): object {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Example ${id}`,
    created_at: 1700000000000 + id,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  createdModels.length = 0;
  mockedDb.queryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
  mockedDb.searchLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('sqliteHistoryPanel — navigation order contract', () => {
  it('init alone performs no query and does not navigate — the fetch waits for load', async () => {
    const panel = createSqliteHistoryPanel();
    panel.init?.({ searchTag: 'test' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(mockedDb.queryLogs).not.toHaveBeenCalled();
    expect(mockedDb.searchLogs).not.toHaveBeenCalled();
    expect(createdModels).toHaveLength(1);
    expect(createdModels[0]?.onNavigateIn).not.toHaveBeenCalled();
  });

  it('init → load calls onNavigateIn exactly once with the stashed params', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.init?.({ searchTag: 'test' });
    await panel.load?.();
    const model = createdModels[0];
    expect(model?.onNavigateIn).toHaveBeenCalledTimes(1);
    expect(model?.onNavigateIn).toHaveBeenCalledWith({ searchTag: 'test' });
    // Immediate tag fetch + retry fetch share one cache key: 1 real query.
    expect(mockedDb.queryLogs).toHaveBeenCalledTimes(1);
  });

  it('plain init → load navigates in once with no params (fresh unfiltered load)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.init?.();
    await panel.load?.();
    const model = createdModels[0];
    expect(model?.onNavigateIn).toHaveBeenCalledTimes(1);
    expect(model?.onNavigateIn).toHaveBeenCalledWith(undefined);
    expect(mockedDb.queryLogs).toHaveBeenCalledTimes(1);
  });

  it('double init is last-wins: a stale tag never reaches the fetch', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.init?.({ searchTag: 'stale-tag' });
    panel.init?.({});
    await panel.load?.();
    const model = createdModels[0];
    expect(model?.onNavigateIn).toHaveBeenCalledTimes(1);
    expect(model?.onNavigateIn).toHaveBeenCalledWith(undefined);
    // A tag navigation over-fetches (limit 5000); a plain one pages (limit 20).
    expect(mockedDb.queryLogs).toHaveBeenCalled();
    for (const call of mockedDb.queryLogs.mock.calls) {
      expect((call[0] as { limit?: number }).limit).toBe(20);
    }
    expect(mockedDb.searchLogs).not.toHaveBeenCalled();
  });

  it('destroy calls onNavigateOut exactly once and clears the entry selection', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.init?.();
    await panel.load?.();
    const model = createdModels[0];
    expect(model).toBeDefined();
    model?.selectEntry(999, true);
    expect(model?.getState().selectedIds.size).toBe(1);
    panel.destroy?.();
    expect(model?.onNavigateOut).toHaveBeenCalledTimes(1);
    expect(model?.getState().selectedIds.size).toBe(0);
  });

  it('destroy invalidates the cache: the next fetch re-queries', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.init?.();
    await panel.load?.();
    expect(mockedDb.queryLogs).toHaveBeenCalledTimes(1);
    const model = createdModels[0];
    panel.destroy?.();
    await model?.fetchData({ page: 0 });
    expect(mockedDb.queryLogs).toHaveBeenCalledTimes(2);
  });

  it('destroy bumps the generation: an in-flight fetch is discarded', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.init?.();
    await panel.load?.();
    const model = createdModels[0];
    let resolvePending!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolvePending = resolve; });
    mockedDb.queryLogs.mockImplementationOnce(() => pending);
    const inFlight = model?.fetchData({ page: 1 });
    panel.destroy?.();
    resolvePending({ data: { rows: [makeRow(1)], total: 1 } });
    await inFlight;
    // The stale response must not commit (without the bump, entries would be [1]).
    expect(model?.getState().entries).toEqual([]);
    // A successor fetch still works and clears loading (it owns the flag now).
    await model?.fetchData({ page: 0 });
    expect(model?.getState().loading).toBe(false);
  });
});
