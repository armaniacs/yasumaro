/**
 * reviewSummaryHandler.ts
 * Period-agnostic review summary generation handler.
 *
 * Replaces the near-identical handleGenerateWeeklySummary and
 * handleGenerateMonthlySummary in dashboard.ts.
 */

import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';
import { getMessageOr } from '../utils/i18n.js';

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
  statusElement.textContent = getMessageOr('testingConnection', '生成中...');
  statusElement.className = '';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_REVIEW_SUMMARY',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      payload: { periodType },
    }) as { success: boolean; generated?: boolean };

    if (!response.success) throw new Error('GENERATE_REVIEW_SUMMARY failed');

    const success = Boolean(response.generated);
    statusElement.textContent = success
      ? getMessageOr('reviewSummaryGenerated', 'Summary generated.')
      : getMessageOr('reviewSummarySkipped', 'No history for the target period.');
    statusElement.className = success ? 'success' : 'info';
  } catch (_e) {
    statusElement.textContent = getMessageOr('reviewSummaryFailed', 'Failed to generate summary.');
    statusElement.className = 'error';
  } finally {
    button.disabled = false;
  }
}
