/**
 * @jest-environment jsdom
 */

/**
 * trancoChangeDetector.test.ts
 * Unit tests for TrancoChangeDetector (Phase 2)
 */

import { jest } from '@jest/globals';
import { TrancoChangeDetector } from '../trancoChangeDetector.js';

// Mock chrome.storage.local
const mockStorage = new Map<string, any>();

const mockChromeStorage = {
  local: {
    get: jest.fn().mockImplementation((keys) => {
      const result: Record<string, any> = {};
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        if (mockStorage.has(key)) {
          result[key] = mockStorage.get(key);
        }
      }
      return Promise.resolve(result);
    }),
    set: jest.fn().mockImplementation((items) => {
      for (const [key, value] of Object.entries(items)) {
        mockStorage.set(key, value);
      }
      return Promise.resolve();
    }),
    remove: jest.fn().mockImplementation((keys) => {
      for (const key of keys) {
        mockStorage.delete(key);
      }
      return Promise.resolve();
    })
  }
};

Object.defineProperty(global, 'chrome', {
  value: {
    storage: mockChromeStorage
  },
  writable: true
});

describe('TrancoChangeDetector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  describe('compareTrancoLists', () => {
    it('should detect excluded and added domains', () => {
      const oldList = ['google.com', 'facebook.com', 'twitter.com'];
      const newList = ['google.com', 'youtube.com', 'twitter.com'];

      const result = TrancoChangeDetector.compareTrancoLists(oldList, newList);

      expect(result.excludedDomains).toContain('facebook.com');
      expect(result.addedDomains).toContain('youtube.com');
      expect(result.excludedDomains.length).toBe(1);
      expect(result.addedDomains.length).toBe(1);
      expect(result.oldList.has('google.com')).toBe(true);
      expect(result.newList.has('youtube.com')).toBe(true);
    });

    it('should handle empty old list', () => {
      const oldList: string[] = [];
      const newList = ['google.com', 'facebook.com'];

      const result = TrancoChangeDetector.compareTrancoLists(oldList, newList);

      expect(result.excludedDomains).toEqual([]);
      expect(result.addedDomains).toEqual(['google.com', 'facebook.com']);
    });

    it('should handle empty new list', () => {
      const oldList = ['google.com', 'facebook.com'];
      const newList: string[] = [];

      const result = TrancoChangeDetector.compareTrancoLists(oldList, newList);

      expect(result.excludedDomains).toEqual(['google.com', 'facebook.com']);
      expect(result.addedDomains).toEqual([]);
    });

    it('should handle identical lists', () => {
      const list = ['google.com', 'facebook.com', 'twitter.com'];

      const result = TrancoChangeDetector.compareTrancoLists(list, list);

      expect(result.excludedDomains).toEqual([]);
      expect(result.addedDomains).toEqual([]);
    });
  });

  describe('analyzeChanges', () => {
    it('should detect changes for visited domains only', async () => {
      const oldList = ['google.com', 'facebook.com', 'youtube.com', 'twitter.com'];
      const newList = ['google.com', 'youtube.com', 'instagram.com'];

      const comparison = TrancoChangeDetector.compareTrancoLists(oldList, newList);
      const visitedDomains = {
        domains: new Set(['google.com', 'facebook.com']),
        timestamp: Date.now()
      };

      const result = await TrancoChangeDetector.analyzeChanges(comparison, visitedDomains);

      // facebook.comは除外されたが、訪問済みなので含まれる
      expect(result.hasChanges).toBe(true);
      expect(result.excludedTrustedDomains).toContain('facebook.com');
      expect(result.excludedTrustedDomains.length).toBe(1);
      // twitter.comは除外されたが、未訪問なので含まれない
      expect(result.excludedTrustedDomains).not.toContain('twitter.com');
    });

    it('should return no changes when no visited domains were excluded', async () => {
      const oldList = ['google.com', 'facebook.com'];
      const newList = ['google.com', 'youtube.com'];

      const comparison = TrancoChangeDetector.compareTrancoLists(oldList, newList);
      const visitedDomains = {
        domains: new Set(['google.com', 'youtube.com']),
        timestamp: Date.now()
      };

      const result = await TrancoChangeDetector.analyzeChanges(comparison, visitedDomains);

      expect(result.hasChanges).toBe(false);
      expect(result.excludedTrustedDomains).toEqual([]);
    });

    it('should generate bilingual summary for removed domains', async () => {
      const oldList = ['google.com', 'facebook.com', 'youtube.com'];
      const newList = ['google.com'];

      const comparison = TrancoChangeDetector.compareTrancoLists(oldList, newList);
      const visitedDomains = {
        domains: new Set(['google.com', 'facebook.com', 'youtube.com']),
        timestamp: Date.now()
      };

      const result = await TrancoChangeDetector.analyzeChanges(comparison, visitedDomains);

      expect(result.summary.ja).toContain('2個のドメインが除外されました');
      expect(result.summary.en).toContain('2 domains were removed');
    });

    it('should generate bilingual summary for added domains', async () => {
      const oldList = ['google.com'];
      const newList = ['google.com', 'facebook.com', 'youtube.com'];

      const comparison = TrancoChangeDetector.compareTrancoLists(oldList, newList);
      const visitedDomains = {
        domains: new Set(['google.com']),
        timestamp: Date.now()
      };

      const result = await TrancoChangeDetector.analyzeChanges(comparison, visitedDomains);

      expect(result.summary.ja).toContain('2個のドメインが追加されました');
      expect(result.summary.en).toContain('2 domains were added');
    });

    it('should generate no-changes summary', async () => {
      const list = ['google.com', 'facebook.com'];

      const comparison = TrancoChangeDetector.compareTrancoLists(list, list);
      const visitedDomains = {
        domains: new Set(['google.com']),
        timestamp: Date.now()
      };

      const result = await TrancoChangeDetector.analyzeChanges(comparison, visitedDomains);

      expect(result.summary.ja).toBe('Tranco信頼ドメインリストの変更はありません。');
      expect(result.summary.en).toBe('No changes to Tranco trusted domains.');
    });
  });

  describe('generateNotificationMessage', () => {
    it('should generate notification with Japanese and English messages', () => {
      const changeResult = {
        hasChanges: true,
        excludedTrustedDomains: ['facebook.com', 'twitter.com'],
        addedTrustedDomains: ['youtube.com', 'instagram.com'],
        summary: {
          ja: '2個除外され、2個追加されました。',
          en: '2 removed and 2 added.'
        }
      };

      const message = TrancoChangeDetector.generateNotificationMessage(changeResult);

      expect(message.title.ja).toBe('Tranco信頼ドメインリストの更新');
      expect(message.title.en).toBe('Tranco Trusted Domains Update');
      expect(message.message.ja).toContain('Tranco Top 1000');
      expect(message.message.en).toContain('Tranco Top 1000');
      expect(message.excludedDomains).toEqual(['facebook.com', 'twitter.com']);
      expect(message.timestamp).toBeGreaterThan(0);
    });

    it('should handle more than 5 excluded domains', () => {
      const domains = Array.from({ length: 7 }, (_, i) => `domain-${i}.com`);
      const changeResult = {
        hasChanges: true,
        excludedTrustedDomains: domains,
        addedTrustedDomains: [],
        summary: {
          ja: '7個除外されました。',
          en: '7 domains removed.'
        }
      };

      const message = TrancoChangeDetector.generateNotificationMessage(changeResult);

      expect(message.message.ja).toContain('他2件');
      expect(message.message.en).toContain('and 2 more');
    });

    it('should handle more than 5 added domains', () => {
      const domains = Array.from({ length: 6 }, (_, i) => `added-${i}.com`);
      const changeResult = {
        hasChanges: true,
        excludedTrustedDomains: [],
        addedTrustedDomains: domains,
        summary: {
          ja: '6個追加されました。',
          en: '6 domains added.'
        }
      };

      const message = TrancoChangeDetector.generateNotificationMessage(changeResult);

      expect(message.message.ja).toContain(',');
      expect(message.message.en).toContain('and 1 more');
    });
  });

  describe('shouldShowNotification', () => {
    it('should show notification on first time', async () => {
      const shouldShow = await TrancoChangeDetector.shouldShowNotification('2026-03-26');

      expect(shouldShow).toBe(true);
    });

    it('should suppress notification for same version', async () => {
      mockStorage.set('tranco_last_notification', '2026-03-26');

      const shouldShow = await TrancoChangeDetector.shouldShowNotification('2026-03-26');

      expect(shouldShow).toBe(false);
    });

    it('should suppress notification for different version before 7 days', async () => {
      const sixDaysAgo = Date.now() - (6 * 24 * 60 * 60 * 1000);
      mockStorage.set('tranco_last_notification', sixDaysAgo.toString());

      const shouldShow = await TrancoChangeDetector.shouldShowNotification('2026-03-27');

      expect(shouldShow).toBe(false);
    });

    it('should show notification after 7 days', async () => {
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      mockStorage.set('tranco_last_notification', sevenDaysAgo.toString());

      const shouldShow = await TrancoChangeDetector.shouldShowNotification('2026-03-27');

      expect(shouldShow).toBe(true);
    });

    it('should suppress notification before 7 days', async () => {
      const sixDaysAgo = Date.now() - (6 * 24 * 60 * 60 * 1000);
      mockStorage.set('tranco_last_notification', sixDaysAgo.toString());

      const shouldShow = await TrancoChangeDetector.shouldShowNotification('2026-03-26');

      expect(shouldShow).toBe(false);
    });
  });

  describe('recordNotificationShown', () => {
    it('should record notification timestamp', async () => {
      const version = '2026-03-26';

      await TrancoChangeDetector.recordNotificationShown(version);

      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        tranco_last_notification: expect.any(String)
      });
    });
  });

  describe('buildVisitedTrancoDomains', () => {
    it('should extract domains from saved URLs with Tranco flag', () => {
      const savedUrls = [
        { url: 'https://google.com', isTrancoDomain: true },
        { url: 'https://github.com', isTrancoDomain: false },
        { url: 'https://facebook.com/page', isTrancoDomain: true }
      ];

      const trancoSet = new Set(['google.com', 'facebook.com', 'twitter.com']);

      const result = TrancoChangeDetector.buildVisitedTrancoDomains(savedUrls, trancoSet);

      expect(result.domains.has('google.com')).toBe(true);
      expect(result.domains.has('facebook.com')).toBe(true);
      expect(result.domains.has('github.com')).toBe(false);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should handle URLs without protocol', () => {
      const savedUrls = [
        { url: 'example.com', isTrancoDomain: true }
      ];

      const trancoSet = new Set(['example.com']);

      const result = TrancoChangeDetector.buildVisitedTrancoDomains(savedUrls, trancoSet);

      expect(result.domains.has('example.com')).toBe(true);
    });

    it('should handle invalid URLs gracefully', () => {
      const savedUrls = [
        { url: 'https://google.com', isTrancoDomain: true },
        { url: 'not-a-url', isTrancoDomain: true },
        { url: 'https://invalid url', isTrancoDomain: true }
      ];

      const trancoSet = new Set(['google.com']);

      const result = TrancoChangeDetector.buildVisitedTrancoDomains(savedUrls, trancoSet);

      expect(result.domains.has('google.com')).toBe(true);
      // Protocol-less URLs are used as-is, but URLs with space fail to parse
      // 'https://invalid url' fails to parse (skipped)
      // 'not-a-url' has no protocol so is used as-is
      expect(result.domains.has('not-a-url')).toBe(true);
      expect(result.domains.size).toBe(2);
    });

    it('should handle empty saved URLs', () => {
      const savedUrls: Array<{ url: string; isTrancoDomain: boolean }> = [];
      const trancoSet = new Set(['google.com']);

      const result = TrancoChangeDetector.buildVisitedTrancoDomains(savedUrls, trancoSet);

      expect(result.domains.size).toBe(0);
    });
  });
});