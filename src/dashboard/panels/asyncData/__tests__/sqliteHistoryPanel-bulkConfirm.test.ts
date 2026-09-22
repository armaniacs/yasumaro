// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-bulkConfirm.test.ts — review fixes: bulk toasts must
 * account for every target.
 *
 * 1. A partial bulk delete (first failure stops the run) toasts the
 *    interruption with the remaining count + reason, not just "N deleted".
 * 2. Bulk regenerate counts `in_flight` rows as skipped so the toast never
 *    reports "0 succeeded, 0 failed" for N selected targets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: vi.fn(),
  searchLogs: vi.fn(),
  toggleStar: vi.fn(),
  deleteLog: vi.fn(),
  getSqliteStatus: vi.fn().mockResolvedValue({ initialized: true, fallback: false }),
  appendToLogs: vi.fn(),
  isServiceError: (r: unknown) => typeof r === 'object' && r !== null && 'error' in r,
}));

vi.mock('../../../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
  removeSavedUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../utils/pendingStorage.js', () => ({
  getPendingPages: vi.fn().mockResolvedValue([]),
  removePendingPages: vi.fn().mockResolvedValue(undefined),
  renderPendingReason: vi.fn((r: string) => r),
}));

vi.mock('../../../../messaging/regenerateSummaryGateway.js', () => ({
  regenerateSummary: vi.fn(),
  REGENERATE_TIMEOUT_ERROR: 'Regenerate summary request timed out',
  REGENERATE_TIMEOUT_MS: 60000,
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));

import { createSqliteHistoryPanel } from '../sqliteHistoryPanel.js';
import { SQLITE_HISTORY_IDS } from '../sqliteHistoryPanelView.js';
import * as db from '../../../dashboardSqliteService.js';
import { regenerateSummary } from '../../../../messaging/regenerateSummaryGateway.js';
import type { PanelLifecycle } from '../../types.js';

const mockedDb = db as unknown as {
  queryLogs: ReturnType<typeof vi.fn>;
  searchLogs: ReturnType<typeof vi.fn>;
  deleteLog: ReturnType<typeof vi.fn>;
};
const mockedRegenerate = regenerateSummary as unknown as ReturnType<typeof vi.fn>;

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

function makePanel(container: HTMLElement): PanelLifecycle {
  const panel = createSqliteHistoryPanel();
  panel.mount(container);
  return panel;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
  await new Promise((r) => setTimeout(r, 0));
}

/** Check every entry checkbox, then run the two-step bulk delete confirm. */
function selectAllAndConfirmDelete(): void {
  for (const box of document.querySelectorAll<HTMLInputElement>('[data-action="select"]')) {
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }
  (document.querySelector(`#${SQLITE_HISTORY_IDS.deleteSelected}`) as HTMLButtonElement).click();
  (document.querySelector(`#${SQLITE_HISTORY_IDS.deleteConfirmYes}`) as HTMLButtonElement).click();
}

function lastNotification(): { title: string; message: string } {
  const calls = vi.mocked(chrome.notifications.create).mock.calls;
  const last = calls[calls.length - 1]![0] as { title: string; message: string };
  return { title: last.title, message: last.message };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  mockedDb.queryLogs.mockResolvedValue({
    data: { rows: [makeRow(1), makeRow(2)], total: 2 },
  });
  mockedDb.searchLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('bulk delete toast on partial failure', () => {
  it('names the interruption with remaining count + reason', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    await flush();

    mockedDb.deleteLog
      .mockResolvedValueOnce({ data: undefined })
      .mockResolvedValueOnce({ error: 'Storage quota exceeded.' });

    selectAllAndConfirmDelete();
    await flush();

    // NOTE: the vitest i18n mock leaves Chrome-style $1 placeholders raw
    // (real Chrome substitutes them positionally), so assert the template
    // shape: the partial key — carrying remaining count + reason slots —
    // is used instead of the plain success key.
    const { message } = lastNotification();
    expect(message).toContain('stopped with');
    expect(message).toContain('remaining');
    expect(message).not.toContain('articles deleted');
  });

  it('keeps the plain success toast when everything deletes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    await flush();

    mockedDb.deleteLog.mockResolvedValue({ data: undefined });

    selectAllAndConfirmDelete();
    await flush();

    const { message } = lastNotification();
    expect(message).toContain('articles deleted');
    expect(message).not.toContain('remaining');
  });
});

describe('bulk regenerate toast with in_flight rows', () => {
  it('reports skipped instead of 0 succeeded, 0 failed', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    await flush();

    mockedRegenerate
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'in_flight' });

    for (const box of document.querySelectorAll<HTMLInputElement>('[data-action="select"]')) {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    (document.querySelector(`#${SQLITE_HISTORY_IDS.regenerateSelected}`) as HTMLButtonElement).click();
    await flush();

    // NOTE: $1 placeholders stay raw under the vitest i18n mock.
    const { message } = lastNotification();
    expect(message).toContain('succeeded');
    expect(message).toContain('skipped: already running');
  });
});
