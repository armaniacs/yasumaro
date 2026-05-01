import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDomainFilterCacheSync,
  isDomainFilterCacheValid,
  normalizeDomainUrl,
  matchesWildcardPattern,
  updateDomainFilterCache,
  buildAllowedUrls,
  getAllowedUrls,
  computeUrlsHash
} from '../storage.js';
import { StorageKeys } from '../storage/types.js';
import type { Settings } from '../storage/types.js';

describe('storage', () => {
  beforeEach(() => {
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
    // @ts-ignore
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
      const validTimestamp = now - (1000 * 60 * 2);
      expect(isDomainFilterCacheValid(validTimestamp)).toBe(true);
    });

    it('returns false for expired cache (outside TTL)', () => {
      const now = Date.now();
      const expiredTimestamp = now - (1000 * 60 * 10);
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
       expect(matchesWildcardPattern('example.com', '*.example.com')).toBe(false);
     });

    it('matches when domain has extra subdomain beyond wildcard', () => {
      expect(matchesWildcardPattern('sub.sub.example.com', '*.example.com')).toBe(true);
    });

    it('treats asterisk as wildcard when not at start', () => {
      expect(matchesWildcardPattern('example*com', 'example*com')).toBe(true);
      expect(matchesWildcardPattern('examplexxxcom', 'example*com')).toBe(true);
    });

     it('handles special regex characters in pattern', () => {
       expect(matchesWildcardPattern('example.com', 'example\\.com')).toBe(false);
       expect(matchesWildcardPattern('example.com', 'example\\\\.com')).toBe(false);
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

describe('buildAllowedUrls - edge cases', () => {
  let mockStorage: any;
  let mockSet: any;

  beforeEach(() => {
    mockSet = vi.fn();
    mockStorage = {
      local: {
        get: vi.fn((keys, callback) => {
          if (callback) {
            callback({
              whitelist_mode: true,
              openai_api_key: 'test-key',
              openai_2_base_url: '',
              provider_base_url: '',
              ublock_sources: [],
            });
          }
          return Promise.resolve({
            whitelist_mode: true,
            openai_api_key: 'test-key',
            openai_2_base_url: '',
            provider_base_url: '',
            ublock_sources: [],
          });
        }),
        set: mockSet,
      },
    };
    // @ts-ignore
    global.chrome = { storage: mockStorage } as any;
  });

  it('handles invalid OpenAI 2 Base URL gracefully', async () => {
    const settings = {
      whitelist_mode: true,
      openai_2_base_url: 'not-a-valid-url!!!',
    } as unknown as Settings;

    const allowedUrls = await buildAllowedUrls(settings);

    // Only fixed URLs are added (Obsidian localhost 2 + Gemini 1 + uBlock fixed 5 = 8)
    expect(allowedUrls.size).toBe(8);
    expect(allowedUrls.has('https://raw.githubusercontent.com')).toBe(true);
  });

  it('handles non-whitelisted OpenAI 2 Base URL', async () => {
    const settings = {
      whitelist_mode: true,
      openai_2_base_url: 'https://non-whitelisted.com',
    } as unknown as Settings;

    const allowedUrls = await buildAllowedUrls(settings);

    // Non-whitelisted URL is not added; only fixed URLs remain (8)
    expect(allowedUrls.size).toBe(8);
  });

  it('handles invalid Provider Base URL gracefully', async () => {
    const settings = {
      whitelist_mode: true,
      provider_base_url: 'invalid-url',
    } as unknown as Settings;

    const allowedUrls = await buildAllowedUrls(settings);

    // Only fixed URLs (8)
    expect(allowedUrls.size).toBe(8);
  });

  it('handles non-whitelisted Provider Base URL', async () => {
    const settings = {
      whitelist_mode: true,
      provider_base_url: 'https://evil.com',
    } as unknown as Settings;

    const allowedUrls = await buildAllowedUrls(settings);

    expect(allowedUrls.size).toBe(8);
  });

  it('handles uBlock sources with invalid URLs', async () => {
    const settings = {
      whitelist_mode: true,
      ublock_sources: [
        { url: 'not-a-valid-url', name: 'Test' },
        { url: 'https://example.com/list.txt', name: 'Valid' },
      ],
    } as unknown as Settings;

    const allowedUrls = await buildAllowedUrls(settings);

    // Fixed 8 + 1 valid uBlock origin = 9 total
    expect(allowedUrls.size).toBe(9);
    expect(allowedUrls.has('https://example.com')).toBe(true);
  });
});

describe('getAllowedUrls', () => {
  it('returns empty Set when storage has no URLs', async () => {
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

    const urls = await getAllowedUrls();
    expect(urls).toBeInstanceOf(Set);
    expect(urls.size).toBe(0);
  });

  it('returns Set from storage', async () => {
    const mockStorage = {
      local: {
        get: vi.fn((keys, callback) => {
          if (callback) {
            callback({ allowed_urls: ['https://example.com', 'https://test.com'] });
          }
          return Promise.resolve({ allowed_urls: ['https://example.com', 'https://test.com'] });
        }),
      },
    };
    // @ts-ignore
    global.chrome = { storage: mockStorage } as any;

    const urls = await getAllowedUrls();
    expect(urls.size).toBe(2);
    expect(urls.has('https://example.com')).toBe(true);
    expect(urls.has('https://test.com')).toBe(true);
  });
});

describe('computeUrlsHash', () => {
  it('returns hash for empty set', () => {
    const hash = computeUrlsHash(new Set());
    expect(hash).toBe('');
  });

  it('returns sorted, pipe-joined URLs', () => {
    const urls = new Set(['https://z.com', 'https://a.com', 'https://m.com']);
    const hash = computeUrlsHash(urls);
    expect(hash).toBe('https://a.com|https://m.com|https://z.com');
  });
});
