/**
 * recoveryClaimStore.test.ts
 * The durable recovery claim — one owner per recording URL across manual
 * re-runs and the offline queue processor. Drives the real withOptimisticLock
 * over an in-memory chrome.storage.local mock so the CAS behavior is the
 * production one. TTL is exercised through a controlled clock, never by waiting
 * it out.
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

import { claimRecoveryOwner, releaseRecoveryOwner, createRecoveryClaimStore } from '../recoveryClaimStore.js';

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

const TTL_MS = 10 * 60 * 1000;

describe('expired-claim sweep', () => {
    beforeEach(() => {
        mockStorage[CLAIMS_KEY] = undefined;
        vi.clearAllMocks();
    });

    it('removes an expired claim when another URL takes a claim', async () => {
        // Only Date is faked: the CAS path must keep running on real timers.
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const t0 = new Date('2026-10-01T00:00:00Z').getTime();
            vi.setSystemTime(t0);
            await expect(claimRecoveryOwner('https://stale.example', 'offline-queue')).resolves.toBe(true);

            vi.setSystemTime(t0 + TTL_MS - 1);
            await expect(claimRecoveryOwner('https://fresh.example', 'manual')).resolves.toBe(true);

            vi.setSystemTime(t0 + TTL_MS + 1);
            await expect(claimRecoveryOwner('https://new.example', 'manual')).resolves.toBe(true);

            // The stale URL is gone without having been claimed again, the two
            // live claims survive, and the map holds nothing expired.
            expect(readClaims()['https://stale.example']).toBeUndefined();
            expect(readClaims()['https://fresh.example']).toMatchObject({ owner: 'manual' });
            expect(readClaims()['https://new.example']).toMatchObject({ owner: 'manual' });
            expect(Object.keys(readClaims())).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a refused claim untouched, sweep included', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const t0 = new Date('2026-10-01T00:00:00Z').getTime();
            vi.setSystemTime(t0);
            await expect(claimRecoveryOwner('https://stale.example', 'offline-queue')).resolves.toBe(true);

            // Claimed a minute later, so it outlives the older entry.
            vi.setSystemTime(t0 + 60_000);
            await expect(claimRecoveryOwner('https://held.example', 'offline-queue')).resolves.toBe(true);

            vi.setSystemTime(t0 + TTL_MS + 1);
            await expect(claimRecoveryOwner('https://held.example', 'manual')).resolves.toBe(false);

            // A refused claim writes nothing, so the entry that is already
            // expired stays until some claim is actually taken.
            expect(readClaims()['https://held.example']).toMatchObject({ owner: 'offline-queue' });
            expect(readClaims()['https://stale.example']).toMatchObject({ owner: 'offline-queue' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('reads the TTL from the injected time source', async () => {
        let clock = 1_700_000_000_000;
        const store = createRecoveryClaimStore({ now: () => clock });

        await expect(store.claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(true);

        clock += TTL_MS - 1;
        await expect(store.claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(false);

        clock += 1;
        await expect(store.claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);
        expect(readClaims()['https://example.com']).toMatchObject({
            owner: 'offline-queue',
            claimedAt: 1_700_000_000_000 + TTL_MS,
        });
    });
});

describe('claim TTL boundary', () => {
    beforeEach(() => {
        mockStorage[CLAIMS_KEY] = undefined;
        vi.clearAllMocks();
    });

    it('holds a claim one millisecond short of the TTL and re-claims it at the TTL', async () => {
        // Freshness is `age < TTL`, so the claim stops being fresh exactly at
        // the TTL and no millisecond later.
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const t0 = new Date('2026-10-01T00:00:00Z').getTime();
            vi.setSystemTime(t0);
            await expect(claimRecoveryOwner('https://example.com', 'offline-queue')).resolves.toBe(true);

            vi.setSystemTime(t0 + TTL_MS - 1);
            await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(false);
            expect(readClaims()['https://example.com']).toMatchObject({ owner: 'offline-queue' });

            vi.setSystemTime(t0 + TTL_MS);
            await expect(claimRecoveryOwner('https://example.com', 'manual')).resolves.toBe(true);
            expect(readClaims()['https://example.com']).toMatchObject({
                owner: 'manual',
                claimedAt: t0 + TTL_MS,
            });
        } finally {
            vi.useRealTimers();
        }
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
