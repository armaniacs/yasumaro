import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { HeaderDetector } from '../headerDetector.js';
import { RecordingLogic } from '../recordingLogic.js';

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
  });
});
