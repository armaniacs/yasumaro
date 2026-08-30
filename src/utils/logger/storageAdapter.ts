import type { LogEntry } from './types.js';
import { runSerialized } from '../keySerializer.js';

const LOG_STORAGE_KEY = 'sanitization_logs';
const RETENTION_DAYS = 3;
const MAX_LOGS = 500;

export interface LogStorageAdapter {
  append(entries: LogEntry[]): Promise<void>;
  load(): Promise<LogEntry[]>;
  clear(): Promise<void>;
}

function pruneLogs(logs: LogEntry[]): LogEntry[] {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return logs.filter((log) => log.timestamp > cutoff);
}

/** Chrome runtime implementation — uses chrome.storage.local */
export class ChromeStorageLogAdapter implements LogStorageAdapter {
  async append(entries: LogEntry[]): Promise<void> {
    // Serialize the read->append->prune->write region so a concurrent
    // append() from another execution context cannot slot its own
    // read+write between ours and drop entries (VULN-050). The key
    // serializer is microtask-based and logger-independent, avoiding the
    // optimisticLock -> logger import cycle.
    await runSerialized(`logadapter:${LOG_STORAGE_KEY}`, async () => {
      const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
      let logs: LogEntry[] = (storage[LOG_STORAGE_KEY] as LogEntry[]) || [];
      logs.push(...entries);
      logs = pruneLogs(logs);
      if (logs.length > MAX_LOGS) logs = logs.slice(logs.length - MAX_LOGS);
      await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
    });
  }

  async load(): Promise<LogEntry[]> {
    const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
    return (storage[LOG_STORAGE_KEY] as LogEntry[]) || [];
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(LOG_STORAGE_KEY);
  }
}

/** Test fake — keeps everything in a plain array */
export class InMemoryLogAdapter implements LogStorageAdapter {
  private logs: LogEntry[] = [];

  async append(entries: LogEntry[]): Promise<void> {
    this.logs.push(...entries);
    this.logs = pruneLogs(this.logs);
    if (this.logs.length > MAX_LOGS) this.logs = this.logs.slice(this.logs.length - MAX_LOGS);
  }

  async load(): Promise<LogEntry[]> {
    return [...this.logs];
  }

  async clear(): Promise<void> {
    this.logs = [];
  }
}
