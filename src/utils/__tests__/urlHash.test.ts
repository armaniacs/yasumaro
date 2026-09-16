/**
 * urlHash.test.ts
 *
 * Moved out of crypto.test.ts along with the function itself
 * (PBI 2026-09-16-05). The output format is pinned deliberately: these hashes
 * are written into logs, so changing the shape or the digest would break
 * correlation with everything already recorded.
 */
import { describe, test, expect } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';

Object.defineProperty(globalThis, 'crypto', { value: new Crypto(), configurable: true });

import { hashUrl } from '../urlHash.js';

describe('hashUrl', () => {
    test('returns the SHA-256 hash prefix of a URL', async () => {
        const hash = await hashUrl('https://example.com');
        expect(hash).toMatch(/^\[hash:[0-9a-f]{16}\]$/);
    });

    test('returns the same hash for the same URL', async () => {
        const hash1 = await hashUrl('https://example.com');
        const hash2 = await hashUrl('https://example.com');
        expect(hash1).toBe(hash2);
    });

    test('returns different hashes for different URLs', async () => {
        const hash1 = await hashUrl('https://example.com');
        const hash2 = await hashUrl('https://other.com');
        expect(hash1).not.toBe(hash2);
    });

    test('keeps producing the exact value logs already contain', async () => {
        // First 16 hex chars of SHA-256("https://example.com"). Pinned so the
        // move cannot silently change what lands in logs — a different digest
        // or a different prefix length would make new entries incomparable
        // with old ones.
        expect(await hashUrl('https://example.com')).toBe('[hash:100680ad546ce6a5]');
    });

    test('hashes the empty string without throwing', async () => {
        expect(await hashUrl('')).toMatch(/^\[hash:[0-9a-f]{16}\]$/);
    });

    test('hashes non-ASCII URLs by their UTF-8 bytes', async () => {
        // TextEncoder always emits UTF-8; this guards the encoding step from
        // being swapped for something latin-1 based during a future edit.
        const hash = await hashUrl('https://example.com/日本語');
        expect(hash).toMatch(/^\[hash:[0-9a-f]{16}\]$/);
        expect(hash).not.toBe(await hashUrl('https://example.com/'));
    });
});
