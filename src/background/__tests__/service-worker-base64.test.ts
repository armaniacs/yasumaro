/**
 * service-worker-base64.test.ts
 * URL-safe Base64 エンコード/デコード関数のテスト
 *
 * テスト対象:
 * - encodeUrlSafeBase64(url: string): string
 * - decodeUrlFromNotificationId(notificationId: string): string | null
 */

import { describe, it, expect } from '@jest/globals';
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
        it('ASCII URL を正しくエンコードする', () => {
            const url = 'https://example.com/page';
            const encoded = encodeUrlSafeBase64(url);
            expect(encoded).toBeDefined();
            expect(typeof encoded).toBe('string');
            // URL-safe base64の特性確認
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');
        });

        it('Unicode URL（日本語）を正しくエンコードする', () => {
            const url = 'https://example.com/日本語/ページ';
            const encoded = encodeUrlSafeBase64(url);
            expect(encoded).toBeDefined();
            expect(typeof encoded).toBe('string');
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');
        });

        it('クエリパラメータ付きURLを正しくエンコードする', () => {
            const url = 'https://example.com/search?q=test&page=1';
            const encoded = encodeUrlSafeBase64(url);
            expect(encoded).toBeDefined();
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');
        });

        it('エンコードとデコードの往復で元のURLを復元できる（ASCII）', () => {
            const originalUrl = 'https://example.com/path/to/page';
            const encoded = encodeUrlSafeBase64(originalUrl);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(originalUrl);
        });

        it('エンコードとデコードの往復で元のURLを復元できる（Unicode）', () => {
            const originalUrl = 'https://example.com/test/テスト?query=日本語';
            const encoded = encodeUrlSafeBase64(originalUrl);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(originalUrl);
        });

        it('特殊文字を含むURLを正しく処理する', () => {
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

        it('非常に長いURLを正しくエンコードする', () => {
            const longPath = 'a'.repeat(1000);
            const url = `https://example.com/${longPath}`;
            const encoded = encodeUrlSafeBase64(url);
            expect(encoded).toBeDefined();
        });
    });

    describe('decodeUrlFromNotificationId', () => {
        it('通知IDからURLを正しくデコードする（ASCII）', () => {
            const originalUrl = 'https://example.com/page';
            const encoded = encodeUrlSafeBase64(originalUrl);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(originalUrl);
        });

        it('通知IDからURLを正しくデコードする（Unicode）', () => {
            const originalUrl = 'https://example.com/日本語/ページ';
            const encoded = encodeUrlSafeBase64(originalUrl);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(originalUrl);
        });

        it('不正な通知ID形式の場合はnullを返す', () => {
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

        it('プライベート通知プレフィックスのみの場合は空文字列を返す', () => {
            const id = PRIVACY_CONFIRM_NOTIFICATION_PREFIX;
            // 空文字列は有効なBase64としてデコードされるため空文字列が返る
            expect(decodeUrlFromNotificationId(id)).toBe('');
        });

        it('破損したBase64の場合はnullを返す', () => {
            const id = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + '!!!invalid-base64!!!';
            expect(decodeUrlFromNotificationId(id)).toBeNull();
        });
    });

    describe('エンコード/デコードの互換性', () => {
        // 旧実装（btoa(unescape(encodeURIComponent(url)))）との互換性テスト
        // 新実装（TextEncoder/TextDecoder）はUnicode対応が改善されているため、
        // 旧実装でエンコードされた文字列も正しくデコードできるはず

        it('古い実装でエンコードされたASCII URLを新実装でデコードできる', () => {
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

        it('エンコードされたURLがURL-safeとなっていることを確認', () => {
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
        it('空文字列をエンコード・デコードできる', () => {
            const url = '';
            const encoded = encodeUrlSafeBase64(url);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(url);
        });

        it('短いURL（1文字）を正しく処理する', () => {
            const url = 'a';
            const encoded = encodeUrlSafeBase64(url);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(url);
        });

        it('絵文字を含むURLを正しく処理する', () => {
            const url = 'https://example.com/🎉🚀';
            const encoded = encodeUrlSafeBase64(url);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(url);
        });

        it('複合スクリプト文字を含むURLを正しく処理する', () => {
            const url = 'https://example.com/مرحبا/世界';
            const encoded = encodeUrlSafeBase64(url);
            const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encoded;
            const decoded = decodeUrlFromNotificationId(notificationId);
            expect(decoded).toBe(url);
        });
    });

    describe('実装の妥当性', () => {
        it('TextEncoderとTextDecoderが使用可能である', () => {
            expect(typeof TextEncoder).toBe('function');
            expect(typeof TextDecoder).toBe('function');
        });

        it('btoaとatobが使用可能である', () => {
            expect(typeof btoa).toBe('function');
            expect(typeof atob).toBe('function');
        });

        it('TextEncoderでのエンコードとTextDecoderでのデコードが対称である', () => {
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