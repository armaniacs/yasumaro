import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionStore, SESSION_KEYS, SESSION_STORE_FLUSH_DELAY_MS, SESSION_MAX_FLUSH_BYTES, SessionStoreReadError, type SessionStorePort } from '../sessionStore.js';
import { LogType } from '../../utils/logger/types.js';
import { useTimerClock, drainMacrotask } from '../../../testDir/waitPolicy.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';

const mockAddLog = vi.hoisted(() => vi.fn());

// The drop decision is only observable through its WARN log, so the real logger
// (which buffers into chrome.storage) is replaced by a spy.
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: mockAddLog,
  }),
);

function serializedSize(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

/** URL of exactly `length` characters so the 10k-entry payload is byte-predictable. */
function urlOfLength(index: number, length: number): string {
  const prefix = 'https://example.com/';
  const suffix = `/${index}`;
  return `${prefix}${'a'.repeat(length - prefix.length - suffix.length)}${suffix}`;
}

/**
 * The payload shape saveCacheToSession writes: [url, timestamp] entries, not
 * whole SavedUrlEntry records. 10,000 x 180 chars is the size the old 1 MiB cap
 * rejected and the 3 MiB cap accepts.
 */
function realisticRecordingCache(): Record<string, unknown> {
  const urlCache: [string, number][] = Array.from({ length: 10000 }, (_, i) => [
    urlOfLength(i, 180),
    1758000000000 + i,
  ]);
  return {
    settingsCache: { geminiApiKey: '', someFlag: true },
    cacheTimestamp: 1758000000000,
    cacheVersion: 1,
    urlCache,
    urlCacheTimestamp: 1758000000000,
    privacyCache: [],
    privacyCacheTimestamp: 1758000000000,
  };
}

/** A payload that cannot fit under the cap for any URL length. */
function overCapRecordingCache(): Record<string, unknown> {
  const value: Record<string, unknown> = {
    settingsCache: { value: 'priority' },
    cacheTimestamp: 12345,
    cacheVersion: 1,
    urlCache: 'x'.repeat(SESSION_MAX_FLUSH_BYTES + 1024),
  };
  // Guards every consumer: without the over-cap guarantee the overflow branch
  // would never run and the pins below would pass vacuously.
  expect(serializedSize({ [SESSION_KEYS.RECORDING_CACHE]: value })).toBeGreaterThan(SESSION_MAX_FLUSH_BYTES);
  return value;
}

/**
 * Read the private queue so queue residency is observable from outside; the
 * drop guarantee is precisely "the key is no longer queued".
 */
function queuedKeys(target: SessionStore): string[] {
  return Array.from((target as unknown as { writeQueue: Map<string, unknown> }).writeQueue.keys());
}

describe('SessionStore', () => {
  let store: SessionStore;
  let mockSession: { get: any; set: any; remove: any };

  beforeEach(() => {
    store = new SessionStore();
    mockSession = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome = {
      storage: { session: mockSession },
    };
  });

  afterEach(() => {
    store.dispose();
    vi.restoreAllMocks();
  });

  // T1
  it('set() should queue writes', async () => {
    store.set('key1', 'value1');
    expect(mockSession.set).not.toHaveBeenCalled();
    await store.flushNow();
    expect(mockSession.set).toHaveBeenCalledWith({ key1: 'value1' });
  });

  // T2
  it('get() should retrieve from storage', async () => {
    mockSession.get.mockResolvedValue({ key1: 'value1' });
    const value = await store.get<string>('key1');
    expect(mockSession.get).toHaveBeenCalledWith('key1');
    expect(value).toBe('value1');
  });

  it('set() with flushImmediately persists immediately without waiting for the debounce', async () => {
    await store.set('key1', 'value1', { flushImmediately: true });
    expect(mockSession.set).toHaveBeenCalledWith({ key1: 'value1' });
  });

  it('set() without flushImmediately still debounces (no immediate write)', async () => {
    await store.set('key1', 'value1');
    expect(mockSession.set).not.toHaveBeenCalled();
  });

  // T3
  it('remove() should queue delete', async () => {
    store.set('key1', 'value1');
    store.remove('key1');
    await store.flushNow();
    expect(mockSession.set).not.toHaveBeenCalled();
    expect(mockSession.remove).toHaveBeenCalledWith(['key1']);
  });

  // T4
  it('flushNow() should immediately persist', async () => {
    store.set('key1', 'value1');
    store.set('key2', 'value2');
    await store.flushNow();
    expect(mockSession.set).toHaveBeenCalledWith({ key1: 'value1', key2: 'value2' });
  });

  // T5
  it('waitForFlush() should await scheduled flush', async () => {
    store.set('key1', 'value1');
    await store.waitForFlush();
    expect(mockSession.set).toHaveBeenCalled();
  });

  // T6
  it('setTimeout-based flush should persist within FLUSH_DELAY', async () => {
    store.set('key1', 'value1');
    await vi.waitFor(
        () => expect(mockSession.set).toHaveBeenCalledWith({ key1: 'value1' }),
        { interval: 1 }
    );
  });

  // T7
  it('consecutive writes should batch in single flush', async () => {
    store.set('key1', 'value1');
    store.set('key2', 'value2');
    store.set('key3', 'value3');
    await store.flushNow();
    expect(mockSession.set).toHaveBeenCalledTimes(1);
    expect(mockSession.set).toHaveBeenCalledWith({
      key1: 'value1',
      key2: 'value2',
      key3: 'value3',
    });
  });

  // T8
  it('flush should clear write queue', async () => {
    store.set('key1', 'value1');
    await store.flushNow();
    mockSession.set.mockClear();
    await store.flushNow();
    expect(mockSession.set).not.toHaveBeenCalled();
  });

  // T9
  it('flush failure should restore queue and retry', async () => {
    mockSession.set.mockRejectedValueOnce(new Error('network error'));
    store.set('key1', 'value1');
    await store.flushNow();
    expect(mockSession.set).toHaveBeenCalledTimes(1);
    // retry is scheduled; wait for next timer
    await vi.waitFor(
        () => expect(mockSession.set).toHaveBeenCalledTimes(2),
        { interval: 1 }
    );
  });

  it('flush failure restores delete queue', async () => {
    mockSession.remove.mockRejectedValueOnce(new Error('network error'));
    store.set('key1', 'value1');
    store.remove('key1');
    await store.flushNow();
    expect(mockSession.remove).toHaveBeenCalledTimes(1);
    // retry should call remove again
    await vi.waitFor(
        () => expect(mockSession.remove).toHaveBeenCalledTimes(2),
        { interval: 1 }
    );
  });

  // T10
  it('storage unavailable: set() stays queued without throwing while get() surfaces a typed read error', async () => {
    delete (globalThis as any).chrome.storage.session;
    expect(() => store.set('key1', 'value1')).not.toThrow();
    await expect(store.get('key1')).rejects.toThrow(SessionStoreReadError);
  });

  // T11: quota no longer idles until the next set() — the batch is retried
  // on the timer (bounded), so a transient quota pressure can clear.
  it('quota exceeded retries on the timer and keeps data queued', async () => {
    // A retry is a setTimeout(FLUSH_DELAY) away, so a real-clock wait would be
    // the only way to cross it — which is exactly what the wait policy forbids.
    // Drive the clock instead: the second set call below IS the retry.
    useTimerClock();
    try {
      mockSession.set.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
      store.set('key1', 'value1');
      await store.flushNow();
      expect(mockSession.set).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(SESSION_STORE_FLUSH_DELAY_MS * 2);
      expect(mockSession.set).toHaveBeenCalledTimes(2);
      expect(mockSession.set).toHaveBeenLastCalledWith({ key1: 'value1' });
      // The retry succeeded, so nothing is left to flush.
      await vi.advanceTimersByTimeAsync(SESSION_STORE_FLUSH_DELAY_MS * 2);
      expect(mockSession.set).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles non-Error quota rejection with the same retry', async () => {
    useTimerClock();
    try {
      mockSession.set.mockRejectedValueOnce('QUOTA_BYTES quota exceeded');
      store.set('key1', 'value1');
      await store.flushNow();
      expect(mockSession.set).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(SESSION_STORE_FLUSH_DELAY_MS * 2);
      expect(mockSession.set).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('quota retry budget exhaustion backs the full values up to local storage and stops retrying', async () => {
    useTimerClock();
    try {
      const localPort = new InMemoryStoragePort();
      const quotaStore = new SessionStore(localPort);
      mockSession.set.mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));
      quotaStore.set('key1', 'value1');
      await quotaStore.flushNow();
      // Attempts 1-3 retry on the timer; the 4th exhausts the budget.
      await vi.advanceTimersByTimeAsync(SESSION_STORE_FLUSH_DELAY_MS * 10);
      expect(mockSession.set.mock.calls.length).toBeGreaterThanOrEqual(4);
      const callsAfterExhaustion = mockSession.set.mock.calls.length;
      await vi.advanceTimersByTimeAsync(SESSION_STORE_FLUSH_DELAY_MS * 10);
      // No infinite retry loop: the queue was dropped after a durable backup.
      expect(mockSession.set.mock.calls.length).toBe(callsAfterExhaustion);
      expect(localPort.dump()).toEqual({ key1: 'value1' });
      // The dropped data is not floating: after a restart it migrates back.
      mockSession.set.mockReset();
      const sessionData: Record<string, unknown> = {};
      mockSession.get.mockImplementation(async () => ({ ...sessionData }));
      mockSession.set.mockImplementation(async (items: Record<string, unknown>) => {
        Object.assign(sessionData, items);
      });
      const restarted = new SessionStore(localPort);
      await expect(restarted.get<string>('key1')).resolves.toBe('value1');
      restarted.dispose();
      quotaStore.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  // T12, T13
  it('mapToEntries and entriesToMap should round-trip', () => {
    const map = new Map([
      [1, 'a'],
      [2, 'b'],
    ]) as Map<unknown, unknown>;
    const entries = SessionStore.mapToEntries(map);
    const restored = SessionStore.entriesToMap(entries);
    expect(restored).toEqual(map);
  });

  it('waitForFlush() resolves without polling when flush is already complete', async () => {
    store.set('key1', 'value1');
    await store.flushNow();
    mockSession.set.mockClear();

    await store.waitForFlush();

    expect(mockSession.set).not.toHaveBeenCalled();
  });

  it('get() falls back to local storage when key is missing in session', async () => {
    const sessionData: Record<string, unknown> = {};
    mockSession.get.mockImplementation(async (keys: string | string[] | null) => {
      if (keys === null) return { ...sessionData };
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        keys.forEach((key) => { if (key in sessionData) result[key] = sessionData[key]; });
        return result;
      }
      return keys in sessionData ? { [keys]: sessionData[keys] } : {};
    });
    mockSession.set.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(sessionData, items);
    });
    mockSession.remove.mockImplementation(async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      arr.forEach((key) => delete sessionData[key]);
    });

    const mockLocal = {
      get: vi.fn().mockResolvedValue({ key1: 'from-local' }),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome.storage.local = mockLocal;

    const value = await store.get<string>('key1');

    expect(mockSession.get).toHaveBeenCalledWith('key1');
    expect(mockLocal.get).toHaveBeenCalledWith('key1');
    expect(mockSession.set).toHaveBeenCalledWith({ key1: 'from-local' });
    expect(mockLocal.remove).toHaveBeenCalledWith('key1');
    expect(value).toBe('from-local');
  });

  it('get() only checks local fallback once per key', async () => {
    const mockLocal = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome.storage.local = mockLocal;
    mockSession.get.mockResolvedValue({});

    await store.get<string>('key1');
    await store.get<string>('key1');

    expect(mockLocal.get).toHaveBeenCalledTimes(1);
  });

  it('emergencyFlushToLocal() writes queued data to local storage', () => {
    const mockLocal = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome.storage.local = mockLocal;

    store.set('key1', 'value1');
    store.set('key2', 'value2');
    store.emergencyFlushToLocal();

    expect(mockLocal.set).toHaveBeenCalledWith({ key1: 'value1', key2: 'value2' });
  });

  it('SESSION_MAX_FLUSH_BYTES is the 3 MiB cap fixed by the overflow ADR', () => {
    expect(SESSION_MAX_FLUSH_BYTES).toBe(3_145_728);
  });

  it('flush() never writes a partial shape under the canonical key when the estimated size exceeds the flush cap', async () => {
    const value = overCapRecordingCache();
    store.set(SESSION_KEYS.RECORDING_CACHE, value);
    await store.flushNow();

    // No reduced "priority sub-keys only" half-shape may read back as data.
    expect(mockSession.set).not.toHaveBeenCalled();
    // The stale session copy is removed so readers miss instead of reading old data as latest.
    expect(mockSession.remove).toHaveBeenCalledWith([SESSION_KEYS.RECORDING_CACHE]);
    // The full value stays queued for the bounded retry.
    expect(queuedKeys(store)).toEqual([SESSION_KEYS.RECORDING_CACHE]);
  });

  it('flush() backs the full over-cap value up to local storage so a SW death mid-retry loses nothing', async () => {
    const localPort = new InMemoryStoragePort();
    const overflowStore = new SessionStore(localPort);
    const value = overCapRecordingCache();
    overflowStore.set(SESSION_KEYS.RECORDING_CACHE, value);
    await overflowStore.flushNow();

    expect(localPort.dump()[SESSION_KEYS.RECORDING_CACHE]).toEqual(value);
    overflowStore.dispose();
  });

  it('flush() writes 10,000 x 180-char urlCache entries whole instead of reducing them', async () => {
    const value = realisticRecordingCache();
    const size = serializedSize({ [SESSION_KEYS.RECORDING_CACHE]: value });
    // The realistic heavy-user payload: over the old 1 MiB cap, under the new one.
    expect(size).toBeGreaterThan(1024 * 1024);
    expect(size).toBeLessThan(SESSION_MAX_FLUSH_BYTES);

    store.set(SESSION_KEYS.RECORDING_CACHE, value);
    await store.flushNow();

    expect(mockSession.set).toHaveBeenCalledTimes(1);
    const written = mockSession.set.mock.calls[0][0][SESSION_KEYS.RECORDING_CACHE];
    expect(written).toEqual(value);
    expect((written as { urlCache: [string, number][] }).urlCache).toHaveLength(10000);
    // Written in full, so nothing stays queued for the next flush to re-serialize.
    expect(queuedKeys(store)).toEqual([]);

    mockSession.set.mockClear();
    await store.flushNow();
    expect(mockSession.set).not.toHaveBeenCalled();
  });

  it('re-queues an over-cap key at most twice and drops it on the third overflow flush', async () => {
    store.set(SESSION_KEYS.RECORDING_CACHE, overCapRecordingCache());

    await store.flushNow();
    expect(queuedKeys(store)).toEqual([SESSION_KEYS.RECORDING_CACHE]);
    await store.flushNow();
    expect(queuedKeys(store)).toEqual([SESSION_KEYS.RECORDING_CACHE]);
    await store.flushNow();
    expect(queuedKeys(store)).toEqual([]);

    // Nothing left, so a 4th flush has no work and the loop cannot restart.
    mockSession.set.mockClear();
    await store.flushNow();
    expect(mockSession.set).not.toHaveBeenCalled();
  });

  it('logs the dropped key name and consecutive overflow count, escalating to ERROR when no durable backup exists', async () => {
    mockAddLog.mockClear();
    store.set(SESSION_KEYS.RECORDING_CACHE, overCapRecordingCache());

    await store.flushNow();
    await store.flushNow();
    expect(mockAddLog).not.toHaveBeenCalledWith(LogType.WARN, expect.stringContaining('dropping'), expect.anything());
    expect(mockAddLog).not.toHaveBeenCalledWith(LogType.ERROR, expect.stringContaining('dropping'), expect.anything());

    await store.flushNow();

    // No chrome.storage.local in this environment, so the backup could not
    // land and the loss is reported at ERROR, not WARN.
    expect(mockAddLog).toHaveBeenCalledWith(
      LogType.ERROR,
      expect.stringContaining('dropping'),
      expect.objectContaining({ key: SESSION_KEYS.RECORDING_CACHE, consecutiveOverflowFlushes: 3, backedUp: false }),
    );
    const dropLogs = mockAddLog.mock.calls.filter(
      ([, message]) => typeof message === 'string' && message.includes('dropping'),
    );
    expect(dropLogs).toHaveLength(1);
  });

  it('logs the over-cap drop at WARN when the full value was durably backed up', async () => {
    mockAddLog.mockClear();
    const backedStore = new SessionStore(new InMemoryStoragePort());
    backedStore.set(SESSION_KEYS.RECORDING_CACHE, overCapRecordingCache());

    await backedStore.flushNow();
    await backedStore.flushNow();
    await backedStore.flushNow();

    expect(mockAddLog).toHaveBeenCalledWith(
      LogType.WARN,
      expect.stringContaining('dropping'),
      expect.objectContaining({ key: SESSION_KEYS.RECORDING_CACHE, backedUp: true }),
    );
    backedStore.dispose();
  });

  it('keeps a dropped over-cap key out of the suspend emergency flush to local storage', async () => {
    const listeners: Array<() => void> = [];
    (globalThis as any).chrome.runtime = {
      onSuspend: { addListener: vi.fn((cb: () => void) => listeners.push(cb)) },
    };
    const mockLocal = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome.storage.local = mockLocal;

    // Own store for the same repeat-safety reason as above.
    const suspendStore = new SessionStore();
    // Mirrors how the service worker wires suspend handling.
    SessionStore.registerSuspendHandler(suspendStore);
    suspendStore.set(SESSION_KEYS.RECORDING_CACHE, overCapRecordingCache());
    await suspendStore.flushNow();
    await suspendStore.flushNow();
    await suspendStore.flushNow();
    expect(queuedKeys(suspendStore)).toEqual([]);

    // The over-cap value was durably backed up during the overflow retries by
    // design; what must NOT happen is the suspend path adding anything new
    // for a key that already left the queue.
    mockLocal.set.mockClear();
    listeners[listeners.length - 1]!();

    expect(mockLocal.set).not.toHaveBeenCalled();
    suspendStore.dispose();
  });

  it('clears the re-queue count after a successful write so a later overflow gets a full budget', async () => {
    const overCap = overCapRecordingCache();
    const shrunk = { ...overCap, urlCache: 'x'.repeat(1024) };

    store.set(SESSION_KEYS.RECORDING_CACHE, overCap);
    await store.flushNow();
    expect(queuedKeys(store)).toEqual([SESSION_KEYS.RECORDING_CACHE]);

    // The payload shrinks, so this flush writes it whole and the count resets.
    store.set(SESSION_KEYS.RECORDING_CACHE, shrunk);
    await store.flushNow();
    expect(queuedKeys(store)).toEqual([]);

    store.set(SESSION_KEYS.RECORDING_CACHE, overCap);
    await store.flushNow();
    expect(queuedKeys(store)).toEqual([SESSION_KEYS.RECORDING_CACHE]);
    await store.flushNow();
    expect(queuedKeys(store)).toEqual([SESSION_KEYS.RECORDING_CACHE]);
    await store.flushNow();
    expect(queuedKeys(store)).toEqual([]);
  });

  it('set() is a no-op after dispose()', async () => {
    store.dispose();
    await store.set('key1', 'value1');
    expect(mockSession.set).not.toHaveBeenCalled();
  });

  it('remove() is a no-op after dispose()', async () => {
    store.dispose();
    store.remove('key1');
    await store.flushNow();
    expect(mockSession.remove).not.toHaveBeenCalled();
  });

  it('flushNow() is a no-op after dispose()', async () => {
    store.set('key1', 'value1');
    store.dispose();
    await store.flushNow();
    expect(mockSession.set).not.toHaveBeenCalled();
  });

  it('waitForFlush() is a no-op after dispose()', async () => {
    store.dispose();
    await expect(store.waitForFlush()).resolves.toBeUndefined();
  });

  it('waitForFlush() resolves immediately when nothing scheduled', async () => {
    await expect(store.waitForFlush()).resolves.toBeUndefined();
    expect(mockSession.set).not.toHaveBeenCalled();
  });

  it('flush() with empty queues does not call chrome.storage.session.set', async () => {
    await store.flushNow();
    expect(mockSession.set).not.toHaveBeenCalled();
    expect(mockSession.remove).not.toHaveBeenCalled();
  });

  it('scheduleFlush() does not schedule a second timer while one is pending', async () => {
    store.set('key1', 'value1');
    store.set('key2', 'value2');
    // second set() call hits the "already scheduled" early-return branch
    await store.waitForFlush();
    expect(mockSession.set).toHaveBeenCalledTimes(1);
  });

  it('handles concurrent flush() calls by awaiting the in-flight flush', async () => {
    const resolvers: Array<() => void> = [];
    mockSession.set.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    store.set('key1', 'value1');
    const firstFlush = store.flushNow();
    // Trigger a second overlapping flush while the first is still in-flight.
    store.set('key2', 'value2');
    const secondFlush = store.flushNow();
    expect(mockSession.set).toHaveBeenCalledTimes(1);
    resolvers[0]!();
    for (let i = 0; i < 100 && mockSession.set.mock.calls.length < 2; i++) {
      await Promise.resolve();
    }
    expect(mockSession.set).toHaveBeenCalledTimes(2);
    resolvers[1]!();
    await Promise.all([firstFlush, secondFlush]);
    const written = mockSession.set.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>);
    expect(written.some((args: Record<string, unknown>) => args['key2'] === 'value2')).toBe(true);
  });

  it('emergencyFlushToLocal() does nothing when write queue is empty', () => {
    const mockLocal = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome.storage.local = mockLocal;

    store.emergencyFlushToLocal();

    expect(mockLocal.set).not.toHaveBeenCalled();
  });

  it('emergencyFlushToLocal() does nothing when chrome.storage.local is unavailable', () => {
    store.set('key1', 'value1');
    delete (globalThis as any).chrome.storage.local;

    expect(() => store.emergencyFlushToLocal()).not.toThrow();
  });

  it('estimateStorageSize() returns 0 when JSON.stringify throws (circular reference)', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    store.set('key1', circular);
    await store.flushNow();
    // Falls through the try/catch to 0, so the size never exceeds
    // SESSION_MAX_FLUSH_BYTES and the value is written as-is rather than reduced
    // to priority-only data.
    expect(mockSession.set).toHaveBeenCalledWith({ key1: circular });
  });

  it('over-cap batch with a non-RECORDING_CACHE key is backed up whole to local storage, never partially written', async () => {
    const localPort = new InMemoryStoragePort();
    const backedStore = new SessionStore(localPort);
    const bigString = 'x'.repeat(SESSION_MAX_FLUSH_BYTES + 1024);
    backedStore.set('someOtherKey', bigString);
    await backedStore.flushNow();

    expect(mockSession.set).not.toHaveBeenCalled();
    expect(mockSession.remove).toHaveBeenCalledWith(['someOtherKey']);
    expect(localPort.dump()).toEqual({ someOtherKey: bigString });
    backedStore.dispose();
  });

  it('registerSuspendHandler() is idempotent per store', () => {
    const listeners: Array<() => void> = [];
    (globalThis as any).chrome.runtime = {
      onSuspend: {
        addListener: vi.fn((cb: () => void) => listeners.push(cb)),
      },
    };
    // Own store: repeat runs reuse the shared beforeEach store (hooks do not
    // re-run between repeats), so idempotency needs a fresh flag per run.
    const fresh = new SessionStore();
    // The constructor already registered once via the runtime mock above.
    SessionStore.registerSuspendHandler(fresh);
    SessionStore.registerSuspendHandler(fresh);

    expect(listeners).toHaveLength(1);
    fresh.dispose();
  });

  it('debounced writes survive a suspend via the automatic local backup and recover after a restart', async () => {
    const listeners: Array<() => void> = [];
    (globalThis as any).chrome.runtime = {
      onSuspend: { addListener: vi.fn((cb: () => void) => listeners.push(cb)) },
    };
    const localPort = new InMemoryStoragePort();
    const suspendStore = new SessionStore(localPort);
    // The constructor wires the suspend backup: no manual registration needed.
    expect(listeners).toHaveLength(1);

    suspendStore.set('key1', 'value1');
    // Still debounced: nothing reached session storage yet.
    expect(mockSession.set).not.toHaveBeenCalled();
    listeners[0]!();
    await drainMacrotask();

    expect(localPort.dump()).toEqual({ key1: 'value1' });
    expect(suspendStore.getLastSuspendBackup()).toEqual(expect.objectContaining({ keys: ['key1'], ok: true }));

    // Simulate a service-worker restart: fresh empty session, same local area.
    const sessionData: Record<string, unknown> = {};
    mockSession.get.mockImplementation(async () => ({ ...sessionData }));
    mockSession.set.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(sessionData, items);
    });
    const restarted = new SessionStore(localPort);
    await expect(restarted.get<string>('key1')).resolves.toBe('value1');
    suspendStore.dispose();
    restarted.dispose();
  });

  it('emergencyFlushToLocal() resolves true and records the backup on success', async () => {
    const localPort = new InMemoryStoragePort();
    const backedStore = new SessionStore(localPort);
    backedStore.set('key1', 'value1');

    await expect(backedStore.emergencyFlushToLocal()).resolves.toBe(true);
    expect(localPort.dump()).toEqual({ key1: 'value1' });
    expect(backedStore.getLastSuspendBackup()).toEqual(expect.objectContaining({ keys: ['key1'], ok: true }));
    backedStore.dispose();
  });

  it('emergencyFlushToLocal() reports failure visibly when the local write rejects', async () => {
    mockAddLog.mockClear();
    const failingPort = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockRejectedValue(new Error('local gone')),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const failingStore = new SessionStore(failingPort);
    failingStore.set('key1', 'value1');

    await expect(failingStore.emergencyFlushToLocal()).resolves.toBe(false);
    expect(failingStore.getLastSuspendBackup()).toEqual(expect.objectContaining({ keys: ['key1'], ok: false }));
    expect(mockAddLog).toHaveBeenCalledWith(
      LogType.WARN,
      expect.stringContaining('emergency flush'),
      expect.anything(),
    );
    failingStore.dispose();
  });

  it('set -> waitForFlush -> get -> restart read keeps order and content', async () => {
    const sessionData: Record<string, unknown> = {};
    mockSession.get.mockImplementation(async () => ({ ...sessionData }));
    mockSession.set.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(sessionData, items);
    });
    mockSession.remove.mockImplementation(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionData[key];
    });

    await store.set('key1', 'value1', { flushImmediately: true });
    await store.waitForFlush();
    await expect(store.get<string>('key1')).resolves.toBe('value1');

    // A new store over the same session backend (SW restart) reads it back.
    const restarted = new SessionStore();
    await expect(restarted.get<string>('key1')).resolves.toBe('value1');
    restarted.dispose();
  });

  it('registerSuspendHandler() is a no-op when chrome.runtime.onSuspend is unavailable', () => {
    expect(() => SessionStore.registerSuspendHandler(store)).not.toThrow();
  });

  it('get() returns null on a miss without memoizing a transient fallback failure', async () => {
    mockSession.get.mockResolvedValue({});
    const mockLocal = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome.storage.local = mockLocal;

    const value = await store.get<string>('missingKey');

    expect(mockLocal.get).toHaveBeenCalledWith('missingKey');
    expect(value).toBeNull();
  });

  it('get() retries the local fallback after a transient failure instead of treating it as checked', async () => {
    const sessionData: Record<string, unknown> = {};
    mockSession.get.mockImplementation(async () => ({ ...sessionData }));
    mockSession.set.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(sessionData, items);
    });
    const mockLocal = {
      get: vi.fn().mockRejectedValueOnce(new Error('local flake')).mockResolvedValue({ retryKey: 'recovered' }),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome.storage.local = mockLocal;

    await expect(store.get<string>('retryKey')).resolves.toBeNull();
    const value = await store.get<string>('retryKey');

    // Two local reads: the transient failure was NOT memoized as checked.
    expect(mockLocal.get).toHaveBeenCalledTimes(2);
    expect(mockSession.set).toHaveBeenCalledWith({ retryKey: 'recovered' });
    expect(mockLocal.remove).toHaveBeenCalledWith('retryKey');
    expect(value).toBe('recovered');
  });

  it('get() rejects with SessionStoreReadError when chrome.storage.session is unavailable', async () => {
    delete (globalThis as any).chrome.storage.session;
    await expect(store.get<string>('key1')).rejects.toThrow(SessionStoreReadError);
  });

  it('get() rejects with SessionStoreReadError instead of swallowing read failures as null', async () => {
    mockSession.get.mockRejectedValueOnce(new Error('boom'));
    const failure = await store.get<string>('key1').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SessionStoreReadError);
    expect((failure as SessionStoreReadError).key).toBe('key1');
    expect((failure as SessionStoreReadError).causeText).toContain('boom');
  });

  it('get() still resolves null on a genuine miss', async () => {
    mockSession.get.mockResolvedValue({});
    delete (globalThis as any).chrome.storage.local;
    await expect(store.get<string>('absent')).resolves.toBeNull();
  });

  it('waitForFlush() awaits an in-flight flush when no timer is pending', async () => {
    let resolveSet!: () => void;
    mockSession.set.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSet = resolve;
        }),
    );
    store.set('key1', 'value1');
    const flushing = store.flushNow();
    // Timer was cleared by flushNow(), but the flush itself is still in-flight.
    const waiting = store.waitForFlush();
    resolveSet();
    await Promise.all([flushing, waiting]);
    expect(mockSession.set).toHaveBeenCalledTimes(1);
  });

  it('waitForFlush() covers a write that lands mid-flush instead of leaving its fresh timer behind', async () => {
    const gate = Promise.withResolvers<void>();
    mockSession.set.mockImplementation(() => gate.promise);
    store.set('key1', 'value1');
    const flushing = store.flushNow();
    // The flush is in-flight; this write cannot schedule a timer yet, so the
    // completing flush leaves one behind for it.
    store.set('key2', 'value2');
    const waiting = store.waitForFlush();
    gate.resolve();
    await Promise.all([flushing, waiting]);
    // Both writes landed before waitForFlush resolved — no orphaned timer.
    expect(mockSession.set).toHaveBeenCalledTimes(2);
    expect(mockSession.set).toHaveBeenLastCalledWith({ key2: 'value2' });
    await expect(store.waitForFlush()).resolves.toBeUndefined();
    expect(mockSession.set).toHaveBeenCalledTimes(2);
  });

  it('waitForFlush() throws when a producer keeps the queue non-empty forever', async () => {
    // Every flush fails transiently and re-queues, so the queue never
    // settles: the bound must surface as a throw, not a silent return that
    // looks like "settled". No timers are waited on — each round awaits the
    // (immediately rejected) flush work directly.
    mockSession.set.mockRejectedValue(new Error('boom'));
    store.set('key1', 'value1');
    await expect(store.waitForFlush()).rejects.toThrow(/unsettled work/);
    expect(mockAddLog).toHaveBeenCalledWith(
      LogType.ERROR,
      expect.stringContaining('unsettled work'),
      expect.anything(),
    );
  });
});

describe('SessionStore.migrateFromLocalStorage', () => {
  let localStorage: Record<string, unknown>;
  let sessionStorage: Record<string, unknown>;
  let mockLocal: { get: any; set: any; remove: any };
  let mockSession: { get: any; set: any; remove: any };

  beforeEach(() => {
    localStorage = {};
    sessionStorage = {};
    mockLocal = {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return { ...localStorage };
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          keys.forEach((key) => { if (key in localStorage) result[key] = localStorage[key]; });
          return result;
        }
        return keys in localStorage ? { [keys]: localStorage[keys] } : {};
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(localStorage, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((key) => delete localStorage[key]);
      }),
    };
    mockSession = {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return { ...sessionStorage };
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          keys.forEach((key) => { if (key in sessionStorage) result[key] = sessionStorage[key]; });
          return result;
        }
        return keys in sessionStorage ? { [keys]: sessionStorage[keys] } : {};
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(sessionStorage, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((key) => delete sessionStorage[key]);
      }),
    };
    (globalThis as any).chrome = {
      storage: { local: mockLocal, session: mockSession },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('migrates sw: prefixed keys from local to session storage', async () => {
    localStorage['sw:rateLimiter'] = { entries: [] };
    localStorage['sw:tabCache'] = { tabs: [] };
    localStorage['settings'] = { value: 'keep' }; // not sw:

    const migrated = await SessionStore.migrateFromLocalStorage();

    expect(migrated).toBe(true);
    expect(sessionStorage['sw:rateLimiter']).toEqual({ entries: [] });
    expect(sessionStorage['sw:tabCache']).toEqual({ tabs: [] });
    expect(sessionStorage['settings']).toBeUndefined();
    expect(localStorage['sw:rateLimiter']).toBeUndefined();
    expect(localStorage['sw:tabCache']).toBeUndefined();
    expect(localStorage['settings']).toEqual({ value: 'keep' });
  });

  it('returns false when no sw: keys exist', async () => {
    localStorage['settings'] = { value: 'keep' };

    const migrated = await SessionStore.migrateFromLocalStorage();

    expect(migrated).toBe(false);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('returns false when storage APIs are unavailable', async () => {
    delete (globalThis as any).chrome.storage.local;

    const migrated = await SessionStore.migrateFromLocalStorage();

    expect(migrated).toBe(false);
  });

  it('returns false and logs when session.set throws', async () => {
    localStorage['sw:rateLimiter'] = { entries: [] };
    mockSession.set.mockRejectedValueOnce(new Error('boom'));

    const migrated = await SessionStore.migrateFromLocalStorage();

    expect(migrated).toBe(false);
    expect(localStorage['sw:rateLimiter']).toEqual({ entries: [] });
  });
});

describe('SessionStore.migrateFromLocalStorageIfSessionEmpty', () => {
  let localStorage: Record<string, unknown>;
  let sessionStorage: Record<string, unknown>;
  let mockLocal: { get: any; set: any; remove: any };
  let mockSession: { get: any; set: any; remove: any };

  beforeEach(() => {
    localStorage = {};
    sessionStorage = {};
    mockLocal = {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return { ...localStorage };
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          keys.forEach((key) => { if (key in localStorage) result[key] = localStorage[key]; });
          return result;
        }
        return keys in localStorage ? { [keys]: localStorage[keys] } : {};
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(localStorage, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((key) => delete localStorage[key]);
      }),
    };
    mockSession = {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return { ...sessionStorage };
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          keys.forEach((key) => { if (key in sessionStorage) result[key] = sessionStorage[key]; });
          return result;
        }
        return keys in sessionStorage ? { [keys]: sessionStorage[keys] } : {};
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(sessionStorage, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((key) => delete sessionStorage[key]);
      }),
    };
    (globalThis as any).chrome = {
      storage: { local: mockLocal, session: mockSession },
    };
  });

  it('migrates a single key from local to session storage', async () => {
    localStorage['sw:rateLimiter'] = { entries: [] };

    const migrated = await SessionStore.migrateFromLocalStorageIfSessionEmpty('sw:rateLimiter');

    expect(migrated).toBe('migrated');
    expect(sessionStorage['sw:rateLimiter']).toEqual({ entries: [] });
    expect(localStorage['sw:rateLimiter']).toBeUndefined();
  });

  it('returns absent when key does not exist in local storage', async () => {
    const migrated = await SessionStore.migrateFromLocalStorageIfSessionEmpty('sw:rateLimiter');

    expect(migrated).toBe('absent');
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('returns failed when storage APIs are unavailable', async () => {
    delete (globalThis as any).chrome.storage.local;

    const migrated = await SessionStore.migrateFromLocalStorageIfSessionEmpty('sw:rateLimiter');

    expect(migrated).toBe('failed');
  });

  it('returns failed and logs when session.set throws', async () => {
    localStorage['sw:rateLimiter'] = { entries: [] };
    mockSession.set.mockRejectedValueOnce(new Error('boom'));

    const migrated = await SessionStore.migrateFromLocalStorageIfSessionEmpty('sw:rateLimiter');

    expect(migrated).toBe('failed');
    expect(localStorage['sw:rateLimiter']).toEqual({ entries: [] });
  });

  it('returns failed and logs when the local read throws', async () => {
    mockLocal.get.mockRejectedValueOnce(new Error('local flake'));

    const migrated = await SessionStore.migrateFromLocalStorageIfSessionEmpty('sw:rateLimiter');

    expect(migrated).toBe('failed');
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });
});

describe('SessionStorePort contract', () => {
  it('SessionStore satisfies SessionStorePort structurally', () => {
    // 実装がインターフェースからドリフトしたら型検査で検出される。
    const port: SessionStorePort = new SessionStore();
    expect(typeof port.get).toBe('function');
    expect(typeof port.set).toBe('function');
    expect(typeof port.remove).toBe('function');
  });

  it('get() rejects with SessionStoreReadError on read failure and resolves null on a miss (documented contract)', async () => {
    const store = new SessionStore();
    (globalThis as any).chrome = {
      storage: {
        session: { get: vi.fn().mockRejectedValue(new Error('boom')) },
      },
    };

    const failure = await store.get('any-key').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SessionStoreReadError);
    store.dispose();
  });
});
