/**
 * domainIntelRepository.test.ts
 *
 * Roundtrip tests for the domain-intel repository seam (PBI 2026-10-23-02).
 * The contract: add/remove roundtrips through the stored blacklist, and a
 * corrupted store degrades without throwing (empty list on bad shape, the
 * default list when the read itself fails).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
