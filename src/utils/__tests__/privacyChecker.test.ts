
import { checkPrivacy } from '../privacyChecker.js';

describe('privacyChecker', () => {
  describe('checkPrivacy - Cache-Control detection', () => {
    test('detects Cache-Control: private', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Cache-Control', value: 'private, max-age=0' },
        { name: 'Content-Type', value: 'text/html' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('cache-control');
      expect(result.headers?.cacheControl).toBe('private, max-age=0');
    });

    test('does not treat Cache-Control: no-store alone as private', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Cache-Control', value: 'no-store' }
      ];

      const result = checkPrivacy(headers);

      // no-store 単独では判定しない（ニュースサイト等でも使用されるため）
      expect(result.isPrivate).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    test('treats Cache-Control: no-store + Set-Cookie as private', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        { name: 'Set-Cookie', value: 'session=abc123' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('cache-control');
      expect(result.headers?.hasCookie).toBe(true);
    });

    test('does not treat Cache-Control: no-cache as private (commonly used on news sites)', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'cache-control', value: 'no-cache, must-revalidate' }
      ];

      const result = checkPrivacy(headers);

      // no-cache は「再検証必須」を意味するだけで、プライベートページではない
      // ニュースサイトなど公開ページでも頻繁に使用されるため、プライベート判定から除外
      expect(result.isPrivate).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('checkPrivacy - Set-Cookie detection', () => {
    test('does not treat Set-Cookie alone as private', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Set-Cookie', value: 'session=abc123; HttpOnly' },
        { name: 'Content-Type', value: 'text/html' }
      ];

      const result = checkPrivacy(headers);

      // Set-Cookie 単独では判定しない（CNNなど公開ページでも使用されるため）
      expect(result.isPrivate).toBe(false);
      expect(result.headers?.hasCookie).toBe(true);
    });

    test('treats Set-Cookie + Vary: Cookie as private', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Set-Cookie', value: 'session=abc123; HttpOnly' },
        { name: 'Vary', value: 'Cookie, Accept-Encoding' }
      ];

      const result = checkPrivacy(headers);

      // Vary: Cookie があれば、コンテンツがユーザーによって出し分けられている
      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('set-cookie');
      expect(result.headers?.hasCookie).toBe(true);
    });
  });

  describe('checkPrivacy - Authorization detection', () => {
    test('detects the Authorization header', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Authorization', value: 'Bearer token123' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('authorization');
      expect(result.headers?.hasAuth).toBe(true);
    });
  });

  describe('checkPrivacy - 複数条件の優先順位', () => {
    test('prioritizes Cache-Control over other signals', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Cache-Control', value: 'private' },
        { name: 'Set-Cookie', value: 'session=abc' },
        { name: 'Authorization', value: 'Bearer token' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('cache-control');
    });

    test('prioritizes Set-Cookie + Vary: Cookie over Authorization', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Set-Cookie', value: 'session=abc' },
        { name: 'Vary', value: 'Cookie' },
        { name: 'Authorization', value: 'Bearer token' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('set-cookie');
    });
  });

  describe('checkPrivacy - 非プライベートページ', () => {
    test('returns isPrivate: false when no private headers exist', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Content-Type', value: 'text/html' },
        { name: 'Cache-Control', value: 'public, max-age=3600' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    test('returns isPrivate: false for an empty header array', () => {
      const result = checkPrivacy([]);

      expect(result.isPrivate).toBe(false);
      expect(result.timestamp).toBeDefined();
    });
  });
});
