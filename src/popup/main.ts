// Main screen functionality
import { getSettings, StorageKeys } from '../utils/storage.js';
import { showPreview, initializeModalEvents } from './sanitizePreview.js';
import { showSpinner, hideSpinner } from './spinner.js';
import { startAutoCloseTimer } from './autoClose.js';
import { getCurrentTab, isRecordable } from './tabUtils.js';
import { showError, showSuccess, ErrorMessages, isDomainBlockedError, isConnectionError, formatSuccessMessage } from './errorUtils.js';
import { getMessage } from './i18n.js';
import { sendMessageWithRetry } from '../utils/retryHelper.js';

// Export functions for testing
export { getCurrentTab };

interface ContentResponse {
  content: string;
}

interface PreviewResponse {
  success: boolean;
  error?: string;
  processedContent: string;
  maskedItems?: any[];
  maskedCount?: number;
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
    } else {
      recordBtn.disabled = false;
      recordBtn.textContent = getMessage('recordNow');
    }
  }
}

// 手動記録処理
export async function recordCurrentPage(force: boolean = false): Promise<void> {
  const startTime = performance.now(); // 🆕 開始時刻を記録
  const statusDiv = document.getElementById('mainStatus');
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;

  if (!statusDiv) return;

  // P2: 二重クリック防止 - 処理中はボタンを無効化
  if (recordBtn) {
    recordBtn.disabled = true;
  }

  hideSpinner(); // 前回のスピナー状態をクリア
  statusDiv.textContent = '';
  statusDiv.className = '';

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
    const contentResponse = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT' }) as ContentResponse;

    // Content Script不在時のエラーハンドリング
    if (chrome.runtime.lastError) {
      throw new Error(getMessage('errorContentScriptNotAvailable'));
    }

    if (!contentResponse) {
      throw new Error(getMessage('errorNoContentResponse'));
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

      if (!previewResponse.success) {
        const errorMsg = previewResponse.error || 'Processing failed';
        console.error('PREVIEW_RECORD failed:', previewResponse);
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
          content: finalContent, // Edited or processed content
          force: force
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

    if (result && result.success) {
      hideSpinner();

      // 🆕 処理時間を計算してメッセージ表示
      const totalDuration = performance.now() - startTime;
      const message = formatSuccessMessage(totalDuration, result.aiDuration);

      if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = 'success';
      }

      // 【自動クローズ起動】: 記録成功後に自動クローズタイマーを起動 🟢
      // 【処理方針】: 画面状態が'main'なら2秒後にポップアップを閉じる
      // 【テスト対応】: テストケース「startAutoCloseTimerでタイマーが起動し、2000ms後にwindow.closeが呼ばれる」
      startAutoCloseTimer();
    } else {
      throw new Error(result.error || 'Save failed');
    }
  } catch (error: any) {
    hideSpinner();
    showError(statusDiv, error, () => recordCurrentPage(true));
  } finally {
    // P2: 二重クリック防止 - 処理完了後にボタンを再有効化
    const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;
    const tab = await getCurrentTab();
    if (recordBtn && tab && isRecordable(tab)) {
      recordBtn.disabled = false;
    }
  }
}

// イベントリスナー設定
const recordBtn = document.getElementById('recordBtn');
if (recordBtn) {
  recordBtn.addEventListener('click', () => recordCurrentPage(false));
}

// 初期化
initializeModalEvents();
loadCurrentTab();