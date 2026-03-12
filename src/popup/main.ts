// Main screen functionality
import { checkPageStatus, StatusInfo } from './statusChecker.js';
import { getSettings, saveSettings, StorageKeys } from '../utils/storage.js';
import { showPreview, initializeModalEvents } from './sanitizePreview.js';
import { showSpinner, hideSpinner } from './spinner.js';
import { startAutoCloseTimer } from './autoClose.js';
import { getCurrentTab, isRecordable } from './tabUtils.js';
import { showError, showSuccess, ErrorMessages, isDomainBlockedError, isConnectionError, formatSuccessMessage } from './errorUtils.js';
import { getMessage } from './i18n.js';
import { sendMessageWithRetry } from '../utils/retryHelper.js';
import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import type { PendingPage } from '../utils/pendingStorage.js';
import { extractDomain } from '../utils/domainUtils.js';
import { getSavedUrlEntries } from '../utils/storageUrls.js';

// Export functions for testing
export { getCurrentTab };

interface ContentResponse {
  content: string;
}

interface PreviewResponse {
  success: boolean;
  error?: string;
  reason?: string;
  headerValue?: string;
  processedContent: string;
  maskedItems?: any[];
  maskedCount?: number;
}

// HTML escape helper function
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==============================================================================
// SVG Status Icon Helper
// ==============================================================================

/**
 * Update SVG status icon content based on status type
 */
function updateStatusIcon(container: HTMLElement | null, type: 'success' | 'error' | 'warning' | 'muted'): void {
  if (!container) return;

  const svg = container.querySelector('.status-svg') as SVGSVGElement | null;
  if (!svg) return;

  // Clear existing content
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }

  // Create based on type
  const ns = 'http://www.w3.org/2000/svg';

  switch (type) {
    case 'success': {
      // Checkmark
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '10');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);

      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M8 12l3 3 6-6');
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);
      break;
    }
    case 'error': {
      // X mark
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '10');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);

      const line1 = document.createElementNS(ns, 'line');
      line1.setAttribute('x1', '9');
      line1.setAttribute('y1', '9');
      line1.setAttribute('x2', '15');
      line1.setAttribute('y2', '15');
      line1.setAttribute('stroke-width', '2.5');
      line1.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line1);

      const line2 = document.createElementNS(ns, 'line');
      line2.setAttribute('x1', '9');
      line2.setAttribute('y1', '15');
      line2.setAttribute('x2', '15');
      line2.setAttribute('y2', '9');
      line2.setAttribute('stroke-width', '2.5');
      line2.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line2);
      break;
    }
    case 'warning': {
      // Exclamation
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '10');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);

      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '12');
      line.setAttribute('y1', '8');
      line.setAttribute('x2', '12');
      line.setAttribute('y2', '12');
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);

      const dot = document.createElementNS(ns, 'line');
      dot.setAttribute('x1', '12');
      dot.setAttribute('y1', '16');
      dot.setAttribute('x2', '12');
      dot.setAttribute('y2', '15.5');
      dot.setAttribute('stroke-width', '2.5');
      dot.setAttribute('stroke-linecap', 'round');
      svg.appendChild(dot);
      break;
    }
    case 'muted': {
      // Question mark
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '10');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);

      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);

      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '12');
      line.setAttribute('y1', '17');
      line.setAttribute('x2', '12.01');
      line.setAttribute('y2', '17');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
      break;
    }
  }
}

// ============================================================================
// Private Page Confirmation Dialog
// ============================================================================

interface PendingSave {
  url: string;
  title: string;
  content: string;
  privacyData: any;
}

let currentPendingSave: PendingSave | null = null;

// 「それでも記録」ボタン表示中フラグ（recordCurrentPage の finally でのリセットを防ぐ）
let isAwaitingForceConfirm = false;

function showPrivatePageDialog(url: string, reason: string, headerValue: string): void {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  const messageEl = document.getElementById('dialog-message');

  if (messageEl) {
    const header = headerValue || reason;
    messageEl.textContent = chrome.i18n.getMessage('warningPrivatePageMessage', [header, url]);
  }

  dialog?.showModal();
}

async function recordWithForce(): Promise<void> {
  if (!currentPendingSave) return;

  const response = await chrome.runtime.sendMessage({
    type: 'record',
    data: {
      title: currentPendingSave.title,
      url: currentPendingSave.url,
      content: currentPendingSave.content,
      force: true
    }
  });

  const statusDiv = document.getElementById('mainStatus');
  if (response?.success) {
    if (statusDiv) {
      statusDiv.textContent = getMessage('saveSuccess');
      statusDiv.className = 'success';
    }
    startAutoCloseTimer();
  } else {
    if (statusDiv) {
      statusDiv.textContent = `${getMessage('saveError')}: ${response?.error || 'Unknown error'}`;
      statusDiv.className = 'error';
    }
  }

  currentPendingSave = null;
}

// Dialog button handlers
document.getElementById('dialog-cancel')?.addEventListener('click', () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();
  currentPendingSave = null;
});

document.getElementById('dialog-save-once')?.addEventListener('click', async () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();

  if (currentPendingSave) {
    await recordWithForce();
  }
});

document.getElementById('dialog-save-domain')?.addEventListener('click', async () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();

  if (currentPendingSave) {
    const domain = extractDomain(currentPendingSave.url);
    if (domain) {
      const settings = await getSettings();
      const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
      if (!whitelist.includes(domain)) {
        whitelist.push(domain);
        await saveSettings({ [StorageKeys.DOMAIN_WHITELIST]: whitelist }, true);
      }
    }
    await recordWithForce();
  }
});

document.getElementById('dialog-save-path')?.addEventListener('click', async () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();

  if (currentPendingSave) {
    const settings = await getSettings();
    const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
    if (!whitelist.includes(currentPendingSave.url)) {
      whitelist.push(currentPendingSave.url);
      await saveSettings({ [StorageKeys.DOMAIN_WHITELIST]: whitelist }, true);
    }
    await recordWithForce();
  }
});

// Load and display pending pages
async function loadPendingPages(): Promise<void> {
  try {
    const pages = await getPendingPages();

    const pendingSection = document.getElementById('pending-section');
    const pendingEmpty = document.getElementById('pending-empty');
    const pendingList = document.getElementById('pending-pages-list');

    if (!pages || pages.length === 0) {
      pendingSection?.classList.add('hidden');
      pendingEmpty?.classList.remove('hidden');
      return;
    }

    pendingSection?.classList.remove('hidden');
    pendingEmpty?.classList.add('hidden');

    if (pendingList) {
      pendingList.innerHTML = '';
      pages.forEach((page, index) => {
        const item = document.createElement('div');
        item.className = 'pending-item';
        item.dataset.url = page.url;
        item.dataset.index = String(index);

        item.innerHTML = `
          <input type="checkbox" value="${page.url}" class="pending-checkbox">
          <div class="pending-item-content">
            <div class="pending-item-title pending-item-title--link">${escapeHtml(page.title)}</div>
            <div class="pending-item-reason">${escapeHtml(page.headerValue || page.reason)}</div>
          </div>
        `;

        const titleEl = item.querySelector('.pending-item-title');
        if (titleEl) {
          titleEl.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.tabs.create({ url: page.url });
          });
        }

        pendingList.appendChild(item);
      });
    }
  } catch (error) {
    console.error('Failed to load pending pages:', error);
  }
}

// Whitelist operations namespace
namespace WhitelistOperations {
  export async function addDomainsOrPaths(urls: string[], type: 'domain' | 'path'): Promise<void> {
    const { domainWhitelist = [] } = await chrome.storage.local.get('domainWhitelist') as { domainWhitelist?: string[] };

    const newEntries = urls.map(url => {
      if (type === 'domain') {
        const domain = new URL(url).hostname;
        return domain;
      } else {
        const urlObj = new URL(url);
        return `^${escapeRegex(urlObj.origin + urlObj.pathname)}$`;
      }
    });

    const updatedList = [...domainWhitelist, ...newEntries];
    await chrome.storage.local.set({ domainWhitelist: updatedList });
  }

  function escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// Save selected pending pages
async function saveSelectedPages(whitelistType?: 'domain' | 'path'): Promise<void> {
  const checkboxes = document.querySelectorAll('.pending-checkbox:checked') as NodeListOf<HTMLInputElement>;
  const urls = Array.from(checkboxes).map(cb => cb.value);

  if (urls.length === 0) return;

  if (whitelistType) {
    await WhitelistOperations.addDomainsOrPaths(urls, whitelistType);
  }

  // Re-record each page from pending list
  for (const url of urls) {
    const pages = await getPendingPages();
    const page = pages.find(p => p.url === url);
    if (page) {
      await chrome.runtime.sendMessage({
        type: 'record',
        data: {
          title: page.title,
          url: page.url,
          content: '',
          force: true
        }
      });
    }
  }

  await removePendingPages(urls);
  await loadPendingPages();
}

// 現在のタブ情報を取得して表示
export async function loadCurrentTab(): Promise<void> {
  const tab = await getCurrentTab();
  if (!tab) return;

  // Favicon設定 (Chrome Favicon API使用 - MV3)
  const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
  if (tab.url) {
    faviconUrl.searchParams.set('pageUrl', tab.url);
  }
  faviconUrl.searchParams.set('size', '32');
  const faviconEl = document.getElementById('favicon') as HTMLImageElement;
  if (faviconEl) {
    faviconEl.src = faviconUrl.toString();
  }

  // タイトル・URL表示
  const pageTitleEl = document.getElementById('pageTitle');
  if (pageTitleEl) {
    pageTitleEl.textContent = tab.title || getMessage('noTitle');
  }
  const url = tab.url || '';
  const pageUrlEl = document.getElementById('pageUrl');
  if (pageUrlEl) {
    pageUrlEl.textContent = url.length > 50 ? url.substring(0, 50) + '...' : url;
  }

  // 記録可能ページチェック
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
  if (recordBtn) {
    if (!isRecordable(tab)) {
      recordBtn.disabled = true;
      recordBtn.textContent = getMessage('cannotRecordPage');
    }
    // 記録可能な場合はinitStatusPanel内のrenderStatusPanelでボタンを設定する
  }
}

// ボタンをデフォルト状態にリセットする（ドメインブロック時は「それでも記録」）
async function resetRecordButton(recordBtn: HTMLButtonElement): Promise<void> {
  recordBtn.disabled = false;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url;
  const status = url ? await checkPageStatus(url) : null;
  if (status && !status.domainFilter.allowed) {
    recordBtn.textContent = getMessage('forceRecordAnyway') || 'Record Anyway';
    recordBtn.onclick = () => void recordCurrentPage(true);
  } else {
    recordBtn.textContent = getMessage('recordNow');
    recordBtn.onclick = () => recordCurrentPage(false);
  }
}

// ボタンを「それでも記録」状態に設定する
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
    void forceRecord(recordBtn, tab, content);
  };
}

// PRIVATE_PAGE_DETECTED 後の強制保存処理（再帰なし）
async function forceRecord(
  recordBtn: HTMLButtonElement,
  tab: chrome.tabs.Tab,
  content: string
): Promise<void> {
  const startTime = performance.now();
  const statusDiv = document.getElementById('mainStatus');
  if (!statusDiv) return;

  // ボタンを「記録中...」状態にして二重クリック防止
  recordBtn.disabled = true;
  recordBtn.textContent = getMessage('recording') || 'Recording...';
  statusDiv.textContent = '';
  statusDiv.className = '';
  showSpinner(getMessage('saving'));

  try {
    const settings = await getSettings();
    const usePreview = settings[StorageKeys.PII_CONFIRMATION_UI] !== false;

    let result;
    if (usePreview) {
      result = await sendMessageWithRetry({
        type: 'SAVE_RECORD',
        payload: {
          title: tab.title,
          url: tab.url,
          content: content,
          force: true
        }
      });
    } else {
      result = await sendMessageWithRetry({
        type: 'MANUAL_RECORD',
        payload: {
          title: tab.title,
          url: tab.url,
          content: content,
          force: true
        }
      });
    }

    hideSpinner();

    if (result && result.success) {
      // アクティビティ通知（セッションタイムアウト防止）
      chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', payload: {} }).catch(() => {
        // 送信失敗は無視
      });

      const totalDuration = performance.now() - startTime;
      const message = formatSuccessMessage(totalDuration, result.aiDuration);
      statusDiv.textContent = message;
      statusDiv.className = 'success';
      startAutoCloseTimer();
      resetRecordButtonAndClearFlag(recordBtn);
    } else {
      statusDiv.textContent = `${getMessage('saveError')}: ${result?.error || 'Unknown error'}`;
      statusDiv.className = 'error';
      resetRecordButtonAndClearFlag(recordBtn);
    }
  } catch (error: any) {
    hideSpinner();
    showError(statusDiv, error, () => void forceRecord(recordBtn, tab, content));
    resetRecordButtonAndClearFlag(recordBtn);
  }
}

function resetRecordButtonAndClearFlag(btn: HTMLButtonElement): void {
  isAwaitingForceConfirm = false;
  void resetRecordButton(btn);
}

// AIタグ分類結果を表示し、タグがある場合は自動クローズを延長する
async function showTagResult(url: string): Promise<void> {
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

    // タグが表示される場合は自動クローズを延長（通常の2倍）
    startAutoCloseTimer(4000);
  } catch {
    // タグ取得失敗はサイレントフェール
  }
}

// 手動記録処理
export async function recordCurrentPage(force: boolean = false): Promise<void> {
  const startTime = performance.now();
  const statusDiv = document.getElementById('mainStatus');
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;

  if (!statusDiv) return;

  // 二重クリック防止 - 処理中はボタンを無効化
  if (recordBtn) {
    recordBtn.disabled = true;
  }

  hideSpinner(); // 前回のスピナー状態をクリア
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

    // 設定確認
    const settings = await getSettings();
    const usePreview = settings[StorageKeys.PII_CONFIRMATION_UI] !== false; // Default true

    // Content Scriptにコンテンツ取得を要求
    showSpinner(getMessage('fetchingContent'));
    let contentResponse: ContentResponse;
    try {
      contentResponse = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT' }) as ContentResponse;
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
    } catch (e: any) {
      if (force) {
        // force=true の場合は executeScript でコンテンツを直接取得
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.body?.innerText || ''
          });
          contentResponse = { content: results?.[0]?.result || '' };
        } catch {
          contentResponse = { content: '' };
        }
      } else {
        throw new Error(getMessage('errorContentScriptNotAvailable'));
      }
    }

    if (!contentResponse) {
      if (force) {
        contentResponse = { content: '' };
      } else {
        throw new Error(getMessage('errorNoContentResponse'));
      }
    }

    // Background Workerに記録を要求
    let result;

    if (usePreview) {
      showSpinner(getMessage('localAiProcessing'));
      // 1. プレビュー用データ取得 (L1/L2 processing)
      const previewResponse = await sendMessageWithRetry({
        type: 'PREVIEW_RECORD',
        payload: {
          title: tab.title,
          url: tab.url,
          content: contentResponse.content,
          force: force
        }
      }) as PreviewResponse;

      if (!previewResponse) {
        const errorMsg = 'No response from background worker';
        console.error('PREVIEW_RECORD failed: No response');
        throw new Error(errorMsg);
      }

      // PRIVATE_PAGE_DETECTED エラーを previewフェーズで検出
      if (!previewResponse.success && previewResponse.error === 'PRIVATE_PAGE_DETECTED') {
        hideSpinner();

        const reasonKey = `privatePageReason_${previewResponse.reason?.replace('-', '') || 'cacheControl'}`;
        const reason = getMessage(reasonKey) || previewResponse.reason || 'unknown';

        statusDiv.textContent = `${getMessage('errorPrefix')} PRIVATE_PAGE_DETECTED (${reason})`;
        statusDiv.className = 'error';

        if (recordBtn) {
          setRecordAnywayButton(recordBtn, tab, contentResponse.content);
        }
        // finally でボタンをリセットしないよう、早期リターン後に isAwaitingForceConfirm フラグで制御
        return;
      }

      if (!previewResponse.success) {
        const errorMsg = previewResponse.error || 'Processing failed';
        console.error('PREVIEW_RECORD failed:', JSON.stringify(previewResponse, null, 2));
        throw new Error(errorMsg);
      }

      // マスクが行われた場合のみ確認画面を表示する
      const shouldShowPreview = (previewResponse.maskedCount || 0) > 0;

      let finalContent = previewResponse.processedContent;

      if (shouldShowPreview) {
        // 2. ユーザー確認（プレビュー表示前にスピナーを非表示）
        hideSpinner();
        const confirmation = await showPreview(
          previewResponse.processedContent,
          previewResponse.maskedItems,
          previewResponse.maskedCount || 0
        );

        if (!confirmation.confirmed) {
          statusDiv.textContent = getMessage('cancelled');
          if (recordBtn) void resetRecordButton(recordBtn);
          return;
        }
        finalContent = confirmation.content || '';
      }

      // 3. 確定データ送信 (L3 processing & Save)
      showSpinner(getMessage('saving'));
      result = await sendMessageWithRetry({
        type: 'SAVE_RECORD',
        payload: {
          title: tab.title,
          url: tab.url,
          content: finalContent,
          force: force,
          maskedCount: previewResponse.maskedCount
        }
      });

    } else {
      // 確認なしの既存フロー
      result = await sendMessageWithRetry({
        type: 'MANUAL_RECORD',
        payload: {
          title: tab.title,
          url: tab.url,
          content: contentResponse.content,
          force: force
        }
      });
    }

    // PRIVATE_PAGE_DETECTED エラーを saveフェーズで検出（usePreview=false の場合）
    if (result && result.error === 'PRIVATE_PAGE_DETECTED') {
      hideSpinner();

      const reasonKey = `privatePageReason_${result.reason?.replace('-', '') || 'cacheControl'}`;
      const reason = getMessage(reasonKey) || result.reason || 'unknown';

      statusDiv.textContent = `${getMessage('errorPrefix')} PRIVATE_PAGE_DETECTED (${reason})`;
      statusDiv.className = 'error';

      if (recordBtn) {
        setRecordAnywayButton(recordBtn, tab, contentResponse.content);
      }
      return;
    }

    if (result && result.success) {
      hideSpinner();

      // アクティビティ通知（セッションタイムアウト防止）
      chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', payload: {} }).catch(() => {
        // 送信失敗は無視
      });

      const totalDuration = performance.now() - startTime;
      const message = formatSuccessMessage(totalDuration, result.aiDuration);

      if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = 'success';
      }

      startAutoCloseTimer();
      await showTagResult(tab.url ?? '');
    } else {
      throw new Error(result.error || 'Save failed');
    }
  } catch (error: any) {
    hideSpinner();
    showError(statusDiv, error, () => recordCurrentPage(true));
  } finally {
    // PRIVATE_PAGE_DETECTED で「それでも記録」ボタンを表示中はリセットしない
    if (!isAwaitingForceConfirm) {
      const btn = document.getElementById('recordBtn') as HTMLButtonElement | null;
      const currentTab = await getCurrentTab();
      if (btn && currentTab && isRecordable(currentTab)) {
        await resetRecordButton(btn);
      }
    }
  }
}

// イベントリスナー設定
// NOTE: onclick プロパティで管理（addEventListener との混在を避ける）
const recordBtnInit = document.getElementById('recordBtn') as HTMLButtonElement | null;
if (recordBtnInit) {
  recordBtnInit.onclick = () => recordCurrentPage(false);
}

// Pending pages batch operations
document.getElementById('btn-select-all')?.addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.pending-checkbox') as NodeListOf<HTMLInputElement>;
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);

  checkboxes.forEach(cb => {
    cb.checked = !allChecked;
  });
});

document.getElementById('btn-save-selected')?.addEventListener('click', () => {
  saveSelectedPages();
});

document.getElementById('btn-save-whitelist')?.addEventListener('click', () => {
  saveSelectedPages('domain');
});

document.getElementById('btn-discard')?.addEventListener('click', async () => {
  const checkboxes = document.querySelectorAll('.pending-checkbox:checked') as NodeListOf<HTMLInputElement>;
  const urls = Array.from(checkboxes).map(cb => cb.value);

  if (urls.length === 0) {
    const statusDiv = document.getElementById('mainStatus');
    if (statusDiv) {
      showSuccess(statusDiv, getMessage('pendingPagesEmpty') || 'No items selected.');
    }
    return;
  }

  if (confirm(chrome.i18n.getMessage('warningConfirmSave'))) {
    await removePendingPages(urls);
    await loadPendingPages();
  }
});

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  initializeModalEvents();
  loadPendingPages();
  loadCurrentTabAndInitStatus().catch((error) => {
    console.error('[Initialize] Failed to load current tab or init status panel:', error);
  });
  // ポップアップを開いたタイミングでバッジをクリア
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId !== undefined) {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  });
});

/**
 * 現在のタブ情報をロードし、ステータスパネルを初期化する
 */
async function loadCurrentTabAndInitStatus(): Promise<void> {
  await loadCurrentTab();
  await initStatusPanel();
}

// ============================================================================
// Status Panel Initialization
// ============================================================================

async function initStatusPanel(): Promise<void> {
  try {
    // 現在のタブ情報を取得
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];

    if (!currentTab?.url) {
      // URLがない場合はパネルを非表示
      const panel = document.getElementById('statusPanel');
      if (panel) panel.style.display = 'none';
      return;
    }

    // ステータス情報を取得
    const status = await checkPageStatus(currentTab.url);

    if (!status) {
      // 特殊URL（chrome://など）の場合
      renderSpecialUrlStatus();
      return;
    }

    // ステータスをレンダリング
    renderStatusPanel(status);

    // 展開/折りたたみイベントリスナー
    const toggleBtn = document.getElementById('statusToggleBtn');
    const detailsPanel = document.getElementById('statusDetails');

    toggleBtn?.addEventListener('click', () => {
      const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
      detailsPanel?.classList.toggle('hidden');
      detailsPanel?.setAttribute('aria-hidden', String(isExpanded));

      const toggleText = document.getElementById('statusToggleText');
      if (toggleText) {
        toggleText.textContent = isExpanded
          ? getMessage('statusShowDetails')
          : getMessage('statusHideDetails');
      }
    });
  } catch (error) {
    console.error('Error initializing status panel:', error);
    // エラー時はパネルを非表示
    const panel = document.getElementById('statusPanel');
    if (panel) panel.style.display = 'none';
  }
}

function renderStatusPanel(status: StatusInfo): void {
  // アイコン表示
  const domainIcon = document.getElementById('statusDomainIcon');
  const privacyIcon = document.getElementById('statusPrivacyIcon');

  if (domainIcon) {
    if (status.domainFilter.allowed) {
      updateStatusIcon(domainIcon, 'success');
      domainIcon.className = 'status-icon status-success';
      domainIcon.setAttribute('aria-label', getMessage('statusRecordable'));
    } else {
      updateStatusIcon(domainIcon, 'error');
      domainIcon.className = 'status-icon status-error';
      domainIcon.setAttribute('aria-label', getMessage('statusBlocked'));
    }
  }

  if (privacyIcon) {
    if (status.privacy.isPrivate) {
      updateStatusIcon(privacyIcon, 'warning');
      privacyIcon.className = 'status-icon status-warning';
      privacyIcon.setAttribute('aria-label', getMessage('statusPrivateDetected'));
    } else if (status.privacy.hasCache) {
      updateStatusIcon(privacyIcon, 'success');
      privacyIcon.className = 'status-icon status-success';
      privacyIcon.setAttribute('aria-label', getMessage('statusPublicPage'));
    } else {
      updateStatusIcon(privacyIcon, 'muted');
      privacyIcon.className = 'status-icon status-muted';
      privacyIcon.setAttribute('aria-label', getMessage('statusNoInfo'));
    }
  }

  // ドメインフィルタセクション
  const domainState = document.getElementById('statusDomainState');
  const domainMode = document.getElementById('statusDomainMode');

  if (domainState) {
    const stateMsg = status.domainFilter.allowed
      ? getMessage('statusDomainAllowed')
      : getMessage('statusDomainBlocked');
    domainState.innerHTML = `<span class="status-value ${status.domainFilter.allowed ? 'status-success' : 'status-error'}">${stateMsg}</span>`;

    if (status.domainFilter.matchedPattern) {
      // 【セキュリティ】: ユーザー入力（matchedPattern）をHTMLエスケープし、XSS攻撃を防ぐ 🟢
      const patternMsg = getMessage('statusPattern', [escapeHtml(status.domainFilter.matchedPattern)]);
      domainState.innerHTML += `<span class="status-value status-muted">${patternMsg}</span>`;
    }
  }

  if (domainMode) {
    const modeKey = `statusFilterMode${status.domainFilter.mode.charAt(0).toUpperCase()}${status.domainFilter.mode.slice(1)}`;
    domainMode.innerHTML = `<span class="status-value status-muted">${getMessage(modeKey)}</span>`;
  }

  // プライバシーセクション
  const privacyContent = document.getElementById('statusPrivacyContent');
  if (privacyContent) {
    if (!status.privacy.hasCache) {
      privacyContent.innerHTML = `
        <span class="status-value status-muted">${getMessage('statusNoInfo')}</span>
        <span class="status-value status-muted status-hint">${getMessage('statusReloadHint')}</span>
      `;
    } else {
      let html = '';
      if (status.privacy.isPrivate) {
        if (status.privacy.reason === 'cache-control') {
          html += `<span class="status-value status-warning">${getMessage('statusCacheControlPrivate')}</span>`;
        } else if (status.privacy.reason === 'set-cookie') {
          html += `<span class="status-value status-warning">${getMessage('statusSetCookieDetected')}</span>`;
        } else if (status.privacy.reason === 'authorization') {
          html += `<span class="status-value status-warning">${getMessage('statusAuthDetected')}</span>`;
        }

        // Add action buttons for private pages
        html += `
          <div class="status-actions">
            <button class="status-action-btn primary" id="statusRecordOnce" data-i18n="saveOnce">今すぐ記録</button>
            <button class="status-action-btn" id="statusAddDomain" data-i18n="saveDomain">ドメインを許可</button>
            <button class="status-action-btn" id="statusAddPath" data-i18n="savePath">パスを許可</button>
          </div>
        `;
      } else {
        html += `<span class="status-value status-success">${getMessage('statusPublicPage')}</span>`;
      }
      privacyContent.innerHTML = html;

      // Attach event listeners to action buttons
      if (status.privacy.isPrivate) {
        attachPrivacyActionListeners();
      }
    }
  }

  // キャッシュセクション
  const cacheContent = document.getElementById('statusCacheContent');
  if (cacheContent) {
    let html = '';

    // デバッグ情報を表示
    console.log('[StatusPanel] Cache status:', {
      hasCache: status.cache.hasCache,
      cacheControl: status.cache.cacheControl,
      hasCookie: status.cache.hasCookie,
      hasAuth: status.cache.hasAuth
    });

    if (!status.cache.hasCache) {
      html = `<span class="status-value status-muted">${getMessage('statusNoInfo')}</span>`;
    } else {
      if (status.cache.cacheControl) {
        // 【セキュリティ】: ユーザー入力（cacheControl HTTPヘッダー値）をHTMLエスケープし、XSS攻撃を防ぐ 🟢
        html += `<span class="status-value">Cache-Control: ${escapeHtml(status.cache.cacheControl)}</span>`;
      }
      if (status.cache.hasCookie) {
        html += `<span class="status-value">${getMessage('statusSetCookiePresent')}</span>`;
      }
      if (status.cache.hasAuth) {
        html += `<span class="status-value">${getMessage('statusAuthorizationPresent')}</span>`;
      }
      if (!html) {
        html = `<span class="status-value status-muted">${getMessage('statusNoCacheInfo')}</span>`;
      }
    }
    cacheContent.innerHTML = html;
  }

  // 最終保存セクション
  const lastSavedContent = document.getElementById('statusLastSavedContent');
  if (lastSavedContent) {
    if (!status.lastSaved.exists) {
      lastSavedContent.innerHTML = `<span class="status-value status-muted">${getMessage('statusNotSaved')}</span>`;
    } else {
      // 【セキュリティ】: ユーザー入力（timeAgo, formatted）をHTMLエスケープし、XSS攻撃を防ぐ 🟢
      // 【型安全性】: undefined値の可能性を考慮し、空文字をデフォルト値として提供
      lastSavedContent.innerHTML = `
        <span class="status-value">${escapeHtml(status.lastSaved.timeAgo || '')}</span>
        <span class="status-value status-muted">${escapeHtml(status.lastSaved.formatted || '')}</span>
      `;
    }
  }

  // ドメイン状態に応じてrecordBtnを設定
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;
  if (recordBtn && !recordBtn.disabled) {
    if (!status.domainFilter.allowed) {
      recordBtn.textContent = getMessage('forceRecordAnyway') || 'Record Anyway';
      recordBtn.onclick = () => void recordCurrentPage(true);
    } else {
      recordBtn.textContent = getMessage('recordNow');
      recordBtn.onclick = () => recordCurrentPage(false);
    }
  }
}

function renderSpecialUrlStatus(): void {
  const panel = document.getElementById('statusPanel');
  if (panel) {
    panel.innerHTML = `
      <div class="status-summary">
        <span class="status-value status-error">${getMessage('statusPageNotRecordable')}</span>
      </div>
    `;
  }
}

/**
 * Attach event listeners to privacy action buttons
 */
function attachPrivacyActionListeners(): void {
  // Record once button
  const recordOnceBtn = document.getElementById('statusRecordOnce');
  recordOnceBtn?.addEventListener('click', async () => {
    await recordCurrentPage(true);
  });

  // Add domain to whitelist button
  const addDomainBtn = document.getElementById('statusAddDomain');
  addDomainBtn?.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (tab?.url) {
      const domain = extractDomain(tab.url);
      if (domain) {
        const settings = await getSettings();
        const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
        if (!whitelist.includes(domain)) {
          whitelist.push(domain);
          await saveSettings({ [StorageKeys.DOMAIN_WHITELIST]: whitelist }, true);

          const statusDiv = document.getElementById('mainStatus');
          if (statusDiv) {
            statusDiv.textContent = getMessage('domainAddedToWhitelist') || `Added ${domain} to whitelist`;
            statusDiv.className = 'success';
          }

          // Refresh status panel
          await initStatusPanel();
        }
      }
    }
  });

  // Add path to whitelist button
  const addPathBtn = document.getElementById('statusAddPath');
  addPathBtn?.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (tab?.url) {
      const settings = await getSettings();
      const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
      if (!whitelist.includes(tab.url)) {
        whitelist.push(tab.url);
        await saveSettings({ [StorageKeys.DOMAIN_WHITELIST]: whitelist }, true);

        const statusDiv = document.getElementById('mainStatus');
        if (statusDiv) {
          statusDiv.textContent = getMessage('pathAddedToWhitelist') || `Added path to whitelist`;
          statusDiv.className = 'success';
        }

        // Refresh status panel
        await initStatusPanel();
      }
    }
  });
}

// initStatusPanel is called in DOMContentLoaded event listener above