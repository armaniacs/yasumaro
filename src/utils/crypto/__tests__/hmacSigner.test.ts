/**
 * hmacSigner.test.ts
 *
 * The HmacSigner seam (PBI 2026-09-16-04). The property that matters most
 * here is compatibility: signatures already exist in places the extension
 * cannot rewrite — exported files on the user's disk, the stored privacy
 * consent — so a signer must reproduce byte-for-byte what the function it
 * replaces produced. Everything else is secondary to that.
 */
import { describe, it, expect } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';

Object.defineProperty(globalThis, 'crypto', { value: new Crypto(), configurable: true });

import { hmacSignerForKey, hmacSignerForSecret } from '../hmacSigner.js';
import { computeHMAC, bytesToBase64, bytesToBase64Url } from '../primitives.js';

const SECRET = 'test-secret-value';

async function importKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
}

/** The pre-seam spelling of the CryptoKey path (hmacKeyStore). */
async function legacySignWithKey(data: string, key: CryptoKey): Promise<string> {
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return bytesToBase64Url(new Uint8Array(sig));
}

describe('HmacSigner — compatibility with the functions it replaces', () => {
    it('reproduces computeHMAC exactly (standard base64 / string secret)', async () => {
        const signer = hmacSignerForSecret(async () => SECRET, 'base64');

        // Export files on disk carry these signatures; a mismatch here means a
        // restored backup would be rejected as tampered.
        for (const data of ['', 'a', '{"settings":{"x":1}}', '日本語 🎌', 'x'.repeat(5000)]) {
            expect(await signer.sign(data)).toBe(await computeHMAC(SECRET, data));
        }
    });

    it('reproduces generateHmacSignature exactly (base64url / CryptoKey)', async () => {
        const key = await importKey(SECRET);
        const signer = hmacSignerForKey(async () => key, 'base64url');

        // The stored privacy consent carries these; a mismatch would read as
        // tampered and silently reset the user's consent.
        for (const data of ['', 'https://example.com/a?b=c', '日本語 🎌']) {
            expect(await signer.sign(data)).toBe(await legacySignWithKey(data, key));
        }
    });

    it('produces the same bytes for both key shapes, differing only in encoding', async () => {
        const fromSecret = hmacSignerForSecret(async () => SECRET, 'base64');
        const fromKey = hmacSignerForKey(async () => importKey(SECRET), 'base64');

        // Same algorithm, same key material — the two paths were never
        // cryptographically different, only differently spelled.
        expect(await fromKey.sign('payload')).toBe(await fromSecret.sign('payload'));
    });
});

describe('HmacSigner — behaviour', () => {
    it('verifies its own signature', async () => {
        const signer = hmacSignerForSecret(async () => SECRET, 'base64');
        const data = 'some payload';

        expect(await signer.verify(data, await signer.sign(data))).toBe(true);
    });

    it('rejects a signature for different data', async () => {
        const signer = hmacSignerForSecret(async () => SECRET, 'base64');

        expect(await signer.verify('other payload', await signer.sign('some payload'))).toBe(false);
    });

    it('rejects a signature made with a different secret', async () => {
        const signer = hmacSignerForSecret(async () => SECRET, 'base64');
        const other = hmacSignerForSecret(async () => 'different-secret', 'base64');

        expect(await signer.verify('payload', await other.sign('payload'))).toBe(false);
    });

    it('rejects an empty or malformed signature without throwing', async () => {
        const signer = hmacSignerForSecret(async () => SECRET, 'base64');

        expect(await signer.verify('payload', '')).toBe(false);
        expect(await signer.verify('payload', 'not-a-signature')).toBe(false);
    });

    it('does not accept a base64url signature against a base64 signer', async () => {
        // Guards the reason encoding is per-signer: the two renderings of the
        // same bytes are not interchangeable, so mixing them must fail closed.
        const data = 'payload with bytes that differ: ûÿ';
        const b64 = hmacSignerForSecret(async () => SECRET, 'base64');
        const b64url = hmacSignerForSecret(async () => SECRET, 'base64url');

        const urlSig = await b64url.sign(data);
        // Only meaningful when the two encodings actually differ for this input.
        if (urlSig !== (await b64.sign(data))) {
            expect(await b64.verify(data, urlSig)).toBe(false);
        }
    });

    it('resolves the key on every call, not once at construction', async () => {
        // Keys are unwrapped from chrome.storage and a service worker restart
        // can invalidate them; a signer that cached one would go stale.
        let calls = 0;
        const signer = hmacSignerForSecret(async () => {
            calls += 1;
            return SECRET;
        }, 'base64');

        await signer.sign('a');
        await signer.sign('b');

        expect(calls).toBe(2);
    });
});
