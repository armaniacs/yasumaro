import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChromeStoragePort, InMemoryStoragePort } from '../storagePort.js';

describe('ChromeStoragePort', () => {
  let port: ChromeStoragePort;

  beforeEach(() => {
    port = new ChromeStoragePort();
    vi.clearAllMocks();
  });

  it('get delegates to chrome.storage.local.get with string key', async () => {
    await port.get('foo');
    expect(chrome.storage.local.get).toHaveBeenCalledWith('foo');
  });

  it('get delegates to chrome.storage.local.get with array key', async () => {
    await port.get(['foo', 'bar']);
    expect(chrome.storage.local.get).toHaveBeenCalledWith(['foo', 'bar']);
  });

  it('get delegates to chrome.storage.local.get with null key', async () => {
    await port.get(null);
    expect(chrome.storage.local.get).toHaveBeenCalledWith(null);
  });

  it('set delegates to chrome.storage.local.set', async () => {
    await port.set({ foo: 'bar' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ foo: 'bar' });
  });

  it('onChanged filters non-local areas and extracts newValue', () => {
    const callback = vi.fn();
    const addListener = chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>;
    port.onChanged(callback);

    const listener = addListener.mock.calls[0]![0];
    listener({ key: { newValue: 'value', oldValue: 'old' } }, 'local');
    expect(callback).toHaveBeenCalledWith({ key: 'value' });
  });

  it('onChanged ignores non-local areas', () => {
    const callback = vi.fn();
    const addListener = chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>;
    port.onChanged(callback);

    const listener = addListener.mock.calls[0]![0];
    listener({ key: { newValue: 'value', oldValue: 'old' } }, 'sync');
    expect(callback).not.toHaveBeenCalled();
  });

  it('getBytesInUse returns result for null keys', async () => {
    const result = await port.getBytesInUse(null);
    expect(chrome.storage.local.getBytesInUse).toHaveBeenCalledWith(null);
    expect(result).toBe(1024);
  });

  it('getBytesInUse returns result for string keys', async () => {
    const result = await port.getBytesInUse('foo');
    expect(chrome.storage.local.getBytesInUse).toHaveBeenCalledWith('foo');
    expect(result).toBe(1024);
  });

  it('getBytesInUse returns result for array keys', async () => {
    const result = await port.getBytesInUse(['foo', 'bar']);
    expect(chrome.storage.local.getBytesInUse).toHaveBeenCalledWith(['foo', 'bar']);
    expect(result).toBe(1024);
  });

  it('getBytesInUse returns result for undefined keys', async () => {
    const result = await port.getBytesInUse();
    expect(chrome.storage.local.getBytesInUse).toHaveBeenCalledWith(null);
    expect(result).toBe(1024);
  });

  it('getBytesInUse falls back to 0 when getBytesInUse is unavailable', async () => {
    const original = chrome.storage.local.getBytesInUse;
    chrome.storage.local.getBytesInUse = undefined as any;
    const result = await port.getBytesInUse();
    expect(result).toBe(0);
    chrome.storage.local.getBytesInUse = original;
  });

  it('getBytesInUse falls back to 0 when chrome is undefined', async () => {
    const originalChrome = (global as any).chrome;
    (global as any).chrome = undefined;
    const result = await port.getBytesInUse();
    expect(result).toBe(0);
    (global as any).chrome = originalChrome;
  });

  it('getBytesInUse falls back to 0 on error', async () => {
    const original = chrome.storage.local.getBytesInUse;
    chrome.storage.local.getBytesInUse = vi.fn(() => Promise.reject(new Error('fail')));
    const result = await port.getBytesInUse('foo');
    expect(result).toBe(0);
    chrome.storage.local.getBytesInUse = original;
  });
});

describe('InMemoryStoragePort', () => {
  let port: InMemoryStoragePort;

  beforeEach(() => {
    port = new InMemoryStoragePort();
  });

  it('get returns all items for null keys', async () => {
    port.seed({ foo: 'bar', baz: 42 });
    const result = await port.get(null);
    expect(result).toEqual({ foo: 'bar', baz: 42 });
  });

  it('get returns selected items for array keys', async () => {
    port.seed({ foo: 'bar', baz: 42 });
    const result = await port.get(['foo', 'missing']);
    expect(result).toEqual({ foo: 'bar' });
  });

  it('get returns single item for string key', async () => {
    port.seed({ foo: 'bar' });
    const result = await port.get('foo');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('get returns empty object for missing string key', async () => {
    const result = await port.get('missing');
    expect(result).toEqual({});
  });

  it('get returns empty object for unexpected key type', async () => {
    const result = await port.get(123 as unknown as string);
    expect(result).toEqual({});
  });

  it('set stores items and notifies listeners', async () => {
    const callback = vi.fn();
    port.onChanged(callback);
    await port.set({ foo: 'bar' });
    expect(callback).toHaveBeenCalledWith({ foo: 'bar' });
    expect(port.dump()).toEqual({ foo: 'bar' });
  });

  it('getBytesInUse always returns 0', async () => {
    expect(await port.getBytesInUse(null)).toBe(0);
    expect(await port.getBytesInUse('foo')).toBe(0);
    expect(await port.getBytesInUse(['foo'])).toBe(0);
  });

  it('seed and clear work as helpers', () => {
    port.seed({ foo: 'bar' });
    expect(port.dump()).toEqual({ foo: 'bar' });
    port.clear();
    expect(port.dump()).toEqual({});
  });

  // WHY: `*_version` is overloaded in this codebase. StorageTransaction writes
  // `<key>_version` as a numeric CAS generation, but every `StorageKeys` value
  // that ends in `_version` (privacy_consent_version, gemini_api_version,
  // tranco_version) is an ordinary key holding a string. The port used to infer
  // "CAS counter" from the suffix alone, so the string shape was dropped on set
  // and shadowed on get — a test double that silently answered `{}` while
  // chrome.storage.local returned the value.
  describe('*_version keys of both shapes', () => {
    it('round-trips a string-valued *_version key through all three get paths', async () => {
      await port.set({ privacy_consent_version: '2026-09-08' });

      expect(await port.get('privacy_consent_version')).toEqual({ privacy_consent_version: '2026-09-08' });
      expect(await port.get(['privacy_consent_version'])).toEqual({ privacy_consent_version: '2026-09-08' });
      expect(await port.get(null)).toEqual({ privacy_consent_version: '2026-09-08' });
      expect(port.dump()).toEqual({ privacy_consent_version: '2026-09-08' });
    });

    it('reads a string-valued *_version key that was seeded', async () => {
      port.seed({ gemini_api_version: 'v1beta', tranco_version: '2026-09-01T00:00:00Z' });

      expect(await port.get('gemini_api_version')).toEqual({ gemini_api_version: 'v1beta' });
      expect(await port.get(['gemini_api_version', 'tranco_version'])).toEqual({
        gemini_api_version: 'v1beta',
        tranco_version: '2026-09-01T00:00:00Z',
      });
    });

    it('counts a string-valued *_version key in getBytesInUse', async () => {
      port.seed({ privacy_consent_version: '2026-09-08' });

      expect(await port.getBytesInUse('privacy_consent_version')).toBeGreaterThan(0);
    });

    it('removes a *_version key of either shape', async () => {
      await port.set({ privacy_consent_version: '2026-09-08', settings: { theme: 'dark' }, settings_version: 3 });

      await port.remove(['privacy_consent_version', 'settings_version']);

      const all = await port.get(null);
      expect(all['privacy_consent_version']).toBeUndefined();
      expect(all['settings_version']).toBeUndefined();
      expect(all['settings']).toEqual({ theme: 'dark' });
    });

    it('keeps a numeric *_version key readable as a CAS generation (regression guard)', async () => {
      await port.set({ settings: { theme: 'dark' }, settings_version: 3 });

      expect(await port.get('settings_version')).toEqual({ settings_version: 3 });
      expect(await port.get(['settings', 'settings_version'])).toEqual({
        settings: { theme: 'dark' },
        settings_version: 3,
      });
      expect(await port.get(null)).toEqual({ settings: { theme: 'dark' }, settings_version: 3 });
    });
  });
});
