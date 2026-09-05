// @vitest-environment jsdom
/**
 * sqliteHistoryPanel.navigate.test.ts
 * Panel+Model navigation order contract (PBI-14): the registry calls
 * init → load on every tab switch and destroy only on teardown.
 * init() must stay side-effect-free (it may run without a container);
 * load() performs the single onNavigateIn; destroy() the onNavigateOut.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { createSqliteHistoryPanel } from '../sqliteHistoryPanel.js';
import * as db from '../../../dashboardSqliteService.js';

const mockedDb = db as unknown as {
  queryLogs: ReturnType<typeof vi.fn>;
  searchLogs: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  mockedDb.queryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
  mockedDb.searchLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('sqliteHistoryPanel — navigation order contract', () => {
  it('init alone performs no query — the fetch waits for load', async () => {
    const panel = createSqliteHistoryPanel();
    panel.init?.({ searchTag: 'test' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(mockedDb.queryLogs).not.toHaveBeenCalled();
    expect(mockedDb.searchLogs).not.toHaveBeenCalled();
  });

  it('init → load navigates in once (single underlying tag query)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.init?.({ searchTag: 'test' });
    await panel.load?.();
    // Immediate tag fetch + retry fetch share one cache key: 1 real query.
    expect(mockedDb.queryLogs).toHaveBeenCalledTimes(1);
  });

  it('plain init → load resets to a fresh unfiltered load', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.init?.();
    await panel.load?.();
    expect(mockedDb.queryLogs).toHaveBeenCalledTimes(1);
  });

  it('destroy after load runs the navigate-out path without error', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.init?.();
    await panel.load?.();
    expect(() => panel.destroy?.()).not.toThrow();
  });
});
