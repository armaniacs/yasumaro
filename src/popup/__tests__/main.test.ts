// @vitest-environment jsdom
/**
 * main.test.js
 * Main Screen Functionality Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock all dependencies (must be defined before imports)
vi.mock('../sanitizePreview.js', () => ({
  showPreview: vi.fn(),
  initializeModalEvents: vi.fn()
}));

vi.mock('../spinner.js', () => ({
  showSpinner: vi.fn(),
  hideSpinner: vi.fn()
}));

vi.mock('../autoClose.js', () => ({
  startAutoCloseTimer: vi.fn()
}));

vi.mock('../tabUtils.js', () => ({
  getCurrentTab: vi.fn(() => Promise.resolve(null)),
  isRecordable: vi.fn(() => true)
}));

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn(() => Promise.resolve({})),
  saveSettings: vi.fn(() => Promise.resolve()),
  StorageKeys: {
    PII_CONFIRMATION_UI: 'pii_confirmation_ui',
    DOMAIN_WHITELIST: 'domainWhitelist'
  }
}));

vi.mock('../statusChecker.js', () => ({
  checkPageStatus: vi.fn()
}));

vi.mock('../errorUtils.js', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  ErrorMessages: {
    CONNECTION_ERROR: 'Please refresh the page and try again',
    DOMAIN_BLOCKED: 'This domain is not allowed to be recorded. Do you want to record it anyway?',
    ERROR_PREFIX: '✗ Error:',
    SUCCESS: '✓ Saved to Obsidian',
    CANCELLED: 'Cancelled',
    UNKNOWN_ERROR: 'Unknown error'
  },
  isDomainBlockedError: vi.fn(),
  isConnectionError: vi.fn(),
  formatSuccessMessage: vi.fn((_totalDuration: number, _aiDuration?: number) => '✓ Saved to Obsidian')
}));

vi.mock('../../utils/retryHelper.js', () => ({
  sendMessageWithRetry: vi.fn((message) => Promise.resolve({ success: true })),
  ChromeMessageSender: class {
    constructor() {}
    sendMessageWithRetry() { return Promise.resolve({ success: true }); }
  },
  createSender: vi.fn(() => ({
    sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true }))
  }))
}));

vi.mock('../i18n.js', () => ({
  getMessage: vi.fn((key: string, substitutions?: any) => {
    const messages: Record<string, string> = {
      cannotRecordPage: 'Cannot record this page',
      noTitle: 'No title',
      recordNow: '📝 Record Now',
      cannotRecord: 'Cannot record this page',
      forceRecordAnyway: 'Record Anyway',
      recording: 'Recording...',
      saving: 'Saving...',
      fetchingContent: 'Fetching content...',
      localAiProcessing: 'Processing content...',
      cancelled: 'Cancelled',
      errorPrefix: '✗ Error:',
      saveSuccess: 'Saved successfully',
      saveError: 'Save error',
      pendingPagesEmpty: 'No items selected',
      errorContentScriptNotAvailable: 'Content script not available',
      errorNoContentResponse: 'No content response',
      privatePageReason_cachecontrol: 'Cache-Control: private',
      privatePageReason_setcookie: 'Set-Cookie',
      privatePageReason_authorization: 'Authorization',
    };
    let msg = messages[key] || key;
    if (substitutions && typeof substitutions === 'object') {
      Object.keys(substitutions).forEach((k) => {
        msg = msg.replace(`{${k}}`, substitutions[k]);
      });
    }
    return msg;
  })
}));

vi.mock('../../utils/pendingStorage.js', () => ({
  getPendingPages: vi.fn(() => Promise.resolve([])),
  removePendingPages: vi.fn(() => Promise.resolve())
}));

vi.mock('../../utils/domainUtils.js', () => ({
  extractDomain: vi.fn((url: string) => {
    try { return new URL(url).hostname; } catch { return ''; }
  })
}));

vi.mock('../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn(() => Promise.resolve([]))
}));

vi.mock('../../utils/permissionManager.js', () => ({
  isAllUrlsPermitted: vi.fn(() => Promise.resolve(true)),
  isHostPermitted: vi.fn(() => Promise.resolve(true)),
  requestPermission: vi.fn(() => Promise.resolve(true)),
  requestAllUrls: vi.fn(() => Promise.resolve(true)),
  recordDeniedVisit: vi.fn(() => Promise.resolve())
}), { virtual: true });

vi.mock('../../utils/trustChecker.js', () => ({
  getTrustLevelDisplay: vi.fn(() => Promise.resolve({ level: 'Trusted' })),
  checkDomainTrust: vi.fn(() => Promise.resolve({ showAlert: false, trustResult: {} }))
}), { virtual: true });

// Import mocked functions after vi.mock declarations
import { showPreview } from '../sanitizePreview.js';
import { sendMessageWithRetry } from '../../utils/retryHelper.js';
import { startAutoCloseTimer } from '../autoClose.js';
import { getCurrentTab, isRecordable } from '../tabUtils.js';
import { getSettings, StorageKeys } from '../../utils/storage.js';
import { checkPageStatus } from '../statusChecker.js';
import { loadCurrentTab, recordCurrentPage, getCleansedReasonText, renderSpecialUrlStatus } from '../main.js';
import { loadPendingPages, saveSelectedPages } from '../pendingPages.js';
import { showError, isConnectionError, isDomainBlockedError, formatSuccessMessage } from '../errorUtils.js';
import { getPendingPages, removePendingPages } from '../../utils/pendingStorage.js';
import { getSavedUrlEntries } from '../../utils/storageUrls.js';

// Mock chrome API with i18n support
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn()
    },
    sync: {
      get: vi.fn(),
      set: vi.fn()
    }
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    onUpdated: {
      addListener: vi.fn()
    }
  },
  runtime: {
    lastError: null as any,
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://test-extension-id${path}`),
    onMessage: {
      addListener: vi.fn()
    }
  },
  permissions: {
    contains: vi.fn(() => Promise.resolve(true)),
    request: vi.fn(() => Promise.resolve(true))
  },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve([{ result: 'scripted content' }]))
  },
  action: {
    setBadgeText: vi.fn()
  },
  i18n: {
    getMessage: vi.fn((key: string, substitutions?: any) => {
      const messages: Record<string, string> = {
        cannotRecordPage: 'Cannot record this page',
        errorPrefix: '✗ Error:',
        forceRecordAnyway: 'Record Anyway',
        recordNow: '📝 Record Now',
        noTitle: 'No title',
        warningPrivatePageMessage: 'Private page: {0} ({1})',
        warningConfirmSave: 'Are you sure?',
      };
      let message = messages[key] || key;
      if (substitutions && typeof substitutions === 'object') {
        Object.keys(substitutions).forEach((placeholder) => {
          message = message.replace(`{${placeholder}}`, substitutions[placeholder]);
        });
      }
      return message;
    }),
    getUILanguage: vi.fn(() => 'en'),
  }
};

global.chrome = mockChrome as any;

describe('main', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Mock chrome.tabs.query to return empty array by default
    mockChrome.tabs.query.mockResolvedValue([]);
    mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
    mockChrome.permissions.contains.mockResolvedValue(true);

    // Restore chrome.i18n.getMessage mock (jest.clearAllMocks clears it)
    global.chrome.i18n.getMessage.mockImplementation((key: string, substitutions?: any) => {
      const messages: Record<string, string> = {
        loading: 'Loading...',
        processing: 'Processing...',
        appTitle: 'Smart History',
        recordNow: '📝 Record Now',
        cannotRecordPage: 'Cannot record this page',
        noTitle: 'No title',
        save: 'Save',
        cancel: 'Cancel',
        connectionError: 'Please refresh the page and try again',
        domainBlockedError: 'This domain is not allowed to be recorded. Do you want to record it anyway?',
        success: '✓ Saved to Obsidian',
        cancelled: 'Cancelled',
        forceRecord: 'Force Record',
        forceRecordAnyway: 'Record Anyway',
        errorPrefix: '✗ Error:',
        recording: 'Recording...',
        saving: 'Saving...',
        fetchingContent: 'Fetching content...',
        localAiProcessing: 'Processing content...',
        unknownError: 'Unknown error',
        seconds: 's',
        errorContentScriptNotAvailable: 'Content script not available',
        errorNoContentResponse: 'No content response',
        statusShowDetails: 'Show Details',
        statusHideDetails: 'Hide Details',
        statusRecordable: 'This page is recordable',
        statusBlocked: 'This page is blocked',
        statusPrivateDetected: 'Private page detected',
        warningPrivatePageMessage: 'Private page detected: {0}',
        saveSuccess: 'Saved successfully',
        saveError: 'Save error',
        pendingPagesEmpty: 'No items selected',
      };

      let message = messages[key] || key;

      if (substitutions && typeof substitutions === 'object') {
        Object.keys(substitutions).forEach((placeholder) => {
          const value = substitutions[placeholder];
          message = message.replace(`{${placeholder}}`, value);
        });
      }

      return message;
    });

    // Mock checkPageStatus to return success by default
    checkPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, blocked: false },
      privacyHeader: false,
      https: true
    });

    // Mock showError to properly set error styles with prefix
    showError.mockImplementation((statusElement: HTMLElement, error: any, onForceRecord?: (() => void) | null) => {
      statusElement.className = 'error';
      statusElement.textContent = '';

      const errorMsg = typeof error === 'string' ? error : error?.message || 'Unknown error';
      const prefix = '✗ Error:';

      if (isConnectionError(error)) {
        statusElement.textContent = `${prefix} Please refresh the page and try again`;
        return;
      }

      if (isDomainBlockedError(error)) {
        statusElement.textContent = 'This domain is not allowed to be recorded. Do you want to record it anyway?';
        if (onForceRecord) {
          const forceBtn = document.createElement('button');
          forceBtn.textContent = 'Force Record';
          forceBtn.className = 'alert-btn';
          forceBtn.onclick = () => {
            forceBtn.disabled = true;
            forceBtn.textContent = 'recording';
            onForceRecord();
          };
          statusElement.appendChild(forceBtn);
        }
        return;
      }

      statusElement.textContent = `${prefix} ${errorMsg}`;
    });

    // Mock isConnectionError to properly detect connection errors
    isConnectionError.mockImplementation((error: any) => {
      return error?.message?.includes('Receiving end does not exist') || false;
    });

    // Mock isDomainBlockedError to properly detect domain blocked errors
    isDomainBlockedError.mockImplementation((error: any) => {
      return error?.message === 'DOMAIN_BLOCKED' || false;
    });

    // Mock formatSuccessMessage
    formatSuccessMessage.mockImplementation((_totalDuration: number, _aiDuration?: number) => '✓ Saved to Obsidian');

    // DOM elements
    document.body.innerHTML = `
      <div id="mainScreen">
        <img id="favicon" src="" alt="Favicon">
        <h2 id="pageTitle">Loading...</h2>
        <p id="pageUrl">Loading...</p>
        <button id="recordBtn">📝 Record Now</button>
        <div id="mainStatus"></div>
        <div id="tagResultPanel" class="hidden"></div>
        <div id="private-page-dialog">
          <div id="dialog-message"></div>
          <button id="dialog-cancel"></button>
          <button id="dialog-save-once"></button>
          <button id="dialog-save-domain"></button>
          <button id="dialog-save-path"></button>
        </div>
        <div id="pending-section" class="hidden">
          <div id="pending-empty" class="hidden"></div>
          <div id="pending-pages-list"></div>
        </div>
        <button id="btn-select-all"></button>
        <button id="btn-save-selected"></button>
        <button id="btn-save-whitelist"></button>
        <button id="btn-discard"></button>
        <div id="statusPanel">
          <div id="statusDomainIcon" class="status-icon"><svg class="status-svg"></svg></div>
          <div id="statusPrivacyIcon" class="status-icon"><svg class="status-svg"></svg></div>
          <div id="statusDomainState"></div>
          <div id="statusDomainMode"></div>
          <div id="statusPrivacyContent"></div>
          <div id="statusCacheContent"></div>
          <div id="statusLastSavedContent"></div>
          <div id="statusCleansingContent"></div>
          <div id="statusTrustContent"></div>
          <button id="statusToggleBtn" aria-expanded="false"></button>
          <div id="statusDetails" class="hidden"></div>
          <span id="statusToggleText"></span>
          <div id="permissionRequestArea" class="hidden"></div>
          <div id="permissionDeniedMessage" class="hidden"></div>
        </div>
        <div id="allUrlsPermissionBanner" class="hidden"></div>
      </div>
    `;
    // Initialize recordBtn as disabled, then loadCurrentTab will enable it for recordable pages
    const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
    if (recordBtn) {
      recordBtn.disabled = true;
    }
  });

  afterEach(() => {
    // Clean up DOM
    document.body.innerHTML = '';
  });

  describe('loadCurrentTab', () => {
    it('should load current tab information', async () => {
      const mockTab = {
        favIconUrl: 'https://example.com/favicon.ico',
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error - vi.fn() type narrowing issue
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error - vi.fn() type narrowing issue
      mockChrome.tabs.query.mockResolvedValue([mockTab]);

      await loadCurrentTab();

      const favicon = document.getElementById('favicon') as HTMLImageElement;
      const pageTitle = document.getElementById('pageTitle');
      const pageUrl = document.getElementById('pageUrl');
      const recordBtn = document.getElementById('recordBtn');

      expect(favicon.src).toBe('chrome-extension://test-extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com&size=32');
      expect(pageTitle.textContent).toBe('Example Page');
      expect(pageUrl.textContent).toBe('https://example.com');
      expect(recordBtn.disabled).toBe(false);
      expect(recordBtn.textContent).toBe('📝 Record Now');
    });

    it('should truncate long URLs to 50 chars', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(50);
      const mockTab = {
        title: 'Long URL Page',
        url: longUrl
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);

      await loadCurrentTab();

      const pageUrl = document.getElementById('pageUrl');
      expect(pageUrl.textContent).toBe(longUrl.substring(0, 50) + '...');
    });

    it('should show "noTitle" message when tab has no title', async () => {
      const mockTab = {
        title: '',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);

      await loadCurrentTab();

      const pageTitle = document.getElementById('pageTitle');
      expect(pageTitle.textContent).toBe('No title');
    });

    it('should handle non-recordable page correctly', async () => {
      const mockTab = {
        favIconUrl: '',
        title: 'Non-recordable Page',
        url: 'chrome://extensions'
      };

      // @ts-expect-error
      getCurrentTab.mockImplementation(() => Promise.resolve(mockTab));
      isRecordable.mockReturnValue(false);

      await loadCurrentTab();

      const recordBtn = document.getElementById('recordBtn');
      expect(recordBtn.disabled).toBe(true);
      expect(recordBtn.textContent).toBe('Cannot record this page');
    });

    it('should handle null tab', async () => {
      // @ts-expect-error
      getCurrentTab.mockImplementation(() => Promise.resolve(null));

      await loadCurrentTab();

      const pageTitle = document.getElementById('pageTitle');
      expect(pageTitle.textContent).toBe('Loading...');
    });

    it('should handle tab with no URL', async () => {
      const mockTab = {
        title: 'No URL Page',
        url: ''
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(false);

      await loadCurrentTab();

      const pageUrl = document.getElementById('pageUrl');
      expect(pageUrl.textContent).toBe('');
    });
  });

  describe('recordCurrentPage', () => {
    it('should handle non-recordable page', async () => {
      const mockTab = {
        url: 'chrome://extensions'
      };

      // @ts-expect-error
      getCurrentTab.mockImplementation(() => Promise.resolve(mockTab));
      isRecordable.mockReturnValue(false);

      await recordCurrentPage();

      const statusDiv = document.getElementById('mainStatus');
      expect(statusDiv.className).toBe('error');
      expect(statusDiv.textContent).toContain('✗ Error');
    });

    it('should handle null tab (no active tab found)', async () => {
      // @ts-expect-error
      getCurrentTab.mockResolvedValue(null);
      isRecordable.mockReturnValue(true);

      await recordCurrentPage();

      const statusDiv = document.getElementById('mainStatus');
      expect(statusDiv.className).toBe('error');
      expect(showError).toHaveBeenCalled();
    });

    it('should handle tab without id', async () => {
      const mockTab = {
        title: 'No ID Tab',
        url: 'https://example.com'
        // no id property
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);

      await recordCurrentPage();

      const statusDiv = document.getElementById('mainStatus');
      expect(statusDiv.className).toBe('error');
    });

    it('should handle connection error', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockImplementation(() => Promise.resolve(mockTab));
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockImplementation(() => Promise.resolve({ [StorageKeys.PII_CONFIRMATION_UI]: true }));

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // Content script sendMessage fails
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
      // Fallback executeScript also fails
      mockChrome.scripting.executeScript.mockRejectedValue(new Error('Script execution failed'));

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(statusDiv.className).toBe('error');
      expect(statusDiv.textContent).toContain('✗ Error:');
    });

    it('should handle domain blocked error with force record', async () => {
      const mockTab = {
        id: 1,
        title: 'Blocked Page',
        url: 'https://blocked.com'
      };

      // @ts-expect-error
      getCurrentTab.mockImplementation(() => Promise.resolve(mockTab));
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockImplementation(() => Promise.resolve({ [StorageKeys.PII_CONFIRMATION_UI]: true }));

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      // @ts-expect-error
      sendMessageWithRetry.mockResolvedValue({
        success: false,
        error: 'DOMAIN_BLOCKED'
      });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(statusDiv.querySelector('button')).toBeTruthy();
      expect(statusDiv.querySelector('button').textContent).toBe('Force Record');
      const expectedText = 'This domain is not allowed to be recorded. Do you want to record it anyway?';
      expect(statusDiv.childNodes[0].textContent).toBe(expectedText);
    });

    it('should successfully record page with preview', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockImplementation(() => Promise.resolve({ [StorageKeys.PII_CONFIRMATION_UI]: true }));

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });

      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });

      sendMessageWithRetry.mockImplementation(async (message) => {
        if (message.type === 'PREVIEW_RECORD') {
          return {
            success: true,
            mode: 'masked_cloud',
            maskedCount: 1,
            processedContent: '[MASKED:email]@example.com'
          };
        } else if (message.type === 'SAVE_RECORD' || message.type === 'MANUAL_RECORD') {
          return { success: true };
        }
        return { success: true };
      });

      // @ts-expect-error
      showPreview.mockResolvedValue({ confirmed: true, content: '[MASKED:email]@example.com' });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(statusDiv.className).toBe('success');
      expect(statusDiv.textContent).toContain('✓ Saved to Obsidian');
      expect(startAutoCloseTimer).toHaveBeenCalled();
    });

    it('should successfully record page without preview', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockImplementation(() => Promise.resolve({ [StorageKeys.PII_CONFIRMATION_UI]: false }));

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });

      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });

      sendMessageWithRetry.mockImplementation(async (message) => {
        return { success: true };
      });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(statusDiv.className).toBe('success');
      expect(statusDiv.textContent).toContain('✓ Saved to Obsidian');
      expect(startAutoCloseTimer).toHaveBeenCalled();
    });

    it('should handle preview cancellation', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: true });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      // @ts-expect-error
      sendMessageWithRetry.mockResolvedValue({
        success: true,
        mode: 'masked_cloud',
        maskedCount: 1,
        processedContent: '[MASKED:email]@example.com'
      });

      // @ts-expect-error
      showPreview.mockResolvedValue({ confirmed: false, content: null });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(statusDiv.textContent).toBe('Cancelled');
    });

    it('should show specific error message when PREVIEW_RECORD fails', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: true });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      // @ts-expect-error
      sendMessageWithRetry.mockResolvedValue({
        success: false,
        error: 'AI_PROVIDER_ERROR: Rate limit exceeded'
      });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(statusDiv.className).toBe('error');
      expect(statusDiv.textContent).toBe('✗ Error: AI_PROVIDER_ERROR: Rate limit exceeded');
    });

    it('should change button to "Record Anyway" when PRIVATE_PAGE_DETECTED error', async () => {
      const mockTab = {
        id: 1,
        title: 'Private Page',
        url: 'https://private.example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: true });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      // @ts-expect-error
      sendMessageWithRetry.mockResolvedValue({
        success: false,
        error: 'PRIVATE_PAGE_DETECTED',
        reason: 'cache-control',
        headerValue: 'Cache-Control: private'
      });

      const statusDiv = document.getElementById('mainStatus');
      const recordBtn = document.getElementById('recordBtn');

      await recordCurrentPage();

      expect(statusDiv.className).toBe('error');
      expect(statusDiv.textContent).toContain('PRIVATE_PAGE_DETECTED');

      expect(recordBtn.disabled).toBe(false);
      expect(recordBtn.textContent).toBe('Record Anyway');
    });

    it('should handle PRIVATE_PAGE_DETECTED in save phase (usePreview=false)', async () => {
      const mockTab = {
        id: 1,
        title: 'Private Page',
        url: 'https://private.example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      // @ts-expect-error
      sendMessageWithRetry.mockResolvedValue({
        success: false,
        error: 'PRIVATE_PAGE_DETECTED',
        reason: 'set-cookie',
        headerValue: 'Set-Cookie: session=abc'
      });

      const statusDiv = document.getElementById('mainStatus');
      const recordBtn = document.getElementById('recordBtn');

      await recordCurrentPage();

      expect(statusDiv.className).toBe('error');
      expect(statusDiv.textContent).toContain('PRIVATE_PAGE_DETECTED');
      expect(recordBtn.disabled).toBe(false);
      expect(recordBtn.textContent).toBe('Record Anyway');
    });

    it('should handle preview with no masked items (direct save)', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: true });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });

      sendMessageWithRetry.mockImplementation(async (message) => {
        if (message.type === 'PREVIEW_RECORD') {
          return {
            success: true,
            maskedCount: 0,
            processedContent: 'Clean content'
          };
        }
        return { success: true };
      });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(statusDiv.className).toBe('success');
      expect(showPreview).not.toHaveBeenCalled();
      expect(sendMessageWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SAVE_RECORD' })
      );
    });

    it('should handle null PREVIEW_RECORD response', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: true });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });

      sendMessageWithRetry.mockImplementation(async (message) => {
        if (message.type === 'PREVIEW_RECORD') {
          return null;
        }
        return { success: true };
      });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(statusDiv.className).toBe('error');
      expect(showError).toHaveBeenCalled();
    });

    it('should handle content script fallback via executeScript', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // Content script sendMessage fails
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
      // executeScript succeeds
      mockChrome.scripting.executeScript.mockResolvedValue([{ result: 'fallback content' }]);
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });

      sendMessageWithRetry.mockResolvedValue({ success: true });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(mockChrome.scripting.executeScript).toHaveBeenCalled();
      expect(statusDiv.className).toBe('success');
    });

    it('should handle content script failure with force=true fallback to empty content', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // Content script sendMessage fails
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
      // executeScript also fails
      mockChrome.scripting.executeScript.mockRejectedValue(new Error('Script execution failed'));
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });

      sendMessageWithRetry.mockResolvedValue({ success: true });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage(true);

      expect(mockChrome.scripting.executeScript).toHaveBeenCalled();
      expect(statusDiv.className).toBe('success');
    });

    it('should handle content script failure without force', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // Content script sendMessage fails
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
      // executeScript also fails
      mockChrome.scripting.executeScript.mockRejectedValue(new Error('Script execution failed'));

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(showError).toHaveBeenCalled();
    });

    it('should handle contentResponse null with force=true', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // Content script returns undefined/null
      mockChrome.tabs.sendMessage.mockResolvedValue(null);
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });

      sendMessageWithRetry.mockResolvedValue({ success: true });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage(true);

      expect(statusDiv.className).toBe('success');
    });

    it('should handle contentResponse null without force', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // Content script returns null
      mockChrome.tabs.sendMessage.mockResolvedValue(null);

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(showError).toHaveBeenCalled();
    });

    it('should handle save failure (result.success=false)', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      // @ts-expect-error
      sendMessageWithRetry.mockResolvedValue({
        success: false,
        error: 'Some save error'
      });

      const statusDiv = document.getElementById('mainStatus');

      await recordCurrentPage();

      expect(statusDiv.className).toBe('error');
      expect(showError).toHaveBeenCalled();
    });

    it('should handle force=true passed to sendMessageWithRetry', async () => {
      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });

      sendMessageWithRetry.mockResolvedValue({ success: true });

      await recordCurrentPage(true);

      expect(sendMessageWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MANUAL_RECORD',
          payload: expect.objectContaining({ force: true })
        })
      );
    });

    it('should clear tagResultPanel at start', async () => {
      const tagPanel = document.getElementById('tagResultPanel');
      tagPanel.textContent = 'some tags';
      tagPanel.classList.remove('hidden');

      const mockTab = {
        id: 1,
        title: 'Example Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
      sendMessageWithRetry.mockResolvedValue({ success: true });

      await recordCurrentPage();

      expect(tagPanel.textContent).toBe('');
      expect(tagPanel.classList.contains('hidden')).toBe(true);
    });
  });

  describe('initStatusPanel', () => {
    it('should render status panel with allowed domain', async () => {
      const mockTab = {
        id: 1,
        title: 'Status Page',
        url: 'https://allowed.com'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist', matchedPattern: '' },
        privacy: { isPrivate: false, hasCache: true, reason: null },
        cache: { hasCache: true, cacheControl: 'no-cache', hasCookie: false, hasAuth: false },
        lastSaved: { exists: false, timeAgo: '', formatted: '' }
      });

      // Trigger DOMContentLoaded
      document.dispatchEvent(new Event('DOMContentLoaded'));

      // Wait for async operations
      await new Promise(r => setTimeout(r, 50));

      const domainState = document.getElementById('statusDomainState');
      expect(domainState.innerHTML).toContain('status-success');
    });

    it('should render status panel with blocked domain', async () => {
      const mockTab = {
        id: 1,
        title: 'Blocked Page',
        url: 'https://blocked.com'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: false, blocked: true, mode: 'blacklist', matchedPattern: 'blocked.com' },
        privacy: { isPrivate: false, hasCache: false, reason: null },
        cache: { hasCache: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const domainState = document.getElementById('statusDomainState');
      expect(domainState.innerHTML).toContain('status-error');
    });

    it('should render private page status', async () => {
      const mockTab = {
        id: 1,
        title: 'Private Page',
        url: 'https://private.com'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: true, hasCache: true, reason: 'cache-control' },
        cache: { hasCache: true, cacheControl: 'private', hasCookie: false, hasAuth: false },
        lastSaved: { exists: true, timeAgo: '5 minutes ago', formatted: '2026-03-31' }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const privacyContent = document.getElementById('statusPrivacyContent');
      expect(privacyContent.innerHTML).toContain('status-warning');
    });

    it('should render last saved content when exists', async () => {
      const mockTab = {
        id: 1,
        title: 'Saved Page',
        url: 'https://saved.com'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: false, hasCache: true, reason: null },
        cache: { hasCache: true, cacheControl: 'public', hasCookie: false, hasAuth: false },
        lastSaved: { exists: true, timeAgo: '10 minutes ago', formatted: '2026-03-31 12:00' }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const lastSavedContent = document.getElementById('statusLastSavedContent');
      expect(lastSavedContent.innerHTML).toContain('10 minutes ago');
    });

    it('should handle null status (special URL)', async () => {
      const mockTab = {
        id: 1,
        title: 'Chrome Page',
        url: 'chrome://extensions'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue(null);

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const panel = document.getElementById('statusPanel');
      expect(panel.innerHTML).toContain('statusPageNotRecordable');
    });

    it('should handle tab without URL', async () => {
      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([{ id: 1, title: 'No URL' }]);

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const panel = document.getElementById('statusPanel');
      expect(panel.style.display).toBe('none');
    });

    it('should render cache section with cookie and auth', async () => {
      const mockTab = {
        id: 1,
        title: 'Cached Page',
        url: 'https://cached.com'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: false, hasCache: true, reason: null },
        cache: { hasCache: true, cacheControl: 'no-store', hasCookie: true, hasAuth: true },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const cacheContent = document.getElementById('statusCacheContent');
      expect(cacheContent.innerHTML).toContain('statusSetCookiePresent');
      expect(cacheContent.innerHTML).toContain('statusAuthorizationPresent');
    });

    it('should render cache section with no cache info', async () => {
      const mockTab = {
        id: 1,
        title: 'No Cache Page',
        url: 'https://nocache.com'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: false, hasCache: false, reason: null },
        cache: { hasCache: true, cacheControl: '', hasCookie: false, hasAuth: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const cacheContent = document.getElementById('statusCacheContent');
      expect(cacheContent.innerHTML).toContain('statusNoCacheInfo');
    });
  });

  // Pending pages UI moved to dashboard - these tests verify pendingPages.ts module works correctly
  describe.skip('loadPendingPages', () => {
    // Pending pages feature is now in dashboard, not popup
    // Tests skipped because popup-ui elements were removed
    it.skip('pending pages moved to dashboard', () => {
      expect(true).toBe(true);
    });
  });

  describe('recordCurrentPage with cleansing info', () => {
    it('should update cleansing status with stats', async () => {
      const mockTab = {
        id: 1,
        title: 'Cleansed Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({
        content: 'Page content',
        cleansedReason: 'both',
        cleanseStats: {
          hardStripRemoved: 5,
          keywordStripRemoved: 3,
          totalRemoved: 8
        }
      });
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
      sendMessageWithRetry.mockResolvedValue({ success: true });

      await recordCurrentPage();

      const cleansingContent = document.getElementById('statusCleansingContent');
      expect(cleansingContent.innerHTML).toContain('statusCleansingHard');
      expect(cleansingContent.innerHTML).toContain('statusCleansingKeyword');
      expect(cleansingContent.innerHTML).toContain('statusCleansingTotal');
    });

    it('should show no cleansing when nothing removed', async () => {
      const mockTab = {
        id: 1,
        title: 'Clean Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({
        content: 'Page content',
        cleansedReason: 'none',
        cleanseStats: {
          hardStripRemoved: 0,
          keywordStripRemoved: 0,
          totalRemoved: 0
        }
      });
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
      sendMessageWithRetry.mockResolvedValue({ success: true });

      await recordCurrentPage();

      const cleansingContent = document.getElementById('statusCleansingContent');
      expect(cleansingContent.innerHTML).toContain('statusCleansingNone');
    });
  });

  describe('recordCurrentPage with permission fallback', () => {
    it('should request all_urls permission when content script fails', async () => {
      const mockTab = {
        id: 1,
        title: 'Permission Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // Content script fails
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
      // Permission initially not granted
      mockChrome.permissions.contains.mockResolvedValue(false);
      mockChrome.permissions.request.mockResolvedValue(true);
      // executeScript succeeds after permission
      mockChrome.scripting.executeScript.mockResolvedValue([{ result: 'fallback content' }]);
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
      sendMessageWithRetry.mockResolvedValue({ success: true });

      await recordCurrentPage();

      expect(mockChrome.permissions.request).toHaveBeenCalled();
      expect(mockChrome.scripting.executeScript).toHaveBeenCalled();
    });

    it('should fail when permission request is denied', async () => {
      const mockTab = {
        id: 1,
        title: 'Denied Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
      mockChrome.permissions.contains.mockResolvedValue(false);
      mockChrome.permissions.request.mockResolvedValue(false);

      await recordCurrentPage();

      expect(showError).toHaveBeenCalled();
    });

    it('should handle permission check exception', async () => {
      const mockTab = {
        id: 1,
        title: 'Exception Page',
        url: 'https://example.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
      mockChrome.permissions.contains.mockRejectedValue(new Error('Permission API error'));

      await recordCurrentPage();

      expect(showError).toHaveBeenCalled();
    });
  });

  describe('recordCurrentPage with tag result', () => {
    it('should show tag result after successful save', async () => {
      const mockTab = {
        id: 1,
        title: 'Tagged Page',
        url: 'https://tagged.com'
      };

      // @ts-expect-error
      getCurrentTab.mockResolvedValue(mockTab);
      isRecordable.mockReturnValue(true);
      // @ts-expect-error
      getSettings.mockResolvedValue({ [StorageKeys.PII_CONFIRMATION_UI]: false });

      // @ts-expect-error
      mockChrome.tabs.sendMessage.mockResolvedValue({ content: 'Page content' });
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
      sendMessageWithRetry.mockResolvedValue({ success: true, aiDuration: 500 });
      // @ts-expect-error
      getSavedUrlEntries.mockResolvedValue([
        { url: 'https://tagged.com', tags: ['tech', 'javascript'] }
      ]);

      await recordCurrentPage();

      const tagPanel = document.getElementById('tagResultPanel');
      expect(tagPanel.textContent).toContain('#tech');
      expect(tagPanel.textContent).toContain('#javascript');
      expect(tagPanel.classList.contains('hidden')).toBe(false);
    });
  });

  describe('renderStatusPanel with domain filter modes', () => {
    it('should render filter mode for blacklist mode', async () => {
      const mockTab = {
        id: 1,
        title: 'Blacklist Page',
        url: 'https://blacklist.com'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: false, blocked: true, mode: 'blacklist', matchedPattern: '*blacklist*' },
        privacy: { isPrivate: false, hasCache: false },
        cache: { hasCache: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const domainMode = document.getElementById('statusDomainMode');
      expect(domainMode.innerHTML).toContain('statusFilterModeBlacklist');
    });

    it('should render private page with set-cookie reason', async () => {
      const mockTab = {
        id: 1,
        title: 'Cookie Page',
        url: 'https://cookie.com'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: true, hasCache: true, reason: 'set-cookie' },
        cache: { hasCache: true, hasCookie: true, hasAuth: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const privacyContent = document.getElementById('statusPrivacyContent');
      expect(privacyContent.innerHTML).toContain('statusSetCookieDetected');
    });

    it('should render private page with authorization reason', async () => {
      const mockTab = {
        id: 1,
        title: 'Auth Page',
        url: 'https://auth.com'
      };

      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: true, hasCache: true, reason: 'authorization' },
        cache: { hasCache: true, hasCookie: false, hasAuth: true },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const privacyContent = document.getElementById('statusPrivacyContent');
      expect(privacyContent.innerHTML).toContain('statusAuthDetected');
    });
  });

  describe('status icons', () => {
    it('should render success icon for allowed domain', async () => {
      const mockTab = { id: 1, title: 'OK', url: 'https://ok.com' };
      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: false, hasCache: true },
        cache: { hasCache: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const domainIcon = document.getElementById('statusDomainIcon');
      expect(domainIcon.className).toContain('status-success');
    });

    it('should render warning icon for private page', async () => {
      const mockTab = { id: 1, title: 'Private', url: 'https://private.com' };
      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: true, hasCache: true },
        cache: { hasCache: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const privacyIcon = document.getElementById('statusPrivacyIcon');
      expect(privacyIcon.className).toContain('status-warning');
    });

    it('should render muted icon when no privacy info', async () => {
      const mockTab = { id: 1, title: 'Unknown', url: 'https://unknown.com' };
      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: false, hasCache: false },
        cache: { hasCache: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const privacyIcon = document.getElementById('statusPrivacyIcon');
      expect(privacyIcon.className).toContain('status-muted');
    });
  });

  describe('status toggle button', () => {
    it('should toggle details panel visibility', async () => {
      const mockTab = { id: 1, title: 'Toggle', url: 'https://toggle.com' };
      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: false, hasCache: false },
        cache: { hasCache: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const toggleBtn = document.getElementById('statusToggleBtn');
      const detailsPanel = document.getElementById('statusDetails');

      toggleBtn.click();

      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(detailsPanel.classList.contains('hidden')).toBe(false);
    });
  });

  // =========================================================================
  // getCleansedReasonText
  // =========================================================================
  describe('getCleansedReasonText', () => {
    it('should return empty string for none', () => {
      expect(getCleansedReasonText('none')).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(getCleansedReasonText(undefined)).toBe('');
    });

    it('should return Hard text for hard', () => {
      expect(getCleansedReasonText('hard')).toContain('Hard');
    });

    it('should return Keyword text for keyword', () => {
      expect(getCleansedReasonText('keyword')).toContain('Keyword');
    });

    it('should return Both text for both', () => {
      expect(getCleansedReasonText('both')).toContain('Both');
    });
  });

  // =========================================================================
  // loadPendingPages
  // =========================================================================
  describe('loadPendingPages', () => {
    it('should hide section when no pending pages', async () => {
      // @ts-expect-error
      getPendingPages.mockResolvedValueOnce([]);

      await loadPendingPages();

      const section = document.getElementById('pending-section');
      const empty = document.getElementById('pending-empty');
      expect(section.classList.contains('hidden')).toBe(true);
      expect(empty.classList.contains('hidden')).toBe(false);
    });

    it('should render pending pages', async () => {
      // @ts-expect-error
      getPendingPages.mockResolvedValueOnce([
        { url: 'https://example.com', title: 'Example', reason: 'private' },
        { url: 'https://test.com', title: 'Test', reason: 'auth', headerValue: 'Authorization' },
      ]);

      await loadPendingPages();

      const section = document.getElementById('pending-section');
      const list = document.getElementById('pending-pages-list');
      expect(section.classList.contains('hidden')).toBe(false);
      expect(list.children.length).toBe(2);
      expect(list.querySelector('.pending-item-title').textContent).toBe('Example');
    });

    it('should create clickable title that opens new tab', async () => {
      // @ts-expect-error
      getPendingPages.mockResolvedValueOnce([
        { url: 'https://click.com', title: 'Click Me', reason: 'private' },
      ]);

      await loadPendingPages();

      const titleEl = document.querySelector('.pending-item-title') as HTMLElement;
      titleEl.click();

      expect(mockChrome.tabs.create).toHaveBeenCalledWith({ url: 'https://click.com' });
    });

    it('should handle getPendingPages error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // @ts-expect-error
      getPendingPages.mockRejectedValueOnce(new Error('Storage error'));

      await expect(loadPendingPages()).resolves.not.toThrow();

      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // saveSelectedPages
  // =========================================================================
  describe('saveSelectedPages', () => {
    it('should do nothing when no checkboxes checked', async () => {
      document.querySelectorAll('.pending-checkbox').forEach(cb => cb.remove());

      await saveSelectedPages();

      expect(mockChrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('should save selected pages and reload', async () => {
      const list = document.getElementById('pending-pages-list')!;
      list.innerHTML = `
        <input type="checkbox" class="pending-checkbox" value="https://a.com" checked>
        <input type="checkbox" class="pending-checkbox" value="https://b.com">
      `;

      // @ts-expect-error
      getPendingPages.mockResolvedValue([
        { url: 'https://a.com', title: 'A', content: 'content a' },
      ]);

      await saveSelectedPages();

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'record',
          data: expect.objectContaining({ url: 'https://a.com', force: true })
        })
      );
      expect(removePendingPages).toHaveBeenCalledWith(['https://a.com']);
    });

    it('should add domains to whitelist when type is domain', async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({ domainWhitelist: [] });

      const list = document.getElementById('pending-pages-list')!;
      list.innerHTML = `<input type="checkbox" class="pending-checkbox" value="https://example.com/page" checked>`;

      // @ts-expect-error
      getPendingPages.mockResolvedValue([
        { url: 'https://example.com/page', title: 'Page', content: '' },
      ]);

      await saveSelectedPages('domain');

      expect(mockChrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ domainWhitelist: expect.arrayContaining(['example.com']) })
      );
    });
  });

  // =========================================================================
  // renderSpecialUrlStatus
  // =========================================================================
  describe('renderSpecialUrlStatus', () => {
    it('should render error message in panel', () => {
      renderSpecialUrlStatus();

      const panel = document.getElementById('statusPanel');
      expect(panel.innerHTML).toContain('status-error');
    });
  });

  // =========================================================================
  // Private page dialog DOM elements
  // =========================================================================
  describe('private page dialog DOM', () => {
    it('should have all dialog button elements', () => {
      const cancelBtn = document.getElementById('dialog-cancel');
      const saveOnceBtn = document.getElementById('dialog-save-once');
      const saveDomainBtn = document.getElementById('dialog-save-domain');
      const savePathBtn = document.getElementById('dialog-save-path');

      expect(cancelBtn).toBeTruthy();
      expect(saveOnceBtn).toBeTruthy();
      expect(saveDomainBtn).toBeTruthy();
      expect(savePathBtn).toBeTruthy();
    });

    it('should have dialog-message element', () => {
      const msgEl = document.getElementById('dialog-message');
      expect(msgEl).toBeTruthy();
    });
  });

  // =========================================================================
  // Cleansing status display
  // =========================================================================
  describe('cleansing status display', () => {
    it('should show no-info when no cleanse stats', async () => {
      const mockTab = { id: 1, title: 'Clean', url: 'https://clean.com' };
      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: false, hasCache: false },
        cache: { hasCache: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const cleansingContent = document.getElementById('statusCleansingContent');
      expect(cleansingContent.innerHTML).toContain('status-muted');
    });
  });

  // =========================================================================
  // Permission banner
  // =========================================================================
  describe('permission banner', () => {
    it('should hide banner when all URLs permitted', async () => {
      const mockTab = { id: 1, title: 'Test', url: 'https://test.com' };
      // @ts-expect-error
      mockChrome.tabs.query.mockResolvedValue([mockTab]);
      // @ts-expect-error
      checkPageStatus.mockResolvedValue({
        domainFilter: { allowed: true, blocked: false, mode: 'whitelist' },
        privacy: { isPrivate: false, hasCache: false },
        cache: { hasCache: false },
        lastSaved: { exists: false }
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(r => setTimeout(r, 50));

      const banner = document.getElementById('allUrlsPermissionBanner');
      expect(banner.classList.contains('hidden')).toBe(true);
    });
  });
});
