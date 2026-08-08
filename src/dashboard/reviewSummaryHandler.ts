/**
 * reviewSummaryHandler.ts
 * Period-agnostic review summary generation handler.
 *
 * Replaces the near-identical handleGenerateWeeklySummary and
 * handleGenerateMonthlySummary in dashboard.ts.
 */

import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';

export interface GenerateReviewSummaryOptions {
  /** Button element to disable during generation. */
  button: HTMLButtonElement | null;
  /** Status element to update with progress/result. */
  statusElement: HTMLElement | null;
  /** 'weekly' or 'monthly'. */
  periodType: 'weekly' | 'monthly';
}

/**
 * Request the service worker to generate a review summary for the given period.
 * Handles button/status UI updates around the message round-trip.
 */
export async function generateReviewSummary(options: GenerateReviewSummaryOptions): Promise<void> {
  const { button, statusElement, periodType } = options;

  if (!button || !statusElement) return;

  button.disabled = true;
  statusElement.textContent = chrome.i18n.getMessage('testingConnection') || '生成中...';
  statusElement.className = '';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_REVIEW_SUMMARY',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      payload: { periodType },
    }) as { success: boolean; generated?: boolean };

    if (!response.success) throw new Error('GENERATE_REVIEW_SUMMARY failed');

    const success = Boolean(response.generated);
    statusElement.textContent = chrome.i18n.getMessage(
      success ? 'reviewSummaryGenerated' : 'reviewSummarySkipped'
    ) || (success ? 'Summary generated.' : 'No history for the target period.');
    statusElement.className = success ? 'success' : 'info';
  } catch (_e) {
    statusElement.textContent = chrome.i18n.getMessage('reviewSummaryFailed') || 'Failed to generate summary.';
    statusElement.className = 'error';
  } finally {
    button.disabled = false;
  }
}
