// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-sort.test.ts
 * Verifies the sort <select> renders, is wired to the reducer, hides the
 * relevance option outside an active full-text search, and persists the
 * chosen sort to chrome.storage.local.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: vi.fn(),
  searchLogs: vi.fn(),
  toggleStar: vi.fn(),
  deleteLog: vi.fn(),
  getSqliteStatus: vi.fn().mockResolvedValue({ initialized: true, fallback: false }),
  appendToLogs: vi.fn(),
  // Mirrors the real narrowing helper: the panel imports it directly to tell
  // the failure side of ServiceResult apart.
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
import type { PanelLifecycle } from '../../types.js';

const mockedDb = db as unknown as {
  queryLogs: ReturnType<typeof vi.fn>;
  searchLogs: ReturnType<typeof vi.fn>;
};

function makeRow(id: number, tags: string): object {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Example ${id}`,
    tags,
    created_at: 1700000000000 + id,
  };
}

function makePanel(container: HTMLElement): PanelLifecycle {
  const panel = createSqliteHistoryPanel();
  panel.mount(container);
  return panel;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  mockedDb.queryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
  mockedDb.searchLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createSqliteHistoryPanel — sort control', () => {
  it('renders a sort select defaulting to created_at DESC (newest first)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();

    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select!.value).toBe('created_at:DESC');
  });

  it('does not show a relevance option when there is no active search', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();

    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).not.toContain('relevance:DESC');
  });

  it('changing the select fires a new query with the chosen sort', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    mockedDb.queryLogs.mockClear();

    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    select.value = 'created_at:ASC';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(mockedDb.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: 'created_at', orderDir: 'ASC' }),
    );
  });

  it('persists the chosen sort to chrome.storage.local', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();

    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    select.value = 'created_at:ASC';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ history_sort_preference: JSON.stringify({ sortBy: 'created_at', sortDir: 'ASC' }) })
    );
  });

  it('does not show relevance while a tag filter is active without a fallback search', async () => {
    // Simulate onActivate({ searchTag: 'AI' }): activeTagFilter set,
    // searchQuery populated as a label, no pendingTagFallback (tag matches).
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    mockedDb.queryLogs.mockResolvedValue({
      data: { rows: [makeRow(1, 'AI'), makeRow(2, 'AI')], total: 2 },
    });

    panel.init?.({ searchTag: 'AI' });
    await panel.load?.();
    await flush();

    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).not.toContain('relevance:DESC');
  });

  it('shows relevance when a tag filter fell back to full-text search', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    // Tag filter matches nothing -> fallback to searchLogs, which finds rows.
    mockedDb.queryLogs.mockResolvedValue({
      data: { rows: [makeRow(1, 'tech'), makeRow(2, 'business')], total: 2 },
    });
    const searchRows = Array.from({ length: 5 }, (_, i) => makeRow(i + 10, ''));
    mockedDb.searchLogs.mockResolvedValue({ data: { rows: searchRows, total: 5 } });

    panel.init?.({ searchTag: 'nonexistent-tag' });
    await panel.load?.();
    await flush();

    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('relevance:DESC');
  });
});
