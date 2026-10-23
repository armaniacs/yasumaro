/**
 * domainIntelRepository.test.ts
 *
 * Roundtrip tests for the domain-intel repository seam (PBI 2026-10-23-02).
 * The contract: add/remove roundtrips through the stored blacklist, and a
 * corrupted store degrades without throwing (empty list on bad shape, the
 * default list when the read itself fails).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installTestSecretKek } from '../../crypto/__tests__/secretKekHelper.js';
import { logError } from '../../logger/api.js';
import { ErrorCode } from '../../logger/types.js';
import type { InMemoryStoragePort } from '../storagePort.js';

vi.mock('../../logger/api.js', () => ({ logError: vi.fn(() => Promise.resolve()) }));

const backing = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  failNextGetWith: null as Error | null,
}));

vi.mock('../SettingsRepository.js', () => ({
  settingsRepository: {
    get: async (key: string): Promise<unknown> => {
      if (backing.failNextGetWith !== null) {
        const error = backing.failNextGetWith;
        backing.failNextGetWith = null;
        throw error;
      }
      return backing.store.get(key);
    },
    set: async (key: string, value: unknown): Promise<void> => {
      backing.store.set(key, value);
    },
  },
}));

import {
  getDomainBlacklist,
  addDomainToBlacklist,
  removeDomainFromBlacklist,
  type DomainBlacklistStore,
} from '../domainIntelRepository.js';
import { StorageKeys } from '../types.js';
import { DEFAULT_SETTINGS } from '../defaults.js';

describe('domainIntelRepository', () => {
  beforeEach(() => {
    backing.store.clear();
    backing.failNextGetWith = null;
  });

  describe('addDomainToBlacklist', () => {
    it('persists an added domain so a later read returns it', async () => {
      await addDomainToBlacklist('example.com');

      expect(backing.store.get(StorageKeys.DOMAIN_BLACKLIST)).toEqual(['example.com']);
      await expect(getDomainBlacklist()).resolves.toEqual(['example.com']);
    });

    it('is idempotent on repeats', async () => {
      await addDomainToBlacklist('example.com');
      await addDomainToBlacklist('example.com');

      await expect(getDomainBlacklist()).resolves.toEqual(['example.com']);
    });
  });

  describe('removeDomainFromBlacklist', () => {
    it('drops only the named domain', async () => {
      await addDomainToBlacklist('one.example');
      await addDomainToBlacklist('two.example');

      await removeDomainFromBlacklist('one.example');

      await expect(getDomainBlacklist()).resolves.toEqual(['two.example']);
    });

    it('is a no-op for a missing domain', async () => {
      await addDomainToBlacklist('kept.example');

      await removeDomainFromBlacklist('missing.example');

      await expect(getDomainBlacklist()).resolves.toEqual(['kept.example']);
    });
  });

  describe('getDomainBlacklist', () => {
    it('degrades a non-array store to an empty list', async () => {
      backing.store.set(StorageKeys.DOMAIN_BLACKLIST, 'not-an-array');
      await expect(getDomainBlacklist()).resolves.toEqual([]);
    });

    it('filters non-string entries from a stored list', async () => {
      backing.store.set(StorageKeys.DOMAIN_BLACKLIST, ['kept.example', 1, null]);
      await expect(getDomainBlacklist()).resolves.toEqual(['kept.example']);
    });

    it('falls back to the default list when the reader throws', async () => {
      backing.failNextGetWith = new Error('storage boom');
      await expect(getDomainBlacklist()).resolves.toEqual(
        DEFAULT_SETTINGS[StorageKeys.DOMAIN_BLACKLIST],
      );
    });
  });
});

describe('domainIntelRepository (injected store seam)', () => {
  let repo: DomainBlacklistStore;
  let adapter: InMemoryStoragePort;

  beforeEach(async () => {
    await installTestSecretKek();
    const real = await vi.importActual<typeof import('../SettingsRepository.js')>('../SettingsRepository.js');
    const fresh = new real.InMemoryStorageAdapter();
    adapter = fresh;
    repo = new real.SettingsRepository(fresh);
    vi.mocked(logError).mockClear();
  });

  describe('addDomainToBlacklist', () => {
    it('persists an added domain through the injected repository', async () => {
      const defaults = DEFAULT_SETTINGS[StorageKeys.DOMAIN_BLACKLIST];

      await addDomainToBlacklist('example.com', repo);

      await expect(getDomainBlacklist(repo)).resolves.toEqual([...(defaults ?? []), 'example.com']);
    });

    it('stays idempotent through the injected repository', async () => {
      const defaults = DEFAULT_SETTINGS[StorageKeys.DOMAIN_BLACKLIST];

      await addDomainToBlacklist('example.com', repo);
      await addDomainToBlacklist('example.com', repo);

      await expect(getDomainBlacklist(repo)).resolves.toEqual([...(defaults ?? []), 'example.com']);
    });
  });

  describe('removeDomainFromBlacklist', () => {
    it('drops only the named domain through the injected repository', async () => {
      const defaults = DEFAULT_SETTINGS[StorageKeys.DOMAIN_BLACKLIST];
      await addDomainToBlacklist('one.example', repo);
      await addDomainToBlacklist('two.example', repo);

      await removeDomainFromBlacklist('one.example', repo);

      await expect(getDomainBlacklist(repo)).resolves.toEqual([...(defaults ?? []), 'two.example']);
    });
  });

  describe('getDomainBlacklist', () => {
    it('degrades a corrupted store to the valid entries', async () => {
      adapter.seed({ [StorageKeys.DOMAIN_BLACKLIST]: ['kept.example', 1, null] });

      await expect(getDomainBlacklist(repo)).resolves.toEqual(['kept.example']);
    });

    it('falls back to the default list and logs STORAGE_READ_FAILURE when the injected read throws', async () => {
      vi.spyOn(repo, 'get').mockRejectedValueOnce(new Error('storage boom'));

      await expect(getDomainBlacklist(repo)).resolves.toEqual(
        DEFAULT_SETTINGS[StorageKeys.DOMAIN_BLACKLIST],
      );
      expect(logError).toHaveBeenCalledWith(
        '[DomainIntel] read failed',
        { error: 'storage boom' },
        ErrorCode.STORAGE_READ_FAILURE,
        'domainIntelRepository',
      );
    });
  });
});
