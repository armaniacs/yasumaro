/**
 * recordPayload.ts
 * Single builder for the ~12-field record envelopes (MANUAL / PREVIEW / SAVE).
 *
 * Moved here from popup/recordCurrentPage/previewFlow.ts (PBI 2026-10-14-03):
 * the wire assembly is a contract concern, not a UI concern — the popup owns
 * the dialog orchestration (spinner, confirmation), while the payload shape
 * lives in the neutral messaging layer both sides already depend on.
 * Re-exported from previewFlow for existing importers; new code imports here.
 *
 * History: MANUAL / PREVIEW / SAVE used to hand-spell the same stat fields,
 * so a new field needed three synchronized edits (PBI 2026-09-12-14).
 * `content` and `force` stay explicit per send; `maskedCount` rides only the
 * SAVE envelope (preview responses are the sole source).
 */
import type { ContentResponse, PayloadForType } from './types.js';
import { pickDefined } from '../utils/objectUtils.js';

/** The three record envelopes this builder serves. */
export type RecordOp = 'MANUAL_RECORD' | 'PREVIEW_RECORD' | 'SAVE_RECORD';

/** Minimal tab surface the builder reads (title/url only — no chrome coupling). */
export interface RecordPayloadTab {
  title?: string | undefined;
  url?: string | undefined;
}

/** Stats bundle carried by every record envelope. Shapes defer to the wire's ContentResponse. */
export interface RecordPayloadStats {
  byteStats?: ContentResponse['byteStats'];
  aiSummaryCleansedStats?: ContentResponse['aiSummaryCleansedStats'];
  maskedCount?: number | undefined;
}

/**
 * Send envelope for one record op, with the payload taken from the wire
 * contract instead of a hand-written `Record<string, unknown>`. A field the
 * contract does not declare for an op (maskedCount outside SAVE_RECORD) can no
 * longer be assembled here.
 */
export type RecordRequest = { [Op in RecordOp]: { type: Op; payload: PayloadForType<Op> } }[RecordOp];

/** Stats an envelope may carry: only SAVE_RECORD owns maskedCount. */
export type RecordStats<Op extends RecordOp> = Op extends 'SAVE_RECORD'
  ? RecordPayloadStats
  : Omit<RecordPayloadStats, 'maskedCount'>;

/**
 * Single builder for the ~12-field record payload.
 *
 * `op` names the envelope the payload is built for. It narrows the accepted
 * stat bundle (a stats literal carrying maskedCount for MANUAL / PREVIEW does
 * not type-check) and it gates the one envelope-exclusive field at runtime,
 * so a caller whose stats already hold the field cannot attach it to the wrong
 * envelope either.
 */
export function buildRecordPayload<Op extends RecordOp>(
  op: Op,
  tab: RecordPayloadTab,
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
