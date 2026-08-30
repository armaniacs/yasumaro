import { describe, it, expect, beforeEach } from 'vitest';
import { StorageKeys } from '../types.js';
import { DEFAULT_SETTINGS } from '../defaults.js';
import { SettingsRepository, InMemoryStorageAdapter } from '../SettingsRepository.js';

describe('domainCleansingOverrides storage', () => {
    let repo: SettingsRepository;
    let adapter: InMemoryStorageAdapter;

    beforeEach(async () => {
        adapter = new InMemoryStorageAdapter();
        // Provide dummy keyProvider to avoid real crypto
        const dummyKey = await (async () => {
            // Use a no-op keyProvider that returns a dummy CryptoKey — SettingsRepository will still try to encrypt API keys,
            // but we have no API keys in this test, so it won't be called. Provide one anyway.
            const { getOrCreateEncryptionKey } = await import('../encryptionSession.js');
            return getOrCreateEncryptionKey;
        })();
        repo = new SettingsRepository(adapter, { keyProvider: dummyKey as unknown as () => Promise<CryptoKey> });
    });

    it('default is empty array', () => {
        expect(DEFAULT_SETTINGS[StorageKeys.DOMAIN_CLEANSING_OVERRIDES]).toEqual([]);
    });

    it('round-trip via SettingsRepository', async () => {
        const overrides = [
            { domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } },
            { domain: 'other.com', overrides: { aiSummaryCleansingAds: false } },
        ];
        await repo.set(StorageKeys.DOMAIN_CLEANSING_OVERRIDES, overrides as unknown as never);
        const loaded = await repo.get(StorageKeys.DOMAIN_CLEANSING_OVERRIDES);
        expect(loaded).toEqual(overrides);
    });

    it('persists through getAll', async () => {
        const overrides = [{ domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } }];
        await repo.setAll({ [StorageKeys.DOMAIN_CLEANSING_OVERRIDES]: overrides } as unknown as Record<string, unknown>);
        const all = await repo.getAll();
        expect((all as Record<string, unknown>)[StorageKeys.DOMAIN_CLEANSING_OVERRIDES]).toEqual(overrides);
    });

    it('overrides do not affect other keys', async () => {
        const overrides = [{ domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } }];
        await repo.set(StorageKeys.DOMAIN_CLEANSING_OVERRIDES, overrides as unknown as never);
        const list = await repo.get(StorageKeys.DOMAIN_WHITELIST);
        expect(list).toEqual(DEFAULT_SETTINGS[StorageKeys.DOMAIN_WHITELIST]);
    });
});
