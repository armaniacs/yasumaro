/**
 * Save metadata step
 * Step 9: Save all metadata to storage (best effort)
 *
 * The URL entry's timestamp and every metadata field are committed in ONE
 * atomic operation (saveSavedUrlEntryMetadata) instead of one storage write
 * per field. On failure the metadata patch is queued (PBI-13) so the whole
 * save can be replayed later rather than leaving partial fields.
 */

import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
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
  // Regenerate overwrites tags in SQLite — the legacy mirror must replace
  // (not union) to stay consistent; normal records keep the accumulate merge.
  const mergeTags = context.data.targetEntryId === undefined;
  // PBI 2026-09-22-04: toMetadataPatch omits empty tag lists, but a regenerate
  // with zero tags must CLEAR the mirror too (the SQLite UPDATE just nulled
  // them) — emit an explicit empty list so the replace branch deletes them.
  if (context.data.targetEntryId !== undefined && !patch.tags) {
    patch.tags = [];
  }

  const timestamp = Date.now();
  try {
    await saveSavedUrlEntryMetadata(common.url, patch, { mergeTags, timestamp });
    addLog(LogType.INFO, 'Saved URL entry metadata', { url: common.url, traceId: context.traceId });
  } catch (error: unknown) {
    addLog(LogType.WARN, 'Failed to save URL entry metadata', {
      error: errorMessage(error), url: common.url, traceId: context.traceId
    });
    const queued = await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: common.url,
      patch,
      refreshTimestamp: false,
      timestamp,
      mergeTags,
      createdAt: Date.now(),
      retryCount: 0,
    });
    if (!queued) {
      // Double failure: the primary save failed and even the fallback queue
      // could not persist the patch. Report it instead of pretending the
      // metadata survived; the original WARN above stays the root cause.
      addLog(LogType.ERROR, 'Failed to queue metadata patch for retry', {
        url: common.url, traceId: context.traceId
      });
    }
  }

  return context;
};
