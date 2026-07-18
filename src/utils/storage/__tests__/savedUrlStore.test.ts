import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../quota.js', () => ({
    STORAGE_QUOTA_BYTES: 10 * 1024 * 1024,
    getStorageUsage: vi.fn(),
    estimateDataSize: vi.fn((data: unknown) => new Blob([JSON.stringify(data || {})]).size),
    hasUnlimitedStorage: vi.fn(),
}));

vi.mock('../optimisticLock.js', () => ({
    withOptimisticLock: vi.fn(async (key: string, fn: (data: unknown) => unknown) => {
        const result = await chrome.storage.local.get(key);
        const current = result[key];
        const updated = fn(current ?? []);
        await chrome.storage.local.set({ [key]: updated });
        return updated;
    }),
}));

import { setSavedUrls } from '../savedUrlStore.js';
import { getStorageUsage, hasUnlimitedStorage } from '../quota.js';
import { STORAGE_QUOTA_BYTES } from '../quota.js';

describe('setSavedUrls', () => {
    beforeEach(async () => {
        const keys = Object.keys(await chrome.storage.local.get(null));
        if (keys.length > 0) {
            await chrome.storage.local.remove(keys);
        }
        vi.clearAllMocks();
    });

    it('skips quota check when unlimitedStorage permission is granted', async () => {
        (hasUnlimitedStorage as vi.Mock).mockResolvedValue(true);
        (getStorageUsage as vi.Mock).mockResolvedValue(STORAGE_QUOTA_BYTES + 1);

        const urlSet = new Set(['https://example.com']);
        await expect(setSavedUrls(urlSet)).resolves.toBeUndefined();

        expect(getStorageUsage).not.toHaveBeenCalled();
    });

    it('throws quota error when unlimitedStorage is not granted and usage exceeds quota', async () => {
        (hasUnlimitedStorage as vi.Mock).mockResolvedValue(false);
        (getStorageUsage as vi.Mock).mockResolvedValue(STORAGE_QUOTA_BYTES - 1);

        const largeUrlSet = new Set([`https://example.com/${'x'.repeat(1024 * 1024)}`]);
        await expect(setSavedUrls(largeUrlSet)).rejects.toThrow('Storage quota exceeded');
    });

    it('saves normally when unlimitedStorage is not granted but usage is under quota', async () => {
        (hasUnlimitedStorage as vi.Mock).mockResolvedValue(false);
        (getStorageUsage as vi.Mock).mockResolvedValue(0);

        const urlSet = new Set(['https://example.com']);
        await expect(setSavedUrls(urlSet)).resolves.toBeUndefined();

        const stored = await chrome.storage.local.get('savedUrls');
        expect(stored.savedUrls).toEqual(['https://example.com']);
    });
});
