import { describe, it, expect, vi } from 'vitest';
import { hasUnlimitedStorage, STORAGE_QUOTA_BYTES } from '../quota.js';

describe('quota helpers', () => {
    describe('STORAGE_QUOTA_BYTES', () => {
        it('matches chrome.storage.local.QUOTA_BYTES (10MB)', () => {
            expect(STORAGE_QUOTA_BYTES).toBe(10 * 1024 * 1024);
        });
    });

    describe('hasUnlimitedStorage', () => {
        it('returns true when chrome.permissions.contains resolves true', async () => {
            (chrome.permissions.contains as vi.Mock).mockResolvedValueOnce(true);
            expect(await hasUnlimitedStorage()).toBe(true);
            expect(chrome.permissions.contains).toHaveBeenCalledWith({ permissions: ['unlimitedStorage'] });
        });

        it('returns false when chrome.permissions.contains resolves false', async () => {
            (chrome.permissions.contains as vi.Mock).mockResolvedValueOnce(false);
            expect(await hasUnlimitedStorage()).toBe(false);
        });

        it('returns false when chrome.permissions is undefined', async () => {
            const originalPermissions = chrome.permissions;
            // @ts-expect-error - simulate missing permissions API
            chrome.permissions = undefined;
            expect(await hasUnlimitedStorage()).toBe(false);
            chrome.permissions = originalPermissions;
        });

        it('returns false when chrome.permissions.contains throws', async () => {
            (chrome.permissions.contains as vi.Mock).mockRejectedValueOnce(new Error('API unavailable'));
            expect(await hasUnlimitedStorage()).toBe(false);
        });
    });
});
