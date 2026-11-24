import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChromeDomainPolicyPort } from '../domainPolicyPort.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { migrateToSingleSettingsObject } from '../../utils/storage/settingsMigration.js';

const getAll = vi.fn();
vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: { getAll: (...args: unknown[]) => getAll(...args) },
}));

const now = 1_700_000_000_000;
const COMPLETED = { stage: 'completed', schemaVersion: 2 };

/** Legacy (pre-fold) profile: blacklist mode with one blocked domain, scattered top-level keys. */
function legacyProfile(): Record<string, unknown> {
  return {
    [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
    [StorageKeys.DOMAIN_FILTER_CACHE]: [],
    [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
    [StorageKeys.DOMAIN_BLACKLIST]: ['blocked.com'],
    [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
    [StorageKeys.UBLOCK_FORMAT_ENABLED]: false,
    [StorageKeys.DOMAIN_SUBDOMAIN_MATCHING]: false,
  };
}

describe('domain policy blob-tier reader (blob first, top-level fallback)', () => {
  beforeEach(() => {
    getAll.mockReset();
  });

  it.each([
    ['policy keys only (defaults must not shadow them)', {}],
    ['with another migratable setting', { [StorageKeys.OBSIDIAN_PORT]: '27123' }],
  ])('twin: the verdict is unchanged across the settings fold: %s', async (_label, extra) => {
    const storage = new InMemoryStoragePort();
    storage.seed({ ...legacyProfile(), ...extra });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    const before = await port.checkDomainAllowedFromCache('https://blocked.com/page');
    expect(before).toEqual({ allowed: false, useCache: true });

    await migrateToSingleSettingsObject({ port: storage });

    const after = await port.checkDomainAllowedFromCache('https://blocked.com/page');
    expect(after).toEqual(before);
    expect(await port.checkDomainAllowedFromCache('https://ok.com/')).toEqual({ allowed: true, useCache: true });
  });

  it('twin: content verdict equals the service worker verdict on a folded database', async () => {
    const { isDomainAllowed } = await import('../../utils/domainUtils.js');
    const storage = new InMemoryStoragePort();
    storage.seed(legacyProfile());
    await migrateToSingleSettingsObject({ port: storage });
    getAll.mockResolvedValue({
      [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
      [StorageKeys.DOMAIN_BLACKLIST]: ['blocked.com'],
      [StorageKeys.DOMAIN_SUBDOMAIN_MATCHING]: false,
      [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
      [StorageKeys.UBLOCK_FORMAT_ENABLED]: false,
    });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    const content = await port.checkDomainAllowedFromCache('https://blocked.com/page');
    expect(content.allowed).toBe(await isDomainAllowed('https://blocked.com/page'));
    expect(content.allowed).toBe(false);
  });

  it('fails closed when blob and top-level copies disagree (PBI 2026-11-24-17)', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed({
      ...legacyProfile(),
      [StorageKeys.DOMAIN_BLACKLIST]: ['stale.com'],
      settings_migrated: COMPLETED,
      settings: { [StorageKeys.DOMAIN_BLACKLIST]: ['blocked.com'] },
    });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    expect(await port.checkDomainAllowedFromCache('https://blocked.com/')).toEqual({ allowed: false, useCache: false });
    expect(await port.checkDomainAllowedFromCache('https://stale.com/')).toEqual({ allowed: false, useCache: false });
  });

  it('fails closed on a skewed flag instead of trusting the permissive side (PBI 2026-11-24-17)', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed({
      ...legacyProfile(),
      [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
      settings_migrated: COMPLETED,
      settings: { [StorageKeys.SIMPLE_FORMAT_ENABLED]: false },
    });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    expect(await port.checkDomainAllowedFromCache('https://blocked.com/')).toEqual({ allowed: false, useCache: false });
  });

  it('falls back to the top-level copy when the blob does not hold the key', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed({ ...legacyProfile(), settings_migrated: COMPLETED, settings: {} });
    const port = new ChromeDomainPolicyPort(storage, () => now);
    expect((await port.checkDomainAllowedFromCache('https://blocked.com/')).allowed).toBe(false);
  });

  it('reads the blob tier in the same single get as the mirror keys', async () => {
    const storage = new InMemoryStoragePort();
    storage.seed(legacyProfile());
    const spy = vi.spyOn(storage, 'get');
    const port = new ChromeDomainPolicyPort(storage, () => now);
    await port.checkDomainAllowedFromCache('https://blocked.com/');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
