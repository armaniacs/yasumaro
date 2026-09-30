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

import { claimRecoveryOwner, releaseRecoveryOwner } from '../recoveryClaimStore.js';

const CLAIMS_KEY = 'recording_recovery_claims';

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

/**
 * Read the claim map straight out of the storage double. The store exposes no
 * reader (every production surface goes through claim/release), so the mock is
 * the only observation point, and reading it is what a real owner would learn
 * by attempting a second claim.
 */
function readClaims(): Record<string, { url: string; owner: string; claimedAt: number }> {
    const stored = mockStorage[CLAIMS_KEY];
    return (stored ?? {}) as Record<string, { url: string; owner: string; claimedAt: number }>;
}

describe('claimRecoveryOwner', () => {
    beforeEach(() => {
        mockStorage[CLAIMS_KEY] = undefined;
        vi.clearAllMocks();
    });

    it('grants the claim when no other owner holds it', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(true);
        expect(readClaims()['https://example.com']).toMatchObject({
            url: 'https://example.com',
            owner: 'manual',
        });
    });

    it('rejects a second claim while a fresh claim is held by another owner', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);
        await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(false);
        expect(readClaims()['https://example.com']).toMatchObject({ owner: 'offline-queue' });
    });

    it('takes over an expired claim', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);
        // Age the claim past the 10-minute TTL.
        const first = readClaims()['https://example.com'];
        if (first === undefined) throw new Error('claim missing');
        first.claimedAt = Date.now() - 11 * 60 * 1000;
        await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(true);
        expect(readClaims()['https://example.com']).toMatchObject({ owner: 'manual' });
    });

    it('claims different URLs independently', async () => {
        await expect(claimRecoveryOwner('https://a.example', 'offline-queue')).resolves.toBe(true);
        await expect(claimRecoveryOwner('https://b.example', 'manual')).resolves.toBe(true);
        expect(readClaims()['https://a.example']).toMatchObject({ owner: 'offline-queue' });
        expect(readClaims()['https://b.example']).toMatchObject({ owner: 'manual' });
    });

    it('grants the claim to exactly one of two concurrent owners', async () => {
        // Both callers read the same version before either writes, so the
        // loser's CAS conflicts and withLock re-runs the updater against the
        // winner's claim. A side effect left over from the first attempt would
        // make the loser report a claim it never wrote.
        const [a, b] = await Promise.all([
            claimRecoveryOwner('https://example.com', 'offline-queue'),
            claimRecoveryOwner('https://example.com', 'manual'),
        ]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
        expect(readClaims()['https://example.com']).toBeDefined();
    });
});

describe('releaseRecoveryOwner', () => {
    beforeEach(() => {
        mockStorage[CLAIMS_KEY] = undefined;
        vi.clearAllMocks();
    });

    it('releases the holder’s own claim so the URL can be re-claimed', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(true);
        await releaseRecoveryOwner('https://example.com', 'manual');
        expect(readClaims()['https://example.com']).toBeUndefined();
        await expect(claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);
    });

    it('does not release a claim held by another owner', async () => {
        await expect(claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);
        await releaseRecoveryOwner('https://example.com', 'manual');
        expect(readClaims()['https://example.com']).toMatchObject({ owner: 'offline-queue' });
    });
});
