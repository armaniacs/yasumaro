// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-tagFallback.test.ts
 * PBI 2026-08-06-01: Tag Cluster クリック時にタグ未マッチなら全文検索へフォールバック
 *
 * onActivate({ searchTag }) 経路で:
 *   - タグ絞り込みが 0件 → searchLogs() へフォールバックし、通知を表示する
 *   - タグ絞り込みが 1件以上 → フォールバックせず既存挙動を維持
 *   - ドメイン起点 → フォールバックしない
 *   - タグクリア → pendingTagFallback / searchQuery がクリアされる
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
  // Allow the void fetchData() promises inside onActivate to settle.
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

describe('createSqliteHistoryPanel — tag fallback to full-text search', () => {
  it('falls back to searchLogs and shows a notice when the tag filter matches nothing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    // queryLogs returns rows that do NOT carry the "教育" tag.
    mockedDb.queryLogs.mockResolvedValue({
      data: {
        rows: [makeRow(1, 'tech'), makeRow(2, 'business')],
        total: 2,
      },
    });
    // Full-text search for "教育" finds 54 rows.
    const searchRows = Array.from({ length: 54 }, (_, i) => makeRow(i + 10, ''));
    mockedDb.searchLogs.mockResolvedValue({ data: { rows: searchRows, total: 54 } });

    panel.init?.({ searchTag: '教育' });
    await flush();

    expect(mockedDb.searchLogs).toHaveBeenCalledWith('教育', 20, 0, { orderBy: 'created_at', orderDir: 'DESC' });
    expect(container.innerHTML).toContain('sqlite-tag-fallback-note');
    // The tag badge stays visible alongside the fallback notice.
    expect(container.innerHTML).toContain('#教育');
    expect(container.innerHTML).toContain('教育');
  });

  it('does NOT fall back when the tag filter has matches', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    mockedDb.queryLogs.mockResolvedValue({
      data: {
        rows: [makeRow(1, 'tech'), makeRow(2, 'tech')],
        total: 2,
      },
    });

    panel.init?.({ searchTag: 'tech' });
    await flush();

    expect(mockedDb.searchLogs).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain('sqlite-tag-fallback-note');
  });

  it('does NOT fall back when the tag filter has matches even if search has more rows', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    mockedDb.queryLogs.mockResolvedValue({
      data: {
        rows: [makeRow(1, 'tech')],
        total: 1,
      },
    });
    mockedDb.searchLogs.mockResolvedValue({
      data: {
        rows: [makeRow(99, '')],
        total: 10,
      },
    });

    panel.init?.({ searchTag: 'tech' });
    await flush();

    expect(mockedDb.searchLogs).not.toHaveBeenCalled();
  });

  it('does NOT show the fallback notice for a domain-initiated navigation', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    mockedDb.queryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    mockedDb.searchLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

    panel.init?.({ searchDomain: 'example.com' });
    await flush();

    // Domain navigation runs a normal text search (searchLogs is called), but
    // it is NOT a tag-initiated flow, so no fallback notice appears.
    expect(mockedDb.searchLogs).toHaveBeenCalledWith('example.com', 20, 0, { orderBy: 'created_at', orderDir: 'DESC' });
    expect(container.innerHTML).not.toContain('sqlite-tag-fallback-note');
  });

  it('falls back with zero matches on both sides and keeps the notice suppressed', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    // No tag match and no full-text match either.
    mockedDb.queryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    mockedDb.searchLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

    panel.init?.({ searchTag: 'nonexistent' });
    await flush();

    // searchLogs is still attempted (fallback decision fired), but since it
    // returned zero rows the panel shows the empty state with no notice.
    expect(mockedDb.searchLogs).toHaveBeenCalledWith('nonexistent', 20, 0, { orderBy: 'created_at', orderDir: 'DESC' });
    expect(container.innerHTML).not.toContain('sqlite-tag-fallback-note');
  });

  it('shows an error state when the fallback search fails', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    // queryLogs returns rows that do NOT carry the "教育" tag, so the fallback
    // search is attempted; that search fails.
    mockedDb.queryLogs.mockResolvedValue({
      data: {
        rows: [makeRow(1, 'tech')],
        total: 1,
      },
    });
    mockedDb.searchLogs.mockResolvedValue({ error: 'Search failed' });

    panel.init?.({ searchTag: '教育' });
    await flush();

    expect(mockedDb.searchLogs).toHaveBeenCalledWith('教育', 20, 0, { orderBy: 'created_at', orderDir: 'DESC' });
    // The error container is visible and the fallback notice is not shown.
    expect(container.innerHTML).toContain('sqlite-history-error');
    expect(container.innerHTML).not.toContain('sqlite-history-error hidden');
    expect(container.innerHTML).not.toContain('sqlite-tag-fallback-note');
  });
});
