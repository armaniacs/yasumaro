/**
 * aiTestProgressView.ts
 * AI接続テスト実行中の進捗UI（スピナー + プロバイダラベル + 経過時間）。
 *
 * 「初期設定」画面と「診断」画面で同じ進捗表示ロジックが重複していたため、
 * DOM構築とレンダリングを純関数として切り出した。
 */

import { getMessage } from '../utils/i18n.js';
import { type AiTestProgress } from '../background/ai/AIService.js';
import { providerLabel } from './aiTestResultView.js';

export interface AiTestProgressView {
  label: HTMLElement;
  elapsedEl: HTMLElement;
}

/**
 * Build the in-progress UI (spinner + provider label + elapsed time) once.
 * Subsequent updates mutate textContent only so the spinner animation is not
 * restarted and the live region is not re-announced on every tick.
 */
export function buildAiTestProgressView(container: HTMLElement): AiTestProgressView {
  container.innerHTML = '';
  container.className = 'ai-test-progress';

  const spinner = document.createElement('span');
  spinner.className = 'ai-test-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  container.appendChild(spinner);

  const label = document.createElement('span');
  container.appendChild(label);

  const elapsedEl = document.createElement('div');
  elapsedEl.className = 'ai-test-elapsed';
  // Elapsed time ticks 5x/sec; keep it out of the live region to avoid
  // flooding screen readers. The provider label below is the only announced node.
  elapsedEl.setAttribute('aria-hidden', 'true');
  container.appendChild(elapsedEl);

  return { label, elapsedEl };
}

export function renderAiTestProgressLabel(view: AiTestProgressView, progress: AiTestProgress | undefined): void {
  if (progress) {
    const providerDisplay = progress.model ? `${providerLabel(progress.provider)} (${progress.model})` : providerLabel(progress.provider);
    view.label.textContent = getMessage('aiTestingProvider', {
      provider: providerDisplay,
      current: String(progress.index + 1),
      total: String(progress.total),
    }) || `テスト中... (${progress.index + 1}/${progress.total})`;
  } else {
    view.label.textContent = getMessage('testingConnection') || '接続テスト中...';
  }
}

export function renderAiTestProgressElapsed(view: AiTestProgressView, startTime: number, syncEl?: HTMLElement | null): void {
  const elapsedSeconds = ((performance.now() - startTime) / 1000).toFixed(1);
  const text = getMessage('aiTestElapsedTime', { seconds: elapsedSeconds }) || `経過時間: ${elapsedSeconds}秒`;
  view.elapsedEl.textContent = text;
  if (syncEl) {
    const topElapsedEl = syncEl.querySelector('.ai-test-elapsed');
    if (topElapsedEl) topElapsedEl.textContent = text;
  }
}
