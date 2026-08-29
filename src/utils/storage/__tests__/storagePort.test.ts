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

    const listener = addListener.mock.calls[0][0];
    listener({ key: { newValue: 'value', oldValue: 'old' } }, 'local');
    expect(callback).toHaveBeenCalledWith({ key: 'value' });
  });

  it('onChanged ignores non-local areas', () => {
    const callback = vi.fn();
    const addListener = chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>;
    port.onChanged(callback);

    const listener = addListener.mock.calls[0][0];
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
});
