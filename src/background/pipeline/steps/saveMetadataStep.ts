/**
 * Save metadata step
 * Step 9: Save all metadata to storage (best effort)
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { withOptimisticLock } from '../../../utils/optimisticLock.js';
import type { RecordType, AiSummaryCleansedReason } from '../../../utils/commonTypes.js';
import type { SavedUrlEntry } from '../../../utils/urlEntry.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import {
  setUrlRecordType,
  setUrlMaskedCount,
  setUrlTags,
  setUrlContent,
  setUrlAiSummary,
  setUrlSentTokens,
  setUrlReceivedTokens,
  setUrlOriginalTokens,
  setUrlCleansedTokens,
  setUrlPageBytes,
  setUrlCandidateBytes,
  setUrlOriginalBytes,
  setUrlCleansedBytes,
  setUrlAiSummaryOriginalBytes,
  setUrlAiSummaryCleansedBytes,
  setUrlAiSummaryCleansedElements,
  setUrlAiSummaryCleansedReason,
  setUrlAiSummaryCleansedReasons,
  setUrlAiProvider,
  setUrlAiModel,
  setUrlAiDuration,
  setUrlObsidianDuration,
  setUrlExtractedSentencesBytes,
  setUrlExtractedSentencesOriginalBytes,
  setUrlFallbackTriggered
} from '../../../utils/storageUrls.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Save all metadata to storage
 * This step uses BEST_EFFORT error strategy - try to save as much as possible
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

  const results: { success: string[]; failed: string[] } = { success: [], failed: [] };

  // Add URL entry to savedUrlsWithTimestamps for legacy history panel
  await (async () => {
    try {
      await withOptimisticLock<SavedUrlEntry[]>('savedUrlsWithTimestamps', (currentEntries) => {
        const current = currentEntries || [];
        const existingIdx = current.findIndex(e => e.url === url);
        if (existingIdx >= 0) {
          return current.map((e, i) =>
            i === existingIdx ? { ...e, timestamp: Date.now() } : e
          );
        }
        return [...current, { url, title: data.title || '', timestamp: Date.now() }];
      });
      results.success.push('savedUrlsWithTimestamps');
    } catch (error: unknown) {
      results.failed.push('savedUrlsWithTimestamps');
      addLog(LogType.WARN, 'Failed to save savedUrlsWithTimestamps entry', {
        error: errorMessage(error), url
      });
    }
  })();

  // Helper to track results
  const save = async (name: string, promise: Promise<void>): Promise<void> => {
    try {
      await promise;
      results.success.push(name);
    } catch (error: unknown) {
      results.failed.push(name);
      addLog(LogType.WARN, `Failed to save ${name}`, { error: errorMessage(error), url });
    }
  };

  // Save record type
  const resolvedRecordType: RecordType = (recordType as RecordType) ?? 'auto';
  await save('recordType', setUrlRecordType(url, resolvedRecordType));

  // Save masked count
  const resolvedMaskedCount = precomputedMaskedCount ?? privacyResult?.maskedCount ?? 0;
  if (resolvedMaskedCount > 0) {
    await save('maskedCount', setUrlMaskedCount(url, resolvedMaskedCount));
  }

  // Save content
  if (content) {
    await save('content', setUrlContent(url, content));
  }

  // Save tags
  if (privacyResult?.tags && privacyResult.tags.length > 0) {
    await save('tags', setUrlTags(url, privacyResult.tags));
    addLog(LogType.INFO, 'Tags saved', { url, tags: privacyResult.tags });
  }

  // Save AI summary
  if (privacyResult?.summary) {
    await save('aiSummary', setUrlAiSummary(url, privacyResult.summary));
    addLog(LogType.INFO, 'AI summary saved', { url });
  }

  // Save tokens
  if (privacyResult?.originalTokens !== undefined) {
    await save('originalTokens', setUrlOriginalTokens(url, privacyResult.originalTokens));
  }
  if (privacyResult?.cleansedTokens !== undefined) {
    await save('cleansedTokens', setUrlCleansedTokens(url, privacyResult.cleansedTokens));
  }

  // Save bytes
  if (pageBytes !== undefined) {
    await save('pageBytes', setUrlPageBytes(url, pageBytes));
  }
  if (candidateBytes !== undefined) {
    await save('candidateBytes', setUrlCandidateBytes(url, candidateBytes));
  }
  if (originalBytes !== undefined) {
    await save('originalBytes', setUrlOriginalBytes(url, originalBytes));
  }
  if (cleansedBytes !== undefined) {
    await save('cleansedBytes', setUrlCleansedBytes(url, cleansedBytes));
  }
  if (aiSummaryOriginalBytes !== undefined) {
    await save('aiSummaryOriginalBytes', setUrlAiSummaryOriginalBytes(url, aiSummaryOriginalBytes));
  }
  if (aiSummaryCleansedBytes !== undefined) {
    await save('aiSummaryCleansedBytes', setUrlAiSummaryCleansedBytes(url, aiSummaryCleansedBytes));
  }
  if (aiSummaryCleansedElements !== undefined) {
    await save('aiSummaryCleansedElements', setUrlAiSummaryCleansedElements(url, aiSummaryCleansedElements));
  }
  if (aiSummaryCleansedReason !== undefined) {
    await save('aiSummaryCleansedReason', setUrlAiSummaryCleansedReason(url, aiSummaryCleansedReason as AiSummaryCleansedReason));
  }
  if (aiSummaryCleansedReasons !== undefined && aiSummaryCleansedReasons.length > 0) {
    await save('aiSummaryCleansedReasons', setUrlAiSummaryCleansedReasons(url, aiSummaryCleansedReasons));
  }
  await save('fallbackTriggered', setUrlFallbackTriggered(url, !!fallbackTriggered));

  // Save AI token counts from PrivacyPipeline result (new: tokens were lost during C3 refactoring)
  if (privacyResult?.sentTokens !== undefined) {
    await save('sentTokens', setUrlSentTokens(url, privacyResult.sentTokens));
  }
  if (privacyResult?.receivedTokens !== undefined) {
    await save('receivedTokens', setUrlReceivedTokens(url, privacyResult.receivedTokens));
  }
  if (privacyResult?.providerName !== undefined) {
    await save('aiProvider', setUrlAiProvider(url, privacyResult.providerName));
  }
  if (privacyResult?.modelName !== undefined) {
    await save('aiModel', setUrlAiModel(url, privacyResult.modelName));
  }

  // Save L0 extracted sentences bytes (if L0 extraction was used)
  if (extractedSentencesBytes !== undefined) {
    await save('extractedSentencesBytes', setUrlExtractedSentencesBytes(url, extractedSentencesBytes));
  }
  if (extractedSentencesOriginalBytes !== undefined) {
    await save('extractedSentencesOriginalBytes', setUrlExtractedSentencesOriginalBytes(url, extractedSentencesOriginalBytes));
  }

  // Save AI processing duration
  if (aiDuration !== undefined) {
    await save('aiDuration', setUrlAiDuration(url, aiDuration));
  }

  // Save Obsidian save duration
  if (obsidianDuration !== undefined) {
    await save('obsidianDuration', setUrlObsidianDuration(url, obsidianDuration));
  }

  // Log summary
  if (results.failed.length > 0) {
    addLog(LogType.WARN, 'Some metadata failed to save', {
      url,
      success: results.success.length,
      failed: results.failed.length,
      failedItems: results.failed
    });
  }

  return context;
};
