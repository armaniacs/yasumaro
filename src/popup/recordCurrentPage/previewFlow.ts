import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { showPreview } from '../sanitizePreview.js';
import { getMessage } from '../../utils/i18n.js';
import { messageTransport } from '../../messaging/messageTransport.js';
import type { PayloadForType, RecordingResult } from '../../messaging/types.js';
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
export interface RecordPayloadStats {
  byteStats?: PreviewSaveOptions['byteStats'];
  aiSummaryCleansedStats?: PreviewSaveOptions['aiSummaryCleansedStats'];
  maskedCount?: number | undefined;
}

/** The three record envelopes PreviewFlow sends. */
type RecordOp = 'MANUAL_RECORD' | 'PREVIEW_RECORD' | 'SAVE_RECORD';

/**
 * Send envelope for one record op, with the payload taken from the wire
 * contract instead of a hand-written `Record<string, unknown>`. A field the
 * contract does not declare for an op (maskedCount outside SAVE_RECORD) can no
 * longer be assembled here.
 */
type RecordRequest = { [Op in RecordOp]: { type: Op; payload: PayloadForType<Op> } }[RecordOp];

/** Stats an envelope may carry: only SAVE_RECORD owns maskedCount. */
type RecordStats<Op extends RecordOp> = Op extends 'SAVE_RECORD'
  ? RecordPayloadStats
  : Omit<RecordPayloadStats, 'maskedCount'>;

/**
 * Single builder for the ~12-field record payload (PBI 2026-09-12-14).
 * MANUAL / PREVIEW / SAVE used to hand-spell the same stat fields, so a new
 * field needed three synchronized edits. `content` and `force` stay explicit
 * per send; `maskedCount` rides only the SAVE envelope (preview responses
 * are the sole source).
 *
 * `op` names the envelope the payload is built for. It narrows the accepted
 * stat bundle (a stats literal carrying maskedCount for MANUAL / PREVIEW does
 * not type-check) and it gates the one envelope-exclusive field at runtime,
 * so a caller whose stats already hold the field cannot attach it to the wrong
 * envelope either.
 */
export function buildRecordPayload<Op extends RecordOp>(
  op: Op,
  tab: chrome.tabs.Tab,
  content: string,
  force: boolean,
  stats: RecordStats<Op> = {},
): PayloadForType<Op> {
  // One implementation serves three envelopes, so maskedCount is read through
  // the wide bundle; tab.title / tab.url stay `string | undefined` because the
  // popup has always forwarded whatever Chrome reported. This is the only
  // place the wire contract is narrowed, instead of every send site casting
  // its way past it.
  const { maskedCount } = stats as RecordPayloadStats;
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
    ...(op === 'SAVE_RECORD' ? pickDefined({ maskedCount }) : {}),
  } as PayloadForType<Op>;
}

/**
 * transport.send の unknown 応答を RecordingResult に窄める単一ガード。
 * 応答側の `as` はここに集約し、各 call site ではキャストしない。
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
