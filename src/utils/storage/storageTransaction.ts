// @layer 1 — Infrastructure: StorageTransaction deep module
/**
 * StorageTransaction — deep module hiding serialized CAS + versioning + post-write verification.
 *
 * Single seam for all storage read-modify-write: `withLock` (single key) and `withAtomic` (multi-key).
 * Internally owns key-granular serialization (microtask chain), versioned CAS, canonical equality,
 * and post-write verification (always on). Callers learn 2 methods; all 4 subsystems share one fix.
 *
 * Why microtask-only: timer-backed mutex does not progress under vi.useFakeTimers().
 * Why logger-independent: optimisticLock -> logger -> storageAdapter cycle is broken by keeping this free of logger barrel
 *         (logDebug is still used for retry diagnostics but not required for serialization).
 */

import type { StoragePort } from './storagePort.js';
import { ChromeStoragePort } from './storagePort.js';
import { backoffDelayMs } from '../backoff.js';
import { waitForRetry, type SleepFn } from '../retryPredicate.js';

// Lightweight debug helper — avoids importing logger to break the
// storageAdapter -> transaction -> logger -> storageAdapter cycle.
// keySerializer was deliberately logger-free for the same reason.
function logDebug(_msg: string, _data: unknown, _file: string): void {
  // no-op in production; tests can spy on console if needed
}

// ---------------------------------------------------------------------------
// Internal seam: key-granular serialization (microtask chain)
// ---------------------------------------------------------------------------

type ChainMap = Map<string, Promise<void>>;

const chains: ChainMap = new Map();

function runSerialized<R>(key: string, fn: () => Promise<R>): Promise<R> {
  const prev = chains.get(key);
  // Intentional promise chain: serializes per-key writes so concurrent callers
  // run one-at-a-time. Do not rewrite to await; the chain is the mutex.
  const run: Promise<R> = prev === undefined ? (async () => fn())() : prev.then(fn, fn);
  const settled: Promise<void> = run.then(() => undefined, () => undefined);
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}

function runSerializedMulti<R>(keys: readonly string[], fn: () => Promise<R>): Promise<R> {
  const ordered = [...new Set(keys)].sort();
  if (ordered.length === 0) return fn();
  const acquireFrom = (index: number): Promise<R> => {
    if (index >= ordered.length) return fn();
    return runSerialized(ordered[index] as string, () => acquireFrom(index + 1));
  };
  return acquireFrom(0);
}

// Test-only seam to drop chain bookkeeping (replaces keySerializer's _resetKeySerializerForTest)
export function __resetStorageTransactionForTest(): void {
  chains.clear();
}

// Keep legacy name for existing tests that import from keySerializer shim
export const _resetKeySerializerForTest = __resetStorageTransactionForTest;

// Legacy re-exports for shim compatibility — new code should use StorageTransaction
export { runSerialized, runSerializedMulti };

// ---------------------------------------------------------------------------
// Conflict + helpers
// ---------------------------------------------------------------------------

const INITIAL_VERSION = 0;

export class ConflictError extends Error {
  constructor(key: string, expectedVersion: number, actualVersion: number) {
    super(`Conflict detected for key: ${key} (expected: ${expectedVersion}, actual: ${actualVersion})`);
    this.name = 'ConflictError';
    Object.defineProperty(this, 'key', { value: key, enumerable: true });
    Object.defineProperty(this, 'expectedVersion', { value: expectedVersion, enumerable: true });
    Object.defineProperty(this, 'actualVersion', { value: actualVersion, enumerable: true });
  }
}

function canonicalStringify(value: unknown): string {
  const cloned = structuredClone(value);
  return JSON.stringify(cloned, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((sorted: Record<string, unknown>, k) => {
          sorted[k] = (val as Record<string, unknown>)[k];
          return sorted;
        }, {});
    }
    return val;
  });
}

/**
 * Canonical value equality (key-order independent). Exported because the
 * settings migration re-reads a legacy key right before deleting it and must
 * decide "did the value change" with the same semantics the CAS uses.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}

// ---------------------------------------------------------------------------
// Shared CAS retry shell + post-write verification
// ---------------------------------------------------------------------------

export interface CasRetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  /**
   * Injected retry wait. Defaults to a real timer; a test that needs to count
   * attempts passes a recorder so it never spends wall time sleeping.
   */
  sleep?: SleepFn;
}

/** Per-method differences of the retry shell; the discipline itself is shared. */
interface CasRetryShell {
  /** Log label of the calling method, and the identity of the fallback error. */
  label: string;
  /** Key identity reported by the budget-exhausted ConflictError. */
  conflictKey: string;
  maxRetries: number;
  initialDelay: number;
  sleep: SleepFn;
  /**
   * Retry-log payload. Each method builds its own because the two name the
   * attempt field differently (`attemptCount` / `attempt`) and the payload is
   * part of the log contract, not just diagnostics.
   */
  retryLogData: (attempt: number, delay: number) => Record<string, unknown>;
  /**
   * Unreachable at runtime: the budget-exhausted check throws before the loop
   * can exit. Kept so the tail throw closes the last path of `Promise<R>`
   * (TypeScript cannot statically prove the loop always returns or throws)
   * and names the calling method in the otherwise-impossible fallback error.
   */
  fallbackMessage: string;
}

/**
 * The single retry discipline behind both transaction shapes: a ConflictError
 * is retried on the same exponential backoff series, any other error is logged
 * and rethrown untouched, and exhausting the budget raises
 * `ConflictError(conflictKey, -1, -1)`. `withLock` and `withAtomic` differ only
 * in the work they run per attempt and in the fields they log.
 */
async function runCasRetryLoop<R>(runAttempt: () => Promise<R>, shell: CasRetryShell): Promise<R> {
  const { maxRetries, initialDelay, sleep, conflictKey, label } = shell;
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= maxRetries) {
    try {
      return await runAttempt();
    } catch (error) {
      const err = error as Error;
      if (!(error instanceof ConflictError)) {
        logDebug(`${label} error`, { error: err.message, stack: err.stack }, 'storageTransaction.ts');
        throw error;
      }
      lastError = err;
      attempt++;
      if (attempt > maxRetries) throw new ConflictError(conflictKey, -1, -1);
      const delay = backoffDelayMs(attempt - 1, { baseMs: initialDelay });
      await sleep(delay);
      logDebug(`${label} retrying`, shell.retryLogData(attempt, delay), 'storageTransaction.ts');
    }
  }
  throw lastError || new Error(shell.fallbackMessage);
}

/**
 * Post-write verification — always on, for single-key and multi-key alike. The
 * re-read is what turns "the write returned" into "the write is still there
 * when the caller resumes": a writer that lost the key in between shows up as
 * a version or value mismatch, reported as a ConflictError so the retry shell
 * re-reads and re-derives instead of reporting a lost update as committed.
 *
 * Contract limitation: version keys are derived as `${key}_version`, so a key
 * that itself ends in `_version` (e.g. `withAtomic(['foo', 'foo_version'])`)
 * collides the two key sets and the per-key loop below reads a version of a
 * version — behavior for such keys is accidental, not designed. Callers pass
 * only repository keys (savedUrls / savedUrlsWithTimestamps); keep data keys
 * free of the `_version` suffix.
 */
async function verifyPostWrite(
  port: StoragePort,
  keys: readonly string[],
  expectedValues: readonly unknown[],
  expectedVersions: readonly number[]
): Promise<void> {
  const postWriteResult = await port.get([...keys, ...keys.map((k) => `${k}_version`)]);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as string;
    const postVersion = (postWriteResult[`${key}_version`] as number) ?? INITIAL_VERSION;
    const postValue = postWriteResult[key];
    if (postVersion !== expectedVersions[i] || !deepEqual(postValue, expectedValues[i])) {
      throw new ConflictError(key, expectedVersions[i] ?? -1, postVersion);
    }
  }
}

// ---------------------------------------------------------------------------
// Port resolution — default is ChromeStoragePort wrapping chrome.storage.local
// ---------------------------------------------------------------------------

const defaultPort = new ChromeStoragePort();

// ---------------------------------------------------------------------------
// StorageTransaction class — the deep module itself (2 methods)
// ---------------------------------------------------------------------------

export class StorageTransaction {
  constructor(private readonly port: StoragePort = defaultPort) {}

  /**
   * Serialized read-modify-write with versioned CAS + retry.
   *
   * Contract: `updateFn` MUST be pure and idempotent. On a write conflict
   * (ConflictError) the whole read-modify-write cycle is retried, which
   * re-invokes `updateFn` with the latest value — a non-idempotent updater
   * (e.g. one that appends a generated id or increments a counter blindly)
   * would apply its side effect twice. Keep updaters to pure functions of
   * their input (e.g. `(cur) => [...(cur ?? []), item]` with a stable item).
   *
   * Note (deliberately unchanged): the pre-write value check inside
   * `performCasUpdate` compares only primitive values (`typeof currentValue
   * !== 'object'` skips the comparison for objects); object conflicts are
   * detected by the version check, not by value equality. Do not "fix" this
   * by switching the CAS to deep-equal without a reviewed design — the
   * storage layer treats the version as the conflict signal.
   */
  async withLock<T>(
    key: string,
    updateFn: (currentValue: T) => T,
    options: CasRetryOptions = {}
  ): Promise<T> {
    const { maxRetries = 5, initialDelay = 100, sleep = waitForRetry } = options;
    const port = this.port;

    return runCasRetryLoop(
      async () => {
        const result = await port.get([key, `${key}_version`]);
        const currentValue = result[key] as T;
        const currentVersion = (result[`${key}_version`] as number) ?? INITIAL_VERSION;
        const newValue = updateFn(currentValue);
        const newVersion = currentVersion + 1;

        await runSerialized(key, () => performCasUpdate(port, key, currentValue, newValue, currentVersion, newVersion));
        return newValue;
      },
      {
        label: 'withOptimisticLock',
        conflictKey: key,
        maxRetries,
        initialDelay,
        sleep,
        retryLogData: (attempt, delay) => ({ key, attemptCount: attempt, maxRetries, delay }),
        fallbackMessage: 'Unexpected error in withLock',
      }
    );
  }

  async withAtomic<T extends readonly unknown[]>(
    keys: { [K in keyof T]: string },
    updater: (currentValues: { [K in keyof T]: T[K] }) => { [K in keyof T]: T[K] },
    options: CasRetryOptions = {}
  ): Promise<{ [K in keyof T]: T[K] }> {
    const { maxRetries = 5, initialDelay = 100, sleep = waitForRetry } = options;
    const keyList = keys as readonly string[];
    const versionKeys = keyList.map((k) => `${k}_version`);
    const conflictKey = keyList.join('+');
    const port = this.port;

    return runCasRetryLoop(
      async () => {
        const result = await port.get([...keyList, ...versionKeys]);
        const currentValues = keyList.map((k) => result[k]) as { [K in keyof T]: T[K] };
        const currentVersions = keyList.map((k) => (result[`${k}_version`] as number) ?? INITIAL_VERSION);
        const newValues = updater(currentValues);
        const newVersions = currentVersions.map((v) => v + 1);

        return await runSerializedMulti(keyList, async () => {
          const verifyResult = await port.get([...keyList, ...versionKeys]);
          const verifyVersions = keyList.map((k) => (verifyResult[`${k}_version`] as number) ?? INITIAL_VERSION);
          const conflictIndex = verifyVersions.findIndex((v, i) => v !== currentVersions[i]);
          if (conflictIndex !== -1) {
            throw new ConflictError(conflictKey, currentVersions[conflictIndex] ?? -1, verifyVersions[conflictIndex] ?? -1);
          }
          const writePayload: Record<string, unknown> = {};
          keyList.forEach((k, i) => {
            writePayload[k] = newValues[i];
            writePayload[`${k}_version`] = newVersions[i];
          });
          await port.set(writePayload);

          await verifyPostWrite(port, keyList, newValues, newVersions);
          return newValues;
        });
      },
      {
        label: 'withAtomicKeys',
        conflictKey,
        maxRetries,
        initialDelay,
        sleep,
        retryLogData: (attempt, delay) => ({ keys, attempt, maxRetries, delay }),
        fallbackMessage: 'Unexpected error in withAtomic',
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Functional wrappers (default port) — for callers that don't inject a port
// ---------------------------------------------------------------------------

const defaultTransaction = new StorageTransaction(defaultPort);

export function withOptimisticLock<T>(
  key: string,
  updateFn: (currentValue: T) => T,
  options: CasRetryOptions = {}
): Promise<T> {
  return defaultTransaction.withLock(key, updateFn, options);
}

export function withAtomicKeys<T extends readonly unknown[]>(
  keys: { [K in keyof T]: string },
  updater: (currentValues: { [K in keyof T]: T[K] }) => { [K in keyof T]: T[K] },
  options: CasRetryOptions = {}
): Promise<{ [K in keyof T]: T[K] }> {
  return defaultTransaction.withAtomic(keys, updater, options);
}


// ---------------------------------------------------------------------------
// Internal CAS helper (port-aware)
// ---------------------------------------------------------------------------

async function performCasUpdate<T>(
  port: StoragePort,
  key: string,
  currentValue: T,
  newValue: T,
  currentVersion: number,
  newVersion: number
): Promise<void> {
  const verifyResult = await port.get([key, `${key}_version`]);
  const verifyVersion = (verifyResult[`${key}_version`] as number) ?? INITIAL_VERSION;
  const verifyValue = verifyResult[key] as T;

  if (verifyVersion !== currentVersion) throw new ConflictError(key, currentVersion, verifyVersion);

  if (currentValue !== undefined && currentValue !== null && typeof currentValue !== 'object' && currentValue !== verifyValue) {
    throw new ConflictError(key, currentVersion, verifyVersion);
  }

  await port.set({ [key]: newValue, [`${key}_version`]: newVersion });

  // post-write verification always enabled — closes TOCTOU window
  await verifyPostWrite(port, [key], [newValue], [newVersion]);
}

// Re-export for tests that import ConflictError from optimisticLock shim
export { performCasUpdate as __performCasUpdateForTest };
