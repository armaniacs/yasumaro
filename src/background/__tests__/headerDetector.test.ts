import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { HeaderDetector } from '../headerDetector.js';
import { RecordingLogic } from '../recordingLogic.js';

jest.mock('../../utils/privacyChecker.js', () => ({
  checkPrivacy: jest.fn((headers: any[]) => {
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

jest.mock('../../utils/crypto.js', () => ({
  hashUrl: jest.fn((url: string) => Promise.resolve(url)),
}));

jest.mock('../../utils/logger.js', () => ({
  addLog: jest.fn(),
  logInfo: jest.fn(() => Promise.resolve()),
  logDebug: jest.fn(() => Promise.resolve()),
  logError: jest.fn(() => Promise.resolve()),
  logWarn: jest.fn(() => Promise.resolve()),
  LogType: { ERROR: 'error', DEBUG: 'debug', INFO: 'info', WARN: 'warn' },
  ErrorCode: {
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    BADGE_UPDATE_FAILED: 'BADGE_UPDATE_FAILED',
  },
}));

import { logError } from '../../utils/logger.js';

describe('HeaderDetector', () => {
  beforeEach(() => {
    RecordingLogic.invalidatePrivacyCache();
  });

  describe('cachePrivacyInfo', () => {
    test('プライベート情報をキャッシュに保存できる', () => {
      const url = 'https://example.com/test';
      const info = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      HeaderDetector['cachePrivacyInfo'](url, info);

      expect(RecordingLogic.cacheState.privacyCache).not.toBeNull();
      expect(RecordingLogic.cacheState.privacyCache?.get(url)).toEqual(info);
    });

    test('キャッシュサイズが100を超えたら最も古いエントリを削除する', () => {
      // 100エントリを追加
      for (let i = 0; i < 100; i++) {
        HeaderDetector['cachePrivacyInfo'](`https://example.com/test${i}`, {
          isPrivate: false,
          timestamp: Date.now() + i
        });
      }

      expect(RecordingLogic.cacheState.privacyCache?.size).toBe(100);

      // 101個目を追加
      HeaderDetector['cachePrivacyInfo']('https://example.com/test100', {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now() + 1000
      });

      // サイズは100のまま（最も古いエントリが削除される）
      expect(RecordingLogic.cacheState.privacyCache?.size).toBe(100);
      // 最古のエントリ(test0)が削除されている
      expect(RecordingLogic.cacheState.privacyCache?.has('https://example.com/test0')).toBe(false);
      // 最新のエントリ(test100)は存在する
      expect(RecordingLogic.cacheState.privacyCache?.has('https://example.com/test100')).toBe(true);
    });
  });

  describe('onHeadersReceived', () => {
    test('メインフレームのHTMLレスポンスを処理できる', () => {
      const details = {
        url: 'https://example.com/page',
        type: 'main_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
          { name: 'Cache-Control', value: 'private' }
        ]
      } as chrome.webRequest.WebResponseHeadersDetails;

      HeaderDetector['onHeadersReceived'](details);

      const cached = RecordingLogic.cacheState.privacyCache?.get('https://example.com/page');
      expect(cached).toBeDefined();
      expect(cached?.isPrivate).toBe(true);
      expect(cached?.reason).toBe('cache-control');
    });

    test('サブフレームは無視する', () => {
      const details = {
        url: 'https://example.com/iframe',
        type: 'sub_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Cache-Control', value: 'private' }
        ]
      } as chrome.webRequest.WebResponseHeadersDetails;

      HeaderDetector['onHeadersReceived'](details);

      expect(RecordingLogic.cacheState.privacyCache?.has('https://example.com/iframe')).toBeFalsy();
    });

    test('非HTMLリソースは無視する', () => {
      const details = {
        url: 'https://example.com/image.png',
        type: 'main_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'Cache-Control', value: 'private' }
        ]
      } as chrome.webRequest.WebResponseHeadersDetails;

      HeaderDetector['onHeadersReceived'](details);

      expect(RecordingLogic.cacheState.privacyCache?.has('https://example.com/image.png')).toBeFalsy();
    });

    test('Content-Typeがない場合もスキップする', () => {
      const details = {
        url: 'https://example.com/noct',
        type: 'main_frame' as chrome.webRequest.ResourceType,
        responseHeaders: []
      } as chrome.webRequest.WebResponseHeadersDetails;

      HeaderDetector['onHeadersReceived'](details);

      expect(RecordingLogic.cacheState.privacyCache?.has('https://example.com/noct')).toBeFalsy();
    });
  });

  describe('normalizeUrl', () => {
    test('末尾スラッシュを削除する', () => {
      expect(HeaderDetector.normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
    });

    test('ルートパスの末尾スラッシュは削除しない', () => {
      expect(HeaderDetector.normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    test('フラグメントを削除する', () => {
      expect(HeaderDetector.normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
    });

    test('不正なURLはそのまま返す', () => {
      expect(HeaderDetector.normalizeUrl('not-a-url')).toBe('not-a-url');
    });
  });

  describe('cachePrivacyInfo', () => {
    test('tabIdが0以上でプライベート検出時にバッジを設定する', async () => {
      chrome.action.setBadgeText = jest.fn(() => Promise.resolve());
      chrome.action.setBadgeBackgroundColor = jest.fn(() => Promise.resolve());

      await HeaderDetector['cachePrivacyInfo']('https://badge.com', {
        isPrivate: true,
        reason: 'set-cookie',
        timestamp: Date.now()
      }, 42);

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!', tabId: 42 });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalled();
    });

    test('tabIdが-1の場合はバッジをスキップする', async () => {
      chrome.action.setBadgeText = jest.fn(() => Promise.resolve());

      await HeaderDetector['cachePrivacyInfo']('https://bg.com', {
        isPrivate: true,
        reason: 'cache-control',
        timestamp: Date.now()
      }, -1);

      expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    test('非プライベートではバッジを設定しない', async () => {
      chrome.action.setBadgeText = jest.fn(() => Promise.resolve());

      await HeaderDetector['cachePrivacyInfo']('https://pub.com', {
        isPrivate: false,
        timestamp: Date.now()
      }, 1);

      expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    test('バッジ設定エラーをログに記録する', async () => {
      chrome.action.setBadgeText = jest.fn(() => Promise.reject(new Error('Badge error')));
      chrome.action.setBadgeBackgroundColor = jest.fn(() => Promise.resolve());

      await HeaderDetector['cachePrivacyInfo']('https://err.com', {
        isPrivate: true,
        reason: 'auth',
        timestamp: Date.now()
      }, 1);

      expect(logError).toHaveBeenCalled();
    });
  });

  describe('evictOldestEntry', () => {
    test('キャッシュが空の場合は何もしない', async () => {
      RecordingLogic.invalidatePrivacyCache();
      await HeaderDetector['evictOldestEntry']();
      // エラーなく完了
    });
  });

  describe('initialize', () => {
    test('chrome.webRequestが未定義の場合はエラーログを出力してreturnする', async () => {
      const origWebRequest = chrome.webRequest;
      // @ts-expect-error
      delete chrome.webRequest;

      await HeaderDetector.initialize();

      expect(logError).toHaveBeenCalled();
      chrome.webRequest = origWebRequest;
    });

    test('リスナー登録に失敗した場合はエラーログを出力する', async () => {
      chrome.webRequest = {
        onHeadersReceived: {
          addListener: jest.fn(() => { throw new Error('Permission denied'); }),
          removeListener: jest.fn(),
          hasListener: jest.fn(),
          hasListeners: jest.fn(),
        }
      } as any;

      await HeaderDetector.initialize();

      expect(logError).toHaveBeenCalled();
    });
  });
});
