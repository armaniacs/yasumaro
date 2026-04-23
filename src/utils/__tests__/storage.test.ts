import { describe, it, expect, beforeEach } from 'vitest';
import { getDomainFilterCacheSync } from '../storage.js';

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
      },
    };
    // @ts-ignore - テスト環境用にグローバルに設定
    global.chrome = { storage: mockStorage } as any;
  });

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
