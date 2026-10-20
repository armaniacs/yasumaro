/**
 * encryptionSession-hmac-quarantine.test.ts (PBI 2026-10-18-15, scenario 3)
 *
 * getOrCreateHmacSecret gives the settings-export HMAC secret the same
 * quarantine path as the consent and notification HMAC keys: when the KEK is
 * lost and unwrap fails, the old wrapped envelope is quarantined under
 * "hmac_secret-quarantine" BEFORE the regeneration overwrites it, and a
 * quarantine failure stays observable instead of being swallowed. This file
 * used to pin the asymmetry (consent keys quarantine, HMAC_SECRET did not);
 * the fix flips the expectation to "both have it".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { logErrorMock, logWarnMock } = vi.hoisted(() => ({
    logErrorMock: vi.fn(async (_message?: string) => undefined),
    logWarnMock: vi.fn(async (_message?: string) => undefined),
}));
vi.mock('../../logger/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../logger/api.js')>()),
    logError: logErrorMock,
    logWarn: logWarnMock,
}));

import { clearEncryptionKeyCache, getOrCreateHmacSecret } from '../encryptionSession.js';
import { setDurableKeyStorageOverride } from '../../crypto/durableKeyStore.js';
import { StorageKeys } from '../types.js';

const ENVELOPE_KEY = StorageKeys.HMAC_SECRET;
const QUARANTINE_KEY = `${StorageKeys.HMAC_SECRET}-quarantine`;
const durableStore = new Map<string, CryptoKey>();

function installDurable(): void {
    setDurableKeyStorageOverride({
        get: async () => durableStore.get('kek-v1') ?? null,
        put: async (key) => {
            durableStore.set('kek-v1', key);
        },
    });
}

// Lose every KEK candidate (session cache + durable store) so the next unwrap
// resolves against a freshly generated KEK and fails: the KEK-loss condition
// of scenario 3, reproduced the same way as hmacKeyStoreRegeneration.test.ts.
async function loseKek(): Promise<void> {
    await chrome.storage.session.clear();
    durableStore.clear();
}

describe('getOrCreateHmacSecret quarantine (PBI 2026-10-18-15)', () => {
    beforeEach(async () => {
        clearEncryptionKeyCache();
        logErrorMock.mockClear();
        logWarnMock.mockClear();
        installDurable();
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
    });

    it('quarantines the old envelope before regenerating', async () => {
        const first = await getOrCreateHmacSecret();
        const original = (await chrome.storage.local.get(ENVELOPE_KEY))[ENVELOPE_KEY];
        expect(original).toHaveProperty('wrapped');

        // Drop the module-scope secret cache so the next call actually re-reads
        // and unwraps the stored envelope (cachedHmacSecret otherwise
        // short-circuits and the rotation is never exercised).
        clearEncryptionKeyCache();
        await loseKek();
        const second = await getOrCreateHmacSecret();

        expect(second).not.toBe(first);
        const after = await chrome.storage.local.get([ENVELOPE_KEY, QUARANTINE_KEY]);
        expect(after[QUARANTINE_KEY]).toEqual(original);
        expect(after[ENVELOPE_KEY]).not.toEqual(original);
    });

    it('completes the quarantine write before the overwrite (storage.local.set order)', async () => {
        await getOrCreateHmacSecret();
        clearEncryptionKeyCache();
        await loseKek();

        const setSpy = vi.spyOn(chrome.storage.local, 'set');
        // spyOn lands on the shared setup mock, which already recorded the
        // first call's envelope write; drop it so only the failing flow's
        // writes are compared.
        setSpy.mockClear();
        try {
            await getOrCreateHmacSecret();

            // storage.local.set order: the quarantine write must complete before
            // the regeneration overwrites the envelope, otherwise the old
            // envelope is destroyed before the quarantine can hold it.
            const quarantineIndex = setSpy.mock.calls.findIndex(
                ([payload]) => QUARANTINE_KEY in (payload as object)
            );
            const overwriteIndex = setSpy.mock.calls.findIndex(
                ([payload]) => ENVELOPE_KEY in (payload as object)
            );
            expect(quarantineIndex).toBeGreaterThanOrEqual(0);
            expect(overwriteIndex).toBeGreaterThan(quarantineIndex);
        } finally {
            setSpy.mockRestore();
        }

        const after = await chrome.storage.local.get([ENVELOPE_KEY, QUARANTINE_KEY]);
        expect(after[QUARANTINE_KEY]).toBeDefined();
    });

    it('logs a quarantine failure instead of swallowing it, and still regenerates', async () => {
        await getOrCreateHmacSecret();
        clearEncryptionKeyCache();
        await loseKek();

        const setSpy = vi.spyOn(chrome.storage.local, 'set');
        // The first storage.local.set in the failing flow is the quarantine
        // write (the unwrap failure itself is logged through the mocked logger,
        // which never touches storage.local), so a single one-shot rejection
        // fails exactly the quarantine.
        setSpy.mockClear();
        setSpy.mockRejectedValueOnce(new Error('quota exceeded'));
        try {
            const second = await getOrCreateHmacSecret();
            // Regeneration itself is not blocked (fail-open availability).
            expect(typeof second).toBe('string');
            const stored = (await chrome.storage.local.get(ENVELOPE_KEY))[ENVELOPE_KEY];
            expect(stored).toHaveProperty('wrapped');

            const messages = logErrorMock.mock.calls.map((call) => call[0]);
            expect(messages).toContain('Failed to quarantine the old HMAC secret envelope before regenerating');
            expect(messages).toContain('Failed to unwrap HMAC secret, regenerating');
        } finally {
            setSpy.mockRestore();
        }
    });

    it('does not quarantine when the envelope unwraps normally (regression guard)', async () => {
        await getOrCreateHmacSecret();
        // Only the session cache is lost; the durable store still holds the KEK,
        // so the stored envelope still unwraps and no quarantine is written.
        await chrome.storage.session.clear();
        const second = await getOrCreateHmacSecret();
        expect(typeof second).toBe('string');

        const after = await chrome.storage.local.get(QUARANTINE_KEY);
        expect(after[QUARANTINE_KEY]).toBeUndefined();
        expect(logErrorMock).not.toHaveBeenCalled();
    });
});
