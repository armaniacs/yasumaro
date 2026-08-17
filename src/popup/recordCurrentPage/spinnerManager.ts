import { showSpinner, hideSpinner } from '../spinner.js';

/**
 * showSpinner/hideSpinner の薄いラッパー。
 * インスタンス化可能にすることで、他クラスからモック注入しやすくする。
 */
export class SpinnerManager {
  show(message: string): void {
    showSpinner(message);
  }

  hide(): void {
    hideSpinner();
  }
}
