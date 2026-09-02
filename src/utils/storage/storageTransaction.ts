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

function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
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

  async withLock<T>(
    key: string,
    updateFn: (currentValue: T) => T,
    options: { maxRetries?: number; initialDelay?: number } = {}
  ): Promise<T> {
    const { maxRetries = 5, initialDelay = 100 } = options;
    let attemptCount = 0;
    let lastError: Error | null = null;
    const port = this.port;

    while (attemptCount <= maxRetries) {
      try {
        const result = await port.get([key, `${key}_version`]);
        const currentValue = result[key] as T;
        const currentVersion = (result[`${key}_version`] as number) ?? INITIAL_VERSION;
        const newValue = updateFn(currentValue);
        const newVersion = currentVersion + 1;

        await runSerialized(key, () => performCasUpdate(port, key, currentValue, newValue, currentVersion, newVersion));
        return newValue;
      } catch (error) {
        const err = error as Error;
        lastError = err;
        if (!(error instanceof ConflictError)) {
          logDebug('withOptimisticLock error', { error: err.message, stack: err.stack }, 'storageTransaction.ts');
          throw error;
        }
        attemptCount++;
        if (attemptCount > maxRetries) throw new ConflictError(key, -1, -1);
        const delay = initialDelay * Math.pow(2, attemptCount - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        logDebug('withOptimisticLock retrying', { key, attemptCount, maxRetries, delay }, 'storageTransaction.ts');
      }
    }
    throw lastError || new Error('Unexpected error in withLock');
  }

  async withAtomic<T extends readonly unknown[]>(
    keys: { [K in keyof T]: string },
    updater: (currentValues: { [K in keyof T]: T[K] }) => { [K in keyof T]: T[K] },
    options: { maxRetries?: number; initialDelay?: number } = {}
  ): Promise<{ [K in keyof T]: T[K] }> {
    const { maxRetries = 5, initialDelay = 100 } = options;
    const versionKeys = (keys as readonly string[]).map((k) => `${k}_version`);
    let attempt = 0;
    let lastError: Error | null = null;
    const port = this.port;

    while (attempt <= maxRetries) {
      try {
        const result = await port.get([...(keys as readonly string[]), ...versionKeys]);
        const currentValues = (keys as readonly string[]).map((k) => result[k]) as { [K in keyof T]: T[K] };
        const currentVersions = (keys as readonly string[]).map((k) => (result[`${k}_version`] as number) ?? INITIAL_VERSION);
        const newValues = updater(currentValues);
        const newVersions = currentVersions.map((v) => v + 1);

        return await runSerializedMulti(keys as readonly string[], async () => {
          const verifyResult = await port.get([...(keys as readonly string[]), ...versionKeys]);
          const verifyVersions = (keys as readonly string[]).map((k) => (verifyResult[`${k}_version`] as number) ?? INITIAL_VERSION);
          const conflictIndex = verifyVersions.findIndex((v, i) => v !== currentVersions[i]);
          if (conflictIndex !== -1) {
            throw new ConflictError((keys as readonly string[]).join('+'), currentVersions[conflictIndex] ?? -1, verifyVersions[conflictIndex] ?? -1);
          }
          const writePayload: Record<string, unknown> = {};
          (keys as readonly string[]).forEach((k, i) => {
            writePayload[k] = newValues[i];
            writePayload[`${k}_version`] = newVersions[i];
          });
          await port.set(writePayload);

          // post-write verification always on
          const postWriteResult = await port.get([...(keys as readonly string[]), ...versionKeys]);
          for (let i = 0; i < (keys as readonly string[]).length; i++) {
            const key = (keys as readonly string[])[i] as string;
            const postVersion = (postWriteResult[`${key}_version`] as number) ?? INITIAL_VERSION;
            const postValue = postWriteResult[key];
            if (postVersion !== newVersions[i] || !deepEqual(postValue, newValues[i])) {
              throw new ConflictError(key, newVersions[i] ?? -1, postVersion);
            }
          }
          return newValues;
        });
      } catch (error) {
        if (!(error instanceof ConflictError)) {
          const err = error as Error;
          logDebug('withAtomicKeys error', { error: err.message, stack: err.stack }, 'storageTransaction.ts');
          throw error;
        }
        lastError = error;
        attempt++;
        if (attempt > maxRetries) throw new ConflictError((keys as readonly string[]).join('+'), -1, -1);
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        logDebug('withAtomicKeys retrying', { keys, attempt, maxRetries, delay }, 'storageTransaction.ts');
      }
    }
    throw lastError || new Error('Unexpected error in withAtomic');
  }
}

// ---------------------------------------------------------------------------
// Functional wrappers (default port) — for callers that don't inject a port
// ---------------------------------------------------------------------------

const defaultTransaction = new StorageTransaction(defaultPort);

export function withOptimisticLock<T>(
  key: string,
  updateFn: (currentValue: T) => T,
  options: { maxRetries?: number; initialDelay?: number } = {}
): Promise<T> {
  return defaultTransaction.withLock(key, updateFn, options);
}

export function withAtomicKeys<T extends readonly unknown[]>(
  keys: { [K in keyof T]: string },
  updater: (currentValues: { [K in keyof T]: T[K] }) => { [K in keyof T]: T[K] },
  options: { maxRetries?: number; initialDelay?: number } = {}
): Promise<{ [K in keyof T]: T[K] }> {
  return defaultTransaction.withAtomic(keys, updater, options);
}

// Port-aware variants for injected callers
export function withLockViaPort<T>(
  port: StoragePort,
  key: string,
  updateFn: (currentValue: T) => T,
  options: { maxRetries?: number; initialDelay?: number } = {}
): Promise<T> {
  return new StorageTransaction(port).withLock(key, updateFn, options);
}

export function withAtomicViaPort<T extends readonly unknown[]>(
  port: StoragePort,
  keys: { [K in keyof T]: string },
  updater: (currentValues: { [K in keyof T]: T[K] }) => { [K in keyof T]: T[K] },
  options: { maxRetries?: number; initialDelay?: number } = {}
): Promise<{ [K in keyof T]: T[K] }> {
  return new StorageTransaction(port).withAtomic(keys, updater, options);
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
  const postWriteResult = await port.get([key, `${key}_version`]);
  const postWriteVersion = (postWriteResult[`${key}_version`] as number) ?? INITIAL_VERSION;
  const postWriteValue = postWriteResult[key] as T;
  const versionMatches = postWriteVersion === newVersion;
  const valueMatches = deepEqual(postWriteValue, newValue);
  if (!versionMatches || !valueMatches) throw new ConflictError(key, newVersion, postWriteVersion);
}

// Re-export for tests that import ConflictError from optimisticLock shim
export { performCasUpdate as __performCasUpdateForTest };
