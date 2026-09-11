import { describe, test, expect, beforeEach } from 'vitest';
import { HeaderDetector, sessionCacheKeysToEvict } from '../headerDetector.js';
import { RecordingCache } from './helpers/recordingCache.js';
import { checkPrivacy } from '../../utils/privacyChecker.js';
import { ErrorCode } from '../../utils/logger.js';

vi.mock('../../utils/privacyChecker.js', () => ({
  checkPrivacy: vi.fn((headers: any[]) => {
    const hasPrivate = headers?.some((h: any) =>
      h.name?.toLowerCase() === 'cache-control' && h.value?.includes('private')
    );
    return {
      isPrivate: !!hasPrivate,
      reason: hasPrivate ? 'cache-control' : undefined,
      timestamp: Date.now(),
      headers: {},
    };
  }),
}));

vi.mock('../../utils/crypto/index.js', () => ({
  hashUrl: vi.fn((url: string) => Promise.resolve(url)),
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logInfo: vi.fn(() => Promise.resolve()),
  logDebug: vi.fn(() => Promise.resolve()),
  logError: vi.fn(() => Promise.resolve()),
  logWarn: vi.fn(() => Promise.resolve()),
  LogType: { ERROR: 'error', DEBUG: 'debug', INFO: 'info', WARN: 'warn' },
  ErrorCode: {
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    BADGE_UPDATE_FAILED: 'BADGE_UPDATE_FAILED',
  },
}));

import { logError } from '../../utils/logger.js';

describe('HeaderDetector', () => {
  let detector: HeaderDetector;

  beforeEach(async () => {
    await RecordingCache.invalidatePrivacyCache();
    detector = new HeaderDetector(RecordingCache as unknown as import('../recordingCache.js').RecordingCacheInstance);
  });

  describe('cachePrivacyInfo', () => {
    test('saves private info to the cache', () => {
      const url = 'https://example.com/test';
      const info = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      detector['cachePrivacyInfo'](url, info);

      expect(RecordingCache.getPrivacyCache()).not.toBeNull();
      expect(RecordingCache.getPrivacyCache()?.get(url)).toEqual(info);
    });

    test('evicts the oldest entry when the cache exceeds 100 entries', () => {
      // 100エントリを追加
      for (let i = 0; i < 100; i++) {
        detector['cachePrivacyInfo'](`https://example.com/test${i}`, {
          isPrivate: false,
          timestamp: Date.now() + i
        });
      }

      expect(RecordingCache.getPrivacyCache()?.size).toBe(100);

      // 101個目を追加
      detector['cachePrivacyInfo']('https://example.com/test100', {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now() + 1000
      });

      // サイズは100のまま（最も古いエントリが削除される）
      expect(RecordingCache.getPrivacyCache()?.size).toBe(100);
      // 最古のエントリ(test0)が削除されている
      expect(RecordingCache.getPrivacyCache()?.has('https://example.com/test0')).toBe(false);
      // 最新のエントリ(test100)は存在する
      expect(RecordingCache.getPrivacyCache()?.has('https://example.com/test100')).toBe(true);
    });
  });

  describe('sessionCacheKeysToEvict (VULN-003)', () => {
    test('returns 0 when at or under the session-cache cap', () => {
      expect(sessionCacheKeysToEvict(100, 100)).toBe(0);
      expect(sessionCacheKeysToEvict(99, 100)).toBe(0);
    });

    test('returns the excess to evict when over the cap', () => {
      expect(sessionCacheKeysToEvict(101, 100)).toBe(1);
      expect(sessionCacheKeysToEvict(120, 100)).toBe(20);
    });
  });

  describe('onHeadersReceived', () => {
    test('processes main-frame HTML responses', () => {
      const details = {
        url: 'https://example.com/page',
        type: 'main_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
          { name: 'Cache-Control', value: 'private' }
        ]
      } as unknown as chrome.webRequest.OnHeadersReceivedDetails;

      detector['onHeadersReceived'](details);

      const cached = RecordingCache.getPrivacyCache()?.get('https://example.com/page');
      expect(cached).toBeDefined();
      expect(cached?.isPrivate).toBe(true);
      expect(cached?.reason).toBe('cache-control');
    });

    test('ignores subframes', () => {
      const details = {
        url: 'https://example.com/iframe',
        type: 'sub_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Cache-Control', value: 'private' }
        ]
      } as unknown as chrome.webRequest.OnHeadersReceivedDetails;

      detector['onHeadersReceived'](details);

      expect(RecordingCache.getPrivacyCache()?.has('https://example.com/iframe')).toBeFalsy();
    });

    test('ignores non-HTML resources', () => {
      const details = {
        url: 'https://example.com/image.png',
        type: 'main_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'Cache-Control', value: 'private' }
        ]
      } as unknown as chrome.webRequest.OnHeadersReceivedDetails;

      detector['onHeadersReceived'](details);

      expect(RecordingCache.getPrivacyCache()?.has('https://example.com/image.png')).toBeFalsy();
    });

    test('skips responses without Content-Type', () => {
      const details = {
        url: 'https://example.com/noct',
        type: 'main_frame' as chrome.webRequest.ResourceType,
        responseHeaders: []
      } as unknown as chrome.webRequest.OnHeadersReceivedDetails;

      detector['onHeadersReceived'](details);

       expect(RecordingCache.getPrivacyCache()?.has('https://example.com/noct')).toBeFalsy();
     });

    test('should handle errors in onHeadersReceived gracefully', () => {
      vi.mocked(checkPrivacy).mockImplementation(() => {
        throw new Error('Test error');
      });

      const details = {
        url: 'https://example.com/page',
        type: 'main_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html' }
        ] as chrome.webRequest.HttpHeader[]
      } as unknown as chrome.webRequest.OnHeadersReceivedDetails;

      expect(() => detector['onHeadersReceived'](details)).not.toThrow();

      return new Promise<void>(resolve => setTimeout(resolve, 10)).then(() => {
        expect(logError).toHaveBeenCalledWith(
          'HeaderDetector error',
          expect.objectContaining({ 
            error: 'Test error',
            source: 'headerDetector'
          }),
          ErrorCode.UNKNOWN_ERROR
        );
      });
    });
   });

  describe('normalizeUrl', () => {
    test('removes the trailing slash', () => {
      expect(HeaderDetector.normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
    });

    test('keeps the trailing slash of the root path', () => {
      expect(HeaderDetector.normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    test('removes the fragment', () => {
      expect(HeaderDetector.normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
    });

    test('returns invalid URLs as-is', () => {
      expect(HeaderDetector.normalizeUrl('not-a-url')).toBe('not-a-url');
    });
  });

  describe('cachePrivacyInfo', () => {
    test('sets the badge on private detection when tabId is 0 or greater', async () => {
      chrome.action.setBadgeText = vi.fn(() => Promise.resolve());
      chrome.action.setBadgeBackgroundColor = vi.fn(() => Promise.resolve());

      await detector['cachePrivacyInfo']('https://badge.com', {
        isPrivate: true,
        reason: 'set-cookie',
        timestamp: Date.now()
      }, 42);

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!', tabId: 42 });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalled();
    });

    test('skips the badge when tabId is -1', async () => {
      chrome.action.setBadgeText = vi.fn(() => Promise.resolve());

      await detector['cachePrivacyInfo']('https://bg.com', {
        isPrivate: true,
        reason: 'cache-control',
        timestamp: Date.now()
      }, -1);

      expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    test('does not set the badge for non-private pages', async () => {
      chrome.action.setBadgeText = vi.fn(() => Promise.resolve());

      await detector['cachePrivacyInfo']('https://pub.com', {
        isPrivate: false,
        timestamp: Date.now()
      }, 1);

      expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    test('logs badge-setting errors', async () => {
      chrome.action.setBadgeText = vi.fn(() => Promise.reject(new Error('Badge error')));
      chrome.action.setBadgeBackgroundColor = vi.fn(() => Promise.resolve());

      await detector['cachePrivacyInfo']('https://err.com', {
        isPrivate: true,
        reason: 'auth' as 'authorization',
        timestamp: Date.now()
      }, 1);

      expect(logError).toHaveBeenCalled();
    });
  });

  describe('evictOldestEntry', () => {
    test('does nothing when the cache is empty', async () => {
      RecordingCache.invalidatePrivacyCache();
      await expect(detector['evictOldestEntry']()).resolves.not.toThrow();
    });
  });

  describe('initialize', () => {
    test('logs an error and returns when chrome.webRequest is undefined', async () => {
      const origWebRequest = chrome.webRequest;
      // @ts-expect-error
      delete chrome.webRequest;

      await detector.initialize();

      expect(logError).toHaveBeenCalled();
      chrome.webRequest = origWebRequest;
    });

    test('logs an error when listener registration fails', async () => {
      chrome.webRequest = {
        onHeadersReceived: {
          addListener: vi.fn(() => { throw new Error('Permission denied'); }),
          removeListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn(),
        }
      } as any;

      await detector.initialize();

      expect(logError).toHaveBeenCalled();
    });
  });
});
