import { showError } from '../errorUtils.js';
import { getMessage } from '../../utils/i18n.js';

/**
 * エラーメッセージの構築と表示を集約する。
 */
export class ErrorPresenter {
  buildPrivatePageErrorMessage(reason?: string): string {
    const reasonKey = `privatePageReason_${reason?.replace('-', '') || 'cacheControl'}`;
    const reasonText = getMessage(reasonKey) || reason || 'unknown';
    return `${getMessage('errorPrefix')} PRIVATE_PAGE_DETECTED (${reasonText})`;
  }

  show(statusDiv: HTMLElement, error: unknown, retryFn: () => void): void {
    showError(statusDiv, error, retryFn);
  }
}
