/**
 * retryPendingWrites.ts
 * Extracted from service-worker.ts (PBI-05).
 * Retries failed Chrome storage writes (legacy SavedUrlEntry and metadata patches).
 */

import { withOptimisticLock } from '../utils/optimisticLock.js';
import type { SavedUrlEntry } from '../utils/urlEntry.js';
import { saveSavedUrlEntryMetadata } from '../utils/storage/savedUrlRepository.js';
import type { QueuedChromeStorageWrite, PendingMetadataPatchWrite } from './pendingChromeStorageQueue.js';
import { logWarn } from '../utils/logger.js';
import { pickDefined } from '../utils/objectUtils.js';

export async function retryPendingChromeStorageWrite(write: QueuedChromeStorageWrite): Promise<boolean> {
  // Legacy payload: a whole SavedUrlEntry queued by older versions.
  if (!('type' in write)) {
    if (write.key !== 'savedUrlsWithTimestamps') return false;
    try {
      const entry = write.value as SavedUrlEntry;
      await withOptimisticLock<SavedUrlEntry[]>('savedUrlsWithTimestamps', (current) => {
        const list = current || [];
        const idx = list.findIndex((e) => e.url === entry.url);
        if (idx >= 0) return list.map((e, i) => (i === idx ? { ...e, timestamp: entry.timestamp } : e));
        return [...list, entry];
      });
      return true;
    } catch {
      return false;
    }
  }

  // Metadata-patch payload: replay the same atomic save that failed originally.
  if (write.key !== 'savedUrlsWithTimestamps') return false;
  try {
    if ((write as PendingMetadataPatchWrite).contentOmitted) {
      logWarn('Retrying metadata patch without content (omitted due to size)', { url: write.url });
    }
    await saveSavedUrlEntryMetadata(write.url, write.patch, pickDefined({
      refreshTimestamp: write.refreshTimestamp,
      mergeTags: write.mergeTags,
      timestamp: write.timestamp,
    }));
    return true;
  } catch {
    return false;
  }
}
