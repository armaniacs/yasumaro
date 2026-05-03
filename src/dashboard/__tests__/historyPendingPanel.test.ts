// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: vi.fn((key) => key),
}));

vi.mock('../../utils/pendingStorage.js', () => ({
  removePendingPages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./historyFilters.js', () => ({
  renderPendingReason: vi.fn().mockReturnValue('test-reason'),
}));

vi.mock('./historyUtils.js', () => ({
  showRecordError: vi.fn(),
  checkServiceWorkerAlive: vi.fn().mockResolvedValue(true),
  sendMessageWithTimeout: vi.fn().mockResolvedValue({ success: true }),
  createPaginationControls: vi.fn().mockReturnValue(document.createElement('div')),
}));

describe('historyPendingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('should export renderSkippedMode function', async () => {
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    expect(typeof renderSkippedMode).toBe('function');
  });

  it('should export renderPendingPage function', async () => {
    const { renderPendingPage } = await import('../historyPendingPanel.js');
    expect(typeof renderPendingPage).toBe('function');
  });

  it('should render pending pages in skipped mode', async () => {
    document.body.innerHTML = `<div id="historyList"></div>`;
    
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    
    const state = {
      pendingPages: [{ url: 'https://example.com', title: 'Example', reason: 'test', headerValue: '' }],
      pendingUrlSet: new Set(['https://example.com']),
      entries: [],
      activeFilter: 'all',
    };
    const elements = { historyList: document.createElement('div') };

    renderSkippedMode(state as any, elements as any, '', vi.fn());
    expect(elements.historyList?.querySelector('.pending-entry-inline')).not.toBeNull();
  });

  it('should render empty message when no pages in skipped mode', async () => {
    document.body.innerHTML = `<div id="historyList"></div>`;
    
    const { renderSkippedMode } = await import('../historyPendingPanel.js');
    
    const state = {
      pendingPages: [],
      pendingUrlSet: new Set(),
      entries: [],
      activeFilter: 'all',
    };
    const elements = { historyList: document.createElement('div') };

    renderSkippedMode(state as any, elements as any, '', vi.fn());
    expect(elements.historyList?.innerHTML).toContain('history-empty');
  });

  it('should render pending entries with buttons', async () => {
    document.body.innerHTML = '';
    
    const { renderPendingPage } = await import('../historyPendingPanel.js');
    
    const pages = [
      { url: 'https://example.com', title: 'Example', reason: 'test', headerValue: '' },
    ];
    const state = { pendingPages: pages, pendingUrlSet: new Set(), entries: [] };
    const elements = { historyList: document.createElement('div') };
    const pendingSection = document.createElement('div');
    const pendingList = document.createElement('div');
    const pendingCurrentPageRef = { value: 0 };

    renderPendingPage(
      state as any,
      elements as any,
      pendingSection,
      pendingList,
      pages,
      pendingCurrentPageRef,
      vi.fn()
    );

    expect(pendingList.querySelector('.pending-entry')).not.toBeNull();
    expect(pendingList.querySelectorAll('.pending-record-btn').length).toBe(2);
    expect(pendingList.querySelector('.pending-delete-btn')).not.toBeNull();
  });

  it('should render header value when present', async () => {
    document.body.innerHTML = '';
    
    const { renderPendingPage } = await import('../historyPendingPanel.js');
    
    const pages = [
      { url: 'https://example.com', title: 'Example', reason: 'test', headerValue: 'custom-header' },
    ];
    const state = { pendingPages: pages, pendingUrlSet: new Set(), entries: [] };
    const elements = { historyList: document.createElement('div') };
    const pendingSection = document.createElement('div');
    const pendingList = document.createElement('div');
    const pendingCurrentPageRef = { value: 0 };

    renderPendingPage(
      state as any,
      elements as any,
      pendingSection,
      pendingList,
      pages,
      pendingCurrentPageRef,
      vi.fn()
    );

    expect(pendingList.innerHTML).toContain('custom-header');
  });
});