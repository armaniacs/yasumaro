import { checkPageStatus } from '../statusChecker.js';
import { SettingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { startAutoCloseTimer } from '../autoClose.js';
import { getCurrentTab, isRecordable } from '../tabUtils.js';
import { formatSuccessMessage } from '../errorUtils.js';
import { getMessage } from '../../utils/i18n.js';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';
import { getSavedUrlEntries } from '../../utils/storageUrls.js';
import type { ContentResponse } from '../mainTypes.js';
import { copyTextToClipboard } from '../../utils/clipboard.js';
import { showSpinner, hideSpinner } from '../spinner.js';
import { showError } from '../errorUtils.js';
import { formatEntryToMarkdown } from '../../utils/markdownFormatter.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';
import { updateCleansingStatus, updateTrustStatus } from '../statusPanel.js';
import { TabContentFetcher } from './tabContentFetcher.js';
import { PreviewFlow, type PreviewSaveResult, type SaveRecordResult } from './previewFlow.js';

/**
 * Popup record session states. Exactly one owner (this module) reads and
 * writes the button/result lifecycle — no cross-module flags.
 */
export type RecordSessionState = 'idle' | 'running' | 'awaiting-force' | 'showing-result';

const RESULT_STATE_MS = 2000;

/**
 * Settlement outcome. private-page / cancelled are fully settled inside
 * (identical in both former flows); ok carries the save result for the
 * branch-specific success tail.
 */
type Settlement =
  | { kind: 'private-page' }
  | { kind: 'cancelled' }
  | { kind: 'ok'; result: SaveRecordResult | null };

/**
 * RecordSession — deep module owning the whole click→fetch→preview→save→
 * button-result loop behind start(force)/cancel().
 *
 * Unifies the two former flows (RecordOrchestrator.recordCurrentPage +
 * ForceRecordFlow.run): the PRIVATE_PAGE / CANCELLED / success / error
 * settlement lives in one set of private helpers, and the button state
 * machine (idle → running → awaiting-force / showing-result → idle) replaces
 * the isAwaitingForceConfirm/isShowingResultState flags plus the
 * 5-callback inversion bundle.
 *
 * Deletion test: deleting the session scatters state transitions, settlement
 * branches, and timer handles back across flows, the shim, and the panel.
 */
export class RecordSession {
  private sessionState: RecordSessionState = 'idle';
  private resultTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly tabContentFetcher: TabContentFetcher = new TabContentFetcher(),
    private readonly previewFlow: PreviewFlow = new PreviewFlow(),
  ) {}

  /** Read-only state for tests and future callers. Transitions stay private. */
  get state(): RecordSessionState {
    return this.sessionState;
  }

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

  /**
   * Sole button writer. Syncs text/handler to the domain-filter status.
   * Called on load/finish paths and nowhere else — the status panel only
   * signals through the session entry points, never touching onclick itself.
   */
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
    this.sessionState = 'awaiting-force';
    recordBtn.disabled = false;
    recordBtn.textContent = getMessage('forceRecordAnyway') || 'Record Anyway';
    // .onclick property assignment intentional here too — see resetRecordButton() above.
    recordBtn.onclick = () => {
      void this.start(true, tab, content);
    };
  }

  /**
   * Click entry. Delegates to start(); kept as the name the popup shim and
   * the button wiring use.
   */
  async handleRecordNowClick(
    force: boolean = false,
    tab?: chrome.tabs.Tab,
    content?: string
  ): Promise<void> {
    await this.start(force, tab, content);
  }

  /**
   * Normal entry (fetch + preview + save). Kept as the name the popup shim uses.
   */
  async recordCurrentPage(force: boolean = false): Promise<void> {
    await this.start(force);
  }

  /**
   * Start one record attempt. A concurrent call while running is ignored —
   * this closes the latent double-run where the popup's addEventListener and
   * the button's onclick both fired handleRecordNowClick for one click.
   * awaiting-force re-arms into a force attempt; showing-result restarts
   * (the button is disabled in UI there, as before — no behavior change).
   */
  async start(force: boolean = false, tab?: chrome.tabs.Tab, content?: string): Promise<void> {
    if (this.sessionState === 'running') return;
    this.sessionState = 'running';
    try {
      if (force && tab && content !== undefined) {
        await this.runForceBranch(tab, content);
      } else {
        await this.runNormalBranch(force);
      }
    } finally {
      await this.finishToIdle();
    }
  }

  /**
   * Release a terminal wait state (awaiting-force / showing-result) back to
   * idle. In-flight work is never aborted. Returns whether a release happened.
   */
  async cancel(): Promise<boolean> {
    if (this.sessionState !== 'awaiting-force' && this.sessionState !== 'showing-result') {
      return false;
    }
    if (this.resultTimer) {
      clearTimeout(this.resultTimer);
      this.resultTimer = null;
    }
    this.sessionState = 'idle';
    const btn = document.getElementById('recordBtn') as HTMLButtonElement | null;
    const currentTab = await getCurrentTab();
    if (btn && currentTab && isRecordable(currentTab)) {
      await this.resetRecordButton(btn);
    }
    return true;
  }

  /** Safety net mirroring the old finally: only running may settle to idle here. */
  private async finishToIdle(): Promise<void> {
    if (this.sessionState !== 'running') return;
    this.sessionState = 'idle';
    const btn = document.getElementById('recordBtn') as HTMLButtonElement | null;
    const currentTab = await getCurrentTab();
    if (btn && currentTab && isRecordable(currentTab)) {
      await this.resetRecordButton(btn);
    }
  }

  private showButtonResultState(recordBtn: HTMLButtonElement, state: 'done' | 'error'): void {
    this.sessionState = 'showing-result';
    recordBtn.disabled = true;
    recordBtn.textContent = getMessage(state === 'done' ? 'recordNowDone' : 'recordNowError')
      || (state === 'done' ? 'Saved!' : 'Failed');
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => {
      this.resultTimer = null;
      this.sessionState = 'idle';
      const btn = document.getElementById('recordBtn') as HTMLButtonElement | null;
      if (btn) void this.resetRecordButton(btn);
    }, RESULT_STATE_MS);
  }

  /**
   * Build the private-page error message. Moved in from the deleted
   * ErrorPresenter pass-through (wording unchanged).
   */
  private buildPrivatePageErrorMessage(reason?: string): string {
    const reasonKey = `privatePageReason_${reason?.replace('-', '') || 'cacheControl'}`;
    const reasonText = getMessage(reasonKey) || reason || 'unknown';
    return `${getMessage('errorPrefix')} PRIVATE_PAGE_DETECTED (${reasonText})`;
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

  /** Shared: report background activity fire-and-forget. */
  private reportActivity(): void {
    chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} }).catch(() => {});
  }

  /** Shared: render the success message into the status div. */
  private showSuccessMessage(statusDiv: HTMLElement, startTime: number, result: SaveRecordResult | null): void {
    const totalDuration = performance.now() - startTime;
    const message = formatSuccessMessage(totalDuration, result?.aiDuration, result?.obsidianDuration !== undefined, result?.aiProvider);
    statusDiv.textContent = message;
    statusDiv.className = 'success';
  }

  /**
   * Shared settlement for the PRIVATE_PAGE / CANCELLED branches (identical in
   * both former flows).
   */
  private settlePreviewSave(
    previewSave: PreviewSaveResult,
    statusDiv: HTMLElement,
    recordBtn: HTMLButtonElement | null,
    tab: chrome.tabs.Tab,
    content: string
  ): Settlement {
    if (previewSave.error === 'PRIVATE_PAGE_DETECTED') {
      hideSpinner();
      statusDiv.textContent = this.buildPrivatePageErrorMessage(previewSave.reason);
      statusDiv.className = 'error';

      if (recordBtn) {
        this.setRecordAnywayButton(recordBtn, tab, content);
      }
      return { kind: 'private-page' };
    }

    if (previewSave.error === 'CANCELLED') {
      hideSpinner();
      statusDiv.textContent = getMessage('cancelled');
      if (recordBtn) void this.resetRecordButton(recordBtn);
      this.sessionState = 'idle';
      return { kind: 'cancelled' };
    }

    return { kind: 'ok', result: previewSave.result ?? null };
  }

  /** Normal branch: fetch tab content, then preview + save. */
  private async runNormalBranch(force: boolean): Promise<void> {
    const startTime = performance.now();
    const statusDiv = document.getElementById('mainStatus');
    const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;

    // Degenerate DOM: the former flow returned before touching anything.
    // Settle to idle directly so finishToIdle() leaves the button alone.
    if (!statusDiv) {
      this.sessionState = 'idle';
      return;
    }

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

      const settings = await new SettingsRepository().getAll();
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

      const settlement = this.settlePreviewSave(previewSave, statusDiv, recordBtn, tab, contentResponse.content);
      if (settlement.kind === 'private-page') {
        // No button to offer force-retry on: fall into the error path exactly
        // as the former flow did (throw -> catch -> errorPresenter).
        if (!recordBtn) throw new Error(previewSave.error || 'Save failed');
        return;
      }
      if (settlement.kind === 'cancelled') return;
      const result = settlement.result;

      if (!previewSave.success) {
        throw new Error(previewSave.error || 'Save failed');
      }

      hideSpinner();
      this.reportActivity();
      this.showSuccessMessage(statusDiv, startTime, result);

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
      hideSpinner();
      if (recordBtn) {
        this.showButtonResultState(recordBtn, 'error');
      }
      showError(statusDiv, error, () => this.recordCurrentPage(true));
    }
  }

  /** Force branch: skip fetch (content given), preview + save with force. */
  private async runForceBranch(tab: chrome.tabs.Tab, content: string): Promise<void> {
    const button = document.getElementById('recordBtn') as HTMLButtonElement | null;
    // Degenerate DOM: the former flow returned before touching anything.
    if (!button) {
      this.sessionState = 'idle';
      return;
    }

    const startTime = performance.now();
    const statusDiv = document.getElementById('mainStatus');
    if (!statusDiv) {
      this.sessionState = 'idle';
      return;
    }

    button.disabled = true;
    button.textContent = getMessage('recordNowProgress') || 'Recording...';
    statusDiv.textContent = '';
    statusDiv.className = '';
    showSpinner(getMessage('saving'));

    try {
      const previewSave = await this.previewFlow.run({
        tab,
        content,
        force: true,
        cleansedReason: undefined,
        cleanseStats: undefined,
      });

      hideSpinner();

      const settlement = this.settlePreviewSave(previewSave, statusDiv, button, tab, content);
      if (settlement.kind !== 'ok') return;
      const result = settlement.result;

      if (previewSave.success && result) {
        this.reportActivity();
        this.showSuccessMessage(statusDiv, startTime, result);
        await this.showCopyMarkdownButton(tab, result);
        this.showButtonResultState(button, 'done');
      } else {
        statusDiv.textContent = `${getMessage('saveError')}: ${result?.error || previewSave.error || 'Unknown error'}`;
        statusDiv.className = 'error';
        this.showButtonResultState(button, 'error');
      }
    } catch (error: unknown) {
      hideSpinner();
      showError(statusDiv, error, () => this.start(true, tab, content));
      this.showButtonResultState(button, 'error');
    }
  }
}
