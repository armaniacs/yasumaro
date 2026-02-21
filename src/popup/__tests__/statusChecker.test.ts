import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { formatTimeAgo, checkPageStatus } from '../statusChecker.js';
import { RecordingLogic } from '../../background/recordingLogic.js';
import * as storage from '../../utils/storage.js';

// Mock dependencies (must be defined before imports)
jest.mock('../../utils/storage.js', () => {
  const mockGetSettings = jest.fn();
  const mockGetSavedUrlsWithTimestamps = jest.fn();

  // Set default mock implementation
  mockGetSettings.mockResolvedValue({
    domain_filter_mode: 'disabled',
    domain_whitelist: [],
    domain_blacklist: [],
    ublock_sources: []
  });
  mockGetSavedUrlsWithTimestamps.mockResolvedValue(new Map());

  return {
    StorageKeys: {
      DOMAIN_FILTER_MODE: 'domain_filter_mode',
      DOMAIN_WHITELIST: 'domain_whitelist',
      DOMAIN_BLACKLIST: 'domain_blacklist',
      UBLOCK_SOURCES: 'ublock_sources',
      SIMPLE_FORMAT_ENABLED: 'simple_format_enabled',
      UBLOCK_FORMAT_ENABLED: 'ublock_format_enabled',
      UBLOCK_RULES: 'ublock_rules',
    },
    getSettings: mockGetSettings,
    getSavedUrlsWithTimestamps: mockGetSavedUrlsWithTimestamps,
  };
});

describe('formatTimeAgo', () => {
  let originalNow: number;

  beforeEach(() => {
    originalNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(originalNow);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
  beforeEach(() => {
    // Reset caches
    RecordingLogic.cacheState.privacyCache = new Map();

    // Mock storage
    (storage.getSettings as jest.Mock).mockResolvedValue({
      domain_filter_mode: 'disabled',
      domain_whitelist: [],
      domain_blacklist: [],
      ublock_sources: []
    });
    (storage.getSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(new Map());
  });

  afterEach(() => {
    jest.clearAllMocks();
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
    (storage.getSettings as jest.Mock).mockResolvedValue({
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
    RecordingLogic.cacheState.privacyCache?.set(url, privacyInfo);

    (storage.getSettings as jest.Mock).mockResolvedValue({
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
    (storage.getSavedUrlsWithTimestamps as jest.Mock).mockResolvedValue(savedUrls);

    (storage.getSettings as jest.Mock).mockResolvedValue({
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
});