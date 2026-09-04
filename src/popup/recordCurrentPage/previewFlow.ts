import { SettingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { showPreview } from '../sanitizePreview.js';
import { getMessage } from '../../utils/i18n.js';
import { messageTransport } from '../../messaging/messageTransport.js';
import type { ExtensionMessage } from '../../background/messageTypes.js';

type RecordMessage =
  | { type: 'MANUAL_RECORD'; payload: Record<string, unknown> }
  | { type: 'PREVIEW_RECORD'; payload: Record<string, unknown> }
  | { type: 'SAVE_RECORD'; payload: Record<string, unknown> };
import { logError, ErrorCode } from '../../utils/logger.js';
import type { ContentResponse, PreviewResponse } from '../mainTypes.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { showSpinner, hideSpinner } from '../spinner.js';

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

/** Popup → SW send with retry, via the unified MessageTransport. */
function send(message: RecordMessage): Promise<SaveRecordResult | undefined> {
  return messageTransport.send(message as unknown as ExtensionMessage, { retries: 5 }) as Promise<
    SaveRecordResult | undefined
  >;
}

/**
 * PII_CONFIRMATION_UI 設定に応じてMANUAL_RECORD直送、
 * またはPREVIEW_RECORD→確認→SAVE_RECORDの流れを実行する。
 */
export class PreviewFlow {

  async run(options: PreviewSaveOptions): Promise<PreviewSaveResult> {
    const { tab, content, force, byteStats, aiSummaryCleansedStats, cleansedReason, cleanseStats } = options;
    const settings = await new SettingsRepository().getAll();
    const usePreview = settings[StorageKeys.PII_CONFIRMATION_UI] !== false;

    if (!usePreview) {
      const result = await send({
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

    showSpinner(getMessage('localAiProcessing'));
    const previewResponse = await send({
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
      hideSpinner();
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

    showSpinner(getMessage('saving'));
    const result = await send({
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
