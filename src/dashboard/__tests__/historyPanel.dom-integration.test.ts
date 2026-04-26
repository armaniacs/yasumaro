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

    it('handles navigate-to-tag event', async () => {
      mockEntries = [{ url: 'https://example.com/1', title: 'Test 1', timestamp: 1000 }] as SavedUrlEntry[];
      mockGetSavedUrlEntries.mockResolvedValueOnce(mockEntries);

      await initHistoryPanel();

      document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: 'tech' }));
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
  });
});