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

import type { RecordingData, ContentResponse } from '../messaging/types.js';
import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';
import type { RecordingContext } from './pipeline/types.js';
import { pickDefined } from '../utils/objectUtils.js';

/** The recording surface a request is built for. */
export type RecordRequestSource =
  | 'manual'
  | 'save'
  | 'offline-retry'
  | 'notification-confirm'
  | 'valid-visit'
  | 'regenerate';

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
  /** PBI 05: fallback reason carried through regenerate re-extraction. */
  fallbackReason?: string | undefined;
  /** PBI 04: UPDATE-in-place target — the existing row this request replaces. */
  targetEntryId?: number | undefined;
}

/** Per-surface fixed policy. */
interface SourcePolicy {
  /** Applied only when the caller does not pass an explicit force. */
  force?: boolean;
  skipDuplicateCheck?: boolean;
  alreadyProcessed?: boolean;
  /** PBI 04: side-effect skips owned by the policy (regenerate = SQLite only). */
  skipObsidianAppend?: boolean;
  skipLocalMarkdownExport?: boolean;
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
  // PBI 04: in-place regenerate — same-row UPDATE, side effects skipped, and
  // force stays OFF by default (gate rejections surface a force opt-in instead;
  // the handler passes fields.force explicitly only when the user picks it).
  'regenerate': {
    skipDuplicateCheck: true,
    skipObsidianAppend: true,
    skipLocalMarkdownExport: true,
    recordType: 'manual',
  },
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

/**
 * Carrier of the shared byte/diagnostic subset every record surface forwards
 * (PBI 2026-09-23-12).
 *
 * Handler payloads arrive in two spellings: flat message payloads
 * (VALID_VISIT / MANUAL / SAVE) and the nested extraction reply
 * (REGENERATE_SUMMARY's ContentResponse with byteStats +
 * aiSummaryCleansedStats). Both are accepted so each call site collapses to
 * a one-line `...pickRecordDiagnostics(payload)` spread.
 *
 * `maskedCount` is accepted and deliberately dropped: the caller-supplied
 * value is an unverified claim, never a measurement (VULN-007, PBI
 * 2026-09-22-09). `force` / `skipAi` / `previewOnly` / `targetEntryId`
 * stay caller-explicit and are not part of this table.
 */
export type RecordDiagnosticsSource = Partial<
  Pick<
    RecordDiagnosticFields,
    | 'pageBytes'
    | 'candidateBytes'
    | 'originalBytes'
    | 'cleansedBytes'
    | 'aiSummaryOriginalBytes'
    | 'aiSummaryCleansedBytes'
    | 'aiSummaryCleansedElements'
    | 'aiSummaryCleansedReason'
    | 'aiSummaryCleansedReasons'
    | 'cleansedReason'
    | 'fallbackTriggered'
    | 'fallbackReason'
  >
> & {
  maskedCount?: unknown;
  byteStats?: ContentResponse['byteStats'];
  aiSummaryCleansedStats?: ContentResponse['aiSummaryCleansedStats'];
};

/**
 * Extract the shared byte/diagnostic subset from any handler payload.
 * Single owner of which fields travel together: a new diagnostic field is
 * one row here instead of four synchronized edits in recordingHandlers.ts,
 * and a surface that forgets the spread fails noisily (missing keys) rather
 * than silently degrading analytics. Undefined-dropping matches pickDefined,
 * so unset fields stay absent and downstream `in` checks keep working.
 */
export function pickRecordDiagnostics(
  payload: RecordDiagnosticsSource | null | undefined,
): RecordDiagnosticFields {
  if (payload === null || payload === undefined) return {};
  return pickDefined({
    pageBytes: payload.pageBytes ?? payload.byteStats?.pageBytes,
    candidateBytes: payload.candidateBytes ?? payload.byteStats?.candidateBytes,
    originalBytes: payload.originalBytes ?? payload.byteStats?.originalBytes,
    cleansedBytes: payload.cleansedBytes ?? payload.byteStats?.cleansedBytes,
    aiSummaryOriginalBytes:
      payload.aiSummaryOriginalBytes ?? payload.aiSummaryCleansedStats?.aiSummaryOriginalBytes,
    aiSummaryCleansedBytes:
      payload.aiSummaryCleansedBytes ?? payload.aiSummaryCleansedStats?.aiSummaryCleansedBytes,
    aiSummaryCleansedElements:
      payload.aiSummaryCleansedElements ?? payload.aiSummaryCleansedStats?.aiSummaryCleansedElements,
    aiSummaryCleansedReason:
      payload.aiSummaryCleansedReason ?? payload.aiSummaryCleansedStats?.aiSummaryCleansedReason,
    aiSummaryCleansedReasons:
      payload.aiSummaryCleansedReasons ?? payload.aiSummaryCleansedStats?.aiSummaryCleansedReasons,
    cleansedReason: payload.cleansedReason,
    fallbackTriggered: payload.fallbackTriggered,
    fallbackReason: payload.fallbackReason,
  });
}

export function buildRecordRequest(  source: RecordRequestSource,
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
      fallbackReason: fields.fallbackReason,
      targetEntryId: fields.targetEntryId,
      skipObsidianAppend: policy.skipObsidianAppend,
      skipLocalMarkdownExport: policy.skipLocalMarkdownExport,
    }),
  };
}
