import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { showPreview } from '../sanitizePreview.js';
import { getMessage } from '../../utils/i18n.js';
import { messageTransport } from '../../messaging/messageTransport.js';
import type { RecordingResult } from '../../messaging/types.js';
import {
  buildRecordPayload,
  type RecordOp,
  type RecordRequest,
} from '../../messaging/recordPayload.js';
// Re-exported for existing importers (PBI 2026-10-14-03 moved the owner to
// messaging); new code imports from messaging/recordPayload.js directly.
export { buildRecordPayload, type RecordOp, type RecordRequest };
import { ErrorCode } from '../../utils/logger/types.js';
import { logError } from '../../utils/logger/api.js';
import type { ContentResponse } from '../mainTypes.js';
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

/**
 * 記録結果の要約 — SSOT の RecordingResult からの Pick 派生（PBI 2026-10-05-30）。
 * field 追加は messaging/types.js のみで行い、ここに手書きコピーを置かない。
 */
export type SaveRecordResult = Pick<
  RecordingResult,
  'success' | 'summary' | 'tags' | 'aiDuration' | 'aiProvider' | 'obsidianDuration' | 'error'
>;

export interface PreviewSaveResult {
  success: boolean;
  result?: SaveRecordResult;
  error?: string;
  reason?: string;
}

/** Stats bundle carried by every record envelope PreviewFlow sends. */
export type { RecordPayloadStats } from '../../messaging/recordPayload.js';

/**
 * transport.send の unknown 応答を RecordingResult に窄める単一ガード。
 * 応答側の `as` はここに集約し、各 call site ではキャストしない。
 *
 * Review note (2026-10-06): 意図的な弱ガード — `success: boolean` の有無
 * しか見ない。欠落 field は下流の `?? ''` / `|| 0` デフォルトに委ねる。
 * 厳格化（全 field 必須化）は、正規の部分応答まで拒否しうるため採用
 * しない。malformed 応答の振る舞いは previewFlow.test.ts の契約で pin する。
 */
function isRecordingResult(value: unknown): value is RecordingResult {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as { success?: unknown }).success === 'boolean';
}

/** Popup → SW send with retry, via the unified MessageTransport. */
function send(message: RecordRequest): Promise<RecordingResult | undefined> {
  return messageTransport
    .send(message, { retries: 5 })
    .then((response) => (isRecordingResult(response) ? response : undefined));
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
      const settings = await settingsRepository.getAll();
      const usePreview = settings[StorageKeys.PII_CONFIRMATION_UI] !== false;
      const stats = { byteStats, aiSummaryCleansedStats };

      if (!usePreview) {
        const result = await send({
          type: 'MANUAL_RECORD',
          payload: buildRecordPayload('MANUAL_RECORD', tab, content, force, stats),
        });
        return { success: !!result?.success, ...pickDefined({ result, error: result?.error }) };
      }

      scope.show(getMessage('localAiProcessing'));
      const previewResponse = await send({
        type: 'PREVIEW_RECORD',
        payload: buildRecordPayload('PREVIEW_RECORD', tab, content, force, stats),
      });

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
      // SSOT では processedContent は optional。欠落時は空文字で継続する。
      let finalContent = previewResponse.processedContent ?? '';

      if (shouldShowPreview) {
        scope.hide();
        const confirmation = await showPreview(
          previewResponse.processedContent ?? '',
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
        payload: buildRecordPayload('SAVE_RECORD', tab, finalContent, force, {
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
