/**
 * RecordingResultBuilder
 * Builds RecordingResult from pipeline context.
 *
 * Extracted from RecordingPipeline (PBI-2026-08-17-10) to separate
 * result construction from orchestration logic.
 */

import { NotificationHelper } from '../notificationHelper.js';
import { pickDefined } from '../../utils/objectUtils.js';
import type { RecordingContext } from './types.js';
import type { RecordingResult } from '../../messaging/types.js';
import { PrivatePageError } from './steps/checkPrivacyHeadersStep.js';

/**
 * Build result for private page detection
 */
export function buildPrivatePageResult(context: RecordingContext, error: PrivatePageError): RecordingResult {
  return {
    success: false,
    error: error.message,
    title: context.data.title,
    url: context.data.url,
    ...pickDefined({
      reason: error.reason,
      confirmationRequired: error.confirmationRequired,
      headerValue: error.headerValue,
    }),
  };
}

/**
 * Build error result. Pure result construction — no logging, pending, or
 * chrome.notifications side effects. The outcome policy
 * (`recordingOutcome.decideStepOutcome`) owns those; callers must route
 * failures through it instead of calling this builder directly.
 */
export function buildErrorResult(context: RecordingContext, error: Error): RecordingResult {
  return {
    success: false,
    error: error.message,
    title: context.data.title,
    url: context.data.url
  };
}

/**
 * Show a notification for a pipeline error. Wired as the default notifier
 * adapter in `recordingOutcome.defaultOutcomeAdapters`; the outcome policy
 * calls it after the error result is built.
 */
export function notifyRecordingError(title: string, errorMessage: string): void {
  const notificationTitle = chrome.i18n.getMessage('recordingFailed') || 'Recording Failed';
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: notificationTitle,
    message: `Failed to record ${title}: ${errorMessage}`
  });
}

/**
 * Build final success result. Pure result construction — the non-fatal error
 * summary log and the obsidian_sync recovery registration live in the outcome
 * policy (`recordingOutcome.finalizeSuccess`); callers must route through it.
 */
export function buildResult(context: RecordingContext): RecordingResult {
  const { data, privacyResult, aiDuration } = context;

  return {
    success: true,
    title: data.title,
    url: data.url,
    ...pickDefined({
      summary: privacyResult?.summary,
      maskedCount: privacyResult?.maskedCount,
      tags: privacyResult?.tags,
      sentTokens: privacyResult?.sentTokens,
      receivedTokens: privacyResult?.receivedTokens,
      originalTokens: privacyResult?.originalTokens,
      cleansedTokens: privacyResult?.cleansedTokens,
      aiDuration,
      aiProvider: privacyResult?.providerName,
      obsidianDuration: context.obsidianDuration,
      localMarkdownDuration: context.localMarkdownDuration,
    }),
  };
}

/**
 * Send success notification when Obsidian save succeeded.
 * Wired as the default notifier adapter in
 * `recordingOutcome.defaultOutcomeAdapters`.
 */
export function notifyObsidianSaveSuccess(title: string): void {
  const notificationTitle = chrome.i18n.getMessage('saveToObsidian') || 'Saved to Obsidian';
  NotificationHelper.notifySuccess(notificationTitle, `Saved: ${title}`);
}
