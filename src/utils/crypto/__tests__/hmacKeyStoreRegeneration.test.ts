/**
 * hmacKeyStoreRegeneration.test.ts (PBI 2026-09-30-05)
 *
 * Key regeneration stays fail-open, but must leave an audit trail and keep the
 * old envelope (one generation) instead of destroying it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { logErrorMock, logWarnMock } = vi.hoisted(() => ({
    logErrorMock: vi.fn(async () => undefined),
    logWarnMock: vi.fn(async () => undefined),
}));
vi.mock('../../logger/api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../logger/api.js')>()),
    logError: logErrorMock,
    logWarn: logWarnMock,
}));

import { getConsentHmacKey } from '../hmacKeyStore.js';
import { setDurableKeyStorageOverride } from '../durableKeyStore.js';

const ENVELOPE_KEY = 'privacy-consent-signature-key';
const QUARANTINE_KEY = 'privacy-consent-signature-key-quarantine';
const durableStore = new Map<string, CryptoKey>();

function installDurable(failPut = false): void {
    setDurableKeyStorageOverride({
        get: async () => durableStore.get('kek-v1') ?? null,
        put: async (key) => {
            if (failPut) throw new Error('idb down');
            durableStore.set('kek-v1', key);
        },
    });
}

describe('HMAC key regeneration visibility', () => {
    beforeEach(async () => {
        durableStore.clear();
        logErrorMock.mockClear();
        logWarnMock.mockClear();
        installDurable();
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
    });

    it('quarantines the old envelope before regenerating and logs with an error code', async () => {
        await getConsentHmacKey();
        const original = (await chrome.storage.local.get(ENVELOPE_KEY))[ENVELOPE_KEY];

        await chrome.storage.session.clear();
        durableStore.clear();
        await getConsentHmacKey();

        const after = await chrome.storage.local.get([ENVELOPE_KEY, QUARANTINE_KEY]);
        expect(after[QUARANTINE_KEY]).toEqual(original);
        expect(after[ENVELOPE_KEY]).not.toEqual(original);
        expect(logErrorMock).toHaveBeenCalledTimes(1);
        const call = logErrorMock.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
        expect(call[2]).toBe('CRPT_HMAC_001');
        expect(JSON.stringify(call[1])).not.toContain((original as { wrapped: string }).wrapped);
    });

    it('does not quarantine or log when the envelope unwraps normally', async () => {
        await getConsentHmacKey();
        await chrome.storage.session.clear();
        await getConsentHmacKey();
        const after = await chrome.storage.local.get(QUARANTINE_KEY);
        expect(after[QUARANTINE_KEY]).toBeUndefined();
        expect(logErrorMock).not.toHaveBeenCalled();
    });

    it('keeps only one quarantine generation', async () => {
        await getConsentHmacKey();
        await chrome.storage.session.clear();
        durableStore.clear();
        await getConsentHmacKey();
        const second = (await chrome.storage.local.get(ENVELOPE_KEY))[ENVELOPE_KEY];
        await chrome.storage.session.clear();
        durableStore.clear();
        await getConsentHmacKey();
        const after = await chrome.storage.local.get(QUARANTINE_KEY);
        expect(after[QUARANTINE_KEY]).toEqual(second);
    });

    it('logs a warning when the durable KEK cannot be saved, and still returns a key', async () => {
        installDurable(true);
        const key = await getConsentHmacKey();
        expect(key).toBeTruthy();
        expect(logWarnMock).toHaveBeenCalled();
    });
});
