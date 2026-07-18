import { checkPageStatus } from './statusChecker.js';
import { getSettings, StorageKeys } from '../utils/storage.js';
import { showPreview } from './sanitizePreview.js';
import { showSpinner, hideSpinner } from './spinner.js';
import { startAutoCloseTimer } from './autoClose.js';
import { getCurrentTab, isRecordable } from './tabUtils.js';
import { showError, formatSuccessMessage } from './errorUtils.js';
import { getMessage } from '../utils/i18n.js';
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';
import { sendMessageWithRetry } from '../utils/retryHelper.js';
import { getSavedUrlEntries } from '../utils/storageUrls.js';
import { logError, ErrorCode } from '../utils/logger.js';
import type { ContentResponse, PreviewResponse } from './mainTypes.js';
import { copyTextToClipboard } from '../utils/clipboard.js';
import { formatEntryToMarkdown } from '../utils/markdownFormatter.js';
import type { BrowsingLogEntry } from '../utils/sqlite-types.js';
import { updateCleansingStatus, updateTrustStatus, initStatusPanel as _initStatusPanel } from './statusPanel.js';

let _recordCurrentPageFn: ((force: boolean) => Promise<void>) | null = null;

export function setRecordCurrentPageFn(fn: (force: boolean) => Promise<void>): void {
  _recordCurrentPageFn = fn;
}

// 「それでも記録」ボタン表示中フラグ（recordCurrentPage の finally でのリセットを防ぐ）
let isAwaitingForceConfirm = false;
// 記録結果状態（成功/失敗）を表示中のフラグ
let isShowingResultState = false;

export async function loadCurrentTab(): Promise<void> {
  const tab = await getCurrentTab();
  if (!tab) return;

  const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
  if (tab.url) {
    faviconUrl.searchParams.set('pageUrl', tab.url);
  }
  faviconUrl.searchParams.set('size', '32');
  const faviconEl = document.getElementById('favicon') as HTMLImageElement;
  if (faviconEl) {
    faviconEl.src = faviconUrl.toString();
  }

  const pageTitleEl = document.getElementById('pageTitle');
  if (pageTitleEl) {
    pageTitleEl.textContent = tab.title || getMessage('noTitle');
  }
  const url = tab.url || '';
  const pageUrlEl = document.getElementById('pageUrl');
  if (pageUrlEl) {
    pageUrlEl.textContent = url.length > 50 ? url.substring(0, 50) + '...' : url;
  }

  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
  if (recordBtn) {
    if (!isRecordable(tab)) {
      recordBtn.disabled = true;
      recordBtn.textContent = getMessage('cannotRecordPage');
    } else {
      recordBtn.disabled = false;
      recordBtn.textContent = getMessage('recordNow') || '📝 Record Now';
    }
  }
}

async function resetRecordButton(recordBtn: HTMLButtonElement): Promise<void> {
  recordBtn.disabled = false;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url;
  const status = url ? await checkPageStatus(url) : null;
  if (status && !status.domainFilter.allowed) {
    recordBtn.textContent = getMessage('forceRecordAnyway') || 'Record Anyway';
    recordBtn.onclick = () => handleRecordNowClick(true);
  } else {
    recordBtn.textContent = getMessage('recordNow');
    recordBtn.onclick = () => handleRecordNowClick(false);
  }
}

function setRecordAnywayButton(
  recordBtn: HTMLButtonElement,
  tab: chrome.tabs.Tab,
  content: string
): void {
  isAwaitingForceConfirm = true;
  recordBtn.disabled = false;
  recordBtn.textContent = getMessage('forceRecordAnyway') || 'Record Anyway';
  recordBtn.onclick = () => {
    isAwaitingForceConfirm = false;
    return handleRecordNowClick(true, tab, content);
  };
}

export async function handleRecordNowClick(
  force: boolean = false,
  tab?: chrome.tabs.Tab,
  content?: string
): Promise<void> {
  const button = document.getElementById('recordBtn') as HTMLButtonElement | null;
  if (!button) return;

  button.disabled = true;
  button.textContent = getMessage('recordNowProgress') || 'Recording...';

  if (force && tab && content !== undefined) {
    await forceRecord(button, tab, content);
  } else {
    await recordCurrentPage(force);
  }
}

function showButtonResultState(recordBtn: HTMLButtonElement, state: 'done' | 'error'): void {
  isAwaitingForceConfirm = false;
  isShowingResultState = true;
  recordBtn.disabled = true;
  recordBtn.textContent = getMessage(state === 'done' ? 'recordNowDone' : 'recordNowError')
    || (state === 'done' ? 'Saved!' : 'Failed');
  setTimeout(() => {
    isShowingResultState = false;
    const btn = document.getElementById('recordBtn') as HTMLButtonElement | null;
    if (btn) void resetRecordButton(btn);
  }, 2000);
}

function _resetRecordButtonAndClearFlag(btn: HTMLButtonElement): void {
  isAwaitingForceConfirm = false;
  void resetRecordButton(btn);
}

async function forceRecord(
  recordBtn: HTMLButtonElement,
  tab: chrome.tabs.Tab,
  content: string
): Promise<void> {
  const startTime = performance.now();
  const statusDiv = document.getElementById('mainStatus');
  if (!statusDiv) return;

  recordBtn.disabled = true;
  recordBtn.textContent = getMessage('recordNowProgress') || 'Recording...';
  statusDiv.textContent = '';
  statusDiv.className = '';
  showSpinner(getMessage('saving'));

  try {
    const previewSave = await runPreviewAndSave({
      tab,
      content,
      force: true,
      cleansedReason: undefined,
      cleanseStats: undefined,
    });

    hideSpinner();

    if (previewSave.error === 'PRIVATE_PAGE_DETECTED') {
      statusDiv.textContent = buildPrivatePageErrorMessage(previewSave.reason);
      statusDiv.className = 'error';
      setRecordAnywayButton(recordBtn, tab, content);
      return;
    }

    if (previewSave.error === 'CANCELLED') {
      statusDiv.textContent = getMessage('cancelled');
      void resetRecordButton(recordBtn);
      return;
    }

    const result = previewSave.result;
    if (previewSave.success && result) {
      chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} }).catch(() => {});

      const totalDuration = performance.now() - startTime;
      const message = formatSuccessMessage(totalDuration, result.aiDuration, result.obsidianDuration !== undefined);
      statusDiv.textContent = message;
      statusDiv.className = 'success';
      await showCopyMarkdownButton(tab, result);
      showButtonResultState(recordBtn, 'done');
    } else {
      statusDiv.textContent = `${getMessage('saveError')}: ${result?.error || previewSave.error || 'Unknown error'}`;
      statusDiv.className = 'error';
      showButtonResultState(recordBtn, 'error');
    }
  } catch (error: unknown) {
    hideSpinner();
    showError(statusDiv, error, () => handleRecordNowClick(true, tab, content));
    showButtonResultState(recordBtn, 'error');
  }
}

function buildPrivatePageErrorMessage(reason?: string): string {
  const reasonKey = `privatePageReason_${reason?.replace('-', '') || 'cacheControl'}`;
  const reasonText = getMessage(reasonKey) || reason || 'unknown';
  return `${getMessage('errorPrefix')} PRIVATE_PAGE_DETECTED (${reasonText})`;
}

async function showTagResult(url: string, skipAutoClose: boolean = false): Promise<void> {
  if (!url) return;

  const panel = document.getElementById('tagResultPanel');
  if (!panel) return;

  try {
    const entries = await getSavedUrlEntries();
    const entry = entries.find(e => e.url === url);
    const tags = entry?.tags;

    if (!tags || tags.length === 0) return;

    panel.textContent = `🏷 ${getMessage('aiTagsLabel')}: ${tags.map(t => `#${t}`).join('  ')}`;
    panel.classList.remove('hidden');

    if (!skipAutoClose) {
      startAutoCloseTimer(4000);
    }
  } catch {
    // タグ取得失敗はサイレントフェイル
  }
}

interface PreviewSaveOptions {
  tab: chrome.tabs.Tab;
  content: string;
  force: boolean;
  byteStats?: ContentResponse['byteStats'];
  aiSummaryCleansedStats?: ContentResponse['aiSummaryCleansedStats'];
  cleansedReason?: ContentResponse['cleansedReason'];
  cleanseStats?: ContentResponse['cleanseStats'];
}

interface PreviewSaveResult {
  success: boolean;
  result?: SaveRecordResult;
  error?: string;
  reason?: string;
}

async function runPreviewAndSave(options: PreviewSaveOptions): Promise<PreviewSaveResult> {
  const { tab, content, force, byteStats, aiSummaryCleansedStats, cleansedReason, cleanseStats } = options;
  const settings = await getSettings();
  const usePreview = settings[StorageKeys.PII_CONFIRMATION_UI] !== false;

  if (!usePreview) {
    const result = await sendMessageWithRetry({
      type: 'MANUAL_RECORD',
      payload: {
        title: tab.title,
        url: tab.url,
        content,
        force,
        pageBytes: byteStats?.pageBytes,
        candidateBytes: byteStats?.candidateBytes,
        originalBytes: byteStats?.originalBytes,
        cleansedBytes: byteStats?.cleansedBytes,
        aiSummaryOriginalBytes: aiSummaryCleansedStats?.aiSummaryOriginalBytes,
        aiSummaryCleansedBytes: aiSummaryCleansedStats?.aiSummaryCleansedBytes,
        aiSummaryCleansedElements: aiSummaryCleansedStats?.aiSummaryCleansedElements,
        aiSummaryCleansedReason: aiSummaryCleansedStats?.aiSummaryCleansedReason,
        aiSummaryCleansedReasons: aiSummaryCleansedStats?.aiSummaryCleansedReasons
      }
    });
    return { success: !!result?.success, result, error: result?.error };
  }

  showSpinner(getMessage('localAiProcessing'));
  const previewResponse = await sendMessageWithRetry({
    type: 'PREVIEW_RECORD',
    payload: {
      title: tab.title,
      url: tab.url,
      content,
      force,
      pageBytes: byteStats?.pageBytes,
      candidateBytes: byteStats?.candidateBytes,
      originalBytes: byteStats?.originalBytes,
      cleansedBytes: byteStats?.cleansedBytes,
      aiSummaryOriginalBytes: aiSummaryCleansedStats?.aiSummaryOriginalBytes,
      aiSummaryCleansedBytes: aiSummaryCleansedStats?.aiSummaryCleansedBytes,
      aiSummaryCleansedElements: aiSummaryCleansedStats?.aiSummaryCleansedElements,
      aiSummaryCleansedReason: aiSummaryCleansedStats?.aiSummaryCleansedReason,
      aiSummaryCleansedReasons: aiSummaryCleansedStats?.aiSummaryCleansedReasons
    }
  }) as PreviewResponse;

  if (!previewResponse) {
    const errorMsg = 'No response from background worker';
    logError('PREVIEW_RECORD failed: No response', {}, ErrorCode.CONTENT_EXTRACTION_FAILURE);
    throw new Error(errorMsg);
  }

  if (!previewResponse.success && previewResponse.error === 'PRIVATE_PAGE_DETECTED') {
    return { success: false, error: 'PRIVATE_PAGE_DETECTED', reason: previewResponse.reason };
  }

  if (!previewResponse.success) {
    const errorMsg = previewResponse.error || 'Processing failed';
    logError('PREVIEW_RECORD failed', { response: previewResponse }, ErrorCode.CONTENT_EXTRACTION_FAILURE);
    throw new Error(errorMsg);
  }

  const shouldShowPreview = (previewResponse.maskedCount || 0) > 0;
  let finalContent = previewResponse.processedContent;

  if (shouldShowPreview) {
    hideSpinner();
    const confirmation = await showPreview(
      previewResponse.processedContent,
      previewResponse.maskedItems,
      previewResponse.maskedCount || 0,
      cleansedReason,
      cleanseStats
    );

    if (!confirmation.confirmed) {
      return { success: false, error: 'CANCELLED' };
    }
    finalContent = confirmation.content || '';
  }

  showSpinner(getMessage('saving'));
  const result = await sendMessageWithRetry({
    type: 'SAVE_RECORD',
    payload: {
      title: tab.title,
      url: tab.url,
      content: finalContent,
      force: force,
      maskedCount: previewResponse.maskedCount,
      aiDuration: previewResponse.aiDuration,
      pageBytes: byteStats?.pageBytes,
      candidateBytes: byteStats?.candidateBytes,
      originalBytes: byteStats?.originalBytes,
      cleansedBytes: byteStats?.cleansedBytes,
      aiSummaryOriginalBytes: aiSummaryCleansedStats?.aiSummaryOriginalBytes,
      aiSummaryCleansedBytes: aiSummaryCleansedStats?.aiSummaryCleansedBytes,
      aiSummaryCleansedElements: aiSummaryCleansedStats?.aiSummaryCleansedElements,
      aiSummaryCleansedReason: aiSummaryCleansedStats?.aiSummaryCleansedReason,
      aiSummaryCleansedReasons: aiSummaryCleansedStats?.aiSummaryCleansedReasons
    }
  });

  return { success: !!result?.success, result, error: result?.error };
}

function getOrCreateResultActionsContainer(): HTMLElement | null {
  let container = document.getElementById('recordResultActions');
  if (container) {
    container.innerHTML = '';
    return container;
  }

  const tagPanel = document.getElementById('tagResultPanel');
  if (!tagPanel) return null;

  container = document.createElement('div');
  container.id = 'recordResultActions';
  container.className = 'record-result-actions';
  tagPanel.parentNode?.insertBefore(container, tagPanel.nextSibling);
  return container;
}

interface SaveRecordResult {
  success: boolean;
  summary?: string;
  tags?: string[];
  aiDuration?: number;
  obsidianDuration?: number;
  error?: string;
}

function buildEntryFromSaveResult(
  tab: chrome.tabs.Tab,
  result: SaveRecordResult
): BrowsingLogEntry {
  return {
    id: 0,
    url: tab.url || '',
    title: tab.title || tab.url || '',
    summary: result.summary || '',
    tags: Array.isArray(result.tags) ? result.tags.join(',') : '',
    created_at: Date.now(),
    is_starred: 0,
  };
}

async function showCopyMarkdownButton(
  tab: chrome.tabs.Tab,
  result: SaveRecordResult
): Promise<boolean> {
  const container = getOrCreateResultActionsContainer();
  if (!container) return false;

  try {
    const entry = buildEntryFromSaveResult(tab, result);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-markdown-btn secondary-btn';
    button.textContent = getMessage('copyMarkdown') || 'Copy Markdown';
    button.addEventListener('click', async () => {
      const originalText = getMessage('copyMarkdown') || 'Copy Markdown';
      button.disabled = true;
      try {
        const markdown = formatEntryToMarkdown(entry);
        await copyTextToClipboard(markdown);
        button.textContent = getMessage('copyMarkdownSuccess') || 'Copied!';
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 2000);
      } catch {
        button.textContent = getMessage('copyMarkdownError') || 'Copy failed';
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 2000);
      }
    });

    container.appendChild(button);
    return true;
  } catch {
    // コピーボタン追加失敗はサイレントフェイル
    return false;
  }
}

export async function recordCurrentPage(force: boolean = false): Promise<void> {
  const startTime = performance.now();
  const statusDiv = document.getElementById('mainStatus');
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;

  if (!statusDiv) return;

  if (recordBtn) {
    recordBtn.disabled = true;
    recordBtn.textContent = getMessage('recordNowProgress') || 'Recording...';
  }

  hideSpinner();
  statusDiv.textContent = '';
  statusDiv.className = '';
  const tagPanel = document.getElementById('tagResultPanel');
  if (tagPanel) { tagPanel.textContent = ''; tagPanel.classList.add('hidden'); }

  try {
    const tab = await getCurrentTab();
    if (!tab || !tab.id) throw new Error('No active tab found');

    if (!isRecordable(tab)) {
      throw new Error(getMessage('cannotRecordPage'));
    }

    const settings = await getSettings();
    const _usePreview = settings[StorageKeys.PII_CONFIRMATION_UI] !== false;

    showSpinner(getMessage('fetchingContent'));
    let contentResponse: ContentResponse;
    try {
      contentResponse = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT' }) as Promise<ContentResponse>,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Content script response timeout')), 5000);
        })
      ]);
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
    } catch (_e: unknown) {
      let hasPermission = false;
      try {
        hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
        if (!hasPermission) {
          hasPermission = await chrome.permissions.request({ origins: ['<all_urls>'] });
        }
      } catch { /* パーミッション要求失敗 */ }

      if (!hasPermission) {
        throw new Error(getMessage('errorContentScriptNotAvailable'));
      }

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body?.innerText || ''
        });
        contentResponse = { content: results?.[0]?.result || '' };
      } catch (_e2: unknown) {
        if (force) {
          contentResponse = { content: '' };
        } else {
          throw new Error(getMessage('errorContentScriptNotAvailable'));
        }
      }
    }

    if (!contentResponse) {
      if (force) {
        contentResponse = { content: '' };
      } else {
        throw new Error(getMessage('errorNoContentResponse'));
      }
    }

    updateCleansingStatus(contentResponse.cleanseStats, contentResponse.cleansedReason);

    if (tab.url) {
      void updateTrustStatus(tab.url);
    }

    const previewSave = await runPreviewAndSave({
      tab,
      content: contentResponse.content,
      force,
      byteStats: contentResponse.byteStats,
      aiSummaryCleansedStats: contentResponse.aiSummaryCleansedStats,
      cleansedReason: contentResponse.cleansedReason,
      cleanseStats: contentResponse.cleanseStats,
    });

    if (previewSave.error === 'PRIVATE_PAGE_DETECTED') {
      hideSpinner();
      statusDiv.textContent = buildPrivatePageErrorMessage(previewSave.reason);
      statusDiv.className = 'error';

      if (recordBtn) {
        setRecordAnywayButton(recordBtn, tab, contentResponse.content);
      }
      return;
    }

    if (previewSave.error === 'CANCELLED') {
      hideSpinner();
      statusDiv.textContent = getMessage('cancelled');
      if (recordBtn) void resetRecordButton(recordBtn);
      return;
    }

    if (!previewSave.success) {
      throw new Error(previewSave.error || 'Save failed');
    }

    const result = previewSave.result;

    hideSpinner();

    chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} }).catch(() => {});

    const totalDuration = performance.now() - startTime;
    const message = formatSuccessMessage(totalDuration, result?.aiDuration, result?.obsidianDuration !== undefined);

    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.className = 'success';
    }

    const copyButtonShown = await showCopyMarkdownButton(tab, result as SaveRecordResult);
    if (copyButtonShown) {
      // Keep the popup open so the user can click Copy Markdown.
      // Do not start the auto-close timer, but still show tag results.
      await showTagResult(tab.url ?? '', true);
    } else {
      startAutoCloseTimer();
      await showTagResult(tab.url ?? '');
    }
    if (recordBtn) {
      showButtonResultState(recordBtn, 'done');
    }
  } catch (error: unknown) {
    hideSpinner();
    if (recordBtn) {
      showButtonResultState(recordBtn, 'error');
    }
    showError(statusDiv, error, () => recordCurrentPage(true));
  } finally {
    if (!isAwaitingForceConfirm && !isShowingResultState) {
      const btn = document.getElementById('recordBtn') as HTMLButtonElement | null;
      const currentTab = await getCurrentTab();
      if (btn && currentTab && isRecordable(currentTab)) {
        await resetRecordButton(btn);
      }
    }
  }
}

