// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-pagination.test.ts
 * PBI 2026-08-08-07: 履歴のページングが1000件で破綻する問題の回帰テスト
 *
 * 背景:
 * fetchData() は queryLogs を limit:1000 / offset:0 で固定呼び出しし、
 * ページングを取得後にクライアント側の slice で行っていた。
 * PAGE_SIZE=20 のため 51ページ目（1001件目）以降が空になり、
 * 履歴が1000件を超えると古い記録に到達できなかった。
 *
 * サーバ側 (recordsRepo.query → opfsWorker handleQuery) は LIMIT/OFFSET を
 * 実装済みなので、tagFilter が無い場合はサーバ側ページングに委ねる。
 *
 * tagFilter がある場合はクライアント側フィルタを維持する（意図的）:
 * サーバ側 tagFilter は FTS5 trigram MATCH で3文字未満のタグに
 * フォールバックが無く、クライアント側の部分一致と等価でないため。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: vi.fn(),
  searchLogs: vi.fn(),
  toggleStar: vi.fn(),
  deleteLog: vi.fn(),
  getSqliteStatus: vi.fn().mockResolvedValue({ initialized: true, fallback: false }),
  appendToLogs: vi.fn(),
  // Mirrors the real narrowing helper: the panel imports it alongside the
  // query functions to tell the failure side of ServiceResult apart.
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

/** PAGE_SIZE in sqliteHistoryPanel.ts */
const PAGE_SIZE = 20;

function makeRow(id: number, tags = ''): object {
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

/** Last options object passed to queryLogs. */
function lastQueryOptions(): { limit?: number; offset?: number; tagFilter?: string } {
  const calls = mockedDb.queryLogs.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as { limit?: number; offset?: number; tagFilter?: string };
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

describe('createSqliteHistoryPanel — server-side pagination', () => {
  it('requests only one page worth of rows instead of a fixed 1000', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    await panel.load?.();
    await flush();

    const options = lastQueryOptions();
    // Regression: this used to be a hardcoded limit: 1000, offset: 0.
    expect(options.limit).toBe(PAGE_SIZE);
    expect(options.offset).toBe(0);
  });

  it('advances the SQL offset when paging forward', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // The panel renders pagination into a pre-existing element, as the real
    // options page provides.
    const pagination = document.createElement('div');
    pagination.id = 'sqlite-pagination';
    document.body.appendChild(pagination);
    const panel = makePanel(container);

    mockedDb.queryLogs.mockResolvedValue({
      data: {
        rows: Array.from({ length: PAGE_SIZE }, (_, i) => makeRow(i)),
        total: 5000,
      },
    });

    await panel.load?.();
    await flush();

    const next = document.querySelector('[data-page="next"]') as HTMLButtonElement | null;
    expect(next, 'pagination control should be rendered for a 5000-row result').not.toBeNull();
    next!.click();
    await flush();

    // Page 1 must be requested from SQL, not sliced out of a first-page fetch.
    expect(lastQueryOptions().offset).toBe(PAGE_SIZE);
    expect(lastQueryOptions().limit).toBe(PAGE_SIZE);
  });

  it('renders the rows the DB returned for a later page without re-slicing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const pagination = document.createElement('div');
    pagination.id = 'sqlite-pagination';
    document.body.appendChild(pagination);
    const panel = makePanel(container);

    mockedDb.queryLogs.mockResolvedValue({
      data: {
        rows: Array.from({ length: PAGE_SIZE }, (_, i) => makeRow(i)),
        total: 5000,
      },
    });
    await panel.load?.();
    await flush();

    // Second page: SQL already applied OFFSET, so these are the rows to show.
    const secondPageRows = Array.from({ length: PAGE_SIZE }, (_, i) => makeRow(1200 + i));
    mockedDb.queryLogs.mockResolvedValue({ data: { rows: secondPageRows, total: 5000 } });

    const next = document.querySelector('[data-page="next"]') as HTMLButtonElement | null;
    next!.click();
    await flush();

    // Regression: a second client-side slice(offset, offset+limit) here would
    // discard all 20 rows, because the DB already returned exactly page 1.
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('Example 1200');
  });

  it('keeps client-side tag filtering (server tagFilter is not equivalent)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);

    mockedDb.queryLogs.mockResolvedValue({
      data: {
        rows: [makeRow(1, '#AI'), makeRow(2, '#other')],
        total: 2,
      },
    });

    panel.init?.({ searchTag: 'AI' });
    await panel.load?.();
    await flush();

    const options = lastQueryOptions();
    // A 2-character tag would return nothing through FTS5 trigram MATCH, so the
    // tag must NOT be pushed down to the server.
    expect(options.tagFilter).toBeUndefined();
    // Client-side filtering needs a wide fetch window to stay correct.
    expect(options.limit).toBeGreaterThan(PAGE_SIZE);
  });
});
