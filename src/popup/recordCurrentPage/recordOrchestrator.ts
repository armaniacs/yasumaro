import { checkPageStatus } from '../statusChecker.js';
import { getSettings, StorageKeys } from '../../utils/storage.js';
import { startAutoCloseTimer } from '../autoClose.js';
import { getCurrentTab, isRecordable } from '../tabUtils.js';
import { formatSuccessMessage } from '../errorUtils.js';
import { getMessage } from '../../utils/i18n.js';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';
import { getSavedUrlEntries } from '../../utils/storageUrls.js';
import type { ContentResponse } from '../mainTypes.js';
import { copyTextToClipboard } from '../../utils/clipboard.js';
import { formatEntryToMarkdown } from '../../utils/markdownFormatter.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';
import { updateCleansingStatus, updateTrustStatus } from '../statusPanel.js';
import { TabContentFetcher } from './tabContentFetcher.js';
import { PreviewFlow, type SaveRecordResult } from './previewFlow.js';
import { ForceRecordFlow } from './forceRecordFlow.js';
import { SpinnerManager } from './spinnerManager.js';
import { ErrorPresenter } from './errorPresenter.js';

/**
 * ポップアップUIの状態機械。TabContentFetcher/PreviewFlow/ForceRecordFlow/
 * SpinnerManager/ErrorPresenter を束ね、記録フロー全体を調整する。
 * モジュールレベルの可変状態を排除し、インスタンスフィールドとして保持する。
 */
export class RecordOrchestrator {
  /** 「それでも記録」ボタン表示中フラグ */
  private isAwaitingForceConfirm = false;
  /** 記録結果状態（成功/失敗）を表示中のフラグ */
  private isShowingResultState = false;

  constructor(
    private readonly tabContentFetcher: TabContentFetcher = new TabContentFetcher(),
    private readonly previewFlow: PreviewFlow = new PreviewFlow(),
    private readonly forceRecordFlow: ForceRecordFlow = new ForceRecordFlow(),
    private readonly spinner: SpinnerManager = new SpinnerManager(),
    private readonly errorPresenter: ErrorPresenter = new ErrorPresenter(),
  ) {}

  async loadCurrentTab(): Promise<void> {
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

  async resetRecordButton(recordBtn: HTMLButtonElement): Promise<void> {
    recordBtn.disabled = false;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url;
    const status = url ? await checkPageStatus(url) : null;
    // Uses the .onclick property (not addEventListener) intentionally: this function
    // can be called repeatedly as domain-filter status changes, and property assignment
    // replaces the previous handler atomically instead of stacking listeners.
    if (status && !status.domainFilter.allowed) {
      recordBtn.textContent = getMessage('forceRecordAnyway') || 'Record Anyway';
      recordBtn.onclick = () => this.handleRecordNowClick(true);
    } else {
      recordBtn.textContent = getMessage('recordNow');
      recordBtn.onclick = () => this.handleRecordNowClick(false);
    }
  }

  private setRecordAnywayButton(
    recordBtn: HTMLButtonElement,
    tab: chrome.tabs.Tab,
    content: string
  ): void {
    this.isAwaitingForceConfirm = true;
    recordBtn.disabled = false;
    recordBtn.textContent = getMessage('forceRecordAnyway') || 'Record Anyway';
    // .onclick property assignment intentional here too — see resetRecordButton() above.
    recordBtn.onclick = () => {
      this.isAwaitingForceConfirm = false;
      return this.handleRecordNowClick(true, tab, content);
    };
  }

  async handleRecordNowClick(
    force: boolean = false,
    tab?: chrome.tabs.Tab,
    content?: string
  ): Promise<void> {
    const button = document.getElementById('recordBtn') as HTMLButtonElement | null;
    if (!button) return;

    button.disabled = true;
    button.textContent = getMessage('recordNowProgress') || 'Recording...';

    if (force && tab && content !== undefined) {
      await this.forceRecordFlow.run(button, tab, content, {
        setRecordAnywayButton: (btn, t, c) => this.setRecordAnywayButton(btn, t, c),
        resetRecordButton: (btn) => this.resetRecordButton(btn),
        showButtonResultState: (btn, state) => this.showButtonResultState(btn, state),
        showCopyMarkdownButton: (t, r) => this.showCopyMarkdownButton(t, r),
        handleRecordNowClick: (f, t, c) => this.handleRecordNowClick(f, t, c),
      });
    } else {
      await this.recordCurrentPage(force);
    }
  }

  private showButtonResultState(recordBtn: HTMLButtonElement, state: 'done' | 'error'): void {
    this.isAwaitingForceConfirm = false;
    this.isShowingResultState = true;
    recordBtn.disabled = true;
    recordBtn.textContent = getMessage(state === 'done' ? 'recordNowDone' : 'recordNowError')
      || (state === 'done' ? 'Saved!' : 'Failed');
    setTimeout(() => {
      this.isShowingResultState = false;
      const btn = document.getElementById('recordBtn') as HTMLButtonElement | null;
      if (btn) void this.resetRecordButton(btn);
    }, 2000);
  }

  private async showTagResult(url: string, skipAutoClose: boolean = false): Promise<void> {
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

  private getOrCreateResultActionsContainer(): HTMLElement | null {
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

  private buildEntryFromSaveResult(
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

  private async showCopyMarkdownButton(
    tab: chrome.tabs.Tab,
    result: SaveRecordResult
  ): Promise<boolean> {
    const container = this.getOrCreateResultActionsContainer();
    if (!container) return false;

    try {
      const entry = this.buildEntryFromSaveResult(tab, result);
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

  async recordCurrentPage(force: boolean = false): Promise<void> {
    const startTime = performance.now();
    const statusDiv = document.getElementById('mainStatus');
    const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;

    if (!statusDiv) return;

    if (recordBtn) {
      recordBtn.disabled = true;
      recordBtn.textContent = getMessage('recordNowProgress') || 'Recording...';
    }

    this.spinner.hide();
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

      let contentResponse: ContentResponse;
      try {
        contentResponse = await this.tabContentFetcher.fetch(tab, force);
      } catch (e: unknown) {
        if (force) {
          contentResponse = { content: '' };
        } else {
          throw e instanceof Error ? e : new Error(String(e));
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

      const previewSave = await this.previewFlow.run({
        tab,
        content: contentResponse.content,
        force,
        byteStats: contentResponse.byteStats,
        aiSummaryCleansedStats: contentResponse.aiSummaryCleansedStats,
        cleansedReason: contentResponse.cleansedReason,
        cleanseStats: contentResponse.cleanseStats,
      });

      if (previewSave.error === 'PRIVATE_PAGE_DETECTED') {
        this.spinner.hide();
        statusDiv.textContent = this.errorPresenter.buildPrivatePageErrorMessage(previewSave.reason);
        statusDiv.className = 'error';

        if (recordBtn) {
          this.setRecordAnywayButton(recordBtn, tab, contentResponse.content);
        }
        return;
      }

      if (previewSave.error === 'CANCELLED') {
        this.spinner.hide();
        statusDiv.textContent = getMessage('cancelled');
        if (recordBtn) void this.resetRecordButton(recordBtn);
        return;
      }

      if (!previewSave.success) {
        throw new Error(previewSave.error || 'Save failed');
      }

      const result = previewSave.result;

      this.spinner.hide();

      chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} }).catch(() => {});

      const totalDuration = performance.now() - startTime;
      const message = formatSuccessMessage(totalDuration, result?.aiDuration, result?.obsidianDuration !== undefined, result?.aiProvider);

      if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = 'success';
      }

      const copyButtonShown = await this.showCopyMarkdownButton(tab, result as SaveRecordResult);
      if (copyButtonShown) {
        // Keep the popup open so the user can click Copy Markdown.
        // Do not start the auto-close timer, but still show tag results.
        await this.showTagResult(tab.url ?? '', true);
      } else {
        startAutoCloseTimer();
        await this.showTagResult(tab.url ?? '');
      }
      if (recordBtn) {
        this.showButtonResultState(recordBtn, 'done');
      }
    } catch (error: unknown) {
      this.spinner.hide();
      if (recordBtn) {
        this.showButtonResultState(recordBtn, 'error');
      }
      this.errorPresenter.show(statusDiv, error, () => this.recordCurrentPage(true));
    } finally {
      if (!this.isAwaitingForceConfirm && !this.isShowingResultState) {
        const btn = document.getElementById('recordBtn') as HTMLButtonElement | null;
        const currentTab = await getCurrentTab();
        if (btn && currentTab && isRecordable(currentTab)) {
          await this.resetRecordButton(btn);
        }
      }
    }
  }
}
