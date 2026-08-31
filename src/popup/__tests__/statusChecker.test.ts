import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatTimeAgo, checkPageStatus } from '../statusChecker.js';
import { RecordingCache } from '../../background/__tests__/helpers/recordingCache.js';
import * as storageSavedUrls from '../../utils/storage/savedUrlRepository.js';

const mockGetAll = vi.hoisted(() => vi.fn());
const mockSetAll = vi.hoisted(() => vi.fn());
const mockGetMany = vi.hoisted(() => vi.fn());
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, settingsRepository: { getAll: mockGetAll, setAll: mockSetAll, getMany: mockGetMany }, SettingsRepository: class { getAll = mockGetAll; setAll = mockSetAll; getMany = mockGetMany } };
});

// Mock chrome runtime for privacy cache
const mockChromeRuntime = {
  sendMessage: vi.fn()
};
// Mock chrome.i18n for formatTimeAgo
const mockChromeI18n = {
  getMessage: vi.fn((key: string) => {
    // Default fallback values
    const fallbacks: Record<string, string> = {
      'timeJustNow': 'たった今',
      'timeMinutesAgo': 'N分前',
      'timeHoursAgo': 'N時間前',
      'timeYesterday': '昨日',
      'timeDaysAgo': 'N日前'
    };
    return fallbacks[key] || key;
  })
};
global.chrome = {
  runtime: mockChromeRuntime,
  i18n: mockChromeI18n
} as any;

// Mock i18n.js to properly handle substitutions
vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string, substitutions?: any) => {
    if (key === 'timeJustNow') return 'たった今';
    if (key === 'timeYesterday') return '昨日';
    if (key.startsWith('timeMinutesAgo')) {
      return substitutions?.count !== undefined ? `${substitutions.count}分前` : 'N分前';
    }
    if (key.startsWith('timeHoursAgo')) {
      return substitutions?.count !== undefined ? `${substitutions.count}時間前` : 'N時間前';
    }
    if (key.startsWith('timeDaysAgo')) {
      return substitutions?.count !== undefined ? `${substitutions.count}日前` : 'N日前';
    }
    return key;
  })
}));

vi.mock('../../utils/storage/savedUrlRepository.js', () => {
  const mockGetSavedUrlsWithTimestamps = vi.fn();
  return { getSavedUrlsWithTimestamps: mockGetSavedUrlsWithTimestamps };
});

describe('formatTimeAgo', () => {
  let originalNow: number;

  beforeEach(() => {
    originalNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(originalNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return "たった今" for timestamps within 1 minute', () => {
    const timestamp = originalNow - 30 * 1000; // 30秒前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('たった今');
  });

  it('should return "N分前" for timestamps within 1 hour', () => {
    const timestamp = originalNow - 5 * 60 * 1000; // 5分前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('5分前');
  });

  it('should return "N時間前" for timestamps within 24 hours', () => {
    const timestamp = originalNow - 3 * 60 * 60 * 1000; // 3時間前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('3時間前');
  });

  it('should return "昨日" for timestamps from yesterday', () => {
    const timestamp = originalNow - 25 * 60 * 60 * 1000; // 25時間前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('昨日');
  });

  it('should return "N日前" for timestamps within a week', () => {
    const timestamp = originalNow - 3 * 24 * 60 * 60 * 1000; // 3日前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('3日前');
  });

  it('should format time as "HH:MM" for today', () => {
    const today = new Date(originalNow);
    today.setHours(14, 32, 0, 0);
    const result = formatTimeAgo(today.getTime());
    expect(result.formatted).toBe('14:32');
  });

  it('should format time as "MM/DD HH:MM" for other days', () => {
    const otherDay = new Date(originalNow);
    otherDay.setDate(otherDay.getDate() - 5);
    otherDay.setHours(14, 32, 0, 0);
    const result = formatTimeAgo(otherDay.getTime());
    const month = String(otherDay.getMonth() + 1).padStart(2, '0');
    const day = String(otherDay.getDate()).padStart(2, '0');
    expect(result.formatted).toBe(`${month}/${day} 14:32`);
  });
});

describe('checkPageStatus', () => {
  beforeEach(async () => {
    // Reset caches
    RecordingCache.getCacheState().privacyCache = new Map();
    // Clear settings cache so mockGetAll changes are visible
    try {
      const { clearSettingsCache } = await import('../../utils/storage.js');
      clearSettingsCache();
    } catch {}

    // Mock chrome.runtime.sendMessage for privacy cache
    mockChromeRuntime.sendMessage.mockResolvedValue({
      success: false,
      cache: []
    });

    // Mock storage
    (mockGetAll as vi.Mock).mockResolvedValue({
      domain_filter_mode: 'disabled',
      domain_whitelist: [],
      domain_blacklist: [],
      ublock_sources: []
    });
    (storageSavedUrls.getSavedUrlsWithTimestamps as vi.Mock).mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return basic status for normal URL', async () => {
    const url = 'https://example.com/page';
    const result = await checkPageStatus(url);

    expect(result.domainFilter.allowed).toBe(true);
    expect(result.domainFilter.mode).toBe('disabled');
    expect(result.privacy.hasCache).toBe(false);
    expect(result.lastSaved.exists).toBe(false);
  });

  it('should detect whitelisted domain', async () => {
    const url = 'https://example.com/page';
    (mockGetAll as vi.Mock).mockResolvedValue({
      domain_filter_mode: 'whitelist',
      domain_whitelist: ['example.com'],
      domain_blacklist: [],
      ublock_sources: []
    });

    const result = await checkPageStatus(url);

    expect(result.domainFilter.allowed).toBe(true);
    expect(result.domainFilter.mode).toBe('whitelist');
    expect(result.domainFilter.matched).toBe(true);
    expect(result.domainFilter.matchedPattern).toBe('example.com');
  });

  it('should use privacy cache when available', async () => {
    const url = 'https://example.com/page';
    const normalizedUrl = url; // URLは正規化されても変わらない
    const privacyInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now(),
      headers: {
        cacheControl: 'private',
        hasCookie: true,
        hasAuth: false
      }
    };

    // Mock chrome.runtime.sendMessage to return privacy cache
    mockChromeRuntime.sendMessage.mockResolvedValue({
      success: true,
      cache: [[normalizedUrl, privacyInfo]]
    });

    (mockGetAll as vi.Mock).mockResolvedValue({
      domain_filter_mode: 'disabled',
      domain_whitelist: [],
      domain_blacklist: [],
      ublock_sources: []
    });

    const result = await checkPageStatus(url);

    expect(result.privacy.isPrivate).toBe(true);
    expect(result.privacy.reason).toBe('cache-control');
    expect(result.privacy.hasCache).toBe(true);
    expect(result.cache.cacheControl).toBe('private');
    expect(result.cache.hasCookie).toBe(true);
    expect(result.cache.hasAuth).toBe(false);
  });

  it('should format last saved time when URL exists in history', async () => {
    const url = 'https://example.com/page';
    const savedTimestamp = Date.now() - 5 * 60 * 1000; // 5分前
    const savedUrls = new Map([[url, savedTimestamp]]);
    (storageSavedUrls.getSavedUrlsWithTimestamps as vi.Mock).mockResolvedValue(savedUrls);

    (mockGetAll as vi.Mock).mockResolvedValue({
      domain_filter_mode: 'disabled',
      domain_whitelist: [],
      domain_blacklist: [],
      ublock_sources: []
    });

    const result = await checkPageStatus(url);

    expect(result.lastSaved.exists).toBe(true);
    expect(result.lastSaved.timestamp).toBe(savedTimestamp);
    expect(result.lastSaved.timeAgo).toBe('5分前');
    expect(result.lastSaved.formatted).toMatch(/\d{2}:\d{2}/);
  });

  it('should handle special URLs (chrome://)', async () => {
    const url = 'chrome://extensions';

    const result = await checkPageStatus(url);

    expect(result).toBeNull();
  });

  it('should normalize URL and match cache (trailing slash)', async () => {
    const urlWithSlash = 'https://example.com/page/';
    const urlWithoutSlash = 'https://example.com/page';

    const privacyInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now(),
      headers: {
        cacheControl: 'no-store',
        hasCookie: false,
        hasAuth: false
      }
    };

    // Cache with normalized URL (without trailing slash)
    mockChromeRuntime.sendMessage.mockResolvedValue({
      success: true,
      cache: [[urlWithoutSlash, privacyInfo]]
    });

    (mockGetAll as vi.Mock).mockResolvedValue({
      domain_filter_mode: 'disabled',
      domain_whitelist: [],
      domain_blacklist: [],
      ublock_sources: []
    });

    // Query with slash should match after normalization
    const result = await checkPageStatus(urlWithSlash);

    expect(result.privacy.isPrivate).toBe(true);
    expect(result.privacy.reason).toBe('cache-control');
    expect(result.cache.cacheControl).toBe('no-store');
  });

  it('should normalize URL and match cache (fragment)', async () => {
    const urlWithFragment = 'https://example.com/page#section';
    const urlWithoutFragment = 'https://example.com/page';

    const privacyInfo = {
      isPrivate: true,
      reason: 'no-store' as const,
      timestamp: Date.now(),
      headers: {
        cacheControl: 'no-store',
        hasCookie: false,
        hasAuth: false
      }
    };

    // Cache with normalized URL (without fragment)
    mockChromeRuntime.sendMessage.mockResolvedValue({
      success: true,
      cache: [[urlWithoutFragment, privacyInfo]]
    });

    (mockGetAll as vi.Mock).mockResolvedValue({
      domain_filter_mode: 'disabled',
      domain_whitelist: [],
      domain_blacklist: [],
      ublock_sources: []
    });

    // Query with fragment should match after normalization
    const result = await checkPageStatus(urlWithFragment);

    expect(result.privacy.isPrivate).toBe(true);
    expect(result.cache.cacheControl).toBe('no-store');
  });

  it('should preserve trailing slash for root path', async () => {
    const rootUrl = 'https://www.yomiuri.co.jp/';

    const privacyInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now(),
      headers: {
        cacheControl: 'no-store, no-cache, must-revalidate, proxy-revalidate',
        hasCookie: false,
        hasAuth: false
      }
    };

    // Cache with trailing slash (root path is preserved)
    mockChromeRuntime.sendMessage.mockResolvedValue({
      success: true,
      cache: [[rootUrl, privacyInfo]]
    });

    (mockGetAll as vi.Mock).mockResolvedValue({
      domain_filter_mode: 'disabled',
      domain_whitelist: [],
      domain_blacklist: [],
      ublock_sources: []
    });

    // Query should match root URL as-is
    const result = await checkPageStatus(rootUrl);

    expect(result.privacy.isPrivate).toBe(true);
    expect(result.cache.cacheControl).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');
  });

  it('should detect blacklisted domain', async () => {
    const url = 'https://blocked.com/page';
    (mockGetAll as vi.Mock).mockResolvedValue({
      domain_filter_mode: 'blacklist',
      domain_whitelist: [],
      domain_blacklist: ['blocked.com'],
      ublock_sources: []
    });

    const result = await checkPageStatus(url);

    expect(result.domainFilter.allowed).toBe(false);
    expect(result.domainFilter.mode).toBe('blacklist');
    expect(result.domainFilter.matched).toBe(true);
    expect(result.domainFilter.matchedPattern).toBe('blocked.com');
  });

  it('should handle privacy cache sendMessage error gracefully', async () => {
    const url = 'https://example.com/page';
    mockChromeRuntime.sendMessage.mockRejectedValue(new Error('No listener'));

    const result = await checkPageStatus(url);

    expect(result).not.toBeNull();
    expect(result.privacy.isPrivate).toBe(false);
  });

  it('should handle main error and return default status', async () => {
    const url = 'https://example.com/page';
    // Make getSettings throw to trigger main catch block
    (mockGetAll as vi.Mock).mockRejectedValueOnce(new Error('Storage error'));

    const result = await checkPageStatus(url);

    expect(result).not.toBeNull();
    expect(result.domainFilter.allowed).toBe(true);
    expect(result.domainFilter.mode).toBe('disabled');
  });
});