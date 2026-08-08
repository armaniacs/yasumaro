/**
 * Save metadata step
 * Step 9: Save all metadata to storage (best effort)
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { withOptimisticLock } from '../../../utils/optimisticLock.js';
import { enqueuePendingWrite } from '../../pendingChromeStorageQueue.js';
import type { RecordType, AiSummaryCleansedReason } from '../../../utils/commonTypes.js';
import type { SavedUrlEntry } from '../../../utils/urlEntry.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { updateSavedUrlEntry, setUrlTags, addUrlTag, removeUrlTag } from '../../../utils/storage/savedUrlStore.js';
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
        error: errorMessage(error), url, traceId: context.traceId
      });
      // PBI-13: retry via pendingChromeStorageQueue instead of dropping the write
      await enqueuePendingWrite({
        key: 'savedUrlsWithTimestamps',
        value: { url, title: data.title || '', timestamp: Date.now() },
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
      addLog(LogType.WARN, `Failed to save ${name}`, { error: errorMessage(error), url, traceId: context.traceId });
    }
  };

  // Save record type
  const resolvedRecordType: RecordType = (recordType as RecordType) ?? 'auto';
  await save('recordType', updateSavedUrlEntry(url, (entry) => ({ ...entry, recordType: resolvedRecordType })));

  // Save masked count
  const resolvedMaskedCount = precomputedMaskedCount ?? privacyResult?.maskedCount ?? 0;
  if (resolvedMaskedCount > 0) {
    await save('maskedCount', updateSavedUrlEntry(url, (entry) => ({ ...entry, maskedCount: resolvedMaskedCount })));
  }

  // Save content
  if (content) {
    await save('content', updateSavedUrlEntry(url, (entry) => ({ ...entry, content })));
  }

  // Save tags
  if (privacyResult?.tags && privacyResult.tags.length > 0) {
    await save('tags', addUrlTag(url, privacyResult.tags[0]));
    for (let i = 1; i < privacyResult.tags.length; i++) {
      await save(`tags-${i}`, addUrlTag(url, privacyResult.tags[i]));
    }
    addLog(LogType.INFO, 'Tags saved', { url, tags: privacyResult.tags, traceId: context.traceId });
  }

  // Save AI summary
  if (privacyResult?.summary) {
    await save('aiSummary', updateSavedUrlEntry(url, (entry) => ({ ...entry, aiSummary: privacyResult.summary })));
    addLog(LogType.INFO, 'AI summary saved', { url, traceId: context.traceId });
  }

  // Save tokens
  if (privacyResult?.originalTokens !== undefined) {
    await save('originalTokens', updateSavedUrlEntry(url, (entry) => ({ ...entry, originalTokens: privacyResult.originalTokens })));
  }
  if (privacyResult?.cleansedTokens !== undefined) {
    await save('cleansedTokens', updateSavedUrlEntry(url, (entry) => ({ ...entry, cleansedTokens: privacyResult.cleansedTokens })));
  }

  // Save bytes
  if (pageBytes !== undefined) {
    await save('pageBytes', updateSavedUrlEntry(url, (entry) => ({ ...entry, pageBytes })));
  }
  if (candidateBytes !== undefined) {
    await save('candidateBytes', updateSavedUrlEntry(url, (entry) => ({ ...entry, candidateBytes })));
  }
  if (originalBytes !== undefined) {
    await save('originalBytes', updateSavedUrlEntry(url, (entry) => ({ ...entry, originalBytes })));
  }
  if (cleansedBytes !== undefined) {
    await save('cleansedBytes', updateSavedUrlEntry(url, (entry) => ({ ...entry, cleansedBytes })));
  }
  if (aiSummaryOriginalBytes !== undefined) {
    await save('aiSummaryOriginalBytes', updateSavedUrlEntry(url, (entry) => ({ ...entry, aiSummaryOriginalBytes })));
  }
  if (aiSummaryCleansedBytes !== undefined) {
    await save('aiSummaryCleansedBytes', updateSavedUrlEntry(url, (entry) => ({ ...entry, aiSummaryCleansedBytes })));
  }
  if (aiSummaryCleansedElements !== undefined) {
    await save('aiSummaryCleansedElements', updateSavedUrlEntry(url, (entry) => ({ ...entry, aiSummaryCleansedElements })));
  }
  if (aiSummaryCleansedReason !== undefined) {
    await save('aiSummaryCleansedReason', updateSavedUrlEntry(url, (entry) => ({ ...entry, aiSummaryCleansedReason: aiSummaryCleansedReason as AiSummaryCleansedReason })));
  }
  if (aiSummaryCleansedReasons !== undefined && aiSummaryCleansedReasons.length > 0) {
    await save('aiSummaryCleansedReasons', updateSavedUrlEntry(url, (entry) => ({ ...entry, aiSummaryCleansedReasons })));
  }
  await save('fallbackTriggered', updateSavedUrlEntry(url, (entry) => ({ ...entry, fallbackTriggered: !!fallbackTriggered })));

  // Save AI token counts from PrivacyPipeline result (new: tokens were lost during C3 refactoring)
  if (privacyResult?.sentTokens !== undefined) {
    await save('sentTokens', updateSavedUrlEntry(url, (entry) => ({ ...entry, sentTokens: privacyResult.sentTokens })));
  }
  if (privacyResult?.receivedTokens !== undefined) {
    await save('receivedTokens', updateSavedUrlEntry(url, (entry) => ({ ...entry, receivedTokens: privacyResult.receivedTokens })));
  }
  if (privacyResult?.providerName !== undefined) {
    await save('aiProvider', updateSavedUrlEntry(url, (entry) => ({ ...entry, aiProvider: privacyResult.providerName })));
  }
  if (privacyResult?.modelName !== undefined) {
    await save('aiModel', updateSavedUrlEntry(url, (entry) => ({ ...entry, aiModel: privacyResult.modelName })));
  }
  if (privacyResult?.mode !== undefined) {
    await save('privacyMode', updateSavedUrlEntry(url, (entry) => ({ ...entry, privacyMode: privacyResult.mode })));
  }

  // Save L0 extracted sentences bytes (if L0 extraction was used)
  if (extractedSentencesBytes !== undefined) {
    await save('extractedSentencesBytes', updateSavedUrlEntry(url, (entry) => ({ ...entry, extractedSentencesBytes })));
  }
  if (extractedSentencesOriginalBytes !== undefined) {
    await save('extractedSentencesOriginalBytes', updateSavedUrlEntry(url, (entry) => ({ ...entry, extractedSentencesOriginalBytes })));
  }

  // Save AI processing duration
  if (aiDuration !== undefined) {
    await save('aiDuration', updateSavedUrlEntry(url, (entry) => ({ ...entry, aiDuration })));
  }

  // Save Obsidian save duration
  if (obsidianDuration !== undefined) {
    await save('obsidianDuration', updateSavedUrlEntry(url, (entry) => ({ ...entry, obsidianDuration })));
  }

  // Log summary
  if (results.failed.length > 0) {
    addLog(LogType.WARN, 'Some metadata failed to save', {
      url,
      success: results.success.length,
      failed: results.failed.length,
      failedItems: results.failed,
      traceId: context.traceId
    });
  }

  return context;
};
