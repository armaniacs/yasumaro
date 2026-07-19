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
});
