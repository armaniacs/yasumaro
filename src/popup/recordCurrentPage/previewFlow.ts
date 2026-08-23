import { SettingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { showPreview } from '../sanitizePreview.js';
import { getMessage } from '../../utils/i18n.js';
import { sendMessageWithRetry } from '../../utils/retryHelper.js';
import { logError, ErrorCode } from '../../utils/logger.js';
import type { ContentResponse, PreviewResponse } from '../mainTypes.js';
import { SpinnerManager } from './spinnerManager.js';
import { pickDefined } from '../../utils/objectUtils.js';

export interface PreviewSaveOptions {
  tab: chrome.tabs.Tab;
  content: string;
  force: boolean;
  byteStats?: ContentResponse['byteStats'];
  aiSummaryCleansedStats?: ContentResponse['aiSummaryCleansedStats'];
  cleansedReason?: ContentResponse['cleansedReason'];
  cleanseStats?: ContentResponse['cleanseStats'];
}

export interface SaveRecordResult {
  success: boolean;
  summary?: string;
  tags?: string[];
  aiDuration?: number;
  aiProvider?: string;
  obsidianDuration?: number;
  error?: string;
}

export interface PreviewSaveResult {
  success: boolean;
  result?: SaveRecordResult;
  error?: string;
  reason?: string;
}

/**
 * PII_CONFIRMATION_UI 設定に応じてMANUAL_RECORD直送、
 * またはPREVIEW_RECORD→確認→SAVE_RECORDの流れを実行する。
 */
export class PreviewFlow {
  constructor(private readonly spinner: SpinnerManager = new SpinnerManager()) {}

  async run(options: PreviewSaveOptions): Promise<PreviewSaveResult> {
    const { tab, content, force, byteStats, aiSummaryCleansedStats, cleansedReason, cleanseStats } = options;
    const settings = await new SettingsRepository().getAll();
    const usePreview = settings[StorageKeys.PII_CONFIRMATION_UI] !== false;

    if (!usePreview) {
      const result = await sendMessageWithRetry({
        type: 'MANUAL_RECORD',
        payload: {
          title: tab.title,
          url: tab.url,
          content,
          force,
          pageBytes: byteStats?.pageBytes,
          candidateBytes: byteStats?.candidateBytes,
          originalBytes: byteStats?.originalBytes,
          cleansedBytes: byteStats?.cleansedBytes,
          aiSummaryOriginalBytes: aiSummaryCleansedStats?.aiSummaryOriginalBytes,
          aiSummaryCleansedBytes: aiSummaryCleansedStats?.aiSummaryCleansedBytes,
          aiSummaryCleansedElements: aiSummaryCleansedStats?.aiSummaryCleansedElements,
          aiSummaryCleansedReason: aiSummaryCleansedStats?.aiSummaryCleansedReason,
          aiSummaryCleansedReasons: aiSummaryCleansedStats?.aiSummaryCleansedReasons
        }
      });
      return { success: !!result?.success, ...pickDefined({ result, error: result?.error }) };
    }

    this.spinner.show(getMessage('localAiProcessing'));
    const previewResponse = await sendMessageWithRetry({
      type: 'PREVIEW_RECORD',
      payload: {
        title: tab.title,
        url: tab.url,
        content,
        force,
        pageBytes: byteStats?.pageBytes,
        candidateBytes: byteStats?.candidateBytes,
        originalBytes: byteStats?.originalBytes,
        cleansedBytes: byteStats?.cleansedBytes,
        aiSummaryOriginalBytes: aiSummaryCleansedStats?.aiSummaryOriginalBytes,
        aiSummaryCleansedBytes: aiSummaryCleansedStats?.aiSummaryCleansedBytes,
        aiSummaryCleansedElements: aiSummaryCleansedStats?.aiSummaryCleansedElements,
        aiSummaryCleansedReason: aiSummaryCleansedStats?.aiSummaryCleansedReason,
        aiSummaryCleansedReasons: aiSummaryCleansedStats?.aiSummaryCleansedReasons
      }
    }) as PreviewResponse;

    if (!previewResponse) {
      const errorMsg = 'No response from background worker';
      logError('PREVIEW_RECORD failed: No response', {}, ErrorCode.CONTENT_EXTRACTION_FAILURE);
      throw new Error(errorMsg);
    }

    if (!previewResponse.success && previewResponse.error === 'PRIVATE_PAGE_DETECTED') {
      return { success: false, error: 'PRIVATE_PAGE_DETECTED', ...pickDefined({ reason: previewResponse.reason }) };
    }

    if (!previewResponse.success) {
      const errorMsg = previewResponse.error || 'Processing failed';
      logError('PREVIEW_RECORD failed', { response: previewResponse }, ErrorCode.CONTENT_EXTRACTION_FAILURE);
      throw new Error(errorMsg);
    }

    const shouldShowPreview = (previewResponse.maskedCount || 0) > 0;
    let finalContent = previewResponse.processedContent;

    if (shouldShowPreview) {
      this.spinner.hide();
      const confirmation = await showPreview(
        previewResponse.processedContent,
        previewResponse.maskedItems,
        previewResponse.maskedCount || 0,
        cleansedReason,
        cleanseStats
      );

      if (!confirmation.confirmed) {
        return { success: false, error: 'CANCELLED' };
      }
      finalContent = confirmation.content || '';
    }

    this.spinner.show(getMessage('saving'));
    const result = await sendMessageWithRetry({
      type: 'SAVE_RECORD',
      payload: {
        title: tab.title,
        url: tab.url,
        content: finalContent,
        force: force,
        maskedCount: previewResponse.maskedCount,
        pageBytes: byteStats?.pageBytes,
        candidateBytes: byteStats?.candidateBytes,
        originalBytes: byteStats?.originalBytes,
        cleansedBytes: byteStats?.cleansedBytes,
        aiSummaryOriginalBytes: aiSummaryCleansedStats?.aiSummaryOriginalBytes,
        aiSummaryCleansedBytes: aiSummaryCleansedStats?.aiSummaryCleansedBytes,
        aiSummaryCleansedElements: aiSummaryCleansedStats?.aiSummaryCleansedElements,
        aiSummaryCleansedReason: aiSummaryCleansedStats?.aiSummaryCleansedReason,
        aiSummaryCleansedReasons: aiSummaryCleansedStats?.aiSummaryCleansedReasons
      }
    });

    return { success: !!result?.success, ...pickDefined({ result, error: result?.error }) };
  }
}
