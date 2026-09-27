/**
 * recoveryClaimStore.test.ts
 * PBI 2026-09-25-12: the durable recovery claim — one owner per recording
 * URL across manual re-runs and the offline queue processor. Drives the real
 * withOptimisticLock over an in-memory chrome.storage.local mock so the CAS
 * behavior is the production one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./logger/types.js', () => ({
    logInfo: vi.fn().mockResolvedValue(undefined),
    logDebug: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
}));
vi.mock('./logger/core.js', () => ({
    logInfo: vi.fn().mockResolvedValue(undefined),
    logDebug: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
}));
vi.mock('./logger/api.js', () => ({
    logInfo: vi.fn().mockResolvedValue(undefined),
    logDebug: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
}));

import { claimRecoveryOwner, releaseRecoveryOwner, getRecoveryOwner } from '../recoveryClaimStore.js';

const mockStorage: Record<string, unknown> = {};

const mockChrome = {
    storage: {
        local: {
            get: vi.fn((keys: string | string[] | null) => {
                if (keys === null) return Promise.resolve({ ...mockStorage });
                if (Array.isArray(keys)) {
                    const result: Record<string, unknown> = {};
                    for (const key of keys) {
                        if (key in mockStorage) result[key] = mockStorage[key];
                    }
                    return Promise.resolve(result);
                }
                if (typeof keys === 'string') {
                    return Promise.resolve({ [keys]: mockStorage[keys] });
                }
                return Promise.resolve({});
            }),
            set: vi.fn((items: Record<string, unknown>) => {
                Object.assign(mockStorage, items);
                return Promise.resolve();
            }),
            remove: vi.fn((keys: string | string[]) => {
                if (Array.isArray(keys)) {
                    for (const key of keys) delete mockStorage[key];
                } else {
                    delete mockStorage[keys];
                }
                return Promise.resolve();
            }),
        },
    },
};

global.chrome = mockChrome as unknown as typeof chrome;

describe('claimRecoveryOwner', () => {
    beforeEach(() => {
        mockStorage['recording_recovery_claims'] = undefined;
        vi.clearAllMocks();
    });

    it('grants the claim when no other owner holds it', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(true);
        await expect(getRecoveryOwner('https://example.com')).resolves.toMatchObject({
            url: 'https://example.com',
            owner: 'manual',
        });
    });

    it('rejects a second claim while a fresh claim is held by another owner', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);
        await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(false);
        await expect(getRecoveryOwner('https://example.com')).resolves.toMatchObject({ owner: 'offline-queue' });
    });

    it('takes over an expired claim', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);
        // Age the claim past the 10-minute TTL.
        const claims = mockStorage['recording_recovery_claims'] as Record<string, { claimedAt: number }>;
        claims['https://example.com'].claimedAt = Date.now() - 11 * 60 * 1000;
        await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(true);
        await expect(getRecoveryOwner('https://example.com')).resolves.toMatchObject({ owner: 'manual' });
    });

    it('claims different URLs independently', async () => {
        await expect(claimRecoveryOwner('https://a.example', 'offline-queue')).resolves.toBe(true);
        await expect(claimRecoveryOwner('https://b.example', 'manual')).resolves.toBe(true);
        await expect(getRecoveryOwner('https://a.example')).resolves.toMatchObject({ owner: 'offline-queue' });
        await expect(getRecoveryOwner('https://b.example')).resolves.toMatchObject({ owner: 'manual' });
    });
});

describe('releaseRecoveryOwner', () => {
    beforeEach(() => {
        mockStorage['recording_recovery_claims'] = undefined;
        vi.clearAllMocks();
    });

    it('releases the holder’s own claim so the URL can be re-claimed', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(true);
        await releaseRecoveryOwner('https://example.com', 'manual');
        await expect(getRecoveryOwner('https://example.com')).resolves.toBeNull();
        await expect(claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);
    });

    it('does not release a claim held by another owner', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);
        await releaseRecoveryOwner('https://example.com', 'manual');
        await expect(getRecoveryOwner('https://example.com')).resolves.toMatchObject({ owner: 'offline-queue' });
    });
});
