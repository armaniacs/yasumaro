import { getMessage } from '../../utils/i18n.js';
import { formatSuccessMessage } from '../errorUtils.js';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';
import { PreviewFlow, type SaveRecordResult } from './previewFlow.js';
import { SpinnerManager } from './spinnerManager.js';
import { ErrorPresenter } from './errorPresenter.js';

/**
 * 強制記録ボタンのハンドラ。PreviewFlowをforce=trueで呼び出し、
 * PRIVATE_PAGE_DETECTED/CANCELLED/成功/エラーの各分岐を処理する。
 */
export interface ForceRecordFlowCallbacks {
  setRecordAnywayButton: (recordBtn: HTMLButtonElement, tab: chrome.tabs.Tab, content: string) => void;
  resetRecordButton: (recordBtn: HTMLButtonElement) => Promise<void>;
  showButtonResultState: (recordBtn: HTMLButtonElement, state: 'done' | 'error') => void;
  showCopyMarkdownButton: (tab: chrome.tabs.Tab, result: SaveRecordResult) => Promise<boolean>;
  handleRecordNowClick: (force?: boolean, tab?: chrome.tabs.Tab, content?: string) => Promise<void>;
}

export class ForceRecordFlow {
  constructor(
    private readonly previewFlow: PreviewFlow = new PreviewFlow(),
    private readonly spinner: SpinnerManager = new SpinnerManager(),
    private readonly errorPresenter: ErrorPresenter = new ErrorPresenter(),
  ) {}

  async run(
    recordBtn: HTMLButtonElement,
    tab: chrome.tabs.Tab,
    content: string,
    callbacks: ForceRecordFlowCallbacks,
  ): Promise<void> {
    const startTime = performance.now();
    const statusDiv = document.getElementById('mainStatus');
    if (!statusDiv) return;

    recordBtn.disabled = true;
    recordBtn.textContent = getMessage('recordNowProgress') || 'Recording...';
    statusDiv.textContent = '';
    statusDiv.className = '';
    this.spinner.show(getMessage('saving'));

    try {
      const previewSave = await this.previewFlow.run({
        tab,
        content,
        force: true,
        cleansedReason: undefined,
        cleanseStats: undefined,
      });

      this.spinner.hide();

      if (previewSave.error === 'PRIVATE_PAGE_DETECTED') {
        statusDiv.textContent = this.errorPresenter.buildPrivatePageErrorMessage(previewSave.reason);
        statusDiv.className = 'error';
        callbacks.setRecordAnywayButton(recordBtn, tab, content);
        return;
      }

      if (previewSave.error === 'CANCELLED') {
        statusDiv.textContent = getMessage('cancelled');
        void callbacks.resetRecordButton(recordBtn);
        return;
      }

      const result = previewSave.result;
      if (previewSave.success && result) {
        chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} }).catch(() => {});

        const totalDuration = performance.now() - startTime;
        const message = formatSuccessMessage(totalDuration, result.aiDuration, result.obsidianDuration !== undefined, result.aiProvider);
        statusDiv.textContent = message;
        statusDiv.className = 'success';
        await callbacks.showCopyMarkdownButton(tab, result);
        callbacks.showButtonResultState(recordBtn, 'done');
      } else {
        statusDiv.textContent = `${getMessage('saveError')}: ${result?.error || previewSave.error || 'Unknown error'}`;
        statusDiv.className = 'error';
        callbacks.showButtonResultState(recordBtn, 'error');
      }
    } catch (error: unknown) {
      this.spinner.hide();
      this.errorPresenter.show(statusDiv, error, () => callbacks.handleRecordNowClick(true, tab, content));
      callbacks.showButtonResultState(recordBtn, 'error');
    }
  }
}
