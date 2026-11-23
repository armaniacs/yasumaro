/**
 * privacyCheckerRobustness.test.ts — PBI 2026-11-08-09 (7)(8)
 *
 * Pins that corrupt cache entries are detected by the type guard and that
 * empty-valued headers are never treated as private signals.
 */
import { describe, it, expect } from 'vitest';
import { checkPrivacy, isPrivacyInfo } from '../privacyChecker.js';

function header(name: string, value: string): chrome.webRequest.HttpHeader {
    return { name, value } as chrome.webRequest.HttpHeader;
}

describe('privacyChecker robustness', () => {
    describe('isPrivacyInfo', () => {
        it('accepts a well-formed entry produced by checkPrivacy', () => {
            expect(isPrivacyInfo(checkPrivacy([]))).toBe(true);
            expect(isPrivacyInfo(checkPrivacy([header('Cache-Control', 'private')]))).toBe(true);
        });

        it('rejects non-object values', () => {
            expect(isPrivacyInfo(null)).toBe(false);
            expect(isPrivacyInfo('private')).toBe(false);
            expect(isPrivacyInfo(42)).toBe(false);
            expect(isPrivacyInfo([])).toBe(false);
        });

        it('rejects a wrongly typed isPrivate flag', () => {
            expect(isPrivacyInfo({ isPrivate: 'yes', timestamp: 1 })).toBe(false);
            expect(isPrivacyInfo({ timestamp: 1 })).toBe(false);
        });

        it('rejects non-finite or negative timestamps', () => {
            expect(isPrivacyInfo({ isPrivate: true, timestamp: NaN })).toBe(false);
            expect(isPrivacyInfo({ isPrivate: true, timestamp: Infinity })).toBe(false);
            expect(isPrivacyInfo({ isPrivate: true, timestamp: -1 })).toBe(false);
            expect(isPrivacyInfo({ isPrivate: true, timestamp: 'now' })).toBe(false);
        });

        it('rejects an unknown reason literal but keeps known ones', () => {
            expect(isPrivacyInfo({ isPrivate: true, timestamp: 1, reason: 'session' })).toBe(false);
            expect(isPrivacyInfo({ isPrivate: true, timestamp: 1, reason: 'set-cookie' })).toBe(true);
            expect(isPrivacyInfo({ isPrivate: true, timestamp: 1 })).toBe(true);
        });

        it('rejects malformed headers shapes', () => {
            expect(isPrivacyInfo({ isPrivate: true, timestamp: 1, headers: null })).toBe(false);
            expect(isPrivacyInfo({ isPrivate: true, timestamp: 1, headers: { hasCookie: 'yes' } })).toBe(false);
            expect(isPrivacyInfo({ isPrivate: true, timestamp: 1, headers: { cacheControl: 123 } })).toBe(false);
            expect(
                isPrivacyInfo({ isPrivate: false, timestamp: 1, headers: { hasCookie: false, hasAuth: false } }),
            ).toBe(true);
        });
    });

    describe('checkPrivacy empty headers', () => {
        it('does not treat an empty Set-Cookie as private', () => {
            const info = checkPrivacy([header('Set-Cookie', ''), header('Vary', 'Cookie')]);
            expect(info.isPrivate).toBe(false);
        });

        it('does not treat a whitespace-only Set-Cookie as private', () => {
            const info = checkPrivacy([header('Set-Cookie', '   '), header('Vary', 'Cookie')]);
            expect(info.isPrivate).toBe(false);
        });

        it('does not treat an empty Authorization header as private', () => {
            const info = checkPrivacy([header('Authorization', '')]);
            expect(info.isPrivate).toBe(false);
        });

        it('does not combine no-store with an empty Set-Cookie into private', () => {
            const info = checkPrivacy([header('Cache-Control', 'no-store'), header('Set-Cookie', '')]);
            expect(info.isPrivate).toBe(false);
        });

        it('still treats a non-empty Set-Cookie with Vary: Cookie as private', () => {
            const info = checkPrivacy([header('Set-Cookie', 'session=abc'), header('Vary', 'Cookie')]);
            expect(info.isPrivate).toBe(true);
            expect(info.reason).toBe('set-cookie');
        });

        it('still detects a non-empty Authorization header', () => {
            const info = checkPrivacy([header('Authorization', 'Bearer token')]);
            expect(info.isPrivate).toBe(true);
            expect(info.reason).toBe('authorization');
        });
    });
});
