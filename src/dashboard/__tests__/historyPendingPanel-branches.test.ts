// @vitest-environment jsdom
/**
 * historyPendingPanel-branches.test.ts
 * Targets remaining uncovered branches in historyPendingPanel.ts:
 * - getMessage(...) || fallback right-hand sides (getMessage returns falsy)
 * - pIdx/sIdx === -1 branches (findIndex misses because page already removed from arrays)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetMessage = vi.fn((key: string) => key);
const mockSendMessageWithTimeout = vi.fn().mockResolvedValue({ success: true });
const mockShowRecordError = vi.fn();
const mockCheckServiceWorkerAlive = vi.fn().mockResolvedValue(true);
const mockCreatePaginationControls = vi.fn();
const mockRemovePendingPages = vi.fn().mockResolvedValue(undefined);

vi.mock('../../utils/i18n.js', () => ({
  getMessage: (...args: [string]) => mockGetMessage(...args),
}));

vi.mock('../../utils/pendingStorage.js', () => ({
  removePendingPages: (...args: unknown[]) => mockRemovePendingPages(...args),
}));

vi.mock('../historyFilters.js', () => ({
  renderPendingReason: vi.fn().mockReturnValue('test-reason'),
}));

vi.mock('../historyUtils.js', () => ({
  showRecordError: (...args: unknown[]) => mockShowRecordError(...args),
  checkServiceWorkerAlive: (...args: unknown[]) => mockCheckServiceWorkerAlive(...args),
  sendMessageWithTimeout: (...args: unknown[]) => mockSendMessageWithTimeout(...args),
  createPaginationControls: (...args: unknown[]) => mockCreatePaginationControls(...args),
}));

function createMockState(pages: any[] = []): any {
  return {
    pendingPages: [...pages],
    pendingUrlSet: new Set(pages.map((p: any) => p.url)),
    activeFilter: null,
    pendingCurrentPage: 0,
  };
}

function createMockPage(overrides: any = {}): any {
  return {
    url: 'https://example.com/page',
    title: 'Test Page',
    reason: 'reason',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createPendingFixture() {
  return {
    pendingSection: document.createElement('div'),
    pendingList: document.createElement('div'),
    pendingCurrentPageRef: { value: 0 },
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('historyPendingPanel-branches — getMessage fallback strings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMessage.mockImplementation(() => '');
    mockSendMessageWithTimeout.mockResolvedValue({ success: true });
    mockCreatePaginationControls.mockReturnValue(document.createElement('div'));
  });

  it('uses recordWithoutAi fallback text and skip badge/empty fallbacks in renderSkippedMode', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
    const pages = [createMockPage()];

    renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

    // filterSkipped fallback
    expect(elements.historyList.querySelector('.history-badge-skipped')?.textContent).toBe('スキップ');
    // recordNow fallback
    const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
    expect((buttons[0] as HTMLButtonElement).textContent).toBe('📝 今すぐ記録');
    // recordWithoutAi fallback
    expect((buttons[1] as HTMLButtonElement).textContent).toBe('📝 AI要約なしで記録');
  });

  it('uses historyEmpty fallback text when filtered list is empty', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };

    renderSkippedMode(createMockState([]), elements as any, '', vi.fn());

    expect(elements.historyList.innerHTML).toContain('No history found.');
  });

  it('uses processing fallback text and getRecordButtonText fallback on click (skipAi=false)', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
    const pages = [createMockPage()];
    mockSendMessageWithTimeout.mockResolvedValueOnce({ success: false });

    renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

    const btn = elements.historyList.querySelectorAll('.pending-record-btn')[0] as HTMLButtonElement;
    btn.click();
    expect(btn.textContent).toBe('処理中...');
    await flushMicrotasks();

    // failure path re-sets button text via getRecordButtonText fallback (skipAi=false)
    expect(btn.textContent).toBe('📝 今すぐ記録');
  });

  it('uses getRecordButtonText fallback on failure with skipAi=true', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
    const pages = [createMockPage()];
    mockSendMessageWithTimeout.mockResolvedValueOnce({ success: false });

    renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

    const btn = elements.historyList.querySelectorAll('.pending-record-btn')[1] as HTMLButtonElement;
    btn.click();
    await flushMicrotasks();

    expect(btn.textContent).toBe('📝 AI要約なしで記録');
  });

  it('uses serviceWorkerNotResponding fallback message text', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
    const pages = [createMockPage()];

    mockCheckServiceWorkerAlive.mockResolvedValueOnce(false);
    mockSendMessageWithTimeout.mockRejectedValueOnce(new Error('timeout'));

    renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

    const btn = elements.historyList.querySelectorAll('.pending-record-btn')[0] as HTMLButtonElement;
    btn.click();
    await flushMicrotasks();

    expect(mockShowRecordError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'Service Workerが応答しません。拡張機能を再読み込みしてください。' }),
    );
  });

  it('uses historyEmpty fallback text after record-now empties the list, with historyStats null', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: null };
    const pages = [createMockPage()];

    renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

    const btn = elements.historyList.querySelectorAll('.pending-record-btn')[0] as HTMLButtonElement;
    btn.click();
    await flushMicrotasks();

    expect(elements.historyList.innerHTML).toContain('No history found.');
  });

  it('uses historyEmpty fallback text after record-without-ai empties the list', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
    const pages = [createMockPage()];

    renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

    const btn = elements.historyList.querySelectorAll('.pending-record-btn')[1] as HTMLButtonElement;
    btn.click();
    await flushMicrotasks();

    expect(elements.historyList.innerHTML).toContain('No history found.');
  });

  it('uses recordNow/recordWithoutAi and pendingDeleteForever fallbacks in renderPendingPage', async () => {
    const { renderPendingPage } = await import('../historyPendingPanel.js');
    const pages = [createMockPage()];
    const state = createMockState(pages);
    const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

    renderPendingPage(state, {} as any, pendingSection, pendingList, pages, pendingCurrentPageRef, vi.fn());

    const buttons = pendingList.querySelectorAll('.pending-record-btn');
    expect((buttons[0] as HTMLButtonElement).textContent).toBe('📝 今すぐ記録');
    expect((buttons[1] as HTMLButtonElement).textContent).toBe('📝 AI要約なしで記録');
    expect(pendingList.querySelector('.pending-delete-btn')?.textContent).toBe('🗑 完全削除');
  });
});

describe('historyPendingPanel-branches — pIdx/sIdx not found (-1) branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMessage.mockImplementation((key: string) => key);
    mockSendMessageWithTimeout.mockResolvedValue({ success: true });
    mockCreatePaginationControls.mockReturnValue(document.createElement('div'));
  });

  it('renderSkippedMode record-now click: pIdx -1 skips splice but still removes row (state pre-cleared)', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
    const page = createMockPage({ url: 'https://example.com/gone' });
    const state = createMockState([page]);
    // Pre-clear pendingPages so findIndex returns -1 inside the click handler,
    // while the DOM row (built from `filtered`) still exists to be clicked.
    renderSkippedMode(state, elements as any, '', vi.fn());
    state.pendingPages.length = 0;

    const btn = elements.historyList.querySelectorAll('.pending-record-btn')[0] as HTMLButtonElement;
    btn.click();
    await flushMicrotasks();

    expect(elements.historyList.querySelector('.pending-entry-inline')).toBeNull();
    expect(elements.historyStats!.textContent).toBe('0 / 0');
  });

  it('renderSkippedMode record-without-ai click: pIdx -1 branch and historyStats null branch', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: null };
    const page = createMockPage({ url: 'https://example.com/gone2' });
    const state = createMockState([page]);
    renderSkippedMode(state, elements as any, '', vi.fn());
    state.pendingPages.length = 0;

    const btn = elements.historyList.querySelectorAll('.pending-record-btn')[1] as HTMLButtonElement;
    btn.click();
    await flushMicrotasks();

    expect(elements.historyList.querySelector('.pending-entry-inline')).toBeNull();
  });

  it('renderPendingPage record-now click: pIdx/sIdx -1 branches (already removed elsewhere)', async () => {
    const { renderPendingPage } = await import('../historyPendingPanel.js');
    const page = createMockPage({ url: 'https://example.com/gone3' });
    const state = createMockState([page]);
    const sortedPending = [page];
    const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

    renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

    // Simulate the entry already having been removed from both arrays by a concurrent action.
    state.pendingPages.length = 0;
    sortedPending.length = 0;

    const btn = pendingList.querySelectorAll('.pending-record-btn')[0] as HTMLButtonElement;
    btn.click();
    await flushMicrotasks();

    expect(mockRemovePendingPages).toHaveBeenCalledWith(['https://example.com/gone3']);
  });

  it('renderPendingPage record-without-ai click: pIdx/sIdx -1 branches', async () => {
    const { renderPendingPage } = await import('../historyPendingPanel.js');
    const page = createMockPage({ url: 'https://example.com/gone4' });
    const state = createMockState([page]);
    const sortedPending = [page];
    const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

    renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

    state.pendingPages.length = 0;
    sortedPending.length = 0;

    const btn = pendingList.querySelectorAll('.pending-record-btn')[1] as HTMLButtonElement;
    btn.click();
    await flushMicrotasks();

    expect(mockRemovePendingPages).toHaveBeenCalledWith(['https://example.com/gone4']);
  });

  it('renderSkippedMode record-now click: does not show empty message when other rows remain', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
    const pages = [
      createMockPage({ url: 'https://example.com/first' }),
      createMockPage({ url: 'https://example.com/second' }),
    ];
    const state = createMockState(pages);

    renderSkippedMode(state, elements as any, '', vi.fn());

    const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
    (buttons[0] as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(elements.historyList.querySelector('.history-empty')).toBeNull();
    expect(elements.historyList.querySelectorAll('.pending-entry-inline').length).toBe(1);
  });

  it('renderSkippedMode record-without-ai click: does not show empty message when other rows remain', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
    const pages = [
      createMockPage({ url: 'https://example.com/first' }),
      createMockPage({ url: 'https://example.com/second' }),
    ];
    const state = createMockState(pages);

    renderSkippedMode(state, elements as any, '', vi.fn());

    // click the "record without AI" button on the first row (index 1 within that row's button group)
    const firstRowButtons = elements.historyList.querySelectorAll('.pending-entry-inline')[0].querySelectorAll('.pending-record-btn');
    (firstRowButtons[1] as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(elements.historyList.querySelector('.history-empty')).toBeNull();
    expect(elements.historyList.querySelectorAll('.pending-entry-inline').length).toBe(1);
  });

  it('renderPendingPage uses URL as display text when title is an empty string', async () => {
    const { renderPendingPage } = await import('../historyPendingPanel.js');
    const pages = [createMockPage({ title: '' })];
    const state = createMockState(pages);
    const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

    renderPendingPage(state, {} as any, pendingSection, pendingList, pages, pendingCurrentPageRef, vi.fn());

    const urlEl = pendingList.querySelector('.history-entry-url') as HTMLAnchorElement;
    expect(urlEl.textContent).toBe('https://example.com/page');
  });

  it('renderPendingPage delete click: pIdx/sIdx -1 branches', async () => {
    const { renderPendingPage } = await import('../historyPendingPanel.js');
    const page = createMockPage({ url: 'https://example.com/gone5' });
    const state = createMockState([page]);
    const sortedPending = [page];
    const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

    renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

    state.pendingPages.length = 0;
    sortedPending.length = 0;

    const deleteBtn = pendingList.querySelector('.pending-delete-btn') as HTMLButtonElement;
    deleteBtn.click();
    await flushMicrotasks();

    expect(mockRemovePendingPages).toHaveBeenCalledWith(['https://example.com/gone5']);
    expect(pendingSection.hidden).toBe(true);
  });
});
