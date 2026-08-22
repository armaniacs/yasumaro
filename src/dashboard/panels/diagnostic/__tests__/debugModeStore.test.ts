import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDebugMode, setDebugMode } from '../debugModeStore.js';

describe('debugModeStore', () => {
  let storageGet: ReturnType<typeof vi.fn>;
  let storageSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storageGet = vi.fn();
    storageSet = vi.fn().mockResolvedValue(undefined);
    (global as unknown as Record<string, unknown>).chrome = {
      storage: { local: { get: storageGet, set: storageSet } },
    } as unknown as typeof chrome;
  });

  it('getDebugMode returns boolean from chrome.storage.local', async () => {
    storageGet.mockResolvedValue({ debugMode: true });
    await expect(getDebugMode()).resolves.toBe(true);
    expect(storageGet).toHaveBeenCalledWith('debugMode');
  });

  it('getDebugMode returns false when key is missing or falsy', async () => {
    storageGet.mockResolvedValue({});
    await expect(getDebugMode()).resolves.toBe(false);
    storageGet.mockResolvedValue({ debugMode: 'not-boolean' });
    await expect(getDebugMode()).resolves.toBe(true);
  });

  it('setDebugMode writes the value via chrome.storage.local.set', async () => {
    await setDebugMode(true);
    expect(storageSet).toHaveBeenCalledWith({ debugMode: true });
    await setDebugMode(false);
    expect(storageSet).toHaveBeenCalledWith({ debugMode: false });
  });
});
