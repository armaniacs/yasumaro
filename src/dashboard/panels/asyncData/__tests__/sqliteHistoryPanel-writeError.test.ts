// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-writeError.test.ts
 * PBI 2026-08-09-21: 削除・スター操作の失敗が画面に反映されない問題の回帰テスト
 *
 * 背景:
 * handleDelete / handleToggleStar は成功時の分岐しか持たず、失敗時は
 * 何も起こらない（else が無い）。DB障害時、利用者はボタンを押しても
 * 画面が完全に無反応になり、操作が効かない理由を知る手段がなかった。
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
  isServiceError: (r: unknown) => typeof r === 'object' && r !== null && 'error' in r,
}));

vi.mock('../../../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));

import { createSqliteHistoryPanel } from '../sqliteHistoryPanel.js';
import * as db from '../../../dashboardSqliteService.js';
import * as confirmDialog from '../../../utils/confirmDialog.js';
import type { AsyncDataPanel } from '../../types.js';

const mockedDb = db as unknown as {
  queryLogs: ReturnType<typeof vi.fn>;
  searchLogs: ReturnType<typeof vi.fn>;
  toggleStar: ReturnType<typeof vi.fn>;
  deleteLog: ReturnType<typeof vi.fn>;
};
const mockedConfirmDialog = confirmDialog as unknown as {
  showConfirmDialog: ReturnType<typeof vi.fn>;
};

function makeRow(id: number): object {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Example ${id}`,
    tags: '',
    created_at: 1700000000000 + id,
    is_starred: 0,
  };
}

function makePanel(container: HTMLElement): AsyncDataPanel {
  const panel = createSqliteHistoryPanel();
  panel.mount(container);
  return panel;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function errorText(): string {
  return document.getElementById('sqlite-error')?.textContent ?? '';
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  mockedDb.queryLogs.mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
  mockedDb.searchLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('変更系の失敗が利用者に伝わる', () => {
  it('削除に失敗したらエラーが表示され、エントリは一覧に残る', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.loadData();
    await flush();

    mockedConfirmDialog.showConfirmDialog.mockResolvedValue(true);
    mockedDb.deleteLog.mockResolvedValue({ error: 'Storage quota exceeded.' });

    document.querySelector<HTMLButtonElement>('[data-action="delete"]')?.click();
    await flush();

    expect(errorText()).toContain('Storage quota exceeded.');
    // The entry must still be there — a failed delete must not disappear.
    expect(document.querySelector('.sqlite-entry[data-id="1"]')).not.toBeNull();
  });

  it('スター付けに失敗したらエラーが表示される', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.loadData();
    await flush();

    mockedDb.toggleStar.mockResolvedValue({ error: 'Database connection lost. Please reload the extension.' });

    document.querySelector<HTMLButtonElement>('[data-action="star"]')?.click();
    await flush();

    expect(errorText()).toContain('Database connection lost.');
  });

  it('成功時はエラーが表示されず、エントリが一覧から消える', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.loadData();
    await flush();

    mockedConfirmDialog.showConfirmDialog.mockResolvedValue(true);
    mockedDb.deleteLog.mockResolvedValue({ data: undefined });

    document.querySelector<HTMLButtonElement>('[data-action="delete"]')?.click();
    await flush();

    expect(errorText()).toBe('');
    expect(document.querySelector('.sqlite-entry[data-id="1"]')).toBeNull();
  });
});
