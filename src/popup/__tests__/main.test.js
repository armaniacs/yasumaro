/**
 * main.test.js
 * Main Screen Functionality Tests
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock all dependencies (must be defined before imports)
jest.mock('src/popup/sanitizePreview.js', () => ({
  showPreview: jest.fn(),
  initializeModalEvents: jest.fn()
}));

jest.mock('src/popup/spinner.js', () => ({
  showSpinner: jest.fn(),
  hideSpinner: jest.fn()
}));

jest.mock('src/popup/autoClose.js', () => ({
  startAutoCloseTimer: jest.fn()
}));

jest.mock('src/popup/tabUtils.js', () => ({
  getCurrentTab: jest.fn(() => Promise.resolve(null)),
  isRecordable: jest.fn(() => true)
}));

jest.mock('src/utils/storage.js', () => ({
  getSettings: jest.fn(() => Promise.resolve({})),
  StorageKeys: {
    PII_CONFIRMATION_UI: 'pii_confirmation_ui'
  }
}));

// Import mocked functions after jest.mock declarations
import { showPreview } from 'src/popup/sanitizePreview.js';
import { startAutoCloseTimer } from 'src/popup/autoClose.js';
import { getCurrentTab, isRecordable } from 'src/popup/tabUtils.js';
import { getSettings, StorageKeys } from 'src/utils/storage.js';
import { loadCurrentTab, recordCurrentPage } from 'src/popup/main.js';

// Mock chrome API with i18n support
const mockChrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    },
    sync: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
    onUpdated: {
      addListener: jest.fn()
    }
  },
  runtime: {
    lastError: null,
    sendMessage: jest.fn(),
    getURL: jest.fn((path) => `chrome-extension://test-extension-id${path}`),
    onMessage: {
      addListener: jest.fn()
    }
  },
  i18n: {
    getMessage: jest.fn((key, substitutions) => {
      // Test mock messages (matching messages.json structure)
      const messages = {
        'cannotRecordPage': 'Cannot record this page',
        'errorPrefix': '✗ Error:',
        'connectionError': 'Please refresh the page and try again',
        'domainBlockedError': 'This domain is not allowed to be recorded. Do you want to record it anyway?',
        'forceRecord': 'Force Record',
        'success': '✓ Saved to Obsidian',
        'cancelled': 'Cancelled',
        'recordNow': '📝 Record Now',
      };

      let message = messages[key] || key;

      // Handle substitutions
      if (substitutions && typeof substitutions === 'object') {
        Object.keys(substitutions).forEach((placeholder) => {
          message = message.replace(`{${placeholder}}`, substitutions[placeholder]);
        });
      }

      return message;
    }),
    getUILanguage: jest.fn(() => 'en'),
  }
};

global.chrome = mockChrome;

describe('main', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // 【修正】: jsdomを使用したDOM要素の作成
    document.body.innerHTML = `
      <div id="mainScreen">
        <img id="favicon" src="" alt="Favicon">
        <h2 id="pageTitle">Loading...</h2>
        <p id="pageUrl">Loading...</p>
        <button id="recordBtn" disabled="false">📝 Record Now</button>
        <div id="mainStatus"></div>
      </div>
    `;
  });

  afterEach(() => {
    // Clean up DOM
    document.body.innerHTML = '';
  });

  describe('loadCurrentTab', () => {
    it('should load current tab information', async () => {
      // Mock tab data
      const mockTab = {
        favIconUrl: 'https://example.com/favicon.ico',
        title: 'Example Page',
        url: 'https://example.com'
      };

      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);

      await loadCurrentTab();

      // Check if DOM elements are updated
      const favicon = document.getElementById('favicon');
      const pageTitle = document.getElementById('pageTitle');
      const pageUrl = document.getElementById('pageUrl');
      const recordBtn = document.getElementById('recordBtn');

      // favicon.src は chrome.runtime.getURL を使用して構築される URL になる
      expect(favicon.src).toBe('chrome-extension://test-extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com&size=32');
      expect(pageTitle.textContent).toBe('Example Page');
      expect(pageUrl.textContent).toBe('https://example.com');
      expect(recordBtn.disabled).toBe(false);
      expect(recordBtn.textContent).toBe('📝 Record Now');
    });

    it('should handle recordable page correctly', async () => {
      // Mock tab data
      const mockTab = {
        favIconUrl: '',
        title: 'Non-recordable Page',
        url: 'chrome://extensions'
      };

      getCurrentTab.mockImplementation(() => Promise.resolve(mockTab));
      isRecordable.mockReturnValue(false);

      await loadCurrentTab();

      // Check if record button is disabled
      const recordBtn = document.getElementById('recordBtn');
      expect(recordBtn.disabled).toBe(true);
      expect(recordBtn.textContent).toBe('Cannot record this page');
    });

    it('should handle null tab', async () => {
      // Mock null tab
      getCurrentTab.mockImplementation(() => Promise.resolve(null));

      await loadCurrentTab();

      // Should not throw error and should not update DOM
      const pageTitle = document.getElementById('pageTitle');
      expect(pageTitle.textContent).toBe('Loading...');
    });
  });

  describe('recordCurrentPage', () => {
    it('should handle non-recordable page', async () => {
      // Mock tab data
      const mockTab = {
        url: 'chrome://extensions'
      };

      getCurrentTab.mockImplementation(() => Promise.resolve(mockTab));
      isRecordable.mockReturnValue(false);

      await recordCurrentPage();

      // Check if error message is displayed
      const statusDiv = document.getElementById('mainStatus');
      expect(statusDiv.className).toBe('error');
      expect(statusDiv.textContent).toBe('✗ Error: Cannot record this page');
    });

    it('should handle connection error', async () => {
      // Mock tab data
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      getCurrentTab.mockImplementation(() => Promise.resolve(mockTab));
      isRecordable.mockReturnValue(true);
      getSettings.mockImplementation(() => Promise.resolve({ [StorageKeys.PII_CONFIRMATION_UI]: true }));

      // Mock chrome API to throw error
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));

      // Mock DOM elements
      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      // Check if error message is displayed
      expect(statusDiv.className).toBe('error');
      expect(statusDiv.textContent).toBe('✗ Error: Please refresh the page and try again');
    });

    it('should handle domain blocked error with force record', async () => {
      // Mock tab data
      const mockTab = {
        id: 1,
        title: 'Blocked Page',
        url: 'https://blocked.com'
      };

      getCurrentTab.mockImplementation(() => Promise.resolve(mockTab));
      isRecordable.mockReturnValue(true);
      getSettings.mockImplementation(() => Promise.resolve({ [StorageKeys.PII_CONFIRMATION_UI]: true }));

      // Mock chrome API to return domain blocked error code
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      mockChrome.runtime.sendMessage.mockResolvedValue({
        success: false,
        error: 'DOMAIN_BLOCKED'
      });

      // Mock DOM elements
      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      // Check if force record button is displayed
      expect(statusDiv.querySelector('button')).toBeTruthy();
      expect(statusDiv.querySelector('button').textContent).toBe('Force Record');
      // statusDiv の最初のテキストノードを確認 - i18nで表示用メッセージに変換される
      const expectedText = 'This domain is not allowed to be recorded. Do you want to record it anyway?';
      expect(statusDiv.childNodes[0].textContent).toBe(expectedText);
    });

    it('should successfully record page with preview', async () => {
      // Mock tab data
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      getSettings.mockImplementation(() => Promise.resolve({ [StorageKeys.PII_CONFIRMATION_UI]: true }));

      // Mock chrome API responses
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      mockChrome.runtime.sendMessage
        .mockResolvedValueOnce({
          success: true,
          mode: 'masked_cloud',
          maskedCount: 1,
          processedContent: '[MASKED:email]@example.com'
        })
        .mockResolvedValueOnce({ success: true });

      // Mock showPreview to confirm
      showPreview.mockResolvedValue({ confirmed: true, content: '[MASKED:email]@example.com' });

      // Mock DOM elements
      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      // Check if success message is displayed
      expect(statusDiv.className).toBe('success');
      expect(statusDiv.textContent).toBe('✓ Saved to Obsidian');
      expect(startAutoCloseTimer).toHaveBeenCalled();
    });

    it('should successfully record page without preview', async () => {
      // Mock tab data
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      getSettings.mockImplementation(() => Promise.resolve({ [StorageKeys.PII_CONFIRMATION_UI]: false }));

      // Mock chrome API responses
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });

      // Mock DOM elements
      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      // Check if success message is displayed
      expect(statusDiv.className).toBe('success');
      expect(statusDiv.textContent).toBe('✓ Saved to Obsidian');
      expect(startAutoCloseTimer).toHaveBeenCalled();
    });

    it('should handle preview cancellation', async () => {
      // Mock tab data
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: true });

      // Mock chrome API responses
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      mockChrome.runtime.sendMessage.mockResolvedValue({
        success: true,
        mode: 'masked_cloud',
        maskedCount: 1,
        processedContent: '[MASKED:email]@example.com'
      });

      // Mock showPreview to cancel
      showPreview.mockResolvedValue({ confirmed: false, content: null });

      // Mock DOM elements
      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      // Check if cancellation message is displayed
      expect(statusDiv.textContent).toBe('Cancelled');
    });

    it('should show specific error message when PREVIEW_RECORD fails', async () => {
      // Mock tab data
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: true });

      // Mock chrome API responses
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      // Simulate a specific error from service worker
      mockChrome.runtime.sendMessage.mockResolvedValue({
        success: false,
        error: 'AI_PROVIDER_ERROR: Rate limit exceeded'
      });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      // Check if specific error message is displayed instead of "Processing failed"
      expect(statusDiv.className).toBe('error');
      expect(statusDiv.textContent).toBe('✗ Error: AI_PROVIDER_ERROR: Rate limit exceeded');
    });
  });
});