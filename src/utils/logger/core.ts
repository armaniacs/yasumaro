/**
 * logger/core.ts
 * Orchestrator for log recording. Delegates buffering, sanitization, storage,
 * and flush scheduling to focused modules under src/utils/logger/.
 *
 * External interface (addLog / getLogs / clearLogs / flushLogs) is unchanged.
 * Storage + scheduler arrive via LoggerWiring (initLogger; lazy chrome
 * default in production, in-memory in tests) — core never hard-wires chrome.*.
 */
import { sanitizeRegex } from '../piiSanitizer.js';
import { neutralizeLogText } from './neutralize.js';
import { LogBuffer } from './buffer.js';
import { sanitizeLogDetails } from './sanitize.js';
import { ChromeStorageLogAdapter, type LogStorageAdapter } from './storageAdapter.js';
import { ChromeAlarmFlushScheduler, type LogFlushScheduler } from './flushScheduler.js';
import { LogEntry, LogTypeValues } from './types.js';
import { pickDefined } from '../objectUtils.js';

const MAX_PENDING_LOGS = 100;
const BATCH_FLUSH_SIZE = 10;

const buffer = new LogBuffer(MAX_PENDING_LOGS);

/**
 * Logger wiring — the adapter + scheduler behind the seam.
 * Production uses the lazy chrome default (constructed on first use, never at
 * import time, so importing core never touches chrome.*). Tests inject
 * in-memory wiring via initLogger() and exercise the full interface without
 * any chrome mock.
 */
export interface LoggerWiring {
  storage: LogStorageAdapter;
  scheduler: LogFlushScheduler;
}

let wiring: LoggerWiring | null = null;

function ensureWiring(): LoggerWiring {
  if (!wiring) {
    wiring = {
      storage: new ChromeStorageLogAdapter(),
      scheduler: new ChromeAlarmFlushScheduler(),
    };
    wiring.scheduler.onFlushRequested(() => persistPending());
  }
  return wiring;
}

/**
 * Inject logger wiring. Production never calls this (the lazy chrome default
 * applies); tests pass InMemoryLogAdapter + ImmediateFlushScheduler.
 */
export function initLogger(next: LoggerWiring): void {
  wiring = next;
  wiring.scheduler.onFlushRequested(() => persistPending());
}

/** Drop injected wiring (test isolation). Next use rebuilds the default. */
export function resetLoggerWiring(): void {
  wiring = null;
}

let isFlushing = false;

async function persistPending(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const entries = buffer.drain();
    if (entries.length === 0) return;

    // No chrome check here: the chrome adapter owns the offscreen console
    // fallback, so in-memory wiring persists with no chrome at all.
    await ensureWiring().storage.append(entries);
  } catch (e) {
    console.error('Logger: Failed to flush logs', e);
  } finally {
    // A scheduled alarm may still be pending even though we just flushed
    // (e.g. addLog reached BATCH_FLUSH_SIZE before the alarm fired). Clear
    // it so it doesn't fire again later and run an unnecessary empty flush.
    ensureWiring().scheduler.clear();
    isFlushing = false;
  }
}

export async function addLog<T extends object = Record<string, unknown>>(
  type: LogTypeValues,
  message: string,
  details: T = {} as T,
): Promise<void> {
  try {
    if (!isDevelopment() && type === 'DEBUG') {
      return;
    }

    // Order: PII mask first (matches on original text), then neutralize control
    // bytes / ANSI / line breaks in the persisted result. See neutralize.ts.
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
      message: neutralizeLogText(
        sanitizedMessage.maskedItems.length > 0 ? sanitizedMessage.text : message,
      ),
      details: await sanitizeLogDetails(restDetails),
      ...pickDefined({ traceId }),
    };

    buffer.push(entry);

    if (buffer.size() >= BATCH_FLUSH_SIZE) {
      await persistPending();
    } else {
      ensureWiring().scheduler.schedule();
    }
  } catch (e) {
    console.error('Logger: Failed to save log', e);
  }
}

export async function flushLogs(_immediate: boolean = false): Promise<void> {
  await persistPending();
}

export async function getLogs(): Promise<LogEntry[]> {
  const stored = await ensureWiring().storage.load();
  return [...stored, ...buffer.peek()];
}

export async function clearLogs(): Promise<void> {
  buffer.clear();
  await ensureWiring().storage.clear();
  ensureWiring().scheduler.clear();
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
