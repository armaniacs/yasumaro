/**
 * service-worker-base64.test.ts
 * URL-safe Base64 エンコード/デコード関数のテスト
 *
 * テスト対象:
 * - encodeUrlSafeBase64(url: string): string
 * - decodeUrlFromNotificationId(notificationId: string): string | null
 */


import { PRIVACY_CONFIRM_NOTIFICATION_PREFIX } from '../notificationHelper.js';

/**
 * Encode URL to URL-safe base64 using TextEncoder for proper Unicode handling.
 * This is more robust than btoa(unescape(encodeURIComponent(url))).
 */
function encodeUrlSafeBase64(url: string): string {
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const binaryString = String.fromCharCode(...data);
    return btoa(binaryString)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Decode URL from notification ID (URL-safe base64).
 * Uses TextDecoder for proper Unicode handling.
 */
function decodeUrlFromNotificationId(notificationId: string): string | null {
    if (!notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX)) return null;
    try {
        const b64safe = notificationId.slice(PRIVACY_CONFIRM_NOTIFICATION_PREFIX.length);
        const b64 = b64safe.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
        const binaryString = atob(padded);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const decoder = new TextDecoder();
        return decoder.decode(bytes);
    } catch {
        return null;
    }
}

describe('Service Worker: URL-safe Base64 エンコード/デコード', () => {
    describe('encodeUrlSafeBase64', () => {
        it('encodes an ASCII URL correctly', () => {
            const url = 'https://example.com/page';
            const encoded = encodeUrlSafeBase64(url);
            expect(encoded).toBeDefined();
            expect(typeof encoded).toBe('string');
            // URL-safe base64の特性確認
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');
        });

        it('encodes a Unicode URL (Japanese) correctly', () => {
            const url = 'https://example.com/日本語/ページ';
            const encoded = encodeUrlSafeBase64(url);
            expect(encoded).toBeDefined();
            expect(typeof encoded).toBe('string');
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');
        });

        it('encodes a URL with query parameters correctly', () => {
            const url = 'https://example.com/search?q=test&page=1';
            const encoded = encodeUrlSafeBase64(url);
            expect(encoded).toBeDefined();
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');
        });

        it('round-trips an ASCII URL back to the original', () => {
            const originalUrl = 'https://example.com/path/to/page';
            const encoded = encodeUrlSafeBase64(originalUrl);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(originalUrl);
        });

        it('round-trips a Unicode URL back to the original', () => {
            const originalUrl = 'https://example.com/test/テスト?query=日本語';
            const encoded = encodeUrlSafeBase64(originalUrl);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(originalUrl);
        });

        it('handles URLs with special characters correctly', () => {
            const urls = [
                'https://example.com/path_with_underscore',
                'https://example.com/path-with-dash',
                'https://example.com/path.with.dots',
                'https://example.com/path%20with%20spaces',
            ];
            for (const url of urls) {
                const encoded = encodeUrlSafeBase64(url);
                expect(encoded).toBeDefined();
            }
        });

        it('encodes a very long URL correctly', () => {
            const longPath = 'a'.repeat(1000);
            const url = `https://example.com/${longPath}`;
            const encoded = encodeUrlSafeBase64(url);
            expect(encoded).toBeDefined();
        });
    });

    describe('decodeUrlFromNotificationId', () => {
        it('decodes a URL from a notification ID correctly (ASCII)', () => {
            const originalUrl = 'https://example.com/page';
            const encoded = encodeUrlSafeBase64(originalUrl);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(originalUrl);
        });

        it('decodes a URL from a notification ID correctly (Unicode)', () => {
            const originalUrl = 'https://example.com/日本語/ページ';
            const encoded = encodeUrlSafeBase64(originalUrl);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(originalUrl);
        });

        it('returns null for a malformed notification ID', () => {
            const invalidIds = [
                'invalid-prefix-abc123',
                'some-other-prefix-encoded',
                '',
                'just-random-string',
            ];
            for (const id of invalidIds) {
                expect(decodeUrlFromNotificationId(id)).toBeNull();
            }
        });

        it('returns an empty string for a prefix-only private notification ID', () => {
            const id = PRIVACY_CONFIRM_NOTIFICATION_PREFIX;
            // 空文字列は有効なBase64としてデコードされるため空文字列が返る
            expect(decodeUrlFromNotificationId(id)).toBe('');
        });

        it('returns null for corrupted Base64', () => {
            const id = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + '!!!invalid-base64!!!';
            expect(decodeUrlFromNotificationId(id)).toBeNull();
        });
    });

    describe('エンコード/デコードの互換性', () => {
        // 旧実装（btoa(unescape(encodeURIComponent(url)))）との互換性テスト
        // 新実装（TextEncoder/TextDecoder）はUnicode対応が改善されているため、
        // 旧実装でエンコードされた文字列も正しくデコードできるはず

        it('decodes an ASCII URL encoded by the legacy implementation', () => {
            const url = 'https://example.com/page';
            // 旧実装のシミュレーション
            const oldEncoded = btoa(unescape(encodeURIComponent(url)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + oldEncoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(url);
        });

        it('produces URL-safe output for encoded URLs', () => {
            const testUrls = [
                'https://example.com/test',
                'https://example.com/path/with/slashes',
                'https://example.com/パス/スラッシュ',
                'https://example.com?query=param+with+plus',
            ];
            for (const url of testUrls) {
                const encoded = encodeUrlSafeBase64(url);
                // Chrome通知IDの要件に対応
                expect(encoded).not.toContain('+');
                expect(encoded).not.toContain('/');
                expect(encoded).not.toContain('=');
            }
        });
    });

    describe('境界値とエッジケース', () => {
        it('encodes and decodes an empty string', () => {
            const url = '';
            const encoded = encodeUrlSafeBase64(url);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(url);
        });

        it('handles a short single-character URL correctly', () => {
            const url = 'a';
            const encoded = encodeUrlSafeBase64(url);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(url);
        });

        it('handles a URL containing emoji correctly', () => {
            const url = 'https://example.com/🎉🚀';
            const encoded = encodeUrlSafeBase64(url);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(url);
        });

        it('handles a URL with mixed-script characters correctly', () => {
            const url = 'https://example.com/مرحبا/世界';
            const encoded = encodeUrlSafeBase64(url);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(url);
        });
    });

    describe('実装の妥当性', () => {
        it('exposes TextEncoder and TextDecoder', () => {
            expect(typeof TextEncoder).toBe('function');
            expect(typeof TextDecoder).toBe('function');
        });

        it('exposes btoa and atob', () => {
            expect(typeof btoa).toBe('function');
            expect(typeof atob).toBe('function');
        });

        it('round-trips TextEncoder encoding via TextDecoder symmetrically', () => {
            const testStrings = [
                'ascii',
                '日本語',
                'Hello 世界',
                '🎉',
                '',
            ];
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();
            for (const str of testStrings) {
                const encoded = encoder.encode(str);
                const decoded = decoder.decode(encoded);
                expect(decoded).toBe(str);
            }
        });
    });
});