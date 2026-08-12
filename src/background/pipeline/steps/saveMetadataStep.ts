/**
 * Save metadata step
 * Step 9: Save all metadata to storage (best effort)
 *
 * The URL entry's timestamp and every metadata field are committed in ONE
 * atomic operation (saveSavedUrlEntryMetadata) instead of one storage write
 * per field. On failure the metadata patch is queued (PBI-13) so the whole
 * save can be replayed later rather than leaving partial fields.
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { enqueuePendingWrite } from '../../pendingChromeStorageQueue.js';
import type { RecordType, AiSummaryCleansedReason } from '../../../utils/commonTypes.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import {
  saveSavedUrlEntryMetadata,
  type SavedUrlEntryMetadataPatch,
} from '../../../utils/storage/savedUrlStore.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Save all metadata to storage
 * This step uses BEST_EFFORT error strategy - a failure is logged and queued,
 * but never converted into a success value or dropped silently.
 */
export const saveMetadataStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, privacyResult, aiDuration, obsidianDuration, extractedSentencesBytes, extractedSentencesOriginalBytes } = context;
  const {
    url,
    content,
    recordType,
    maskedCount: precomputedMaskedCount,
    pageBytes,
    candidateBytes,
    originalBytes,
    cleansedBytes,
    aiSummaryOriginalBytes,
    aiSummaryCleansedBytes,
    aiSummaryCleansedElements,
    aiSummaryCleansedReason,
    aiSummaryCleansedReasons,
    fallbackTriggered
  } = data;

  // M9: Legacy dual-write end-condition flag.
  // When disabled (LEGACY_DUAL_WRITE_ENABLED === false), skip ALL chrome.storage.local
  // legacy writes here. The record is still persisted to SQLite via saveSqliteStep,
  // so SQLite remains the single source of truth and no redundant chrome.storage
  // write occurs. Default is true (legacy dual-write behavior preserved).
  const legacyDualWriteEnabled =
    (context.settings?.[StorageKeys.LEGACY_DUAL_WRITE_ENABLED] as boolean | undefined) !== false;
  if (!legacyDualWriteEnabled) {
    return context;
  }

  const patch: SavedUrlEntryMetadataPatch = {};

  // Record type
  const resolvedRecordType: RecordType = (recordType as RecordType) ?? 'auto';
  patch.recordType = resolvedRecordType;

  // Masked count (only when nonzero, matching the previous behavior)
  const resolvedMaskedCount = precomputedMaskedCount ?? privacyResult?.maskedCount ?? 0;
  if (resolvedMaskedCount > 0) {
    patch.maskedCount = resolvedMaskedCount;
  }

  // Content
  if (content) {
    patch.content = content;
  }

  // Tags. The save operation merges them into any existing tags, preserving
  // the accumulation behavior of the old per-tag addUrlTag writes.
  if (privacyResult?.tags && privacyResult.tags.length > 0) {
    patch.tags = privacyResult.tags;
  }

  // AI summary
  if (privacyResult?.summary) {
    patch.aiSummary = privacyResult.summary;
  }

  // Token counts
  if (privacyResult?.originalTokens !== undefined) {
    patch.originalTokens = privacyResult.originalTokens;
  }
  if (privacyResult?.cleansedTokens !== undefined) {
    patch.cleansedTokens = privacyResult.cleansedTokens;
  }
  if (privacyResult?.sentTokens !== undefined) {
    patch.sentTokens = privacyResult.sentTokens;
  }
  if (privacyResult?.receivedTokens !== undefined) {
    patch.receivedTokens = privacyResult.receivedTokens;
  }

  // Byte counts
  if (pageBytes !== undefined) {
    patch.pageBytes = pageBytes;
  }
  if (candidateBytes !== undefined) {
    patch.candidateBytes = candidateBytes;
  }
  if (originalBytes !== undefined) {
    patch.originalBytes = originalBytes;
  }
  if (cleansedBytes !== undefined) {
    patch.cleansedBytes = cleansedBytes;
  }
  if (aiSummaryOriginalBytes !== undefined) {
    patch.aiSummaryOriginalBytes = aiSummaryOriginalBytes;
  }
  if (aiSummaryCleansedBytes !== undefined) {
    patch.aiSummaryCleansedBytes = aiSummaryCleansedBytes;
  }
  if (aiSummaryCleansedElements !== undefined) {
    patch.aiSummaryCleansedElements = aiSummaryCleansedElements;
  }
  if (aiSummaryCleansedReason !== undefined) {
    patch.aiSummaryCleansedReason = aiSummaryCleansedReason as AiSummaryCleansedReason;
  }
  if (aiSummaryCleansedReasons !== undefined && aiSummaryCleansedReasons.length > 0) {
    patch.aiSummaryCleansedReasons = aiSummaryCleansedReasons;
  }

  // Fallback flag (always written, false when not triggered)
  patch.fallbackTriggered = !!fallbackTriggered;

  // AI provider / model / privacy mode
  if (privacyResult?.providerName !== undefined) {
    patch.aiProvider = privacyResult.providerName;
  }
  if (privacyResult?.modelName !== undefined) {
    patch.aiModel = privacyResult.modelName;
  }
  if (privacyResult?.mode !== undefined) {
    patch.privacyMode = privacyResult.mode;
  }

  // L0 extracted sentence bytes
  if (extractedSentencesBytes !== undefined) {
    patch.extractedSentencesBytes = extractedSentencesBytes;
  }
  if (extractedSentencesOriginalBytes !== undefined) {
    patch.extractedSentencesOriginalBytes = extractedSentencesOriginalBytes;
  }

  // Timings
  if (aiDuration !== undefined) {
    patch.aiDuration = aiDuration;
  }
  if (obsidianDuration !== undefined) {
    patch.obsidianDuration = obsidianDuration;
  }

  const timestamp = Date.now();
  try {
    await saveSavedUrlEntryMetadata(url, patch, { mergeTags: true, timestamp });
    addLog(LogType.INFO, 'Saved URL entry metadata', { url, traceId: context.traceId });
  } catch (error: unknown) {
    addLog(LogType.WARN, 'Failed to save URL entry metadata', {
      error: errorMessage(error), url, traceId: context.traceId
    });
    // PBI-13: retry via pendingChromeStorageQueue instead of dropping the write.
    // The metadata patch is queued as-is so the retry replays the same atomic
    // save (timestamp refresh included) rather than a partial field update.
    // PBI-08: payload size limit and content omission are enforced by the queue.
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url,
      patch,
      refreshTimestamp: false,
      timestamp,
      mergeTags: true,
      createdAt: Date.now(),
      retryCount: 0,
    });
  }

  return context;
};
