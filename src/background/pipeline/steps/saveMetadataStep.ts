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
import { StorageKeys } from '../../../utils/storage/types.js';
import { saveSavedUrlEntryMetadata } from '../../../utils/storage/savedUrlRepository.js';
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
  const patch = common.toMetadataPatch();

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
