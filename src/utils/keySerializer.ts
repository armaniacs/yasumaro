/**
 * keySerializer.ts
 * Key-granular critical-section serialization backed purely by promise
 * microtask chaining (no timers, no external deps).
 *
 * Why microtask-only: a timer-backed mutex (setTimeout / Mutex.acquire)
 * does not progress under `vi.useFakeTimers()` unless the test advances
 * timers, which breaks the many fake-timer suites that call through the
 * CAS helpers. A `Promise.then` chain settles on the microtask queue and
 * needs no timer advance.
 *
 * Why logger-independent: `optimisticLock` -> logger -> logger/core ->
 * storageAdapter forms an import cycle once storageAdapter also needs
 * serialization. Keeping this primitive free of the logger barrel lets
 * every layer import it directly.
 */

type ChainMap = Map<string, Promise<void>>;

const chains: ChainMap = new Map();

/**
 * Run `fn` such that all invocations sharing `key` execute strictly one
 * at a time, in call order. Invocations with different keys never wait on
 * each other. The per-key chain entry is deleted once it settles with no
 * newer waiter attached, so the map does not grow unboundedly.
 */
export function runSerialized<R>(key: string, fn: () => Promise<R>): Promise<R> {
  const prev = chains.get(key);

  // Fast path: key is idle, so run `fn` synchronously (no extra microtask
  // turn before its first await). Callers that expect the read to start
  // eagerly — e.g. a fire-and-forget flush — keep that behavior.
  const run: Promise<R> =
    prev === undefined
      ? (async () => fn())()
      : prev.then(fn, fn);

  const settled: Promise<void> = run.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, settled);

  void settled.then(() => {
    // Only clear if no later caller replaced the chain head.
    if (chains.get(key) === settled) {
      chains.delete(key);
    }
  });

  return run;
}

/**
 * Serialize a critical section across several keys at once without
 * deadlocking: keys are locked in a stable sorted order, so two callers
 * requesting an overlapping key set always acquire in the same sequence.
 */
export function runSerializedMulti<R>(keys: readonly string[], fn: () => Promise<R>): Promise<R> {
  const ordered = [...new Set(keys)].sort();
  if (ordered.length === 0) return fn();

  const acquireFrom = (index: number): Promise<R> => {
    if (index >= ordered.length) return fn();
    return runSerialized(ordered[index] as string, () => acquireFrom(index + 1));
  };

  return acquireFrom(0);
}

/** @internal Test-only: drop all pending chain bookkeeping. */
export function _resetKeySerializerForTest(): void {
  chains.clear();
}
