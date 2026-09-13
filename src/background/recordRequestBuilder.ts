/**
 * recordRequestBuilder.ts
 * Single owner of the RecordingData construction policy (PBI 2026-09-12-04).
 *
 * Five surfaces used to hand-build a RecordingData literal each — manual and
 * save handlers as copy-paste, the offline retry as a lossy `as` cast that
 * dropped every diagnostic field, the notification confirm and the context
 * menu as further spellings. Which of the ~12 optional diagnostic fields
 * travel together is interface knowledge; it lives in this table now, so a
 * new field is one row instead of five synchronized edits, and a surface that
 * forgets one fails a type check instead of silently degrading analytics.
 *
 * Source policy rows capture the per-surface deltas (force, duplicate
 * checking, already-processed, record type). Explicit fields win over the
 * policy so callers keep control where they had it.
 */

import type { RecordingData } from '../messaging/types.js';
import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';
import type { RecordingContext } from './pipeline/types.js';
import { pickDefined } from '../utils/objectUtils.js';

/** The recording surface a request is built for. */
export type RecordRequestSource =
  | 'manual'
  | 'save'
  | 'offline-retry'
  | 'notification-confirm'
  | 'valid-visit';

/**
 * Diagnostic fields every surface may carry; unset ones are dropped.
 * `| undefined` is explicit because callers read optional payload members
 * and the project compiles with exactOptionalPropertyTypes.
 */
export interface RecordDiagnosticFields {
  force?: boolean | undefined;
  skipAi?: boolean | undefined;
  previewOnly?: boolean | undefined;
  maskedCount?: number | undefined;
  pageBytes?: number | undefined;
  candidateBytes?: number | undefined;
  originalBytes?: number | undefined;
  cleansedBytes?: number | undefined;
  aiSummaryOriginalBytes?: number | undefined;
  aiSummaryCleansedBytes?: number | undefined;
  aiSummaryCleansedElements?: number | undefined;
  aiSummaryCleansedReason?: AiSummaryCleansedReason | undefined;
  aiSummaryCleansedReasons?: string[] | undefined;
  cleansedReason?: string | undefined;
  fallbackTriggered?: boolean | undefined;
}

/** Per-surface fixed policy. */
interface SourcePolicy {
  /** Applied only when the caller does not pass an explicit force. */
  force?: boolean;
  skipDuplicateCheck?: boolean;
  alreadyProcessed?: boolean;
  recordType: 'manual' | 'auto';
}

const SOURCE_POLICY: Record<RecordRequestSource, SourcePolicy> = {
  'manual': { skipDuplicateCheck: true, recordType: 'manual' },
  'save': { skipDuplicateCheck: true, alreadyProcessed: true, recordType: 'manual' },
  // The full-pipeline retry re-runs the record as the user initiated it:
  // no force, duplicates skipped, manual semantics.
  'offline-retry': { force: false, skipDuplicateCheck: true, recordType: 'manual' },
  'notification-confirm': { force: true, skipDuplicateCheck: true, recordType: 'auto' },
  'valid-visit': { skipDuplicateCheck: false, recordType: 'auto' },
};

/**
 * Queue payload shared by enqueue (`StepExecutor.enqueueOfflineJob`) and
 * retry (`offlineQueueProcessor`) — PBI 2026-09-12-11.
 *
 * The ~13 diagnostic fields used to be spelled twice (pack vs unpack) plus a
 * third inline type in the processor. The field table lives here now: adding
 * a field is one row, and both sides fail a type check if they forget it.
 */
export type OfflineJobPayload = {
  title: string;
  url: string;
  content: string;
  summary?: string | undefined;
  tags?: string[] | undefined;
} & RecordDiagnosticFields;

/** Pack a pipeline context into the queue payload (single field table). */
export function extractOfflinePayload(context: RecordingContext): OfflineJobPayload {
  return {
    title: context.data.title,
    url: context.data.url,
    content: context.data.content,
    summary: context.privacyResult?.summary,
    maskedCount: context.privacyResult?.maskedCount,
    tags: context.privacyResult?.tags,
    pageBytes: context.data.pageBytes,
    candidateBytes: context.data.candidateBytes,
    originalBytes: context.data.originalBytes,
    cleansedBytes: context.data.cleansedBytes,
    aiSummaryOriginalBytes: context.data.aiSummaryOriginalBytes,
    aiSummaryCleansedBytes: context.data.aiSummaryCleansedBytes,
    aiSummaryCleansedElements: context.data.aiSummaryCleansedElements,
    aiSummaryCleansedReason: context.data.aiSummaryCleansedReason,
    aiSummaryCleansedReasons: context.data.aiSummaryCleansedReasons,
  };
}

/** Rebuild the retry request from a queue payload (single field table). */
export function buildOfflineRetryRequest(payload: OfflineJobPayload): RecordingData {
  return buildRecordRequest('offline-retry', {
    title: payload.title,
    url: payload.url,
    content: payload.content,
    maskedCount: payload.maskedCount,
    pageBytes: payload.pageBytes,
    candidateBytes: payload.candidateBytes,
    originalBytes: payload.originalBytes,
    cleansedBytes: payload.cleansedBytes,
    aiSummaryOriginalBytes: payload.aiSummaryOriginalBytes,
    aiSummaryCleansedBytes: payload.aiSummaryCleansedBytes,
    aiSummaryCleansedElements: payload.aiSummaryCleansedElements,
    aiSummaryCleansedReason: payload.aiSummaryCleansedReason,
    aiSummaryCleansedReasons: payload.aiSummaryCleansedReasons,
  });
}

export function buildRecordRequest(
  source: RecordRequestSource,
  fields: {
    title: string;
    url: string;
    content: string;
  } & RecordDiagnosticFields,
): RecordingData {
  const policy = SOURCE_POLICY[source];
  return {
    title: fields.title,
    url: fields.url,
    content: fields.content,
    recordType: policy.recordType,
    ...pickDefined({
      force: fields.force ?? policy.force,
      skipAi: fields.skipAi,
      previewOnly: fields.previewOnly,
      skipDuplicateCheck: policy.skipDuplicateCheck,
      alreadyProcessed: policy.alreadyProcessed,
      maskedCount: fields.maskedCount,
      pageBytes: fields.pageBytes,
      candidateBytes: fields.candidateBytes,
      originalBytes: fields.originalBytes,
      cleansedBytes: fields.cleansedBytes,
      aiSummaryOriginalBytes: fields.aiSummaryOriginalBytes,
      aiSummaryCleansedBytes: fields.aiSummaryCleansedBytes,
      aiSummaryCleansedElements: fields.aiSummaryCleansedElements,
      aiSummaryCleansedReason: fields.aiSummaryCleansedReason,
      aiSummaryCleansedReasons: fields.aiSummaryCleansedReasons,
      cleansedReason: fields.cleansedReason,
      fallbackTriggered: fields.fallbackTriggered,
    }),
  };
}
