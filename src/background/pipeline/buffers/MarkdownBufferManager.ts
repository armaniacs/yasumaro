export interface MarkdownEntry {
  url: string;
  title: string;
  visitedAt: number;
  markdown: string;
}

const DEFAULT_STORAGE_PREFIX = 'local_export_';
const DEFAULT_DAILY_FLUSH_ALARM = 'yasumaro-local-md-daily';

export class MarkdownBufferManager {
  private buffer: MarkdownEntry[] = [];
  private readonly storagePrefix: string;

  constructor(storagePrefix?: string) {
    this.storagePrefix = storagePrefix ?? DEFAULT_STORAGE_PREFIX;
  }

  add(entry: MarkdownEntry): void {
    this.buffer.push(entry);
  }

  get count(): number {
    return this.buffer.length;
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const date = getTodayDateString();
    const storageKey = `${this.storagePrefix}${date}`;

    const stored = await chrome.storage.local.get(storageKey);
    const existing: MarkdownEntry[] = Array.isArray(stored[storageKey]) ? stored[storageKey] : [];

    const merged = existing.concat(this.buffer);
    await chrome.storage.local.set({ [storageKey]: merged });

    this.buffer = [];
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
