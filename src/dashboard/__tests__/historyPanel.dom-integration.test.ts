// @vitest-environment jsdom
/**
 * historyPanel.dom-integration.test.ts
 * DOM integration tests for historyPanel.ts
 * Tests initHistoryPanel function with full DOM environment
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SavedUrlEntry, PendingPage } from '../../utils/storageUrls.js';

// Use vi.hoisted for proper hoisting of mock functions
const { mockGetSavedUrlEntries, mockGetPendingPages } = vi.hoisted(() => ({
  mockGetSavedUrlEntries: vi.fn(),
  mockGetPendingPages: vi.fn(),
}));

// Mock chrome global before importing modules
// Note: chrome.storage.onChanged is at chrome.storage.onChanged (not chrome.storage.local.onChanged)
vi.stubGlobal('chrome', {
  i18n: {
    getMessage: vi.fn((key: string) => `i18n_${key}`),
    getUILanguage: vi.fn(() => 'en'),
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  },
});

// Mock i18n
vi.mock('../popup/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

// Mock storage
vi.mock('../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: mockGetSavedUrlEntries,
}));
vi.mock('../../utils/pendingStorage.js', () => ({
  getPendingPages: mockGetPendingPages,
}));

// Mock renderers and helpers
vi.mock('../historyRenderer.js', () => ({
  renderHistoryEntries: vi.fn(),
}));
vi.mock('../historyPendingPanel.js', () => ({
  renderSkippedMode: vi.fn(),
  renderPendingPage: vi.fn(),
}));
vi.mock('../historyFilters.js', () => ({
  updateTagFilterIndicator: vi.fn(),
}));
vi.mock('../historyTagEditModal.js', () => ({
  initTagEditModal: vi.fn(),
  saveTagEdits: vi.fn(),
}));
vi.mock('../historyCleansingSync.js', () => ({
  updateCleansingStatsPanel: vi.fn(),
}));
vi.mock('../historyState.js', () => ({
  createInitialState: vi.fn().mockReturnValue({
    entries: [],
    activeFilter: 'all',
    activeTagFilter: null,
    historyCurrentPage: 0,
    pendingPages: [],
    pendingUrlSet: new Set(),
    editingUrl: null,
    editingTags: [],
    tagEditTrapId: null,
  }),
}));

import { initHistoryPanel } from '../historyPanel.js';
import { renderHistoryEntries } from '../historyRenderer.js';
import { renderSkippedMode } from '../historyPendingPanel.js';
import { updateTagFilterIndicator } from '../historyFilters.js';
import { updateCleansingStatsPanel } from '../historyCleansingSync.js';

describe('historyPanel DOM Integration Tests', () => {
  let mockEntries: SavedUrlEntry[];
  let mockPendingPages: PendingPage[];

  const requiredDomElements = `
    <input id="historySearch" />
    <div id="historyList"></div>
    <div id="historyStats"></div>
    <div id="pendingSection"></div>
    <div id="pendingList"></div>
    <button class="history-filter-btn" data-filter="all"></button>
    <button class="history-filter-btn" data-filter="auto"></button>
    <button class="history-filter-btn" data-filter="manual"></button>
    <button class="history-filter-btn" data-filter="skipped"></button>
    <div id="tagEditModal" class="hidden"></div>
    <button id="closeTagEditModalBtn"></button>
    <div id="tagEditUrl"></div>
    <div id="currentTagsList"></div>
    <div id="noCurrentTagsMsg"></div>
    <select id="tagCategorySelect"></select>
    <button id="addTagBtn"></button>
    <button id="saveTagEditsBtn"></button>
    <div class="history-controls"></div>
  `;

  beforeEach(() => {
    document.body.innerHTML = requiredDomElements;
    vi.clearAllMocks();
    // Reset mock implementations to return empty arrays by default
    mockGetSavedUrlEntries.mockResolvedValue([]);
    mockGetPendingPages.mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('initHistoryPanel', () => {
    it('returns early when historyList is not found', async () => {
      document.body.innerHTML = '<div id="historyStats"></div>'; // No historyList
      await initHistoryPanel();
      // Should not throw and should not call storage
      expect(mockGetSavedUrlEntries).not.toHaveBeenCalled();
    });

    it('loads entries from storage and initializes state', async () => {
      mockEntries = [
        { url: 'https://example.com/1', title: 'Test 1', timestamp: 1000, recordType: 'auto' },
        { url: 'https://example.com/2', title: 'Test 2', timestamp: 2000, recordType: 'manual' },
      ] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      expect(mockGetSavedUrlEntries).toHaveBeenCalledTimes(1);
      expect(renderHistoryEntries).toHaveBeenCalled();
    });

    it('loads pending pages from storage', async () => {
      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockPendingPages = [
        { url: 'https://pending.com/1', title: 'Pending 1', timestamp: 4000, reason: 'cache-control' },
      ] as PendingPage[];

      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);
      mockGetPendingPages.mockResolvedValueOnce(mockPendingPages);

      await initHistoryPanel();

      expect(mockGetPendingPages).toHaveBeenCalledTimes(1);
    });

    it('renders history entries after loading data', async () => {
      mockEntries = [
        { url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 },
      ] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      expect(renderHistoryEntries).toHaveBeenCalled();
    });

    it('sets up search input event listener', async () => {
      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      const searchInput = document.getElementById('historySearch') as HTMLInputElement;
      expect(searchInput).not.toBeNull();

      // Dispatch input event to trigger filter
      searchInput.value = 'test';
      searchInput.dispatchEvent(new Event('input'));
    });

    it('sets up filter button click handlers', async () => {
      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      const filterBtn = document.querySelector('.history-filter-btn[data-filter="auto"]') as HTMLButtonElement;
      filterBtn.click();
    });

    it('sets up storage change listener', async () => {
      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();
    });

    it('handles empty entries gracefully', async () => {
      mockGetSavedUrlEntries.mockResolvedValueOnce([]);

      await initHistoryPanel();

      expect(renderHistoryEntries).toHaveBeenCalled();
    });

    it('shows pending section when there are pending pages', async () => {
      mockEntries = [] as SavedUrlEntry[];
      mockPendingPages = [
        { url: 'https://pending.com/1', title: 'Pending 1', timestamp: 4000, reason: 'cache-control' },
      ] as PendingPage[];

      mockGetSavedUrlEntries.mockResolvedValueOnce([]);
      mockGetPendingPages.mockResolvedValueOnce(mockPendingPages);

      await initHistoryPanel();

      const pendingSection = document.getElementById('pendingSection') as HTMLElement;
      expect(pendingSection.hidden).toBe(false);
    });

    it('hides pending section when no pending pages', async () => {
      mockGetSavedUrlEntries.mockResolvedValueOnce([]);
      mockGetPendingPages.mockResolvedValueOnce([]);

      await initHistoryPanel();

      const pendingSection = document.getElementById('pendingSection') as HTMLElement;
      expect(pendingSection.hidden).toBe(true);
    });

    it('renders skipped mode when activeFilter is skipped', async () => {
      mockEntries = [
        { url: 'https://example.com/1', title: 'Test 1', timestamp: 1000, recordType: 'auto' },
      ] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      const skipBtn = document.querySelector('.history-filter-btn[data-filter="skipped"]') as HTMLButtonElement;
      if (!skipBtn) {
        // Create skipped filter button dynamically if not in fixture
        const newBtn = document.createElement('button');
        newBtn.className = 'history-filter-btn';
        newBtn.dataset.filter = 'skipped';
        document.body.appendChild(newBtn);
        newBtn.click();
      } else {
        skipBtn.click();
      }

      expect(renderSkippedMode).toHaveBeenCalled();
    });

    it('handles search input with special characters', async () => {
      mockEntries = [
        { url: 'https://example.com/1', title: 'Test <script>alert(1)</script>', timestamp: 1000 },
      ] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      const searchInput = document.getElementById('historySearch') as HTMLInputElement;
      searchInput.value = '<script>';
      searchInput.dispatchEvent(new Event('input'));

      // Initial init call applies filters; event handler should also apply filters.
      // We assert the search input value was set and event dispatched without error.
      expect(searchInput.value).toBe('<script>');
    });

    it('handles empty search input gracefully', async () => {
      mockEntries = [
        { url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 },
      ] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      const searchInput = document.getElementById('historySearch') as HTMLInputElement;
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));

      expect(searchInput.value).toBe('');
    });

    it('handles storage change for saved URLs', async () => {
      mockEntries = [
        { url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 },
      ] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();

      const listener = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      mockGetSavedUrlEntries.mockResolvedValueOnce([
        { url: 'https://example.com/2', title: 'Updated', timestamp: 2000 },
      ] as SavedUrlEntry[]);

      await listener(
        { savedUrlsWithTimestamps: { oldValue: [], newValue: [{ url: 'https://example.com/2', title: 'Updated', timestamp: 2000 }] } },
        'local'
      );

      // The listener schedules applyFilters via Promise.all(...).then(); give microtasks a chance
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockGetSavedUrlEntries).toHaveBeenCalledTimes(2);
    });

    it('ignores storage changes for non-local areas', async () => {
      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      const listener = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      mockGetSavedUrlEntries.mockClear();

      await listener({}, 'sync');

      expect(mockGetSavedUrlEntries).not.toHaveBeenCalled();
    });

    it('ignores storage changes for unrelated keys', async () => {
      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      const listener = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      mockGetSavedUrlEntries.mockClear();

      await listener({ unrelatedKey: { oldValue: null, newValue: 'value' } }, 'local');

      expect(mockGetSavedUrlEntries).not.toHaveBeenCalled();
    });

    it('handles storage change for pending pages', async () => {
      mockEntries = [] as SavedUrlEntry[];
      mockPendingPages = [
        { url: 'https://pending.com/1', title: 'Pending 1', timestamp: 4000, reason: 'cache-control' },
      ] as PendingPage[];

      mockGetSavedUrlEntries.mockResolvedValueOnce([]);
      mockGetPendingPages.mockResolvedValueOnce([]);

      await initHistoryPanel();

      const listener = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      mockGetPendingPages.mockResolvedValueOnce(mockPendingPages);

      await listener(
        { osh_pending_pages: { oldValue: [], newValue: mockPendingPages } },
        'local'
      );

      expect(mockGetPendingPages).toHaveBeenCalledTimes(2);
    });

    it('handles both saved and pending storage changes together', async () => {
      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);
      mockGetPendingPages.mockResolvedValueOnce([]);

      await initHistoryPanel();

      const listener = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      mockGetSavedUrlEntries.mockResolvedValueOnce([
        { url: 'https://example.com/2', title: 'Updated', timestamp: 2000 },
      ] as SavedUrlEntry[]);
      mockGetPendingPages.mockResolvedValueOnce([
        { url: 'https://pending.com/1', title: 'Pending 1', timestamp: 4000, reason: 'cache-control' },
      ] as PendingPage[]);

      await listener(
        {
          savedUrlsWithTimestamps: { oldValue: [], newValue: [] },
          osh_pending_pages: { oldValue: [], newValue: [] },
        },
        'local'
      );

      expect(mockGetSavedUrlEntries).toHaveBeenCalledTimes(2);
      expect(mockGetPendingPages).toHaveBeenCalledTimes(2);
    });

    it.skip('handles large lists without errors', async () => {
      mockEntries = Array.from({ length: 500 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: `Test Entry ${i}`,
        timestamp: 1000 + i,
        recordType: i % 2 === 0 ? 'auto' : 'manual',
      })) as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      expect(renderHistoryEntries).toHaveBeenCalled();
      expect(updateCleansingStatsPanel).toHaveBeenCalled();
    });

    it.skip('handles entries with missing optional fields', async () => {
      mockEntries = [
        { url: 'https://example.com/1' },
        { url: 'https://example.com/2', title: undefined, timestamp: undefined },
      ] as unknown as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      expect(renderHistoryEntries).toHaveBeenCalled();
    });

    it('filters entries by record type when filter button clicked', async () => {
      mockEntries = [
        { url: 'https://example.com/1', title: 'Auto 1', timestamp: 1000, recordType: 'auto' },
        { url: 'https://example.com/2', title: 'Manual 1', timestamp: 2000, recordType: 'manual' },
      ] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      const autoBtn = document.querySelector('.history-filter-btn[data-filter="auto"]') as HTMLButtonElement;
      autoBtn.click();

      expect(renderHistoryEntries).toHaveBeenCalled();
    });

    it('clears tag filter when search input changes', async () => {
      mockEntries = [
        { url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 },
      ] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      const searchInput = document.getElementById('historySearch') as HTMLInputElement;
      searchInput.value = 'query';
      searchInput.dispatchEvent(new Event('input'));

      expect(updateTagFilterIndicator).toHaveBeenCalled();
    });

    it('handles error in getSavedUrlEntries gracefully', async () => {
      mockGetSavedUrlEntries.mockRejectedValueOnce(new Error('Storage error'));

      await expect(initHistoryPanel()).rejects.toThrow('Storage error');
    });

    it('handles error in getPendingPages gracefully', async () => {
      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);
      mockGetPendingPages.mockRejectedValueOnce(new Error('Pending storage error'));

      await expect(initHistoryPanel()).rejects.toThrow('Pending storage error');
    });

    it('handles entries sorted by timestamp ascending then descending', async () => {
      mockEntries = [
        { url: 'https://example.com/1', title: 'First', timestamp: 1000 },
        { url: 'https://example.com/2', title: 'Second', timestamp: 3000 },
        { url: 'https://example.com/3', title: 'Third', timestamp: 2000 },
      ] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      // Verify renderHistoryEntries was called (the module sorts descending internally)
      expect(renderHistoryEntries).toHaveBeenCalled();
    });

    it('handles pending section when pendingList element is missing', async () => {
      // Remove pendingList from DOM
      document.body.innerHTML = `
        <input id="historySearch" />
        <div id="historyList"></div>
        <div id="historyStats"></div>
        <div id="pendingSection"></div>
        <button class="history-filter-btn" data-filter="all"></button>
        <div id="tagEditModal" class="hidden"></div>
        <button id="closeTagEditModalBtn"></button>
        <div id="tagEditUrl"></div>
        <div id="currentTagsList"></div>
        <div id="noCurrentTagsMsg"></div>
        <select id="tagCategorySelect"></select>
        <button id="addTagBtn"></button>
        <button id="saveTagEditsBtn"></button>
        <div class="history-controls"></div>
      `;

      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockPendingPages = [
        { url: 'https://pending.com/1', title: 'Pending 1', timestamp: 4000, reason: 'cache-control' },
      ] as PendingPage[];

      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);
      mockGetPendingPages.mockResolvedValueOnce(mockPendingPages);

      // Should not throw even without pendingList
      await expect(initHistoryPanel()).resolves.not.toThrow();
    });
  });
});