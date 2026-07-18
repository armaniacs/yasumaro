// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendMessageWithTimeout = vi.fn().mockResolvedValue({ success: true });
const mockShowRecordError = vi.fn();
const mockCheckServiceWorkerAlive = vi.fn().mockResolvedValue(true);
const mockCreatePaginationControls = vi.fn();
const mockRemovePendingPages = vi.fn().mockResolvedValue(undefined);

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key) => key),
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

describe('historyPendingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessageWithTimeout.mockResolvedValue({ success: true });
    mockRemovePendingPages.mockResolvedValue(undefined);
    mockCheckServiceWorkerAlive.mockResolvedValue(true);
    mockCreatePaginationControls.mockReturnValue(document.createElement('div'));
    document.body.innerHTML = '';
  });

  describe('exports', () => {
    it('should export renderSkippedMode function', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      expect(typeof renderSkippedMode).toBe('function');
    });

    it('should export renderPendingPage function', async () => {
      const { renderPendingPage } = await import('../historyPendingPanel.js');
      expect(typeof renderPendingPage).toBe('function');
    });
  });

  describe('renderSkippedMode', () => {
    it('should return early when historyList is null', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      expect(() => {
        renderSkippedMode({} as any, { historyList: null } as any, '', vi.fn());
      }).not.toThrow();
    });

    it('should show empty message when no pending pages', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };

      renderSkippedMode(
        createMockState([]),
        elements as any,
        '',
        vi.fn(),
      );

      expect(elements.historyList.innerHTML).toContain('history-empty');
    });

    it('should show empty message when search text matches nothing', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
      const pages = [createMockPage()];

      renderSkippedMode(
        createMockState(pages),
        elements as any,
        'nonexistent',
        vi.fn(),
      );

      expect(elements.historyList.innerHTML).toContain('history-empty');
    });

    it('should render filtered pages when search text matches URL', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
      const pages = [
        createMockPage({ url: 'https://example.com/unique', title: 'Page One' }),
        createMockPage({ url: 'https://example.com/other', title: 'Page Two' }),
      ];

      renderSkippedMode(
        createMockState(pages),
        elements as any,
        'unique',
        vi.fn(),
      );

      const rows = elements.historyList.querySelectorAll('.pending-entry-inline');
      expect(rows.length).toBe(1);
      expect(rows[0].querySelector('.history-entry-url')?.textContent).toBe('Page One');
    });

    it('should render filtered pages when search text matches title', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
      const pages = [
        createMockPage({ title: 'Page One' }),
        createMockPage({ url: 'https://other.com', title: 'Other' }),
      ];

      renderSkippedMode(
        createMockState(pages),
        elements as any,
        'page one',
        vi.fn(),
      );

      expect(elements.historyList.querySelectorAll('.pending-entry-inline').length).toBe(1);
    });

    it('should show total stats count', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
      const pages = [createMockPage(), createMockPage({ url: 'https://other.com' })];

      renderSkippedMode(
        createMockState(pages),
        elements as any,
        '',
        vi.fn(),
      );

      expect(elements.historyStats.textContent).toBe('2 / 2');
    });

    it('should show filtered stats when search text is provided', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
      const pages = [createMockPage({ url: 'https://example.com/match' }), createMockPage({ url: 'https://other.com' })];

      renderSkippedMode(
        createMockState(pages),
        elements as any,
        'match',
        vi.fn(),
      );

      expect(elements.historyStats.textContent).toBe('1 / 2');
    });

    it('should not throw when historyStats is null', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: null };
      const pages = [createMockPage()];

      renderSkippedMode(
        createMockState(pages),
        elements as any,
        '',
        vi.fn(),
      );

      expect(elements.historyList.querySelector('.pending-entry-inline')).not.toBeNull();
    });

    it('should render page row with skip badge, URL link, and timestamp with reason', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
      const timestamp = 1000;
      const pages = [createMockPage({ reason: 'cache-control', timestamp })];

      renderSkippedMode(
        createMockState(pages),
        elements as any,
        '',
        vi.fn(),
      );

      const row = elements.historyList.querySelector('.pending-entry-inline')!;
      expect(row.querySelector('.history-badge-skipped')).not.toBeNull();
      const urlEl = row.querySelector('.history-entry-url') as HTMLAnchorElement;
      expect(urlEl.href).toBe('https://example.com/page');
      expect(urlEl.textContent).toBe('Test Page');
      expect(row.querySelector('.history-entry-time')?.textContent).toContain('test-reason');
    });

    it('should use URL as display text when title is empty', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
      const pages = [createMockPage({ title: '' })];

      renderSkippedMode(
        createMockState(pages),
        elements as any,
        '',
        vi.fn(),
      );

      const urlEl = elements.historyList.querySelector('.history-entry-url') as HTMLAnchorElement;
      expect(urlEl.textContent).toBe('https://example.com/page');
    });

    it('should handle undefined title in search filtering', async () => {
      const { renderSkippedMode } = await import('../historyPendingPanel.js');
      const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
      const pages = [{ ...createMockPage(), title: undefined }] as any[];

      renderSkippedMode(
        createMockState(pages),
        elements as any,
        'nonexistent',
        vi.fn(),
      );

      expect(elements.historyList.innerHTML).toContain('history-empty');
    });

    describe('button clicks - executeRecord paths', () => {
      it('should call sendMessageWithTimeout with skipAi=false when record now is clicked', async () => {
        const { renderSkippedMode } = await import('../historyPendingPanel.js');
        const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
        const pages = [createMockPage({ url: 'https://example.com/page1', title: 'Page One' })];
        const state = createMockState(pages);

        renderSkippedMode(state, elements as any, '', vi.fn());

        const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(mockSendMessageWithTimeout).toHaveBeenCalledWith({
          title: 'Page One',
          url: 'https://example.com/page1',
          content: '',
          force: true,
          skipAi: false,
        });
      });

      it('should call sendMessageWithTimeout with skipAi=true when record without AI is clicked', async () => {
        const { renderSkippedMode } = await import('../historyPendingPanel.js');
        const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
        const pages = [createMockPage({ url: 'https://example.com/page1', title: 'Page One' })];
        const state = createMockState(pages);

        renderSkippedMode(state, elements as any, '', vi.fn());

        const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
        (buttons[1] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(mockSendMessageWithTimeout).toHaveBeenCalledWith({
          title: 'Page One',
          url: 'https://example.com/page1',
          content: '',
          force: true,
          skipAi: true,
        });
      });

      it('should remove page from state and DOM on successful record', async () => {
        const { renderSkippedMode } = await import('../historyPendingPanel.js');
        const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
        const pages = [createMockPage({ url: 'https://example.com/page1', title: 'Page One' })];
        const state = createMockState(pages);

        renderSkippedMode(state, elements as any, '', vi.fn());

        const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(mockRemovePendingPages).toHaveBeenCalledWith(['https://example.com/page1']);
        expect(elements.historyList.querySelector('.pending-entry-inline')).toBeNull();
        expect(state.pendingPages.length).toBe(0);
        expect(state.pendingUrlSet.has('https://example.com/page1')).toBe(false);
      });

      it('should show empty message when last item is removed via record now', async () => {
        const { renderSkippedMode } = await import('../historyPendingPanel.js');
        const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
        const pages = [createMockPage()];
        const state = createMockState(pages);

        renderSkippedMode(state, elements as any, '', vi.fn());

        const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(elements.historyList.innerHTML).toContain('history-empty');
      });

      it('should update stats when last item is removed via record now', async () => {
        const { renderSkippedMode } = await import('../historyPendingPanel.js');
        const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
        const pages = [createMockPage()];
        const state = createMockState(pages);

        renderSkippedMode(state, elements as any, '', vi.fn());

        const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(elements.historyStats.textContent).toBe('0 / 0');
      });

      it('should disable button and show processing text while recording', async () => {
        const { renderSkippedMode } = await import('../historyPendingPanel.js');
        const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
        const pages = [createMockPage()];

        renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

        const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
        const btn = buttons[0] as HTMLButtonElement;

        btn.click();

        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe('processing');
      });

      it('should remove existing error messages before recording', async () => {
        const { renderSkippedMode } = await import('../historyPendingPanel.js');
        const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
        const pages = [createMockPage()];

        renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

        const info = elements.historyList.querySelector('.history-entry-info')!;
        const errorEl = document.createElement('div');
        errorEl.className = 'record-error-message';
        errorEl.textContent = 'old error';
        info.appendChild(errorEl);

        const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();

        expect(info.querySelector('.record-error-message')).toBeNull();
      });

      it('should record without AI button also remove page from state and DOM', async () => {
        const { renderSkippedMode } = await import('../historyPendingPanel.js');
        const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
        const pages = [createMockPage({ url: 'https://example.com/noai', title: 'No AI' })];
        const state = createMockState(pages);

        renderSkippedMode(state, elements as any, '', vi.fn());

        const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
        (buttons[1] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(mockRemovePendingPages).toHaveBeenCalledWith(['https://example.com/noai']);
        expect(elements.historyList.querySelector('.pending-entry-inline')).toBeNull();
        expect(state.pendingPages.length).toBe(0);
        expect(state.pendingUrlSet.has('https://example.com/noai')).toBe(false);
      });

      describe('failure paths', () => {
        it('should show error and re-enable button when record returns success=false', async () => {
          const { renderSkippedMode } = await import('../historyPendingPanel.js');
          const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
          const pages = [createMockPage()];

          mockSendMessageWithTimeout.mockResolvedValueOnce({ success: false });

          renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

          const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
          const btn = buttons[0] as HTMLButtonElement;
          btn.click();
          await flushMicrotasks();

          expect(mockShowRecordError).toHaveBeenCalled();
          expect(btn.disabled).toBe(false);
          expect(btn.textContent).toBe('recordNow');
        });

        it('should show error and re-enable button when record without AI returns success=false', async () => {
          const { renderSkippedMode } = await import('../historyPendingPanel.js');
          const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
          const pages = [createMockPage()];

          mockSendMessageWithTimeout.mockResolvedValueOnce({ success: false });

          renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

          const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
          const btn = buttons[1] as HTMLButtonElement;
          btn.click();
          await flushMicrotasks();

          expect(mockShowRecordError).toHaveBeenCalled();
          expect(btn.disabled).toBe(false);
          expect(btn.textContent).toBe('recordWithoutAi');
        });

        it('should handle service worker not alive error', async () => {
          const { renderSkippedMode } = await import('../historyPendingPanel.js');
          const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
          const pages = [createMockPage()];

          mockCheckServiceWorkerAlive.mockResolvedValueOnce(false);
          mockSendMessageWithTimeout.mockRejectedValueOnce(new Error('timeout'));

          renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

          const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
          const btn = buttons[0] as HTMLButtonElement;
          btn.click();
          await flushMicrotasks();

          expect(mockShowRecordError).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ message: expect.stringContaining('serviceWorkerNotResponding') }),
          );
          expect(btn.disabled).toBe(false);
        });

        it('should handle other catch errors with alive service worker', async () => {
          const { renderSkippedMode } = await import('../historyPendingPanel.js');
          const elements = { historyList: document.createElement('div'), historyStats: document.createElement('div') };
          const pages = [createMockPage()];
          const testError = new Error('network failure');

          mockSendMessageWithTimeout.mockRejectedValueOnce(testError);

          renderSkippedMode(createMockState(pages), elements as any, '', vi.fn());

          const buttons = elements.historyList.querySelectorAll('.pending-record-btn');
          const btn = buttons[0] as HTMLButtonElement;
          btn.click();
          await flushMicrotasks();

          expect(mockShowRecordError).toHaveBeenCalledWith(expect.anything(), testError);
          expect(btn.disabled).toBe(false);
        });
      });
    });
  });

  describe('renderPendingPage', () => {
    it('should render page items with URL, timestamp, and reason', async () => {
      const { renderPendingPage } = await import('../historyPendingPanel.js');
      const pages = [createMockPage()];
      const state = createMockState(pages);
      const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

      renderPendingPage(state, {} as any, pendingSection, pendingList, pages, pendingCurrentPageRef, vi.fn());

      expect(pendingList.querySelector('.pending-entry')).not.toBeNull();
      const urlEl = pendingList.querySelector('.history-entry-url') as HTMLAnchorElement;
      expect(urlEl.href).toBe('https://example.com/page');
      expect(pendingList.querySelector('.pending-entry-meta')?.textContent).toContain('test-reason');
    });

    it('should show header value when present', async () => {
      const { renderPendingPage } = await import('../historyPendingPanel.js');
      const pages = [createMockPage({ headerValue: 'custom-header' })];
      const state = createMockState(pages);
      const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

      renderPendingPage(state, {} as any, pendingSection, pendingList, pages, pendingCurrentPageRef, vi.fn());

      expect(pendingList.innerHTML).toContain('custom-header');
    });

    it('should have record, record-no-ai, and delete buttons', async () => {
      const { renderPendingPage } = await import('../historyPendingPanel.js');
      const pages = [createMockPage()];
      const state = createMockState(pages);
      const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

      renderPendingPage(state, {} as any, pendingSection, pendingList, pages, pendingCurrentPageRef, vi.fn());

      expect(pendingList.querySelector('.pending-entry')).not.toBeNull();
      expect(pendingList.querySelectorAll('.pending-record-btn').length).toBe(2);
      expect(pendingList.querySelector('.pending-delete-btn')).not.toBeNull();
    });

    it('should show pagination controls when more than 10 items', async () => {
      const { renderPendingPage } = await import('../historyPendingPanel.js');
      const pages = Array.from({ length: 11 }, (_, i) =>
        createMockPage({ url: `https://example.com/${i}`, title: `Page ${i}` }),
      );
      const state = createMockState(pages);
      const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

      renderPendingPage(state, {} as any, pendingSection, pendingList, pages, pendingCurrentPageRef, vi.fn());

      expect(mockCreatePaginationControls).toHaveBeenCalledWith(0, 2, expect.any(Function));
    });

    it('should not show pagination controls when 10 or fewer items', async () => {
      const { renderPendingPage } = await import('../historyPendingPanel.js');
      const pages = Array.from({ length: 10 }, (_, i) =>
        createMockPage({ url: `https://example.com/${i}`, title: `Page ${i}` }),
      );
      const state = createMockState(pages);
      const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

      renderPendingPage(state, {} as any, pendingSection, pendingList, pages, pendingCurrentPageRef, vi.fn());

      expect(mockCreatePaginationControls).not.toHaveBeenCalled();
    });

    it('should render correct page of items with pagination', async () => {
      const { renderPendingPage } = await import('../historyPendingPanel.js');
      const pages = Array.from({ length: 15 }, (_, i) =>
        createMockPage({ url: `https://example.com/${i}`, title: `Page ${i}` }),
      );
      const state = createMockState(pages);
      const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
      pendingCurrentPageRef.value = 1;

      renderPendingPage(state, {} as any, pendingSection, pendingList, pages, pendingCurrentPageRef, vi.fn());

      const items = pendingList.querySelectorAll('.pending-entry');
      expect(items.length).toBe(5);
      const firstUrl = items[0].querySelector('.history-entry-url') as HTMLAnchorElement;
      expect(firstUrl.href).toBe('https://example.com/10');
      expect(mockCreatePaginationControls).toHaveBeenCalledWith(1, 2, expect.any(Function));
    });

    it('should handle pagination page change callback', async () => {
      const { renderPendingPage } = await import('../historyPendingPanel.js');
      const pages = Array.from({ length: 11 }, (_, i) =>
        createMockPage({ url: `https://example.com/${i}`, title: `Page ${i}` }),
      );
      const state = createMockState(pages);
      const sortedPending = [...pages];
      const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

      let capturedOnPageChange: ((page: number) => void) | null = null;
      mockCreatePaginationControls.mockImplementation((_currentPage, _totalPages, onPageChange) => {
        capturedOnPageChange = onPageChange;
        return document.createElement('div');
      });

      renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

      expect(capturedOnPageChange).not.toBeNull();

      capturedOnPageChange!(1);
      expect(pendingCurrentPageRef.value).toBe(1);
      expect(mockCreatePaginationControls).toHaveBeenCalledTimes(2);
      expect(mockCreatePaginationControls).toHaveBeenLastCalledWith(1, 2, expect.any(Function));
    });

    describe('record now button', () => {
      it('should call sendMessageWithTimeout with skipAi=false on click', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage({ url: 'https://example.com/rec', title: 'Record' })];
        const state = createMockState(pages);
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        renderPendingPage(state, {} as any, pendingSection, pendingList, [...pages], pendingCurrentPageRef, vi.fn());

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(mockSendMessageWithTimeout).toHaveBeenCalledWith({
          title: 'Record',
          url: 'https://example.com/rec',
          content: '',
          force: true,
          skipAi: false,
        });
      });

      it('should remove page from state and sortedPending on success', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage({ url: 'https://example.com/rec', title: 'Record' })];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(mockRemovePendingPages).toHaveBeenCalledWith(['https://example.com/rec']);
        expect(sortedPending.length).toBe(0);
        expect(state.pendingPages.length).toBe(0);
        expect(state.pendingUrlSet.has('https://example.com/rec')).toBe(false);
      });

      it('should hide pending section when all items are removed via record', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(pendingSection.hidden).toBe(true);
      });

      it('should decrement page ref when recording last item on current page', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = Array.from({ length: 11 }, (_, i) =>
          createMockPage({ url: `https://example.com/${i}`, title: `Page ${i}` }),
        );
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
        pendingCurrentPageRef.value = 1;

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        expect(pendingList.querySelectorAll('.pending-entry').length).toBe(1);

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(pendingCurrentPageRef.value).toBe(0);
      });

      it('should call refresh when other items remain after record now', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [
          createMockPage({ url: 'https://example.com/first', title: 'First' }),
          createMockPage({ url: 'https://example.com/second', title: 'Second' }),
        ];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(sortedPending.length).toBe(1);
        expect(pendingSection.hidden).toBe(false);
        expect(pendingList.querySelectorAll('.pending-entry').length).toBe(1);
      });
    });

    describe('record without AI button', () => {
      it('should call sendMessageWithTimeout with skipAi=true on click', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage({ url: 'https://example.com/noai', title: 'No AI Rec' })];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[1] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(mockSendMessageWithTimeout).toHaveBeenCalledWith({
          title: 'No AI Rec',
          url: 'https://example.com/noai',
          content: '',
          force: true,
          skipAi: true,
        });
        expect(sortedPending.length).toBe(0);
        expect(pendingSection.hidden).toBe(true);
      });

      it('should call refresh when other items remain after no-AI record', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [
          createMockPage({ url: 'https://example.com/first', title: 'First' }),
          createMockPage({ url: 'https://example.com/second', title: 'Second' }),
        ];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[1] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(sortedPending.length).toBe(1);
        expect(pendingSection.hidden).toBe(false);
        expect(pendingList.querySelectorAll('.pending-entry').length).toBe(1);
      });

      it('should decrement page ref when recording last item via no-AI on current page', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = Array.from({ length: 11 }, (_, i) =>
          createMockPage({ url: `https://example.com/${i}`, title: `Page ${i}` }),
        );
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
        pendingCurrentPageRef.value = 1;

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        expect(pendingList.querySelectorAll('.pending-entry').length).toBe(1);

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[1] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(pendingCurrentPageRef.value).toBe(0);
      });
    });

    describe('delete button', () => {
      it('should call removePendingPages on delete click', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage({ url: 'https://example.com/del', title: 'Delete Me' })];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        (pendingList.querySelector('.pending-delete-btn') as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(mockRemovePendingPages).toHaveBeenCalledWith(['https://example.com/del']);
        expect(sortedPending.length).toBe(0);
        expect(state.pendingPages.length).toBe(0);
        expect(state.pendingUrlSet.has('https://example.com/del')).toBe(false);
      });

      it('should hide pending section when all items are deleted', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        (pendingList.querySelector('.pending-delete-btn') as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(pendingSection.hidden).toBe(true);
      });

      it('should re-enable delete button on error', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        mockRemovePendingPages.mockRejectedValueOnce(new Error('fail'));

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        const deleteBtn = pendingList.querySelector('.pending-delete-btn') as HTMLButtonElement;
        deleteBtn.click();
        await flushMicrotasks();

        expect(deleteBtn.disabled).toBe(false);
      });
    });

    describe('page boundary handling', () => {
      it('should decrement page ref when deleting last item on current page', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = Array.from({ length: 11 }, (_, i) =>
          createMockPage({ url: `https://example.com/${i}`, title: `Page ${i}` }),
        );
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
        pendingCurrentPageRef.value = 1;

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        expect(pendingList.querySelectorAll('.pending-entry').length).toBe(1);

        (pendingList.querySelector('.pending-delete-btn') as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(pendingCurrentPageRef.value).toBe(0);
      });

      it('should not decrement page ref when there are still items on next page', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = Array.from({ length: 12 }, (_, i) =>
          createMockPage({ url: `https://example.com/${i}`, title: `Page ${i}` }),
        );
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
        pendingCurrentPageRef.value = 1;

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        expect(pendingList.querySelectorAll('.pending-entry').length).toBe(2);

        (pendingList.querySelector('.pending-delete-btn') as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(pendingCurrentPageRef.value).toBe(1);
      });
    });

    describe('activeFilter skipped behavior', () => {
      it('should call onApplyFilters when activeFilter is skipped on record now', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        state.activeFilter = 'skipped';
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
        const onApplyFilters = vi.fn();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, onApplyFilters);

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(onApplyFilters).toHaveBeenCalled();
      });

      it('should call onApplyFilters when activeFilter is skipped on record without AI', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        state.activeFilter = 'skipped';
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
        const onApplyFilters = vi.fn();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, onApplyFilters);

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[1] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(onApplyFilters).toHaveBeenCalled();
      });

      it('should call onApplyFilters when activeFilter is skipped on delete', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        state.activeFilter = 'skipped';
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
        const onApplyFilters = vi.fn();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, onApplyFilters);

        (pendingList.querySelector('.pending-delete-btn') as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(onApplyFilters).toHaveBeenCalled();
      });

      it('should not call onApplyFilters when activeFilter is not skipped', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        state.activeFilter = 'auto';
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
        const onApplyFilters = vi.fn();

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, onApplyFilters);

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        (buttons[0] as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(onApplyFilters).not.toHaveBeenCalled();
      });
    });

    describe('failure paths', () => {
      it('should show error and re-enable button on record failure', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        mockSendMessageWithTimeout.mockResolvedValueOnce({ success: false });

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        const btn = buttons[0] as HTMLButtonElement;
        btn.click();
        await flushMicrotasks();

        expect(mockShowRecordError).toHaveBeenCalled();
        expect(btn.disabled).toBe(false);
      });

      it('should handle catch error on record and re-enable button', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();
        const testError = new Error('async error');

        mockSendMessageWithTimeout.mockRejectedValueOnce(testError);

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        const btn = buttons[0] as HTMLButtonElement;
        btn.click();
        await flushMicrotasks();

        expect(mockShowRecordError).toHaveBeenCalledWith(expect.anything(), testError);
        expect(btn.disabled).toBe(false);
      });

      it('should handle service worker not alive on record in renderPendingPage', async () => {
        const { renderPendingPage } = await import('../historyPendingPanel.js');
        const pages = [createMockPage()];
        const state = createMockState(pages);
        const sortedPending = [...pages];
        const { pendingSection, pendingList, pendingCurrentPageRef } = createPendingFixture();

        mockCheckServiceWorkerAlive.mockResolvedValueOnce(false);
        mockSendMessageWithTimeout.mockRejectedValueOnce(new Error('timeout'));

        renderPendingPage(state, {} as any, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, vi.fn());

        const buttons = pendingList.querySelectorAll('.pending-record-btn');
        const btn = buttons[0] as HTMLButtonElement;
        btn.click();
        await flushMicrotasks();

        expect(mockShowRecordError).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ message: expect.stringContaining('serviceWorkerNotResponding') }),
        );
        expect(btn.disabled).toBe(false);
      });
    });
  });
});

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
