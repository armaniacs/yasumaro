import type { MarkdownTemplateEntryData } from '../../../utils/types.js';
import { withAtomicKeys } from '../../../utils/storage/storageTransaction.js';

export interface MarkdownEntry {
  url: string;
  title: string;
  visitedAt: number;
  entryData: MarkdownTemplateEntryData;
}

const DEFAULT_STORAGE_PREFIX = 'local_export_';
const DEFAULT_DAILY_FLUSH_ALARM = 'yasumaro-local-md-daily';

// VULN-004: cap the in-memory daily buffer so a high-traffic day cannot grow the
// eventual `local_export_YYYY-MM-DD` file without limit. When exceeded, the
// oldest buffered entries are dropped (rather than rejecting new visits): the
// most recent browsing is the more useful tail to keep in the daily summary,
// and 2000 entries/day is already far beyond normal use.
export const MAX_DAILY_BUFFER_ENTRIES = 2000;

export class MarkdownBufferManager {
  private buffer: MarkdownEntry[] = [];
  private readonly storagePrefix: string;

  constructor(storagePrefix?: string) {
    this.storagePrefix = storagePrefix ?? DEFAULT_STORAGE_PREFIX;
  }

  add(entry: MarkdownEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > MAX_DAILY_BUFFER_ENTRIES) {
      this.buffer.splice(0, this.buffer.length - MAX_DAILY_BUFFER_ENTRIES);
    }
  }

  get count(): number {
    return this.buffer.length;
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const date = getTodayDateString();
    const storageKey = `${this.storagePrefix}${date}`;

    // Capture and clear up front so entries buffered during the async flush
    // are not lost, then re-buffer this batch if the write fails (VULN-003).
    const batch = this.buffer;
    this.buffer = [];

    try {
      await withAtomicKeys<[MarkdownEntry[]]>(
        [storageKey],
        ([existing]) => {
          const base = Array.isArray(existing) ? existing : [];
          const merged = base.concat(batch);
          // VULN-004: keep the persisted daily buffer bounded too (oldest dropped).
          const capped = merged.length > MAX_DAILY_BUFFER_ENTRIES
            ? merged.slice(merged.length - MAX_DAILY_BUFFER_ENTRIES)
            : merged;
          return [capped];
        }
      );
    } catch (error) {
      this.buffer = batch.concat(this.buffer);
      throw error;
    }
  }

  scheduleDailyFlush(alarmName?: string): void {
    chrome.alarms.create(alarmName ?? DEFAULT_DAILY_FLUSH_ALARM, {
      periodInMinutes: 1440,
    });
  }
}

function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
