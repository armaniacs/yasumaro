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
import type { AiSummaryCleansedReason } from '../../../utils/commonTypes.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import {
  saveSavedUrlEntryMetadata,
  type SavedUrlEntryMetadataPatch,
} from '../../../utils/storage/savedUrlRepository.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';
import { extractCommonStorageFields } from '../mappers/commonStorageFields.js';

export const saveMetadataStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const legacyDualWriteEnabled =
    (context.settings?.[StorageKeys.LEGACY_DUAL_WRITE_ENABLED] as boolean | undefined) !== false;
  if (!legacyDualWriteEnabled) {
    return context;
  }

  const common = extractCommonStorageFields(context);
  const patch: SavedUrlEntryMetadataPatch = {};

  (patch as Record<string, unknown>).recordType = common.recordType;

  if (common.maskedCountForPatch !== undefined) {
    patch.maskedCount = common.maskedCountForPatch;
  }
  if (common.content) {
    patch.content = common.content;
  }
  if (common.tagsArray) {
    patch.tags = common.tagsArray;
  }
  if (common.summary) {
    patch.aiSummary = common.summary;
  }
  if (common.originalTokens !== null) patch.originalTokens = common.originalTokens;
  if (common.cleansedTokens !== null) patch.cleansedTokens = common.cleansedTokens;
  if (common.sentTokens !== null) patch.sentTokens = common.sentTokens;
  if (common.receivedTokens !== null) patch.receivedTokens = common.receivedTokens;

  if (common.pageBytes !== null) patch.pageBytes = common.pageBytes;
  if (common.candidateBytes !== null) patch.candidateBytes = common.candidateBytes;
  if (common.originalBytes !== null) patch.originalBytes = common.originalBytes;
  if (common.cleansedBytes !== null) patch.cleansedBytes = common.cleansedBytes;
  if (common.aiSummaryOriginalBytes !== null) patch.aiSummaryOriginalBytes = common.aiSummaryOriginalBytes;
  if (common.aiSummaryCleansedBytes !== null) patch.aiSummaryCleansedBytes = common.aiSummaryCleansedBytes;
  if (common.aiSummaryCleansedElements !== null) patch.aiSummaryCleansedElements = common.aiSummaryCleansedElements;
  if (common.aiSummaryCleansedReason !== null) patch.aiSummaryCleansedReason = common.aiSummaryCleansedReason as AiSummaryCleansedReason;
  if (common.aiSummaryCleansedReasons) patch.aiSummaryCleansedReasons = common.aiSummaryCleansedReasons;

  patch.fallbackTriggered = common.fallbackTriggered;

  if (common.providerName) patch.aiProvider = common.providerName;
  if (common.modelName) patch.aiModel = common.modelName;
  if (common.privacyMode) (patch as Record<string, unknown>).privacyMode = common.privacyMode;

  if (common.extractedSentencesBytes !== null) patch.extractedSentencesBytes = common.extractedSentencesBytes;
  if (common.extractedSentencesOriginalBytes !== null) patch.extractedSentencesOriginalBytes = common.extractedSentencesOriginalBytes;

  if (common.aiDuration !== null) patch.aiDuration = common.aiDuration;
  if (common.obsidianDuration !== null) patch.obsidianDuration = common.obsidianDuration;

  const timestamp = Date.now();
  try {
    await saveSavedUrlEntryMetadata(common.url, patch, { mergeTags: true, timestamp });
    addLog(LogType.INFO, 'Saved URL entry metadata', { url: common.url, traceId: context.traceId });
  } catch (error: unknown) {
    addLog(LogType.WARN, 'Failed to save URL entry metadata', {
      error: errorMessage(error), url: common.url, traceId: context.traceId
    });
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: common.url,
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
