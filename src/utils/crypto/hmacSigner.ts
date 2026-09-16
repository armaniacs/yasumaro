/**
 * crypto/hmacSigner.ts
 * One seam for HMAC-SHA256 signing (PBI 2026-09-16-04).
 *
 * Callers used to pick between two functions by key shape — `computeHMAC`
 * (string secret) or `generateHmacSignature` (CryptoKey) — which pushed the
 * question of how a key is obtained out to every call site. A signer hides
 * that: you construct one for a purpose, then `sign` and `verify`.
 *
 * Encoding stays a property of the signer rather than something unified,
 * because signatures outlive the code that made them:
 *
 *   - settings / log exports are written to files on the user's disk, signed
 *     with standard base64
 *   - the stored privacy consent and notification ids use base64url
 *
 * Switching either to the other encoding would invalidate signatures that
 * already exist — a restored backup would fail to verify, and a recorded
 * consent would read as tampered. So the seam carries the encoding instead of
 * flattening it, and each purpose keeps the one its data was signed with.
 *
 * Verification is always constant-time. That used to be the caller's job on
 * the `computeHMAC` path (a `constantTimeCompare` they had to remember to
 * make), and forgetting it leaks signature bytes through timing.
 */

import { getWebCrypto, constantTimeCompare, bytesToBase64, bytesToBase64Url } from './primitives.js';

/** How a signature is rendered. Fixed per signer — see the file comment. */
export type HmacEncoding = 'base64' | 'base64url';

export interface HmacSigner {
    /** Sign `data`, rendered in this signer's encoding. */
    sign(data: string): Promise<string>;
    /** Constant-time check of `signature` against a fresh signing of `data`. */
    verify(data: string, signature: string): Promise<boolean>;
}

/** Resolves the signing key. Async because keys are unwrapped from storage. */
type KeyResolver = () => Promise<CryptoKey>;

const textEncoder = new TextEncoder();

/** Import a raw string secret as an HMAC-SHA256 key. */
async function importSecretKey(secret: string): Promise<CryptoKey> {
    return getWebCrypto().subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
}

function encodeSignature(signature: ArrayBuffer, encoding: HmacEncoding): string {
    const bytes = new Uint8Array(signature);
    return encoding === 'base64url' ? bytesToBase64Url(bytes) : bytesToBase64(bytes);
}

function createSigner(resolveKey: KeyResolver, encoding: HmacEncoding): HmacSigner {
    const signOnce = async (data: string): Promise<string> => {
        const key = await resolveKey();
        const signature = await getWebCrypto().subtle.sign('HMAC', key, textEncoder.encode(data));
        return encodeSignature(signature as ArrayBuffer, encoding);
    };

    return {
        sign: signOnce,
        async verify(data: string, signature: string): Promise<boolean> {
            if (!signature) return false;
            return constantTimeCompare(signature, await signOnce(data));
        },
    };
}

/**
 * A signer backed by a CryptoKey, resolved lazily on each call.
 *
 * The resolver runs per call rather than once at construction because these
 * keys are unwrapped from chrome.storage, which a service worker restart can
 * invalidate — a signer captured at startup would hold a stale key.
 */
export function hmacSignerForKey(resolveKey: KeyResolver, encoding: HmacEncoding): HmacSigner {
    return createSigner(resolveKey, encoding);
}

/**
 * A signer backed by a string secret.
 *
 * Kept distinct from `hmacSignerForKey` only because the secret must be
 * imported as a key first; callers see the same interface either way.
 */
export function hmacSignerForSecret(resolveSecret: () => Promise<string>, encoding: HmacEncoding): HmacSigner {
    return createSigner(async () => importSecretKey(await resolveSecret()), encoding);
}
