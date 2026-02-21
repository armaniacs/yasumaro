// Main screen functionality
import { checkPageStatus } from './statusChecker.js';
import { getSettings, StorageKeys } from '../utils/storage.js';
import { showPreview, initializeModalEvents } from './sanitizePreview.js';
import { showSpinner, hideSpinner } from './spinner.js';
import { startAutoCloseTimer } from './autoClose.js';
import { getCurrentTab, isRecordable } from './tabUtils.js';
import { showError, formatSuccessMessage } from './errorUtils.js';
import { getMessage } from './i18n.js';
import { sendMessageWithRetry } from '../utils/retryHelper.js';
import { getPendingPages } from '../utils/pendingStorage.js';
// Export functions for testing
export { getCurrentTab };
// HTML escape helper function
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
// Load and display pending pages
async function loadPendingPages() {
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
            <div class="pending-item-title">${escapeHtml(page.title)}</div>
            <div class="pending-item-reason">${escapeHtml(page.headerValue || page.reason)}</div>
          </div>
        `;
                pendingList.appendChild(item);
            });
        }
    }
    catch (error) {
        console.error('Failed to load pending pages:', error);
    }
}
// 現在のタブ情報を取得して表示
export async function loadCurrentTab() {
    const tab = await getCurrentTab();
    if (!tab)
        return;
    // Favicon設定 (Chrome Favicon API使用 - MV3)
    const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
    if (tab.url) {
        faviconUrl.searchParams.set('pageUrl', tab.url);
    }
    faviconUrl.searchParams.set('size', '32');
    const faviconEl = document.getElementById('favicon');
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
    const recordBtn = document.getElementById('recordBtn');
    if (recordBtn) {
        if (!isRecordable(tab)) {
            recordBtn.disabled = true;
            recordBtn.textContent = getMessage('cannotRecordPage');
        }
        else {
            recordBtn.disabled = false;
            recordBtn.textContent = getMessage('recordNow');
        }
    }
}
// 手動記録処理
export async function recordCurrentPage(force = false) {
    const startTime = performance.now(); // 🆕 開始時刻を記録
    const statusDiv = document.getElementById('mainStatus');
    const recordBtn = document.getElementById('recordBtn');
    if (!statusDiv)
        return;
    // P2: 二重クリック防止 - 処理中はボタンを無効化
    if (recordBtn) {
        recordBtn.disabled = true;
    }
    hideSpinner(); // 前回のスピナー状態をクリア
    statusDiv.textContent = '';
    statusDiv.className = '';
    try {
        const tab = await getCurrentTab();
        if (!tab || !tab.id)
            throw new Error('No active tab found');
        if (!isRecordable(tab)) {
            throw new Error(getMessage('cannotRecordPage'));
        }
        // 設定確認
        const settings = await getSettings();
        const usePreview = settings[StorageKeys.PII_CONFIRMATION_UI] !== false; // Default true
        // Content Scriptにコンテンツ取得を要求
        showSpinner(getMessage('fetchingContent'));
        const contentResponse = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT' });
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
            });
            if (!previewResponse) {
                const errorMsg = 'No response from background worker';
                console.error('PREVIEW_RECORD failed: No response');
                throw new Error(errorMsg);
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
                const confirmation = await showPreview(previewResponse.processedContent, previewResponse.maskedItems, previewResponse.maskedCount || 0);
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
        }
        else {
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
        // Handle PRIVATE_PAGE_DETECTED error
        if (result && result.error === 'PRIVATE_PAGE_DETECTED') {
            hideSpinner();
            // Get localized reason message
            const reasonKey = `privatePageReason_${result.reason?.replace('-', '') || 'cacheControl'}`;
            const reason = getMessage(reasonKey) || result.reason || 'unknown';
            const message = getMessage('privatePageWarning').replace('$REASON$', reason);
            const userConfirmed = confirm(message);
            if (userConfirmed) {
                // Retry with force=true
                await recordCurrentPage(true);
            }
            else {
                statusDiv.textContent = getMessage('cancelled');
            }
            return;
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
        }
        else {
            throw new Error(result.error || 'Save failed');
        }
    }
    catch (error) {
        hideSpinner();
        showError(statusDiv, error, () => recordCurrentPage(true));
    }
    finally {
        // P2: 二重クリック防止 - 処理完了後にボタンを再有効化
        const recordBtn = document.getElementById('recordBtn');
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
document.addEventListener('DOMContentLoaded', () => {
    initializeModalEvents();
    loadPendingPages();
    loadCurrentTab();
    void initStatusPanel();
});
// ============================================================================
// Status Panel Initialization
// ============================================================================
async function initStatusPanel() {
    try {
        // 現在のタブ情報を取得
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        if (!currentTab?.url) {
            // URLがない場合はパネルを非表示
            const panel = document.getElementById('statusPanel');
            if (panel)
                panel.style.display = 'none';
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
    }
    catch (error) {
        console.error('Error initializing status panel:', error);
        // エラー時はパネルを非表示
        const panel = document.getElementById('statusPanel');
        if (panel)
            panel.style.display = 'none';
    }
}
function renderStatusPanel(status) {
    // アイコン表示
    const domainIcon = document.getElementById('statusDomainIcon');
    const privacyIcon = document.getElementById('statusPrivacyIcon');
    if (domainIcon) {
        if (status.domainFilter.allowed) {
            domainIcon.textContent = '✓';
            domainIcon.className = 'status-icon status-success';
            domainIcon.setAttribute('aria-label', getMessage('statusRecordable'));
        }
        else {
            domainIcon.textContent = '✗';
            domainIcon.className = 'status-icon status-error';
            domainIcon.setAttribute('aria-label', getMessage('statusBlocked'));
        }
    }
    if (privacyIcon) {
        if (status.privacy.isPrivate) {
            privacyIcon.textContent = '⚠';
            privacyIcon.className = 'status-icon status-warning';
            privacyIcon.setAttribute('aria-label', getMessage('statusPrivateDetected'));
        }
        else if (status.privacy.hasCache) {
            privacyIcon.textContent = '✓';
            privacyIcon.className = 'status-icon status-success';
            privacyIcon.setAttribute('aria-label', getMessage('statusPublicPage'));
        }
        else {
            privacyIcon.textContent = '?';
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
            domainState.innerHTML += `<span class="status-value status-muted">${getMessage('statusPattern', [status.domainFilter.matchedPattern])}</span>`;
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
        }
        else {
            let html = '';
            if (status.privacy.isPrivate) {
                if (status.privacy.reason === 'cache-control') {
                    html += `<span class="status-value status-warning">${getMessage('statusCacheControlPrivate')}</span>`;
                }
                else if (status.privacy.reason === 'set-cookie') {
                    html += `<span class="status-value status-warning">${getMessage('statusSetCookieDetected')}</span>`;
                }
                else if (status.privacy.reason === 'authorization') {
                    html += `<span class="status-value status-warning">${getMessage('statusAuthDetected')}</span>`;
                }
            }
            else {
                html += `<span class="status-value status-success">${getMessage('statusPublicPage')}</span>`;
            }
            privacyContent.innerHTML = html;
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
        }
        else {
            if (status.cache.cacheControl) {
                html += `<span class="status-value">Cache-Control: ${status.cache.cacheControl}</span>`;
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
        }
        else {
            lastSavedContent.innerHTML = `
        <span class="status-value">${status.lastSaved.timeAgo}</span>
        <span class="status-value status-muted">${status.lastSaved.formatted}</span>
      `;
        }
    }
}
function renderSpecialUrlStatus() {
    const panel = document.getElementById('statusPanel');
    if (panel) {
        panel.innerHTML = `
      <div class="status-summary">
        <span class="status-value status-error">${getMessage('statusPageNotRecordable')}</span>
      </div>
    `;
    }
}
// initStatusPanel is called in DOMContentLoaded event listener above
//# sourceMappingURL=main.js.map