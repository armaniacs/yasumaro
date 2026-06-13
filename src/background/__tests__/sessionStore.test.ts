import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionStore, SESSION_KEYS } from '../sessionStore.js';

describe('SessionStore', () => {
  let store: SessionStore;
  let mockSession: { get: any; set: any };

  beforeEach(() => {
    store = new SessionStore();
    mockSession = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    (globalThis as any).chrome = {
      storage: { local: mockSession },
    };
  });

  afterEach(() => {
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
    mockSession.set.mockRejectedValueOnce(new Error('quota exceeded'));
    store.set('key1', 'value1');
    await store.flushNow();
    expect(mockSession.set).toHaveBeenCalledTimes(1);
    // retry is scheduled; wait for next timer
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSession.set).toHaveBeenCalledTimes(2);
  });

  // T10
  it('storage unavailable should not throw', async () => {
    delete (globalThis as any).chrome.storage.local;
    expect(() => store.set('key1', 'value1')).not.toThrow();
    const value = await store.get('key1');
    expect(value).toBeNull();
  });

  // T11, T12
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
