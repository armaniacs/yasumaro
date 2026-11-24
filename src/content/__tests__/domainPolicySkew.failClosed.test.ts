import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChromeDomainPolicyPort } from '../domainPolicyPort.js';
import { evaluateDomainPolicy } from '../visitAdmission.js';
import {
  cleanseViaOffscreen,
  isCleansingOffscreenEnabled,
  __resetCleansingFlagCacheForTesting,
} from '../cleansingOffscreenDelegate.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { StorageKeys } from '../../utils/storage/types.js';

const getAll = vi.fn();
vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: { getAll: (...args: unknown[]) => getAll(...args) },
}));

const now = 1_700_000_000_000;

function skewedSeed(): Record<string, unknown> {
  return {
    [StorageKeys.DOMAIN_FILTER_CACHE]: [],
    [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
    [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
    [StorageKeys.DOMAIN_SUBDOMAIN_MATCHING]: false,
    [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
    [StorageKeys.UBLOCK_FORMAT_ENABLED]: false,
    [StorageKeys.DOMAIN_BLACKLIST]: ['blocked.com'],
    settings: { [StorageKeys.DOMAIN_BLACKLIST]: [] },
  };
}

describe('domainPolicySkew', () => {
  describe('failClosed', () => {
    beforeEach(() => {
      getAll.mockReset();
    });

    it('does not allow a blocked domain when blob and top-level disagree', async () => {
      const storage = new InMemoryStoragePort();
      storage.seed(skewedSeed());
      const port = new ChromeDomainPolicyPort(storage, () => now);
      const verdict = await port.checkDomainAllowedFromCache('https://blocked.com/page');
      expect(verdict.useCache === false || verdict.allowed === false).toBe(true);
    });

    it('fails closed on a skewed snapshot without consulting the list', () => {
      expect(
        evaluateDomainPolicy(
          'blocked.com',
          {
            cachedWhitelist: [],
            cachedAt: now,
            mode: 'blacklist',
            blacklist: [],
            simpleEnabled: true,
            ublockEnabled: false,
            matchSubdomains: false,
            generationSkewed: true,
          },
          now,
        ),
      ).toEqual({ allowed: false, useCache: false });
    });
  });

  describe('scopedReads', () => {
    beforeEach(() => {
      getAll.mockReset();
    });

    afterEach(() => {
      delete (globalThis as unknown as Record<string, unknown>).chrome;
      vi.restoreAllMocks();
    });

    it('requests only policy keys and never surfaces blob secrets in the verdict', async () => {
      const storage = new InMemoryStoragePort();
      storage.seed({
        [StorageKeys.DOMAIN_FILTER_CACHE]: [],
        [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now,
        [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
        [StorageKeys.DOMAIN_BLACKLIST]: ['blocked.com'],
        [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
        [StorageKeys.UBLOCK_FORMAT_ENABLED]: false,
        [StorageKeys.DOMAIN_SUBDOMAIN_MATCHING]: false,
        settings: {
          [StorageKeys.DOMAIN_BLACKLIST]: ['blocked.com'],
          [StorageKeys.GEMINI_API_KEY]: 'secret-gemini-key',
          [StorageKeys.OBSIDIAN_API_KEY]: 'secret-obsidian-key',
        },
      });
      const spy = vi.spyOn(storage, 'get');
      const port = new ChromeDomainPolicyPort(storage, () => now);
      const verdict = await port.checkDomainAllowedFromCache('https://blocked.com/page');
      expect(verdict).toEqual({ allowed: false, useCache: true });
      expect(spy).toHaveBeenCalledTimes(1);
      const requested = spy.mock.calls[0]?.[0] as string[];
      for (const key of requested) {
        expect(
          [
            StorageKeys.DOMAIN_FILTER_CACHE,
            StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP,
            StorageKeys.DOMAIN_FILTER_MODE,
            StorageKeys.DOMAIN_SUBDOMAIN_MATCHING,
            StorageKeys.DOMAIN_BLACKLIST,
            StorageKeys.SIMPLE_FORMAT_ENABLED,
            StorageKeys.UBLOCK_FORMAT_ENABLED,
            'settings',
          ].includes(key),
        ).toBe(true);
      }
      expect(JSON.stringify(verdict)).not.toContain('secret-gemini-key');
      expect(JSON.stringify(verdict)).not.toContain('secret-obsidian-key');
    });

    it('bridges only html to the offscreen target, never blob secrets', async () => {
      __resetCleansingFlagCacheForTesting();
      const store: Record<string, unknown> = {
        settings: {
          [StorageKeys.CLEANSING_OFFSCREEN_ENABLED]: true,
          [StorageKeys.GEMINI_API_KEY]: 'secret-gemini-key',
        },
      };
      const sent: unknown[] = [];
      (globalThis as unknown as Record<string, unknown>).chrome = {
        storage: {
          local: {
            get: vi.fn(async (keys: string[]) =>
              Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
            ),
          },
          onChanged: { addListener: vi.fn() },
        },
        runtime: {
          sendMessage: vi.fn(async (msg: unknown) => {
            sent.push(msg);
            return { success: true, html: '<p>clean</p>' };
          }),
        },
      };
      expect(await isCleansingOffscreenEnabled()).toBe(true);
      expect(await cleanseViaOffscreen('<p>dirty</p>')).toBe('<p>clean</p>');
      expect(JSON.stringify(sent)).not.toContain('secret-gemini-key');
      expect(JSON.stringify(sent)).toContain('dirty');
    });
  });
});
