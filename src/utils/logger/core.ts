/**
 * logger/core.ts
 * Orchestrator for log recording. Delegates buffering, sanitization, storage,
 * and flush scheduling to focused modules under src/utils/logger/.
 *
 * External interface (addLog / getLogs / clearLogs / flushLogs) is unchanged.
 */
import { sanitizeRegex } from '../piiSanitizer.js';
import { LogBuffer } from './buffer.js';
import { sanitizeLogDetails } from './sanitize.js';
import { ChromeStorageLogAdapter, type LogStorageAdapter } from './storageAdapter.js';
import { ChromeAlarmFlushScheduler, type LogFlushScheduler } from './flushScheduler.js';
import { LogEntry, LogTypeValues } from './types.js';

const MAX_PENDING_LOGS = 100;
const BATCH_FLUSH_SIZE = 10;

const buffer = new LogBuffer(MAX_PENDING_LOGS);
const storage: LogStorageAdapter = new ChromeStorageLogAdapter();
const scheduler: LogFlushScheduler = new ChromeAlarmFlushScheduler();

let isFlushing = false;

async function persistPending(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const entries = buffer.drain();
    if (entries.length === 0) return;

    // Offscreen documents cannot access chrome.storage. Mirror original
    // behavior: emit to console and discard rather than throwing.
    if (typeof chrome === 'undefined' || !chrome.storage) {
      for (const log of entries) {
        console.log(`[Logger:${log.type}] ${log.message}`, log.details || '');
      }
      return;
    }

    await storage.append(entries);
  } catch (e) {
    console.error('Logger: Failed to flush logs', e);
  } finally {
    // A scheduled alarm may still be pending even though we just flushed
    // (e.g. addLog reached BATCH_FLUSH_SIZE before the alarm fired). Clear
    // it so it doesn't fire again later and run an unnecessary empty flush.
    scheduler.clear();
    isFlushing = false;
  }
}

scheduler.onFlushRequested(() => persistPending());

export async function addLog<T extends object = Record<string, unknown>>(
  type: LogTypeValues,
  message: string,
  details: T = {} as T,
): Promise<void> {
  try {
    if (!isDevelopment() && type === 'DEBUG') {
      return;
    }

    const sanitizedMessage = await sanitizeRegex(message);
    const { traceId: traceIdValue, ...restDetails } = details as Record<string, unknown>;
    const traceId = typeof traceIdValue === 'string' ? traceIdValue : undefined;

    const entry: LogEntry = {
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : (() => {
              const a = new Uint32Array(2);
              crypto.getRandomValues(a);
              return (a[0] ?? 0).toString(36) + (a[1] ?? 0).toString(36);
            })(),
      timestamp: Date.now(),
      type,
      message: sanitizedMessage.maskedItems.length > 0 ? sanitizedMessage.text : message,
      details: await sanitizeLogDetails(restDetails),
      traceId,
    };

    buffer.push(entry);

    if (buffer.size() >= BATCH_FLUSH_SIZE) {
      await persistPending();
    } else {
      scheduler.schedule();
    }
  } catch (e) {
    console.error('Logger: Failed to save log', e);
  }
}

export async function flushLogs(_immediate: boolean = false): Promise<void> {
  await persistPending();
}

export async function getLogs(): Promise<LogEntry[]> {
  const stored = await storage.load();
  return [...stored, ...buffer.peek()];
}

export async function clearLogs(): Promise<void> {
  buffer.clear();
  await storage.clear();
  scheduler.clear();
}

export function isDevelopment(): boolean {
  if (typeof process !== 'undefined' && process.env) {
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv === 'development') return true;
    if (nodeEnv === 'production' || nodeEnv === 'test' || nodeEnv === undefined || nodeEnv === null) return false;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV === true) return true;
  return false;
}

export function getPendingLogCount(): number {
  return buffer.size();
}

export function clearPendingLogs(): void {
  buffer.clear();
}
