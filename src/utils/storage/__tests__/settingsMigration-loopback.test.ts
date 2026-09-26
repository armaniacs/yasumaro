/**
 * settingsMigration-loopback.test.ts
 * Pins the one-time grandfathering that keeps pre-tightening loopback
 * provider configs working across the isProviderOriginAuthorized change:
 * loopback URLs stored in non-local slots were auto-authorized before and
 * must be seeded into CONFIRMED_PROVIDER_ORIGINS once on update.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageKeys } from '../types.js';
import { migrateLoopbackProviderOriginConfirmations } from '../settingsMigration.js';
import { __resetStorageTransactionForTest } from '../storageTransaction.js';

const DONE_KEY = 'provider_loopback_origin_grandfather_done';

describe('migrateLoopbackProviderOriginConfirmations', () => {
    let storageData: Record<string, unknown>;
    let originalGet: unknown;
    let originalSet: unknown;

    beforeEach(() => {
        storageData = {
            settings: {},
            settings_version: 0,
        };
        originalGet = globalThis.chrome.storage.local.get;
        originalSet = globalThis.chrome.storage.local.set;
        (globalThis.chrome.storage.local.get as unknown) = vi.fn((keys: unknown) => {
            if (keys === null) return Promise.resolve({ ...storageData });
            if (typeof keys === 'string') return Promise.resolve({ [keys]: storageData[keys] });
            if (Array.isArray(keys)) {
                const out: Record<string, unknown> = {};
                for (const k of keys) out[k] = storageData[k];
                return Promise.resolve(out);
            }
            return Promise.resolve({});
        });
        (globalThis.chrome.storage.local.set as unknown) = vi.fn((obj: Record<string, unknown>) => {
            Object.assign(storageData, obj);
            return Promise.resolve();
        });
        __resetStorageTransactionForTest();
    });

    afterEach(() => {
        (globalThis.chrome.storage.local.get as unknown) = originalGet;
        (globalThis.chrome.storage.local.set as unknown) = originalSet;
        __resetStorageTransactionForTest();
    });

    function storedSettings(): Record<string, unknown> {
        return storageData['settings'] as Record<string, unknown>;
    }

    it('seeds a stored loopback URL in a non-local slot as a confirmed origin', async () => {
        storageData['settings'] = {
            [StorageKeys.PROVIDER_BASE_URL]: 'http://localhost:11434/v1',
        };

        const seeded = await migrateLoopbackProviderOriginConfirmations();

        expect(seeded).toBe(true);
        const confirmed = storedSettings()[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] as Record<string, string[]>;
        expect(confirmed[StorageKeys.PROVIDER_BASE_URL]).toEqual(['http://localhost:11434']);
        expect(storageData[DONE_KEY]).toBe(true);
    });

    it('does not seed the 127.x OPENAI_2 default — the deny layer already rejected it before the tightening', async () => {
        // The shipped default openai_2_base_url is http://127.0.0.1:11434/v1.
        // isAllowedProviderBaseUrl blocks 127.x for non-local slots (unchanged
        // by this branch), so there is no previously-working state to restore
        // and a seeded confirmation would be a dead entry.
        storageData['settings'] = {};

        const seeded = await migrateLoopbackProviderOriginConfirmations();

        expect(seeded).toBe(false);
        expect(storedSettings()[StorageKeys.CONFIRMED_PROVIDER_ORIGINS]).toBeUndefined();
        expect(storageData[DONE_KEY]).toBe(true);
    });

    it('does not seed non-loopback URLs and leaves local slots untouched', async () => {
        storageData['settings'] = {
            [StorageKeys.PROVIDER_BASE_URL]: 'https://api.example.com/v1',
            [StorageKeys.LM_STUDIO_BASE_URL]: 'http://127.0.0.1:1234/v1',
        };

        const seeded = await migrateLoopbackProviderOriginConfirmations();

        expect(seeded).toBe(false);
        expect(storedSettings()[StorageKeys.CONFIRMED_PROVIDER_ORIGINS]).toBeUndefined();
        expect(storageData[DONE_KEY]).toBe(true);
    });

    it('is a no-op once the done flag is set', async () => {
        storageData['settings'] = {
            [StorageKeys.PROVIDER_BASE_URL]: 'http://localhost:11434/v1',
        };
        storageData[DONE_KEY] = true;

        const seeded = await migrateLoopbackProviderOriginConfirmations();

        expect(seeded).toBe(false);
        expect(storedSettings()[StorageKeys.CONFIRMED_PROVIDER_ORIGINS]).toBeUndefined();
    });

    it('preserves already-confirmed origins and skips duplicates', async () => {
        storageData['settings'] = {
            [StorageKeys.PROVIDER_BASE_URL]: 'http://localhost:11434/v1',
            [StorageKeys.CONFIRMED_PROVIDER_ORIGINS]: {
                [StorageKeys.OPENAI_BASE_URL]: ['https://custom.example.com'],
            },
        };

        await migrateLoopbackProviderOriginConfirmations();

        const confirmed = storedSettings()[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] as Record<string, string[]>;
        expect(confirmed[StorageKeys.OPENAI_BASE_URL]).toEqual(['https://custom.example.com']);
        expect(confirmed[StorageKeys.PROVIDER_BASE_URL]).toEqual(['http://localhost:11434']);
    });

    it('does not re-seed a loopback URL after the flag is set, even when changed', async () => {
        storageData['settings'] = {
            [StorageKeys.PROVIDER_BASE_URL]: 'http://localhost:11434/v1',
        };
        await migrateLoopbackProviderOriginConfirmations();

        // A later change to a different loopback URL goes through the normal
        // confirmation dialog — the migration must stay out of the way.
        const settings = storedSettings() as Record<string, unknown>;
        settings[StorageKeys.PROVIDER_BASE_URL] = 'http://127.0.0.1:8080/v1';
        const seededAgain = await migrateLoopbackProviderOriginConfirmations();

        expect(seededAgain).toBe(false);
        const confirmed = storedSettings()[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] as Record<string, string[]>;
        expect(confirmed[StorageKeys.PROVIDER_BASE_URL]).toEqual(['http://localhost:11434']);
    });
});
