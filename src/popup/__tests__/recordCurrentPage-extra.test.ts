// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../tabUtils.js', () => ({
  getCurrentTab: vi.fn(),
  isRecordable: vi.fn().mockReturnValue(true),
}));

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  StorageKeys: {
    PII_CONFIRMATION_UI: 'pii_confirmation_ui',
    DOMAIN_WHITELIST: 'domain_whitelist',
  },
}));

vi.mock('../statusChecker.js', () => ({
  checkPageStatus: vi.fn().mockResolvedValue(null),
  formatTimeAgo: vi.fn().mockReturnValue(''),
}));

vi.mock('../spinner.js', () => ({
  showSpinner: vi.fn(),
  hideSpinner: vi.fn(),
}));

vi.mock('../errorUtils.js', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  formatSuccessMessage: vi.fn().mockReturnValue('Success'),
}));

vi.mock('../sanitizePreview.js', () => ({
  showPreview: vi.fn(),
  initializeModalEvents: vi.fn(),
}));

vi.mock('../autoClose.js', () => ({
  startAutoCloseTimer: vi.fn(),
}));

vi.mock('../../utils/retryHelper.js', () => ({
  sendMessageWithRetry: vi.fn(),
}));

vi.mock('../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../statusPanel.js', () => ({
  updateCleansingStatus: vi.fn(),
  updateTrustStatus: vi.fn(),
  initStatusPanel: vi.fn(),
}));

vi.mock('../privatePageDialog.js', () => ({
  setCurrentPendingSave: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn(),
  ErrorCode: {
    CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE',
  },
}));

import {
  handleRecordNowClick,
  loadCurrentTab,
  recordCurrentPage,
} from '../recordCurrentPage.js';
import { getCurrentTab, isRecordable } from '../tabUtils.js';
import { getSettings } from '../../utils/storage.js';
import { sendMessageWithRetry } from '../../utils/retryHelper.js';
import { showError } from '../errorUtils.js';
import { showSpinner } from '../spinner.js';
import { checkPageStatus } from '../statusChecker.js';
import { showPreview } from '../sanitizePreview.js';
import { startAutoCloseTimer } from '../autoClose.js';

vi.spyOn(chrome.runtime, 'getURL').mockImplementation((path: string) =>
  `chrome-extension://test-extension-id${path}`
);

function setupDom(): void {
  document.body.innerHTML = [
    '<div id="mainStatus"></div>',
    '<button id="recordBtn"></button>',
    '<div id="tagResultPanel"></div>',
    '<img id="favicon" src="">',
    '<div id="pageTitle"></div>',
    '<div id="pageUrl"></div>',
  ].join('\n');
}

beforeEach(() => {
  setupDom();
  vi.clearAllMocks();
  chrome.runtime.lastError = null;
  chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ content: 'test content' });
  chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
  chrome.scripting.executeScript = vi.fn().mockResolvedValue([{ result: 'fallback content' }]);
  chrome.permissions.contains = vi.fn().mockResolvedValue(true);
  chrome.permissions.request = vi.fn().mockResolvedValue(true);
  chrome.tabs.query = vi.fn().mockResolvedValue([{ url: 'https://example.com', id: 1 }]);
  (checkPageStatus as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
    success: true,
    aiDuration: 100,
  });
});

// ──────────────────────────────────────────────
// handleRecordNowClick
// ──────────────────────────────────────────────
describe('handleRecordNowClick', () => {
  it('returns early when recordBtn element is missing', async () => {
    document.getElementById('recordBtn')!.remove();
    await expect(handleRecordNowClick()).resolves.not.toThrow();
  });

  it('forwards force=true with tab and content when provided', async () => {
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      aiDuration: 100,
    });
    await handleRecordNowClick(true, { url: 'https://example.com', id: 1, title: 'Test' } as chrome.tabs.Tab, 'content');
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('recordNowDone');
  });

  it('calls recordCurrentPage when no tab/content provided', async () => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Test' });
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      aiDuration: 100,
    });
    await handleRecordNowClick(true);
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('recordNowDone');
  });
});

// ──────────────────────────────────────────────
// recordCurrentPage — error branches
// ──────────────────────────────────────────────
describe('recordCurrentPage — error paths', () => {
  it('throws when getCurrentTab returns null', async () => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await recordCurrentPage();
    expect(showError).toHaveBeenCalled();
  });

  it('throws when tab has no id', async () => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: 'https://example.com' });
    await recordCurrentPage();
    expect(showError).toHaveBeenCalled();
  });

  it('shows error on content script timeout', async () => {
    vi.useFakeTimers();
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Test' });
    chrome.tabs.sendMessage = vi.fn(() => new Promise(() => {}));
    chrome.scripting.executeScript = vi.fn().mockRejectedValue(new Error('Script failed'));
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Test' });
    const promise = recordCurrentPage();
    await vi.advanceTimersByTimeAsync(5001);
    await promise.catch(() => {});
    expect(showError).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('re-throws when chrome.runtime.lastError is set after sendMessage', async () => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Test' });
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ content: 'test' });
    chrome.runtime.lastError = { message: 'Connection error' };
    await recordCurrentPage();
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  it('falls back to scripting when sendMessage fails and permissions granted', async () => {
    vi.useFakeTimers();
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Test' });
    chrome.tabs.sendMessage = vi.fn(() => new Promise(() => {}));
    chrome.runtime.lastError = null;
    chrome.permissions.contains = vi.fn().mockResolvedValue(true);
    chrome.scripting.executeScript = vi.fn().mockRejectedValue(new Error('Script failed'));
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Test' });
    (checkPageStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ domainFilter: { allowed: true } });
    const promise = recordCurrentPage(true);
    await vi.advanceTimersByTimeAsync(5001);
    await promise.catch(() => {});
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows error when sendMessage fails and permissions request denied', async () => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Test' });
    chrome.tabs.sendMessage = vi.fn().mockRejectedValue(new Error('No response'));
    chrome.runtime.lastError = null;
    chrome.permissions.contains = vi.fn().mockResolvedValue(false);
    chrome.permissions.request = vi.fn().mockResolvedValue(false);
    chrome.scripting.executeScript = vi.fn().mockRejectedValue(new Error('Script fail'));
    await recordCurrentPage(false);
    expect(showError).toHaveBeenCalled();
  });

  it('handles PRIVATE_PAGE_DETECTED error', async () => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Test' });
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: 'PRIVATE_PAGE_DETECTED',
      reason: 'cache-control',
      processedContent: 'content',
      maskedCount: 0,
      maskedItems: [],
    });
    await recordCurrentPage();
    const statusDiv = document.getElementById('mainStatus')!;
    expect(statusDiv.textContent).toContain('PRIVATE_PAGE_DETECTED');
    expect(statusDiv.className).toContain('error');
  });

  it('handles CANCELLED from preview', async () => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Test' });
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      processedContent: 'masked content',
      maskedCount: 1,
      maskedItems: ['email'],
      aiDuration: 50,
    });
    (showPreview as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ confirmed: false });
    await recordCurrentPage();
    const statusDiv = document.getElementById('mainStatus')!;
    expect(statusDiv.textContent).toBe('cancelled');
  });

  it('throws on save failure', async () => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Test' });
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: 'Save failed',
      processedContent: 'content',
      maskedCount: 0,
      maskedItems: [],
    });
    await recordCurrentPage();
    expect(showError).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// recordCurrentPage — success flows (copy button)
// ──────────────────────────────────────────────
describe('recordCurrentPage — copy button and auto-close', () => {
  beforeEach(() => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Test' });
  });

  it('starts auto-close timer when tagResultPanel is missing', async () => {
    document.getElementById('tagResultPanel')!.remove();
    await recordCurrentPage();
    expect(startAutoCloseTimer).toHaveBeenCalled();
  });

  it('shows done state on success', async () => {
    await recordCurrentPage();
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('recordNowDone');
  });

  it('shows error state on failure', async () => {
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Fail'));
    await recordCurrentPage();
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('recordNowError');
  });
});

// ──────────────────────────────────────────────
// recordCurrentPage — non-http(s) URL guard
// ──────────────────────────────────────────────
describe('recordCurrentPage — non-http(s) guard', () => {
  it('throws when tab is not recordable', async () => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, url: 'chrome://settings', title: 'Settings' });
    (isRecordable as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    await recordCurrentPage();
    expect(showError).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// recordCurrentPage — preview with PII confirmation
// ──────────────────────────────────────────────
describe('recordCurrentPage — preview flow', () => {
  beforeEach(() => {
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Test' });
  });

  it('bypasses preview when PII_CONFIRMATION_UI is false', async () => {
    (getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      pii_confirmation_ui: false,
    });
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockReset();
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      aiDuration: 100,
    });
    await recordCurrentPage();
    expect(sendMessageWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MANUAL_RECORD' })
    );
  });

  it('shows preview when maskedCount > 0 and processes confirmation', async () => {
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockReset();
    (sendMessageWithRetry as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        success: true,
        processedContent: 'masked content',
        maskedCount: 2,
        maskedItems: ['email', 'phone'],
        aiDuration: 50,
      })
      .mockResolvedValueOnce({
        success: true,
        aiDuration: 100,
      });
    (showPreview as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      confirmed: true,
      content: 'confirmed content',
    });
    await recordCurrentPage();
    expect(showPreview).toHaveBeenCalled();
    expect(sendMessageWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SAVE_RECORD' })
    );
  });

  it('cancels when preview is cancelled', async () => {
    (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockReset();
    (sendMessageWithRetry as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        success: true,
        processedContent: 'masked content',
        maskedCount: 1,
        maskedItems: ['email'],
        aiDuration: 50,
      });
    (showPreview as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      confirmed: false,
    });
    await recordCurrentPage();
    const statusDiv = document.getElementById('mainStatus')!;
    expect(statusDiv.textContent).toBe('cancelled');
  });
});

// ──────────────────────────────────────────────
// loadCurrentTab — edge cases
// ──────────────────────────────────────────────
describe('loadCurrentTab — edge cases', () => {
  beforeEach(() => {
    document.body.innerHTML = [
      '<img id="favicon" src="">',
      '<div id="pageTitle"></div>',
      '<div id="pageUrl"></div>',
      '<button id="recordBtn"></button>',
    ].join('\n');
  });

  it('handles missing favicon element', async () => {
    document.getElementById('favicon')!.remove();
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: 'https://example.com', title: 'Test', id: 1 });
    await expect(loadCurrentTab()).resolves.not.toThrow();
  });

  it('handles missing pageTitle element', async () => {
    document.getElementById('pageTitle')!.remove();
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: 'https://example.com', title: 'Test', id: 1 });
    await expect(loadCurrentTab()).resolves.not.toThrow();
  });

  it('handles missing recordBtn element', async () => {
    document.getElementById('recordBtn')!.remove();
    (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: 'https://example.com', title: 'Test', id: 1 });
    await expect(loadCurrentTab()).resolves.not.toThrow();
  });
});
