/**
 * durableKeyStoreOutcome.test.ts (PBI 2026-10-21-10)
 *
 * loadDurableWrappingKey used to round an IndexedDB open/get failure and an
 * absent record into the same null, so a lost durable store was
 * indistinguishable from a fresh install at the KEK chain terminal. The
 * discriminated union keeps the two facts apart; the production call site
 * still regenerates on either outcome (behavior unchanged) but records the
 * failure reason via the safeLog + logError seam (PBI 14).
 *
 * The absent/failure/loaded distinction is pinned through the test-only
 * storage override; the real IndexedDB plumbing is covered by
 * idbKeystoreContract.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

const { logErrorMock, logWarnMock } = vi.hoisted(() => ({
    logErrorMock: vi.fn(async () => undefined),
    logWarnMock: vi.fn(async () => undefined),
}));
vi.mock('../../logger/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../logger/api.js')>()),
    logError: logErrorMock,
    logWarn: logWarnMock,
}));

import { loadDurableWrappingKey, setDurableKeyStorageOverride } from '../durableKeyStore.js';
import { getConsentHmacKey, setWrappingKeyStoresOverride } from '../hmacKeyStore.js';

const KEY_ID = 'kek-v1';

async function sampleKey(): Promise<CryptoKey> {
    return (await webcrypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    )) as CryptoKey;
}

describe('durableKeyStore', () => {
    afterEach(() => {
        setDurableKeyStorageOverride(null);
        setWrappingKeyStoresOverride(null);
    });

    describe('loadDurableWrappingKey', () => {
        it('reports a missing record as absent (safe to regenerate)', async () => {
            setDurableKeyStorageOverride({ get: async () => null, put: async () => undefined });

            expect(await loadDurableWrappingKey()).toEqual({ outcome: 'absent' });
        });

        it('reports no durable storage in this environment as absent', async () => {
            // The node environment has no IndexedDB and no override: there is
            // no store yet, which is an absent record, not a failed store.
            setDurableKeyStorageOverride(null);

            expect(await loadDurableWrappingKey()).toEqual({ outcome: 'absent' });
        });

        it('reports a failed read as failure with the reason, not as absent', async () => {
            setDurableKeyStorageOverride({
                get: async () => {
                    throw new Error('durable read failed');
                },
                put: async () => undefined,
            });

            const result = await loadDurableWrappingKey();
            if (result.outcome !== 'failure') {
                throw new Error(`expected failure, got: ${result.outcome}`);
            }
            expect(result.error.message).toBe('durable read failed');
        });

        it('reports a failed open as failure as well', async () => {
            setDurableKeyStorageOverride({
                get: async () => {
                    throw new Error('open denied');
                },
                put: async () => undefined,
            });

            const result = await loadDurableWrappingKey();
            if (result.outcome !== 'failure') {
                throw new Error(`expected failure, got: ${result.outcome}`);
            }
            expect(result.error.message).toBe('open denied');
        });

        it('reports a persisted key as loaded', async () => {
            const key = await sampleKey();
            setDurableKeyStorageOverride({ get: async () => key, put: async () => undefined });

            expect(await loadDurableWrappingKey()).toEqual({ outcome: 'loaded', key });
        });
    });
});

describe('hmacKeyStore', () => {
    afterEach(() => {
        setDurableKeyStorageOverride(null);
        setWrappingKeyStoresOverride(null);
    });

    describe('KEK candidate chain terminal (durable candidate)', () => {
        // In-memory durable store — stands in for IndexedDB. The read always
        // fails, so the durable candidate reports a failure, not an absence.
        const durableStore = new Map<string, CryptoKey>();

        beforeEach(async () => {
            durableStore.clear();
            setDurableKeyStorageOverride({
                get: async () => {
                    throw new Error('durable read failed');
                },
                put: async (key) => {
                    durableStore.set(KEY_ID, key);
                },
            });
            setWrappingKeyStoresOverride({
                getSession: async () => undefined,
                getLegacyLocal: async () => undefined,
            });
            logErrorMock.mockClear();
            logWarnMock.mockClear();
            await chrome.storage.local.clear();
            await chrome.storage.session.clear();
        });

        it('still generates and persists a fresh KEK when the durable read fails (behavior unchanged)', async () => {
            const key = await getConsentHmacKey();

            expect(key).toBeTruthy();
            expect(durableStore.get(KEY_ID)).toBeTruthy();
        });

        it('logs the durable failure reason via the safeLog seam before regenerating', async () => {
            await getConsentHmacKey();

            expect(logErrorMock).toHaveBeenCalledTimes(1);
            const call = logErrorMock.mock.calls[0] as unknown as [string, Record<string, unknown>, string, string];
            expect(call[0]).toContain('durable HMAC wrapping key');
            expect(String(call[1].error)).toBe('durable read failed');
            expect(call[2]).toBe('CRPT_HMAC_001');
            expect(call[3]).toBe('hmacKeyStore.ts');
        });

        it('does not log when the durable record is merely absent', async () => {
            setDurableKeyStorageOverride({
                get: async () => durableStore.get(KEY_ID) ?? null,
                put: async (key) => {
                    durableStore.set(KEY_ID, key);
                },
            });

            await getConsentHmacKey();

            expect(logErrorMock).not.toHaveBeenCalled();
        });
    });
});
