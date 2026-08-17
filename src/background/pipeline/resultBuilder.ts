/**
 * RecordingResultBuilder
 * Builds RecordingResult from pipeline context.
 *
 * Extracted from RecordingPipeline (PBI-2026-08-17-10) to separate
 * result construction from orchestration logic.
 */

import { addLog, LogType, logError, ErrorCode } from '../../utils/logger.js';
import { addPendingPage } from '../../utils/pendingStorage.js';
import { NotificationHelper } from '../notificationHelper.js';
import type { RecordingContext, PipelineError } from './types.js';
import type { RecordingResult } from '../../messaging/types.js';
import { PrivatePageError } from './steps/checkPrivacyHeadersStep.js';

/**
 * Build result for private page detection
 */
export function buildPrivatePageResult(context: RecordingContext, error: PrivatePageError): RecordingResult {
  return {
    success: false,
    error: error.message,
    reason: error.reason,
    confirmationRequired: error.confirmationRequired,
    headerValue: error.headerValue,
    title: context.data.title,
    url: context.data.url
  };
}

/**
 * Build error result
 */
export function buildErrorResult(context: RecordingContext, error: Error, stepName: string): RecordingResult {
  logError(`Pipeline failed at step ${stepName}`, {
    error: error.message,
    url: context.data.url,
    tabId: (context.data as unknown as Record<string, unknown>).tabId as number | undefined
  }, ErrorCode.INTERNAL_ERROR, 'RecordingPipeline');

  // Create error notification
  const { title, url } = context.data;
  const notificationTitle = chrome.i18n.getMessage('recordingFailed') || 'Recording Failed';
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: notificationTitle,
    message: `Failed to record ${title}: ${error.message}`
  });

  // 記録漏れリカバリ: pending に登録して再記録できるようにする
  void addPendingPage({
    url: context.data.url,
    title: context.data.title,
    timestamp: Date.now(),
    reason: 'pipeline-error',
    errorMessage: error.message,
    expiry: Date.now() + (24 * 60 * 60 * 1000)
  });

  return {
    success: false,
    error: error.message,
    title: context.data.title,
    url: context.data.url
  };
}

/**
 * Build final success result
 */
export function buildResult(context: RecordingContext): RecordingResult {
  const { data, privacyResult, aiDuration, errors } = context;

  // Log any non-fatal errors
  if (errors.length > 0) {
    addLog(LogType.INFO, 'Pipeline completed with non-fatal errors', {
      url: data.url,
      errorCount: errors.length,
      errorSteps: errors.map(e => e.step),
      traceId: context.traceId
    });
  }

  // 記録漏れリカバリ: Obsidian書き込みのみ失敗した場合、pending に登録して再記録できるようにする
  const obsidianError = errors.find(e => e.recoveryKind === 'obsidian_sync');
  if (obsidianError) {
    void addPendingPage({
      url: data.url,
      title: data.title,
      timestamp: Date.now(),
      reason: 'obsidian-write-failed',
      errorMessage: obsidianError.error.message,
      expiry: Date.now() + (24 * 60 * 60 * 1000)
    });
  }

  return {
    success: true,
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
    title: data.title,
    url: data.url
  };
}

/**
 * Send success notification when Obsidian save succeeded.
 * Called by the caller after buildResult returns success.
 */
export function notifyObsidianSaveSuccess(title: string): void {
  const notificationTitle = chrome.i18n.getMessage('saveToObsidian') || 'Saved to Obsidian';
  NotificationHelper.notifySuccess(notificationTitle, `Saved: ${title}`);
}
