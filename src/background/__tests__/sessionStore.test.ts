import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionStore, SESSION_KEYS } from '../sessionStore.js';

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
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSession.set).toHaveBeenCalledWith({ key1: 'value1' });
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
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSession.set).toHaveBeenCalledTimes(2);
  });

  it('flush failure restores delete queue', async () => {
    mockSession.remove.mockRejectedValueOnce(new Error('network error'));
    store.set('key1', 'value1');
    store.remove('key1');
    await store.flushNow();
    expect(mockSession.remove).toHaveBeenCalledTimes(1);
    // retry should call remove again
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSession.remove).toHaveBeenCalledTimes(2);
  });

  // T10
  it('storage unavailable should not throw', async () => {
    delete (globalThis as any).chrome.storage.session;
    expect(() => store.set('key1', 'value1')).not.toThrow();
    const value = await store.get('key1');
    expect(value).toBeNull();
  });

  // T11
  it('quota exceeded should not retry and should keep data in memory', async () => {
    mockSession.set.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
    store.set('key1', 'value1');
    await store.flushNow();
    expect(mockSession.set).toHaveBeenCalledTimes(1);
    // Should not retry after quota error
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSession.set).toHaveBeenCalledTimes(1);
  });

  it('handles non-Error quota rejection', async () => {
    mockSession.set.mockRejectedValueOnce('QUOTA_BYTES quota exceeded');
    store.set('key1', 'value1');
    await store.flushNow();
    expect(mockSession.set).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSession.set).toHaveBeenCalledTimes(1);
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

  it('flush() saves only priority data when estimated size exceeds 1MB', async () => {
    // Build a value larger than 1MB when serialized
    const bigString = 'x'.repeat(1.2 * 1024 * 1024);
    store.set(SESSION_KEYS.RECORDING_CACHE, {
      settingsCache: { value: 'priority' },
      cacheTimestamp: 12345,
      cacheVersion: 1,
      urlCache: bigString,
    });
    await store.flushNow();

    const setCall = mockSession.set.mock.calls[0][0];
    expect(setCall[SESSION_KEYS.RECORDING_CACHE]).toEqual({
      settingsCache: { value: 'priority' },
      cacheTimestamp: 12345,
      cacheVersion: 1,
    });
    expect(setCall[SESSION_KEYS.RECORDING_CACHE].urlCache).toBeUndefined();
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
    let resolveSet!: () => void;
    mockSession.set.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSet = resolve;
        }),
    );
    store.set('key1', 'value1');
    const firstFlush = store.flushNow();
    // Trigger a second overlapping flush while the first is still in-flight.
    store.set('key2', 'value2');
    const secondFlush = store.flushNow();
    resolveSet();
    await Promise.all([firstFlush, secondFlush]);
    expect(mockSession.set).toHaveBeenCalled();
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
    // Falls through the try/catch to 0, so the size never exceeds MAX_SESSION_SIZE
    // and the value is written as-is rather than reduced to priority-only data.
    expect(mockSession.set).toHaveBeenCalledWith({ key1: circular });
  });

  it('extractPriorityData() keeps non-RECORDING_CACHE keys as-is when payload exceeds 1MB', async () => {
    const bigString = 'x'.repeat(1.2 * 1024 * 1024);
    store.set('someOtherKey', bigString);
    await store.flushNow();

    const setCall = mockSession.set.mock.calls[0][0];
    expect(setCall.someOtherKey).toBe(bigString);
  });

  it('registerSuspendHandler() registers an onSuspend listener that flushes to local', () => {
    const listeners: Array<() => void> = [];
    (globalThis as any).chrome.runtime = {
      onSuspend: {
        addListener: vi.fn((cb: () => void) => listeners.push(cb)),
      },
    };
    const mockLocal = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome.storage.local = mockLocal;

    SessionStore.registerSuspendHandler(store);
    store.set('key1', 'value1');
    expect(listeners).toHaveLength(1);
    listeners[0]();

    expect(mockLocal.set).toHaveBeenCalledWith({ key1: 'value1' });
  });

  it('registerSuspendHandler() is a no-op when chrome.runtime.onSuspend is unavailable', () => {
    expect(() => SessionStore.registerSuspendHandler(store)).not.toThrow();
  });

  it('get() returns null when local fallback migration does not find the key', async () => {
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

  it('get() returns null when chrome.storage.session is unavailable', async () => {
    delete (globalThis as any).chrome.storage.session;
    const value = await store.get<string>('key1');
    expect(value).toBeNull();
  });

  it('get() swallows errors thrown by chrome.storage.session.get', async () => {
    mockSession.get.mockRejectedValueOnce(new Error('boom'));
    const value = await store.get<string>('key1');
    expect(value).toBeNull();
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

    expect(migrated).toBe(true);
    expect(sessionStorage['sw:rateLimiter']).toEqual({ entries: [] });
    expect(localStorage['sw:rateLimiter']).toBeUndefined();
  });

  it('returns false when key does not exist in local storage', async () => {
    const migrated = await SessionStore.migrateFromLocalStorageIfSessionEmpty('sw:rateLimiter');

    expect(migrated).toBe(false);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('returns false when storage APIs are unavailable', async () => {
    delete (globalThis as any).chrome.storage.local;

    const migrated = await SessionStore.migrateFromLocalStorageIfSessionEmpty('sw:rateLimiter');

    expect(migrated).toBe(false);
  });

  it('returns false and logs when session.set throws', async () => {
    localStorage['sw:rateLimiter'] = { entries: [] };
    mockSession.set.mockRejectedValueOnce(new Error('boom'));

    const migrated = await SessionStore.migrateFromLocalStorageIfSessionEmpty('sw:rateLimiter');

    expect(migrated).toBe(false);
    expect(localStorage['sw:rateLimiter']).toEqual({ entries: [] });
  });
});
