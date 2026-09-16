/**
 * exportSignatureIntegration.test.ts
 *
 * Signs and verifies through the REAL exportHmacSigner — no mock of the
 * signer, no mock of the crypto seam.
 *
 * Why this exists: the suites that own the export/import flows
 * (settingsExportImport*.test.ts, importLogsService*.test.ts,
 * exportLogsService.test.ts) all replace the signer with a stub, so the
 * behaviour they assert is the stub's, not the product's. Mutation testing
 * showed what that costs — making `verify` return `true` unconditionally, a
 * complete bypass of signature checking, left every one of those suites
 * green. Same for swapping the signer's encoding, which the file comment on
 * hmacSigner.ts calls out as the thing that would invalidate every export
 * already on a user's disk.
 *
 * This file is deliberately narrow: it does not re-test the export format,
 * only that a tampered payload is rejected and an authentic one is accepted
 * when the real signer is on the path.
 */
import { describe, it, expect } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';

Object.defineProperty(globalThis, 'crypto', { value: new Crypto(), configurable: true });

import { exportHmacSigner } from '../storage/encryptionSession.js';

// No storage reset between tests: getOrCreateHmacSecret memoises the secret
// in module scope, so clearing chrome.storage.local would not produce a new
// one anyway. Every test here signs and verifies under the same secret,
// which is what the export/import round trip does in practice.

/** Shape mirroring what exportJson / exportSettings sign. */
function bodyOf(rows: unknown[]): string {
    return JSON.stringify({ version: 2, table: 'browsing_logs', rows }, null, 2);
}

describe('export signing through the real signer', () => {
    it('accepts a payload it signed itself', async () => {
        const body = bodyOf([{ url: 'https://example.com', created_at: 1 }]);

        expect(await exportHmacSigner.verify(body, await exportHmacSigner.sign(body))).toBe(true);
    });

    it('rejects a payload altered after signing', async () => {
        const original = bodyOf([{ url: 'https://example.com', created_at: 1 }]);
        const signature = await exportHmacSigner.sign(original);
        const tampered = bodyOf([{ url: 'https://evil.example', created_at: 1 }]);

        expect(await exportHmacSigner.verify(tampered, signature)).toBe(false);
    });

    it('rejects a signature that is not one of ours', async () => {
        // A file exported from a different browser profile carries a
        // well-formed signature over the same bytes, made with a secret this
        // profile does not have.
        const body = bodyOf([{ url: 'https://example.com', created_at: 1 }]);
        const foreign = 'Zm9yZWlnbi1zaWduYXR1cmUtb3Zlci10aGUtc2FtZS1ieXRlcw==';

        expect(await exportHmacSigner.verify(body, foreign)).toBe(false);
    });

    it('emits standard base64, not base64url', async () => {
        // Exports live on the user's disk; switching encoding would make
        // every existing backup fail to verify on restore. base64url differs
        // from base64 only in `+` `/` `=`, so the presence of padding is the
        // cheap discriminator.
        let signature = '';
        // Sign varied inputs until one produces padding — 32-byte HMAC output
        // always does, but assert rather than assume.
        for (let i = 0; i < 8 && !signature.includes('='); i++) {
            signature = await exportHmacSigner.sign(bodyOf([{ n: i }]));
        }

        expect(signature).toMatch(/=$/);
        expect(signature).not.toMatch(/[-_]/);
    });
});
