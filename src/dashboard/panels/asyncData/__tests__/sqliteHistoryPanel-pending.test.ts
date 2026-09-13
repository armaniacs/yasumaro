// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-pending.test.ts
 * Pending-pages region tests (PBI 2026-09-11-02, PBI-P): the section rendered
 * by renderPendingRegion inside the SQLite history panel, driven by
 * getPendingPages + chrome.storage.onChanged live updates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: vi.fn(),
  searchLogs: vi.fn(),
  toggleStar: vi.fn(),
  deleteLog: vi.fn(),
  getSqliteStatus: vi.fn().mockResolvedValue({ initialized: true, fallback: false }),
  appendToLogs: vi.fn(),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../utils/pendingStorage.js', () => ({
  getPendingPages: vi.fn().mockResolvedValue([]),
  removePendingPages: vi.fn().mockResolvedValue(undefined),
  renderPendingReason: vi.fn((r: string) => r),
}));

import { createSqliteHistoryPanel } from '../sqliteHistoryPanel.js';
import * as db from '../../../dashboardSqliteService.js';
import * as pending from '../../../../utils/pendingStorage.js';
import type { PanelLifecycle } from '../../types.js';

const mockedDb = db as unknown as {
  queryLogs: ReturnType<typeof vi.fn>;
  searchLogs: ReturnType<typeof vi.fn>;
};
const mockedPending = pending as unknown as {
  getPendingPages: ReturnType<typeof vi.fn>;
  removePendingPages: ReturnType<typeof vi.fn>;
  renderPendingReason: ReturnType<typeof vi.fn>;
};

type StorageListener = (changes: Record<string, unknown>, areaName: string) => void;

function makePendingPage(url: string, title = url): Record<string, unknown> {
  return { url, title, timestamp: Date.now(), reason: 'private', expiry: Date.now() + 3600_000 };
}

function makePanel(container: HTMLElement): PanelLifecycle {
  const panel = createSqliteHistoryPanel();
  panel.mount(container);
  return panel;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
  await new Promise(resolve => setTimeout(resolve, 0));
}

/** Live listener registry so removeListener actually removes (the setup mock doesn't). */
const activeStorageListeners: StorageListener[] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  activeStorageListeners.length = 0;
  // Make the setup's onChanged mocks behave like a real registry.
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((l: StorageListener) => {
    activeStorageListeners.push(l);
  });
  vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((l: StorageListener) => {
    const i = activeStorageListeners.indexOf(l);
    if (i !== -1) activeStorageListeners.splice(i, 1);
  });
  // Keep the global chrome stub from testDir/vitest.setup.ts (i18n etc.) and
  // only override the messaging surface the pending flow uses.
  (chrome.runtime as unknown as Record<string, unknown>).sendMessage = vi.fn(async (msg: { type: string }) => {
    if (msg.type === 'MANUAL_RECORD') return { success: true };
    if (msg.type === 'PING') return { success: true };
    return { success: false };
  });
  mockedPending.getPendingPages.mockResolvedValue([]);
  mockedPending.removePendingPages.mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
  activeStorageListeners.length = 0;
  vi.restoreAllMocks();
});

describe('SQLite history panel — pending pages region (PBI 2026-09-11-02)', () => {
  it('renders pending pages into the dedicated region on load', async () => {
    mockedPending.getPendingPages.mockResolvedValue([
      makePendingPage('https://a.example.com', 'Page A'),
      makePendingPage('https://b.example.com', 'Page B'),
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    await settle();

    const region = container.querySelector('#sqlite-pending-region') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.querySelectorAll('.pending-entry').length).toBe(2);
    expect(region.querySelectorAll('[data-pending-action="record"]').length).toBe(2);
    expect(region.querySelectorAll('[data-pending-action="recordWithoutAi"]').length).toBe(2);
    expect(region.querySelectorAll('[data-pending-action="delete"]').length).toBe(2);
  });

  it('sends MANUAL_RECORD (force, no AI) on record and drops the row on success', async () => {
    const page = makePendingPage('https://a.example.com', 'Page A');
    mockedPending.getPendingPages
      .mockResolvedValueOnce([page]) // initial load
      .mockResolvedValueOnce([]);    // reload after successful record
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    await settle();

    const btn = container.querySelector('[data-pending-action="record"]') as HTMLButtonElement;
    btn.click();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'MANUAL_RECORD',
      payload: expect.objectContaining({ url: 'https://a.example.com', content: '', force: true, skipAi: false }),
    }));
    expect(mockedPending.removePendingPages).toHaveBeenCalledWith(['https://a.example.com']);
    // Region re-renders from the reloaded (empty) pending list.
    const region = container.querySelector('#sqlite-pending-region') as HTMLElement;
    expect(region.querySelectorAll('.pending-entry').length).toBe(0);
  });

  it('recordWithoutAi sends skipAi:true', async () => {
    mockedPending.getPendingPages.mockResolvedValue([makePendingPage('https://b.example.com', 'Page B')]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    await settle();

    const btn = container.querySelector('[data-pending-action="recordWithoutAi"]') as HTMLButtonElement;
    btn.click();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ skipAi: true }),
    }));
  });

  it('delete removes the page from storage and refreshes the region', async () => {
    const page = makePendingPage('https://c.example.com', 'Page C');
    mockedPending.getPendingPages
      .mockResolvedValueOnce([page]) // initial load
      .mockResolvedValueOnce([]);    // reload after delete
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    await settle();

    const btn = container.querySelector('[data-pending-action="delete"]') as HTMLButtonElement;
    btn.click();
    await settle();

    expect(mockedPending.removePendingPages).toHaveBeenCalledWith(['https://c.example.com']);
    expect(mockedPending.getPendingPages).toHaveBeenCalledTimes(2); // initial load + post-delete reload
  });

  it('re-renders the region on chrome.storage.onChanged for pending_pages', async () => {
    mockedPending.getPendingPages.mockResolvedValue([]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    await settle();

    expect(container.querySelector('#sqlite-pending-region')?.innerHTML).toBe('');

    // A background writer updates pending pages while the panel is open.
    mockedPending.getPendingPages.mockResolvedValue([makePendingPage('https://live.example.com', 'Live')]);
    const changedPages = mockedPending.getPendingPages.mock.results.at(-1);
    void changedPages;
    for (const l of [...activeStorageListeners]) {
      l({ pending_pages: { newValue: [] } }, 'local');
    }
    await settle();

    expect(container.querySelector('#sqlite-pending-region')?.querySelectorAll('.pending-entry').length).toBe(1);
  });

  it('destroy releases the storage subscription (no reload after destroy)', async () => {
    mockedPending.getPendingPages.mockResolvedValue([]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = makePanel(container);
    await panel.load?.();
    await settle();

    panel.destroy?.();

    // After destroy, a storage change no longer triggers a pending reload —
    // regardless of how many unrelated listeners share the onChanged event.
    const callsBefore = vi.mocked(mockedPending.getPendingPages).mock.calls.length;
    for (const l of [...activeStorageListeners]) {
      l({ pending_pages: { newValue: [] } }, 'local');
    }
    await settle();
    expect(vi.mocked(mockedPending.getPendingPages).mock.calls.length).toBe(callsBefore);
  });

  it('shows an in-row error and keeps the row when the record fails', async () => {
    mockedPending.getPendingPages.mockResolvedValue([makePendingPage('https://err.example.com', 'Err')]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'boom' });
    const panel = makePanel(container);
    await panel.load?.();
    await settle();

    const row = container.querySelector('.pending-entry') as HTMLElement;
    const btn = row.querySelector('[data-pending-action="record"]') as HTMLButtonElement;
    btn.click();
    await settle();

    expect(row.querySelector('.record-error-message')?.textContent).toContain('boom');
    expect(mockedPending.removePendingPages).not.toHaveBeenCalled();
    // The row survives (pending page still pending).
    expect(container.querySelector('#sqlite-pending-region')?.querySelectorAll('.pending-entry').length).toBe(1);
  });
});
