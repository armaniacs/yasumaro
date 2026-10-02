import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { StorageKeys } from '../storage/types.js';
import type { Settings } from '../storage/types.js';
import { getDomainFilterCacheSync } from '../storage/domainFilterCache.js';
import { DomainFilter } from '../domainFilter/DomainFilter.js';

// PBI 2026-10-02-08: the domain filter default lived in three places with
// three different values (defaults.ts: 'blacklist' / DomainFilter.cache:
// 'whitelist' / getDomainFilterCacheSync: 'disabled'). Adjudicated default is
// 'blacklist': it is the only default paired with data (DEFAULT_SETTINGS
// ships a non-empty DOMAIN_BLACKLIST while DOMAIN_WHITELIST is empty, so
// 'whitelist' would deny everything on a fresh install and 'disabled' would
// ignore the curated blacklist).
const ADJUDICATED_DEFAULT = 'blacklist';

function readSyncMode(stored: Record<string, unknown>): Promise<string> {
  const mockStorage = {
    local: {
      get: vi.fn((_keys: unknown, callback: (r: Record<string, unknown>) => void) => {
        callback(stored);
        return Promise.resolve(stored);
      }),
    },
  };
  // @ts-ignore chrome global in node env
  global.chrome = { storage: mockStorage } as any;
  return new Promise<string>((resolve) => {
    getDomainFilterCacheSync((data) => resolve(data.mode));
  });
}

describe('domainFilter defaults matrix (PBI 2026-10-02-08)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-ignore
    delete (global as Record<string, unknown>).chrome;
  });

  describe('each leg returns the adjudicated default', () => {
    it('DEFAULT_SETTINGS uses blacklist', () => {
      expect(DEFAULT_SETTINGS[StorageKeys.DOMAIN_FILTER_MODE]).toBe(ADJUDICATED_DEFAULT);
    });

    it('getDomainFilterCacheSync falls back to blacklist when nothing is stored', async () => {
      await expect(readSyncMode({})).resolves.toBe(ADJUDICATED_DEFAULT);
    });

    it('DomainFilter.cache falls back to blacklist when mode is missing', () => {
      const filter = new DomainFilter();
      const record = filter.cache({} as Settings);
      expect(record.mode).toBe(ADJUDICATED_DEFAULT);
    });
  });

  describe('matrix: all three legs agree', () => {
    it('defaults, sync-read fallback, and cache fallback are a single value', async () => {
      const fromDefaults = DEFAULT_SETTINGS[StorageKeys.DOMAIN_FILTER_MODE] as string;
      const fromSyncRead = await readSyncMode({});
      const fromCache = new DomainFilter().cache({} as Settings).mode;
      expect(new Set([fromDefaults, fromSyncRead, fromCache])).toEqual(new Set([ADJUDICATED_DEFAULT]));
    });

    it('the adjudicated default is operative: fresh-install shape caches the default blacklist', () => {
      const filter = new DomainFilter();
      const freshInstall = {
        [StorageKeys.DOMAIN_FILTER_MODE]: ADJUDICATED_DEFAULT,
        [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
        [StorageKeys.DOMAIN_WHITELIST]: [],
        [StorageKeys.DOMAIN_BLACKLIST]:
          DEFAULT_SETTINGS[StorageKeys.DOMAIN_BLACKLIST],
      } as unknown as Settings;
      const record = filter.cache(freshInstall);
      expect(record.mode).toBe(ADJUDICATED_DEFAULT);
      expect(record.cachedDomains).toEqual(
        DEFAULT_SETTINGS[StorageKeys.DOMAIN_BLACKLIST] as unknown as string[],
      );
      expect(record.cachedDomains.length).toBeGreaterThan(0);
    });
  });
});
