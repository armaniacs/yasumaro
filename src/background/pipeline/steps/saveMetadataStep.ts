/**
 * Save metadata step
 * Step 9: Save all metadata to storage (best effort)
 */

import { addLog, LogType } from '../../../utils/logger.js';
import type { RecordType } from '../../../messaging/types.js';
import type { AiSummaryCleansedReason } from '../../../utils/storageUrls.js';
import {
  setSavedUrlsWithTimestamps,
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
  getSavedUrlsWithTimestamps
} from '../../../utils/storageUrls.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Save all metadata to storage
 * This step uses BEST_EFFORT error strategy - try to save as much as possible
 */
export const saveMetadataStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, privacyResult } = context;
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
    aiSummaryCleansedReason
  } = data;

  const results: { success: string[]; failed: string[] } = { success: [], failed: [] };

  // Helper to track results
  const save = async (name: string, promise: Promise<void>): Promise<void> => {
    try {
      await promise;
      results.success.push(name);
    } catch (error: any) {
      results.failed.push(name);
      addLog(LogType.WARN, `Failed to save ${name}`, { error: error.message, url });
    }
  };

  // Update saved URLs timestamp
  const urlMap = await getSavedUrlsWithTimestamps();
  urlMap.set(url, Date.now());
  await save('urlTimestamp', setSavedUrlsWithTimestamps(urlMap, url));

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
  if (privacyResult?.sentTokens !== undefined) {
    await save('sentTokens', setUrlSentTokens(url, privacyResult.sentTokens));
  }
  if (privacyResult?.receivedTokens !== undefined) {
    await save('receivedTokens', setUrlReceivedTokens(url, privacyResult.receivedTokens));
  }
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
