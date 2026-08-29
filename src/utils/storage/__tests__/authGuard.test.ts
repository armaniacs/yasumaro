import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isLocked } from '../authGuard.js';
import { StorageKeys } from '../types.js';

describe('authGuard.isLocked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when master password is not enabled', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [StorageKeys.MASTER_PASSWORD_ENABLED]: false,
      [StorageKeys.IS_LOCKED]: true,
    });

    await expect(isLocked()).resolves.toBe(false);
  });

  it('returns false when master password is enabled but not locked', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
      [StorageKeys.IS_LOCKED]: false,
    });

    await expect(isLocked()).resolves.toBe(false);
  });

  it('returns true when master password is enabled and locked', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
      [StorageKeys.IS_LOCKED]: true,
    });

    await expect(isLocked()).resolves.toBe(true);
  });

  it('returns false when both values are missing', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await expect(isLocked()).resolves.toBe(false);
  });

  it('reads the expected storage keys', async () => {
    const getMock = chrome.storage.local.get as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({});

    await isLocked();

    expect(getMock).toHaveBeenCalledWith([
      StorageKeys.MASTER_PASSWORD_ENABLED,
      StorageKeys.IS_LOCKED,
    ]);
  });
});
