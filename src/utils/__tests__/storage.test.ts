import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  getDomainFilterCacheSync,
  isDomainFilterCacheValid,
  normalizeDomainUrl,
  matchesWildcardPattern,
  updateDomainFilterCache
} from '../storage.js';

describe('storage', () => {
  beforeEach(() => {
    // Setup mock for chrome.storage
    const mockStorage = {
      local: {
        get: vi.fn((keys, callback) => {
          if (callback) {
            callback({ domain_filter_cache: null });
          }
          return Promise.resolve({ domain_filter_cache: null });
        }),
        set: vi.fn((data, callback) => {
          if (callback) {
            callback();
          }
          return Promise.resolve();
        })
      },
    };
    // @ts-ignore - テスト環境用にグローバルに設定
    global.chrome = { storage: mockStorage } as any;
  });

  describe('getDomainFilterCacheSync', () => {
    it('calls callback with cache data from storage', async () => {
      const mockAllowedDomains = ['example.com'];
      const mockTimestamp = Date.now();
      const mockMode = 'blacklist';
      const mockStorage = {
        local: {
          get: vi.fn((keys, callback) => {
            if (callback) {
              callback({
                domain_filter_cache: mockAllowedDomains,
                domain_filter_cache_timestamp: mockTimestamp,
                domain_filter_mode: mockMode
              });
            }
            return Promise.resolve({
              domain_filter_cache: mockAllowedDomains,
              domain_filter_cache_timestamp: mockTimestamp,
              domain_filter_mode: mockMode
            });
          }),
        },
      };
      // @ts-ignore
      global.chrome = { storage: mockStorage } as any;

      const result = await new Promise<{ allowedDomains: string[]; blockedDomains: string[]; cachedAt: number; mode: string }>((resolve) => {
        getDomainFilterCacheSync(resolve);
      });

      expect(result).toEqual({
        allowedDomains: mockAllowedDomains,
        blockedDomains: [],
        cachedAt: mockTimestamp,
        mode: mockMode
      });
    });

    it('calls callback with empty data when cache not found', async () => {
      const mockStorage = {
        local: {
          get: vi.fn((keys, callback) => {
            if (callback) {
              callback({});
            }
            return Promise.resolve({});
          }),
        },
      };
      // @ts-ignore
      global.chrome = { storage: mockStorage } as any;

      const result = await new Promise<{ allowedDomains: string[]; blockedDomains: string[]; cachedAt: number; mode: string }>((resolve) => {
        getDomainFilterCacheSync(resolve);
      });

      expect(result).toEqual({ allowedDomains: [], blockedDomains: [], cachedAt: 0, mode: 'disabled' });
    });
  });

  describe('isDomainFilterCacheValid', () => {
    it('returns true for valid cache (within TTL)', () => {
      const now = Date.now();
      const validTimestamp = now - (1000 * 60 * 2); // 2 minutes ago
      expect(isDomainFilterCacheValid(validTimestamp)).toBe(true);
    });

    it('returns false for expired cache (outside TTL)', () => {
      const now = Date.now();
      const expiredTimestamp = now - (1000 * 60 * 10); // 10 minutes ago
      expect(isDomainFilterCacheValid(expiredTimestamp)).toBe(false);
    });

    it('returns false for zero timestamp', () => {
      expect(isDomainFilterCacheValid(0)).toBe(false);
    });

    it('returns false for negative timestamp', () => {
      expect(isDomainFilterCacheValid(-1000)).toBe(false);
    });
  });

  describe('normalizeDomainUrl', () => {
    it('normalizes a standard URL', () => {
      expect(normalizeDomainUrl('https://example.com/path')).toBe('example.com');
    });

    it('removes www prefix', () => {
      expect(normalizeDomainUrl('https://www.example.com/path')).toBe('example.com');
    });

    it('handles URLs with port', () => {
      expect(normalizeDomainUrl('https://example.com:8080/path')).toBe('example.com');
    });

    it('returns null for invalid URL', () => {
      expect(normalizeDomainUrl('not-a-url')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(normalizeDomainUrl('')).toBeNull();
    });
  });

  describe('matchesWildcardPattern', () => {
    it('matches exact domain (case insensitive)', () => {
      expect(matchesWildcardPattern('EXAMPLE.COM', 'example.com')).toBe(true);
      expect(matchesWildcardPattern('example.com', 'EXAMPLE.COM')).toBe(true);
    });

     it('matches wildcard pattern', () => {
       expect(matchesWildcardPattern('sub.example.com', '*.example.com')).toBe(true);
       expect(matchesWildcardPattern('example.com', '*.example.com')).toBe(false); // * does not match missing subdomain
     });

    it('matches when domain has extra subdomain beyond wildcard', () => {
      expect(matchesWildcardPattern('sub.sub.example.com', '*.example.com')).toBe(true); // * matches 'sub.sub'
    });

    it('treats asterisk as wildcard when not at start', () => {
      expect(matchesWildcardPattern('example*com', 'example*com')).toBe(true); // * matches zero characters
      expect(matchesWildcardPattern('examplexxxcom', 'example*com')).toBe(true); // * matches 'xxx'
    });

     it('handles special regex characters in pattern', () => {
       expect(matchesWildcardPattern('example.com', 'example\\.com')).toBe(false); // \* becomes .* so matches any chars
       expect(matchesWildcardPattern('example.com', 'example\\\\.com')).toBe(false); // backslash not treated as escape in our pattern
     });
  });

  describe('updateDomainFilterCache', () => {
    it('calls chrome.storage.set with whitelist mode data', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      const mockStorage = {
        local: {
          set: mockSet,
          get: vi.fn((keys, callback) => {
            if (callback) {
              callback({});
            }
            return Promise.resolve({});
          })
        },
      };
      // @ts-ignore
      global.chrome = { storage: mockStorage } as any;

      const settings = {
        [StorageKeys.DOMAIN_FILTER_MODE]: 'whitelist',
        [StorageKeys.DOMAIN_WHITELIST]: ['example.com', 'test.com'],
        [StorageKeys.SIMPLE_FORMAT_ENABLED]: true
      } as unknown as Settings;

      await updateDomainFilterCache(settings);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          [StorageKeys.DOMAIN_FILTER_CACHE]: ['example.com', 'test.com'],
          [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: expect.any(Number)
        })
      );
    });

    it('calls chrome.storage.set with blacklist mode data', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      const mockStorage = {
        local: {
          set: mockSet,
          get: vi.fn((keys, callback) => {
            if (callback) {
              callback({});
            }
            return Promise.resolve({});
          })
        },
      };
      // @ts-ignore
      global.chrome = { storage: mockStorage } as any;

      const settings = {
        [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
        [StorageKeys.DOMAIN_BLACKLIST]: ['bad.com'],
        [StorageKeys.SIMPLE_FORMAT_ENABLED]: true
      } as unknown as Settings;

      await updateDomainFilterCache(settings);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          [StorageKeys.DOMAIN_FILTER_CACHE]: [],
          [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: expect.any(Number)
        })
      );
    });

    it('handles disabled simple format in whitelist mode', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      const mockStorage = {
        local: {
          set: mockSet,
          get: vi.fn((keys, callback) => {
            if (callback) {
              callback({});
            }
            return Promise.resolve({});
          })
        },
      };
      // @ts-ignore
      global.chrome = { storage: mockStorage } as any;

      const settings = {
        [StorageKeys.DOMAIN_FILTER_MODE]: 'whitelist',
        [StorageKeys.DOMAIN_WHITELIST]: ['example.com'],
        [StorageKeys.SIMPLE_FORMAT_ENABLED]: false
      } as unknown as Settings;

      await updateDomainFilterCache(settings);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          [StorageKeys.DOMAIN_FILTER_CACHE]: [],
          [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: expect.any(Number)
        })
      );
    });
  });
});

// Import StorageKeys and Settings types for the tests
import { StorageKeys } from '../storage/types.js';
import type { Settings } from '../storage/types.js';