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
import { SpinnerScope } from '../spinner.js';

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

/** Stats bundle carried by every record envelope PreviewFlow sends. */
export interface RecordPayloadStats {
  byteStats?: PreviewSaveOptions['byteStats'];
  aiSummaryCleansedStats?: PreviewSaveOptions['aiSummaryCleansedStats'];
  maskedCount?: number | undefined;
}

/**
 * Single builder for the ~12-field record payload (PBI 2026-09-12-14).
 * MANUAL / PREVIEW / SAVE used to hand-spell the same stat fields, so a new
 * field needed three synchronized edits. `content` and `force` stay explicit
 * per send; `maskedCount` rides only the SAVE envelope (preview responses
 * are the sole source).
 */
export function buildRecordPayload(
  tab: chrome.tabs.Tab,
  content: string,
  force: boolean,
  stats: RecordPayloadStats = {},
): Record<string, unknown> {
  return {
    title: tab.title,
    url: tab.url,
    content,
    force,
    pageBytes: stats.byteStats?.pageBytes,
    candidateBytes: stats.byteStats?.candidateBytes,
    originalBytes: stats.byteStats?.originalBytes,
    cleansedBytes: stats.byteStats?.cleansedBytes,
    aiSummaryOriginalBytes: stats.aiSummaryCleansedStats?.aiSummaryOriginalBytes,
    aiSummaryCleansedBytes: stats.aiSummaryCleansedStats?.aiSummaryCleansedBytes,
    aiSummaryCleansedElements: stats.aiSummaryCleansedStats?.aiSummaryCleansedElements,
    aiSummaryCleansedReason: stats.aiSummaryCleansedStats?.aiSummaryCleansedReason,
    aiSummaryCleansedReasons: stats.aiSummaryCleansedStats?.aiSummaryCleansedReasons,
    ...pickDefined({ maskedCount: stats.maskedCount }),
  };
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
    const scope = new SpinnerScope();
    try {
      const settings = await new SettingsRepository().getAll();
      const usePreview = settings[StorageKeys.PII_CONFIRMATION_UI] !== false;
      const stats = { byteStats, aiSummaryCleansedStats };

      if (!usePreview) {
        const result = await send({
          type: 'MANUAL_RECORD',
          payload: buildRecordPayload(tab, content, force, stats),
        });
        return { success: !!result?.success, ...pickDefined({ result, error: result?.error }) };
      }

      scope.show(getMessage('localAiProcessing'));
      const previewResponse = await send({
        type: 'PREVIEW_RECORD',
        payload: buildRecordPayload(tab, content, force, stats),
      }) as PreviewResponse;

      if (!previewResponse) {
        // PBI 2026-09-12-14: expected background failures return instead of
        // throwing — callers settle through PreviewSaveResult uniformly.
        logError('PREVIEW_RECORD failed: No response', {}, ErrorCode.CONTENT_EXTRACTION_FAILURE);
        return { success: false, error: 'No response from background worker' };
      }

      if (!previewResponse.success && previewResponse.error === 'PRIVATE_PAGE_DETECTED') {
        return { success: false, error: 'PRIVATE_PAGE_DETECTED', ...pickDefined({ reason: previewResponse.reason }) };
      }

      if (!previewResponse.success) {
        const errorMsg = previewResponse.error || 'Processing failed';
        logError('PREVIEW_RECORD failed', { response: previewResponse }, ErrorCode.CONTENT_EXTRACTION_FAILURE);
        return { success: false, error: errorMsg };
      }

      const shouldShowPreview = (previewResponse.maskedCount || 0) > 0;
      let finalContent = previewResponse.processedContent;

      if (shouldShowPreview) {
        scope.hide();
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

      scope.show(getMessage('saving'));
      const result = await send({
        type: 'SAVE_RECORD',
        payload: buildRecordPayload(tab, finalContent, force, {
          ...stats,
          maskedCount: previewResponse.maskedCount,
        }),
      });

      return { success: !!result?.success, ...pickDefined({ result, error: result?.error }) };
    } finally {
      // Balances every scope.show on every exit path; the session-level
      // hideSpinner() calls stay valid (hide is idempotent).
      scope.hide();
    }
  }
}
